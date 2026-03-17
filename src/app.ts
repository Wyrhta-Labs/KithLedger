import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { mountRoutes } from './routes/index.js';
import { errorHandler } from './middleware/error-handler.js';

// Extend Hono's variable type to include auth
declare module 'hono' {
  interface ContextVariableMap {
    auth: {
      type: 'api_key' | 'jwt';
      apiKeyId?: string;
      apiKeyName?: string;
      subject?: string;
    };
  }
}

export function createApp() {
  const app = new Hono();

  app.use('*', logger());
  app.use('*', cors());

  mountRoutes(app);

  app.onError(errorHandler);

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));

  return app;
}
