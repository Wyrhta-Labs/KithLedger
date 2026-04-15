import { pgTable, text, uuid, timestamp, boolean, integer, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const settingValues = pgTable('setting_values', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  category: text('category').notNull(),
  value: text('value').notNull(),
  label: text('label').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
}, (table) => [
  unique('setting_values_category_value_unique').on(table.category, table.value),
  check(
    'setting_values_category_check',
    sql`${table.category} IN ('interaction.type', 'relationship.type')`
  ),
]);

export type SettingValue = typeof settingValues.$inferSelect;
export type NewSettingValue = typeof settingValues.$inferInsert;
