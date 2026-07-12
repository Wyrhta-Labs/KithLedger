import type { MiddlewareHandler } from 'hono';
import { apiKeyMiddleware } from './api-key.js';
import { jwtMiddleware } from './jwt.js';
import { err } from '@wyrhta/core/http';

export interface AuthContext {
  type: 'api_key' | 'jwt';
  apiKeyId?: string;
  apiKeyName?: string;
  subject?: string;
}

/** Run both auth strategies; if neither sets auth, return 401 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  // Try API key first
  let resolved = false;
  await apiKeyMiddleware(c, async () => {
    if (c.get('auth')) {
      resolved = true;
      return;
    }
    // Try JWT
    await jwtMiddleware(c, async () => {
      if (c.get('auth')) resolved = true;
    });
  });

  if (!c.get('auth')) {
    return err(c, 'UNAUTHORIZED', 'Authentication required', 401);
  }

  return next();
};

/** Require JWT auth only (rejects API keys) */
export const requireJwt: MiddlewareHandler = async (c, next) => {
  await jwtMiddleware(c, async () => {});
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || auth.type !== 'jwt') {
    return err(c, 'UNAUTHORIZED', 'JWT authentication required', 401);
  }
  return next();
};
