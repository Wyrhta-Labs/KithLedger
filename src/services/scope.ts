import { sql, eq, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Principal } from '@wyrhta/core/auth';
import { credentialOf } from './credentials.js';
import { db } from '../db/index.js';
import {
  people,
  interactions,
  relationships,
  reminders,
  personShares,
  interactionShares,
  relationshipShares,
  reminderShares,
} from '../db/schema/index.js';

/**
 * ADR 0004 §2 (caller → scope) and §4 (defaults, mutation, lifecycle), made
 * real. B5 landed the columns inert; this module is the single place that
 * turns them into a query predicate and an ownership rule, so no service ever
 * hand-writes either.
 *
 * ── WHY ONE MODULE ───────────────────────────────────────────────────────────
 *
 * There are ~27 Drizzle call sites across four services. Hand-writing the
 * predicate at each of them means 27 chances to drop the `visibility =
 * 'shared'` guard, and one dropped guard is a silent, permanent disclosure of
 * every item that was EVER shared with the caller. Factoring it once means the
 * rule is reviewed once and applied by construction; a new call site that
 * forgets to call {@link visibleTo} is a visible omission rather than a subtly
 * wrong `or(...)`.
 */

/**
 * The visibility scope a caller resolves to (ADR 0004 §2).
 *
 * `member` — a household member (or the local admin, who is a member of the
 * one-person household by construction): `household` items, items they own,
 * and `shared` items whose set includes them.
 *
 * `household` — the always-on dashboard's service principal: exactly the
 * items marked `household`, read-only. This is a SCOPE, not a bypass — it is
 * strictly narrower than any member's, which is the point: a leaked dashboard
 * key exposes only the household slice. B6 made the scope expressible; B8 gave
 * it its own credential (`kind = 'household'` on a `kl_` key), so this variant
 * is now reachable and is reached ONLY that way.
 *
 * There is deliberately NO third variant for the admin/ops key, even though
 * ADR 0004 §2 names three principals. The third one's defining property is
 * that it has NO data access, and the honest encoding of "no scope" is not a
 * third scope — a scope is a thing queries are built from, and building a
 * query for the ops key is already the bug. It is refused before a scope is
 * ever needed (`requireDataAccess`), and {@link scopeFor} throws rather than
 * inventing one. ADR 0004 §4's "no standing god-mode" then holds by there
 * being nothing to bypass with: `role === 'admin'` is never consulted here,
 * and the local admin sees other members' items exactly as any member would —
 * as an owner of their own, and not at all when they are `private`.
 */
export type Scope =
  | { readonly kind: 'member'; readonly memberId: string }
  | { readonly kind: 'household' };

/** The personal scope of one member (ADR 0004 §2.1). */
export function memberScope(memberId: string): Scope {
  return { kind: 'member', memberId };
}

/** The household service principal's read-only scope (ADR 0004 §2.2). */
export const HOUSEHOLD_SCOPE: Scope = { kind: 'household' };

/** Thrown when a credential with no data path (ops) reaches a query. */
export const NO_DATA_ACCESS = 'NO_DATA_ACCESS';

/**
 * The scope of an authenticated caller — ADR 0004 §2's three principals,
 * resolved from the credential the caller presented and from nothing else
 * (task B8; see `src/services/credentials.ts` for where the kind is decided).
 *
 *  1. **member** — the local admin's HS256 JWT, a Heorth member token, or a
 *     `kl_` key issued as a member key. `userId` is a `users.id` in all three
 *     (B4 put members and the local admin in one id space).
 *  2. **household** — the always-on dashboard key: {@link HOUSEHOLD_SCOPE},
 *     which is read-only and strictly narrower than ANY member's. Note that
 *     its `principal.userId` (the local account that issued the key) is
 *     deliberately DISCARDED here: were it kept, a leaked dashboard key would
 *     read as that account's personal scope, which is exactly the widening
 *     ADR 0004 §2 separates the credentials to prevent.
 *  3. **ops** — no data path at all, so there is no scope to return and this
 *     throws. `requireDataAccess` refuses these callers at the router, so this
 *     is a backstop: any future code path that reaches a query with an ops
 *     principal fails loudly instead of quietly resolving to something.
 *
 * The role is not consulted, on purpose (§4: no standing god-mode).
 */
export function scopeFor(principal: Principal): Scope {
  switch (credentialOf(principal)) {
    case 'household':
      return HOUSEHOLD_SCOPE;
    case 'ops':
      throw new Error(NO_DATA_ACCESS);
    case 'member':
      return memberScope(principal.userId);
  }
}

/** Thrown when a non-owner attempts an owner-only mutation (ADR 0004 §4). */
export const NOT_OWNER = 'NOT_OWNER';

/** Thrown when a read-only scope (the household principal) attempts a write. */
export const READ_ONLY_SCOPE = 'READ_ONLY_SCOPE';

/**
 * The `owner_id` to stamp on an insert, and the id an owner-only check
 * compares against. A read-only scope has no member to own anything, so it
 * cannot write at all — the refusal is structural rather than a policy check
 * someone can forget.
 */
export function ownerFor(scope: Scope): string {
  if (scope.kind !== 'member') throw new Error(READ_ONLY_SCOPE);
  return scope.memberId;
}

/** True when `scope` owns a row whose `owner_id` is `ownerId`. */
export function ownsRow(scope: Scope, ownerId: string | null): boolean {
  return scope.kind === 'member' && ownerId !== null && ownerId === scope.memberId;
}

/**
 * Everything the predicate needs about one entity: the table's own columns and
 * the per-entity share table B5 chose precisely so this is an exact index
 * probe rather than a self-join on a four-value discriminator.
 *
 * Column and table NAMES (not Drizzle column objects) because the predicate
 * has to be renderable against an arbitrary alias: B7's recursive CTE refers
 * to `relationships` as `r`, `r2` and `g` in one statement, and a Drizzle
 * column object always renders its own table's name.
 */
export interface ScopedEntity {
  /** Default alias — the real table name, which is what Drizzle emits. */
  readonly table: string;
  readonly idColumn: string;
  readonly shareTable: string;
  readonly shareKeyColumn: string;
}

export const PEOPLE_SCOPE: ScopedEntity = {
  table: 'people',
  idColumn: 'id',
  shareTable: 'person_shares',
  shareKeyColumn: 'person_id',
};

export const INTERACTIONS_SCOPE: ScopedEntity = {
  table: 'interactions',
  idColumn: 'id',
  shareTable: 'interaction_shares',
  shareKeyColumn: 'interaction_id',
};

export const RELATIONSHIPS_SCOPE: ScopedEntity = {
  table: 'relationships',
  idColumn: 'id',
  shareTable: 'relationship_shares',
  shareKeyColumn: 'relationship_id',
};

export const REMINDERS_SCOPE: ScopedEntity = {
  table: 'reminders',
  idColumn: 'id',
  shareTable: 'reminder_shares',
  shareKeyColumn: 'reminder_id',
};

const ident = (name: string) => sql.raw(`"${name.replace(/"/g, '""')}"`);

/**
 * THE READ PREDICATE (ADR 0004 §2 + §3.1/§3.4). Every list, get, count,
 * search total, autocomplete and existence pre-check goes through this, and
 * B7's traversal must apply the very same fragment at every hop.
 *
 *     visibility = 'household'
 *       OR owner_id = :me
 *       OR (visibility = 'shared' AND EXISTS (
 *             SELECT 1 FROM <entity>_shares s
 *             WHERE s.<entity>_id = t.id AND s.member_id = :me))
 *
 * The `visibility = 'shared'` guard is NOT redundant and must never be
 * dropped: a share row survives a `shared` -> `private` flip (B5 deliberately
 * did not cascade it, since re-sharing later should not require re-granting),
 * so consulting the share table alone would leave a "private" item readable
 * forever by everyone it was ever shared with. That is the single most
 * dangerous way to get this wrong, which is why it exists in exactly one
 * place.
 *
 * `alias` renders the predicate against something other than the base table —
 * what B7 needs inside its recursive CTE. It defaults to the table name, which
 * is what Drizzle emits for an unaliased `from(...)`.
 *
 * Emitted as raw SQL rather than Drizzle's `or()`/`exists()` so that the
 * alias-taking form and the ordinary form are LITERALLY the same string. Two
 * implementations of one security rule is how the two drift apart.
 */
export function visibleTo(entity: ScopedEntity, scope: Scope, alias = entity.table): SQL {
  const t = ident(alias);

  // The household service principal: exactly the `household` slice, and no
  // share table is consulted at all — it has no member id to match.
  if (scope.kind !== 'member') {
    return sql`${t}."visibility" = 'household'`;
  }

  const me = scope.memberId;
  return sql`(
    ${t}."visibility" = 'household'
    OR ${t}."owner_id" = ${me}::uuid
    OR (
      ${t}."visibility" = 'shared'
      AND EXISTS (
        SELECT 1 FROM ${ident(entity.shareTable)} s
        WHERE s.${ident(entity.shareKeyColumn)} = ${t}.${ident(entity.idColumn)}
          AND s."member_id" = ${me}::uuid
      )
    )
  )`;
}

/**
 * THE DELETE PREDICATE (ADR 0004 §4, task B9). Deliberately NARROWER than
 * {@link visibleTo}, and narrower than the content-edit rule:
 *
 *   | state       | read              | edit content      | delete           |
 *   |-------------|-------------------|-------------------|------------------|
 *   | `private`   | owner             | owner             | owner            |
 *   | `shared`    | owner + share set | owner + share set | **owner only**   |
 *   | `household` | all members       | all members       | all members      |
 *
 *     visibility = 'household' OR owner_id = :me
 *
 * WHY DELETE SPLITS FROM EDIT. B6 made both follow read scope on one argument:
 * `household` is the DEFAULT state, so an owner-only write rule would make the
 * household's own address book read-only for everyone except whoever typed
 * each row in first. That argument is about `household` items and it is
 * untouched — they stay deletable by any member, because an item only its
 * author can remove outlives its usefulness the moment the author stops
 * caring about it, and for shared household data that is the common case.
 *
 * It never covered `shared`, though. A `shared` item is a carve-out its owner
 * made deliberately for a named audience; letting a member of that audience
 * destroy it turns "I let you read this" into "I let you take this away from
 * me", which is not what granting read access means. An edit is recoverable in
 * principle and now leaves a trace (`updated_by`); a delete is neither.
 * `private` is unchanged — nobody else can see it, so nobody else can reach it.
 *
 * WHERE IT IS APPLIED. Both in a pre-check (so the caller gets 403 rather than
 * a silent no-op) and in the DELETE's own `where` alongside {@link visibleTo}
 * (so a `shared` -> `household` flip racing the statement cannot widen it).
 * The 404/403 split is the caller's job and is NOT a §3.1 violation: 404 when
 * the item is outside the scope entirely, 403 only for an item already visible
 * to this caller, where refusing discloses nothing they did not already know —
 * exactly the line B6 drew for the `NOT_OWNER` governance gate.
 */
export function deletableBy(entity: ScopedEntity, scope: Scope, alias = entity.table): SQL {
  const t = ident(alias);
  // A read-only scope reaches neither this nor the statement it guards
  // (`ownerFor` throws first). `false` rather than a thrown error so that the
  // predicate is total: a scope with no member owns nothing and may delete
  // nothing.
  if (scope.kind !== 'member') return sql`false`;
  return sql`(${t}."visibility" = 'household' OR ${t}."owner_id" = ${scope.memberId}::uuid)`;
}

/**
 * The same rule as {@link deletableBy}, evaluated in TypeScript against a row
 * the caller has already read. One rule, two renderings — kept adjacent so
 * they cannot drift, and both are needed: this one produces the 403, the SQL
 * one closes the window between reading the row and deleting it.
 */
export function canDelete(
  scope: Scope,
  row: { visibility: string; ownerId: string | null },
): boolean {
  return row.visibility === 'household' || ownsRow(scope, row.ownerId);
}

/** Either the pool client or an open transaction. */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The Drizzle handles needed to REWRITE one entity's share set. */
interface ShareTarget<T extends PgTable> {
  readonly table: T;
  readonly entityColumn: PgColumn;
  readonly row: (entityId: string, memberId: string) => T['$inferInsert'];
}

export const PERSON_SHARE_TARGET: ShareTarget<typeof personShares> = {
  table: personShares,
  entityColumn: personShares.personId,
  row: (personId, memberId) => ({ personId, memberId }),
};

export const INTERACTION_SHARE_TARGET: ShareTarget<typeof interactionShares> = {
  table: interactionShares,
  entityColumn: interactionShares.interactionId,
  row: (interactionId, memberId) => ({ interactionId, memberId }),
};

export const RELATIONSHIP_SHARE_TARGET: ShareTarget<typeof relationshipShares> = {
  table: relationshipShares,
  entityColumn: relationshipShares.relationshipId,
  row: (relationshipId, memberId) => ({ relationshipId, memberId }),
};

export const REMINDER_SHARE_TARGET: ShareTarget<typeof reminderShares> = {
  table: reminderShares,
  entityColumn: reminderShares.reminderId,
  row: (reminderId, memberId) => ({ reminderId, memberId }),
};

/**
 * Replace an item's share set (ADR 0004 §4 — sharing is NOT transitive, so
 * every caller of this must already have established `owner_id = :me`; the
 * services do that before calling, and this function is not exported to the
 * routes).
 *
 * A full replace rather than add/remove deltas: the share set is a *state* the
 * owner declares, so `sharedWith: []` unambiguously revokes everything and two
 * concurrent edits cannot interleave into a set neither owner asked for.
 */
export async function replaceShareSet<T extends PgTable>(
  tx: Executor,
  target: ShareTarget<T>,
  entityId: string,
  memberIds: readonly string[],
): Promise<void> {
  await tx.delete(target.table).where(eq(target.entityColumn, entityId));
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return;
  await tx.insert(target.table).values(unique.map((m) => target.row(entityId, m)));
}

/** The four tables' scope descriptors, keyed for reuse (notably by B7). */
export const SCOPED_ENTITIES = {
  people: PEOPLE_SCOPE,
  interactions: INTERACTIONS_SCOPE,
  relationships: RELATIONSHIPS_SCOPE,
  reminders: REMINDERS_SCOPE,
} as const;

/**
 * The Drizzle tables the descriptors above describe, exported so a reader can
 * see the pairing is not a guess.
 */
export const SCOPED_TABLES = { people, interactions, relationships, reminders } as const;
