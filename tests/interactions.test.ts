import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { authHeaders } from './helpers.js';

async function createPerson(app: ReturnType<typeof createApp>, headers: Record<string, string>, name = 'Alice') {
  const res = await app.request('/api/v1/people', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name }),
  });
  const { data } = await res.json() as { data: { id: string } };
  return data.id;
}

describe('Interactions CRUD', () => {
  const app = createApp();

  it('logs and retrieves an interaction', async () => {
    const headers = await authHeaders();
    const personId = await createPerson(app, headers);

    const res = await app.request('/api/v1/interactions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        personId,
        occurredAt: new Date().toISOString(),
        type: 'call',
        sentiment: 'positive',
      }),
    });
    expect(res.status).toBe(201);
    const { data: created } = await res.json() as { data: { id: string; type: string } };
    expect(created.type).toBe('call');

    const getRes = await app.request(`/api/v1/interactions/${created.id}`, { headers });
    expect(getRes.status).toBe(200);
  });

  it('lists interactions filtered by person_id', async () => {
    const headers = await authHeaders();
    const personId = await createPerson(app, headers);

    await app.request('/api/v1/interactions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ personId, occurredAt: new Date().toISOString(), type: 'meeting' }),
    });

    const res = await app.request(`/api/v1/interactions?person_id=${personId}`, { headers });
    const body = await res.json() as { data: unknown[] };
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 404 when person does not exist', async () => {
    const headers = await authHeaders();
    const res = await app.request('/api/v1/interactions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        personId: '00000000-0000-0000-0000-000000000000',
        occurredAt: new Date().toISOString(),
        type: 'call',
      }),
    });
    expect(res.status).toBe(404);
  });

  it('updates an interaction', async () => {
    const headers = await authHeaders();
    const personId = await createPerson(app, headers);
    const createRes = await app.request('/api/v1/interactions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ personId, occurredAt: new Date().toISOString(), type: 'email' }),
    });
    const { data: created } = await createRes.json() as { data: { id: string } };

    const res = await app.request(`/api/v1/interactions/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ notes: 'Updated note' }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: { notes: string } };
    expect(data.notes).toBe('Updated note');
  });
});
