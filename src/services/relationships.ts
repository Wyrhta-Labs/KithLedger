import { db } from '../db/index.js';
import { relationships, people } from '../db/schema/index.js';
import { eq, or, and, sql } from 'drizzle-orm';
import type { CreateRelationshipInput, UpdateRelationshipInput, ListRelationshipsQuery } from '../validators/relationships.js';

export async function listRelationships(query: ListRelationshipsQuery) {
  const conditions = [];

  if (query.person_id) {
    conditions.push(
      or(
        eq(relationships.fromPersonId, query.person_id),
        and(eq(relationships.toPersonId, query.person_id), eq(relationships.isMutual, true))
      )!
    );
  }

  if (query.type) conditions.push(eq(relationships.type, query.type));

  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const offset = Math.max(0, query.offset ?? 0);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.select().from(relationships)
    .where(where)
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(relationships)
    .where(where);

  return { rows, total: count, limit, offset };
}

export async function getRelationship(id: string) {
  const [row] = await db.select().from(relationships).where(eq(relationships.id, id)).limit(1);
  return row ?? null;
}

export async function createRelationship(input: CreateRelationshipInput) {
  // Verify both people exist
  const [from] = await db.select().from(people).where(eq(people.id, input.fromPersonId)).limit(1);
  if (!from) throw new Error('FROM_PERSON_NOT_FOUND');

  const [to] = await db.select().from(people).where(eq(people.id, input.toPersonId)).limit(1);
  if (!to) throw new Error('TO_PERSON_NOT_FOUND');

  try {
    const [row] = await db
      .insert(relationships)
      .values({
        fromPersonId: input.fromPersonId,
        toPersonId: input.toPersonId,
        type: input.type,
        label: input.label ?? null,
        isMutual: input.isMutual ?? true,
        notes: input.notes ?? null,
      })
      .returning();
    return row!;
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === '23505'
    ) {
      throw new Error('RELATIONSHIP_EXISTS');
    }
    throw error;
  }
}

export async function updateRelationship(id: string, input: UpdateRelationshipInput) {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.type !== undefined) updates['type'] = input.type;
  if (input.label !== undefined) updates['label'] = input.label;
  if (input.isMutual !== undefined) updates['isMutual'] = input.isMutual;
  if (input.notes !== undefined) updates['notes'] = input.notes;

  const [row] = await db.update(relationships).set(updates).where(eq(relationships.id, id)).returning();
  return row ?? null;
}

export async function deleteRelationship(id: string) {
  const [row] = await db.delete(relationships).where(eq(relationships.id, id)).returning();
  return row ?? null;
}

export async function getPersonGraph(personId: string, depth: number) {
  // Verify root person exists
  const [root] = await db.select().from(people).where(eq(people.id, personId)).limit(1);
  if (!root) return null;

  if (depth === 1) {
    // Simple join for depth 1
    const rels = await db.select().from(relationships).where(
      or(
        eq(relationships.fromPersonId, personId),
        and(eq(relationships.toPersonId, personId), eq(relationships.isMutual, true))
      )!
    );

    const personIds = new Set<string>([personId]);
    for (const rel of rels) {
      personIds.add(rel.fromPersonId);
      personIds.add(rel.toPersonId);
    }

    const nodes = await db.select({ id: people.id, name: people.name })
      .from(people)
      .where(sql`${people.id} = ANY(${Array.from(personIds)})`);

    return { nodes, edges: rels };
  }

  // For depth 2-3, use recursive CTE
  const result = await db.execute(sql`
    WITH RECURSIVE graph AS (
      -- Base: relationships involving root person
      SELECT r.*, 1 as depth
      FROM relationships r
      WHERE r.from_person_id = ${personId}
         OR (r.to_person_id = ${personId} AND r.is_mutual = true)

      UNION

      -- Recursive: next-hop neighbors
      SELECT r2.*, g.depth + 1
      FROM relationships r2
      INNER JOIN graph g ON (
        r2.from_person_id IN (g.from_person_id, g.to_person_id)
        OR (r2.to_person_id IN (g.from_person_id, g.to_person_id) AND r2.is_mutual = true)
      )
      WHERE g.depth < ${depth}
    )
    SELECT DISTINCT ON (id) * FROM graph
  `);

  const edges = result as unknown as typeof relationships.$inferSelect[];

  const personIds = new Set<string>([personId]);
  for (const rel of edges) {
    personIds.add(rel.fromPersonId);
    personIds.add(rel.toPersonId);
  }

  const nodes = await db.select({ id: people.id, name: people.name })
    .from(people)
    .where(sql`${people.id} = ANY(${Array.from(personIds)})`);

  return { nodes, edges };
}
