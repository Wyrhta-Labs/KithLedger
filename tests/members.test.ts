import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { signToken } from '@wyrhta/core/identity';
import { createAuthGuards } from '@wyrhta/core/auth';
import { db } from '../src/db/index.js';
import { users, householdMembers } from '../src/db/schema/index.js';
import { createApp } from '../src/app.js';
import { JwksClient } from '../src/satellite/jwks.js';
import { withSatelliteAuth } from '../src/satellite/auth.js';
import {
  provisionMember,
  isHouseholdMember,
  memberEmail,
  memberHandle,
  UNUSABLE_PASSWORD_HASH,
} from '../src/services/members.js';
import {
  identity,
  satellitePrincipalResolver,
  seedAdmin,
  getAdminUser,
  ADMIN_EMAIL,
  API_KEY_PREFIX,
} from '../src/identity.js';
import { config } from '../src/config/env.js';
import { makeSigningKey, jwksBody, fakeJwksFetch } from './satellite-keys.js';

/**
 * Just-in-time member provisioning (task B4, ADR 0002 phase B / ADR 0009).
 *
 * Members are authored in Heorth alone; a verified token whose `sub` is
 * unknown here creates the local record on that first request. These tests
 * assert the identity that ADR 0004's owner columns (B5) will hang off, and
 * the two invariants that make reusing core's `users` table safe: a
 * provisioned member can never log in locally, and never holds a `kl_` key.
 */

const ISSUER = 'heorth';
const AUDIENCE = 'kithledger';

const app = createApp();

beforeEach(async () => {
  await seedAdmin(); // beforeEach truncation wipes users
});

/** The satellite auth path, wired to the REAL B4 resolver. */
async function satelliteApp(fake: ReturnType<typeof fakeJwksFetch>) {
  const jwks = new JwksClient({ url: 'http://heorth:4000/.well-known/jwks.json', fetch: fake.fetch });
  const local = createAuthGuards({
    jwtSecret: config.jwtSecret,
    keyPrefix: API_KEY_PREFIX,
    resolveApiKey: async () => null,
  });
  const satellite = new Hono();
  satellite.use(
    '*',
    withSatelliteAuth(local.requireAuth, {
      config: { jwksUrl: 'http://heorth:4000/.well-known/jwks.json', issuer: ISSUER, audience: AUDIENCE },
      jwks,
      keyPrefix: API_KEY_PREFIX,
      resolvePrincipal: satellitePrincipalResolver,
    }),
  );
  satellite.get('/probe', (c) => c.json({ principal: c.get('principal') }));
  return satellite;
}

async function memberToken(key: Awaited<ReturnType<typeof makeSigningKey>>, sub: string, role: string) {
  return signToken({ sub, role, iss: ISSUER, aud: AUDIENCE }, key, 300);
}

describe('just-in-time member provisioning', () => {
  it('provisions exactly one member for an unknown sub and reuses it on the next request', async () => {
    const key = await makeSigningKey('sat-a');
    const satellite = await satelliteApp(fakeJwksFetch(jwksBody([key])));
    const sub = randomUUID();
    const token = await memberToken(key, sub, 'adult');

    const first = await satellite.request('/probe', { headers: { Authorization: `Bearer ${token}` } });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ principal: { type: 'jwt', userId: sub, role: 'adult' } });

    const second = await satellite.request('/probe', { headers: { Authorization: `Bearer ${token}` } });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ principal: { type: 'jwt', userId: sub, role: 'adult' } });

    // The local identifier IS Heorth's sub, and there is exactly one of it.
    const rows = await db.select().from(users).where(eq(users.id, sub));
    expect(rows.length).toBe(1);
    expect(rows[0]!.email).toBe(memberEmail(sub));
    expect(rows[0]!.handle).toBe(memberHandle(sub));
    expect(await isHouseholdMember(sub)).toBe(true);

    const members = await db.select().from(householdMembers);
    expect(members.length).toBe(1);
    // The seeded admin is untouched and is NOT a household member.
    const admin = await getAdminUser();
    expect(await isHouseholdMember(admin.id)).toBe(false);
  });

  it('creates one row when concurrent first requests race', async () => {
    const sub = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => provisionMember(sub, 'adult')),
    );

    expect(results.every((id) => id === sub)).toBe(true);
    expect((await db.select().from(users).where(eq(users.id, sub))).length).toBe(1);
    expect((await db.select().from(householdMembers)).length).toBe(1);
  });

  it('never denies a member whose first requests arrive while provisioning is in flight', async () => {
    // The simultaneous burst above misses the interesting interleaving: five
    // calls issued in the same tick all read "unknown" before any of them
    // writes. The failure this guards against needs a request to arrive a
    // round trip or two INTO another one's provisioning — which is exactly
    // what an MCP client issuing parallel tool calls produces, and what the
    // staggered arrivals below reproduce. While the account row and its
    // `household_members` provenance row were two statements, the late
    // arrivals saw a `users` row with no provenance, read it as a locally
    // authored account and returned null (a 401 on a member's first-ever
    // request); at these delays that happened in roughly half of the
    // iterations. It is one statement now, so there is no such state to see.
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const arrivalsMs = [0, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.5, 3];

    for (let i = 0; i < 20; i++) {
      const sub = randomUUID();
      const results = await Promise.all(
        arrivalsMs.map(async (delay) => {
          if (delay > 0) await sleep(delay);
          return provisionMember(sub, 'adult');
        }),
      );

      expect(results).toEqual(arrivalsMs.map(() => sub));
      expect((await db.select().from(users).where(eq(users.id, sub))).length).toBe(1);
      expect(
        (await db.select().from(householdMembers).where(eq(householdMembers.userId, sub))).length,
      ).toBe(1);
    }
  }, 60_000);

  it('takes the role from the token and follows it when Heorth changes it', async () => {
    const key = await makeSigningKey('sat-a');
    const satellite = await satelliteApp(fakeJwksFetch(jwksBody([key])));
    const sub = randomUUID();

    const asChild = await satellite.request('/probe', {
      headers: { Authorization: `Bearer ${await memberToken(key, sub, 'child')}` },
    });
    expect(((await asChild.json()) as { principal: { role: string } }).principal.role).toBe('child');
    expect((await db.select().from(users).where(eq(users.id, sub)))[0]!.role).toBe('child');

    const asAdult = await satellite.request('/probe', {
      headers: { Authorization: `Bearer ${await memberToken(key, sub, 'adult')}` },
    });
    expect(((await asAdult.json()) as { principal: { role: string } }).principal.role).toBe('adult');
    // The mirror follows the token; the token stays authoritative.
    expect((await db.select().from(users).where(eq(users.id, sub)))[0]!.role).toBe('adult');
  });

  it('refuses a role this deployment does not know, and provisions nothing', async () => {
    const key = await makeSigningKey('sat-a');
    const satellite = await satelliteApp(fakeJwksFetch(jwksBody([key])));
    const sub = randomUUID();

    const res = await satellite.request('/probe', {
      headers: { Authorization: `Bearer ${await memberToken(key, sub, 'superuser')}` },
    });

    expect(res.status).toBe(401);
    expect((await db.select().from(users).where(eq(users.id, sub))).length).toBe(0);
  });

  it('refuses a sub that is not a uuid', async () => {
    const key = await makeSigningKey('sat-a');
    const satellite = await satelliteApp(fakeJwksFetch(jwksBody([key])));

    const res = await satellite.request('/probe', {
      headers: { Authorization: `Bearer ${await memberToken(key, 'not-a-uuid', 'adult')}` },
    });

    expect(res.status).toBe(401);
    expect(await provisionMember('not-a-uuid', 'adult')).toBeNull();
  });

  it('refuses to claim a locally authored account with the same id', async () => {
    const admin = await getAdminUser();
    expect(await provisionMember(admin.id, 'admin')).toBeNull();
    // ...and the local account is untouched.
    const [row] = await db.select().from(users).where(eq(users.id, admin.id));
    expect(row!.email).toBe(ADMIN_EMAIL);
    expect(await isHouseholdMember(admin.id)).toBe(false);
  });

  it('refuses a users row with no provenance even when it looks provisioned', async () => {
    // The strongest form of B4's refusal, and the one the atomicity fix must
    // not weaken: a local row carrying the very id, email and handle
    // provisioning would have synthesised — indistinguishable, column for
    // column, from the half-written state the two-statement version could
    // leave behind. It has no `household_members` row, so it is a local
    // account, and provisioning must refuse it rather than adopt it.
    const sub = randomUUID();
    await db.insert(users).values({
      id: sub,
      email: memberEmail(sub),
      handle: memberHandle(sub),
      passwordHash: 'locally-authored',
      role: 'adult',
    });

    expect(await provisionMember(sub, 'adult')).toBeNull();
    expect(await isHouseholdMember(sub)).toBe(false);
    // ...and nothing was written to claim it.
    expect((await db.select().from(householdMembers)).length).toBe(0);
    const [row] = await db.select().from(users).where(eq(users.id, sub));
    expect(row!.passwordHash).toBe('locally-authored');
  });
});

describe('a provisioned member cannot authenticate locally', () => {
  it('cannot log in with a password — the stored hash is unusable', async () => {
    const sub = randomUUID();
    expect(await provisionMember(sub, 'adult')).toBe(sub);

    const [row] = await db.select().from(users).where(eq(users.id, sub));
    expect(row!.passwordHash).toBe(UNUSABLE_PASSWORD_HASH);

    // Every plausible guess, through core's own verifier. (Direct rather than
    // over HTTP: `POST /auth/token` is rate-limited to 10 per window and the
    // limiter is process-wide.)
    for (const password of [config.adminPassword, UNUSABLE_PASSWORD_HASH, '', sub, 'password']) {
      expect(await identity.authenticate(memberEmail(sub), password)).toBeNull();
    }

    // ...and once over the real login route, for the full path.
    const res = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: memberEmail(sub), password: config.adminPassword }),
    });
    expect(res.status).toBe(401);
  });

  it('cannot manage kl_ API keys even holding a local JWT for that id', async () => {
    const sub = randomUUID();
    await provisionMember(sub, 'adult');

    // The strongest form of the test: hand the member a token the LOCAL guard
    // accepts (which Heorth cannot mint — it signs asymmetrically) and check
    // that key management still refuses them.
    const token = await signToken({ sub, role: 'adult' }, config.jwtSecret, 300);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    expect((await app.request('/api/v1/auth/keys', { headers })).status).toBe(403);
    const created = await app.request('/api/v1/auth/keys', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'nope' }),
    });
    expect(created.status).toBe(403);
    const revoked = await app.request(`/api/v1/auth/keys/${randomUUID()}`, {
      method: 'DELETE',
      headers,
    });
    expect(revoked.status).toBe(403);
  });
});

describe('per-user login and self-scoped key management', () => {
  async function adminJwt(): Promise<string> {
    const res = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: config.adminPassword }),
    });
    return ((await res.json()) as { data: { token: string } }).data.token;
  }

  it('authenticates the supplied email, and still defaults to the admin', async () => {
    const withEmail = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: config.adminPassword }),
    });
    expect(withEmail.status).toBe(200);

    // The web UI posts a password alone — unchanged behaviour.
    const withoutEmail = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: config.adminPassword }),
    });
    expect(withoutEmail.status).toBe(200);

    // An unknown email is rejected rather than falling back to the admin.
    expect(await identity.authenticate('nobody@kithledger.local', config.adminPassword)).toBeNull();
  });

  it('scopes /auth/keys to the caller rather than to a hardcoded admin', async () => {
    const headers = { Authorization: `Bearer ${await adminJwt()}`, 'Content-Type': 'application/json' };
    const admin = await getAdminUser();

    const created = await app.request('/api/v1/auth/keys', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'caller-scoped' }),
    });
    expect(created.status).toBe(201);
    const key = ((await created.json()) as { data: { id: string } }).data;

    // The key belongs to the caller...
    const listed = await app.request('/api/v1/auth/keys', { headers });
    expect(((await listed.json()) as { data: { id: string }[] }).data.map((k) => k.id)).toEqual([
      key.id,
    ]);

    // ...and another local caller's list does not contain it, which the old
    // getAdminUser() implementation could not have satisfied.
    const other = await db
      .insert(users)
      .values({
        email: 'other@kithledger.local',
        handle: 'other',
        passwordHash: UNUSABLE_PASSWORD_HASH,
        role: 'adult',
      })
      .returning();
    const otherToken = await signToken({ sub: other[0]!.id, role: 'adult' }, config.jwtSecret, 300);
    const otherList = await app.request('/api/v1/auth/keys', {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    expect(otherList.status).toBe(200);
    expect(((await otherList.json()) as { data: unknown[] }).data).toEqual([]);

    // Revoking is caller-scoped too: the other caller cannot revoke it.
    const foreignRevoke = await app.request(`/api/v1/auth/keys/${key.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    expect(foreignRevoke.status).toBe(404);
    expect(admin.id).not.toBe(other[0]!.id);
  });
});
