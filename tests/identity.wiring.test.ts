import { describe, it, expect } from 'vitest';
import { identity, requireAuth, requireJwt, API_KEY_PREFIX, seedAdmin, getAdminUser } from '../src/identity.js';

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
});
