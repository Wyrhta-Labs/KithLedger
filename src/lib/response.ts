import type { Context } from 'hono';

export interface Meta {
  total?: number;
  limit?: number;
  offset?: number;
  [key: string]: unknown;
}

export function ok<T>(c: Context, data: T, meta?: Meta, status: 200 | 201 = 200) {
  return c.json({ data, meta: meta ?? {} }, status);
}

export function err(c: Context, code: string, message: string, status: 400 | 401 | 403 | 404 | 409 | 500 = 500) {
  return c.json({ error: { code, message } }, status);
}
