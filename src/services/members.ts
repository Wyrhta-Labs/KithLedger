import { eq, sql } from 'drizzle-orm';
import { logEvent } from '@wyrhta/core/lib';
import { userRole, type Role } from '@wyrhta/core/identity';
import { db } from '../db/index.js';
import { users, householdMembers } from '../db/schema/index.js';

/**
 * Just-in-time provisioning of Heorth-authored household members (task B4,
 * ADR 0002 phase B, ADR 0009).
 *
 * Members are authored in exactly ONE place: Heorth. KithLedger never becomes
 * a second source of truth for who the household is. A validly signed token
 * whose `sub` we have not seen creates the local record for that member on
 * that first request — no roster sync, no provisioning endpoint, no staleness
 * window. That coupling is what ADR 0007 cited when it deleted Feoh.
 *
 * ── THE DESIGN FORK, AND WHY IT WENT THIS WAY ────────────────────────────────
 *
 * A satellite token carries `sub` and `role` and nothing else — ADR 0009 fixes
 * that claim set, so widening it to carry an email was not on the table. Core's
 * `users` table, meanwhile, requires `email`, `handle` and `password_hash` NOT
 * NULL with `email`/`handle` UNIQUE. Two options:
 *
 *   (a) reuse core's `users`, synthesising the three columns; or
 *   (b) a separate table holding the member identity itself, leaving `users`
 *       to KithLedger's local admin.
 *
 * We chose (a). The deciding argument is ADR 0004 / task B5: every node and
 * every edge gets an `owner` column, and the local admin owns items just as a
 * member does. Under (b) `owner` would have to reference two disjoint identity
 * spaces — a Postgres foreign key cannot do that, so B5 would need either an
 * un-foreign-keyed `owner` (no referential integrity on the column the whole
 * access-control model rests on) or a polymorphic `(owner_kind, owner_id)`
 * pair threaded through every query and every join in ADR 0004 §3's traversal
 * rules. Under (a) it is one column, `references(users.id)`, and it covers
 * both. `c.get('principal').userId` is likewise already a `users.id`
 * everywhere in the codebase and stays one.
 *
 * The costs of (a) were weighed, not waved away:
 *
 *  - **Local login must be impossible.** `password_hash` is set to
 *    {@link UNUSABLE_PASSWORD_HASH}, which is not an argon2 encoded hash at
 *    all. Core's `verifyPassword` returns false for it for EVERY input — this
 *    is structural, not a low-probability guess: there is no plaintext that
 *    argon2 could verify against a non-argon2 string. We deliberately do NOT
 *    route this through core's `createUser`, which would hash some random
 *    password and leave an account that is merely hard to log into.
 *  - **A synthesised unique email/handle can collide or leak.** Both are
 *    derived from the `sub` alone — an opaque uuid Heorth already published to
 *    this service — so they carry no personal data to leak, and they are
 *    unique exactly because the `sub` is. The domain is `.invalid`, reserved
 *    by RFC 2606 and guaranteed never to resolve, so the address is
 *    non-routable by construction rather than by convention. The handle is
 *    namespaced with {@link HEORTH_HANDLE_PREFIX} so it cannot collide with a
 *    local handle (`admin`).
 *  - **Heorth must not be able to claim a local account.** Provenance is
 *    recorded in `household_members`; a `users` row with no row there is a
 *    local account and provisioning REFUSES it rather than adopting it.
 *
 * ── ATOMICITY ────────────────────────────────────────────────────────────────
 *
 * The `users` row and its `household_members` row are ONE fact — "this id was
 * authored by Heorth" — and the refusal above reads the ABSENCE of the second
 * row as proof of the opposite. So the pair must never be separately
 * observable: while a `users` row stood committed without its provenance row,
 * a concurrent request for the same `sub` saw exactly the shape of a local
 * account and refused a member who was being provisioned at that instant
 * (surfacing as a 401 on a member's first-ever request — precisely what an MCP
 * client issuing parallel tool calls produces). The two inserts are therefore
 * a SINGLE statement: a CTE whose `household_members` insert selects from the
 * `users` insert's `RETURNING`. One statement is one transaction, so no
 * snapshot can fall between them, and the provenance row is inserted ONLY for
 * a `users` row this statement itself created — a pre-existing row is never
 * adopted, which is the B4 security property expressed as data flow rather
 * than as a check that could be raced.
 *
 * The concurrent loser needs no retry and no lock of ours: its
 * `ON CONFLICT DO NOTHING` WAITS on the winner's in-flight unique-index entry
 * and only reports "did nothing" once that transaction has committed. So
 * "we inserted nothing" is a settled fact about committed data, and the single
 * follow-up read that resolves it cannot land mid-write.
 *
 * ── ROLE ─────────────────────────────────────────────────────────────────────
 *
 * The role travels from the token and is never elevated (ADR 0009). The stored
 * `users.role` is a mirror of the last token seen, kept in step so nothing
 * downstream reads a stale value; the authoritative role for any given request
 * is always the one in that request's token. A role the local enum does not
 * know is refused outright — mapping it to a default would be this service
 * inventing an authorization decision Heorth did not make.
 */

/** RFC 2606 reserved TLD: guaranteed never to resolve, so mail cannot be sent. */
export const HEORTH_EMAIL_DOMAIN = 'heorth.invalid';

/** Namespaces synthesised handles away from local ones (`admin`). */
export const HEORTH_HANDLE_PREFIX = 'heorth-';

/**
 * Not an argon2 encoded hash, so `verifyPassword` returns false for every
 * input. A Heorth-authored member has no local password and cannot obtain one.
 */
export const UNUSABLE_PASSWORD_HASH = '!heorth-authored:no-local-password';

/** Heorth's `sub` becomes the local `users.id`, so it has to be a uuid. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `role` claim, if it is one this deployment knows. */
export function asHouseholdRole(claim: unknown): Role | null {
  return typeof claim === 'string' && (userRole.enumValues as readonly string[]).includes(claim)
    ? (claim as Role)
    : null;
}

/** Synthesised, non-routable address for a Heorth-authored member. */
export function memberEmail(sub: string): string {
  return `${sub}@${HEORTH_EMAIL_DOMAIN}`;
}

/** Synthesised, namespaced handle for a Heorth-authored member. */
export function memberHandle(sub: string): string {
  return `${HEORTH_HANDLE_PREFIX}${sub}`;
}

/** True when this local user id was authored by Heorth rather than locally. */
export async function isHouseholdMember(userId: string): Promise<boolean> {
  if (!UUID_RE.test(userId)) return false;
  const [row] = await db
    .select({ userId: householdMembers.userId })
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId))
    .limit(1);
  return !!row;
}

/** A `users` row read together with its Heorth provenance, in one snapshot. */
type SeenUser = { id: string; role: Role; provenance: string | null };

/**
 * One SELECT, one join: the account and the answer to "is it Heorth's?" come
 * from the same snapshot, so the two can never disagree with each other.
 */
async function readAccount(sub: string): Promise<SeenUser | undefined> {
  const [row] = await db
    .select({ id: users.id, role: users.role, provenance: householdMembers.userId })
    .from(users)
    .leftJoin(householdMembers, eq(householdMembers.userId, users.id))
    .where(eq(users.id, sub))
    .limit(1);
  return row;
}

/** Refuse (a local account), or accept and keep the role mirror in step. */
async function settle(seen: SeenUser, sub: string, role: Role): Promise<string | null> {
  if (!seen.provenance) {
    // A local account already owns this id. Heorth does not get to take it
    // over — that would turn an identity assertion into an account takeover.
    // This is now decidable: provisioning commits both rows or neither, so a
    // `users` row without provenance is local, not half-provisioned.
    logEvent({
      event: 'satellite.member.rejected',
      user_id: sub,
      success: false,
      reason: 'local_account',
    });
    return null;
  }
  if (seen.role !== role) {
    // Keep the mirror in step with the token; the token stays authoritative.
    await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, sub));
    logEvent({ event: 'satellite.member.role_changed', user_id: sub, role });
  }
  return seen.id;
}

/**
 * Ensure a local record exists for the Heorth member `sub`, creating it on
 * first sight. Returns the local user id (which equals `sub`), or `null` to
 * deny the request — an unusable `sub`, or a `users` row that is not Heorth's
 * to claim.
 *
 * Runs on EVERY satellite-authenticated request, so the overwhelmingly common
 * "already provisioned" case is one round trip and nothing else.
 *
 * Idempotent and race-safe — see the ATOMICITY note above. Concurrent first
 * requests for the same `sub` all reach the same single statement; exactly one
 * creates the pair, the others wait on its unique-index entry and then read the
 * committed result. None of them can observe a half-provisioned account.
 */
export async function provisionMember(sub: string, role: Role): Promise<string | null> {
  if (!UUID_RE.test(sub)) {
    logEvent({ event: 'satellite.member.rejected', success: false, reason: 'sub_not_a_uuid' });
    return null;
  }

  const seen = await readAccount(sub);
  if (seen) return settle(seen, sub, role);

  // First sight. ONE statement creates the account AND its provenance: the
  // provenance insert draws its row from the account insert's RETURNING, so
  // (i) nothing can observe one without the other, and (ii) it is structurally
  // impossible to stamp Heorth provenance onto a `users` row we did not create
  // — including one that appeared since the read above.
  //
  // Bare DO NOTHING (no conflict target) so a concurrent insert conflicting on
  // the id, the email or the handle all resolve the same way: someone else got
  // there first. Postgres makes that wait for their transaction to finish, so
  // by the time we see zero rows their work is committed and readable.
  const created = (await db.execute(sql`
    WITH "new_user" AS (
      INSERT INTO "users" ("id", "email", "handle", "password_hash", "role", "display_name")
      VALUES (
        ${sub}::uuid,
        ${memberEmail(sub)},
        ${memberHandle(sub)},
        ${UNUSABLE_PASSWORD_HASH},
        ${role}::"user_role",
        NULL
      )
      ON CONFLICT DO NOTHING
      RETURNING "id"
    )
    INSERT INTO "household_members" ("user_id")
    SELECT "id" FROM "new_user"
    RETURNING "user_id"
  `)) as unknown as { user_id: string }[];

  if (created.length > 0) {
    logEvent({ event: 'satellite.member.provisioned', user_id: sub, role, success: true });
    return sub;
  }

  // We created nothing, so a row was already there — a member provisioned by
  // the request that beat us, or a local account (possibly one merely holding
  // the synthesised email/handle, in which case there is no row at all here).
  const settled = await readAccount(sub);
  if (!settled) {
    logEvent({
      event: 'satellite.member.rejected',
      user_id: sub,
      success: false,
      reason: 'local_account',
    });
    return null;
  }
  return settle(settled, sub, role);
}
