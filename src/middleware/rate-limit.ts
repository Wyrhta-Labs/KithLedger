import type { MiddlewareHandler } from 'hono';

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;

interface RateEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateEntry>();

function getIp(c: Parameters<MiddlewareHandler>[0]): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('cf-connecting-ip') ??
    'unknown'
  );
}

export const rateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  const ip = getIp(c);
  const now = Date.now();

  const entry = store.get(ip);
  if (!entry || entry.resetAt < now) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  entry.count++;

  if (entry.count > MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    c.header('Retry-After', String(retryAfter));
    return c.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' } },
      429
    );
  }

  return next();
};
