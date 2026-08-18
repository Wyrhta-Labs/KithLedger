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
 * NOT NULL as of B6. B5 shipped it nullable on purpose — stamping an owner on
 * insert needs the calling principal, and threading principals through the
 * service layer was B6's job, so a NOT NULL then would have broken every write
 * path or forced a fabricated owner that mislabels member-authored rows. Now
 * that every insert sets `owner_id` from the principal, the column is
 * constrained: an unowned row is one the scope predicate cannot classify
 * (`owner_id = :me` is NULL, not false, and it would be visible only while
 * `household`), so "every row has an owner" has to be a database invariant
 * rather than a convention four services agree to keep. Pre-existing rows were
 * backfilled by `0004_*.sql`; the `SET NOT NULL` migration re-runs the same
 * deterministic backfill first, so any row created in the B5..B6 window is
 * carried over rather than blocking the upgrade.
 */
export const ownerIdColumn = () =>
  uuid('owner_id').notNull().references(() => users.id, { onDelete: 'restrict' });

/**
 * The `updated_by` column, identical on all four domain tables (task B9).
 *
 * WHAT IT IS FOR. `created_at`/`updated_at` record WHEN a row last changed but
 * never WHO changed it, and B6 made that gap load-bearing: content edits
 * deliberately follow READ scope, so any member a `shared` item reaches — and
 * every member, for a `household` item — may rewrite it. Before this column,
 * a member editing another member's shared note left no trace whatsoever. This
 * is that trace: the principal that performed the last write, stamped in the
 * same place `owner_id` is stamped from `ownerFor(scope)`.
 *
 * It is PROVENANCE, not authorization. Nothing in `src/services/scope.ts`
 * reads it; no predicate branches on it; it can never widen or narrow what
 * anybody may see. Ownership answers "whose is this"; this answers "who
 * touched it last", and those are different questions with different lifetimes.
 *
 * ── ON DELETE SET NULL, AND WHY NOT RESTRICT ─────────────────────────────────
 *
 * `owner_id` is RESTRICT because ownership is a LIVE fact the access-control
 * model depends on: an ownerless row is one the scope predicate cannot
 * classify, so `DELETE FROM users` must fail until B9's offboarding has
 * decided what becomes of the member's items. None of that reasoning transfers
 * here:
 *
 *  - RESTRICT would be actively wrong. A member who owns nothing but once
 *    corrected a typo in somebody else's household note would be undeletable,
 *    and the only way to finish offboarding them would be to REWRITE that
 *    stamp — i.e. to fabricate the history the column exists to record. A
 *    provenance column must never be able to veto a lifecycle operation.
 *  - CASCADE is absurd: it would delete the household's data because the
 *    person who last edited it left.
 *  - SET NULL is the honest one. The row survives unchanged, and NULL says
 *    exactly what is true afterwards: the principal that last wrote this is no
 *    longer known to this service. Nothing is reattributed to anybody — the
 *    alternative of "reassign the stamp to the new owner" would assert an edit
 *    that never happened.
 *
 * NULLABLE follows from SET NULL, and the same NULL is what pre-B9 rows carry:
 * "not recorded" has exactly one representation. See `0007_*.sql` for why
 * those rows are deliberately NOT backfilled to a plausible value.
 *
 * No index: nothing filters or joins on this column. The only statement that
 * scans it is the SET NULL fired by a once-per-offboarding `DELETE FROM users`
 * over four household-sized tables.
 */
export const updatedByColumn = () =>
  uuid('updated_by').references(() => users.id, { onDelete: 'set null' });
