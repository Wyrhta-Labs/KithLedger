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

async function createPerson(app: ReturnType<typeof createApp>, headers: Record<string, string>, name = 'Alice') {
  const res = await app.request('/api/v1/people', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name }),
  });
  const { data } = await res.json() as { data: { id: string } };
  return data.id;
}

describe('Setting values', () => {
  const app = createApp();

  it('returns seeded interaction and relationship type values', async () => {
    const headers = await authHeaders();
    const res = await app.request('/api/v1/settings/values', { headers });
    expect(res.status).toBe(200);

    const { data } = await res.json() as { data: Array<{ category: string; value: string }> };
    expect(data).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'interaction.type', value: 'meeting' }),
      expect.objectContaining({ category: 'relationship.type', value: 'friend' }),
    ]));
  });

  it('allows adding a custom interaction type and using it immediately', async () => {
    const headers = await authHeaders();
    const createValueRes = await app.request('/api/v1/settings/values', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        category: 'interaction.type',
        value: 'coffee-chat',
        label: 'Coffee Chat',
      }),
    });
    expect(createValueRes.status).toBe(201);

    const personId = await createPerson(app, headers);
    const interactionRes = await app.request('/api/v1/interactions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        personId,
        occurredAt: new Date().toISOString(),
        type: 'coffee-chat',
      }),
    });

    expect(interactionRes.status).toBe(201);
    const { data } = await interactionRes.json() as { data: { type: string } };
    expect(data.type).toBe('coffee-chat');
  });

  it('rejects creating a relationship with an inactive type', async () => {
    const headers = await authHeaders();
    const createValueRes = await app.request('/api/v1/settings/values', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        category: 'relationship.type',
        value: 'teammate',
        label: 'Teammate',
      }),
    });
    const { data: created } = await createValueRes.json() as { data: { id: string } };

    const disableRes = await app.request(`/api/v1/settings/values/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ isActive: false }),
    });
    expect(disableRes.status).toBe(200);

    const aliceId = await createPerson(app, headers, 'Alice');
    const bobId = await createPerson(app, headers, 'Bob');

    const relationshipRes = await app.request('/api/v1/relationships', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        fromPersonId: aliceId,
        toPersonId: bobId,
        type: 'teammate',
      }),
    });

    expect(relationshipRes.status).toBe(400);
  });

  it('renames stored values and migrates existing interaction rows', async () => {
    const headers = await authHeaders();
    const createValueRes = await app.request('/api/v1/settings/values', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        category: 'interaction.type',
        value: 'walk',
        label: 'Walk',
      }),
    });
    const { data: createdValue } = await createValueRes.json() as { data: { id: string } };

    const personId = await createPerson(app, headers);
    const createInteractionRes = await app.request('/api/v1/interactions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        personId,
        occurredAt: new Date().toISOString(),
        type: 'walk',
      }),
    });
    const { data: createdInteraction } = await createInteractionRes.json() as { data: { id: string } };

    const updateValueRes = await app.request(`/api/v1/settings/values/${createdValue.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        value: 'walk-and-talk',
        label: 'Walk and Talk',
      }),
    });
    expect(updateValueRes.status).toBe(200);

    const getInteractionRes = await app.request(`/api/v1/interactions/${createdInteraction.id}`, { headers });
    const { data: updatedInteraction } = await getInteractionRes.json() as { data: { type: string } };
    expect(updatedInteraction.type).toBe('walk-and-talk');
  });

  it('prevents deleting a value that is still in use', async () => {
    const headers = await authHeaders();
    const createValueRes = await app.request('/api/v1/settings/values', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        category: 'interaction.type',
        value: 'voice-note',
        label: 'Voice Note',
      }),
    });
    const { data: createdValue } = await createValueRes.json() as { data: { id: string } };

    const personId = await createPerson(app, headers);
    await app.request('/api/v1/interactions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        personId,
        occurredAt: new Date().toISOString(),
        type: 'voice-note',
      }),
    });

    const deleteRes = await app.request(`/api/v1/settings/values/${createdValue.id}`, {
      method: 'DELETE',
      headers,
    });

    expect(deleteRes.status).toBe(409);
  });
});
