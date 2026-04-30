import type { MiddlewareHandler } from 'hono';
import { redis } from '../db/redis.js';
import { logEvent } from '../lib/logger.js';

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const WINDOW_SECONDS = Math.floor(WINDOW_MS / 1000);
const MAX_ATTEMPTS = 10;

function getIp(c: Parameters<MiddlewareHandler>[0]): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('cf-connecting-ip') ??
    'unknown'
  );
}

export const rateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  const ip = getIp(c);
  const key = `ratelimit:auth:${ip}`;

  try {
    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    const ttl = await redis.ttl(key);

    if (count > MAX_ATTEMPTS) {
      const retryAfter = Math.max(ttl, 1);
      c.header('Retry-After', String(retryAfter));

      logEvent({
        event: 'rate_limit.exceeded',
        ip,
        count,
        request_id: c.get('requestId'),
      });

      return c.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' } },
        429
      );
    }

    c.header('X-RateLimit-Limit', String(MAX_ATTEMPTS));
    c.header('X-RateLimit-Remaining', String(Math.max(0, MAX_ATTEMPTS - count)));
    c.header('X-RateLimit-Reset', String(Date.now() + (ttl * 1000)));

    return next();
  } catch (error) {
    // Fail open - log error but allow request
    logEvent({
      event: 'rate_limit.error',
      ip,
      error: String(error),
      request_id: c.get('requestId'),
    });
    return next();
  }
};

export function createRateLimiter(options: {
  prefix: string;
  max: number;
  windowSeconds: number;
}): MiddlewareHandler {
  return async (c, next) => {
    const ip = getIp(c);
    const key = `ratelimit:${options.prefix}:${ip}`;

    try {
      const count = await redis.incr(key);

      if (count === 1) {
        await redis.expire(key, options.windowSeconds);
      }

      if (count > options.max) {
        const ttl = await redis.ttl(key);
        c.header('Retry-After', String(Math.max(ttl, 1)));
        return c.json(
          { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
          429
        );
      }

      c.header('X-RateLimit-Limit', String(options.max));
      c.header('X-RateLimit-Remaining', String(Math.max(0, options.max - count)));

      return next();
    } catch (error) {
      logEvent({ event: 'rate_limit.error', error: String(error) });
      return next();
    }
  };
}
