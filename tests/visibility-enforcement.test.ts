import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { people, personShares } from '../src/db/schema/index.js';
import * as peopleService from '../src/services/people.js';
import { HOUSEHOLD_SCOPE, memberScope, READ_ONLY_SCOPE } from '../src/services/scope.js';
import { listPeopleQuerySchema } from '../src/validators/people.js';
import {
  LOCAL_ADMIN_ID,
  MEMBER_A_ID,
  MEMBER_B_ID,
  MEMBER_C_ID,
  ensureLocalAdmin,
  ensureMember,
  headersFor,
} from './helpers.js';

/**
 * ADR 0004 enforcement in the ordinary query layer (task B6).
 *
 * B5's `visibility.test.ts` proves what the DATABASE guarantees. This file
 * proves what the QUERIES do, which is a different claim and the one the
 * privacy promise actually rests on: an item outside your scope is absent from
 * lists, absent from COUNTS, and 404 (never 403) on a direct get.
 *
 * Every case runs with at least two distinct members plus the local admin,
 * because the interesting failures are all of the form "B sees A's item" and a
 * single-caller test cannot express them.
 */

const app = createApp();

type Body<T> = { data: T; meta?: { total: number } };

async function read<T>(res: Response): Promise<Body<T>> {
  return (await res.json()) as Body<T>;
}

/** Create a person as `who`, with an explicit visibility and share set. */
async function createPersonAs(
  who: string,
  body: Record<string, unknown>,
): Promise<{ id: string; visibility: string; ownerId: string }> {
  const res = await app.request('/api/v1/people', {
    method: 'POST',
    headers: await headersFor(who),
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  const { data } = await read<{ id: string; visibility: string; ownerId: string }>(res);
  return data;
}

async function listPeopleAs(who: string) {
  const res = await app.request('/api/v1/people', { headers: await headersFor(who) });
  expect(res.status).toBe(200);
  return read<{ id: string }[]>(res);
}

async function getPersonAs(who: string, id: string) {
  return app.request(`/api/v1/people/${id}`, { headers: await headersFor(who) });
}

beforeEach(async () => {
  await ensureLocalAdmin();
  await ensureMember(MEMBER_A_ID);
  await ensureMember(MEMBER_B_ID);
  // MEMBER_C is provisioned per-test, on purpose: the `household` case has to
  // create them AFTER the item exists.
});

describe('private items (ADR 0004 §1 + §3.1)', () => {
  it('are invisible to a non-owner: absent from the list, absent from the COUNT, 404 on get', async () => {
    const secret = await createPersonAs(MEMBER_A_ID, { name: 'Secret', visibility: 'private' });
    await createPersonAs(MEMBER_A_ID, { name: 'Shared with all' });

    const mine = await listPeopleAs(MEMBER_A_ID);
    expect(mine.data.map((p) => p.id)).toContain(secret.id);
    expect(mine.meta!.total).toBe(2);

    const theirs = await listPeopleAs(MEMBER_B_ID);
    expect(theirs.data.map((p) => p.id)).not.toContain(secret.id);
    // §3.4: a total of 2 while you can see 1 leaks as much as showing the row.
    expect(theirs.meta!.total).toBe(1);
    expect(theirs.data).toHaveLength(1);
  });

  it('answer 404 NOT_FOUND and never 403 — a 403 would confirm the item exists', async () => {
    const secret = await createPersonAs(MEMBER_A_ID, { name: 'Secret', visibility: 'private' });

    const res = await getPersonAs(MEMBER_B_ID, secret.id);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');

    // Byte-for-byte the answer for an id that never existed.
    const unknown = await getPersonAs(MEMBER_B_ID, '00000000-0000-0000-0000-000000000000');
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('are invisible to the local ADMIN too — ADR 0004 §4 allows no standing god-mode', async () => {
    const secret = await createPersonAs(MEMBER_A_ID, { name: 'Secret', visibility: 'private' });

    const asAdmin = await listPeopleAs(LOCAL_ADMIN_ID);
    expect(asAdmin.data.map((p) => p.id)).not.toContain(secret.id);
    expect(asAdmin.meta!.total).toBe(0);
    expect((await getPersonAs(LOCAL_ADMIN_ID, secret.id)).status).toBe(404);
  });
});

describe('shared items (ADR 0004 §1)', () => {
  it('are visible to a member in the set and invisible to one outside it', async () => {
    const person = await createPersonAs(MEMBER_A_ID, {
      name: 'Spouse but not the kids',
      visibility: 'shared',
      sharedWith: [MEMBER_B_ID],
    });

    expect((await getPersonAs(MEMBER_B_ID, person.id)).status).toBe(200);
    expect((await listPeopleAs(MEMBER_B_ID)).meta!.total).toBe(1);

    await ensureMember(MEMBER_C_ID);
    expect((await getPersonAs(MEMBER_C_ID, person.id)).status).toBe(404);
    expect((await listPeopleAs(MEMBER_C_ID)).meta!.total).toBe(0);
  });

  it('become invisible on a shared -> private flip EVEN THOUGH the grant row survives', async () => {
    const person = await createPersonAs(MEMBER_A_ID, {
      name: 'Was shared',
      visibility: 'shared',
      sharedWith: [MEMBER_B_ID],
    });
    expect((await getPersonAs(MEMBER_B_ID, person.id)).status).toBe(200);

    const flip = await app.request(`/api/v1/people/${person.id}`, {
      method: 'PATCH',
      headers: await headersFor(MEMBER_A_ID),
      body: JSON.stringify({ visibility: 'private' }),
    });
    expect(flip.status).toBe(200);

    // The grant is deliberately NOT cascaded away by the flip...
    const grants = await db.select().from(personShares).where(eq(personShares.personId, person.id));
    expect(grants).toHaveLength(1);
    expect(grants[0]!.memberId).toBe(MEMBER_B_ID);

    // ...so the ONLY thing standing between B and the item is the
    // `visibility = 'shared'` guard in the predicate. Drop that guard and this
    // is a permanent leak to everyone the item was ever shared with.
    expect((await getPersonAs(MEMBER_B_ID, person.id)).status).toBe(404);
    expect((await listPeopleAs(MEMBER_B_ID)).meta!.total).toBe(0);
  });
});

describe('household items (ADR 0004 §1 — an explicit state, not a share list)', () => {
  it('are visible to everyone, INCLUDING a member provisioned after the item was created', async () => {
    const person = await createPersonAs(MEMBER_A_ID, { name: 'Everyone' });
    expect(person.visibility).toBe('household');

    // C does not exist yet at creation time. A materialised "shared with every
    // member" list would have frozen the audience here and excluded them; an
    // explicit `household` state cannot.
    await ensureMember(MEMBER_C_ID);

    expect((await getPersonAs(MEMBER_C_ID, person.id)).status).toBe(200);
    expect((await listPeopleAs(MEMBER_C_ID)).meta!.total).toBe(1);
    expect((await getPersonAs(MEMBER_B_ID, person.id)).status).toBe(200);
    expect((await getPersonAs(LOCAL_ADMIN_ID, person.id)).status).toBe(200);
  });

  it('is the default on create (ADR 0004 §4), and the creator is the owner', async () => {
    const person = await createPersonAs(MEMBER_A_ID, { name: 'Default' });
    expect(person.visibility).toBe('household');
    expect(person.ownerId).toBe(MEMBER_A_ID);
  });
});

describe('owner-only mutation; sharing is not transitive (ADR 0004 §4)', () => {
  it('refuses a non-owner\'s visibility change with 403, and does not apply it', async () => {
    const person = await createPersonAs(MEMBER_A_ID, { name: 'A owns this' });

    const res = await app.request(`/api/v1/people/${person.id}`, {
      method: 'PATCH',
      headers: await headersFor(MEMBER_B_ID),
      body: JSON.stringify({ visibility: 'private' }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');

    const [row] = await db.select().from(people).where(eq(people.id, person.id));
    expect(row!.visibility).toBe('household');
  });

  it('refuses a non-owner\'s change to the share set, even a member the item was shared TO', async () => {
    const person = await createPersonAs(MEMBER_A_ID, {
      name: 'Shared to B',
      visibility: 'shared',
      sharedWith: [MEMBER_B_ID],
    });
    await ensureMember(MEMBER_C_ID);

    // B can read it, but re-sharing is exactly what "not transitive" forbids.
    const res = await app.request(`/api/v1/people/${person.id}`, {
      method: 'PATCH',
      headers: await headersFor(MEMBER_B_ID),
      body: JSON.stringify({ sharedWith: [MEMBER_B_ID, MEMBER_C_ID] }),
    });
    expect(res.status).toBe(403);

    const grants = await db.select().from(personShares).where(eq(personShares.personId, person.id));
    expect(grants.map((g) => g.memberId)).toEqual([MEMBER_B_ID]);
    expect((await getPersonAs(MEMBER_C_ID, person.id)).status).toBe(404);
  });

  it('refuses the ADMIN just as it refuses any other non-owner', async () => {
    const person = await createPersonAs(MEMBER_A_ID, { name: 'A owns this' });
    const res = await app.request(`/api/v1/people/${person.id}`, {
      method: 'PATCH',
      headers: await headersFor(LOCAL_ADMIN_ID),
      body: JSON.stringify({ visibility: 'private' }),
    });
    expect(res.status).toBe(403);
  });

  it('lets the owner change both, and lets a NON-owner edit content of an item they can see', async () => {
    const person = await createPersonAs(MEMBER_A_ID, { name: 'A owns this' });

    // The deliberate line: `visibility`/`sharedWith` are governance and
    // owner-only; ordinary content follows read scope, or `household` items
    // would be read-only for the whole household but their owner.
    const edit = await app.request(`/api/v1/people/${person.id}`, {
      method: 'PATCH',
      headers: await headersFor(MEMBER_B_ID),
      body: JSON.stringify({ phone: '+49 123' }),
    });
    expect(edit.status).toBe(200);

    const own = await app.request(`/api/v1/people/${person.id}`, {
      method: 'PATCH',
      headers: await headersFor(MEMBER_A_ID),
      body: JSON.stringify({ visibility: 'shared', sharedWith: [MEMBER_B_ID] }),
    });
    expect(own.status).toBe(200);
    expect((await read<{ visibility: string }>(own)).data.visibility).toBe('shared');
  });
});

describe('existence pre-checks 404 rather than leaking (ADR 0004 §3.1)', () => {
  let hidden: { id: string };

  beforeEach(async () => {
    hidden = await createPersonAs(MEMBER_A_ID, { name: 'A private person', visibility: 'private' });
  });

  const post = async (path: string, who: string, body: unknown) =>
    app.request(`/api/v1${path}`, { method: 'POST', headers: await headersFor(who), body: JSON.stringify(body) });

  it('POST /interactions on an invisible person', async () => {
    const res = await post('/interactions', MEMBER_B_ID, {
      personId: hidden.id,
      occurredAt: new Date().toISOString(),
      type: 'call',
    });
    expect(res.status).toBe(404);
  });

  it('POST /reminders on an invisible person', async () => {
    const res = await post('/reminders', MEMBER_B_ID, {
      personId: hidden.id,
      dueAt: new Date().toISOString(),
      title: 'ping',
    });
    expect(res.status).toBe(404);
  });

  it('POST /relationships on an invisible person, from EITHER end', async () => {
    const visible = await createPersonAs(MEMBER_B_ID, { name: 'B can see this' });

    const from = await post('/relationships', MEMBER_B_ID, {
      fromPersonId: hidden.id, toPersonId: visible.id, type: 'friend',
    });
    expect(from.status).toBe(404);

    const to = await post('/relationships', MEMBER_B_ID, {
      fromPersonId: visible.id, toPersonId: hidden.id, type: 'friend',
    });
    expect(to.status).toBe(404);
  });

  it('POST /reminders/:id/complete on an invisible reminder', async () => {
    const own = await createPersonAs(MEMBER_A_ID, { name: 'A person' });
    const created = await post('/reminders', MEMBER_A_ID, {
      personId: own.id,
      dueAt: new Date().toISOString(),
      title: 'private ping',
      visibility: 'private',
    });
    expect(created.status).toBe(201);
    const { data: reminder } = await read<{ id: string }>(created);

    const res = await post(`/reminders/${reminder.id}/complete`, MEMBER_B_ID, {});
    expect(res.status).toBe(404);
  });
});

describe('edges carry their own scope, independently of their endpoints', () => {
  it('hides a private interaction on a household person, count included', async () => {
    const person = await createPersonAs(MEMBER_A_ID, { name: 'Everyone knows them' });
    const headers = await headersFor(MEMBER_A_ID);
    for (const visibility of ['private', 'household'] as const) {
      const res = await app.request('/api/v1/interactions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          personId: person.id, occurredAt: new Date().toISOString(), type: 'call', visibility,
        }),
      });
      expect(res.status).toBe(201);
    }

    const asB = await read<{ id: string }[]>(
      await app.request('/api/v1/interactions', { headers: await headersFor(MEMBER_B_ID) }),
    );
    expect(asB.data).toHaveLength(1);
    expect(asB.meta!.total).toBe(1);

    const asA = await read<{ id: string }[]>(await app.request('/api/v1/interactions', { headers }));
    expect(asA.meta!.total).toBe(2);
  });
});

describe("a recurring reminder's successor inherits its scope", () => {
  it('keeps the owner, the visibility and the share set instead of reverting to household', async () => {
    const person = await createPersonAs(MEMBER_A_ID, { name: 'A person' });
    const created = await app.request('/api/v1/reminders', {
      method: 'POST',
      headers: await headersFor(MEMBER_A_ID),
      body: JSON.stringify({
        personId: person.id,
        dueAt: new Date().toISOString(),
        title: "monthly, and nobody else's business",
        recurrence: 'P1M',
        visibility: 'private',
      }),
    });
    expect(created.status).toBe(201);
    const { data: reminder } = await read<{ id: string }>(created);

    const done = await app.request(`/api/v1/reminders/${reminder.id}/complete`, {
      method: 'POST',
      headers: await headersFor(MEMBER_A_ID),
      body: '{}',
    });
    expect(done.status).toBe(200);
    const { data } = await read<{ next: { id: string; visibility: string; ownerId: string } }>(done);

    // Otherwise ticking off a private reminder quietly publishes the next one
    // to the whole household, owned by whoever pressed the button.
    expect(data.next.visibility).toBe('private');
    expect(data.next.ownerId).toBe(MEMBER_A_ID);
    expect((await app.request(`/api/v1/reminders/${data.next.id}`, {
      headers: await headersFor(MEMBER_B_ID),
    })).status).toBe(404);
  });
});

describe('the household service principal is a SCOPE, not a bypass (ADR 0004 §2.2)', () => {
  // B8 gives it its own credential. B6 only has to make the scope expressible,
  // and prove it is strictly NARROWER than a member's rather than wider.
  it('sees exactly the household slice — never private, never a shared subset', async () => {
    await createPersonAs(MEMBER_A_ID, { name: 'Household' });
    await createPersonAs(MEMBER_A_ID, { name: 'Private', visibility: 'private' });
    await createPersonAs(MEMBER_A_ID, {
      name: 'Shared', visibility: 'shared', sharedWith: [MEMBER_B_ID],
    });

    const query = listPeopleQuerySchema.parse({});
    const dashboard = await peopleService.listPeople(HOUSEHOLD_SCOPE, query);
    expect(dashboard.rows.map((r) => r.name)).toEqual(['Household']);
    expect(dashboard.total).toBe(1);

    // The owner still sees all three, so the narrowing is the scope's and not
    // the data's.
    const owner = await peopleService.listPeople(memberScope(MEMBER_A_ID), query);
    expect(owner.total).toBe(3);
  });

  it('is read-only: it has no member id to own anything, so writes are refused structurally', async () => {
    await expect(
      peopleService.createPerson(HOUSEHOLD_SCOPE, { name: 'Nope', tags: [] }),
    ).rejects.toThrow(READ_ONLY_SCOPE);
  });

  it('cannot get a private item by id either', async () => {
    const secret = await createPersonAs(MEMBER_A_ID, { name: 'Private', visibility: 'private' });
    expect(await peopleService.getPerson(HOUSEHOLD_SCOPE, secret.id)).toBeNull();
  });
});
