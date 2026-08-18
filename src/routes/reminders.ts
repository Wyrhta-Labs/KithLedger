import { Hono } from 'hono';
import type { Context } from 'hono';
import { requireAuth, requireDataAccess } from '../identity.js';
import * as service from '../services/reminders.js';
import { scopeFor, NOT_OWNER } from '../services/scope.js';
import { createReminderSchema, updateReminderSchema, listRemindersQuerySchema, snoozeReminderSchema } from '../validators/reminders.js';
import { ok, err } from '@wyrhta/core/http';
import { validationError } from '../lib/validation.js';

export const remindersRouter = new Hono();

/**
 * ADR 0004 §2 — every handler resolves the caller to a visibility scope and
 * hands it to the service. The route still knows nothing about Drizzle: the
 * scope is an opaque value produced from the principal `requireAuth` already
 * set, and every filtering decision happens in `src/services/`.
 */
function scope(c: Context) {
  const principal = c.get('principal');
  if (!principal) throw new Error('UNAUTHENTICATED');
  return scopeFor(principal);
}

remindersRouter.use('*', requireAuth, requireDataAccess);

remindersRouter.get('/', async (c) => {
  const query = listRemindersQuerySchema.safeParse(c.req.query());
  if (!query.success) return validationError(c, query.error, 'query parameters');

  const { rows, total, limit, offset } = await service.listReminders(scope(c), query.data);
  return ok(c, rows, { total, limit, offset });
});

remindersRouter.post('/', async (c) => {
  const body = createReminderSchema.safeParse(await c.req.json());
  if (!body.success) return validationError(c, body.error);

  try {
    const reminder = await service.createReminder(scope(c), body.data);
    return ok(c, reminder, undefined, 201);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'PERSON_NOT_FOUND') {
      return err(c, 'NOT_FOUND', 'Person not found', 404);
    }
    throw e;
  }
});

remindersRouter.get('/:id', async (c) => {
  const reminder = await service.getReminder(scope(c), c.req.param('id'));
  if (!reminder) return err(c, 'NOT_FOUND', 'Reminder not found', 404);
  return ok(c, reminder);
});

remindersRouter.patch('/:id', async (c) => {
  const body = updateReminderSchema.safeParse(await c.req.json());
  if (!body.success) return validationError(c, body.error);

  // ADR 0004 §4 — only the owner may change `visibility` or the share set.
  // 403 and not 404 here on purpose: the item is already visible to this
  // caller, so refusing the write discloses nothing they did not know. The
  // "invisible = nonexistent" 404 rule applies to items OUTSIDE the scope, and
  // those never reach this line — the service returns null and we 404 above.
  try {
    const reminder = await service.updateReminder(scope(c), c.req.param('id'), body.data);
    if (!reminder) return err(c, 'NOT_FOUND', 'Reminder not found', 404);
    return ok(c, reminder);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === NOT_OWNER) {
      return err(c, 'FORBIDDEN', 'Only the owner may change visibility or sharing', 403);
    }
    throw e;
  }
});

remindersRouter.delete('/:id', async (c) => {
  const reminder = await service.deleteReminder(scope(c), c.req.param('id'));
  if (!reminder) return err(c, 'NOT_FOUND', 'Reminder not found', 404);
  return ok(c, { id: reminder.id });
});

remindersRouter.post('/:id/complete', async (c) => {
  const result = await service.completeReminder(scope(c), c.req.param('id'));
  if (!result) return err(c, 'NOT_FOUND', 'Reminder not found', 404);
  return ok(c, result);
});

remindersRouter.post('/:id/snooze', async (c) => {
  const body = snoozeReminderSchema.safeParse(await c.req.json());
  if (!body.success) return validationError(c, body.error);

  const reminder = await service.snoozeReminder(scope(c), c.req.param('id'), body.data.snooze_until);
  if (!reminder) return err(c, 'NOT_FOUND', 'Reminder not found', 404);
  return ok(c, reminder);
});

remindersRouter.post('/:id/dismiss', async (c) => {
  const reminder = await service.dismissReminder(scope(c), c.req.param('id'));
  if (!reminder) return err(c, 'NOT_FOUND', 'Reminder not found', 404);
  return ok(c, reminder);
});
