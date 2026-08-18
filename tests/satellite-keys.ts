import { webcrypto } from 'node:crypto';
import {
  loadPrivateKey,
  toJwks,
  type PrivateSigningKey,
  type JsonWebKey,
} from '@wyrhta/core/identity';

/**
 * Test helpers standing in for Heorth: generate satellite signing keys and
 * serve the BARE `{"keys":[...]}` document its `/.well-known/jwks.json`
 * publishes (Heorth commit 00986d7). No test touches the network.
 */

/** A fresh Ed25519 signing key with the given `kid`, as Heorth would hold it. */
export async function makeSigningKey(kid: string): Promise<PrivateSigningKey> {
  const pair = (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as webcrypto.CryptoKeyPair;
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  return loadPrivateKey(jwk as JsonWebKey, { kid, alg: 'EdDSA' });
}

/** The JWKS document Heorth would publish for these keys (public halves only). */
export function jwksBody(keys: PrivateSigningKey[]): string {
  return JSON.stringify(toJwks(keys));
}

export interface FakeFetch {
  fetch: typeof fetch;
  /** How many times the JWKS endpoint was called. */
  calls: () => number;
  /** Serve this body from now on. */
  serve: (body: string) => void;
  /** Fail every request from now on (Heorth outage). */
  fail: (kind?: 'network' | 'status') => void;
}

/** An injectable fetch that answers exactly one URL: the JWKS document. */
export function fakeJwksFetch(body: string): FakeFetch {
  let current = body;
  let mode: 'ok' | 'network' | 'status' = 'ok';
  let calls = 0;

  const impl = (async () => {
    calls += 1;
    if (mode === 'network') throw new TypeError('fetch failed');
    if (mode === 'status') return new Response('nope', { status: 503 });
    return new Response(current, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

  return {
    fetch: impl,
    calls: () => calls,
    serve: (next) => {
      current = next;
      mode = 'ok';
    },
    fail: (kind = 'network') => {
      mode = kind;
    },
  };
}
