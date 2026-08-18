import { pgTable, text, uuid, timestamp, date, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ownerIdColumn, visibilityColumn, visibilityCheck } from './visibility.js';

export const people = pgTable('people', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  name: text('name').notNull(),
  email: text('email').unique(),
  phone: text('phone'),
  birthday: date('birthday'),
  tags: text('tags').array().notNull().default(sql`'{}'`),
  notes: text('notes'),
  avatarUrl: text('avatar_url'),
  /**
   * ADR 0004 §1 — `people` are the NODES of the knowledge graph. See
   * `visibility.ts` for the semantics of both columns and for why `owner_id`
   * is nullable until B6.
   */
  ownerId: ownerIdColumn(),
  visibility: visibilityColumn(),
}, (table) => [
  visibilityCheck('people', table.visibility),
  index('people_owner_id_idx').on(table.ownerId),
]);

export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
