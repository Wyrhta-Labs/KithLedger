import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { interactions, relationships, settingValues } from '../db/schema/index.js';

export const SETTING_CATEGORIES = ['interaction.type', 'relationship.type'] as const;
export type SettingCategory = typeof SETTING_CATEGORIES[number];

export const DEFAULT_SETTING_VALUES: Array<{
  category: SettingCategory;
  value: string;
  label: string;
  sortOrder: number;
}> = [
  { category: 'interaction.type', value: 'meeting', label: 'Meeting', sortOrder: 0 },
  { category: 'interaction.type', value: 'call', label: 'Call', sortOrder: 1 },
  { category: 'interaction.type', value: 'message', label: 'Message', sortOrder: 2 },
  { category: 'interaction.type', value: 'email', label: 'Email', sortOrder: 3 },
  { category: 'interaction.type', value: 'other', label: 'Other', sortOrder: 4 },
  { category: 'relationship.type', value: 'friend', label: 'Friend', sortOrder: 0 },
  { category: 'relationship.type', value: 'family', label: 'Family', sortOrder: 1 },
  { category: 'relationship.type', value: 'colleague', label: 'Colleague', sortOrder: 2 },
  { category: 'relationship.type', value: 'acquaintance', label: 'Acquaintance', sortOrder: 3 },
  { category: 'relationship.type', value: 'other', label: 'Other', sortOrder: 4 },
];

export async function seedDefaultSettingValues() {
  await db.insert(settingValues).values(DEFAULT_SETTING_VALUES).onConflictDoNothing();
}

async function getUsageCounts() {
  const interactionCounts = await db
    .select({
      value: interactions.type,
      usageCount: sql<number>`count(*)::int`,
    })
    .from(interactions)
    .groupBy(interactions.type);

  const relationshipCounts = await db
    .select({
      value: relationships.type,
      usageCount: sql<number>`count(*)::int`,
    })
    .from(relationships)
    .groupBy(relationships.type);

  return new Map<string, number>([
    ...interactionCounts.map((row) => [`interaction.type:${row.value}`, row.usageCount] as const),
    ...relationshipCounts.map((row) => [`relationship.type:${row.value}`, row.usageCount] as const),
  ]);
}

export async function listSettingValues() {
  const [rows, usageCounts] = await Promise.all([
    db
      .select()
      .from(settingValues)
      .orderBy(asc(settingValues.category), asc(settingValues.sortOrder), asc(settingValues.label)),
    getUsageCounts(),
  ]);

  return rows.map((row) => ({
    ...row,
    usageCount: usageCounts.get(`${row.category}:${row.value}`) ?? 0,
  }));
}

export async function assertActiveSettingValueExists(category: SettingCategory, value: string) {
  const [row] = await db
    .select({ id: settingValues.id })
    .from(settingValues)
    .where(and(
      eq(settingValues.category, category),
      eq(settingValues.value, value),
      eq(settingValues.isActive, true),
    ))
    .limit(1);

  if (!row) {
    throw new Error('INVALID_SETTING_VALUE');
  }
}

async function nextSortOrder(category: SettingCategory) {
  const [row] = await db
    .select({
      nextValue: sql<number>`coalesce(max(${settingValues.sortOrder}), -1) + 1`,
    })
    .from(settingValues)
    .where(eq(settingValues.category, category));

  return row?.nextValue ?? 0;
}

export async function createSettingValue(input: {
  category: SettingCategory;
  value: string;
  label: string;
  isActive?: boolean;
  sortOrder?: number;
}) {
  const [row] = await db
    .insert(settingValues)
    .values({
      category: input.category,
      value: input.value,
      label: input.label,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? await nextSortOrder(input.category),
    })
    .returning();

  return row ?? null;
}

export async function updateSettingValue(id: string, input: {
  value?: string;
  label?: string;
  isActive?: boolean;
  sortOrder?: number;
}) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(settingValues)
      .where(eq(settingValues.id, id))
      .limit(1);

    if (!existing) return null;

    const nextValue = input.value ?? existing.value;

    if (nextValue !== existing.value) {
      if (existing.category === 'interaction.type') {
        await tx
          .update(interactions)
          .set({ type: nextValue, updatedAt: new Date() })
          .where(eq(interactions.type, existing.value));
      }

      if (existing.category === 'relationship.type') {
        await tx
          .update(relationships)
          .set({ type: nextValue, updatedAt: new Date() })
          .where(eq(relationships.type, existing.value));
      }
    }

    const [row] = await tx
      .update(settingValues)
      .set({
        updatedAt: new Date(),
        value: nextValue,
        label: input.label ?? existing.label,
        isActive: input.isActive ?? existing.isActive,
        sortOrder: input.sortOrder ?? existing.sortOrder,
      })
      .where(eq(settingValues.id, id))
      .returning();

    return row ?? null;
  });
}

async function getUsageCount(category: SettingCategory, value: string) {
  if (category === 'interaction.type') {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(interactions)
      .where(eq(interactions.type, value));

    return row?.count ?? 0;
  }

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(relationships)
    .where(eq(relationships.type, value));

  return row?.count ?? 0;
}

export async function deleteSettingValue(id: string) {
  const [existing] = await db
    .select()
    .from(settingValues)
    .where(eq(settingValues.id, id))
    .limit(1);

  if (!existing) return null;

  const usageCount = await getUsageCount(existing.category as SettingCategory, existing.value);
  if (usageCount > 0) {
    throw new Error('SETTING_VALUE_IN_USE');
  }

  const [row] = await db
    .delete(settingValues)
    .where(eq(settingValues.id, id))
    .returning();

  return row ?? null;
}
