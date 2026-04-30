import { db } from '../db/index.js';
import { people } from '../db/schema/index.js';
import { eq, or, and, sql, asc, desc } from 'drizzle-orm';
import type { CreatePersonInput, UpdatePersonInput, ListPeopleQuery } from '../validators/people.js';
import { syncBirthdayReminderForPerson } from './birthday-reminders.js';

export async function listPeople(query: ListPeopleQuery) {
  let baseQuery = db.select().from(people).$dynamic();

  const conditions = [];

  if (query.q) {
    // Escape LIKE wildcards to prevent SQL injection
    const searchTerm = `%${query.q.replace(/[%_]/g, '\\$&')}%`;
    conditions.push(
      or(
        sql`${people.name} ILIKE ${searchTerm}`,
        sql`${people.email} ILIKE ${searchTerm}`
      )
    );
  }

  if (query.tags) {
    const tagList = query.tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      conditions.push(sql`${people.tags} && ${tagList}`);
    }
  }

  if (query.birthday_month) {
    conditions.push(sql`EXTRACT(MONTH FROM ${people.birthday}) = ${query.birthday_month}`);
  }

  if (conditions.length > 0) {
    baseQuery = baseQuery.where(or(...conditions.map((c) => c!)));
  }

  const orderCol = query.sort === 'created_at'
    ? people.createdAt
    : query.sort === 'updated_at'
    ? people.updatedAt
    : query.sort === 'birthday'
    ? people.birthday
    : people.name;

  baseQuery = baseQuery.orderBy(query.order === 'desc' ? desc(orderCol) : asc(orderCol));

  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const offset = Math.max(0, query.offset ?? 0);

  const rows = await baseQuery.limit(limit).offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(people);

  return { rows, total: count, limit, offset };
}

export async function getPerson(id: string) {
  const [row] = await db.select().from(people).where(eq(people.id, id)).limit(1);
  return row ?? null;
}

export async function createPerson(input: CreatePersonInput) {
  const [row] = await db
    .insert(people)
    .values({
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      birthday: input.birthday ?? null,
      tags: input.tags ?? [],
      notes: input.notes ?? null,
      avatarUrl: input.avatarUrl ?? null,
    })
    .returning();
  if (!row) throw new Error('Failed to create person');
  await syncBirthdayReminderForPerson(row.id, row.name, row.birthday);
  return row;
}

export async function updatePerson(id: string, input: UpdatePersonInput) {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) updates['name'] = input.name;
  if (input.email !== undefined) updates['email'] = input.email;
  if (input.phone !== undefined) updates['phone'] = input.phone;
  if (input.birthday !== undefined) updates['birthday'] = input.birthday;
  if (input.tags !== undefined) updates['tags'] = input.tags;
  if (input.notes !== undefined) updates['notes'] = input.notes;
  if (input.avatarUrl !== undefined) updates['avatarUrl'] = input.avatarUrl;

  const [row] = await db.update(people).set(updates).where(eq(people.id, id)).returning();
  if (row) {
    await syncBirthdayReminderForPerson(row.id, row.name, row.birthday);
  }
  return row ?? null;
}

export async function deletePerson(id: string) {
  const [row] = await db.delete(people).where(eq(people.id, id)).returning();
  return row ?? null;
}
