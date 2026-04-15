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

  it('completes a weekly recurring reminder and creates the next weekly reminder', async () => {
    const headers = await authHeaders();
    const personId = await createPerson(app, headers);
    const dueAt = '2026-04-15T10:00:00.000Z';
    const createRes = await app.request('/api/v1/reminders', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        personId,
        dueAt,
        title: 'Weekly check-in',
        recurrence: 'P1W',
      }),
    });
    const { data: created } = await createRes.json() as { data: { id: string } };

    const res = await app.request(`/api/v1/reminders/${created.id}/complete`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const { data } = await res.json() as {
      data: { updated: { status: string }; next: { dueAt: string; recurrence: string } };
    };
    expect(data.updated.status).toBe('done');
    expect(data.next.recurrence).toBe('P1W');
    expect(data.next.dueAt).toBe('2026-04-22T10:00:00.000Z');
  });

  it('completes a bi-weekly recurring reminder and creates the next bi-weekly reminder', async () => {
    const headers = await authHeaders();
    const personId = await createPerson(app, headers);
    const dueAt = '2026-04-15T10:00:00.000Z';
    const createRes = await app.request('/api/v1/reminders', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        personId,
        dueAt,
        title: 'Bi-weekly check-in',
        recurrence: 'P2W',
      }),
    });
    const { data: created } = await createRes.json() as { data: { id: string } };

    const res = await app.request(`/api/v1/reminders/${created.id}/complete`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const { data } = await res.json() as {
      data: { updated: { status: string }; next: { dueAt: string; recurrence: string } };
    };
    expect(data.updated.status).toBe('done');
    expect(data.next.recurrence).toBe('P2W');
    expect(data.next.dueAt).toBe('2026-04-29T10:00:00.000Z');
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

  it('prevents deleting birthday reminders and lets them be hidden', async () => {
    const headers = await authHeaders();
    const personRes = await app.request('/api/v1/people', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Birthday Person', birthday: '2000-04-20' }),
    });
    const { data: person } = await personRes.json() as { data: { id: string } };

    const listRes = await app.request(`/api/v1/reminders?person_id=${person.id}`, { headers });
    const listBody = await listRes.json() as { data: Array<{ id: string; kind: string; title: string }> };
    const birthdayReminder = listBody.data.find((reminder) => reminder.kind === 'birthday');
    expect(birthdayReminder?.title).toBe('Birthday Person turns 26');

    const deleteRes = await app.request(`/api/v1/reminders/${birthdayReminder!.id}`, {
      method: 'DELETE',
      headers,
    });
    expect(deleteRes.status).toBe(409);

    const hideRes = await app.request(`/api/v1/reminders/${birthdayReminder!.id}/hide`, {
      method: 'POST',
      headers,
    });
    expect(hideRes.status).toBe(200);

    const visibleRes = await app.request(`/api/v1/reminders?person_id=${person.id}`, { headers });
    const visibleBody = await visibleRes.json() as { data: unknown[] };
    expect(visibleBody.data).toHaveLength(0);

    const hiddenRes = await app.request(`/api/v1/reminders?person_id=${person.id}&include_hidden=true`, { headers });
    const hiddenBody = await hiddenRes.json() as { data: Array<{ isHidden: boolean }> };
    expect(hiddenBody.data).toHaveLength(1);
    expect(hiddenBody.data[0]?.isHidden).toBe(true);
  });

  it('can unhide a hidden birthday reminder', async () => {
    const headers = await authHeaders();
    const personRes = await app.request('/api/v1/people', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Hidden Birthday', birthday: '1992-10-09' }),
    });
    const { data: person } = await personRes.json() as { data: { id: string } };

    const listRes = await app.request(`/api/v1/reminders?person_id=${person.id}`, { headers });
    const listBody = await listRes.json() as { data: Array<{ id: string; kind: string }> };
    const birthdayReminder = listBody.data.find((reminder) => reminder.kind === 'birthday');

    await app.request(`/api/v1/reminders/${birthdayReminder!.id}/hide`, {
      method: 'POST',
      headers,
    });

    const unhideRes = await app.request(`/api/v1/reminders/${birthdayReminder!.id}/unhide`, {
      method: 'POST',
      headers,
    });
    expect(unhideRes.status).toBe(200);
    const unhideBody = await unhideRes.json() as { data: { isHidden: boolean } };
    expect(unhideBody.data.isHidden).toBe(false);

    const visibleRes = await app.request(`/api/v1/reminders?person_id=${person.id}`, { headers });
    const visibleBody = await visibleRes.json() as { data: Array<{ id: string }> };
    expect(visibleBody.data).toHaveLength(1);
    expect(visibleBody.data[0]?.id).toBe(birthdayReminder!.id);
  });

  it('advances a birthday reminder in place when completed', async () => {
    const headers = await authHeaders();
    const personRes = await app.request('/api/v1/people', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Henry', birthday: '1995-12-15' }),
    });
    const { data: person } = await personRes.json() as { data: { id: string } };

    const listRes = await app.request(`/api/v1/reminders?person_id=${person.id}`, { headers });
    const listBody = await listRes.json() as { data: Array<{ id: string; kind: string; dueAt: string; title: string }> };
    const birthdayReminder = listBody.data.find((reminder) => reminder.kind === 'birthday');
    expect(birthdayReminder?.dueAt).toBe('2026-12-15T12:00:00.000Z');
    expect(birthdayReminder?.title).toBe('Henry turns 31');

    const completeRes = await app.request(`/api/v1/reminders/${birthdayReminder!.id}/complete`, {
      method: 'POST',
      headers,
    });
    expect(completeRes.status).toBe(200);
    const completeBody = await completeRes.json() as {
      data: { updated: { id: string; dueAt: string; title: string; status: string }; next: null };
    };
    expect(completeBody.data.next).toBeNull();
    expect(completeBody.data.updated.id).toBe(birthdayReminder!.id);
    expect(completeBody.data.updated.dueAt).toBe('2027-12-15T12:00:00.000Z');
    expect(completeBody.data.updated.title).toBe('Henry turns 32');
    expect(completeBody.data.updated.status).toBe('pending');
  });
});
