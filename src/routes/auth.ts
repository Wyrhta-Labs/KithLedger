import { Hono, type MiddlewareHandler } from 'hono';
import { sign } from 'hono/jwt';
import { createHash, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { config } from '../config/env.js';
import { db } from '../db/index.js';
import { apiKeys } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { ok, err, rateLimit } from '@wyrhta/core/http';
import { requireJwt } from '../middleware/auth.js';
import { generateApiKey, logEvent } from '@wyrhta/core/lib';

export const authRouter = new Hono();

const tokenSchema = z.object({
  password: z.string(),
});

const createKeySchema = z.object({
  name: z.string().min(1),
  expiresAt: z.string().datetime().optional().nullable(),
});

function checkPassword(input: string, expected: string): boolean {
  const inputHash = createHash('sha256').update(input).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(inputHash, expectedHash);
}

function getIp(c: Parameters<MiddlewareHandler>[0]): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('cf-connecting-ip') ??
    'unknown'
  );
}

authRouter.post('/token', rateLimit(), async (c) => {
  const body = tokenSchema.safeParse(await c.req.json());
  if (!body.success) {
    return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  }

  const ip = getIp(c);
  const requestId = c.get('requestId');

  if (!checkPassword(body.data.password, config.adminPassword)) {
    logEvent({ event: 'auth.token.failure', ip, success: false, request_id: requestId });
    return err(c, 'UNAUTHORIZED', 'Invalid password', 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: 'admin',
    iat: now,
    exp: now + config.jwtTtlSeconds,
  };

  const token = await sign(payload, config.jwtSecret);
  logEvent({ event: 'auth.token.success', ip, success: true, request_id: requestId });
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

  const { raw, hash, prefix } = generateApiKey({ prefix: 'kl_' });

  const [row] = await db
    .insert(apiKeys)
    .values({
      name: body.data.name,
      keyHash: hash,
      keyPrefix: prefix,
      expiresAt: body.data.expiresAt ? new Date(body.data.expiresAt) : null,
    })
    .returning();

  if (!row) throw new Error('Failed to create API key');

  logEvent({ event: 'auth.key.created', key_id: row.id, key_name: row.name, request_id: c.get('requestId') });

  return ok(
    c,
    {
      id: row.id,
      name: row.name,
      key: raw, // only time raw key is returned
      keyPrefix: row.keyPrefix,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
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

  logEvent({ event: 'auth.key.revoked', key_id: row.id, key_name: row.name, request_id: c.get('requestId') });

  return ok(c, { id: row.id, isActive: false });
});
