import { pgTable, text, uuid, timestamp, check, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { people } from './people.js';
import { ownerIdColumn, updatedByColumn, visibilityColumn, visibilityCheck } from './visibility.js';

export const interactions = pgTable('interactions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  /** Cascade delete: removing the parent person deletes all their interactions */
  personId: uuid('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  type: text('type').notNull(),
  channel: text('channel'),
  notes: text('notes'),
  sentiment: text('sentiment'),
  /**
   * ADR 0004 §1 — an interaction is an EDGE/property hanging off a person
   * node, and its visibility is independent of that person's: a
   * household-visible person can carry an owner-only note. See
   * `visibility.ts`.
   */
  ownerId: ownerIdColumn(),
  visibility: visibilityColumn(),
  /**
   * ADR 0004 §4 / B9 — WHO last wrote this row. Provenance only; see
   * `visibility.ts` for the semantics and for why this one is SET NULL
   * where `owner_id` is RESTRICT.
   */
  updatedBy: updatedByColumn(),
}, (table) => [
  visibilityCheck('interactions', table.visibility),
  index('interactions_owner_id_idx').on(table.ownerId),
  check('interactions_type_check', sql`${table.type} IN ('meeting', 'call', 'message', 'email', 'other')`),
  check('interactions_sentiment_check', sql`${table.sentiment} IS NULL OR ${table.sentiment} IN ('positive', 'neutral', 'negative')`),
]);

export type Interaction = typeof interactions.$inferSelect;
export type NewInteraction = typeof interactions.$inferInsert;
