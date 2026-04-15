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

  it('creates a birthday reminder when a birthday is set', async () => {
    const headers = await authHeaders();
    const res = await app.request('/api/v1/people', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Frank', birthday: '1990-05-10' }),
    });
    expect(res.status).toBe(201);

    const remindersRes = await app.request('/api/v1/reminders', { headers });
    expect(remindersRes.status).toBe(200);
    const body = await remindersRes.json() as {
      data: Array<{ kind: string; title: string; personId: string; dueAt: string }>;
    };
    const birthdayReminder = body.data.find((reminder) => reminder.kind === 'birthday');
    expect(birthdayReminder).toBeTruthy();
    expect(birthdayReminder?.title).toBe('Frank turns 36');
    expect(birthdayReminder?.dueAt).toBe('2026-05-10T12:00:00.000Z');
  });

  it('creates and removes the birthday reminder when birthday is added or cleared', async () => {
    const headers = await authHeaders();
    const createRes = await app.request('/api/v1/people', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Grace' }),
    });
    const { data: created } = await createRes.json() as { data: { id: string } };

    const addBirthdayRes = await app.request(`/api/v1/people/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ birthday: '1988-11-02' }),
    });
    expect(addBirthdayRes.status).toBe(200);

    const remindersAfterAdd = await app.request(`/api/v1/reminders?person_id=${created.id}`, { headers });
    const addedBody = await remindersAfterAdd.json() as {
      data: Array<{ id: string; kind: string; title: string }>;
    };
    expect(addedBody.data).toHaveLength(1);
    expect(addedBody.data[0]?.kind).toBe('birthday');
    expect(addedBody.data[0]?.title).toBe('Grace turns 38');

    const clearBirthdayRes = await app.request(`/api/v1/people/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ birthday: null }),
    });
    expect(clearBirthdayRes.status).toBe(200);

    const remindersAfterClear = await app.request(`/api/v1/reminders?person_id=${created.id}`, { headers });
    const clearedBody = await remindersAfterClear.json() as { data: unknown[] };
    expect(clearedBody.data).toHaveLength(0);
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
