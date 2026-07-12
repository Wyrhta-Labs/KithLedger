import { describe, it, expect } from 'vitest';
import type { McpToolContext, McpTool } from '@wyrhta/core/mcp';
import { interactionTools } from '../src/mcp/tools/interactions.js';
import { peopleTools } from '../src/mcp/tools/people.js';

const ctx: McpToolContext = { principal: { userId: 'admin', role: 'admin' }, requestId: 'test' };

const tool = (list: McpTool[], name: string): McpTool => {
  const t = list.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const unwrap = (res: any) => JSON.parse(res.content[0].text);

describe('interactionTools', () => {
  it('registers exactly the 2 expected tool names', () => {
    const names = interactionTools.map((t) => t.name).sort();
    expect(names).toEqual(['kith.list_interactions', 'kith.log_interaction'].sort());
  });

  it('logs an interaction then lists it filtered by person_id', async () => {
    const person = unwrap(
      await tool(peopleTools, 'kith.create_person').handler(ctx, { name: 'Erin' }),
    );

    const created = unwrap(
      await tool(interactionTools, 'kith.log_interaction').handler(ctx, {
        personId: person.id,
        occurredAt: new Date().toISOString(),
        type: 'call',
        channel: 'phone',
      }),
    );
    expect(created.type).toBe('call');

    const result = unwrap(
      await tool(interactionTools, 'kith.list_interactions').handler(ctx, {
        person_id: person.id,
      }),
    );

    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.items.length).toBeGreaterThanOrEqual(1);
  });

  it('throws NOT_FOUND for log_interaction on an unknown person', async () => {
    await expect(
      tool(interactionTools, 'kith.log_interaction').handler(ctx, {
        personId: '00000000-0000-0000-0000-000000000000',
        occurredAt: new Date().toISOString(),
        type: 'call',
        channel: 'phone',
      }),
    ).rejects.toThrow('NOT_FOUND');
  });
});
