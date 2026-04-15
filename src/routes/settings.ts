import { Hono } from 'hono';
import { requireAuth, requireJwt } from '../middleware/auth.js';
import { err, ok } from '../lib/response.js';
import * as service from '../services/setting-values.js';
import { createSettingValueSchema, updateSettingValueSchema } from '../validators/settings.js';

export const settingsRouter = new Hono();

settingsRouter.get('/values', requireAuth, async (c) => {
  const rows = await service.listSettingValues();
  return ok(c, rows);
});

settingsRouter.post('/values', requireJwt, async (c) => {
  const body = createSettingValueSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);

  try {
    const row = await service.createSettingValue(body.data);
    return ok(c, row, undefined, 201);
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === '23505'
    ) {
      return err(c, 'CONFLICT', 'A value with this category and key already exists', 409);
    }

    throw error;
  }
});

settingsRouter.patch('/values/:id', requireJwt, async (c) => {
  const body = updateSettingValueSchema.safeParse(await c.req.json());
  if (!body.success) return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);

  try {
    const row = await service.updateSettingValue(c.req.param('id'), body.data);
    if (!row) return err(c, 'NOT_FOUND', 'Setting value not found', 404);
    return ok(c, row);
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === '23505'
    ) {
      return err(c, 'CONFLICT', 'A value with this category and key already exists', 409);
    }

    throw error;
  }
});

settingsRouter.delete('/values/:id', requireJwt, async (c) => {
  try {
    const row = await service.deleteSettingValue(c.req.param('id'));
    if (!row) return err(c, 'NOT_FOUND', 'Setting value not found', 404);
    return ok(c, { id: row.id });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'SETTING_VALUE_IN_USE') {
      return err(c, 'CONFLICT', 'This value is still used by existing records', 409);
    }

    throw error;
  }
});
