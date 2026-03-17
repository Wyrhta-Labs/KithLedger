import { pgTable, text, uuid, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { people } from './people.js';

export const interactions = pgTable('interactions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  personId: uuid('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  type: text('type').notNull(),
  channel: text('channel'),
  notes: text('notes'),
  sentiment: text('sentiment'),
}, (table) => [
  check('interactions_type_check', sql`${table.type} IN ('meeting', 'call', 'message', 'email', 'other')`),
  check('interactions_sentiment_check', sql`${table.sentiment} IS NULL OR ${table.sentiment} IN ('positive', 'neutral', 'negative')`),
]);

export type Interaction = typeof interactions.$inferSelect;
export type NewInteraction = typeof interactions.$inferInsert;
