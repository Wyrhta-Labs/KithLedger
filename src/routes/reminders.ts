import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import * as service from '../services/reminders.js';
import { createReminderSchema, updateReminderSchema, listRemindersQuerySchema, snoozeReminderSchema } from '../validators/reminders.js';
import { ok, err } from '../lib/response.js';

export const remindersRouter = new Hono();

remindersRouter.use('*', requireAuth);

remindersRouter.get('/', async (c) => {
  const query = listRemindersQuerySchema.safeParse(c.req.query());
  if (!query.success) return err(c, 'VALIDATION_ERROR', 'Invalid query parameters', 400);

  const { rows, total, limit, offset } = await service.listReminders(query.data);
  return ok(c, rows, { total, limit, offset });
});

remindersRouter.post('/', async (c) => {
  const body = createReminderSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);

  try {
    const reminder = await service.createReminder(body.data);
    return ok(c, reminder, undefined, 201);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'PERSON_NOT_FOUND') {
      return err(c, 'NOT_FOUND', 'Person not found', 404);
    }
    throw e;
  }
});

remindersRouter.get('/:id', async (c) => {
  const reminder = await service.getReminder(c.req.param('id'));
  if (!reminder) return err(c, 'NOT_FOUND', 'Reminder not found', 404);
  return ok(c, reminder);
});

remindersRouter.patch('/:id', async (c) => {
  const body = updateReminderSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);

  try {
    const reminder = await service.updateReminder(c.req.param('id'), body.data);
    if (!reminder) return err(c, 'NOT_FOUND', 'Reminder not found', 404);
    return ok(c, reminder);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'BIRTHDAY_REMINDER_IMMUTABLE') {
      return err(c, 'CONFLICT', 'Birthday reminders are managed from the person birthday', 409);
    }
    throw e;
  }
});

remindersRouter.delete('/:id', async (c) => {
  try {
    const reminder = await service.deleteReminder(c.req.param('id'));
    if (!reminder) return err(c, 'NOT_FOUND', 'Reminder not found', 404);
    return ok(c, { id: reminder.id });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'BIRTHDAY_REMINDER_DELETE_BLOCKED') {
      return err(c, 'CONFLICT', 'Birthday reminders cannot be deleted. Hide them instead.', 409);
    }
    throw e;
  }
});

remindersRouter.post('/:id/complete', async (c) => {
  const result = await service.completeReminder(c.req.param('id'));
  if (!result) return err(c, 'NOT_FOUND', 'Reminder not found', 404);
  return ok(c, result);
});

remindersRouter.post('/:id/snooze', async (c) => {
  const body = snoozeReminderSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);

  const reminder = await service.snoozeReminder(c.req.param('id'), body.data.snooze_until);
  if (!reminder) return err(c, 'NOT_FOUND', 'Reminder not found', 404);
  return ok(c, reminder);
});

remindersRouter.post('/:id/dismiss', async (c) => {
  try {
    const reminder = await service.dismissReminder(c.req.param('id'));
    if (!reminder) return err(c, 'NOT_FOUND', 'Reminder not found', 404);
    return ok(c, reminder);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'BIRTHDAY_REMINDER_DISMISS_BLOCKED') {
      return err(c, 'CONFLICT', 'Birthday reminders cannot be dismissed. Complete or hide them instead.', 409);
    }
    throw e;
  }
});

remindersRouter.post('/:id/hide', async (c) => {
  const reminder = await service.hideReminder(c.req.param('id'));
  if (!reminder) return err(c, 'NOT_FOUND', 'Reminder not found', 404);
  return ok(c, reminder);
});

remindersRouter.post('/:id/unhide', async (c) => {
  const reminder = await service.unhideReminder(c.req.param('id'));
  if (!reminder) return err(c, 'NOT_FOUND', 'Reminder not found', 404);
  return ok(c, reminder);
});
