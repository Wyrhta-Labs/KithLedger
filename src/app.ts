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
import { csrfProtection, csrfTokenGenerator } from './middleware/csrf.js';
import { createRateLimiter } from './middleware/rate-limit.js';

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
  app.use('*', cors({
    origin: config.corsOrigin,
    credentials: true,
  }));
  app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024 })); // 1 MB

  // CSRF protection
  app.use('/api/*', csrfTokenGenerator);
  app.use('/api/*', csrfProtection);

  // Global rate limiting on all API endpoints (500 req/min per IP)
  app.use('/api/*', createRateLimiter({ prefix: 'global', max: 500, windowSeconds: 60 }));

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
