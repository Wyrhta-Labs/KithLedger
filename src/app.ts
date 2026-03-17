import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { serveStatic } from '@hono/node-server/serve-static';
import { config } from './config/env.js';
import { mountRoutes } from './routes/index.js';
import { errorHandler } from './middleware/error-handler.js';
import { securityHeaders } from './middleware/security-headers.js';
import { requestId } from './middleware/request-id.js';

// Extend Hono's variable type to include auth and requestId
declare module 'hono' {
  interface ContextVariableMap {
    auth: {
      type: 'api_key' | 'jwt';
      apiKeyId?: string;
      apiKeyName?: string;
      subject?: string;
    };
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
