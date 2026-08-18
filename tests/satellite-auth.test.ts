import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { signToken } from '@wyrhta/core/identity';
import { createAuthGuards, type Principal } from '@wyrhta/core/auth';
import { JwksClient } from '../src/satellite/jwks.js';
import {
  withSatelliteAuth,
  asymmetricJwtHeader,
  bearerToken,
  SATELLITE_LEEWAY_SECONDS,
  type SatellitePrincipalResolver,
} from '../src/satellite/auth.js';
import { makeSigningKey, jwksBody, fakeJwksFetch } from './satellite-keys.js';

/**
 * Verification of Heorth-issued satellite tokens (B1d, ADR 0009). Every test
 * injects a fake JWKS fetch — nothing here touches the network — and the
 * security matrix is asserted explicitly: wrong key, wrong `aud`, wrong `iss`,
 * expired (and within-leeway), plus the structural claim that this service
 * cannot mint.
 */

const ISSUER = 'heorth';
const AUDIENCE = 'kithledger';
const LOCAL_SECRET = 'l'.repeat(32);

interface Harness {
  app: Hono;
  fake: ReturnType<typeof fakeJwksFetch>;
  advance: (ms: number) => void;
}

async function harness(opts: {
  fake: ReturnType<typeof fakeJwksFetch>;
  resolvePrincipal?: SatellitePrincipalResolver;
  minRefreshIntervalMs?: number;
}): Promise<Harness> {
  let t = 1_000_000;
  const jwks = new JwksClient({
    url: 'http://heorth:4000/.well-known/jwks.json',
    fetch: opts.fake.fetch,
    minRefreshIntervalMs: opts.minRefreshIntervalMs ?? 60_000,
    now: () => t,
  });

  // The existing KithLedger auth path, unchanged: a kl_ API key or the local
  // HS256 admin JWT.
  const local = createAuthGuards({
    jwtSecret: LOCAL_SECRET,
    keyPrefix: 'kl_',
    resolveApiKey: async (raw) =>
      raw === 'kl_valid' ? { type: 'api_key', userId: 'admin-id', role: 'admin' } : null,
  });

  const app = new Hono();
  app.use(
    '*',
    withSatelliteAuth(local.requireAuth, {
      config: { jwksUrl: 'http://heorth:4000/.well-known/jwks.json', issuer: ISSUER, audience: AUDIENCE },
      jwks,
      keyPrefix: 'kl_',
      resolvePrincipal: opts.resolvePrincipal,
    }),
  );
  app.get('/probe', (c) => c.json({ principal: c.get('principal') }));

  return { app, fake: opts.fake, advance: (ms) => (t += ms) };
}

function auth(token: string) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

describe('satellite token verification — the happy path', () => {
  it('resolves a valid member token to a Principal', async () => {
    const key = await makeSigningKey('sat-a');
    const { app } = await harness({ fake: fakeJwksFetch(jwksBody([key])) });
    const token = await signToken(
      { sub: 'member-42', role: 'member', iss: ISSUER, aud: AUDIENCE },
      key,
      300,
    );

    const res = await app.request('/probe', auth(token));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      principal: { type: 'jwt', userId: 'member-42', role: 'member' },
    });
  });

  it('leaves the existing kl_ API-key and local-JWT paths untouched', async () => {
    const key = await makeSigningKey('sat-a');
    const { app, fake } = await harness({ fake: fakeJwksFetch(jwksBody([key])) });

    const viaKey = await app.request('/probe', auth('kl_valid'));
    expect(viaKey.status).toBe(200);
    expect(await viaKey.json()).toEqual({
      principal: { type: 'api_key', userId: 'admin-id', role: 'admin' },
    });

    const localJwt = await signToken({ sub: 'admin-id', role: 'admin' }, LOCAL_SECRET, 3600);
    const viaJwt = await app.request('/probe', auth(localJwt));
    expect(viaJwt.status).toBe(200);
    expect(await viaJwt.json()).toEqual({
      principal: { type: 'jwt', userId: 'admin-id', role: 'admin' },
    });

    // Neither path went anywhere near Heorth.
    expect(fake.calls()).toBe(0);
  });

  it('carries the member role from the token rather than privileging it', async () => {
    const key = await makeSigningKey('sat-a');
    const { app } = await harness({ fake: fakeJwksFetch(jwksBody([key])) });
    const token = await signToken(
      { sub: 'member-42', role: 'member', iss: ISSUER, aud: AUDIENCE },
      key,
      300,
    );

    const body = (await (await app.request('/probe', auth(token))).json()) as {
      principal: Principal;
    };
    expect(body.principal.role).toBe('member');
  });
});

describe('satellite token verification — rejections', () => {
  it('rejects a token signed by the WRONG KEY under a published kid', async () => {
    const published = await makeSigningKey('sat-a');
    const impostor = await makeSigningKey('sat-a'); // same kid, different material
    const { app } = await harness({ fake: fakeJwksFetch(jwksBody([published])) });
    const token = await signToken(
      { sub: 'member-42', role: 'admin', iss: ISSUER, aud: AUDIENCE },
      impostor,
      300,
    );

    expect((await app.request('/probe', auth(token))).status).toBe(401);
  });

  it('rejects a token signed by a key that is not published at all', async () => {
    const published = await makeSigningKey('sat-a');
    const unpublished = await makeSigningKey('sat-rogue');
    const { app } = await harness({ fake: fakeJwksFetch(jwksBody([published])) });
    const token = await signToken(
      { sub: 'member-42', role: 'member', iss: ISSUER, aud: AUDIENCE },
      unpublished,
      300,
    );

    expect((await app.request('/probe', auth(token))).status).toBe(401);
  });

  it('rejects a token minted for ANOTHER SATELLITE (wrong aud)', async () => {
    const key = await makeSigningKey('sat-a');
    const { app } = await harness({ fake: fakeJwksFetch(jwksBody([key])) });
    const token = await signToken(
      { sub: 'member-42', role: 'member', iss: ISSUER, aud: 'heimr' },
      key,
      300,
    );

    expect((await app.request('/probe', auth(token))).status).toBe(401);
  });

  it('rejects a token with no aud at all', async () => {
    const key = await makeSigningKey('sat-a');
    const { app } = await harness({ fake: fakeJwksFetch(jwksBody([key])) });
    const token = await signToken({ sub: 'member-42', role: 'member', iss: ISSUER }, key, 300);

    expect((await app.request('/probe', auth(token))).status).toBe(401);
  });

  it('rejects a token from the WRONG ISSUER', async () => {
    const key = await makeSigningKey('sat-a');
    const { app } = await harness({ fake: fakeJwksFetch(jwksBody([key])) });
    const token = await signToken(
      { sub: 'member-42', role: 'member', iss: 'not-heorth', aud: AUDIENCE },
      key,
      300,
    );

    expect((await app.request('/probe', auth(token))).status).toBe(401);
  });

  it('rejects an EXPIRED token, but accepts one inside the 60s leeway', async () => {
    const key = await makeSigningKey('sat-a');
    const { app } = await harness({ fake: fakeJwksFetch(jwksBody([key])) });
    const claims = { sub: 'member-42', role: 'member' as const, iss: ISSUER, aud: AUDIENCE };

    // 30s past expiry — inside the clock-skew allowance (ADR 0009 Q3).
    const barelyExpired = await signToken(claims, key, -30);
    expect((await app.request('/probe', auth(barelyExpired))).status).toBe(200);

    // Beyond the leeway.
    const expired = await signToken(claims, key, -(SATELLITE_LEEWAY_SECONDS + 60));
    expect((await app.request('/probe', auth(expired))).status).toBe(401);
  });

  it('rejects an HS256 token that claims Heorth\'s issuer and audience', async () => {
    // The local secret must never be able to stand in for Heorth's key: an
    // HS256 token is dispatched to the local guard, which knows no iss/aud —
    // so it can only ever authenticate as whatever the local secret already
    // authenticates, never as a satellite member with a forged sub.
    const key = await makeSigningKey('sat-a');
    const { app } = await harness({ fake: fakeJwksFetch(jwksBody([key])) });
    const forged = await signToken(
      { sub: 'member-42', role: 'admin', iss: ISSUER, aud: AUDIENCE },
      'w'.repeat(32),
      300,
    );

    expect((await app.request('/probe', auth(forged))).status).toBe(401);
  });

  it('fails closed when no key has ever been fetched', async () => {
    const key = await makeSigningKey('sat-a');
    const fake = fakeJwksFetch(jwksBody([key]));
    fake.fail('network');
    const { app } = await harness({ fake });
    const token = await signToken(
      { sub: 'member-42', role: 'member', iss: ISSUER, aud: AUDIENCE },
      key,
      300,
    );

    expect((await app.request('/probe', auth(token))).status).toBe(401);
  });
});

describe('satellite token verification — refresh behaviour under load', () => {
  it('triggers exactly one bounded refresh for a stream of unknown kids', async () => {
    const published = await makeSigningKey('sat-a');
    const rogue = await makeSigningKey('sat-rogue');
    const fake = fakeJwksFetch(jwksBody([published]));
    const { app, advance } = await harness({ fake });

    // Warm the cache with a legitimate request.
    const good = await signToken(
      { sub: 'member-42', role: 'member', iss: ISSUER, aud: AUDIENCE },
      published,
      300,
    );
    expect((await app.request('/probe', auth(good))).status).toBe(200);
    expect(fake.calls()).toBe(1);

    // 25 requests bearing an unknown kid: all rejected, ZERO extra fetches.
    const forged = await signToken(
      { sub: 'attacker', role: 'admin', iss: ISSUER, aud: AUDIENCE },
      rogue,
      300,
    );
    for (let i = 0; i < 25; i += 1) {
      expect((await app.request('/probe', auth(forged))).status).toBe(401);
    }
    expect(fake.calls()).toBe(1);

    advance(60_000);
    for (let i = 0; i < 25; i += 1) await app.request('/probe', auth(forged));
    expect(fake.calls()).toBe(2);
  });

  it('accepts a rotated key once Heorth publishes it', async () => {
    const oldKey = await makeSigningKey('sat-2026-08');
    const newKey = await makeSigningKey('sat-2026-09');
    const fake = fakeJwksFetch(jwksBody([oldKey]));
    const { app, advance } = await harness({ fake });

    const before = await signToken(
      { sub: 'member-42', role: 'member', iss: ISSUER, aud: AUDIENCE },
      oldKey,
      300,
    );
    expect((await app.request('/probe', auth(before))).status).toBe(200);

    fake.serve(jwksBody([oldKey, newKey]));
    advance(60_000);

    const after = await signToken(
      { sub: 'member-42', role: 'member', iss: ISSUER, aud: AUDIENCE },
      newKey,
      300,
    );
    expect((await app.request('/probe', auth(after))).status).toBe(200);
    // The old key still verifies through the rotation overlap.
    expect((await app.request('/probe', auth(before))).status).toBe(200);
  });
});

describe('the B4 seam (just-in-time provisioning)', () => {
  it('hands the verified member principal to the resolver and uses its answer', async () => {
    const key = await makeSigningKey('sat-a');
    const seen: Principal[] = [];
    const { app } = await harness({
      fake: fakeJwksFetch(jwksBody([key])),
      resolvePrincipal: (principal) => {
        seen.push(principal);
        return { type: 'jwt', userId: 'local-row-7', role: principal.role };
      },
    });
    const token = await signToken(
      { sub: 'heorth-member-42', role: 'member', iss: ISSUER, aud: AUDIENCE },
      key,
      300,
    );

    const body = (await (await app.request('/probe', auth(token))).json()) as {
      principal: Principal;
    };
    expect(seen).toEqual([{ type: 'jwt', userId: 'heorth-member-42', role: 'member' }]);
    expect(body.principal.userId).toBe('local-row-7');
  });

  it('denies with 401 when the resolver returns null', async () => {
    const key = await makeSigningKey('sat-a');
    const { app } = await harness({
      fake: fakeJwksFetch(jwksBody([key])),
      resolvePrincipal: () => null,
    });
    const token = await signToken(
      { sub: 'unknown-member', role: 'member', iss: ISSUER, aud: AUDIENCE },
      key,
      300,
    );

    expect((await app.request('/probe', auth(token))).status).toBe(401);
  });
});

describe('token-header dispatch helpers', () => {
  it('only claims asymmetric bearer JWTs', async () => {
    const key = await makeSigningKey('sat-a');
    const satellite = await signToken({ sub: 'm', role: 'member' }, key, 300);
    const local = await signToken({ sub: 'a', role: 'admin' }, LOCAL_SECRET, 300);

    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('Bearer   ')).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
    expect(asymmetricJwtHeader(satellite)).toEqual({ alg: 'EdDSA', kid: 'sat-a' });
    expect(asymmetricJwtHeader(local)).toBeNull();
    expect(asymmetricJwtHeader('kl_something')).toBeNull();
    expect(asymmetricJwtHeader('eyJnonsense')).toBeNull();
  });
});

describe('KithLedger cannot mint a satellite token', () => {
  const srcFiles = (() => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) out.push(p);
      }
    };
    walk('src');
    return out;
  })();

  it('holds no satellite signing key in configuration', () => {
    const env = readFileSync('src/config/env.ts', 'utf8');
    expect(env).not.toMatch(/SATELLITE_SIGNING/);
    expect(env).not.toMatch(/PRIVATE_KEY/);
    // Only the JWKS URL and two names — nothing secret.
    expect(env).toMatch(/HEORTH_JWKS_URL/);
  });

  it('never imports a signing primitive on the satellite path', () => {
    for (const file of srcFiles.filter((f) => f.includes('satellite'))) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/loadPrivateKey|signToken|issueToken|PrivateSigningKey/);
      expect(source).toMatch(/loadPublicKey|PublicVerificationKey|verif/i);
    }
  });

  it('uses core JWT signing only for the local admin token, never with a satellite audience', () => {
    // `identity.issueToken` is the ONLY place core's signer is bound to key
    // material, and it binds the HS256 admin secret with no `iss`/`aud` — it
    // is structurally incapable of producing a token this or any other
    // satellite would accept. `POST /auth/token` calls that wrapper, never
    // core's signer directly.
    const identity = readFileSync('src/identity.ts', 'utf8');
    const signingCallSites = srcFiles
      .filter((f) => /\b(signToken|issueToken)\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => f.split(sep).join('/'))
      .sort();
    expect(signingCallSites).toEqual(['src/identity.ts', 'src/routes/auth.ts']);
    expect(identity).toMatch(/issueToken\(user, config\.jwtSecret, ttlSeconds\)/);
    expect(identity).not.toMatch(/aud:/);
    const authRoute = readFileSync('src/routes/auth.ts', 'utf8');
    expect(authRoute).toMatch(/identity\.issueToken\(/);
    expect(authRoute).not.toMatch(/@wyrhta\/core\/identity/);
  });
});
