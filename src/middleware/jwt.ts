import type { MiddlewareHandler } from 'hono';
import { verify } from 'hono/jwt';
import { getCookie } from 'hono/cookie';
import { config } from '../config/env.js';
import { err } from '../lib/response.js';

export const jwtMiddleware: MiddlewareHandler = async (c, next) => {
  // Check cookie first, then Authorization header
  const cookieToken = getCookie(c, 'kith_jwt');
  const authorization = c.req.header('Authorization');

  let token: string | undefined;

  if (cookieToken) {
    token = cookieToken;
  } else if (authorization?.startsWith('Bearer ')) {
    const bearerToken = authorization.slice(7);
    // Only accept JWT tokens here (not API keys)
    if (!bearerToken.startsWith('kl_')) {
      token = bearerToken;
    }
  }

  if (!token) {
    return next();
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
