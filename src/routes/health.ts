import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { ok } from '@wyrhta/core/http';

export const healthRouter = new Hono();

healthRouter.get('/health', async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return ok(c, { status: 'ok', db: 'connected' });
  } catch {
    return c.json({ data: { status: 'degraded', db: 'disconnected' } }, 503);
  }
});
