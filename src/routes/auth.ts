import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { setCookie, getCookie } from 'hono/cookie';
import bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import { z } from 'zod';
import { config } from '../config/env.js';
import { db } from '../db/index.js';
import { redis } from '../db/redis.js';
import { apiKeys, refreshTokens } from '../db/schema/index.js';
import { eq, and, gt } from 'drizzle-orm';
import { generateApiKey } from '../lib/crypto.js';
import { ok, err } from '../lib/response.js';
import { requireJwt } from '../middleware/auth.js';
import { rateLimitMiddleware } from '../middleware/rate-limit.js';
import { logEvent } from '../lib/logger.js';

export const authRouter = new Hono();

const tokenSchema = z.object({
  password: z.string(),
});

const createKeySchema = z.object({
  name: z.string().min(1),
  expiresAt: z.string().datetime().optional().nullable().default(() => {
    const oneYear = new Date();
    oneYear.setFullYear(oneYear.getFullYear() + 1);
    return oneYear.toISOString();
  }),
});

async function checkPassword(input: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(input, hash);
}

const ACCESS_TOKEN_TTL = 900; // 15 minutes
const REFRESH_TOKEN_TTL = config.jwtTtlSeconds; // 7 days default

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function issueTokens(c: Parameters<typeof rateLimitMiddleware>[0], subject: string) {
  const now = Math.floor(Date.now() / 1000);
  const accessPayload = {
    sub: subject,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL,
  };

  const accessToken = await sign(accessPayload, config.jwtSecret);

  // Generate refresh token
  const rawRefreshToken = randomBytes(32).toString('hex');
  const refreshHash = hashToken(rawRefreshToken);

  await db.insert(refreshTokens).values({
    tokenHash: refreshHash,
    subject,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL * 1000),
  });

  const isProduction = process.env.NODE_ENV === 'production';

  // Set access token as httpOnly cookie
  setCookie(c, 'kith_jwt', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'Strict',
    maxAge: ACCESS_TOKEN_TTL,
    path: '/',
  });

  // Set refresh token as httpOnly cookie
  setCookie(c, 'kith_refresh', rawRefreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'Strict',
    maxAge: REFRESH_TOKEN_TTL,
    path: '/api/v1/auth',
  });

  return { accessToken, expiresIn: ACCESS_TOKEN_TTL };
}

function getIp(c: Parameters<typeof rateLimitMiddleware>[0]): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('cf-connecting-ip') ??
    'unknown'
  );
}

authRouter.post('/token', rateLimitMiddleware, async (c) => {
  const body = tokenSchema.safeParse(await c.req.json());
  if (!body.success) {
    return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  }

  const ip = getIp(c);
  const requestId = c.get('requestId');

  // Check for account lockout
  const lockoutKey = 'auth:lockout:admin';
  try {
    const failedCount = await redis.get(lockoutKey);
    const failedAttempts = failedCount ? parseInt(failedCount, 10) : 0;

    if (failedAttempts >= 5) {
      const ttl = await redis.ttl(lockoutKey);
      c.header('Retry-After', String(Math.max(ttl, 1)));
      logEvent({
        event: 'auth.account.locked',
        ip,
        failed_attempts: failedAttempts,
        request_id: requestId,
      });
      return err(c, 'ACCOUNT_LOCKED',
        `Account temporarily locked due to too many failed attempts. Try again in ${Math.ceil(ttl / 60)} minutes.`,
        403);
    }
  } catch (error) {
    logEvent({ event: 'auth.lockout.check.error', error: String(error) });
  }

  if (!(await checkPassword(body.data.password, config.adminPasswordHash))) {
    // Increment failed attempts
    try {
      const newCount = await redis.incr(lockoutKey);
      if (newCount === 1) {
        await redis.expire(lockoutKey, 3600); // 1 hour lockout window
      }
      logEvent({
        event: 'auth.token.failure',
        ip,
        success: false,
        failed_attempts: newCount,
        request_id: requestId,
      });
    } catch (error) {
      logEvent({ event: 'auth.lockout.increment.error', error: String(error) });
    }

    return err(c, 'UNAUTHORIZED', 'Invalid password', 401);
  }

  // Success - clear failed attempts
  try {
    await redis.del(lockoutKey);
  } catch {
    // Ignore error
  }

  const { accessToken, expiresIn } = await issueTokens(c, 'admin');

  logEvent({ event: 'auth.token.success', ip, success: true, request_id: requestId });
  return ok(c, { token: accessToken, expires_in: expiresIn });
});

// Logout endpoint
authRouter.post('/logout', requireJwt, async (c) => {
  // Revoke refresh token if present
  const refreshCookie = getCookie(c, 'kith_refresh');
  if (refreshCookie) {
    const hash = hashToken(refreshCookie);
    await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, hash));
  }

  const isProduction = process.env.NODE_ENV === 'production';
  setCookie(c, 'kith_jwt', '', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'Strict',
    maxAge: 0,
    path: '/',
  });
  setCookie(c, 'kith_refresh', '', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'Strict',
    maxAge: 0,
    path: '/api/v1/auth',
  });
  return ok(c, { success: true });
});

// Refresh token endpoint
authRouter.post('/refresh', async (c) => {
  const refreshCookie = getCookie(c, 'kith_refresh');
  if (!refreshCookie) {
    return err(c, 'UNAUTHORIZED', 'No refresh token', 401);
  }

  const hash = hashToken(refreshCookie);

  // Find valid refresh token
  const [token] = await db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.tokenHash, hash),
        gt(refreshTokens.expiresAt, new Date())
      )
    )
    .limit(1);

  if (!token) {
    return err(c, 'UNAUTHORIZED', 'Invalid or expired refresh token', 401);
  }

  // Delete old refresh token (rotation)
  await db.delete(refreshTokens).where(eq(refreshTokens.id, token.id));

  // Issue new tokens
  const { accessToken, expiresIn } = await issueTokens(c, token.subject);

  logEvent({ event: 'auth.token.refreshed', subject: token.subject, request_id: c.get('requestId') });
  return ok(c, { token: accessToken, expires_in: expiresIn });
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
