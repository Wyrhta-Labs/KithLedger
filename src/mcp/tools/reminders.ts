import { z } from 'zod';
import type { McpTool, McpToolResult } from '@wyrhta/core/mcp';
import * as remindersService from '../../services/reminders.js';
import {
  createReminderSchema,
  listRemindersQuerySchema,
  snoozeReminderSchema,
} from '../../validators/reminders.js';

function ok(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

export const reminderTools: McpTool[] = [
  {
    name: 'kith.list_reminders',
    description: 'List reminders, optionally filtered by person, status, or due date.',
    inputSchema: listRemindersQuerySchema.shape,
    async handler(_ctx, input) {
      const query = listRemindersQuerySchema.parse(input ?? {});
      const { rows, total, limit, offset } = await remindersService.listReminders(query);
      return ok({ items: rows, total, limit, offset });
    },
  },
  {
    name: 'kith.create_reminder',
    description: 'Create a new reminder for a person.',
    inputSchema: createReminderSchema.shape,
    async handler(_ctx, input) {
      const data = createReminderSchema.parse(input);
      try {
        const reminder = await remindersService.createReminder(data);
        return ok(reminder);
      } catch (err) {
        if (err instanceof Error && err.message === 'PERSON_NOT_FOUND') {
          throw new Error('NOT_FOUND');
        }
        throw err;
      }
    },
  },
  {
    name: 'kith.complete_reminder',
    description: 'Mark a reminder as done, generating the next occurrence if recurring.',
    inputSchema: { id: z.string().uuid() },
    async handler(_ctx, input) {
      const { id } = z.object({ id: z.string().uuid() }).parse(input);
      const result = await remindersService.completeReminder(id);
      if (!result) throw new Error('NOT_FOUND');
      return ok(result);
    },
  },
  {
    name: 'kith.snooze_reminder',
    description: 'Snooze a reminder until a later date.',
    inputSchema: { id: z.string().uuid(), ...snoozeReminderSchema.shape },
    async handler(_ctx, input) {
      const { id } = z.object({ id: z.string().uuid() }).parse(input);
      const { snooze_until } = snoozeReminderSchema.parse(input);
      const row = await remindersService.snoozeReminder(id, snooze_until);
      if (!row) throw new Error('NOT_FOUND');
      return ok(row);
    },
  },
];
