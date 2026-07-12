import { describe, it, expect } from 'vitest';
import type { McpToolContext, McpTool } from '@wyrhta/core/mcp';
import { peopleTools } from '../src/mcp/tools/people.js';

const ctx: McpToolContext = { principal: { userId: 'admin', role: 'admin' }, requestId: 'test' };

const tool = (list: McpTool[], name: string): McpTool => {
  const t = list.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const unwrap = (res: any) => JSON.parse(res.content[0].text);

describe('peopleTools', () => {
  it('registers exactly the 5 expected tool names', () => {
    const names = peopleTools.map((t) => t.name).sort();
    expect(names).toEqual([
      'kith.create_person',
      'kith.get_person',
      'kith.get_person_graph',
      'kith.list_people',
      'kith.update_person',
    ].sort());
  });

  it('creates then gets a person (round-trip)', async () => {
    const created = unwrap(
      await tool(peopleTools, 'kith.create_person').handler(ctx, { name: 'Alice' }),
    );
    expect(created.name).toBe('Alice');

    const fetched = unwrap(
      await tool(peopleTools, 'kith.get_person').handler(ctx, { id: created.id }),
    );
    expect(fetched.name).toBe('Alice');
  });

  it('lists people with the items/total/limit/offset envelope', async () => {
    await tool(peopleTools, 'kith.create_person').handler(ctx, { name: 'Bob' });

    const result = unwrap(await tool(peopleTools, 'kith.list_people').handler(ctx, {}));

    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('limit');
    expect(result).toHaveProperty('offset');
    expect(Array.isArray(result.items)).toBe(true);
  });

  it('updates a person field', async () => {
    const created = unwrap(
      await tool(peopleTools, 'kith.create_person').handler(ctx, { name: 'Carol' }),
    );

    const updated = unwrap(
      await tool(peopleTools, 'kith.update_person').handler(ctx, {
        id: created.id,
        name: 'Carol Updated',
      }),
    );

    expect(updated.name).toBe('Carol Updated');
  });

  it('throws NOT_FOUND for get_person on an unknown uuid', async () => {
    await expect(
      tool(peopleTools, 'kith.get_person').handler(ctx, {
        id: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('returns nodes and edges for get_person_graph', async () => {
    const created = unwrap(
      await tool(peopleTools, 'kith.create_person').handler(ctx, { name: 'Dave' }),
    );

    const graph = unwrap(
      await tool(peopleTools, 'kith.get_person_graph').handler(ctx, { id: created.id }),
    );

    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(Array.isArray(graph.edges)).toBe(true);
  });
});
