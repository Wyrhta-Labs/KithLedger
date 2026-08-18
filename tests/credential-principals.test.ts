import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { apiKeyCredentials, people } from '../src/db/schema/index.js';
import {
  LOCAL_ADMIN_ID,
  MEMBER_A_ID,
  MEMBER_B_ID,
  ensureLocalAdmin,
  ensureMember,
  headersFor,
  issueKeyOfKind,
  keyHeadersOfKind,
} from './helpers.js';

/**
 * ADR 0004 §2's THREE PRINCIPALS, held as three separate credentials (B8).
 *
 * B6 proved the predicate and B7 the traversal, both driven by a member
 * principal because that was the only kind that existed. This file proves the
 * other two are real, separate, and strictly narrower — which is the entire
 * point of splitting them: "a leaked always-on dashboard key exposes only
 * household-shared data — never anyone's private items, and never admin ops."
 *
 * The dashboard and ops callers here are REAL `kl_` keys issued through the
 * real issuing path, so what is under test is the credential, not a fixture.
 */

const app = createApp();

type Body<T> = { data: T; meta?: { total: number } };
type ErrBody = { error: { code: string; message: string } };

async function read<T>(res: Response): Promise<Body<T>> {
  return (await res.json()) as Body<T>;
}

async function createPersonAs(who: string, body: Record<string, unknown>) {
  const res = await app.request('/api/v1/people', {
    method: 'POST',
    headers: await headersFor(who),
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await read<{ id: string; name: string }>(res)).data;
}

/** The three items every disclosure question in ADR 0004 §2 is asked about. */
async function seedTheHousehold() {
  const shared = await createPersonAs(MEMBER_A_ID, {
    name: 'Spouse but not the kids',
    visibility: 'shared',
    sharedWith: [MEMBER_B_ID],
  });
  const secret = await createPersonAs(MEMBER_A_ID, { name: 'Secret', visibility: 'private' });
  const open = await createPersonAs(MEMBER_A_ID, { name: 'Everyone', visibility: 'household' });
  return { shared, secret, open };
}

beforeEach(async () => {
  await ensureLocalAdmin();
  await ensureMember(MEMBER_A_ID);
  await ensureMember(MEMBER_B_ID);
});

describe('the household service principal — the always-on dashboard key (ADR 0004 §2.2)', () => {
  it('sees the household item and NOTHING else — not in rows, and not in the total (§3.4)', async () => {
    const { shared, secret, open } = await seedTheHousehold();
    const headers = await keyHeadersOfKind('household');

    const res = await app.request('/api/v1/people', { headers });
    expect(res.status).toBe(200);
    const body = await read<{ id: string }[]>(res);

    const ids = body.data.map((p) => p.id);
    expect(ids).toEqual([open.id]);
    expect(ids).not.toContain(secret.id);
    expect(ids).not.toContain(shared.id);
    // A total of 3 while one row comes back leaks the other two just as surely
    // as returning them would.
    expect(body.meta!.total).toBe(1);
  });

  it('404s on a private item and on a shared item it is not in — the nonexistent-id answer', async () => {
    const { shared, secret } = await seedTheHousehold();
    const headers = await keyHeadersOfKind('household');

    for (const id of [secret.id, shared.id, '00000000-0000-0000-0000-000000000000']) {
      const res = await app.request(`/api/v1/people/${id}`, { headers });
      expect(res.status).toBe(404);
      expect(((await res.json()) as ErrBody).error.code).toBe('NOT_FOUND');
    }
  });

  it('cannot be talked into a shared subset: no share grant can ever match it', async () => {
    // The dashboard is MEMBER-LESS by design. Sharing an item with the local
    // account that happens to have issued its key must not reach it — there is
    // no member id in this scope for a grant to match.
    const person = await createPersonAs(MEMBER_A_ID, {
      name: 'Shared with the key owner',
      visibility: 'shared',
      sharedWith: [LOCAL_ADMIN_ID],
    });
    const headers = await keyHeadersOfKind('household', LOCAL_ADMIN_ID);

    expect((await app.request(`/api/v1/people/${person.id}`, { headers })).status).toBe(404);
    const list = await read<{ id: string }[]>(await app.request('/api/v1/people', { headers }));
    expect(list.meta!.total).toBe(0);
  });

  it('traverses the household slice only — an invisible root 404s (§3.1)', async () => {
    const { open, secret } = await seedTheHousehold();
    const headers = await keyHeadersOfKind('household');

    expect((await app.request(`/api/v1/people/${open.id}/graph`, { headers })).status).toBe(200);
    expect((await app.request(`/api/v1/people/${secret.id}/graph`, { headers })).status).toBe(404);
  });

  it('cannot WRITE anything — create, update, re-share, delete', async () => {
    const { open } = await seedTheHousehold();
    const headers = await keyHeadersOfKind('household');

    const attempts: [string, string, string | undefined][] = [
      ['POST', '/api/v1/people', JSON.stringify({ name: 'Dashboard was here' })],
      ['PATCH', `/api/v1/people/${open.id}`, JSON.stringify({ name: 'Renamed' })],
      // Re-sharing is a write too (§4: sharing is not transitive).
      ['PATCH', `/api/v1/people/${open.id}`, JSON.stringify({ visibility: 'private' })],
      ['DELETE', `/api/v1/people/${open.id}`, undefined],
      ['POST', '/api/v1/interactions', JSON.stringify({ person_id: open.id, type: 'call' })],
      [
        'POST',
        '/api/v1/reminders',
        JSON.stringify({ person_id: open.id, title: 'x', due_date: '2030-01-01' }),
      ],
    ];

    for (const [method, path, body] of attempts) {
      const res = await app.request(path, { method, headers, ...(body ? { body } : {}) });
      expect([method, path, res.status]).toEqual([method, path, 403]);
      expect(((await res.json()) as ErrBody).error.code).toBe('FORBIDDEN');
    }

    // And nothing actually changed.
    const [row] = await db.select().from(people).where(eq(people.id, open.id)).limit(1);
    expect(row).toBeDefined();
    expect(row!.name).toBe('Everyone');
    expect(row!.visibility).toBe('household');
  });

  it('cannot mint itself a wider credential — key management refuses API-key auth', async () => {
    const headers = await keyHeadersOfKind('household');
    const res = await app.request('/api/v1/auth/keys', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'escalation', kind: 'member' }),
    });
    expect(res.status).toBe(401);
    expect((await app.request('/api/v1/auth/keys', { headers })).status).toBe(401);
  });
});

describe('the admin / ops service key — no data path at all (ADR 0004 §2.3)', () => {
  it('cannot read any domain resource, nor any count', async () => {
    await seedTheHousehold();
    const headers = await keyHeadersOfKind('ops');

    for (const path of [
      '/api/v1/people',
      '/api/v1/interactions',
      '/api/v1/reminders',
      '/api/v1/relationships',
    ]) {
      const res = await app.request(path, { headers });
      expect([path, res.status]).toEqual([path, 403]);
      const body = (await res.json()) as ErrBody & { data?: unknown; meta?: { total: number } };
      expect(body.error.code).toBe('FORBIDDEN');
      // No rows AND no aggregate — a total is data about items it may not have.
      expect(body.data).toBeUndefined();
      expect(body.meta).toBeUndefined();
    }
  });

  it('cannot read a specific item, not even a household one, and cannot traverse', async () => {
    const { open } = await seedTheHousehold();
    const headers = await keyHeadersOfKind('ops');

    // 403 and not 404 here is deliberate and is NOT a §3.1 violation: the
    // refusal is about the whole resource, so it discloses nothing about
    // whether this particular id exists.
    expect((await app.request(`/api/v1/people/${open.id}`, { headers })).status).toBe(403);
    expect((await app.request(`/api/v1/people/${open.id}/graph`, { headers })).status).toBe(403);
  });

  it('cannot write either', async () => {
    const headers = await keyHeadersOfKind('ops');
    const res = await app.request('/api/v1/people', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Ops was here' }),
    });
    expect(res.status).toBe(403);
    const [row] = await db.select().from(people).limit(1);
    expect(row).toBeUndefined();
  });

  it('still reaches the operational surface it exists for', async () => {
    // /health is what "provisioning, migrations, schema, health" leaves as an
    // HTTP surface today; the ops key must not be locked out of it.
    const res = await app.request('/health', { headers: await keyHeadersOfKind('ops') });
    expect(res.status).toBe(200);
  });
});

describe('the member principal is unaffected (ADR 0004 §2.1)', () => {
  it('a member JWT still sees household + own + shared-to-them, exactly as B6 left it', async () => {
    const { shared, secret, open } = await seedTheHousehold();

    const a = await read<{ id: string }[]>(
      await app.request('/api/v1/people', { headers: await headersFor(MEMBER_A_ID) }),
    );
    expect(a.data.map((p) => p.id).sort()).toEqual([shared.id, secret.id, open.id].sort());
    expect(a.meta!.total).toBe(3);

    const b = await read<{ id: string }[]>(
      await app.request('/api/v1/people', { headers: await headersFor(MEMBER_B_ID) }),
    );
    expect(b.data.map((p) => p.id).sort()).toEqual([shared.id, open.id].sort());
    expect(b.meta!.total).toBe(2);
  });

  it('a kl_ member key behaves exactly as its owning account does, and can still write', async () => {
    const open = await createPersonAs(LOCAL_ADMIN_ID, { name: 'Admin household item' });
    const headers = await keyHeadersOfKind('member', LOCAL_ADMIN_ID);

    const list = await read<{ id: string }[]>(await app.request('/api/v1/people', { headers }));
    expect(list.data.map((p) => p.id)).toContain(open.id);

    const created = await app.request('/api/v1/people', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Written by a member key' }),
    });
    expect(created.status).toBe(201);
  });
});

describe('no credential is a god-mode (ADR 0004 §4)', () => {
  it('another member’s private item is unreadable to ALL THREE kinds of caller', async () => {
    const { secret } = await seedTheHousehold();

    // 1. member principal — a different member, and the local admin.
    for (const who of [MEMBER_B_ID, LOCAL_ADMIN_ID]) {
      const res = await app.request(`/api/v1/people/${secret.id}`, {
        headers: await headersFor(who),
      });
      expect(res.status).toBe(404);
    }
    // ...including one holding a kl_ member key.
    expect(
      (
        await app.request(`/api/v1/people/${secret.id}`, {
          headers: await keyHeadersOfKind('member', LOCAL_ADMIN_ID),
        })
      ).status,
    ).toBe(404);

    // 2. household service principal — absent, not denied.
    expect(
      (
        await app.request(`/api/v1/people/${secret.id}`, {
          headers: await keyHeadersOfKind('household'),
        })
      ).status,
    ).toBe(404);

    // 3. ops key — refused before a query is built.
    expect(
      (
        await app.request(`/api/v1/people/${secret.id}`, {
          headers: await keyHeadersOfKind('ops'),
        })
      ).status,
    ).toBe(403);

    // The row is still there — all three failures are about ACCESS, not about
    // the item having been moved or deleted by the test.
    const [row] = await db.select().from(people).where(eq(people.id, secret.id)).limit(1);
    expect(row!.visibility).toBe('private');
    expect(row!.ownerId).toBe(MEMBER_A_ID);
  });
});

describe('the credential kind is a property of the key, decided at authentication', () => {
  it('is read from the stored record, never from what the caller asks for', async () => {
    await seedTheHousehold();
    const raw = await issueKeyOfKind('household');

    // No header, query parameter or body can widen it: the same key on the
    // same route is the household slice however the request is dressed up.
    const asked = await app.request('/api/v1/people?limit=100', {
      headers: {
        Authorization: `Bearer ${raw}`,
        'X-Principal': 'member',
        'X-Scope': 'member',
      },
    });
    expect((await read<{ id: string }[]>(asked)).meta!.total).toBe(1);
  });

  it('fails CLOSED: a key whose credential record is gone is refused, not read as a member key', async () => {
    const raw = await issueKeyOfKind('household');
    const headers = { Authorization: `Bearer ${raw}` };
    expect((await app.request('/api/v1/people', { headers })).status).toBe(200);

    await db.delete(apiKeyCredentials);

    // The dangerous alternative — defaulting a missing row to `member` — would
    // have WIDENED this key to the full personal scope of the local account
    // that issued it.
    const res = await app.request('/api/v1/people', { headers });
    expect(res.status).toBe(401);
  });
});
