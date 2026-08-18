import { db } from '../db/index.js';
import { relationships, people, type Relationship } from '../db/schema/index.js';
import { eq, or, and, sql, inArray, type SQL } from 'drizzle-orm';
import type { CreateRelationshipInput, UpdateRelationshipInput, ListRelationshipsQuery } from '../validators/relationships.js';
import { personVisible } from './people.js';
import {
  PEOPLE_SCOPE,
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
 * ── THE TRAVERSAL (ADR 0004 §3, task B7) ─────────────────────────────────────
 *
 * §3 is marked "correctness, non-negotiable", and a graph leaks in ways a row
 * filter does not: the *shape* — which edges exist, which paths connect, how
 * many neighbours a person has — discloses hidden items even when the hidden
 * rows themselves are withheld. The four rules, and where each one lives:
 *
 * §3.1 INVISIBLE = NONEXISTENT. The root probe goes through the SCOPED
 *      `personVisible`, so an invisible root returns `null` and the route
 *      renders the same 404 a random uuid gets. There is no 403 anywhere in
 *      this function — a 403 would confirm the person exists.
 *
 * §3.2 EDGE VISIBILITY REQUIRES VISIBLE ENDPOINTS. {@link edgeVisible} is
 *      `visibleTo(relationships) AND <from is a visible person> AND <to is a
 *      visible person>`. `visibleTo` gives per-row visibility only; the
 *      endpoint conjuncts are what stop a dangling edge to a hidden node, and
 *      they are separate from the edge's own visibility because ADR 0004 §1
 *      makes an edge's visibility independent of its endpoints in BOTH
 *      directions.
 *
 * §3.3 NO PASS-THROUGH. This is a property of WHERE the predicate sits, not of
 *      the predicate. `edgeVisible` is applied inside the CTE's base term AND
 *      inside its recursive term, so every row that ever enters `graph` has
 *      two visible endpoints. The recursive term pivots only on
 *      `g.from_person_id` / `g.to_person_id` — i.e. only on nodes that are
 *      already known-visible — so a hidden person can never become a hop, and
 *      `You -> [hidden] -> Cousin` simply has no second hop to take. Filtering
 *      the CTE's OUTPUT instead would traverse through the hidden node first
 *      and surface Cousin, which is the whole failure mode; note also that
 *      `DISTINCT ON (id)` runs on the finished result set, so anything applied
 *      there is too late by construction. Cousin still appears when an
 *      independent visible path reaches her — traversal is terminated, not
 *      blanket-filtered.
 *
 * §3.4 AGGREGATES RESPECT THE FILTER. The response is `{nodes, edges}` with no
 *      counts, and the route's `meta` echoes only the caller's own input
 *      (`root_person_id`, `depth`). Nothing here is a count; if one is ever
 *      added it must be computed over these arrays, not over the table.
 *
 * The node set is filtered SEPARATELY from the edge set, because they come
 * from separate queries: filtering only nodes leaves edges naming hidden ids,
 * filtering only edges hydrates hidden people's names. Both happen, and both
 * use the same {@link visibleTo}.
 */

/**
 * `<person-id expression> is a person visible to `scope`` (ADR 0004 §3.2).
 *
 * A correlated EXISTS rather than a join so it composes into any arm of the
 * CTE without changing its column list or row multiplicity. The alias `gp` is
 * local to the subquery and cannot collide with `r` / `r2` / `g` outside it.
 */
function endpointVisible(scope: Scope, column: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM "people" gp
    WHERE gp."id" = ${column} AND ${visibleTo(PEOPLE_SCOPE, scope, 'gp')}
  )`;
}

/**
 * The complete rule for "this edge is returned to `scope`" (ADR 0004 §3.2),
 * rendered against `alias` so the depth-1 branch, the CTE's base term and the
 * CTE's recursive term apply the IDENTICAL condition. Two implementations of
 * one security rule is how they drift.
 */
function edgeVisible(scope: Scope, alias: string): SQL {
  const t = sql.raw(`"${alias}"`);
  return sql`(
    ${visibleTo(RELATIONSHIPS_SCOPE, scope, alias)}
    AND ${endpointVisible(scope, sql`${t}."from_person_id"`)}
    AND ${endpointVisible(scope, sql`${t}."to_person_id"`)}
  )`;
}

/** The columns the CTE projects, aliased back to the Drizzle row shape. */
const GRAPH_EDGE_COLUMNS = sql`
  id,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  from_person_id AS "fromPersonId",
  to_person_id AS "toPersonId",
  type,
  label,
  is_mutual AS "isMutual",
  notes,
  owner_id AS "ownerId",
  visibility
`;

export async function getPersonGraph(scope: Scope, personId: string, depth: number) {
  // Defense-in-depth: cap beyond the validator's max(3) to prevent runaway CTEs
  const safeDepth = Math.min(depth, 5);

  // ADR 0004 §3.1 — the root probe is SCOPED. An invisible root is reported
  // exactly as a non-existent one: `null` here, 404 at the route.
  if (!(await personVisible(scope, personId))) return null;

  const edges: Relationship[] =
    safeDepth === 1
      ? // Depth 1: a single hop, so the whole rule is one `where`.
        await db
          .select()
          .from(relationships)
          .where(
            and(
              or(
                eq(relationships.fromPersonId, personId),
                and(eq(relationships.toPersonId, personId), eq(relationships.isMutual, true)),
              )!,
              edgeVisible(scope, 'relationships'),
            ),
          )
      : // Depth 2-3: a recursive CTE. `edgeVisible` appears in BOTH arms —
        // see §3.3 above; that is what terminates pass-through inside the
        // traversal rather than after it.
        ((await db.execute(sql`
          WITH RECURSIVE graph AS (
            -- Base: visible edges involving the (visible) root person.
            SELECT r.*, 1 as depth
            FROM relationships r
            WHERE (
                r.from_person_id = ${personId}::uuid
                OR (r.to_person_id = ${personId}::uuid AND r.is_mutual = true)
              )
              AND ${edgeVisible(scope, 'r')}

            UNION

            -- Recursive: next-hop neighbours. The CTE holds only edges whose BOTH
            -- endpoints are visible, so the pivot nodes below are visible by
            -- construction and no hidden person can be routed through.
            SELECT r2.*, g.depth + 1
            FROM relationships r2
            INNER JOIN graph g ON (
              r2.from_person_id IN (g.from_person_id, g.to_person_id)
              OR (r2.to_person_id IN (g.from_person_id, g.to_person_id) AND r2.is_mutual = true)
            )
            WHERE g.depth < ${safeDepth}
              AND ${edgeVisible(scope, 'r2')}
          )
          SELECT DISTINCT ON (id) ${GRAPH_EDGE_COLUMNS} FROM graph
        `)) as unknown as Relationship[]);

  // Node hydration is a SEPARATE query and therefore needs the predicate
  // again (ADR 0004 §3.2). Every endpoint above is already known-visible, so
  // this is defence in depth for the edge set — but it is load-bearing for the
  // root, which is in the id set whether or not it has any visible edge.
  const personIds = new Set<string>([personId]);
  for (const rel of edges) {
    personIds.add(rel.fromPersonId);
    personIds.add(rel.toPersonId);
  }

  const nodes = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(and(inArray(people.id, Array.from(personIds)), visibleTo(PEOPLE_SCOPE, scope)));

  return { nodes, edges };
}
