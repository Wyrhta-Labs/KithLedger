import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { serveStatic } from '@hono/node-server/serve-static';
import { config } from './config/env.js';
import { mountRoutes } from './routes/index.js';
import { errorHandler, securityHeaders, requestId } from '@wyrhta/core/http';

// Extend Hono's variable type for requestId (core's own `principal` variable
// is declared by @wyrhta/core itself — no 'auth' variable is ever set here).
declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
  }
}

export function createApp() {
  const app = new Hono();

  app.use('*', trimTrailingSlash());
  app.use('*', requestId);
  app.use('*', securityHeaders);
  app.use('*', logger());
  app.use('*', cors({ origin: config.corsOrigin }));
  app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024 })); // 1 MB

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
