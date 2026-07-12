import { Hono, type MiddlewareHandler } from 'hono';
import { sign } from 'hono/jwt';
import { createHash, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { config } from '../config/env.js';
import { ok, err, rateLimit } from '@wyrhta/core/http';
import { requireJwt } from '../middleware/auth.js';
import { logEvent } from '@wyrhta/core/lib';

export const authRouter = new Hono();

const tokenSchema = z.object({
  password: z.string(),
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

// TEMPORARY: rebuilt on core identity in Task 7
authRouter.get('/keys', requireJwt, async (c) => {
  // core's err() status union has no 501; 500 is the closest available temporary status
  return err(c, 'NOT_IMPLEMENTED', 'API key management is migrating', 500);
});

// TEMPORARY: rebuilt on core identity in Task 7
authRouter.post('/keys', requireJwt, async (c) => {
  // core's err() status union has no 501; 500 is the closest available temporary status
  return err(c, 'NOT_IMPLEMENTED', 'API key management is migrating', 500);
});

// TEMPORARY: rebuilt on core identity in Task 7
authRouter.delete('/keys/:id', requireJwt, async (c) => {
  // core's err() status union has no 501; 500 is the closest available temporary status
  return err(c, 'NOT_IMPLEMENTED', 'API key management is migrating', 500);
});
