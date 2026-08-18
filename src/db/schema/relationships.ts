import { pgTable, text, uuid, timestamp, boolean, unique, check, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { people } from './people.js';
import { ownerIdColumn, updatedByColumn, visibilityColumn, visibilityCheck } from './visibility.js';

export const relationships = pgTable('relationships', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  /** Cascade delete: removing either person deletes this relationship */
  fromPersonId: uuid('from_person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  /** Cascade delete: removing either person deletes this relationship */
  toPersonId: uuid('to_person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  label: text('label'),
  isMutual: boolean('is_mutual').notNull().default(true),
  notes: text('notes'),
  /**
   * ADR 0004 §1 — a relationship is the graph's person-to-person EDGE, and
   * its visibility is independent of BOTH endpoints. Two household-visible
   * people can be joined by an edge only its owner sees; ADR 0004 §3.2 then
   * says the edge is returned only when the endpoints are visible too. See
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
  visibilityCheck('relationships', table.visibility),
  index('relationships_owner_id_idx').on(table.ownerId),
  unique().on(table.fromPersonId, table.toPersonId),
  check('relationships_type_check', sql`${table.type} IN ('friend', 'family', 'colleague', 'acquaintance', 'other')`),
  check('relationships_no_self_link', sql`${table.fromPersonId} <> ${table.toPersonId}`),
]);

export type Relationship = typeof relationships.$inferSelect;
export type NewRelationship = typeof relationships.$inferInsert;
