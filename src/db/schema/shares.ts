import { pgTable, uuid, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '@wyrhta/core/identity';
import { people } from './people.js';
import { interactions } from './interactions.js';
import { relationships } from './relationships.js';
import { reminders } from './reminders.js';

/**
 * The explicit share set behind ADR 0004 §1's `shared` state: "owner + an
 * explicit set of member ids" (the "spouse but not the kids" case).
 *
 * FOUR TABLES, NOT ONE POLYMORPHIC TABLE. The alternative — a single
 * `entity_shares(entity_type, entity_id, member_id)` — was rejected:
 *
 *  - Referential integrity. Postgres cannot foreign-key a polymorphic
 *    `entity_id`, so a share row could point at a deleted or never-existing
 *    entity and nothing would say so. On an ACCESS-CONTROL table that is not
 *    a tidiness complaint: a dangling grant is a silent authorisation fault,
 *    and a share row that outlives its person quietly becomes a grant on
 *    whatever id shows up next. Here every share row is `ON DELETE CASCADE`
 *    on both sides — delete the person and its grants go with it, for free
 *    and in the same transaction, with no trigger and no service-layer
 *    cleanup step that some future code path can forget to call.
 *  - What B6/B7 must JOIN. Every list query, every count, and the recursive
 *    CTE in `getPersonGraph` will carry an `EXISTS (... WHERE entity_id = x
 *    AND member_id = :me)` per entity. With one table per entity that is an
 *    exact index probe on the composite primary key. With a polymorphic
 *    table, `getPersonGraph` — which touches people AND relationships in the
 *    SAME recursive statement — self-joins the one share table twice with
 *    different discriminators, on an index whose leading column has four
 *    distinct values, and the planner's row estimates get correspondingly
 *    worse on the hottest query in the service.
 *  - The uuid columns are not interchangeable anyway: a `person_id` and an
 *    `interaction_id` mean different things, and collapsing them into one
 *    column loses that in the type system as well as in the database.
 *
 * The cost is four near-identical DDL blocks and this comment. That is a
 * one-time cost paid at schema-authoring time; the polymorphic version's cost
 * is paid on every query B6 writes and on every delete path forever.
 *
 * The member side foreign-keys `users.id` in all four (ADR 0004 / B4's one id
 * space), ON DELETE CASCADE: losing a member removes their grants, which
 * destroys no data — unlike `owner_id`, which is RESTRICT precisely because
 * it does.
 *
 * NOT ENFORCEABLE HERE, and therefore B6's job:
 *  - Share rows are only meaningful when `visibility = 'shared'`. A row
 *    flipped `shared` -> `private` may leave grants behind, so B6's predicate
 *    must read `visibility = 'shared' AND EXISTS (<share>)` and never consult
 *    the share table on its own. (A cross-table CHECK cannot express this
 *    without a trigger, and a trigger would be enforcement logic hidden below
 *    the layer that owns it.)
 *  - ADR 0004 §4's "only the owner may change visibility/the share set, and
 *    sharing is not transitive" is a statement about the *writer*, which the
 *    database never sees. B6 must gate every INSERT/DELETE here and every
 *    `visibility` UPDATE on `owner_id = principal.userId`.
 */

/** Shared-with rows for a person node. */
export const personShares = pgTable('person_shares', {
  personId: uuid('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => [
  // Composite PK: one grant per (entity, member), uniqueness enforced by the
  // same index B6 probes.
  primaryKey({ columns: [table.personId, table.memberId] }),
  // "Everything shared with me" — the reverse direction of the PK.
  index('person_shares_member_id_idx').on(table.memberId),
]);

/** Shared-with rows for an interaction edge. */
export const interactionShares = pgTable('interaction_shares', {
  interactionId: uuid('interaction_id').notNull().references(() => interactions.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => [
  primaryKey({ columns: [table.interactionId, table.memberId] }),
  index('interaction_shares_member_id_idx').on(table.memberId),
]);

/** Shared-with rows for a relationship edge. */
export const relationshipShares = pgTable('relationship_shares', {
  relationshipId: uuid('relationship_id').notNull().references(() => relationships.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => [
  primaryKey({ columns: [table.relationshipId, table.memberId] }),
  index('relationship_shares_member_id_idx').on(table.memberId),
]);

/** Shared-with rows for a reminder edge. */
export const reminderShares = pgTable('reminder_shares', {
  reminderId: uuid('reminder_id').notNull().references(() => reminders.id, { onDelete: 'cascade' }),
  memberId: uuid('member_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => [
  primaryKey({ columns: [table.reminderId, table.memberId] }),
  index('reminder_shares_member_id_idx').on(table.memberId),
]);

export type PersonShare = typeof personShares.$inferSelect;
export type NewPersonShare = typeof personShares.$inferInsert;
export type InteractionShare = typeof interactionShares.$inferSelect;
export type NewInteractionShare = typeof interactionShares.$inferInsert;
export type RelationshipShare = typeof relationshipShares.$inferSelect;
export type NewRelationshipShare = typeof relationshipShares.$inferInsert;
export type ReminderShare = typeof reminderShares.$inferSelect;
export type NewReminderShare = typeof reminderShares.$inferInsert;
