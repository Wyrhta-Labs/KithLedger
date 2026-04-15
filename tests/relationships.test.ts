import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/config/env.js';
import { sign } from 'hono/jwt';
import { db } from '../src/db/index.js';
import { people, relationships } from '../src/db/schema/index.js';

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
      data: { nodes: { id: string; depth: number }[]; edges: { source: string; target: string; type: string; isMutual: boolean }[] };
      meta: { root_person_id: string; depth: number };
    };
    expect(meta.root_person_id).toBe(aliceId);
    expect(data.nodes.length).toBe(3);
    expect(data.edges.length).toBe(2);
    expect(data.nodes.find((node) => node.id === aliceId)?.depth).toBe(0);
    expect(data.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: aliceId, target: bobId, type: 'friend', isMutual: true }),
        expect.objectContaining({ source: aliceId, target: carolId, type: 'colleague', isMutual: true }),
      ])
    );
  });

  it('returns second-degree connections when depth=2', async () => {
    const headers = await authHeaders();
    const [alice] = await db.insert(people).values({ name: 'Alice Depth 2' }).returning();
    const [bob] = await db.insert(people).values({ name: 'Bob Depth 2' }).returning();
    const [carol] = await db.insert(people).values({ name: 'Carol Depth 2' }).returning();

    await db.insert(relationships).values([
      { fromPersonId: alice.id, toPersonId: bob.id, type: 'friend', isMutual: true },
      { fromPersonId: bob.id, toPersonId: carol.id, type: 'colleague', isMutual: true },
    ]);

    const res = await app.request(`/api/v1/people/${alice.id}/graph?depth=2`, { headers });
    expect(res.status).toBe(200);

    const { data, meta } = await res.json() as {
      data: { nodes: { id: string; depth: number }[]; edges: { source: string; target: string }[] };
      meta: { root_person_id: string; depth: number };
    };

    expect(meta.root_person_id).toBe(alice.id);
    expect(meta.depth).toBe(2);
    expect(data.nodes.map((node) => node.id).sort()).toEqual([alice.id, bob.id, carol.id].sort());
    expect(data.edges).toHaveLength(2);
    expect(data.nodes.find((node) => node.id === bob.id)?.depth).toBe(1);
    expect(data.nodes.find((node) => node.id === carol.id)?.depth).toBe(2);
  });

  it('returns the global graph with isolated people included', async () => {
    const headers = await authHeaders();
    const aliceId = await createPerson(app, headers, 'Global Alice');
    const bobId = await createPerson(app, headers, 'Global Bob');
    const irisId = await createPerson(app, headers, 'Isolated Iris');

    await app.request('/api/v1/relationships', {
      method: 'POST',
      headers,
      body: JSON.stringify({ fromPersonId: aliceId, toPersonId: bobId, type: 'friend' }),
    });

    const res = await app.request('/api/v1/graph', { headers });
    expect(res.status).toBe(200);

    const { data, meta } = await res.json() as {
      data: { nodes: { id: string; depth: number }[]; edges: { source: string; target: string; type: string; isMutual: boolean }[] };
      meta: { root_person_id: string | null; depth: number; mode: 'all' | 'person' };
    };

    expect(meta).toEqual({ root_person_id: null, depth: 0, mode: 'all' });
    expect(data.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([aliceId, bobId, irisId]));
    expect(data.nodes.find((node) => node.id === irisId)?.depth).toBe(1);
    expect(data.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: aliceId, target: bobId, type: 'friend', isMutual: true }),
      ])
    );
  });
});
