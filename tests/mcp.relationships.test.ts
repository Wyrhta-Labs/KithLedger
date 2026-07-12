import { describe, it, expect } from 'vitest';
import type { McpToolContext, McpTool } from '@wyrhta/core/mcp';
import { relationshipTools } from '../src/mcp/tools/relationships.js';
import { peopleTools } from '../src/mcp/tools/people.js';

const ctx: McpToolContext = { principal: { userId: 'admin', role: 'admin' }, requestId: 'test' };

const tool = (list: McpTool[], name: string): McpTool => {
  const t = list.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const unwrap = (res: any) => JSON.parse(res.content[0].text);

describe('relationshipTools', () => {
  it('registers exactly the 2 expected tool names', () => {
    const names = relationshipTools.map((t) => t.name).sort();
    expect(names).toEqual(['kith.create_relationship', 'kith.list_relationships'].sort());
  });

  it('creates a mutual relationship visible from both sides', async () => {
    const a = unwrap(await tool(peopleTools, 'kith.create_person').handler(ctx, { name: 'Frank' }));
    const b = unwrap(await tool(peopleTools, 'kith.create_person').handler(ctx, { name: 'Grace' }));

    const created = unwrap(
      await tool(relationshipTools, 'kith.create_relationship').handler(ctx, {
        fromPersonId: a.id,
        toPersonId: b.id,
        type: 'friend',
        isMutual: true,
      }),
    );
    expect(created.type).toBe('friend');

    const fromA = unwrap(
      await tool(relationshipTools, 'kith.list_relationships').handler(ctx, { person_id: a.id }),
    );
    expect(fromA.total).toBe(1);

    const fromB = unwrap(
      await tool(relationshipTools, 'kith.list_relationships').handler(ctx, { person_id: b.id }),
    );
    expect(fromB.total).toBe(1);
  });

  it('throws CONFLICT when creating a duplicate relationship', async () => {
    const a = unwrap(await tool(peopleTools, 'kith.create_person').handler(ctx, { name: 'Heidi' }));
    const b = unwrap(await tool(peopleTools, 'kith.create_person').handler(ctx, { name: 'Ivan' }));

    await tool(relationshipTools, 'kith.create_relationship').handler(ctx, {
      fromPersonId: a.id,
      toPersonId: b.id,
      type: 'friend',
      isMutual: true,
    });

    await expect(
      tool(relationshipTools, 'kith.create_relationship').handler(ctx, {
        fromPersonId: a.id,
        toPersonId: b.id,
        type: 'friend',
        isMutual: true,
      }),
    ).rejects.toThrow('CONFLICT');
  });

  it('throws NOT_FOUND when toPersonId does not exist', async () => {
    const a = unwrap(await tool(peopleTools, 'kith.create_person').handler(ctx, { name: 'Judy' }));

    await expect(
      tool(relationshipTools, 'kith.create_relationship').handler(ctx, {
        fromPersonId: a.id,
        toPersonId: '00000000-0000-0000-0000-000000000000',
        type: 'friend',
        isMutual: true,
      }),
    ).rejects.toThrow('NOT_FOUND');
  });
});
