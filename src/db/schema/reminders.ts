import { pgTable, text, uuid, timestamp, check, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { people } from './people.js';

export const reminders = pgTable('reminders', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  /** Cascade delete: removing the parent person deletes all their reminders */
  personId: uuid('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  title: text('title').notNull(),
  notes: text('notes'),
  kind: text('kind').notNull().default('manual'),
  isHidden: boolean('is_hidden').notNull().default(false),
  status: text('status').notNull().default('pending'),
  snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
  recurrence: text('recurrence'),
}, (table) => [
  check('reminders_status_check', sql`${table.status} IN ('pending', 'done', 'snoozed', 'dismissed')`),
  check('reminders_kind_check', sql`${table.kind} IN ('manual', 'birthday')`),
  uniqueIndex('reminders_birthday_person_unique').on(table.personId).where(sql`${table.kind} = 'birthday'`),
]);

export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;
