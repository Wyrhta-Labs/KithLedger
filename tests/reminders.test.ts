import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { authHeaders } from './helpers.js';

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

describe('Birthday reminders', () => {
  const app = createApp();

  async function personWithBirthday(headers: Record<string, string>, birthday: string) {
    const res = await app.request('/api/v1/people', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Birthday Person', birthday }),
    });
    const { data } = await res.json() as { data: { id: string } };
    return data.id;
  }

  it('defaults kind to generic', async () => {
    const headers = await authHeaders();
    const personId = await createPerson(app, headers);
    const res = await app.request('/api/v1/reminders', {
      method: 'POST',
      headers,
      body: JSON.stringify({ personId, dueAt: new Date().toISOString(), title: 'Plain' }),
    });
    const { data } = await res.json() as { data: { kind: string; leadDays: number | null } };
    expect(data.kind).toBe('generic');
    expect(data.leadDays).toBeNull();
  });

  it('persists kind=birthday and leadDays', async () => {
    // Guards the bug where createReminder's explicit column list dropped kind,
    // silently storing every birthday reminder as generic.
    const headers = await authHeaders();
    const personId = await personWithBirthday(headers, '1990-03-01');
    const res = await app.request('/api/v1/reminders', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        personId,
        dueAt: '2027-02-28T08:00:00.000Z',
        title: 'Birthday: Birthday Person',
        recurrence: 'P1Y',
        kind: 'birthday',
        leadDays: 1,
      }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json() as { data: { kind: string; leadDays: number } };
    expect(data.kind).toBe('birthday');
    expect(data.leadDays).toBe(1);
  });

  it('filters the list by kind', async () => {
    const headers = await authHeaders();
    const personId = await personWithBirthday(headers, '1990-03-01');
    for (const body of [
      { personId, dueAt: '2027-01-01T09:00:00.000Z', title: 'Generic one' },
      {
        personId,
        dueAt: '2027-02-28T08:00:00.000Z',
        title: 'Birthday one',
        kind: 'birthday',
        leadDays: 1,
        recurrence: 'P1Y',
      },
    ]) {
      await app.request('/api/v1/reminders', { method: 'POST', headers, body: JSON.stringify(body) });
    }

    const res = await app.request('/api/v1/reminders?kind=birthday', { headers });
    const { data } = await res.json() as { data: Array<{ title: string; kind: string }> };
    expect(data).toHaveLength(1);
    expect(data[0]!.title).toBe('Birthday one');
  });

  it('filters the list by multiple statuses', async () => {
    const headers = await authHeaders();
    const personId = await createPerson(app, headers);
    const mk = async (title: string) => {
      const res = await app.request('/api/v1/reminders', {
        method: 'POST',
        headers,
        body: JSON.stringify({ personId, dueAt: '2027-01-01T09:00:00.000Z', title }),
      });
      const { data } = await res.json() as { data: { id: string } };
      return data.id;
    };
    const keep = await mk('Still pending');
    const gone = await mk('Dismissed');
    await app.request(`/api/v1/reminders/${gone}/dismiss`, { method: 'POST', headers });

    const res = await app.request('/api/v1/reminders?statuses=pending,snoozed', { headers });
    const { data } = await res.json() as { data: Array<{ id: string }> };
    expect(data.map((r) => r.id)).toEqual([keep]);
  });

  it('rejects kind on PATCH', async () => {
    const headers = await authHeaders();
    const personId = await createPerson(app, headers);
    const createRes = await app.request('/api/v1/reminders', {
      method: 'POST',
      headers,
      body: JSON.stringify({ personId, dueAt: '2027-01-01T09:00:00.000Z', title: 'Plain' }),
    });
    const { data: created } = await createRes.json() as { data: { id: string } };

    const res = await app.request(`/api/v1/reminders/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ kind: 'birthday' }),
    });
    expect(res.status).toBe(400);
  });

  it('carries kind and leadDays forward and recomputes the leap-year date', async () => {
    const headers = await authHeaders();
    const personId = await personWithBirthday(headers, '1990-03-01');
    const createRes = await app.request('/api/v1/reminders', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        personId,
        dueAt: '2027-02-28T08:00:00.000Z', // 1 day before Mar 1 2027
        title: 'Birthday: Birthday Person',
        recurrence: 'P1Y',
        kind: 'birthday',
        leadDays: 1,
      }),
    });
    const { data: created } = await createRes.json() as { data: { id: string } };

    const res = await app.request(`/api/v1/reminders/${created.id}/complete`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const { data } = await res.json() as {
      data: { next: { kind: string; leadDays: number; dueAt: string } | null };
    };
    expect(data.next).not.toBeNull();
    expect(data.next!.kind).toBe('birthday');
    expect(data.next!.leadDays).toBe(1);
    // 2028 is a leap year, so one day before Mar 1 is Feb 29 — a naive +P1Y
    // would have repeated Feb 28.
    expect(new Date(data.next!.dueAt).toISOString()).toBe('2028-02-29T08:00:00.000Z');
  });

  it('falls back to P1Y when the person no longer has a birthday', async () => {
    const headers = await authHeaders();
    const personId = await personWithBirthday(headers, '1990-03-01');
    const createRes = await app.request('/api/v1/reminders', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        personId,
        dueAt: '2027-02-28T08:00:00.000Z',
        title: 'Birthday: Birthday Person',
        recurrence: 'P1Y',
        kind: 'birthday',
        leadDays: 1,
      }),
    });
    const { data: created } = await createRes.json() as { data: { id: string } };

    await app.request(`/api/v1/people/${personId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ birthday: null }),
    });

    const res = await app.request(`/api/v1/reminders/${created.id}/complete`, {
      method: 'POST',
      headers,
    });
    const { data } = await res.json() as { data: { next: { dueAt: string } | null } };
    expect(new Date(data.next!.dueAt).toISOString()).toBe('2028-02-28T08:00:00.000Z');
  });
});
