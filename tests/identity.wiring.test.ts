import { describe, it, expect } from 'vitest';
import { identity, requireAuth, requireJwt, API_KEY_PREFIX, seedAdmin, getAdminUser, satelliteJwks } from '../src/identity.js';
import { config } from '../src/config/env.js';

describe('identity wiring', () => {
  it('exposes a configured core identity service and guards', () => {
    expect(API_KEY_PREFIX).toBe('kl_');
    expect(typeof identity.authenticate).toBe('function');
    expect(typeof identity.issueToken).toBe('function');
    expect(typeof identity.createApiKey).toBe('function');
    expect(typeof identity.validateApiKey).toBe('function');
    expect(typeof requireAuth).toBe('function');
    expect(typeof requireJwt).toBe('function');
    expect(typeof seedAdmin).toBe('function');
    expect(typeof getAdminUser).toBe('function');
  });

  it('leaves satellite verification off unless the env group is configured', () => {
    // B1d: absent configuration means the auth path is byte-for-byte what it
    // was — no JWKS client, no satellite branch.
    expect(config.satelliteAuth).toBeNull();
    expect(satelliteJwks).toBeNull();
    expect(typeof requireAuth).toBe('function');
  });
});
