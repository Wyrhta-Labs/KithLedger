import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';
import { getPersonGraph } from '../src/services/relationships.js';
import { memberScope, HOUSEHOLD_SCOPE } from '../src/services/scope.js';
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
 * ADR 0004 §3 — the traversal rules, marked "correctness, non-negotiable"
 * (task B7).
 *
 * B6's `visibility-enforcement.test.ts` proves the ordinary query layer hides
 * ROWS. This file proves the graph stops leaking its SHAPE, which is a
 * strictly stronger claim: an unfiltered edge names a hidden person's id, an
 * unfiltered hydration names their NAME, and a traversal that filters its
 * OUTPUT rather than its RECURSION surfaces everyone standing behind a hidden
 * person even while dutifully omitting the hidden person themselves.
 *
 * Every case is asserted from at least two members' perspectives: each "A
 * cannot see it" is paired with "B can", so a passing test cannot be a broken
 * fixture that shows nobody anything.
 */

const app = createApp();

type GraphBody = {
  data: { nodes: { id: string; name: string }[]; edges: Record<string, unknown>[] };
  meta?: Record<string, unknown>;
};

async function createPersonAs(who: string, body: Record<string, unknown>): Promise<string> {
  const res = await app.request('/api/v1/people', {
    method: 'POST',
    headers: await headersFor(who),
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  const { data } = (await res.json()) as { data: { id: string } };
  return data.id;
}

async function createEdgeAs(who: string, body: Record<string, unknown>): Promise<string> {
  const res = await app.request('/api/v1/relationships', {
    method: 'POST',
    headers: await headersFor(who),
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  const { data } = (await res.json()) as { data: { id: string } };
  return data.id;
}

async function graphAs(who: string, rootId: string, depth: number) {
  return app.request(`/api/v1/people/${rootId}/graph?depth=${depth}`, {
    headers: await headersFor(who),
  });
}

async function visibleGraph(who: string, rootId: string, depth: number) {
  const res = await graphAs(who, rootId, depth);
  expect(res.status).toBe(200);
  const body = (await res.json()) as GraphBody;
  return {
    nodeIds: new Set(body.data.nodes.map((n) => n.id)),
    edgeIds: new Set(body.data.edges.map((e) => e['id'] as string)),
    raw: JSON.stringify(body),
    body,
  };
}

beforeEach(async () => {
  await ensureLocalAdmin();
  await ensureMember(MEMBER_A_ID);
  await ensureMember(MEMBER_B_ID);
});

describe('ADR 0004 §3.1 — invisible = nonexistent', () => {
  it('404s an invisible root exactly as it 404s a non-existent id', async () => {
    const secret = await createPersonAs(MEMBER_B_ID, { name: 'B Secret', visibility: 'private' });

    const hidden = await graphAs(MEMBER_A_ID, secret, 2);
    const absent = await graphAs(MEMBER_A_ID, '00000000-0000-4000-8000-0000dead0000', 2);

    expect(hidden.status).toBe(404);
    expect(absent.status).toBe(404);
    // Byte-identical bodies: any difference at all is an existence oracle.
    expect(await hidden.text()).toBe(await absent.text());

    // ...and the owner still reaches it, so the 404 is scope, not a bug.
    expect((await graphAs(MEMBER_B_ID, secret, 2)).status).toBe(200);
  });
});

describe('ADR 0004 §3.2 — edge visibility requires visible endpoints', () => {
  it('omits an edge whose OWN visibility excludes you, though both endpoints are visible', async () => {
    const you = await createPersonAs(MEMBER_A_ID, { name: 'You' });
    const other = await createPersonAs(MEMBER_A_ID, { name: 'Colleague' });
    // Both people are `household`; only the EDGE is private (ADR 0004 §1 —
    // edge visibility is independent of its endpoints).
    const edge = await createEdgeAs(MEMBER_B_ID, {
      fromPersonId: you,
      toPersonId: other,
      type: 'colleague',
      visibility: 'private',
    });

    const a = await visibleGraph(MEMBER_A_ID, you, 1);
    expect(a.edgeIds.has(edge)).toBe(false);
    expect(a.nodeIds.has(other)).toBe(false);

    const b = await visibleGraph(MEMBER_B_ID, you, 1);
    expect(b.edgeIds.has(edge)).toBe(true);
    expect(b.nodeIds.has(other)).toBe(true);
  });

  it('omits an edge to a hidden person entirely — no dangling edge, no id, no name', async () => {
    const you = await createPersonAs(MEMBER_A_ID, { name: 'You' });
    const hidden = await createPersonAs(MEMBER_B_ID, {
      name: 'Undisclosed Acquaintance',
      visibility: 'private',
    });
    // A `household` EDGE to a hidden PERSON: only the endpoint rule can
    // suppress this one.
    const edge = await createEdgeAs(MEMBER_B_ID, {
      fromPersonId: you,
      toPersonId: hidden,
      type: 'friend',
    });

    for (const depth of [1, 2]) {
      const a = await visibleGraph(MEMBER_A_ID, you, depth);
      expect(a.edgeIds.has(edge)).toBe(false);
      expect(a.nodeIds.has(hidden)).toBe(false);
      expect(a.raw).not.toContain(hidden);
      expect(a.raw).not.toContain('Undisclosed Acquaintance');
      expect([...a.nodeIds]).toEqual([you]);
    }

    const b = await visibleGraph(MEMBER_B_ID, you, 1);
    expect(b.edgeIds.has(edge)).toBe(true);
    expect(b.nodeIds.has(hidden)).toBe(true);
  });
});

describe('ADR 0004 §3.3 — no pass-through', () => {
  it('does not surface Cousin through a hidden person, but does via an independent visible path', async () => {
    const you = await createPersonAs(MEMBER_A_ID, { name: 'You' });
    const cousin = await createPersonAs(MEMBER_A_ID, { name: 'Cousin' });
    const hidden = await createPersonAs(MEMBER_B_ID, { name: 'Go Between', visibility: 'private' });

    // You -> [hidden] -> Cousin. Both edges are `household`; only the middle
    // NODE is private, so nothing but the traversal rule can stop this.
    const youHidden = await createEdgeAs(MEMBER_B_ID, {
      fromPersonId: you,
      toPersonId: hidden,
      type: 'friend',
    });
    const hiddenCousin = await createEdgeAs(MEMBER_B_ID, {
      fromPersonId: hidden,
      toPersonId: cousin,
      type: 'family',
    });

    // B, who sees the middle, reaches Cousin at depth 2 — the path exists.
    const b = await visibleGraph(MEMBER_B_ID, you, 2);
    expect(b.nodeIds.has(cousin)).toBe(true);
    expect(b.edgeIds.has(hiddenCousin)).toBe(true);

    // A does not. Not the far edge, not the near edge, not Cousin's id or
    // name, and nothing about the go-between.
    const a = await visibleGraph(MEMBER_A_ID, you, 2);
    expect(a.edgeIds.has(youHidden)).toBe(false);
    expect(a.edgeIds.has(hiddenCousin)).toBe(false);
    expect(a.nodeIds.has(cousin)).toBe(false);
    expect(a.raw).not.toContain(cousin);
    expect(a.raw).not.toContain('Go Between');
    expect([...a.nodeIds]).toEqual([you]);

    // Now give A an INDEPENDENT visible path of the same length. If the
    // previous assertion had been achieved by blanket-filtering the result
    // set rather than by terminating the traversal, Cousin would stay hidden
    // here too — this is the half of the test that proves which one happened.
    const bridge = await createPersonAs(MEMBER_A_ID, { name: 'Bridge' });
    await createEdgeAs(MEMBER_A_ID, { fromPersonId: you, toPersonId: bridge, type: 'friend' });
    const bridgeCousin = await createEdgeAs(MEMBER_A_ID, {
      fromPersonId: bridge,
      toPersonId: cousin,
      type: 'family',
    });

    const a1 = await visibleGraph(MEMBER_A_ID, you, 1);
    expect(a1.nodeIds.has(cousin)).toBe(false); // still two hops away

    const a2 = await visibleGraph(MEMBER_A_ID, you, 2);
    expect(a2.nodeIds.has(cousin)).toBe(true);
    expect(a2.edgeIds.has(bridgeCousin)).toBe(true);
    // ...and the hidden route is STILL absent from the very same response.
    expect(a2.edgeIds.has(hiddenCousin)).toBe(false);
    expect(a2.raw).not.toContain('Go Between');
  });

  it('applies the rule at EVERY hop, not only the first', async () => {
    // The distinguishing fixture. Everything hidden here sits at hop TWO,
    // behind a perfectly visible first hop, so the CTE's base term cannot be
    // what suppresses it — only the predicate inside the RECURSIVE term can.
    // Drop `edgeVisible` from the recursive arm and this test is the one that
    // fails.
    const you = await createPersonAs(MEMBER_A_ID, { name: 'You' });
    const bridge = await createPersonAs(MEMBER_A_ID, { name: 'Bridge' });
    const secretPerson = await createPersonAs(MEMBER_B_ID, {
      name: 'Second Hop Secret',
      visibility: 'private',
    });
    const mallory = await createPersonAs(MEMBER_A_ID, { name: 'Mallory' });
    const far = await createPersonAs(MEMBER_A_ID, { name: 'Far' });

    await createEdgeAs(MEMBER_A_ID, { fromPersonId: you, toPersonId: bridge, type: 'friend' });
    // Hop 2, hidden ENDPOINT.
    const toSecret = await createEdgeAs(MEMBER_B_ID, {
      fromPersonId: bridge,
      toPersonId: secretPerson,
      type: 'other',
    });
    // Hop 2, hidden EDGE between two visible people.
    const privateHop = await createEdgeAs(MEMBER_B_ID, {
      fromPersonId: bridge,
      toPersonId: mallory,
      type: 'friend',
      visibility: 'private',
    });
    // Hop 3, reachable only through that hidden edge.
    const beyond = await createEdgeAs(MEMBER_A_ID, {
      fromPersonId: mallory,
      toPersonId: far,
      type: 'family',
    });

    const a = await visibleGraph(MEMBER_A_ID, you, 3);
    expect(a.nodeIds).toEqual(new Set([you, bridge]));
    expect(a.edgeIds.has(toSecret)).toBe(false);
    expect(a.edgeIds.has(privateHop)).toBe(false);
    expect(a.edgeIds.has(beyond)).toBe(false);
    expect(a.raw).not.toContain(secretPerson);
    expect(a.raw).not.toContain('Second Hop Secret');
    expect(a.raw).not.toContain('Mallory');

    // B, who sees both hidden items, walks the whole chain.
    const b = await visibleGraph(MEMBER_B_ID, you, 3);
    expect(b.nodeIds.has(secretPerson)).toBe(true);
    expect(b.nodeIds.has(far)).toBe(true);
    expect(b.edgeIds.has(beyond)).toBe(true);
  });

  it('terminates inside the recursion: a private EDGE is not a hop either', async () => {
    const you = await createPersonAs(MEMBER_A_ID, { name: 'You' });
    const mallory = await createPersonAs(MEMBER_A_ID, { name: 'Mallory' });
    const cousin = await createPersonAs(MEMBER_A_ID, { name: 'Cousin' });

    // Every PERSON here is household-visible; the first hop is a private
    // EDGE. A must not reach Cousin through an edge she cannot see.
    await createEdgeAs(MEMBER_B_ID, {
      fromPersonId: you,
      toPersonId: mallory,
      type: 'friend',
      visibility: 'private',
    });
    const malloryCousin = await createEdgeAs(MEMBER_A_ID, {
      fromPersonId: mallory,
      toPersonId: cousin,
      type: 'family',
    });

    const a = await visibleGraph(MEMBER_A_ID, you, 3);
    expect(a.nodeIds.has(mallory)).toBe(false);
    expect(a.nodeIds.has(cousin)).toBe(false);
    expect(a.edgeIds.has(malloryCousin)).toBe(false);

    const b = await visibleGraph(MEMBER_B_ID, you, 2);
    expect(b.nodeIds.has(cousin)).toBe(true);
  });
});

describe('the two branches agree', () => {
  it('depth 1 and the depth-2 CTE return the same visible subgraph on a one-hop fixture', async () => {
    const you = await createPersonAs(MEMBER_A_ID, { name: 'You' });
    const friend = await createPersonAs(MEMBER_A_ID, { name: 'Friend' });
    const shared = await createPersonAs(MEMBER_A_ID, { name: 'Sharer' });
    const hidden = await createPersonAs(MEMBER_B_ID, { name: 'Hidden', visibility: 'private' });

    const e1 = await createEdgeAs(MEMBER_A_ID, {
      fromPersonId: you,
      toPersonId: friend,
      type: 'friend',
    });
    const e2 = await createEdgeAs(MEMBER_B_ID, {
      fromPersonId: you,
      toPersonId: shared,
      type: 'colleague',
      visibility: 'shared',
      sharedWith: [MEMBER_A_ID],
    });
    await createEdgeAs(MEMBER_B_ID, { fromPersonId: you, toPersonId: hidden, type: 'other' });

    // No second hop exists, so the two code paths must coincide exactly.
    const d1 = await visibleGraph(MEMBER_A_ID, you, 1);
    const d2 = await visibleGraph(MEMBER_A_ID, you, 2);

    expect([...d1.edgeIds].sort()).toEqual([e1, e2].sort());
    expect([...d2.edgeIds].sort()).toEqual([...d1.edgeIds].sort());
    expect([...d2.nodeIds].sort()).toEqual([...d1.nodeIds].sort());
    expect(d1.nodeIds.has(hidden)).toBe(false);
    expect(d2.nodeIds.has(hidden)).toBe(false);

    // The CTE branch used to project `r.*` — snake_case plus a `depth`
    // column — while the depth-1 branch returned Drizzle rows. Same endpoint,
    // same serialisation.
    const shape1 = Object.keys(d1.body.data.edges[0]!).sort();
    const shape2 = Object.keys(d2.body.data.edges[0]!).sort();
    expect(shape2).toEqual(shape1);
    expect(shape2).not.toContain('depth');
    expect(shape2).toContain('fromPersonId');
    expect(shape2).toContain('notes');
  });
});

describe('scopes other than a plain member', () => {
  it('shows a household graph to a member provisioned after it was created', async () => {
    const you = await createPersonAs(MEMBER_A_ID, { name: 'You' });
    const friend = await createPersonAs(MEMBER_A_ID, { name: 'Friend' });
    const cousin = await createPersonAs(MEMBER_A_ID, { name: 'Cousin' });
    const near = await createEdgeAs(MEMBER_A_ID, {
      fromPersonId: you,
      toPersonId: friend,
      type: 'friend',
    });
    const far = await createEdgeAs(MEMBER_A_ID, {
      fromPersonId: friend,
      toPersonId: cousin,
      type: 'family',
    });

    // C did not exist when any of the above was written. `household` is a
    // STATE, not a materialised share list, so it reaches her anyway.
    await ensureMember(MEMBER_C_ID);
    const c = await visibleGraph(MEMBER_C_ID, you, 2);
    expect(c.edgeIds).toEqual(new Set([near, far]));
    expect(c.nodeIds).toEqual(new Set([you, friend, cousin]));
  });

  it('gives the household service principal the household slice and nothing else', async () => {
    const you = await createPersonAs(MEMBER_A_ID, { name: 'You' });
    const friend = await createPersonAs(MEMBER_A_ID, { name: 'Friend' });
    const hidden = await createPersonAs(MEMBER_B_ID, { name: 'Hidden', visibility: 'private' });
    const open = await createEdgeAs(MEMBER_A_ID, {
      fromPersonId: you,
      toPersonId: friend,
      type: 'friend',
    });
    await createEdgeAs(MEMBER_B_ID, { fromPersonId: you, toPersonId: hidden, type: 'other' });

    const graph = await getPersonGraph(HOUSEHOLD_SCOPE, you, 2);
    expect(graph).not.toBeNull();
    expect(graph!.edges.map((e) => e.id)).toEqual([open]);
    expect(graph!.nodes.map((n) => n.id).sort()).toEqual([you, friend].sort());

    // Strictly narrower than a member's: it cannot root on a private person.
    expect(await getPersonGraph(HOUSEHOLD_SCOPE, hidden, 1)).toBeNull();
    expect(await getPersonGraph(memberScope(MEMBER_B_ID), hidden, 1)).not.toBeNull();
  });

  it('gives the local admin no override on the graph', async () => {
    const you = await createPersonAs(MEMBER_A_ID, { name: 'You' });
    const hidden = await createPersonAs(MEMBER_B_ID, { name: 'Hidden', visibility: 'private' });
    await createEdgeAs(MEMBER_B_ID, { fromPersonId: you, toPersonId: hidden, type: 'other' });

    const admin = await visibleGraph(LOCAL_ADMIN_ID, you, 3);
    expect(admin.nodeIds.has(hidden)).toBe(false);
    expect(admin.raw).not.toContain(hidden);
    expect((await graphAs(LOCAL_ADMIN_ID, hidden, 1)).status).toBe(404);
  });
});
