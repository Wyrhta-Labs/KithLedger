import { db } from '../db/index.js';
import { people } from '../db/schema/index.js';
import { eq, ilike, and, or, sql, asc, desc } from 'drizzle-orm';
import type { CreatePersonInput, UpdatePersonInput, ListPeopleQuery } from '../validators/people.js';
import {
  PEOPLE_SCOPE,
  PERSON_SHARE_TARGET,
  NOT_OWNER,
  canDelete,
  deletableBy,
  ownerFor,
  ownsRow,
  replaceShareSet,
  visibleTo,
  type Scope,
} from './scope.js';

/**
 * ADR 0004 enforcement (task B6). Every read below is filtered by
 * {@link visibleTo}; the count reuses the very same `where` as its rows, since
 * a total of 5 when you can see 3 leaks exactly as much as showing the hidden
 * 2 (§3.4). An item outside the scope is NOT FOUND, never forbidden (§3.1) —
 * a 403 would confirm it exists.
 */

export async function listPeople(scope: Scope, query: ListPeopleQuery) {
  let baseQuery = db.select().from(people).$dynamic();

  // ADR 0004: the scope predicate is a condition like any other, so it cannot
  // be lost by a filter combination — it is present even when `conditions`
  // would otherwise be empty.
  const conditions = [visibleTo(PEOPLE_SCOPE, scope)];

  if (query.q) {
    conditions.push(
      or(
        ilike(people.name, `%${query.q}%`),
        ilike(people.email, `%${query.q}%`)
      )!
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

  // AND, matching the other three list services: supplying more filters must
  // narrow the result. OR-ing them widened it, so `?q=jane&birthday_month=3`
  // returned everyone named jane *plus* everyone born in March.
  const where = and(...conditions);
  baseQuery = baseQuery.where(where);

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

  // The count must honour the same filters — including the scope predicate —
  // or `total` describes a different result set than `rows`.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(people)
    .where(where);

  return { rows, total: count, limit, offset };
}

export async function getPerson(scope: Scope, id: string) {
  const [row] = await db
    .select()
    .from(people)
    .where(and(eq(people.id, id), visibleTo(PEOPLE_SCOPE, scope)))
    .limit(1);
  return row ?? null;
}

/**
 * Existence pre-check for the edge services (ADR 0004 §3.1). Deliberately
 * scoped: a person you cannot see must be indistinguishable from a person who
 * does not exist, so `POST /interactions` with someone else's private person
 * must 404 exactly like a random uuid does.
 */
export async function personVisible(scope: Scope, id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, id), visibleTo(PEOPLE_SCOPE, scope)))
    .limit(1);
  return !!row;
}

export async function createPerson(scope: Scope, input: CreatePersonInput) {
  const ownerId = ownerFor(scope);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(people)
      .values({
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        birthday: input.birthday ?? null,
        tags: input.tags ?? [],
        notes: input.notes ?? null,
        avatarUrl: input.avatarUrl ?? null,
        // ADR 0004 §4: the creator owns what they create, and `visibility`
        // omitted means the column default (`household`).
        ownerId,
        // B9: the creator IS the last writer at insert time.
        updatedBy: ownerId,
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      })
      .returning();
    if (!row) throw new Error('Failed to create person');
    if (input.sharedWith) {
      await replaceShareSet(tx, PERSON_SHARE_TARGET, row.id, input.sharedWith);
    }
    return row;
  });
}

export async function updatePerson(scope: Scope, id: string, input: UpdatePersonInput) {
  // B9: the acting principal, stamped as `updated_by` below. `ownerFor` is
  // also the read-only-scope refusal — the household dashboard principal has
  // no member id, so it cannot be the author of a write.
  const actor = ownerFor(scope);

  const current = await getPerson(scope, id);
  if (!current) return null;

  // ADR 0004 §4 — only the OWNER may change `visibility` or the share set, and
  // sharing is not transitive. Content edits deliberately follow read scope
  // (see the module note in `scope.ts`): if you can see it you may correct it,
  // but you may never change who else can.
  if ((input.visibility !== undefined || input.sharedWith !== undefined)
      && !ownsRow(scope, current.ownerId)) {
    throw new Error(NOT_OWNER);
  }

  const updates: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actor };
  if (input.name !== undefined) updates['name'] = input.name;
  if (input.email !== undefined) updates['email'] = input.email;
  if (input.phone !== undefined) updates['phone'] = input.phone;
  if (input.birthday !== undefined) updates['birthday'] = input.birthday;
  if (input.tags !== undefined) updates['tags'] = input.tags;
  if (input.notes !== undefined) updates['notes'] = input.notes;
  if (input.avatarUrl !== undefined) updates['avatarUrl'] = input.avatarUrl;
  if (input.visibility !== undefined) updates['visibility'] = input.visibility;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(people)
      .set(updates)
      // The scope predicate again, not just the id: the visibility could have
      // changed between the check above and this statement.
      .where(and(eq(people.id, id), visibleTo(PEOPLE_SCOPE, scope)))
      .returning();
    if (!row) return null;
    if (input.sharedWith !== undefined) {
      await replaceShareSet(tx, PERSON_SHARE_TARGET, id, input.sharedWith);
    }
    return row;
  });
}

/**
 * ADR 0004 §4 (task B9). Delete is NARROWER than read and narrower than a
 * content edit: `household` items may be removed by any member, but a
 * `private` or `shared` one only by its owner. See {@link deletableBy} for the
 * argument. The 404 / 403 split is deliberate and is not a §3.1 leak — an item
 * outside the scope is `null` here and 404s at the route exactly as a
 * non-existent id does, while `NOT_OWNER` is thrown only for an item the
 * caller can already see.
 */
export async function deletePerson(scope: Scope, id: string) {
  ownerFor(scope);

  const current = await getPerson(scope, id);
  if (!current) return null;
  if (!canDelete(scope, current)) throw new Error(NOT_OWNER);

  const [row] = await db
    .delete(people)
    // Both predicates again, on the statement itself: the row could have been
    // flipped `household` -> `private` between the check above and here.
    .where(and(eq(people.id, id), visibleTo(PEOPLE_SCOPE, scope), deletableBy(PEOPLE_SCOPE, scope)))
    .returning();
  return row ?? null;
}
