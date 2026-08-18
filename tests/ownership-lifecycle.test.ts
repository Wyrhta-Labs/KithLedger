import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { people, reminders } from '../src/db/schema/index.js';
import {
  LOCAL_ADMIN_ID,
  MEMBER_A_ID,
  MEMBER_B_ID,
  ensureLocalAdmin,
  ensureMember,
  headersFor,
} from './helpers.js';

/**
 * Task B9, pieces 1 and 2:
 *
 *  - `updated_by` — WHO last wrote each row, stamped on every write path.
 *  - the narrowed DELETE rule — `household` items are deletable by any member,
 *    `private`/`shared` ones only by their owner.
 *
 * The two belong in one file because they answer the same question from
 * opposite ends. B6 let any member a `shared` item reaches rewrite or destroy
 * it and recorded neither act. B9 answers "an edit is still allowed, but it
 * now leaves a name" and "a destruction is not allowed at all", and the tests
 * that matter are the ones that pin the ASYMMETRY: edit yes, delete no, same
 * caller, same item.
 */

const app = createApp();

type Body<T> = { data: T };

async function body<T>(res: Response): Promise<T> {
  return ((await res.json()) as Body<T>).data;
}

async function createPersonAs(who: string, payload: Record<string, unknown>) {
  const res = await app.request('/api/v1/people', {
    method: 'POST',
    headers: await headersFor(who),
    body: JSON.stringify(payload),
  });
  expect(res.status).toBe(201);
  return body<{ id: string; ownerId: string; updatedBy: string | null }>(res);
}

async function createReminderAs(who: string, payload: Record<string, unknown>) {
  const res = await app.request('/api/v1/reminders', {
    method: 'POST',
    headers: await headersFor(who),
    body: JSON.stringify(payload),
  });
  expect(res.status).toBe(201);
  return body<{ id: string; ownerId: string; updatedBy: string | null }>(res);
}

const request = async (who: string, method: string, path: string, payload?: unknown) =>
  app.request(path, {
    method,
    headers: await headersFor(who),
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });

beforeEach(async () => {
  await ensureLocalAdmin();
  await ensureMember(MEMBER_A_ID);
  await ensureMember(MEMBER_B_ID);
});

describe('updated_by (B9) — every write records its author', () => {
  it('stamps the creator on insert, on all four tables', async () => {
    const person = await createPersonAs(MEMBER_A_ID, { name: 'Ada' });
    expect(person.updatedBy).toBe(MEMBER_A_ID);
    expect(person.ownerId).toBe(MEMBER_A_ID);

    const interaction = await body<{ updatedBy: string | null }>(
      await request(MEMBER_A_ID, 'POST', '/api/v1/interactions', {
        personId: person.id,
        occurredAt: new Date().toISOString(),
        type: 'call',
      }),
    );
    expect(interaction.updatedBy).toBe(MEMBER_A_ID);

    const reminder = await createReminderAs(MEMBER_A_ID, {
      personId: person.id,
      dueAt: new Date().toISOString(),
      title: 'ring back',
    });
    expect(reminder.updatedBy).toBe(MEMBER_A_ID);

    const other = await createPersonAs(MEMBER_A_ID, { name: 'Grace' });
    const relationship = await body<{ updatedBy: string | null }>(
      await request(MEMBER_A_ID, 'POST', '/api/v1/relationships', {
        fromPersonId: person.id,
        toPersonId: other.id,
        type: 'friend',
      }),
    );
    expect(relationship.updatedBy).toBe(MEMBER_A_ID);
  });

  it('names the EDITOR, not the owner, when another member edits a household item', async () => {
    // The gap B9 closes. `household` is the default state and content edits
    // follow read scope, so before this column an item could be silently
    // rewritten by anybody in the house and the row would still read as if the
    // owner had done it.
    const person = await createPersonAs(MEMBER_A_ID, { name: 'Ada' });

    const patched = await body<{ ownerId: string; updatedBy: string | null }>(
      await request(MEMBER_B_ID, 'PATCH', `/api/v1/people/${person.id}`, { notes: 'edited by B' }),
    );
    expect(patched.ownerId).toBe(MEMBER_A_ID);
    expect(patched.updatedBy).toBe(MEMBER_B_ID);
  });

  it('names the editor on a SHARED item too — read access is not anonymity', async () => {
    const person = await createPersonAs(MEMBER_A_ID, {
      name: 'Spouse but not the kids',
      visibility: 'shared',
      sharedWith: [MEMBER_B_ID],
    });
    const patched = await body<{ updatedBy: string | null }>(
      await request(MEMBER_B_ID, 'PATCH', `/api/v1/people/${person.id}`, { notes: 'B was here' }),
    );
    expect(patched.updatedBy).toBe(MEMBER_B_ID);
  });

  it('stamps snooze, dismiss and complete', async () => {
    const person = await createPersonAs(MEMBER_A_ID, { name: 'Ada' });
    const make = () =>
      createReminderAs(MEMBER_A_ID, {
        personId: person.id,
        dueAt: new Date().toISOString(),
        title: 'ring back',
      });

    const snoozed = await body<{ updatedBy: string | null }>(
      await request(MEMBER_B_ID, 'POST', `/api/v1/reminders/${(await make()).id}/snooze`, {
        snooze_until: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    );
    expect(snoozed.updatedBy).toBe(MEMBER_B_ID);

    const dismissed = await body<{ updatedBy: string | null }>(
      await request(MEMBER_B_ID, 'POST', `/api/v1/reminders/${(await make()).id}/dismiss`),
    );
    expect(dismissed.updatedBy).toBe(MEMBER_B_ID);

    const completed = await body<{ updated: { updatedBy: string | null } }>(
      await request(MEMBER_B_ID, 'POST', `/api/v1/reminders/${(await make()).id}/complete`),
    );
    expect(completed.updated.updatedBy).toBe(MEMBER_B_ID);
  });

  it("gives a recurring reminder's successor the completer as writer and the ORIGINAL owner as owner", async () => {
    // The one insert in the service where creator and owner provably differ —
    // and the reason migration 0007 refuses to backfill `updated_by` from
    // `owner_id` even for rows that were never updated after creation.
    const person = await createPersonAs(MEMBER_A_ID, { name: 'Ada' });
    const reminder = await createReminderAs(MEMBER_A_ID, {
      personId: person.id,
      dueAt: new Date().toISOString(),
      title: 'monthly call',
      recurrence: 'P1M',
    });

    const result = await body<{ next: { ownerId: string; updatedBy: string | null } }>(
      await request(MEMBER_B_ID, 'POST', `/api/v1/reminders/${reminder.id}/complete`),
    );
    expect(result.next.ownerId).toBe(MEMBER_A_ID);
    expect(result.next.updatedBy).toBe(MEMBER_B_ID);
  });
});

describe('delete policy (B9) — narrower than read, narrower than edit', () => {
  it('lets a non-owner EDIT a shared item but refuses to let them DELETE it', async () => {
    const person = await createPersonAs(MEMBER_A_ID, {
      name: 'Shared with B',
      visibility: 'shared',
      sharedWith: [MEMBER_B_ID],
    });

    // Edit: still allowed — B6's argument for following read scope is intact.
    expect((await request(MEMBER_B_ID, 'PATCH', `/api/v1/people/${person.id}`, { notes: 'ok' })).status)
      .toBe(200);

    // Delete: refused. 403, not 404: the item is already visible to B, so the
    // refusal discloses nothing new (the §3.1 404 rule is about items OUTSIDE
    // the scope).
    const res = await request(MEMBER_B_ID, 'DELETE', `/api/v1/people/${person.id}`);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');

    // And it really is still there.
    expect((await request(MEMBER_B_ID, 'GET', `/api/v1/people/${person.id}`)).status).toBe(200);
  });

  it('lets any member delete a HOUSEHOLD item — deliberately unchanged', async () => {
    // Retained precisely because B6's argument applies most strongly here: an
    // item only its author can remove outlives its usefulness, and `household`
    // is the default state, so the household's own data would otherwise be
    // undeletable by everyone but whoever typed it first.
    const person = await createPersonAs(MEMBER_A_ID, { name: 'Everyone knows Ada' });
    expect((await request(MEMBER_B_ID, 'DELETE', `/api/v1/people/${person.id}`)).status).toBe(200);
    expect((await request(MEMBER_A_ID, 'GET', `/api/v1/people/${person.id}`)).status).toBe(404);
  });

  it('lets the owner delete their own private and shared items', async () => {
    const priv = await createPersonAs(MEMBER_A_ID, { name: 'Secret', visibility: 'private' });
    const shared = await createPersonAs(MEMBER_A_ID, {
      name: 'Shared',
      visibility: 'shared',
      sharedWith: [MEMBER_B_ID],
    });
    expect((await request(MEMBER_A_ID, 'DELETE', `/api/v1/people/${priv.id}`)).status).toBe(200);
    expect((await request(MEMBER_A_ID, 'DELETE', `/api/v1/people/${shared.id}`)).status).toBe(200);
  });

  it('404s an out-of-scope delete rather than 403 — a 403 would confirm it exists', async () => {
    const secret = await createPersonAs(MEMBER_A_ID, { name: 'Secret', visibility: 'private' });

    const res = await request(MEMBER_B_ID, 'DELETE', `/api/v1/people/${secret.id}`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');

    // Byte-for-byte the answer for an id that never existed.
    const unknown = await request(MEMBER_B_ID, 'DELETE', '/api/v1/people/00000000-0000-0000-0000-000000000000');
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');

    // Still there — a 404 must not have been a silent deletion.
    const [row] = await db.select().from(people).where(eq(people.id, secret.id));
    expect(row).toBeDefined();
  });

  it('applies the same rule to the three edge tables', async () => {
    const person = await createPersonAs(MEMBER_A_ID, { name: 'Ada' });
    const other = await createPersonAs(MEMBER_A_ID, { name: 'Grace' });

    const interaction = await body<{ id: string }>(
      await request(MEMBER_A_ID, 'POST', '/api/v1/interactions', {
        personId: person.id,
        occurredAt: new Date().toISOString(),
        type: 'call',
        visibility: 'shared',
        sharedWith: [MEMBER_B_ID],
      }),
    );
    const reminder = await createReminderAs(MEMBER_A_ID, {
      personId: person.id,
      dueAt: new Date().toISOString(),
      title: 'ring back',
      visibility: 'shared',
      sharedWith: [MEMBER_B_ID],
    });
    const relationship = await body<{ id: string }>(
      await request(MEMBER_A_ID, 'POST', '/api/v1/relationships', {
        fromPersonId: person.id,
        toPersonId: other.id,
        type: 'friend',
        visibility: 'shared',
        sharedWith: [MEMBER_B_ID],
      }),
    );

    for (const path of [
      `/api/v1/interactions/${interaction.id}`,
      `/api/v1/reminders/${reminder.id}`,
      `/api/v1/relationships/${relationship.id}`,
    ]) {
      expect((await request(MEMBER_B_ID, 'DELETE', path)).status).toBe(403);
      expect((await request(MEMBER_A_ID, 'DELETE', path)).status).toBe(200);
    }
  });

  it('is not a god-mode exemption for the local admin', async () => {
    // The local admin is a member-scope caller like any other: they can see a
    // `household` item and remove it, and a `shared` one they do not own is
    // theirs to read and not to destroy.
    const householdItem = await createPersonAs(MEMBER_A_ID, { name: 'Everyone knows Ada' });
    const sharedItem = await createPersonAs(MEMBER_A_ID, {
      name: 'Shared with the admin',
      visibility: 'shared',
      sharedWith: [LOCAL_ADMIN_ID],
    });

    expect((await request(LOCAL_ADMIN_ID, 'DELETE', `/api/v1/people/${sharedItem.id}`)).status).toBe(403);
    expect((await request(LOCAL_ADMIN_ID, 'DELETE', `/api/v1/people/${householdItem.id}`)).status).toBe(200);
  });

  it('leaves a completed recurring reminder deletable by its owner', async () => {
    // Regression guard for the successor row: it inherits `owner_id`, so the
    // ORIGINAL owner keeps the delete right even though somebody else wrote it.
    const person = await createPersonAs(MEMBER_A_ID, { name: 'Ada' });
    const reminder = await createReminderAs(MEMBER_A_ID, {
      personId: person.id,
      dueAt: new Date().toISOString(),
      title: 'monthly call',
      recurrence: 'P1M',
      visibility: 'private',
    });
    const result = await body<{ next: { id: string } }>(
      await request(MEMBER_A_ID, 'POST', `/api/v1/reminders/${reminder.id}/complete`),
    );
    expect((await request(MEMBER_A_ID, 'DELETE', `/api/v1/reminders/${result.next.id}`)).status).toBe(200);
    const [row] = await db.select().from(reminders).where(eq(reminders.id, result.next.id));
    expect(row).toBeUndefined();
  });
});
