import type { MiddlewareHandler } from 'hono';

export const requestId: MiddlewareHandler = async (c, next) => {
  // Accept an incoming request ID for distributed tracing, or generate a fresh one
  const id = c.req.header('x-request-id') ?? crypto.randomUUID();
  c.set('requestId', id);
  c.header('X-Request-Id', id);
  await next();
};
