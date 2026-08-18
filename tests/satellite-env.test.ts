import { describe, it, expect } from 'vitest';
import { envSchema } from '../src/config/env.js';

/**
 * The satellite-verification env group (B1d) is optional AS A GROUP: both
 * `HEORTH_JWKS_URL` and `SATELLITE_AUDIENCE` or neither. Absent is the default
 * and means KithLedger behaves exactly as before.
 */

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/kithledger_test',
  JWT_SECRET: 'x'.repeat(32),
  ADMIN_PASSWORD: 'secret',
};

const JWKS_URL = 'http://heorth:4000/.well-known/jwks.json';

describe('satellite verification env group', () => {
  it('is absent by default and parses fine', () => {
    const parsed = envSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.HEORTH_JWKS_URL).toBeUndefined();
    expect(parsed.data.SATELLITE_AUDIENCE).toBeUndefined();
  });

  it('accepts the full group, defaulting the issuer to heorth', () => {
    const parsed = envSchema.safeParse({
      ...base,
      HEORTH_JWKS_URL: JWKS_URL,
      SATELLITE_AUDIENCE: 'kithledger',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.HEORTH_ISSUER).toBeUndefined(); // `heorth` applied in config
  });

  it('accepts an explicit issuer', () => {
    expect(
      envSchema.safeParse({
        ...base,
        HEORTH_JWKS_URL: JWKS_URL,
        SATELLITE_AUDIENCE: 'kithledger',
        HEORTH_ISSUER: 'heorth',
      }).success,
    ).toBe(true);
  });

  it('rejects partial configuration — URL without audience', () => {
    const parsed = envSchema.safeParse({ ...base, HEORTH_JWKS_URL: JWKS_URL });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(JSON.stringify(parsed.error.issues)).toMatch(/SATELLITE_AUDIENCE/);
  });

  it('rejects partial configuration — audience without URL', () => {
    const parsed = envSchema.safeParse({ ...base, SATELLITE_AUDIENCE: 'kithledger' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(JSON.stringify(parsed.error.issues)).toMatch(/HEORTH_JWKS_URL/);
  });

  it('rejects an orphaned issuer', () => {
    expect(envSchema.safeParse({ ...base, HEORTH_ISSUER: 'heorth' }).success).toBe(false);
  });

  it('treats blank values as absent, not as errors', () => {
    const parsed = envSchema.safeParse({
      ...base,
      HEORTH_JWKS_URL: '',
      SATELLITE_AUDIENCE: '',
      HEORTH_ISSUER: '',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a non-URL JWKS endpoint', () => {
    expect(
      envSchema.safeParse({ ...base, HEORTH_JWKS_URL: 'heorth', SATELLITE_AUDIENCE: 'kithledger' })
        .success,
    ).toBe(false);
  });
});
