import type { MiddlewareHandler } from 'hono';
import { randomBytes } from 'crypto';
import { setCookie } from 'hono/cookie';
import { err } from '../lib/response.js';

const CSRF_HEADER = 'X-CSRF-Token';
const CSRF_COOKIE = 'csrf_token';

export const csrfProtection: MiddlewareHandler = async (c, next) => {
  const method = c.req.method;

  // Only check CSRF on state-changing methods
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    return next();
  }

  // Skip CSRF for API key authentication (header-based auth is CSRF-safe)
  const auth = c.get('auth');
  if (auth?.type === 'api_key') {
    return next();
  }

  const tokenFromHeader = c.req.header(CSRF_HEADER);
  const tokenFromCookie = c.req.raw.headers.get('cookie')
    ?.split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(`${CSRF_COOKIE}=`))
    ?.split('=')[1];

  if (!tokenFromHeader || !tokenFromCookie) {
    return err(c, 'CSRF_TOKEN_MISSING', 'CSRF token required', 403);
  }

  if (tokenFromHeader !== tokenFromCookie) {
    return err(c, 'CSRF_TOKEN_INVALID', 'Invalid CSRF token', 403);
  }

  return next();
};

// Middleware to generate CSRF token
export const csrfTokenGenerator: MiddlewareHandler = async (c, next) => {
  const auth = c.get('auth');
  if (auth?.type === 'jwt') {
    const existingToken = c.req.raw.headers.get('cookie')
      ?.split(';')
      .map(c => c.trim())
      .find(c => c.startsWith(`${CSRF_COOKIE}=`))
      ?.split('=')[1];

    if (!existingToken) {
      const csrfToken = randomBytes(32).toString('hex');
      setCookie(c, CSRF_COOKIE, csrfToken, {
        httpOnly: false, // Client needs to read this
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Strict',
        maxAge: 86400,
        path: '/',
      });
    }
  }

  await next();
};
