import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import {
  people,
  reminders,
  personShares,
  householdMembers,
  users,
} from '../src/db/schema/index.js';
import {
  LOCAL_ADMIN_ID,
  MEMBER_A_ID,
  MEMBER_B_ID,
  MEMBER_C_ID,
  ensureLocalAdmin,
  ensureMember,
  expectDbRejection,
  headersFor,
  keyHeadersOfKind,
} from './helpers.js';

/**
 * ADR 0004 §4 — reassign-on-offboarding (task B9, piece 3).
 *
 * Two claims are under test and they pull against each other, which is the
 * whole difficulty of §4:
 *
 *  1. The flow WORKS: it resolves `owner_id`'s RESTRICT so a departing member
 *     can actually be removed, either by handing their items to a successor or
 *     by destroying the owner-only ones.
 *  2. The flow is NOT a god-mode: no response, at any step, discloses the
 *     content — or the volume — of the private items being decided about, and
 *     no credential other than the local operator account can invoke it.
 *
 * A test suite that only checked (1) would pass just as happily against an
 * "admin can list any member's private items" endpoint, which is precisely the
 * design §4 forbids.
 */

const app = createApp();

type Body<T> = { data: T };

async function body<T>(res: Response): Promise<T> {
  return ((await res.json()) as Body<T>).data;
}

const request = async (who: string, method: string, path: string, payload?: unknown) =>
  app.request(path, {
    method,
    headers: await headersFor(who),
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });

async function createPersonAs(who: string, payload: Record<string, unknown>) {
  const res = await app.request('/api/v1/people', {
    method: 'POST',
    headers: await headersFor(who),
    body: JSON.stringify(payload),
  });
  expect(res.status).toBe(201);
  return body<{ id: string; ownerId: string }>(res);
}

/** A departing member owning one of each visibility, plus a grant given to them. */
async function seedDepartingMember() {
  const priv = await createPersonAs(MEMBER_A_ID, { name: 'A private', visibility: 'private' });
  const shared = await createPersonAs(MEMBER_A_ID, {
    name: 'A shared',
    visibility: 'shared',
    sharedWith: [MEMBER_B_ID],
  });
  const open = await createPersonAs(MEMBER_A_ID, { name: 'A household' });
  // Somebody else's item, shared TO the departing member.
  const theirs = await createPersonAs(MEMBER_B_ID, {
    name: "B's, shared to A",
    visibility: 'shared',
    sharedWith: [MEMBER_A_ID],
  });
  return { priv, shared, open, theirs };
}

const offboard = (who: string, memberId: string, payload: unknown) =>
  request(who, 'POST', `/api/v1/members/${memberId}/offboarding`, payload);

beforeEach(async () => {
  await ensureLocalAdmin();
  await ensureMember(MEMBER_A_ID);
  await ensureMember(MEMBER_B_ID);
});

describe('who may invoke offboarding', () => {
  it('refuses every one of ADR 0004 §2\'s three kl_ credentials', async () => {
    // None of the three is a local-account JWT, which is the only thing
    // `requireJwt` + `requireLocalAccount` admits. A long-lived key that could
    // destroy a member's dataset would make a leaked deploy secret a
    // data-destruction secret.
    for (const kind of ['member', 'household', 'ops'] as const) {
      const res = await app.request(`/api/v1/members/${MEMBER_A_ID}/offboarding`, {
        method: 'POST',
        headers: await keyHeadersOfKind(kind),
        body: JSON.stringify({ ownerOnlyItems: 'delete' }),
      });
      expect([401, 403]).toContain(res.status);
    }
  });

  it('refuses a household member, including one with the admin role', async () => {
    await ensureMember(MEMBER_C_ID, 'admin');
    const res = await offboard(MEMBER_C_ID, MEMBER_A_ID, { ownerOnlyItems: 'delete' });
    expect(res.status).toBe(403);
    // Not the role — the PROVENANCE. `role === 'admin'` is never a key to
    // anything in this codebase (ADR 0004 §4: no standing god-mode).
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('refuses to offboard a locally authored account', async () => {
    const res = await offboard(LOCAL_ADMIN_ID, LOCAL_ADMIN_ID, { ownerOnlyItems: 'delete' });
    expect(res.status).toBe(409);
  });

  it('404s an unknown member and requires an explicit disposition', async () => {
    expect(
      (await offboard(LOCAL_ADMIN_ID, '00000000-0000-0000-0000-000000000000', {
        ownerOnlyItems: 'delete',
      })).status,
    ).toBe(404);
    // No default: §4 wants a decision made at that moment, and a default is
    // the opposite of one.
    expect((await offboard(LOCAL_ADMIN_ID, MEMBER_A_ID, {})).status).toBe(400);
  });
});

describe('what offboarding exposes', () => {
  it('reports one boolean and nothing else — no counts, no items', async () => {
    await seedDepartingMember();

    const res = await request(LOCAL_ADMIN_ID, 'GET', `/api/v1/members/${MEMBER_A_ID}/offboarding`);
    expect(res.status).toBe(200);
    const preview = await body<Record<string, unknown>>(res);

    // Exactly two fields. The boolean is the same bit `DELETE FROM users`
    // already discloses through the RESTRICT error; anything more — a count, a
    // per-table breakdown — describes the shape of a private set the operator
    // is not allowed to see (§3.4 names a count of invisible items as a leak
    // in its own right).
    expect(Object.keys(preview).sort()).toEqual(['hasOwnedItems', 'userId']);
    expect(preview['hasOwnedItems']).toBe(true);

    // And nothing anywhere in the payload is content.
    const text = JSON.stringify(preview);
    expect(text).not.toContain('A private');
    expect(text).not.toContain('A shared');
  });

  it('reports false once the member owns nothing', async () => {
    const preview = await body<{ hasOwnedItems: boolean }>(
      await request(LOCAL_ADMIN_ID, 'GET', `/api/v1/members/${MEMBER_B_ID}/offboarding`),
    );
    expect(preview.hasOwnedItems).toBe(false);
  });

  it('discloses nothing about the private items it destroys', async () => {
    const { priv } = await seedDepartingMember();

    const res = await offboard(LOCAL_ADMIN_ID, MEMBER_A_ID, {
      ownerOnlyItems: 'delete',
      successorId: MEMBER_B_ID,
    });
    expect(res.status).toBe(200);

    const result = await body<Record<string, unknown>>(res);
    expect(Object.keys(result).sort()).toEqual([
      'ownerOnlyItems',
      'removed',
      'successorId',
      'userId',
    ]);
    // Not a count of what was destroyed, not an id, and above all not a name.
    const text = JSON.stringify(result);
    expect(text).not.toContain('A private');
    expect(text).not.toContain(priv.id);
  });
});

describe('reassign', () => {
  it('moves every item to the successor and lets the member finally be deleted', async () => {
    const { priv, shared, open, theirs } = await seedDepartingMember();

    // The forcing function, before: RESTRICT refuses the delete outright.
    await expectDbRejection(db.delete(users).where(eq(users.id, MEMBER_A_ID)), /owner_id/);

    const res = await offboard(LOCAL_ADMIN_ID, MEMBER_A_ID, {
      ownerOnlyItems: 'reassign',
      successorId: MEMBER_B_ID,
    });
    expect(res.status).toBe(200);

    for (const id of [priv.id, shared.id, open.id]) {
      const [row] = await db.select().from(people).where(eq(people.id, id));
      expect(row!.ownerId).toBe(MEMBER_B_ID);
      // The offboarding operator is who touched the row last — honest
      // provenance for a transfer they performed.
      expect(row!.updatedBy).toBe(LOCAL_ADMIN_ID);
    }

    // The visibility each item was given is NOT rewritten: a `private` item
    // becomes private to its new owner. Deciding otherwise would be KithLedger
    // making a sharing decision nobody asked for.
    const [movedPrivate] = await db.select().from(people).where(eq(people.id, priv.id));
    expect(movedPrivate!.visibility).toBe('private');

    // Somebody else's item, shared to the departing member, is untouched...
    const [others] = await db.select().from(people).where(eq(people.id, theirs.id));
    expect(others!.ownerId).toBe(MEMBER_B_ID);
    expect(others!.visibility).toBe('shared');

    // ...but the grant TO the departing member is gone with them, and so are
    // the member and their provenance row.
    const grants = await db.select().from(personShares).where(eq(personShares.memberId, MEMBER_A_ID));
    expect(grants).toHaveLength(0);
    expect(await db.select().from(users).where(eq(users.id, MEMBER_A_ID))).toHaveLength(0);
    expect(
      await db.select().from(householdMembers).where(eq(householdMembers.userId, MEMBER_A_ID)),
    ).toHaveLength(0);
  });

  it('keeps the share set of a reassigned shared item', async () => {
    const { shared } = await seedDepartingMember();
    await ensureMember(MEMBER_C_ID);

    expect(
      (await offboard(LOCAL_ADMIN_ID, MEMBER_A_ID, {
        ownerOnlyItems: 'reassign',
        successorId: MEMBER_C_ID,
      })).status,
    ).toBe(200);

    const grants = await db.select().from(personShares).where(eq(personShares.personId, shared.id));
    expect(grants.map((g) => g.memberId)).toEqual([MEMBER_B_ID]);
  });

  it('refuses to hand owner-only items to a LOCAL account — the operator cannot name themselves', async () => {
    // The one hole reassignment could open: "offboard Alice, reassign her
    // private notes to me, then read them" would be a standing god-mode built
    // out of a one-time flow. Owner-only items may only ever move between
    // Heorth-authored household members, and the operator's account is not one.
    await seedDepartingMember();
    const res = await offboard(LOCAL_ADMIN_ID, MEMBER_A_ID, {
      ownerOnlyItems: 'reassign',
      successorId: LOCAL_ADMIN_ID,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');

    // Nothing moved and nobody was removed.
    expect(await db.select().from(users).where(eq(users.id, MEMBER_A_ID))).toHaveLength(1);
  });

  it('refuses the departing member as their own successor, and demands one at all', async () => {
    await seedDepartingMember();
    expect(
      (await offboard(LOCAL_ADMIN_ID, MEMBER_A_ID, {
        ownerOnlyItems: 'reassign',
        successorId: MEMBER_A_ID,
      })).status,
    ).toBe(400);
    expect((await offboard(LOCAL_ADMIN_ID, MEMBER_A_ID, { ownerOnlyItems: 'reassign' })).status).toBe(409);
  });
});

describe('delete', () => {
  it('destroys the owner-only items, keeps the household ones, and removes the member', async () => {
    const { priv, shared, open } = await seedDepartingMember();
    const reminder = await body<{ id: string }>(
      await request(MEMBER_A_ID, 'POST', '/api/v1/reminders', {
        personId: open.id,
        dueAt: new Date().toISOString(),
        title: 'private note to self',
        visibility: 'private',
      }),
    );

    expect(
      (await offboard(LOCAL_ADMIN_ID, MEMBER_A_ID, {
        ownerOnlyItems: 'delete',
        successorId: MEMBER_B_ID,
      })).status,
    ).toBe(200);

    // Owner-only: gone, on nodes and on edges alike.
    expect(await db.select().from(people).where(eq(people.id, priv.id))).toHaveLength(0);
    expect(await db.select().from(people).where(eq(people.id, shared.id))).toHaveLength(0);
    expect(await db.select().from(reminders).where(eq(reminders.id, reminder.id))).toHaveLength(0);

    // `household`: NOT gone. It is not owner-only — it is the household's own
    // address book, already visible to everyone, and destroying it because its
    // author left is data loss no privacy argument supports.
    const [kept] = await db.select().from(people).where(eq(people.id, open.id));
    expect(kept!.ownerId).toBe(MEMBER_B_ID);

    expect(await db.select().from(users).where(eq(users.id, MEMBER_A_ID))).toHaveLength(0);
  });

  it('needs no successor when the member owns nothing household-visible', async () => {
    await createPersonAs(MEMBER_A_ID, { name: 'A private', visibility: 'private' });
    expect((await offboard(LOCAL_ADMIN_ID, MEMBER_A_ID, { ownerOnlyItems: 'delete' })).status).toBe(200);
    expect(await db.select().from(users).where(eq(users.id, MEMBER_A_ID))).toHaveLength(0);
  });

  it('needs one when they do, rather than destroying household data by default', async () => {
    await createPersonAs(MEMBER_A_ID, { name: 'A household' });
    const res = await offboard(LOCAL_ADMIN_ID, MEMBER_A_ID, { ownerOnlyItems: 'delete' });
    expect(res.status).toBe(409);
    expect(await db.select().from(users).where(eq(users.id, MEMBER_A_ID))).toHaveLength(1);
  });

  it('offboards a member who owns nothing at all', async () => {
    expect((await offboard(LOCAL_ADMIN_ID, MEMBER_B_ID, { ownerOnlyItems: 'delete' })).status).toBe(200);
    expect(await db.select().from(users).where(eq(users.id, MEMBER_B_ID))).toHaveLength(0);
  });

  it('clears the updated_by stamp a departing member left on rows they did not own', async () => {
    const open = await createPersonAs(MEMBER_B_ID, { name: 'B household' });
    await request(MEMBER_A_ID, 'PATCH', `/api/v1/people/${open.id}`, { notes: 'A edited this' });
    const [before] = await db.select().from(people).where(eq(people.id, open.id));
    expect(before!.updatedBy).toBe(MEMBER_A_ID);

    expect((await offboard(LOCAL_ADMIN_ID, MEMBER_A_ID, { ownerOnlyItems: 'delete' })).status).toBe(200);

    const [after] = await db.select().from(people).where(eq(people.id, open.id));
    // SET NULL, not RESTRICT: a provenance stamp must never veto a lifecycle
    // operation, or offboarding could only finish by rewriting history. The
    // row and its owner are untouched; only the name of the writer is gone.
    expect(after!.updatedBy).toBeNull();
    expect(after!.ownerId).toBe(MEMBER_B_ID);
    expect(after!.notes).toBe('A edited this');
  });
});
