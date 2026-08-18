import type { MiddlewareHandler } from 'hono';
import { decode } from 'hono/jwt';
import { createAuthGuards, type Principal } from '@wyrhta/core/auth';
import { err } from '@wyrhta/core/http';
import { logEvent } from '@wyrhta/core/lib';
import type { SatelliteAuthConfig } from '../config/env.js';
import type { JwksClient } from './jwks.js';

/**
 * Verification of Heorth-issued satellite member tokens (B1d, ADR 0009).
 *
 * KithLedger VERIFIES; it never mints. There is no signing key in this file,
 * in `./jwks.ts`, or anywhere else on this path — only public keys fetched
 * from Heorth's JWKS. `config.jwtSecret` is untouched and still belongs to the
 * existing admin-login path alone.
 *
 * This is NOT a parallel auth path: it decorates the SAME `requireAuth` the
 * routes already use (see `src/identity.ts`). A request is dispatched to
 * satellite verification only when it carries a Bearer JWT signed with an
 * ASYMMETRIC algorithm — i.e. one Heorth minted. `kl_` API keys and the local
 * HS256 admin JWT fall through to core's existing guard, unchanged and
 * unaffected, and when the satellite group is unconfigured this module is
 * never installed at all.
 *
 * The actual verification is core's `createAuthGuards`, given the fetched
 * public keys plus the expected `iss` / `aud` and {@link SATELLITE_LEEWAY_SECONDS},
 * so the token checks, the principal shape and the 401 body are literally the
 * same code that guards every other request.
 */

/**
 * Clock-skew tolerance for satellite tokens (ADR 0009 open question 3).
 * Core defaults leeway to 0; 60s is a 20% widening of the 300s TTL — the usual
 * JWT convention, and the margin two containers with independent clocks need.
 */
export const SATELLITE_LEEWAY_SECONDS = 60;

/**
 * SEAM FOR B4 (just-in-time member provisioning).
 *
 * Called with the principal core produced from a token that has ALREADY been
 * fully verified — signature, `iss`, `aud`, `exp`. `userId` is Heorth's member
 * id (the token's `sub`), which today need not correspond to any local `users`
 * row: B1d verifies identity and stops there, deliberately.
 *
 * B4 replaces the default with a resolver that maps (or creates) the local
 * user row for that Heorth `sub` and returns a principal carrying the LOCAL
 * id. Returning `null` denies the request with a 401 — that is the hook for
 * "this member has no account here and provisioning refused". Nothing else in
 * this file needs to change for B4.
 */
export type SatellitePrincipalResolver = (
  principal: Principal,
  claims: SatelliteClaims,
) => Promise<Principal | null> | Principal | null;

/** The claims of a verified satellite token, as handed to the B4 seam. */
export interface SatelliteClaims {
  /** Heorth's member id. */
  sub: string;
  iss?: string;
  aud?: string;
}

/** Default seam behaviour: pass the verified member principal through as-is. */
const passThrough: SatellitePrincipalResolver = (principal) => principal;

/** The token of a `Bearer` header, or `null`. Never logged. */
export function bearerToken(header: string | undefined): string | null {
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * The JWT header of an asymmetrically signed token, or `null` for anything
 * else — a `kl_` API key, the local HS256 admin token, or an undecodable
 * value. This is what keeps the existing auth paths untouched.
 *
 * Reading the unverified header is safe and necessary: `kid` selects the
 * verification key, and nothing is trusted until the signature checks out.
 */
export function asymmetricJwtHeader(token: string): { alg: string; kid?: string } | null {
  if (!token.startsWith('eyJ')) return null;
  let header: { alg?: unknown; kid?: unknown };
  try {
    header = decode(token).header as { alg?: unknown; kid?: unknown };
  } catch {
    return null;
  }
  if (typeof header.alg !== 'string' || header.alg === 'HS256') return null;
  return { alg: header.alg, kid: typeof header.kid === 'string' ? header.kid : undefined };
}

export interface SatelliteAuthDeps {
  config: SatelliteAuthConfig;
  jwks: JwksClient;
  /** App API-key prefix, so the guard dispatches like every other one. */
  keyPrefix: string;
  /** B4's insertion point; defaults to passing the verified principal through. */
  resolvePrincipal?: SatellitePrincipalResolver;
}

/**
 * Wrap an existing `requireAuth` so satellite tokens are verified and
 * everything else keeps its current behaviour.
 */
export function withSatelliteAuth(
  fallback: MiddlewareHandler,
  deps: SatelliteAuthDeps,
): MiddlewareHandler {
  const resolvePrincipal = deps.resolvePrincipal ?? passThrough;

  return async (c, next) => {
    const token = bearerToken(c.req.header('Authorization'));
    const header = token ? asymmetricJwtHeader(token) : null;
    if (!token || !header) return fallback(c, next);

    const keys = await deps.jwks.keysFor(header.kid);
    if (keys.length === 0) {
      // No public key at all (never fetched, or Heorth publishes none). Fail
      // closed — a satellite with no key material can verify nothing.
      logEvent({
        event: 'satellite.auth.rejected',
        auth_type: 'satellite_jwt',
        success: false,
        reason: 'no_keys',
        kid: header.kid ?? null,
      });
      return err(c, 'UNAUTHORIZED', 'Invalid token', 401);
    }

    // Built per request from the CURRENT key set — the keys rotate, the guard
    // does not. Construction is a few closures; verification is the cost.
    const { requireJwt } = createAuthGuards({
      jwtVerificationKeys: keys,
      jwtIssuer: deps.config.issuer,
      jwtAudience: deps.config.audience,
      jwtLeewaySeconds: SATELLITE_LEEWAY_SECONDS,
      keyPrefix: deps.keyPrefix,
      // A satellite guard never resolves API keys: `withSatelliteAuth` only
      // routes asymmetric JWTs here, and `requireJwt` rejects anything else.
      resolveApiKey: async () => null,
    });

    let denied: Response | undefined;
    const guardResponse = await requireJwt(c, async () => {
      const verified = c.get('principal');
      if (!verified) {
        denied = err(c, 'UNAUTHORIZED', 'Invalid token', 401);
        return;
      }
      // B4 seam. Everything above this line is verification; everything below
      // is what KithLedger DOES with a verified member.
      const resolved = await resolvePrincipal(verified, {
        sub: verified.userId,
        iss: deps.config.issuer,
        aud: deps.config.audience,
      });
      if (!resolved) {
        logEvent({
          event: 'satellite.auth.rejected',
          auth_type: 'satellite_jwt',
          success: false,
          reason: 'unresolved_member',
          request_id: c.get('requestId'),
        });
        denied = err(c, 'UNAUTHORIZED', 'Unknown member', 401);
        return;
      }
      c.set('principal', resolved);
      await next();
    });

    return denied ?? guardResponse;
  };
}
