import { describe, it, expect } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { isUniqueViolation } from '@wyrhta/core/identity';
import { db } from '../src/db/index.js';
import { people, relationships } from '../src/db/schema/index.js';
import { ensureLocalAdmin, LOCAL_ADMIN_ID } from './helpers.js';

/**
 * Regression guard for the drizzle-orm 0.39 -> 0.45 upgrade.
 *
 * From 0.44 on, drizzle wraps EVERY driver error in `DrizzleQueryError` and
 * hangs the original postgres.js error — the only thing carrying the Postgres
 * `SQLSTATE` in `code` — off `cause`. Any `error.code === '23505'` check on the
 * top-level error therefore stops matching, silently: `createRelationship`'s
 * catch would fall through to `throw error`, and a duplicate edge would surface
 * as an unhandled 500 instead of the documented 409 CONFLICT.
 *
 * Two halves, both needed:
 *  1. the predicate sees through a REAL `DrizzleQueryError` (not a hand-rolled
 *     `{ code }` object — that shape is exactly what stopped arriving), and
 *  2. the driver really does throw that shape, so half 1 is pinned to
 *     observed behaviour rather than to a belief about this version.
 */
describe('drizzle-orm >= 0.44 error wrapping', () => {
  it('isUniqueViolation sees through the DrizzleQueryError wrapper', () => {
    const violation = Object.assign(new Error('duplicate key value'), { code: '23505' });
    expect(isUniqueViolation(new DrizzleQueryError('insert ...', [], violation))).toBe(true);

    // Only 23505. A foreign-key violation must NOT become a 409.
    const fk = Object.assign(new Error('fk violation'), { code: '23503' });
    expect(isUniqueViolation(new DrizzleQueryError('insert ...', [], fk))).toBe(false);
    expect(isUniqueViolation(new DrizzleQueryError('insert ...', [], undefined))).toBe(false);

    // Pre-0.44 shape and non-errors still answer correctly.
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation(new Error('nope'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });

  it('the postgres driver throws that wrapper for a real UNIQUE violation', async () => {
    const ownerId = await ensureLocalAdmin();
    const [alice] = await db
      .insert(people)
      .values({ name: 'Alice', ownerId, updatedBy: ownerId })
      .returning();
    const [bob] = await db
      .insert(people)
      .values({ name: 'Bob', ownerId, updatedBy: ownerId })
      .returning();

    const edge = {
      fromPersonId: alice!.id,
      toPersonId: bob!.id,
      type: 'friend',
      ownerId,
      updatedBy: ownerId,
    };
    await db.insert(relationships).values(edge);

    const thrown = await db
      .insert(relationships)
      .values(edge)
      .then(() => null, (e: unknown) => e);

    expect(thrown).toBeInstanceOf(DrizzleQueryError);
    // The regression in one assertion: the code is NOT on the error we catch.
    expect((thrown as { code?: unknown }).code).toBeUndefined();
    expect((thrown as { cause?: { code?: unknown } }).cause?.code).toBe('23505');
    expect(isUniqueViolation(thrown)).toBe(true);
    expect(ownerId).toBe(LOCAL_ADMIN_ID);
  });
});
