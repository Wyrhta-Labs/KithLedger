import { pgTable, text, uuid, timestamp, integer, check, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { people } from './people.js';
import { ownerIdColumn, visibilityColumn, visibilityCheck } from './visibility.js';

export const reminders = pgTable('reminders', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  /** Cascade delete: removing the parent person deletes all their reminders */
  personId: uuid('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  title: text('title').notNull(),
  notes: text('notes'),
  status: text('status').notNull().default('pending'),
  snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
  recurrence: text('recurrence'),
  /**
   * Distinguishes a generated birthday reminder from an ordinary one, so the
   * dashboard's birthday widget can tell which birthdays are already tracked.
   * Not settable via PATCH â€” see updateReminderSchema.
   */
  kind: text('kind').notNull().default('generic'),
  /**
   * Days before the birthday this reminder fires. NULL unless kind='birthday'.
   * Stored so completion can recompute the next occurrence from the person's
   * current birthday rather than blindly adding P1Y, which is off by a day
   * across leap years for any non-zero lead.
   */
  leadDays: integer('lead_days'),
  /**
   * ADR 0004 §1 — a reminder is an EDGE/property hanging off a person node,
   * independently owned and independently visible. See `visibility.ts`.
   */
  ownerId: ownerIdColumn(),
  visibility: visibilityColumn(),
}, (table) => [
  visibilityCheck('reminders', table.visibility),
  index('reminders_owner_id_idx').on(table.ownerId),
  check('reminders_status_check', sql`${table.status} IN ('pending', 'done', 'snoozed', 'dismissed')`),
  check('reminders_kind_check', sql`${table.kind} IN ('generic', 'birthday')`),
]);

export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;
