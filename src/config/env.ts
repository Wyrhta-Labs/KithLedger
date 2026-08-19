import { readFileSync } from 'node:fs';
import { z } from 'zod';

// Load .env from the working directory for local dev (`npm run dev` etc.).
// Never overrides variables already present in the environment — exported
// vars always win, so test runs pointing DATABASE_URL at the test database
// cannot be hijacked by a dev .env. Full-line comments only (no inline `#`).
try {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
    }
  }
} catch {
  // no .env file — rely on the real environment (CI, docker, production)
}

/** Treat an empty string as "not provided" (undefined), then apply `inner`. */
function emptyToUndefined<T extends z.ZodTypeAny>(inner: T) {
  return z.preprocess((v) => (v === '' ? undefined : v), inner.optional());
}

/**
 * The schema, exported so tests can exercise the optional groups without
 * re-importing this module (parsing here happens once, at import time).
 */
export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters for HS256 security'),
  ADMIN_PASSWORD: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(3000),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  CORS_ORIGIN: z.string().default('*'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  // Satellite identity — verifying Heorth-issued member tokens (B1d, ADR 0009).
  //
  // Heorth is the household's identity provider. It SIGNS short-lived,
  // audience-bound member tokens with an asymmetric key and publishes the
  // public half at `/.well-known/jwks.json`; KithLedger only ever VERIFIES
  // and holds no signing key for this — that is the entire point of the
  // asymmetric choice (ADR 0009). Nothing here is a secret: a JWKS URL and
  // two names.
  //
  // Optional AS A GROUP, the same contract Heorth uses for M365_*/KITH_*:
  // URL + audience present -> satellite tokens are accepted; both absent (the
  // default) -> KithLedger behaves exactly as today and satellite-token
  // verification is simply unavailable. Partial presence is a startup error
  // (see superRefine). `emptyToUndefined` so a blank placeholder in `.env`
  // counts as absent rather than as a validation failure.
  HEORTH_JWKS_URL: emptyToUndefined(z.string().url()),
  // This service's own audience name — the `aud` claim Heorth mints FOR
  // KithLedger, and the only value accepted. A token minted for another
  // satellite is rejected.
  SATELLITE_AUDIENCE: emptyToUndefined(z.string().min(1)),
  // Expected `iss`. Optional WITHIN the group (`heorth` is the only issuer
  // the household has); setting it alone, without the group, is a startup
  // error.
  HEORTH_ISSUER: emptyToUndefined(z.string().min(1)),
}).superRefine((env, ctx) => {
  const group = ['HEORTH_JWKS_URL', 'SATELLITE_AUDIENCE'] as const;
  const present = group.filter((k) => env[k] !== undefined && env[k] !== '');
  if (present.length === 1) {
    const missing = group.filter((k) => env[k] === undefined || env[k] === '');
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SATELLITE'],
      message:
        `Satellite token verification is partially configured — set all of [${group.join(', ')}] ` +
        `or none. Missing: ${missing.join(', ')}.`,
    });
  }
  if (present.length === 0 && env.HEORTH_ISSUER !== undefined && env.HEORTH_ISSUER !== '') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SATELLITE'],
      message:
        'HEORTH_ISSUER is set without the satellite group — also set HEORTH_JWKS_URL and ' +
        'SATELLITE_AUDIENCE, or unset it.',
    });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

/** The verification side of ADR 0009, or `null` when unconfigured. */
export interface SatelliteAuthConfig {
  /** Heorth's public key set, e.g. `http://heorth:4000/.well-known/jwks.json`. */
  jwksUrl: string;
  /** Expected `iss` claim. */
  issuer: string;
  /** Expected `aud` claim — this service's own audience name. */
  audience: string;
}

function satelliteAuthConfig(env: z.infer<typeof envSchema>): SatelliteAuthConfig | null {
  if (!env.HEORTH_JWKS_URL || !env.SATELLITE_AUDIENCE) return null;
  return {
    jwksUrl: env.HEORTH_JWKS_URL,
    issuer: env.HEORTH_ISSUER ?? 'heorth',
    audience: env.SATELLITE_AUDIENCE,
  };
}

export const config = {
  databaseUrl: parsed.data.DATABASE_URL,
  jwtSecret: parsed.data.JWT_SECRET,
  adminPassword: parsed.data.ADMIN_PASSWORD,
  port: parsed.data.API_PORT,
  jwtTtlSeconds: parsed.data.JWT_TTL_SECONDS,
  corsOrigin: parsed.data.CORS_ORIGIN,
  dbPoolMax: parsed.data.DB_POOL_MAX,
  /**
   * Satellite-token verification, or `null` when the group is absent (the
   * default) — in which case nothing about the auth path changes.
   */
  satelliteAuth: satelliteAuthConfig(parsed.data),
} as const;
