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
import { err } from '@wyrhta/core/http';
import { logEvent } from '@wyrhta/core/lib';
import type { MiddlewareHandler } from 'hono';
import { JwksClient } from './satellite/jwks.js';
import { withSatelliteAuth, type SatellitePrincipalResolver } from './satellite/auth.js';
import { asHouseholdRole, isHouseholdMember, provisionMember } from './services/members.js';
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
const guards = createAuthGuards({
  jwtSecret: config.jwtSecret,
  keyPrefix: API_KEY_PREFIX,
  resolveApiKey,
});

export const { requireJwt, requireRole } = guards;

/**
 * The JWKS client for Heorth's satellite keys, or `null` when the
 * `HEORTH_JWKS_URL` / `SATELLITE_AUDIENCE` group is absent (the default).
 * Exported so tests and operators can inspect the cache; it holds PUBLIC keys
 * only.
 */
export const satelliteJwks = config.satelliteAuth
  ? new JwksClient({ url: config.satelliteAuth.jwksUrl })
  : null;

/**
 * B1d's seam, filled in by B4: turn a fully verified Heorth member token into
 * a LOCAL principal, provisioning the member's record on first sight.
 *
 * The `sub` becomes the local `users.id` — see `src/services/members.ts` for
 * why that table and not a separate one. Two things are deliberately refused
 * rather than accommodated, both by returning `null` (a 401 from the caller):
 *
 *  - a `role` claim this deployment's enum does not know. The role travels
 *    from the token and is never elevated (ADR 0009); defaulting an unknown
 *    one would be KithLedger inventing an authorization decision Heorth did
 *    not make.
 *  - a `sub` that is not a uuid, or one colliding with a locally authored
 *    account.
 */
export const satellitePrincipalResolver: SatellitePrincipalResolver = async (
  principal,
  claims,
) => {
  const role = asHouseholdRole(principal.role);
  if (!role) {
    logEvent({
      event: 'satellite.member.rejected',
      user_id: claims.sub,
      success: false,
      reason: 'unknown_role',
    });
    return null;
  }
  const userId = await provisionMember(claims.sub, role);
  if (!userId) return null;
  return { type: principal.type, userId, role };
};

/**
 * The single auth entry point every route uses.
 *
 * With the satellite group configured, a Bearer JWT signed with an ASYMMETRIC
 * algorithm — the only kind Heorth mints (ADR 0009) — is verified against
 * Heorth's published public keys; `kl_` API keys and the local HS256 admin
 * token take the existing core path untouched. Unconfigured, this IS the
 * existing core path: `withSatelliteAuth` is never applied.
 *
 * KithLedger holds no key that could sign a satellite token, here or
 * anywhere: `config.jwtSecret` is HS256 and only ever verifies/mints the local
 * admin token, and the satellite side has public key material exclusively.
 */
export const requireAuth: MiddlewareHandler =
  config.satelliteAuth && satelliteJwks
    ? withSatelliteAuth(guards.requireAuth, {
        config: config.satelliteAuth,
        jwks: satelliteJwks,
        keyPrefix: API_KEY_PREFIX,
        resolvePrincipal: satellitePrincipalResolver,
      })
    : guards.requireAuth;

/**
 * Refuse a caller whose account was authored by Heorth (B4).
 *
 * Guards the `kl_` key-management routes. A Heorth-authored member already
 * cannot reach them — `requireJwt` verifies against the local HS256 secret and
 * a Heorth token is asymmetric — so this is belt AND braces, and it is the
 * braces on purpose: `kl_` keys are long-lived local credentials, and the
 * whole point of ADR 0009's 5-minute audience-bound token is that a satellite
 * member's access expires. Letting a member trade one for a key that does not
 * would hand back exactly what the short TTL was for, and would leave a
 * credential behind after Heorth offboards them.
 */
export const requireLocalAccount: MiddlewareHandler = async (c, next) => {
  const principal = c.get('principal');
  if (!principal) return err(c, 'UNAUTHORIZED', 'Authentication required', 401);
  if (await isHouseholdMember(principal.userId)) {
    logEvent({
      event: 'auth.key.forbidden',
      user_id: principal.userId,
      success: false,
      reason: 'household_member',
      request_id: c.get('requestId'),
    });
    return err(c, 'FORBIDDEN', 'API keys are managed by local accounts only', 403);
  }
  return next();
};

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
