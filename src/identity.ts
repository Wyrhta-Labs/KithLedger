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
import {
  credentialKindForKey,
  credentialOf,
  recordCredentialKind,
  type CredentialKind,
  type ScopedPrincipal,
} from './services/credentials.js';
import { READ_ONLY_SCOPE } from './services/scope.js';
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

/**
 * Resolve a raw API key to the authenticated principal (used by the auth
 * guards).
 *
 * B8 (ADR 0004 §2): this is the ONE place a `kl_` key's principal TYPE is
 * decided, and it is decided from the key's own stored record — never from
 * what the request asks for. A key with no `api_key_credentials` row is
 * refused outright rather than treated as a member key: see
 * `src/db/schema/credentials.ts` for why the fail-closed direction matters
 * (the alternative silently WIDENS a household key to a member's full personal
 * scope). Migration `0006` backfills every pre-B8 key as `member`, so existing
 * keys are unaffected.
 */
async function resolveApiKey(raw: string): Promise<Principal | null> {
  const keyRow = await validateApiKey(raw, async (hash) => {
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1);
    return row ?? null;
  });
  if (!keyRow) return null;

  const [user] = await db.select().from(users).where(eq(users.id, keyRow.userId)).limit(1);
  if (!user) return null;

  const credential = await credentialKindForKey(keyRow.id);
  if (!credential) {
    logEvent({
      event: 'auth.key.rejected',
      key_id: keyRow.id,
      user_id: user.id,
      success: false,
      reason: 'no_credential_record',
    });
    return null;
  }

  const principal: ScopedPrincipal = { type: 'api_key', userId: user.id, role: user.role, credential };
  return principal;
}

/** Core identity functions, partially applied over KithLedger's db + config. */
export const identity = {
  createUser: (input: Parameters<typeof createUser>[1]) => createUser(db, input),
  authenticate: (email: string, password: string) => authenticate(db, email, password),
  issueToken: (user: { id: string; role: Role }, ttlSeconds: number = config.jwtTtlSeconds) =>
    issueToken(user, config.jwtSecret, ttlSeconds),
  createApiKey: async (
    userId: string,
    name: string,
    kind: CredentialKind = 'member',
    prefix: string = API_KEY_PREFIX,
  ) => {
    // The key and the record of WHAT KIND of key it is are created together;
    // a key without its record is dead on arrival (`resolveApiKey` refuses
    // it), so the failure mode of the gap between these two statements is an
    // unusable credential, never an over-privileged one.
    const key = await createApiKey(db, userId, name, prefix);
    await recordCredentialKind(key.id, kind);
    return { ...key, kind };
  },
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

/**
 * ADR 0004 §2, enforced at the door of every domain router (task B8).
 *
 * Two refusals, both derived from the credential's own kind and from nothing
 * about the request's contents:
 *
 *  - **The admin / ops key has NO DATA PATH.** Not read, not write, not
 *    counts. It exists for provisioning, migrations, schema and health — none
 *    of which read a person, an interaction, a relationship or a reminder — so
 *    it is refused before a query is even built. 403 and not 404 here, and
 *    that is not a violation of §3.1's "invisible = nonexistent": §3.1 is
 *    about a SPECIFIC item, where a 403 would confirm the item exists. This
 *    refusal is about the whole resource and discloses nothing about any item;
 *    an ops key learns only that it is an ops key, which it already knew.
 *  - **The household dashboard key is READ-ONLY.** Every mutation in this
 *    service is a non-GET, so refusing non-GET refuses create, update, delete,
 *    share, complete, snooze and dismiss in one rule, rather than in N
 *    handlers that each have to remember. `ownerFor()` in
 *    `src/services/scope.ts` refuses the same thing one layer down — it has no
 *    member id to stamp as `owner_id`, so a write is not merely forbidden but
 *    unrepresentable — and the catch below turns that structural refusal into
 *    a 403 rather than a 500 should any future route mutate on a GET.
 *
 * Deliberately NOT role-based: `role === 'admin'` is never consulted anywhere
 * in the access-control path (ADR 0004 §4, no standing god-mode). What a
 * caller may see follows from which credential it presented, and the widest of
 * the three is still only one member's personal scope.
 */
export const requireDataAccess: MiddlewareHandler = async (c, next) => {
  const principal = c.get('principal');
  if (!principal) return err(c, 'UNAUTHORIZED', 'Authentication required', 401);

  const credential = credentialOf(principal);

  if (credential === 'ops') {
    logEvent({
      event: 'auth.credential.forbidden',
      user_id: principal.userId,
      success: false,
      reason: 'ops_credential_has_no_data_access',
      request_id: c.get('requestId'),
    });
    return err(c, 'FORBIDDEN', 'This credential has no access to household data', 403);
  }

  if (credential === 'household' && c.req.method !== 'GET') {
    logEvent({
      event: 'auth.credential.forbidden',
      user_id: principal.userId,
      success: false,
      reason: 'household_credential_is_read_only',
      request_id: c.get('requestId'),
    });
    return err(c, 'FORBIDDEN', 'The household dashboard credential is read-only', 403);
  }

  try {
    await next();
  } catch (e: unknown) {
    if (e instanceof Error && e.message === READ_ONLY_SCOPE) {
      c.res = err(c, 'FORBIDDEN', 'The household dashboard credential is read-only', 403);
      return;
    }
    throw e;
  }
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
