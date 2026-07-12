import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';
import { seedAdmin } from '../src/identity.js';
import { config } from '../src/config/env.js';

const app = createApp();

beforeEach(async () => {
  await seedAdmin(); // beforeEach truncation wipes users; reseed for auth flow
});

describe('POST /api/v1/auth/token', () => {
  it('issues a JWT for the correct admin password', async () => {
    const res = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: config.adminPassword }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { token: string; expires_in: number } };
    expect(body.data.token.split('.').length).toBe(3); // JWT
    expect(body.data.expires_in).toBeGreaterThan(0);
  });

  it('rejects a wrong password with 401', async () => {
    const res = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'definitely-wrong' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('API key lifecycle (JWT-only routes)', () => {
  async function jwt() {
    const res = await app.request('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: config.adminPassword }),
    });
    return ((await res.json()) as { data: { token: string } }).data.token;
  }

  it('creates, lists, uses, and revokes a kl_ key', async () => {
    const token = await jwt();
    const authJwt = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const createRes = await app.request('/api/v1/auth/keys', {
      method: 'POST',
      headers: authJwt,
      body: JSON.stringify({ name: 'agent' }),
    });
    expect(createRes.status).toBe(201);
    const created = ((await createRes.json()) as { data: { key: string; id: string } }).data;
    expect(created.key.startsWith('kl_')).toBe(true);

    // The raw key authenticates a protected domain route
    const useRes = await app.request('/api/v1/people', {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(useRes.status).toBe(200);

    // Listing is JWT-only; the kl_ key must be rejected there
    const listWithKey = await app.request('/api/v1/auth/keys', {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(listWithKey.status).toBe(401);

    const listRes = await app.request('/api/v1/auth/keys', { headers: authJwt });
    expect(listRes.status).toBe(200);

    const delRes = await app.request(`/api/v1/auth/keys/${created.id}`, {
      method: 'DELETE',
      headers: authJwt,
    });
    expect(delRes.status).toBe(200);
  });
});
