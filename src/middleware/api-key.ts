import type { MiddlewareHandler } from 'hono';
import { db } from '../db/index.js';
import { apiKeys } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { hashKey } from '../lib/crypto.js';
import { err } from '../lib/response.js';

export const apiKeyMiddleware: MiddlewareHandler = async (c, next) => {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer kl_')) {
    return next();
  }

  const raw = authorization.slice(7); // strip 'Bearer '
  const hash = hashKey(raw);

  const [key] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hash))
    .limit(1);

  if (!key || !key.isActive) {
    return err(c, 'UNAUTHORIZED', 'Invalid API key', 401);
  }

  if (key.expiresAt && key.expiresAt < new Date()) {
    return err(c, 'UNAUTHORIZED', 'API key expired', 401);
  }

  // Fire-and-forget update last_used_at
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .execute()
    .catch(() => {});

  c.set('auth', {
    type: 'api_key' as const,
    apiKeyId: key.id,
    apiKeyName: key.name,
  });

  return next();
};
