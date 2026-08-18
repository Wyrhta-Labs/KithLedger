import { sign } from 'hono/jwt';
import { eq } from 'drizzle-orm';
import { config } from '../src/config/env.js';
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
