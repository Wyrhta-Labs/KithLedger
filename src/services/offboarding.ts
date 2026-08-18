import { eq, sql, type SQL } from 'drizzle-orm';
import { logEvent } from '@wyrhta/core/lib';
import { db } from '../db/index.js';
import { users, householdMembers } from '../db/schema/index.js';

/**
 * ── REASSIGN-ON-OFFBOARDING (ADR 0004 §4, task B9) ───────────────────────────
 *
 * > **Orphan handling = reassign-on-offboarding.** There is **no standing
 * > god-mode** — no admin override and no service key can read another
 * > member's `private` items. When a member is removed, offboarding forces an
 * > explicit, one-time "reassign or delete this member's owner-only items"
 * > step decided *at that moment*. Private items never silently outlive
 * > access, and no ambient backdoor exists to recover them.
 *
 * B5 built the forcing function: `owner_id` is `ON DELETE RESTRICT`, so
 * `DELETE FROM users` fails loudly while the member still owns anything. This
 * module is the only thing that can make that deletion succeed, and everything
 * about it is shaped by the sentence above.
 *
 * ── HOW THIS AVOIDS BEING THE GOD-MODE IT EXISTS TO REPLACE ──────────────────
 *
 * The obvious wrong build is "an admin endpoint that lists a departing
 * member's items so the operator can decide item by item". That is a standing
 * read capability over private data wearing an offboarding costume, and it is
 * exactly what §4 forbids. So:
 *
 *  1. **Nothing here SELECTs content.** Not a name, not a note, not an id.
 *     Every statement below is an `UPDATE`/`DELETE` with no `RETURNING`, plus
 *     one `SELECT EXISTS` that yields a boolean. There is no code path that
 *     can return a person, an interaction, a relationship or a reminder, so
 *     there is no path to abuse — the absence is structural, not a policy.
 *  2. **The decision is made blind, and that is the design.** "Reassign this
 *     member's owner-only items to X, or delete them" is a policy decision
 *     about a departing person, not a data-inspection decision. Being able to
 *     read the items in order to choose is the capability §4 denies.
 *  3. **What IS exposed is one boolean** — {@link previewOffboarding}'s
 *     `hasOwnedItems`. It is the same bit the database already discloses to
 *     anyone who runs `DELETE FROM users` and reads the RESTRICT error, so
 *     publishing it adds nothing that was not already derivable, and without
 *     it the operator cannot tell whether this step is needed or finished.
 *     Deliberately NOT exposed: counts (§3.4 names a count of items you cannot
 *     see as a leak in its own right), a per-table breakdown (the shape of
 *     somebody's private set is itself information), and anything per-item.
 *  4. **It is one-time, not standing.** The capability is not a scope, not a
 *     credential kind and not a role; it is a single POST that must be aimed
 *     at a named member and that ends by deleting them. Between offboardings
 *     nothing here is reachable — there is no member to aim it at.
 *  5. **`role === 'admin'` is never consulted**, here as everywhere else in
 *     the access-control path. The gate is the CREDENTIAL (see the router).
 *
 * ── WHAT HAPPENS TO WHICH ITEMS ──────────────────────────────────────────────
 *
 * The ADR's sentence is about the member's **owner-only** items, and that is
 * precisely the split this implements:
 *
 *  - `private` and `shared` items — the owner-only carve-outs — are the
 *    operator's explicit choice: reassigned to the successor, or deleted.
 *  - `household` items are **always reassigned, never deleted**, whichever
 *    choice is made. They are not owner-only; they are the household's own
 *    address book, already visible to every member and to the always-on
 *    dashboard. Deleting the family's shared data because the member who first
 *    typed it left would be data loss no privacy argument supports, and
 *    handing it to a successor discloses nothing to anyone who could not
 *    already read it.
 *
 * ── THE SUCCESSOR, AND THE HOLE THIS CLOSES ──────────────────────────────────
 *
 * Reassignment inevitably transfers readability: the new owner of a `private`
 * item can read it. ADR 0004 §4 sanctions that — "reassign ... this member's
 * owner-only items" is one of the two offered outcomes — but it would be a
 * backdoor if the operator could name THEMSELVES. So the successor rules
 * differ by what is being moved:
 *
 *  - Owner-only items may only be reassigned to a **current Heorth-authored
 *    household member** (`household_members`, B4). The local operator account
 *    has no row there, so "offboard Alice, reassign her private notes to me,
 *    read them" is not expressible. The transfer is always person-to-person,
 *    between household members, and the operator is not one of the parties.
 *  - When only `household` items move (the `delete` disposition), any local
 *    user id is an acceptable successor, including the operator's own — those
 *    items disclose nothing new to anybody. This matters for the degenerate
 *    case of the last member leaving, where there is no other member to
 *    inherit and the alternative would be destroying the household's data.
 *
 * A colluding operator who also controls a member account is not defended
 * against, and cannot be: at that point they hold the member's own credential.
 * What is defended against is the operator using OFFBOARDING as the means.
 *
 * ── SHARES, IN BOTH DIRECTIONS ───────────────────────────────────────────────
 *
 * Neither direction needs code here, and both are deliberate (B5 chose the FK
 * actions for exactly this moment):
 *
 *  - **Grants TO the departing member** (items other people shared with them)
 *    are `member_id ... ON DELETE CASCADE`, so they vanish with the `users`
 *    row. The items themselves are untouched — they belong to their owners,
 *    who keep them, keep their `shared` state and keep the rest of their
 *    audience. Losing a grant destroys no data, which is why that side
 *    cascades where `owner_id` restricts.
 *  - **Grants ON the departing member's items** follow the item: deleted items
 *    take their grants with them (`entity_id ... ON DELETE CASCADE`), and
 *    reassigned items keep theirs. The successor inherits the audience the
 *    departing member declared, because narrowing or widening it would be
 *    KithLedger making a sharing decision nobody asked for. (The departing
 *    member's own grant row, if they were in their own share set, cascades
 *    away — harmless, since the predicate already ORs owner and share set.)
 *
 * `household_members` cascades with the `users` row too, and so do any
 * `api_keys` (core's FK) — though a member cannot hold one, since
 * `requireLocalAccount` keeps them off the key routes.
 *
 * ── WHAT THIS CANNOT DO, AND MUST NOT ────────────────────────────────────────
 *
 * The household roster lives in **Heorth**, not here: KithLedger learns of
 * members just-in-time from verified tokens (B4) and keeps no roster and no
 * denylist, because reintroducing one is the coupling ADR 0007 deleted a
 * service to avoid. So offboarding is INITIATED against KithLedger, never
 * detected by it, and the ordering matters: remove the member in Heorth first.
 * A member still holding a valid Heorth token would otherwise be
 * re-provisioned (as a new, empty member) on their next request. That is a
 * property of the no-roster design, not a gap this module could close.
 */

/** The member id names no local user at all. */
export const MEMBER_NOT_FOUND = 'MEMBER_NOT_FOUND';
/** The id names a locally authored account (B4), which is not offboarded here. */
export const NOT_A_HOUSEHOLD_MEMBER = 'NOT_A_HOUSEHOLD_MEMBER';
/** The named successor may not receive what is being moved. */
export const INVALID_SUCCESSOR = 'INVALID_SUCCESSOR';
/** Something must be reassigned and no successor was named. */
export const SUCCESSOR_REQUIRED = 'SUCCESSOR_REQUIRED';

/** What the operator decides, at the moment of removal, about `private`/`shared` items. */
export const OWNER_ONLY_DISPOSITIONS = ['reassign', 'delete'] as const;
export type OwnerOnlyDisposition = (typeof OWNER_ONLY_DISPOSITIONS)[number];

/**
 * The four tables that carry `owner_id`. Named as strings and driven through
 * `sql.raw` rather than as Drizzle table objects because every statement below
 * is the identical shape over all four; writing them out eight times invites
 * one of them to drift. The names are compile-time constants from this module
 * — no caller input reaches `sql.raw`.
 */
const OWNING_TABLES = ['people', 'interactions', 'relationships', 'reminders'] as const;

/**
 * Deletion order: edges before nodes. `interactions`/`reminders`/`relationships`
 * are `ON DELETE CASCADE` on `people`, so removing a person first would take
 * other members' edges on that person with it before this had a chance to
 * leave them alone. Going edges-first means only what this member owns is
 * removed by this module; the residual cascade (a `shared` person the member
 * owned, carrying an edge a member of the share set created) is inherent to
 * B5's cascade and is named here rather than left to be discovered.
 */
const DELETE_ORDER = ['interactions', 'reminders', 'relationships', 'people'] as const;

const table = (name: string) => sql.raw(`"${name}"`);

/** Either the pool client or an open transaction. */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Does this member own anything at all? A single boolean — see note 3 above
 * for why it is a boolean and not a count, and why publishing this particular
 * bit discloses nothing the `owner_id` RESTRICT does not already.
 */
async function ownsAnything(tx: Executor, memberId: string, onlyHousehold = false): Promise<boolean> {
  const extra: SQL = onlyHousehold ? sql` AND "visibility" = 'household'` : sql``;
  const arms = OWNING_TABLES.map(
    (t) => sql`SELECT 1 FROM ${table(t)} WHERE "owner_id" = ${memberId}::uuid${extra}`,
  );
  const [row] = (await tx.execute(
    sql`SELECT EXISTS (${sql.join(arms, sql` UNION ALL `)}) AS "any"`,
  )) as unknown as { any: boolean }[];
  return row?.any === true;
}

/** A member id that this flow may act on: known, and Heorth-authored (B4). */
async function assertOffboardable(memberId: string): Promise<void> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, memberId)).limit(1);
  if (!user) throw new Error(MEMBER_NOT_FOUND);
  const [member] = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(eq(householdMembers.userId, memberId))
    .limit(1);
  // The local operator account has no `household_members` row. Refusing it
  // here is what stops offboarding from being a way to delete the account that
  // operates the service — and, less dramatically, it keeps this flow aimed at
  // the population ADR 0004 §4 is about.
  if (!member) throw new Error(NOT_A_HOUSEHOLD_MEMBER);
}

export interface OffboardingPreview {
  readonly userId: string;
  /** True while `DELETE FROM users` would still be refused by the RESTRICT. */
  readonly hasOwnedItems: boolean;
}

/**
 * Everything the operator legitimately needs before deciding: that this id is
 * a household member this flow can act on, and whether anything is left to
 * resolve. Nothing else — no counts, no per-table breakdown, no items.
 */
export async function previewOffboarding(memberId: string): Promise<OffboardingPreview> {
  await assertOffboardable(memberId);
  return { userId: memberId, hasOwnedItems: await ownsAnything(db, memberId) };
}

export interface OffboardMemberInput {
  /** The local account performing the offboarding, stamped as `updated_by`. */
  readonly actorId: string;
  readonly memberId: string;
  /** The one-time decision: what becomes of the `private`/`shared` items. */
  readonly ownerOnlyItems: OwnerOnlyDisposition;
  /** Who inherits what is not deleted. */
  readonly successorId?: string | undefined;
}

export interface OffboardMemberResult {
  readonly userId: string;
  readonly ownerOnlyItems: OwnerOnlyDisposition;
  readonly successorId: string | null;
  /** The `users` row is gone; the RESTRICT has been satisfied. */
  readonly removed: true;
}

/**
 * Validate the named successor for what is about to move.
 *
 * `requireMember` is the load-bearing half: it is true exactly when OWNER-ONLY
 * items are being reassigned, and it excludes every locally authored account —
 * i.e. the operator. See "THE SUCCESSOR, AND THE HOLE THIS CLOSES" above.
 */
async function assertSuccessor(
  memberId: string,
  successorId: string,
  requireMember: boolean,
): Promise<void> {
  if (successorId === memberId) throw new Error(INVALID_SUCCESSOR);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, successorId)).limit(1);
  if (!user) throw new Error(INVALID_SUCCESSOR);
  if (!requireMember) return;
  const [member] = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(eq(householdMembers.userId, successorId))
    .limit(1);
  if (!member) throw new Error(INVALID_SUCCESSOR);
}

/**
 * The one-time, explicit offboarding step. Atomic: everything below runs in a
 * single transaction ending in `DELETE FROM users`, so if any row is somehow
 * left owned, the RESTRICT aborts the whole thing and the member is still
 * there to try again. A half-offboarded member — items destroyed, account
 * still live — is not a state this can leave behind.
 */
export async function offboardMember(input: OffboardMemberInput): Promise<OffboardMemberResult> {
  const { actorId, memberId, ownerOnlyItems, successorId } = input;

  await assertOffboardable(memberId);

  // A successor is needed for everything that is not deleted: all owned items
  // under `reassign`, and the `household` ones under `delete`. Whether the
  // latter applies is a fact about `household`-visible items — which every
  // member and the operator can already read — so deriving it here discloses
  // nothing about the owner-only set.
  const needsSuccessor =
    ownerOnlyItems === 'reassign'
      ? await ownsAnything(db, memberId)
      : await ownsAnything(db, memberId, true);

  if (needsSuccessor && !successorId) throw new Error(SUCCESSOR_REQUIRED);
  if (successorId) await assertSuccessor(memberId, successorId, ownerOnlyItems === 'reassign');

  await db.transaction(async (tx) => {
    if (ownerOnlyItems === 'delete') {
      // Owner-only items only. No RETURNING: this must not be able to hand
      // back what it destroyed.
      for (const t of DELETE_ORDER) {
        await tx.execute(sql`
          DELETE FROM ${table(t)}
          WHERE "owner_id" = ${memberId}::uuid AND "visibility" <> 'household'
        `);
      }
    }

    if (successorId) {
      // Whatever is left the member owns — under `reassign` that is
      // everything, under `delete` exactly the `household` items.
      for (const t of OWNING_TABLES) {
        await tx.execute(sql`
          UPDATE ${table(t)}
          SET "owner_id" = ${successorId}::uuid,
              "updated_by" = ${actorId}::uuid,
              "updated_at" = now()
          WHERE "owner_id" = ${memberId}::uuid
        `);
      }
    }

    // The forcing function, finally satisfiable. Grants to and from the member
    // and their `household_members` row cascade; rows they last edited but did
    // not own keep their content and lose only the `updated_by` stamp
    // (SET NULL — "the writer is no longer known here", not a reattribution).
    await tx.delete(users).where(eq(users.id, memberId));
  });

  // The audit record names the decision and the parties, and describes no
  // data: no counts, nothing per-item. Accountability for the act, not a
  // second channel for what was in it.
  logEvent({
    event: 'member.offboarded',
    user_id: memberId,
    actor_id: actorId,
    owner_only_items: ownerOnlyItems,
    successor_id: successorId ?? null,
    success: true,
  });

  return { userId: memberId, ownerOnlyItems, successorId: successorId ?? null, removed: true };
}
