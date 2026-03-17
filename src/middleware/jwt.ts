import type { MiddlewareHandler } from 'hono';
import { verify } from 'hono/jwt';
import { config } from '../config/env.js';
import { err } from '../lib/response.js';

export const jwtMiddleware: MiddlewareHandler = async (c, next) => {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return next();
  }

  const token = authorization.slice(7);
  if (token.startsWith('kl_')) {
    return next(); // handled by api-key middleware
  }

  try {
    const payload = await verify(token, config.jwtSecret, 'HS256');
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
      return err(c, 'UNAUTHORIZED', 'Token expired', 401);
    }
    if (!payload.sub || typeof payload.sub !== 'string') {
      return err(c, 'UNAUTHORIZED', 'Invalid token', 401);
    }
    c.set('auth', {
      type: 'jwt' as const,
      subject: payload.sub,
    });
  } catch {
    return err(c, 'UNAUTHORIZED', 'Invalid token', 401);
  }

  return next();
};
