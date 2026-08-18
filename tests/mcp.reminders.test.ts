import { describe, it, expect, beforeEach } from 'vitest';
import type { McpToolContext, McpTool } from '@wyrhta/core/mcp';
import { reminderTools } from '../src/mcp/tools/reminders.js';
import { peopleTools } from '../src/mcp/tools/people.js';
import { LOCAL_ADMIN_ID, ensureLocalAdmin } from './helpers.js';

const ctx: McpToolContext = { principal: { userId: LOCAL_ADMIN_ID, role: 'admin' }, requestId: 'test' };

// `setup.ts` truncates `users` between tests and every insert now stamps
// `owner_id` (FK -> users.id), so the calling principal has to be a real row.
beforeEach(async () => { await ensureLocalAdmin(); });

const tool = (list: McpTool[], name: string): McpTool => {
  const t = list.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not registered`);
  return t;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const unwrap = (res: any) => JSON.parse(res.content[0].text);

describe('reminderTools', () => {
  it('registers exactly the 4 expected tool names', () => {
    const names = reminderTools.map((t) => t.name).sort();
    expect(names).toEqual(
      ['kith.complete_reminder', 'kith.create_reminder', 'kith.list_reminders', 'kith.snooze_reminder'].sort(),
    );
  });

  it('creates a reminder then lists it filtered by person_id', async () => {
    const person = unwrap(
      await tool(peopleTools, 'kith.create_person').handler(ctx, { name: 'Fiona' }),
    );

    const created = unwrap(
      await tool(reminderTools, 'kith.create_reminder').handler(ctx, {
        personId: person.id,
        dueAt: new Date().toISOString(),
        title: 'Call',
      }),
    );
    expect(created.title).toBe('Call');

    const result = unwrap(
      await tool(reminderTools, 'kith.list_reminders').handler(ctx, {
        person_id: person.id,
      }),
    );

    expect(result.total).toBe(1);
    expect(result.items.length).toBe(1);
  });

  it('completes a recurring reminder and generates the next occurrence', async () => {
    const person = unwrap(
      await tool(peopleTools, 'kith.create_person').handler(ctx, { name: 'Gale' }),
    );

    const created = unwrap(
      await tool(reminderTools, 'kith.create_reminder').handler(ctx, {
        personId: person.id,
        dueAt: new Date().toISOString(),
        title: 'Monthly check-in',
        recurrence: 'P1M',
      }),
    );

    const completed = unwrap(
      await tool(reminderTools, 'kith.complete_reminder').handler(ctx, { id: created.id }),
    );

    expect(completed.updated.status).toBe('done');
    expect(completed.next).not.toBeNull();
  });

  it('throws NOT_FOUND for complete_reminder on an unknown id', async () => {
    await expect(
      tool(reminderTools, 'kith.complete_reminder').handler(ctx, {
        id: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toThrow('NOT_FOUND');
  });

  it('snoozes a reminder', async () => {
    const person = unwrap(
      await tool(peopleTools, 'kith.create_person').handler(ctx, { name: 'Hank' }),
    );

    const created = unwrap(
      await tool(reminderTools, 'kith.create_reminder').handler(ctx, {
        personId: person.id,
        dueAt: new Date().toISOString(),
        title: 'Send card',
      }),
    );

    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

    const snoozed = unwrap(
      await tool(reminderTools, 'kith.snooze_reminder').handler(ctx, {
        id: created.id,
        snooze_until: future,
      }),
    );

    expect(snoozed.status).toBe('snoozed');
  });
});
