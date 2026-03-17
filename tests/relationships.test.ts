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

async function createPerson(app: ReturnType<typeof createApp>, headers: Record<string, string>, name: string) {
  const res = await app.request('/api/v1/people', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name }),
  });
  const { data } = await res.json() as { data: { id: string } };
  return data.id;
}

describe('Relationships', () => {
  const app = createApp();

  it('creates a relationship', async () => {
    const headers = await authHeaders();
    const aliceId = await createPerson(app, headers, 'Alice');
    const bobId = await createPerson(app, headers, 'Bob');

    const res = await app.request('/api/v1/relationships', {
      method: 'POST',
      headers,
      body: JSON.stringify({ fromPersonId: aliceId, toPersonId: bobId, type: 'friend' }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json() as { data: { type: string; isMutual: boolean } };
    expect(data.type).toBe('friend');
    expect(data.isMutual).toBe(true);
  });

  it('rejects self-relationships', async () => {
    const headers = await authHeaders();
    const aliceId = await createPerson(app, headers, 'Alice');

    const res = await app.request('/api/v1/relationships', {
      method: 'POST',
      headers,
      body: JSON.stringify({ fromPersonId: aliceId, toPersonId: aliceId, type: 'friend' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate relationships with CONFLICT', async () => {
    const headers = await authHeaders();
    const aliceId = await createPerson(app, headers, 'Alice');
    const bobId = await createPerson(app, headers, 'Bob');

    await app.request('/api/v1/relationships', {
      method: 'POST',
      headers,
      body: JSON.stringify({ fromPersonId: aliceId, toPersonId: bobId, type: 'friend' }),
    });

    const res = await app.request('/api/v1/relationships', {
      method: 'POST',
      headers,
      body: JSON.stringify({ fromPersonId: aliceId, toPersonId: bobId, type: 'colleague' }),
    });
    expect(res.status).toBe(409);
  });

  it('returns the ego network graph', async () => {
    const headers = await authHeaders();
    const aliceId = await createPerson(app, headers, 'Alice');
    const bobId = await createPerson(app, headers, 'Bob');
    const carolId = await createPerson(app, headers, 'Carol');

    await app.request('/api/v1/relationships', {
      method: 'POST',
      headers,
      body: JSON.stringify({ fromPersonId: aliceId, toPersonId: bobId, type: 'friend' }),
    });
    await app.request('/api/v1/relationships', {
      method: 'POST',
      headers,
      body: JSON.stringify({ fromPersonId: aliceId, toPersonId: carolId, type: 'colleague' }),
    });

    const res = await app.request(`/api/v1/people/${aliceId}/graph`, { headers });
    expect(res.status).toBe(200);
    const { data, meta } = await res.json() as {
      data: { nodes: { id: string }[]; edges: unknown[] };
      meta: { root_person_id: string; depth: number };
    };
    expect(meta.root_person_id).toBe(aliceId);
    expect(data.nodes.length).toBe(3);
    expect(data.edges.length).toBe(2);
  });
});
