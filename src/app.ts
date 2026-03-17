import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
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

  // Return JSON 404 for unmatched API routes (before static serving)
  app.all('/api/*', (c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));

  // Serve static assets from web/dist
  app.use('/*', serveStatic({ root: './web/dist' }));

  // SPA fallback: any unmatched GET returns index.html
  app.get('/*', serveStatic({ root: './web/dist', rewriteRequestPath: () => '/index.html' }));

  app.onError(errorHandler);

  return app;
}
