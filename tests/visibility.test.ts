import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import {
  users,
  people,
  interactions,
  relationships,
  reminders,
  personShares,
  interactionShares,
  relationshipShares,
  reminderShares,
  VISIBILITY_VALUES,
  DEFAULT_VISIBILITY,
} from '../src/db/schema/index.js';
import type { Visibility } from '../src/db/schema/index.js';

/**
 * Per-member access control, SCHEMA ONLY (task B5, ADR 0004 §1 + §4).
 *
 * The model is deliberately INERT here: no service reads `visibility`, no
 * query filters on it, and no principal is threaded anywhere. What these
 * tests pin down is what the DATABASE guarantees, because that is what B6/B7
 * build their predicates on top of — a constraint that lives only in
 * TypeScript is one an MCP tool, a migration, or a psql session walks
 * straight past.
 */

async function makeUser() {
  const id = randomUUID();
  const [row] = await db
    .insert(users)
    .values({
      id,
      email: `${id}@example.invalid`,
      handle: `u-${id.slice(0, 8)}`,
      passwordHash: 'not-a-real-hash',
    })
    .returning();
  return row!;
}

async function makePerson(ownerId?: string) {
  const [row] = await db.insert(people).values({ name: 'Ada', ownerId }).returning();
  return row!;
}

/**
 * Inserts one row into each of the four domain tables with the given
 * visibility, or with the table default when `visibility` is undefined.
 * `visibility` is typed loosely on purpose: the invalid-value case has to
 * reach the database, which is the only layer that is allowed to be the
 * authority here.
 */
async function insertEach(visibility?: string) {
  const v = visibility as Visibility | undefined;
  const [from] = await db.insert(people).values({ name: 'Ada', visibility: v }).returning();
  const [to] = await db.insert(people).values({ name: 'Grace', visibility: v }).returning();
  const [interaction] = await db
    .insert(interactions)
    .values({ personId: from!.id, occurredAt: new Date(), type: 'call', visibility: v })
    .returning();
  const [relationship] = await db
    .insert(relationships)
    .values({ fromPersonId: from!.id, toPersonId: to!.id, type: 'friend', visibility: v })
    .returning();
  const [reminder] = await db
    .insert(reminders)
    .values({ personId: from!.id, dueAt: new Date(), title: 'ping', visibility: v })
    .returning();
  return { person: from!, interaction: interaction!, relationship: relationship!, reminder: reminder! };
}

describe('visibility is a 3-state property of every node and every edge', () => {
  it('exposes exactly the three ADR 0004 states', () => {
    expect(VISIBILITY_VALUES).toEqual(['private', 'shared', 'household']);
    expect(DEFAULT_VISIBILITY).toBe('household');
  });

  it.each(VISIBILITY_VALUES)('accepts %s on all four tables', async (visibility) => {
    const rows = await insertEach(visibility);
    expect(rows.person.visibility).toBe(visibility);
    expect(rows.interaction.visibility).toBe(visibility);
    expect(rows.relationship.visibility).toBe(visibility);
    expect(rows.reminder.visibility).toBe(visibility);
  });

  // 'public' is the plausible fourth state someone reaches for; the database
  // has to be what says no, on every table independently.
  it.each([
    ['people', 'people_visibility_check', () => db.insert(people).values({ name: 'x', visibility: 'public' as Visibility })],
    [
      'interactions',
      'interactions_visibility_check',
      async () => {
        const p = await makePerson();
        return db
          .insert(interactions)
          .values({ personId: p.id, occurredAt: new Date(), type: 'call', visibility: 'public' as Visibility });
      },
    ],
    [
      'relationships',
      'relationships_visibility_check',
      async () => {
        const a = await makePerson();
        const b = await makePerson();
        return db
          .insert(relationships)
          .values({ fromPersonId: a.id, toPersonId: b.id, type: 'friend', visibility: 'public' as Visibility });
      },
    ],
    [
      'reminders',
      'reminders_visibility_check',
      async () => {
        const p = await makePerson();
        return db
          .insert(reminders)
          .values({ personId: p.id, dueAt: new Date(), title: 't', visibility: 'public' as Visibility });
      },
    ],
  ] as const)('rejects a fourth value on %s', async (_table, constraint, insert) => {
    await expect(insert()).rejects.toThrow(new RegExp(constraint));
  });

  it('defaults every table to household on create (ADR 0004 §4)', async () => {
    const rows = await insertEach();
    expect(rows.person.visibility).toBe('household');
    expect(rows.interaction.visibility).toBe('household');
    expect(rows.relationship.visibility).toBe('household');
    expect(rows.reminder.visibility).toBe('household');
  });

  it('lets an edge be less visible than its endpoints', async () => {
    // ADR 0004 §1: "a household-visible person can carry an owner-only note
    // or relationship edge". Node-only visibility was rejected for exactly
    // this case, so nothing may couple the edge's value to its endpoints'.
    const a = await makePerson();
    const b = await makePerson();
    const [relationship] = await db
      .insert(relationships)
      .values({ fromPersonId: a.id, toPersonId: b.id, type: 'friend', visibility: 'private' })
      .returning();
    expect(a.visibility).toBe('household');
    expect(b.visibility).toBe('household');
    expect(relationship!.visibility).toBe('private');
  });
});

describe('owner_id', () => {
  it('rejects an owner that is not a user', async () => {
    await expect(db.insert(people).values({ name: 'Nobody', ownerId: randomUUID() })).rejects.toThrow(
      /people_owner_id_users_id_fk/,
    );
  });

  it('accepts any users row — members and the local admin share one id space (B4)', async () => {
    const owner = await makeUser();
    const person = await makePerson(owner.id);
    expect(person.ownerId).toBe(owner.id);
  });

  it('refuses to delete a user who still owns items (ADR 0004 §4: no silent delete)', async () => {
    const owner = await makeUser();
    await makePerson(owner.id);
    // RESTRICT, not CASCADE: offboarding (B9) must reassign or delete the
    // member's items as an explicit, one-time decision. A cascade would
    // destroy exactly the data that flow exists to decide about.
    await expect(db.delete(users).where(eq(users.id, owner.id))).rejects.toThrow(
      /people_owner_id_users_id_fk/,
    );
  });

  it('lets the user go once nothing they own is left', async () => {
    const owner = await makeUser();
    const person = await makePerson(owner.id);
    await db.delete(people).where(eq(people.id, person.id));
    await expect(db.delete(users).where(eq(users.id, owner.id))).resolves.toBeDefined();
  });
});

describe('share sets', () => {
  it('rejects a member id that is not a user', async () => {
    const person = await makePerson();
    await expect(
      db.insert(personShares).values({ personId: person.id, memberId: randomUUID() }),
    ).rejects.toThrow(/person_shares_member_id_users_id_fk/);
  });

  it('rejects a duplicate grant for the same (entity, member)', async () => {
    const member = await makeUser();
    const person = await makePerson();
    await db.insert(personShares).values({ personId: person.id, memberId: member.id });
    await expect(
      db.insert(personShares).values({ personId: person.id, memberId: member.id }),
    ).rejects.toThrow(/person_shares_person_id_member_id_pk/);
  });

  it('holds a subset of members for one entity ("spouse but not the kids")', async () => {
    const spouse = await makeUser();
    const kid = await makeUser();
    const person = await makePerson();
    await db.update(people).set({ visibility: 'shared' }).where(eq(people.id, person.id));
    await db.insert(personShares).values([
      { personId: person.id, memberId: spouse.id },
      { personId: person.id, memberId: kid.id },
    ]);
    const rows = await db.select().from(personShares).where(eq(personShares.personId, person.id));
    expect(rows.map((r) => r.memberId).sort()).toEqual([spouse.id, kid.id].sort());
  });

  it('drops grants when the entity goes (no dangling authorisation)', async () => {
    const member = await makeUser();
    const person = await makePerson();
    await db.insert(personShares).values({ personId: person.id, memberId: member.id });
    await db.delete(people).where(eq(people.id, person.id));
    // The FK a polymorphic share table could not have. Nothing in the service
    // layer had to remember to clean this up.
    expect(await db.select().from(personShares)).toHaveLength(0);
  });

  it('drops grants when the member goes, without touching the entity', async () => {
    const member = await makeUser();
    const person = await makePerson();
    await db.insert(personShares).values({ personId: person.id, memberId: member.id });
    // Losing a grant destroys no data, so CASCADE here — unlike owner_id.
    await db.delete(users).where(eq(users.id, member.id));
    expect(await db.select().from(personShares)).toHaveLength(0);
    expect(await db.select().from(people).where(eq(people.id, person.id))).toHaveLength(1);
  });

  it('gives each of the three edge tables its own share table', async () => {
    const member = await makeUser();
    const { interaction, relationship, reminder } = await insertEach('shared');
    await db.insert(interactionShares).values({ interactionId: interaction.id, memberId: member.id });
    await db.insert(relationshipShares).values({ relationshipId: relationship.id, memberId: member.id });
    await db.insert(reminderShares).values({ reminderId: reminder.id, memberId: member.id });
    expect(await db.select().from(interactionShares)).toHaveLength(1);
    expect(await db.select().from(relationshipShares)).toHaveLength(1);
    expect(await db.select().from(reminderShares)).toHaveLength(1);
  });
});
