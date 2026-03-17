import { db } from '../db/index.js';
import { interactions, people } from '../db/schema/index.js';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import type { CreateInteractionInput, UpdateInteractionInput, ListInteractionsQuery } from '../validators/interactions.js';

export async function listInteractions(query: ListInteractionsQuery) {
  const conditions = [];

  if (query.person_id) conditions.push(eq(interactions.personId, query.person_id));
  if (query.type) conditions.push(eq(interactions.type, query.type));
  if (query.from) conditions.push(gte(interactions.occurredAt, new Date(query.from)));
  if (query.to) conditions.push(lte(interactions.occurredAt, new Date(query.to)));

  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const offset = Math.max(0, query.offset ?? 0);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.select().from(interactions)
    .where(where)
    .orderBy(sql`${interactions.occurredAt} DESC`)
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(interactions)
    .where(where);

  return { rows, total: count, limit, offset };
}

export async function getInteraction(id: string) {
  const [row] = await db.select().from(interactions).where(eq(interactions.id, id)).limit(1);
  return row ?? null;
}

export async function createInteraction(input: CreateInteractionInput) {
  // Verify person exists
  const [person] = await db.select().from(people).where(eq(people.id, input.personId)).limit(1);
  if (!person) throw new Error('PERSON_NOT_FOUND');

  const [row] = await db
    .insert(interactions)
    .values({
      personId: input.personId,
      occurredAt: new Date(input.occurredAt),
      type: input.type,
      channel: input.channel ?? null,
      notes: input.notes ?? null,
      sentiment: input.sentiment ?? null,
    })
    .returning();
  return row!;
}

export async function updateInteraction(id: string, input: UpdateInteractionInput) {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.occurredAt !== undefined) updates['occurredAt'] = new Date(input.occurredAt);
  if (input.type !== undefined) updates['type'] = input.type;
  if (input.channel !== undefined) updates['channel'] = input.channel;
  if (input.notes !== undefined) updates['notes'] = input.notes;
  if (input.sentiment !== undefined) updates['sentiment'] = input.sentiment;

  const [row] = await db.update(interactions).set(updates).where(eq(interactions.id, id)).returning();
  return row ?? null;
}

export async function deleteInteraction(id: string) {
  const [row] = await db.delete(interactions).where(eq(interactions.id, id)).returning();
  return row ?? null;
}
