import { sign } from 'hono/jwt';
import { eq } from 'drizzle-orm';
import { config } from '../src/config/env.js';
import { identity } from '../src/identity.js';
import type { CredentialKind } from '../src/services/credentials.js';
import { db } from '../src/db/index.js';
import { users, householdMembers } from '../src/db/schema/index.js';

/**
 * Callers for the visibility model (B6, ADR 0004).
 *
 * Before B6 the suite signed a token with `sub: 'admin'` and no `users` row
 * existed at all — `setup.ts` truncates `users` between tests and nothing
 * re-seeded it. That worked only because nothing referenced the caller. Now
 * every insert stamps `owner_id` (FK -> `users.id`, NOT NULL), so a test
 * caller has to be a real row, and "who is calling" has to be something a test
 * can vary. Hence: real rows, stable ids, one helper per kind of caller.
 */

/** The locally authored admin — no `household_members` row, per B4. */
export const LOCAL_ADMIN_ID = '00000000-0000-4000-8000-00000000ad11';

/** Two distinct household members, so "someone else" is expressible. */
export const MEMBER_A_ID = '00000000-0000-4000-8000-0000000000a1';
export const MEMBER_B_ID = '00000000-0000-4000-8000-0000000000b2';
/** A member provisioned LATER, to prove `household` reaches future members. */
export const MEMBER_C_ID = '00000000-0000-4000-8000-0000000000c3';

/** Not an argon2 hash: these accounts exist to be owners, never to log in. */
const TEST_PASSWORD_HASH = '!test-fixture:no-local-password';

/** Create (idempotently) a locally authored account and return its id. */
export async function ensureLocalAdmin(id = LOCAL_ADMIN_ID): Promise<string> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  if (existing) return existing.id;
  await db.insert(users).values({
    id,
    email: `${id}@kithledger.test`,
    handle: `admin-${id.slice(-4)}`,
    passwordHash: TEST_PASSWORD_HASH,
    role: 'admin',
    displayName: 'Test Administrator',
  }).onConflictDoNothing();
  return id;
}

/**
 * Create (idempotently) a Heorth-authored household member and return its id.
 * The `household_members` row is what distinguishes it from the local admin.
 */
export async function ensureMember(id: string, role: 'admin' | 'adult' | 'child' = 'adult'): Promise<string> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  if (!existing) {
    await db.insert(users).values({
      id,
      email: `${id}@heorth.invalid`,
      handle: `heorth-${id}`,
      passwordHash: TEST_PASSWORD_HASH,
      role,
      displayName: null,
    }).onConflictDoNothing();
  }
  await db.insert(householdMembers).values({ userId: id }).onConflictDoNothing();
  return id;
}

/** A local HS256 token for `userId` — the path the admin's own login takes. */
export async function jwtFor(userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: userId, iat: now, exp: now + 3600 }, config.jwtSecret);
}

/** Request headers authenticating as `userId` (the local admin by default). */
export async function headersFor(userId: string): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await jwtFor(userId)}`, 'Content-Type': 'application/json' };
}

/** Back-compatible helper: authenticate as the seeded local admin. */
export async function authHeaders(): Promise<Record<string, string>> {
  await ensureLocalAdmin();
  return headersFor(LOCAL_ADMIN_ID);
}

/**
 * Issue a real `kl_` key of one of ADR 0004 §2's three kinds (B8) and return
 * the raw key.
 *
 * A REAL key through the real issuing path, not a fixture row: the whole claim
 * B8 makes is that the kind is decided from the stored credential record, so a
 * test that hand-wrote that record would be testing its own fixture.
 */
export async function issueKeyOfKind(
  kind: CredentialKind,
  ownerId: string = LOCAL_ADMIN_ID,
): Promise<string> {
  await ensureLocalAdmin(ownerId);
  const created = await identity.createApiKey(ownerId, `b8-${kind}`, kind);
  return created.key;
}

/** Request headers presenting a `kl_` key of the given kind. */
export async function keyHeadersOfKind(
  kind: CredentialKind,
  ownerId: string = LOCAL_ADMIN_ID,
): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await issueKeyOfKind(kind, ownerId)}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Assert that a Drizzle statement is rejected BY THE DATABASE, naming the
 * constraint that did it.
 *
 * Plain `.rejects.toThrow(/constraint_name/)` used to work because drizzle
 * re-threw the postgres.js error itself. From drizzle-orm 0.44 on, every driver
 * error is wrapped in a `DrizzleQueryError` whose own message is only
 * `Failed query: <sql>` — the constraint name lives on `cause.message`. Matching
 * the top-level message therefore matches nothing, and relaxing the assertion to
 * a bare `.rejects.toThrow()` would pass for ANY error, including a typo in the
 * test's own SQL. So walk the cause chain and require the pattern somewhere in
 * it: strictly no weaker than before, and it additionally pins the wrapper shape.
 */
export async function expectDbRejection(
  statement: PromiseLike<unknown>,
  pattern: RegExp,
): Promise<void> {
  let thrown: unknown;
  let threw = false;
  try {
    await statement;
  } catch (e: unknown) {
    threw = true;
    thrown = e;
  }
  if (!threw) {
    throw new Error(`Expected the database to reject the statement (${pattern}), but it succeeded.`);
  }

  const messages: string[] = [];
  for (let current: unknown = thrown, depth = 0; depth < 10; depth++) {
    if (typeof current !== 'object' || current === null) break;
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string') messages.push(message);
    if (!('cause' in current)) break;
    current = (current as { cause: unknown }).cause;
  }

  if (!messages.some((m) => pattern.test(m))) {
    throw new Error(
      [
        `Expected ${pattern} somewhere in the rejection's cause chain, but saw:`,
        ...messages.map((m, i) => `  [${i}] ${m}`),
      ].join('\n'),
    );
  }
}
