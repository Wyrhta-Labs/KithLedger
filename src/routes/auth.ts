import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { z } from 'zod';
import { config } from '../config/env.js';
import { db } from '../db/index.js';
import { apiKeys } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { generateApiKey } from '../lib/crypto.js';
import { ok, err } from '../lib/response.js';
import { requireJwt } from '../middleware/auth.js';

export const authRouter = new Hono();

const tokenSchema = z.object({
  password: z.string(),
});

const createKeySchema = z.object({
  name: z.string().min(1),
  expiresAt: z.string().datetime().optional().nullable(),
});

authRouter.post('/token', async (c) => {
  const body = tokenSchema.safeParse(await c.req.json());
  if (!body.success) {
    return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  }

  if (body.data.password !== config.adminPassword) {
    return err(c, 'UNAUTHORIZED', 'Invalid password', 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: 'admin',
    iat: now,
    exp: now + config.jwtTtlSeconds,
  };

  const token = await sign(payload, config.jwtSecret);
  return ok(c, { token, expires_in: config.jwtTtlSeconds });
});

authRouter.get('/keys', requireJwt, async (c) => {
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      isActive: apiKeys.isActive,
      scopes: apiKeys.scopes,
    })
    .from(apiKeys)
    .orderBy(apiKeys.createdAt);

  return ok(c, rows);
});

authRouter.post('/keys', requireJwt, async (c) => {
  const body = createKeySchema.safeParse(await c.req.json());
  if (!body.success) {
    return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  }

  const { raw, hash, prefix } = generateApiKey();

  const [row] = await db
    .insert(apiKeys)
    .values({
      name: body.data.name,
      keyHash: hash,
      keyPrefix: prefix,
      expiresAt: body.data.expiresAt ? new Date(body.data.expiresAt) : null,
    })
    .returning();

  return ok(
    c,
    {
      id: row!.id,
      name: row!.name,
      key: raw, // only time raw key is returned
      keyPrefix: row!.keyPrefix,
      createdAt: row!.createdAt,
      expiresAt: row!.expiresAt,
    },
    undefined,
    201
  );
});

authRouter.delete('/keys/:id', requireJwt, async (c) => {
  const id = c.req.param('id');
  const [row] = await db
    .update(apiKeys)
    .set({ isActive: false })
    .where(eq(apiKeys.id, id))
    .returning();

  if (!row) {
    return err(c, 'NOT_FOUND', 'API key not found', 404);
  }

  return ok(c, { id: row.id, isActive: false });
});
