import { pgTable, text, uuid, timestamp, boolean, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { people } from './people.js';

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
}, (table) => [
  unique().on(table.fromPersonId, table.toPersonId),
  check('relationships_type_check', sql`${table.type} IN ('friend', 'family', 'colleague', 'acquaintance', 'other')`),
  check('relationships_no_self_link', sql`${table.fromPersonId} <> ${table.toPersonId}`),
]);

export type Relationship = typeof relationships.$inferSelect;
export type NewRelationship = typeof relationships.$inferInsert;
