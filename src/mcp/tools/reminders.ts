import { z } from 'zod';
import type { McpTool, McpToolResult, McpToolContext } from '@wyrhta/core/mcp';
import { memberScope } from '../../services/scope.js';
import * as remindersService from '../../services/reminders.js';
import {
  createReminderSchema,
  listRemindersQuerySchema,
  snoozeReminderSchema,
} from '../../validators/reminders.js';

function ok(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

/**
 * The MCP surface is being deleted in task A8 (heorth-mcp replaces it, ADR
 * 0008), so B6 does the MINIMUM here: the handlers stop discarding their
 * context and resolve the calling principal to a member scope, exactly as the
 * REST routes do. There is no MCP-specific access-control design in this file
 * and there should not be one — the enforcement lives in `src/services/`, and
 * this is only the seam that hands it a caller.
 */
const scope = (ctx: McpToolContext) => memberScope(ctx.principal.userId);

export const reminderTools: McpTool[] = [
  {
    name: 'kith.list_reminders',
    description: 'List reminders, optionally filtered by person, status, or due date.',
    inputSchema: listRemindersQuerySchema.shape,
    async handler(ctx, input) {
      const query = listRemindersQuerySchema.parse(input ?? {});
      const { rows, total, limit, offset } = await remindersService.listReminders(scope(ctx), query);
      return ok({ items: rows, total, limit, offset });
    },
  },
  {
    name: 'kith.create_reminder',
    description: 'Create a new reminder for a person.',
    inputSchema: createReminderSchema.shape,
    async handler(ctx, input) {
      const data = createReminderSchema.parse(input);
      try {
        const reminder = await remindersService.createReminder(scope(ctx), data);
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
    async handler(ctx, input) {
      const { id } = z.object({ id: z.string().uuid() }).parse(input);
      const result = await remindersService.completeReminder(scope(ctx), id);
      if (!result) throw new Error('NOT_FOUND');
      return ok(result);
    },
  },
  {
    name: 'kith.snooze_reminder',
    description: 'Snooze a reminder until a later date.',
    inputSchema: { id: z.string().uuid(), ...snoozeReminderSchema.shape },
    async handler(ctx, input) {
      const { id } = z.object({ id: z.string().uuid() }).parse(input);
      const { snooze_until } = snoozeReminderSchema.parse(input);
      const row = await remindersService.snoozeReminder(scope(ctx), id, snooze_until);
      if (!row) throw new Error('NOT_FOUND');
      return ok(row);
    },
  },
];
