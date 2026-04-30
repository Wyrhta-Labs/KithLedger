import type { MiddlewareHandler } from 'hono';

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();

  // Content Security Policy
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // Tailwind needs inline styles
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; ');

  c.header('Content-Security-Policy', cspDirectives);

  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  // Explicitly disable legacy XSS auditor — modern browsers ignore it and some
  // versions introduced new vulnerabilities when it was enabled.
  c.header('X-XSS-Protection', '0');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // HSTS only for non-localhost origins (avoids breaking local dev)
  const host = c.req.header('host') ?? '';
  if (!host.includes('localhost') && !host.includes('127.0.0.1')) {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Hono does not add X-Powered-By by default. If a reverse proxy injects it,
  // remove it here. This is a no-op when the header is absent.
  c.res.headers.delete('X-Powered-By');
};
