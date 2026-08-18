import { describe, it, expect } from 'vitest';
import { JwksClient, parseJwks, JwksUnavailableError } from '../src/satellite/jwks.js';
import { makeSigningKey, jwksBody, fakeJwksFetch } from './satellite-keys.js';

/**
 * The JWKS client (B1d). Nothing here touches the network: every test injects
 * a fake fetch standing in for Heorth's `/.well-known/jwks.json`.
 */

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('JWKS client — fetching and caching', () => {
  it('fetches the bare {"keys":[...]} document and loads the keys', async () => {
    const key = await makeSigningKey('sat-a');
    const fake = fakeJwksFetch(jwksBody([key]));
    const client = new JwksClient({ url: 'http://heorth/.well-known/jwks.json', fetch: fake.fetch });

    const keys = await client.keysFor('sat-a');

    expect(keys.map((k) => k.kid)).toEqual(['sat-a']);
    expect(keys[0]!.alg).toBe('EdDSA');
    expect(fake.calls()).toBe(1);
  });

  it('serves a known kid from cache without any further fetch', async () => {
    const key = await makeSigningKey('sat-a');
    const fake = fakeJwksFetch(jwksBody([key]));
    const client = new JwksClient({ url: 'http://heorth/jwks', fetch: fake.fetch });

    await client.keysFor('sat-a');
    for (let i = 0; i < 10; i += 1) await client.keysFor('sat-a');

    expect(fake.calls()).toBe(1);
  });

  it('coalesces a concurrent burst into a single request', async () => {
    const key = await makeSigningKey('sat-a');
    const fake = fakeJwksFetch(jwksBody([key]));
    const client = new JwksClient({ url: 'http://heorth/jwks', fetch: fake.fetch });

    await Promise.all(Array.from({ length: 20 }, () => client.keysFor('sat-a')));

    expect(fake.calls()).toBe(1);
  });

  it('picks up a rotated key on the first unknown kid', async () => {
    const oldKey = await makeSigningKey('sat-2026-08');
    const newKey = await makeSigningKey('sat-2026-09');
    const fake = fakeJwksFetch(jwksBody([oldKey]));
    const clk = clock();
    const client = new JwksClient({
      url: 'http://heorth/jwks',
      fetch: fake.fetch,
      now: clk.now,
    });

    await client.keysFor('sat-2026-08');
    fake.serve(jwksBody([oldKey, newKey]));
    clk.advance(120_000);

    const keys = await client.keysFor('sat-2026-09');
    expect(keys.map((k) => k.kid).sort()).toEqual(['sat-2026-08', 'sat-2026-09']);
    expect(fake.calls()).toBe(2);
  });
});

describe('JWKS client — refresh is bounded (DoS safety)', () => {
  it('refreshes at most once per window no matter how many unknown kids arrive', async () => {
    const key = await makeSigningKey('sat-a');
    const fake = fakeJwksFetch(jwksBody([key]));
    const clk = clock();
    const client = new JwksClient({
      url: 'http://heorth/jwks',
      fetch: fake.fetch,
      minRefreshIntervalMs: 60_000,
      now: clk.now,
    });

    await client.keysFor('sat-a'); // cold start: one fetch
    expect(fake.calls()).toBe(1);

    // An attacker sprays random kids.
    for (let i = 0; i < 50; i += 1) {
      const keys = await client.keysFor(`forged-${i}`);
      expect(keys.map((k) => k.kid)).toEqual(['sat-a']); // no key matches → 401 upstream
    }
    expect(fake.calls()).toBe(1);

    // Only once the window elapses does a further attempt happen — and then
    // exactly one, not one per request.
    clk.advance(60_000);
    for (let i = 0; i < 50; i += 1) await client.keysFor(`forged-later-${i}`);
    expect(fake.calls()).toBe(2);
  });

  it('counts failed attempts against the window too, so an outage is not a retry storm', async () => {
    const clk = clock();
    const fake = fakeJwksFetch('{"keys":[]}');
    fake.fail();
    const client = new JwksClient({
      url: 'http://heorth/jwks',
      fetch: fake.fetch,
      minRefreshIntervalMs: 60_000,
      now: clk.now,
    });

    for (let i = 0; i < 20; i += 1) await client.keysFor('sat-a');
    expect(fake.calls()).toBe(1);
  });
});

describe('JWKS client — surviving a Heorth outage', () => {
  it('keeps verifying with cached keys when the endpoint is unreachable', async () => {
    const key = await makeSigningKey('sat-a');
    const fake = fakeJwksFetch(jwksBody([key]));
    const clk = clock();
    const client = new JwksClient({ url: 'http://heorth/jwks', fetch: fake.fetch, now: clk.now });

    await client.keysFor('sat-a');
    fake.fail('network');

    // Known kid: not even attempted.
    clk.advance(10 * 60_000);
    expect((await client.keysFor('sat-a')).map((k) => k.kid)).toEqual(['sat-a']);
    expect(fake.calls()).toBe(1);
  });

  it('never clears a good cache when a refresh fails', async () => {
    const key = await makeSigningKey('sat-a');
    const fake = fakeJwksFetch(jwksBody([key]));
    const clk = clock();
    const client = new JwksClient({ url: 'http://heorth/jwks', fetch: fake.fetch, now: clk.now });

    await client.keysFor('sat-a');
    fake.fail('status'); // Heorth answers 503
    clk.advance(120_000);

    const keys = await client.keysFor('unknown-kid');
    expect(keys.map((k) => k.kid)).toEqual(['sat-a']);
    expect(client.keys.map((k) => k.kid)).toEqual(['sat-a']);
  });

  it('times out a hanging endpoint instead of blocking the request', async () => {
    const clk = clock();
    const hangingFetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    const client = new JwksClient({
      url: 'http://heorth/jwks',
      fetch: hangingFetch,
      timeoutMs: 20,
      now: clk.now,
    });

    const keys = await client.keysFor('sat-a');
    expect(keys).toEqual([]); // fails closed, does not hang or throw
  });
});

describe('JWKS document parsing', () => {
  it('rejects a document that is not JSON or has no keys array', async () => {
    await expect(parseJwks('not json')).rejects.toBeInstanceOf(JwksUnavailableError);
    await expect(parseJwks('{"data":{"keys":[]}}')).rejects.toBeInstanceOf(JwksUnavailableError);
  });

  it('skips unusable entries but keeps the good ones', async () => {
    const key = await makeSigningKey('sat-a');
    const good = JSON.parse(jwksBody([key])) as { keys: unknown[] };
    const doc = {
      keys: [
        ...good.keys,
        { kid: 'no-alg', kty: 'OKP' },
        { kid: 'unsupported', alg: 'HS256', kty: 'oct', k: 'AAAA' },
        { kid: 'encryption', alg: 'EdDSA', use: 'enc', kty: 'OKP', crv: 'Ed25519', x: 'AAAA' },
        { alg: 'EdDSA', kty: 'OKP', crv: 'Ed25519', x: 'AAAA' },
        'nonsense',
      ],
    };

    const keys = await parseJwks(JSON.stringify(doc));
    expect(keys.map((k) => k.kid)).toEqual(['sat-a']);
  });

  it('refuses to load an entry carrying a private component', async () => {
    // A malicious or misconfigured JWKS must never hand this service signing
    // material — core's loadPublicKey rejects it and the entry is skipped.
    const key = await makeSigningKey('sat-a');
    const doc = { keys: [{ ...key.jwk, use: 'sig' }] };
    expect((doc.keys[0] as { d?: string }).d).toBeTruthy();

    expect(await parseJwks(JSON.stringify(doc))).toEqual([]);
  });

  it('ignores a duplicate kid rather than choosing arbitrarily', async () => {
    const a = await makeSigningKey('sat-dup');
    const b = await makeSigningKey('sat-dup');
    const doc = {
      keys: [
        ...(JSON.parse(jwksBody([a])) as { keys: unknown[] }).keys,
        ...(JSON.parse(jwksBody([b])) as { keys: unknown[] }).keys,
      ],
    };

    const keys = await parseJwks(JSON.stringify(doc));
    expect(keys).toHaveLength(1);
  });
});
