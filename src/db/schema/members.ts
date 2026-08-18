import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';

/**
 * Household members authored by Heorth (B4, ADR 0002 phase B / ADR 0009).
 *
 * DESIGN FORK, resolved here — see `src/services/members.ts` for the full
 * reasoning. A just-in-time provisioned member is a row in core's `users`
 * table whose **primary key IS Heorth's `sub`**; this table adds nothing to
 * that identity, it only records PROVENANCE: "the local user with this id was
 * authored by Heorth, not by KithLedger". A `users` row with no row here is a
 * local account (today: the seeded admin, the only one).
 *
 * There is deliberately no `heorth_sub` column: it would be a second copy of
 * `user_id` that could disagree with it. The local id is the Heorth id, by
 * construction, and `provisionMember` refuses to claim a `users` row that has
 * no row here — so Heorth can never take over a local account.
 *
 * What this buys, concretely:
 *  - ADR 0004 / task B5's `owner` columns foreign-key ONE table (`users.id`)
 *    and cover both members and the local admin.
 *  - Key management can reject Heorth-authored callers structurally
 *    (`requireLocalAccount` in `src/identity.ts`) rather than by inspecting a
 *    synthesised email.
 *  - ADR 0004 §4's "reassign or delete this member's items" offboarding step
 *    has an explicit list of the members it applies to.
 *
 * No roster sync, no provisioning endpoint: rows appear on a member's first
 * authenticated request and never otherwise. Reintroducing a roster is exactly
 * the coupling ADR 0007 cited when it deleted Feoh.
 */
export const householdMembers = pgTable('household_members', {
  /** The local `users.id`, which IS the `sub` of Heorth's member token. */
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** When this member first presented a valid Heorth token here. */
  provisionedAt: timestamp('provisioned_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type HouseholdMember = typeof householdMembers.$inferSelect;
export type NewHouseholdMember = typeof householdMembers.$inferInsert;
