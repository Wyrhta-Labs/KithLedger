import { describe, it, expect, beforeEach } from 'vitest';
import { identity, seedAdmin, getAdminUser } from '../src/identity.js';
import { createMcpAuthAdapter, mcpAuthAdapter } from '../src/mcp/auth.js';

describe('createMcpAuthAdapter', () => {
  beforeEach(async () => {
    await seedAdmin();
  });

  it('resolves a valid kl_ key to the admin principal', async () => {
    const admin = await getAdminUser();
    const key = await identity.createApiKey(admin.id, 'mcp');

    const principal = await createMcpAuthAdapter(() => key.key).resolve();

    expect(principal).toEqual({ userId: admin.id, role: 'admin' });
  });

  it('rejects an unknown kl_ key', async () => {
    await expect(createMcpAuthAdapter(() => 'kl_deadbeef').resolve()).rejects.toThrow();
  });

  it('rejects a non-kl_ credential (e.g. a JWT)', async () => {
    await expect(
      createMcpAuthAdapter(() => 'eyJhbGciOi.fake.jwt').resolve(),
    ).rejects.toThrow();
  });

  it('rejects a missing credential', async () => {
    await expect(createMcpAuthAdapter(() => undefined).resolve()).rejects.toThrow();
  });
});

describe('mcpAuthAdapter (default, env-bound)', () => {
  it('is exported and has a resolve function', () => {
    expect(typeof mcpAuthAdapter.resolve).toBe('function');
  });
});
