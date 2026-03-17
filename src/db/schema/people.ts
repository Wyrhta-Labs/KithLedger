import { pgTable, text, uuid, timestamp, date } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
});

export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
