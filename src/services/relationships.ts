import { db } from '../db/index.js';
import { relationships, people } from '../db/schema/index.js';
import { eq, or, and, sql, inArray } from 'drizzle-orm';
import type { CreateRelationshipInput, UpdateRelationshipInput, ListRelationshipsQuery } from '../validators/relationships.js';
import { personVisible } from './people.js';
import {
  RELATIONSHIPS_SCOPE,
  RELATIONSHIP_SHARE_TARGET,
  NOT_OWNER,
  ownerFor,
  ownsRow,
  replaceShareSet,
  visibleTo,
  type Scope,
} from './scope.js';

export async function listRelationships(scope: Scope, query: ListRelationshipsQuery) {
  const conditions = [visibleTo(RELATIONSHIPS_SCOPE, scope)];

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

  const where = and(...conditions);

  const rows = await db.select().from(relationships)
    .where(where)
    .limit(limit)
    .offset(offset);

  // Same `where` as the rows: ADR 0004 §3.4.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(relationships)
    .where(where);

  return { rows, total: count, limit, offset };
}

export async function getRelationship(scope: Scope, id: string) {
  const [row] = await db
    .select()
    .from(relationships)
    .where(and(eq(relationships.id, id), visibleTo(RELATIONSHIPS_SCOPE, scope)))
    .limit(1);
  return row ?? null;
}

export async function createRelationship(scope: Scope, input: CreateRelationshipInput) {
  const ownerId = ownerFor(scope);

  // ADR 0004 §3.1 — BOTH endpoint checks are scoped. An unscoped probe would
  // turn `POST /relationships` into an oracle for the existence of people the
  // caller cannot see, on either end of the edge.
  if (!(await personVisible(scope, input.fromPersonId))) throw new Error('FROM_PERSON_NOT_FOUND');
  if (!(await personVisible(scope, input.toPersonId))) throw new Error('TO_PERSON_NOT_FOUND');

  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(relationships)
        .values({
          fromPersonId: input.fromPersonId,
          toPersonId: input.toPersonId,
          type: input.type,
          label: input.label ?? null,
          isMutual: input.isMutual ?? true,
          notes: input.notes ?? null,
          ownerId,
          ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        })
        .returning();
      if (!row) throw new Error('Failed to create relationship');
      if (input.sharedWith) {
        await replaceShareSet(tx, RELATIONSHIP_SHARE_TARGET, row.id, input.sharedWith);
      }
      return row;
    });
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

export async function updateRelationship(scope: Scope, id: string, input: UpdateRelationshipInput) {
  ownerFor(scope);

  const current = await getRelationship(scope, id);
  if (!current) return null;
  // ADR 0004 §4 — owner-only governance; sharing is not transitive.
  if ((input.visibility !== undefined || input.sharedWith !== undefined)
      && !ownsRow(scope, current.ownerId)) {
    throw new Error(NOT_OWNER);
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.type !== undefined) updates['type'] = input.type;
  if (input.label !== undefined) updates['label'] = input.label;
  if (input.isMutual !== undefined) updates['isMutual'] = input.isMutual;
  if (input.notes !== undefined) updates['notes'] = input.notes;
  if (input.visibility !== undefined) updates['visibility'] = input.visibility;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(relationships)
      .set(updates)
      .where(and(eq(relationships.id, id), visibleTo(RELATIONSHIPS_SCOPE, scope)))
      .returning();
    if (!row) return null;
    if (input.sharedWith !== undefined) {
      await replaceShareSet(tx, RELATIONSHIP_SHARE_TARGET, id, input.sharedWith);
    }
    return row;
  });
}

export async function deleteRelationship(scope: Scope, id: string) {
  ownerFor(scope);
  const [row] = await db
    .delete(relationships)
    .where(and(eq(relationships.id, id), visibleTo(RELATIONSHIPS_SCOPE, scope)))
    .returning();
  return row ?? null;
}

/**
 * NOT SCOPED YET — task B7 owns ADR 0004 §3's traversal rules (visible
 * endpoints, no pass-through, scoped aggregates), and deliberately not B6.
 * When B7 lands it must apply `visibleTo(PEOPLE_SCOPE, scope, '<alias>')` and
 * `visibleTo(RELATIONSHIPS_SCOPE, scope, '<alias>')` — the SAME predicate the
 * ordinary queries above use — to the root probe, the depth-1 branch, both
 * arms of the recursive CTE and the final node fetch.
 */
export async function getPersonGraph(personId: string, depth: number) {
  // Defense-in-depth: cap beyond the validator's max(3) to prevent runaway CTEs
  const safeDepth = Math.min(depth, 5);
  // Verify root person exists
  const [root] = await db.select().from(people).where(eq(people.id, personId)).limit(1);
  if (!root) return null;

  if (safeDepth === 1) {
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
      .where(inArray(people.id, Array.from(personIds)));

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
      WHERE g.depth < ${safeDepth}
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
    .where(inArray(people.id, Array.from(personIds)));

  return { nodes, edges };
}
