import { eq } from 'drizzle-orm';
import {
  users,
  apiKeys,
  createUser,
  authenticate,
  issueToken,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  validateApiKey,
  type User,
  type Role,
} from '@wyrhta/core/identity';
import { createAuthGuards, type Principal } from '@wyrhta/core/auth';
import { db } from './db/index.js';
import { config } from './config/env.js';

/**
 * `@wyrhta/core` does NOT export a `createIdentityService`/factory — its
 * identity module is a set of standalone functions taking `db` as their
 * first argument, and `validateApiKey` is a DB-agnostic key-hash validator
 * that takes a `lookup` closure. This module is the single place that
 * partially-applies those functions against KithLedger's `db` + `config`,
 * and assembles the `resolveApiKey` bridge that `createAuthGuards` needs.
 *
 * Also note: core's `createApiKey` returns the raw key under `key`, not
 * `raw` (verified by reading dist/identity/service.js).
 */

/** KithLedger keeps the historical API-key prefix. */
export const API_KEY_PREFIX = 'kl_';

/** Single-user deployment: one seeded admin identifies the whole instance. */
export const ADMIN_EMAIL = 'admin@kithledger.local';
export const ADMIN_HANDLE = 'admin';

/** Resolve a raw API key to the authenticated principal (used by the auth guards). */
async function resolveApiKey(raw: string): Promise<Principal | null> {
  const keyRow = await validateApiKey(raw, async (hash) => {
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1);
    return row ?? null;
  });
  if (!keyRow) return null;

  const [user] = await db.select().from(users).where(eq(users.id, keyRow.userId)).limit(1);
  if (!user) return null;

  return { type: 'api_key', userId: user.id, role: user.role };
}

/** Core identity functions, partially applied over KithLedger's db + config. */
export const identity = {
  createUser: (input: Parameters<typeof createUser>[1]) => createUser(db, input),
  authenticate: (email: string, password: string) => authenticate(db, email, password),
  issueToken: (user: { id: string; role: Role }, ttlSeconds: number = config.jwtTtlSeconds) =>
    issueToken(user, config.jwtSecret, ttlSeconds),
  createApiKey: (userId: string, name: string, prefix: string = API_KEY_PREFIX) =>
    createApiKey(db, userId, name, prefix),
  listApiKeys: (userId: string) => listApiKeys(db, userId),
  revokeApiKey: (userId: string, keyId: string) => revokeApiKey(db, userId, keyId),
  validateApiKey: resolveApiKey,
};

/** Core auth guards, wired to the same secret + key-resolution bridge. */
export const { requireAuth, requireJwt, requireRole } = createAuthGuards({
  jwtSecret: config.jwtSecret,
  keyPrefix: API_KEY_PREFIX,
  resolveApiKey,
});

/** Idempotently seed the single admin user from ADMIN_PASSWORD (first boot). */
export async function seedAdmin(): Promise<void> {
  const [existing] = await db.select().from(users).where(eq(users.handle, ADMIN_HANDLE)).limit(1);
  if (existing) return;
  await identity.createUser({
    email: ADMIN_EMAIL,
    handle: ADMIN_HANDLE,
    password: config.adminPassword,
    role: 'admin',
    displayName: 'Administrator',
  });
}

/** Resolve the single admin user; throws if the instance was never seeded. */
export async function getAdminUser(): Promise<User> {
  const [row] = await db.select().from(users).where(eq(users.handle, ADMIN_HANDLE)).limit(1);
  if (!row) throw new Error('Admin user not seeded — run seedAdmin() at startup');
  return row;
}

export type { User };
