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

async function createPerson(app: ReturnType<typeof createApp>, headers: Record<string, string>) {
  const res = await app.request('/api/v1/people', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Test Person' }),
  });
  const { data } = await res.json() as { data: { id: string } };
  return data.id;
}

describe('Reminders', () => {
  const app = createApp();

  it('creates and retrieves a reminder', async () => {
    const headers = await authHeaders();
    const personId = await createPerson(app, headers);
    const dueAt = new Date(Date.now() + 86400000).toISOString();

    const res = await app.request('/api/v1/reminders', {
      method: 'POST',
      headers,
      body: JSON.stringify({ personId, dueAt, title: 'Call back' }),
    });
    expect(res.status).toBe(201);
    const { data: created } = await res.json() as { data: { id: string; title: string; status: string } };
    expect(created.title).toBe('Call back');
    expect(created.status).toBe('pending');

    const getRes = await app.request(`/api/v1/reminders/${created.id}`, { headers });
    expect(getRes.status).toBe(200);
  });

  it('completes a reminder without recurrence', async () => {
    const headers = await authHeaders();
    const personId = await createPerson(app, headers);
    const createRes = await app.request('/api/v1/reminders', {
      method: 'POST',
      headers,
      body: JSON.stringify({ personId, dueAt: new Date().toISOString(), title: 'One-time' }),
    });
    const { data: created } = await createRes.json() as { data: { id: string } };

    const res = await app.request(`/api/v1/reminders/${created.id}/complete`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: { updated: { status: string }; next: null } };
    expect(data.updated.status).toBe('done');
    expect(data.next).toBeNull();
  });

  it('completes a recurring reminder and creates next', async () => {
    const headers = await authHeaders();
    const personId = await createPerson(app, headers);
    const createRes = await app.request('/api/v1/reminders', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        personId,
        dueAt: new Date().toISOString(),
        title: 'Monthly check-in',
        recurrence: 'P1M',
      }),
    });
    const { data: created } = await createRes.json() as { data: { id: string } };

    const res = await app.request(`/api/v1/reminders/${created.id}/complete`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: { updated: { status: string }; next: { id: string; recurrence: string } } };
    expect(data.updated.status).toBe('done');
    expect(data.next).toBeTruthy();
    expect(data.next.recurrence).toBe('P1M');
  });

  it('snoozes a reminder', async () => {
    const headers = await authHeaders();
    const personId = await createPerson(app, headers);
    const createRes = await app.request('/api/v1/reminders', {
      method: 'POST',
      headers,
      body: JSON.stringify({ personId, dueAt: new Date().toISOString(), title: 'Snooze me' }),
    });
    const { data: created } = await createRes.json() as { data: { id: string } };

    const snoozeUntil = new Date(Date.now() + 3600000).toISOString();
    const res = await app.request(`/api/v1/reminders/${created.id}/snooze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ snooze_until: snoozeUntil }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: { status: string } };
    expect(data.status).toBe('snoozed');
  });

  it('dismisses a reminder', async () => {
    const headers = await authHeaders();
    const personId = await createPerson(app, headers);
    const createRes = await app.request('/api/v1/reminders', {
      method: 'POST',
      headers,
      body: JSON.stringify({ personId, dueAt: new Date().toISOString(), title: 'Dismiss me' }),
    });
    const { data: created } = await createRes.json() as { data: { id: string } };

    const res = await app.request(`/api/v1/reminders/${created.id}/dismiss`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: { status: string } };
    expect(data.status).toBe('dismissed');
  });
});
