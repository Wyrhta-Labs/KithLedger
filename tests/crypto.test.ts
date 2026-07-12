import { describe, it, expect } from 'vitest';
import { generateApiKey } from '@wyrhta/core/lib';

describe('core generateApiKey with kl_ prefix', () => {
  it('produces a kl_ raw key and a stable hash', () => {
    const { raw, hash, prefix } = generateApiKey({ prefix: 'kl_' });
    expect(raw.startsWith('kl_')).toBe(true);
    expect(raw.length).toBe(3 + 64); // 'kl_' + 32-byte hex
    expect(prefix.startsWith('kl_')).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
  });
});
