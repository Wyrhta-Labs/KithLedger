import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/config/env.js';
import { sign } from 'hono/jwt';

async function getJwt() {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: 'admin', iat: now, exp: now + 3600 }, config.jwtSecret);
}

async function authHeaders() {
  return { Authorization: `Bearer ${await getJwt()}`, 'Content-Type': 'application/json' };
}

describe('People CRUD', () => {
  const app = createApp();

  it('creates a person', async () => {
    const res = await app.request('/api/v1/people', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ name: 'Alice', email: 'alice@example.com', tags: ['friend'] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { id: string; name: string } };
    expect(body.data.name).toBe('Alice');
    expect(body.data.id).toBeTruthy();
  });

  it('lists people', async () => {
    const headers = await authHeaders();
    await app.request('/api/v1/people', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Bob' }),
    });
    const res = await app.request('/api/v1/people', { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; meta: { total: number } };
    expect(body.data.length).toBeGreaterThan(0);
    expect(typeof body.meta.total).toBe('number');
  });

  it('gets a person by id', async () => {
    const headers = await authHeaders();
    const createRes = await app.request('/api/v1/people', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Carol' }),
    });
    const { data: created } = await createRes.json() as { data: { id: string } };

    const res = await app.request(`/api/v1/people/${created.id}`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { name: string } };
    expect(body.data.name).toBe('Carol');
  });

  it('returns 404 for unknown person', async () => {
    const res = await app.request('/api/v1/people/00000000-0000-0000-0000-000000000000', {
      headers: await authHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it('patches a person', async () => {
    const headers = await authHeaders();
    const createRes = await app.request('/api/v1/people', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Dave' }),
    });
    const { data: created } = await createRes.json() as { data: { id: string } };

    const res = await app.request(`/api/v1/people/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'David' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { name: string } };
    expect(body.data.name).toBe('David');
  });

  it('deletes a person', async () => {
    const headers = await authHeaders();
    const createRes = await app.request('/api/v1/people', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Eve' }),
    });
    const { data: created } = await createRes.json() as { data: { id: string } };

    const delRes = await app.request(`/api/v1/people/${created.id}`, {
      method: 'DELETE',
      headers,
    });
    expect(delRes.status).toBe(200);

    const getRes = await app.request(`/api/v1/people/${created.id}`, { headers });
    expect(getRes.status).toBe(404);
  });

  it('filters people by query', async () => {
    const headers = await authHeaders();
    await app.request('/api/v1/people', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Unique123Person' }),
    });

    const res = await app.request('/api/v1/people?q=Unique123', { headers });
    const body = await res.json() as { data: unknown[] };
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.request('/api/v1/people');
    expect(res.status).toBe(401);
  });
});
