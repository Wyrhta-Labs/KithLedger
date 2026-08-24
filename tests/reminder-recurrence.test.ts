import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { reminders } from '../src/db/schema/index.js';
import { authHeaders } from './helpers.js';

/**
 * `recurrence` is an ISO 8601 duration, never an RRULE, and it has to ADVANCE
 * the due date. Both halves matter:
 *
 *  - An accepted `FREQ=WEEKLY;BYDAY=TU` is unparseable at completion time, so
 *    the reminder silently stops recurring (or, before the completion path
 *    degraded, threw and turned "mark done" into a 500).
 *  - A parseable but non-advancing value (`P`, `P0D`, `PT0S`) mints a successor
 *    due at the same instant, which the next completion repeats forever.
 *
 * Rejected on the way in, and degraded — never thrown — for rows written before
 * the validator existed.
 */
describe('reminder recurrence', () => {
  const app = createApp();

  async function createPerson(headers: Record<string, string>) {
    const res = await app.request('/api/v1/people', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Recurrence Person' }),
    });
    const { data } = await res.json() as { data: { id: string } };
    return data.id;
  }

  it('rejects an RRULE, which is the shape people reach for by habit', async () => {
    const headers = await authHeaders();
    const personId = await createPerson(headers);
    const res = await app.request('/api/v1/reminders', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        personId,
        dueAt: new Date().toISOString(),
        title: 'Bad recurrence',
        recurrence: 'FREQ=WEEKLY;BYDAY=TU',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a duration that parses but would not advance the due date', async () => {
    const headers = await authHeaders();
    const personId = await createPerson(headers);
    for (const recurrence of ['P', 'PT', 'P0D', 'PT0S']) {
      const res = await app.request('/api/v1/reminders', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          personId,
          dueAt: new Date().toISOString(),
          title: `Non-advancing ${recurrence}`,
          recurrence,
        }),
      });
      expect(res.status, recurrence).toBe(400);
    }
  });

  it('still accepts the durations the successor logic supports', async () => {
    const headers = await authHeaders();
    const personId = await createPerson(headers);
    for (const recurrence of ['P1W', 'P1M', 'P1Y', 'PT1H', 'P1Y2M3D']) {
      const res = await app.request('/api/v1/reminders', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          personId,
          dueAt: new Date().toISOString(),
          title: `Good ${recurrence}`,
          recurrence,
        }),
      });
      expect(res.status, recurrence).toBe(201);
    }
  });

  it('completes a row already carrying a bad recurrence instead of 500ing', async () => {
    const headers = await authHeaders();
    const personId = await createPerson(headers);

    // Write the way a pre-validator row got in: straight past the schema.
    const createRes = await app.request('/api/v1/reminders', {
      method: 'POST',
      headers,
      body: JSON.stringify({ personId, dueAt: new Date().toISOString(), title: 'Legacy row' }),
    });
    const { data: created } = await createRes.json() as { data: { id: string } };
    await db
      .update(reminders)
      .set({ recurrence: 'FREQ=WEEKLY;BYDAY=TU' })
      .where(eq(reminders.id, created.id));

    const res = await app.request(`/api/v1/reminders/${created.id}/complete`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: { updated: { status: string }; next: unknown } };
    expect(data.updated.status).toBe('done');
    // Degraded to "no successor" rather than throwing.
    expect(data.next).toBeNull();
  });
});
