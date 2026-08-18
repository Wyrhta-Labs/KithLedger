import { loadPublicKey, type PublicVerificationKey } from '@wyrhta/core/identity';
import { logEvent } from '@wyrhta/core/lib';

/**
 * JWKS client for Heorth's satellite signing keys (B1d, ADR 0009).
 *
 * Heorth publishes its PUBLIC satellite keys at `/.well-known/jwks.json`
 * (Heorth commit 00986d7). KithLedger fetches that document, caches the keys,
 * and verifies member tokens against them. It holds no private key and cannot
 * mint — everything in this module is deliberately verification-only:
 * `loadPublicKey` rejects any entry carrying a private component, so even a
 * malicious or misconfigured JWKS cannot turn this service into an issuer.
 *
 * The document is a BARE `{"keys":[...]}` — Heorth's one response that is not
 * wrapped in core's `{ data: ... }` envelope, because that is what a JWKS is
 * on the wire. Do not "fix" that here.
 *
 * Transport concerns (base URL, timeout, injectable fetch, network failure →
 * one typed error) follow the house client style — see Heorth's
 * `src/modules/kith/client.ts`.
 *
 * NOTHING here logs key material or tokens: the audit events carry counts,
 * key ids and error kinds only. A `kid` is a public label, safe to log; the
 * key bytes and the tokens themselves never are.
 */

/** Thrown when the JWKS document could not be fetched or read. */
export class JwksUnavailableError extends Error {
  constructor(
    message: string,
    public readonly kind: 'timeout' | 'network' | 'bad_response',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'JwksUnavailableError';
  }
}

/** Algorithms core can verify asymmetrically; other entries are ignored. */
const SUPPORTED_ALGS = new Set(['EdDSA', 'RS256']);

/** A defensive ceiling on the document body — a JWKS is a few kilobytes. */
const MAX_DOCUMENT_BYTES = 256 * 1024;

export interface JwksClientOptions {
  /** Absolute URL of the JWKS document. */
  url: string;
  /** Per-request timeout in milliseconds (default 5000). */
  timeoutMs?: number;
  /**
   * Minimum interval between fetch ATTEMPTS (default 60_000). This is the
   * DoS bound: see {@link JwksClient.keysFor}.
   */
  minRefreshIntervalMs?: number;
  /** Injectable fetch — defaults to the global. Tests pass a fake Heorth. */
  fetch?: typeof fetch;
  /** Injectable clock, so tests can advance the refresh window. */
  now?: () => number;
}

export class JwksClient {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly minRefreshIntervalMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  /** Last successfully fetched key set. Survives every later failure. */
  private cached: PublicVerificationKey[] = [];
  /** Timestamp of the last fetch ATTEMPT (successful or not). */
  private lastAttemptAt = Number.NEGATIVE_INFINITY;
  /** Coalesces concurrent refreshes into a single request. */
  private inFlight: Promise<PublicVerificationKey[]> | null = null;

  constructor(opts: JwksClientOptions) {
    this.url = opts.url;
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.minRefreshIntervalMs = opts.minRefreshIntervalMs ?? 60_000;
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  /** The currently cached keys, without any fetch. */
  get keys(): PublicVerificationKey[] {
    return this.cached;
  }

  /**
   * The keys to verify a token bearing `kid` against.
   *
   * CACHE / REFRESH POLICY — the two forces are "a rotated key must be picked
   * up" and "an unknown `kid` must not be a free remote call":
   *
   * - A `kid` already in the cache never triggers a fetch. That is the hot
   *   path, and it is why a Heorth OUTAGE DOES NOT BREAK VERIFICATION: cached
   *   keys keep verifying tokens indefinitely, and a failed fetch never
   *   clears them.
   * - An UNKNOWN `kid` (a rotation, or a cold start) triggers at most one
   *   refresh per `minRefreshIntervalMs`, counted from the last ATTEMPT —
   *   failures included. An attacker sending a stream of random `kid`s
   *   therefore cannot amplify one cheap request into one Heorth round trip
   *   each; they get one attempt per window no matter the request rate, and
   *   every such token is rejected anyway once no matching key turns up.
   * - Concurrent unknown-`kid` requests share one in-flight fetch, so a burst
   *   is one request, not N.
   *
   * A refresh failure is never propagated to the caller: the cached keys (or
   * an empty set) are returned and verification decides. Verification failing
   * closed on an unknown key is the correct outcome; a 500 would not be.
   */
  async keysFor(kid: string | undefined): Promise<PublicVerificationKey[]> {
    if (kid !== undefined && this.cached.some((k) => k.kid === kid)) return this.cached;
    // An absent `kid` is unambiguous only against a single cached key; core's
    // `verifyToken` handles that, so do not spend a fetch on it.
    if (kid === undefined && this.cached.length > 0) return this.cached;

    if (this.inFlight) return this.inFlight;
    if (this.now() - this.lastAttemptAt < this.minRefreshIntervalMs) {
      logEvent({
        event: 'satellite.jwks.refresh_throttled',
        kid: kid ?? null,
        cached_keys: this.cached.length,
      });
      return this.cached;
    }

    this.inFlight = this.refresh(kid).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Fetch and replace the cache. Never throws; never clears a good cache. */
  private async refresh(kid: string | undefined): Promise<PublicVerificationKey[]> {
    this.lastAttemptAt = this.now();
    try {
      const keys = await this.fetchKeys();
      this.cached = keys;
      logEvent({
        event: 'satellite.jwks.refreshed',
        kid: kid ?? null,
        keys: keys.length,
        // `kid`s are public labels — the key material itself is never logged.
        key_ids: keys.map((k) => k.kid),
      });
      return keys;
    } catch (e: unknown) {
      logEvent({
        event: 'satellite.jwks.refresh_failed',
        success: false,
        kid: kid ?? null,
        kind: e instanceof JwksUnavailableError ? e.kind : 'network',
        cached_keys: this.cached.length,
      });
      // Deliberately keep serving the last known-good key set.
      return this.cached;
    }
  }

  /** One timeout-guarded GET, parsed into loaded public keys. */
  private async fetchKeys(): Promise<PublicVerificationKey[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let text: string;
    try {
      const res = await this.fetchImpl(this.url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new JwksUnavailableError(`JWKS endpoint answered ${res.status}`, 'bad_response');
      }
      text = await res.text();
    } catch (e: unknown) {
      if (e instanceof JwksUnavailableError) throw e;
      if (controller.signal.aborted) {
        throw new JwksUnavailableError(
          `JWKS request timed out after ${this.timeoutMs}ms`,
          'timeout',
          e,
        );
      }
      throw new JwksUnavailableError('Could not reach the JWKS endpoint', 'network', e);
    } finally {
      clearTimeout(timer);
    }

    if (text.length > MAX_DOCUMENT_BYTES) {
      throw new JwksUnavailableError('JWKS document is implausibly large', 'bad_response');
    }
    return parseJwks(text);
  }
}

/** One raw JWKS entry, before core validates the material. */
interface RawJwksKey {
  kid?: unknown;
  alg?: unknown;
  use?: unknown;
}

/**
 * Parse a BARE `{"keys":[...]}` document into loaded public keys.
 *
 * Unusable entries are SKIPPED rather than failing the whole document: a
 * future key type, a signing-unrelated `use`, or one bad entry must not cost
 * the household every other key. Anything carrying a private component is
 * rejected by core's `loadPublicKey` and skipped here — this service must
 * never end up holding signing material.
 */
export async function parseJwks(body: string): Promise<PublicVerificationKey[]> {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch (e) {
    throw new JwksUnavailableError('JWKS document is not JSON', 'bad_response', e);
  }
  const raw = (doc as { keys?: unknown })?.keys;
  if (!Array.isArray(raw)) {
    throw new JwksUnavailableError('JWKS document has no `keys` array', 'bad_response');
  }

  const keys: PublicVerificationKey[] = [];
  const seen = new Set<string>();
  for (const entry of raw as RawJwksKey[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { kid, alg, use } = entry;
    if (typeof kid !== 'string' || kid === '') continue;
    if (typeof alg !== 'string' || !SUPPORTED_ALGS.has(alg)) continue;
    if (use !== undefined && use !== 'sig') continue;
    // A duplicate `kid` makes key selection ambiguous — Heorth rejects that at
    // load time; ignore the later entry rather than trusting either blindly.
    if (seen.has(kid)) continue;
    try {
      keys.push(
        await loadPublicKey(entry as Record<string, unknown>, {
          kid,
          alg: alg as 'EdDSA' | 'RS256',
        }),
      );
      seen.add(kid);
    } catch {
      // INVALID_KEY_MATERIAL — malformed, or (importantly) carrying a private
      // component. Skip it; never log the entry, it is key material.
      logEvent({ event: 'satellite.jwks.key_rejected', success: false, kid });
    }
  }
  return keys;
}
