import { db } from '../db/index.js';
import { relationships, people } from '../db/schema/index.js';
import { eq, or, and, sql, inArray } from 'drizzle-orm';
import type { CreateRelationshipInput, UpdateRelationshipInput, ListRelationshipsQuery } from '../validators/relationships.js';
import { assertActiveSettingValueExists } from './setting-values.js';

interface GraphNode {
  id: string;
  name: string;
  depth: number;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
  isMutual: boolean;
}

function buildGraphResult(
  nodes: Array<{ id: string; name: string }>,
  edges: typeof relationships.$inferSelect[],
  rootPersonId: string,
) {
  const adjacency = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (!adjacency.has(edge.fromPersonId)) adjacency.set(edge.fromPersonId, new Set<string>());
    adjacency.get(edge.fromPersonId)?.add(edge.toPersonId);

    if (edge.isMutual) {
      if (!adjacency.has(edge.toPersonId)) adjacency.set(edge.toPersonId, new Set<string>());
      adjacency.get(edge.toPersonId)?.add(edge.fromPersonId);
    }
  }

  const nodeDepths = new Map<string, number>([[rootPersonId, 0]]);
  const queue = [rootPersonId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) continue;

    const currentDepth = nodeDepths.get(currentId) ?? 0;
    for (const neighborId of adjacency.get(currentId) ?? []) {
      if (nodeDepths.has(neighborId)) continue;
      nodeDepths.set(neighborId, currentDepth + 1);
      queue.push(neighborId);
    }
  }

  const graphNodes: GraphNode[] = nodes.map((node) => ({
    id: node.id,
    name: node.name,
    depth: nodeDepths.get(node.id) ?? 0,
  }));

  const graphEdges: GraphEdge[] = edges.map((edge) => ({
    source: edge.fromPersonId,
    target: edge.toPersonId,
    type: edge.type,
    isMutual: edge.isMutual,
  }));

  return { nodes: graphNodes, edges: graphEdges };
}

function buildGlobalGraphResult(
  nodes: Array<{ id: string; name: string }>,
  edges: typeof relationships.$inferSelect[],
) {
  const graphNodes: GraphNode[] = nodes.map((node) => ({
    id: node.id,
    name: node.name,
    depth: 1,
  }));

  const graphEdges: GraphEdge[] = edges.map((edge) => ({
    source: edge.fromPersonId,
    target: edge.toPersonId,
    type: edge.type,
    isMutual: edge.isMutual,
  }));

  return { nodes: graphNodes, edges: graphEdges };
}

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
  await assertActiveSettingValueExists('relationship.type', input.type);

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
    if (!row) throw new Error('Failed to create relationship');
    return row;
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
  if (input.type !== undefined) {
    await assertActiveSettingValueExists('relationship.type', input.type);
  }

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

    return buildGraphResult(nodes, rels, personId);
  }

  const personIds = new Set<string>([personId]);
  const edgeIds = new Set<string>();
  const edges: typeof relationships.$inferSelect[] = [];
  let frontier = new Set<string>([personId]);

  for (let currentDepth = 1; currentDepth <= safeDepth && frontier.size > 0; currentDepth += 1) {
    const frontierIds = Array.from(frontier);
    const rels = await db
      .select()
      .from(relationships)
      .where(
        or(
          inArray(relationships.fromPersonId, frontierIds),
          and(inArray(relationships.toPersonId, frontierIds), eq(relationships.isMutual, true))
        )!
      );

    const nextFrontier = new Set<string>();

    for (const rel of rels) {
      if (!edgeIds.has(rel.id)) {
        edgeIds.add(rel.id);
        edges.push(rel);
      }

      if (!personIds.has(rel.fromPersonId)) {
        personIds.add(rel.fromPersonId);
        nextFrontier.add(rel.fromPersonId);
      }

      if (!personIds.has(rel.toPersonId)) {
        personIds.add(rel.toPersonId);
        nextFrontier.add(rel.toPersonId);
      }
    }

    frontier = nextFrontier;
  }

  const nodes = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(inArray(people.id, Array.from(personIds)));

  return buildGraphResult(nodes, edges, personId);
}

export async function getGlobalGraph() {
  const [allPeople, allRelationships] = await Promise.all([
    db.select({ id: people.id, name: people.name }).from(people),
    db.select().from(relationships),
  ]);

  return buildGlobalGraphResult(allPeople, allRelationships);
}
