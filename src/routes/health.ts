import { Hono } from 'hono';
import { ok } from '../lib/response.js';

export const healthRouter = new Hono();

healthRouter.get('/health', (c) => ok(c, { status: 'ok' }));
