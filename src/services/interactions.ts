import { db } from '../db/index.js';
import { interactions } from '../db/schema/index.js';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import type { CreateInteractionInput, UpdateInteractionInput, ListInteractionsQuery } from '../validators/interactions.js';
import { personVisible } from './people.js';
import {
  INTERACTIONS_SCOPE,
  INTERACTION_SHARE_TARGET,
  NOT_OWNER,
  ownerFor,
  ownsRow,
  replaceShareSet,
  visibleTo,
  type Scope,
} from './scope.js';

export async function listInteractions(scope: Scope, query: ListInteractionsQuery) {
  const conditions = [visibleTo(INTERACTIONS_SCOPE, scope)];

  if (query.person_id) conditions.push(eq(interactions.personId, query.person_id));
  if (query.type) conditions.push(eq(interactions.type, query.type));
  if (query.from) conditions.push(gte(interactions.occurredAt, new Date(query.from)));
  if (query.to) conditions.push(lte(interactions.occurredAt, new Date(query.to)));

  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const offset = Math.max(0, query.offset ?? 0);

  const where = and(...conditions);

  const rows = await db.select().from(interactions)
    .where(where)
    .orderBy(sql`${interactions.occurredAt} DESC`)
    .limit(limit)
    .offset(offset);

  // Same `where` as the rows: ADR 0004 §3.4.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(interactions)
    .where(where);

  return { rows, total: count, limit, offset };
}

export async function getInteraction(scope: Scope, id: string) {
  const [row] = await db
    .select()
    .from(interactions)
    .where(and(eq(interactions.id, id), visibleTo(INTERACTIONS_SCOPE, scope)))
    .limit(1);
  return row ?? null;
}

export async function createInteraction(scope: Scope, input: CreateInteractionInput) {
  const ownerId = ownerFor(scope);

  // ADR 0004 §3.1 — the pre-check is SCOPED. An unscoped probe would answer
  // "does this person exist" for people the caller cannot see, which is the
  // existence leak the ADR forbids; a person outside the scope 404s exactly
  // like a person who never existed.
  if (!(await personVisible(scope, input.personId))) throw new Error('PERSON_NOT_FOUND');

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(interactions)
      .values({
        personId: input.personId,
        occurredAt: new Date(input.occurredAt),
        type: input.type,
        channel: input.channel ?? null,
        notes: input.notes ?? null,
        sentiment: input.sentiment ?? null,
        ownerId,
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      })
      .returning();
    if (!row) throw new Error('Failed to create interaction');
    if (input.sharedWith) {
      await replaceShareSet(tx, INTERACTION_SHARE_TARGET, row.id, input.sharedWith);
    }
    return row;
  });
}

export async function updateInteraction(scope: Scope, id: string, input: UpdateInteractionInput) {
  ownerFor(scope);

  const current = await getInteraction(scope, id);
  if (!current) return null;
  if ((input.visibility !== undefined || input.sharedWith !== undefined)
      && !ownsRow(scope, current.ownerId)) {
    throw new Error(NOT_OWNER);
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.occurredAt !== undefined) updates['occurredAt'] = new Date(input.occurredAt);
  if (input.type !== undefined) updates['type'] = input.type;
  if (input.channel !== undefined) updates['channel'] = input.channel;
  if (input.notes !== undefined) updates['notes'] = input.notes;
  if (input.sentiment !== undefined) updates['sentiment'] = input.sentiment;
  if (input.visibility !== undefined) updates['visibility'] = input.visibility;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(interactions)
      .set(updates)
      .where(and(eq(interactions.id, id), visibleTo(INTERACTIONS_SCOPE, scope)))
      .returning();
    if (!row) return null;
    if (input.sharedWith !== undefined) {
      await replaceShareSet(tx, INTERACTION_SHARE_TARGET, id, input.sharedWith);
    }
    return row;
  });
}

export async function deleteInteraction(scope: Scope, id: string) {
  ownerFor(scope);
  const [row] = await db
    .delete(interactions)
    .where(and(eq(interactions.id, id), visibleTo(INTERACTIONS_SCOPE, scope)))
    .returning();
  return row ?? null;
}
