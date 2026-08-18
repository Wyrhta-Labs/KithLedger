import { text, uuid, check } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';

/**
 * ADR 0004 §1 — visibility is a 3-state property of every node AND every edge.
 *
 * `household` is an EXPLICIT state, not a materialised share list containing
 * every member. That is the load-bearing part: a member added tomorrow sees
 * every `household` item with no re-share, and a `shared` subset does NOT
 * silently grow to include them. Modelling `household` as "shared with
 * everyone" would invert both of those properties.
 */
export const VISIBILITY_VALUES = ['private', 'shared', 'household'] as const;
export type Visibility = (typeof VISIBILITY_VALUES)[number];

/** ADR 0004 §4 — default on create is the shared case, not the private one. */
export const DEFAULT_VISIBILITY: Visibility = 'household';

/**
 * The `visibility` column, identical on all four domain tables.
 *
 * NOT NULL with a static default, so the ADR's "default on create =
 * `household`" is a property of the database rather than of whichever code
 * path happens to do the insert — REST, MCP, a migration, or psql.
 */
export const visibilityColumn = () =>
  text('visibility').notNull().default(DEFAULT_VISIBILITY).$type<Visibility>();

/**
 * The DB-level enum constraint, following how this repo already constrains
 * `type` / `status` / `sentiment` / `kind` (a CHECK on a `text` column rather
 * than a pg enum type, which cannot have values removed).
 */
export const visibilityCheck = (tableName: string, column: AnyPgColumn) =>
  check(`${tableName}_visibility_check`, sql`${column} IN ('private', 'shared', 'household')`);

/**
 * The `owner` column, identical on all four domain tables.
 *
 * FOREIGN KEY -> `users.id`. B4 made this possible by giving Heorth-authored
 * members a row in core's `users` whose id IS their `sub`, so members and the
 * local admin live in one id space and `owner_id` can be a real foreign key
 * instead of a polymorphic `(owner_kind, owner_id)` pair.
 *
 * ON DELETE RESTRICT, deliberately. ADR 0004 §4 mandates
 * reassign-on-offboarding: when a member leaves, someone decides *at that
 * moment* whether their owner-only items are reassigned or deleted. A CASCADE
 * would silently destroy exactly the data that flow exists to handle, and a
 * SET NULL would leave ownerless rows that no scope predicate can classify.
 * RESTRICT makes `DELETE FROM users` fail loudly until B9's offboarding has
 * emptied the member's owned set — the deletion cannot outrun the decision.
 *
 * NULLABLE, for now, and only for now. Populating this on insert requires the
 * calling principal, and threading principals into the service layer is task
 * B6 — this task lands the model inert (ADR 0004: "schema-present but
 * inert"). A NOT NULL column here today would break every existing write path
 * or force a fabricated owner (e.g. "everything is the admin's"), which would
 * mislabel member-authored rows the moment members can write. B6 sets
 * `owner_id` from the principal on every insert and ships the `SET NOT NULL`
 * once the write path guarantees it. Rows that pre-date this migration are
 * backfilled (see `0004_*.sql`), so the only NULLs possible are ones created
 * in the B5..B6 window.
 */
export const ownerIdColumn = () =>
  uuid('owner_id').references(() => users.id, { onDelete: 'restrict' });
