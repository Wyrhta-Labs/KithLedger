# Security Fixes Implementation Guide

This document provides complete, copy-paste-ready code for fixing the critical and high-severity security issues identified in [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

---

## Critical Issue Fixes

### C1: Fix SQL Injection in Search Queries

**File: src/services/people.ts**

Replace the vulnerable search implementation:

```typescript
import { db } from '../db/index.js';
import { people } from '../db/schema/index.js';
import { eq, or, and, sql, asc, desc } from 'drizzle-orm';
import type { CreatePersonInput, UpdatePersonInput, ListPeopleQuery } from '../validators/people.js';
import { syncBirthdayReminderForPerson } from './birthday-reminders.js';

export async function listPeople(query: ListPeopleQuery) {
  let baseQuery = db.select().from(people).$dynamic();

  const conditions = [];

  if (query.q) {
    // ✅ Use sql.placeholder() for safe parameterization
    const searchTerm = `%${query.q.replace(/[%_]/g, '\\$&')}%`; // Escape LIKE wildcards
    conditions.push(
      or(
        sql`${people.name} ILIKE ${searchTerm}`,
        sql`${people.email} ILIKE ${searchTerm}`
      )
    );
  }

  if (query.tags) {
    const tagList = query.tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (tagList.length > 0) {
      // Use parameterized array comparison
      conditions.push(sql`${people.tags} && ${tagList}`);
    }
  }

  if (query.birthday_month) {
    // Already parameterized - coerced number from validator
    conditions.push(sql`EXTRACT(MONTH FROM ${people.birthday}) = ${query.birthday_month}`);
  }

  if (conditions.length > 0) {
    baseQuery = baseQuery.where(and(...conditions));
  }

  const orderCol = query.sort === 'created_at'
    ? people.createdAt
    : query.sort === 'updated_at'
    ? people.updatedAt
    : query.sort === 'birthday'
    ? people.birthday
    : people.name;

  baseQuery = baseQuery.orderBy(query.order === 'desc' ? desc(orderCol) : asc(orderCol));

  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const offset = Math.max(0, query.offset ?? 0);

  const rows = await baseQuery.limit(limit).offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(people);

  return { rows, total: count, limit, offset };
}

// Keep rest of file unchanged...
```

**Apply same fix to other services:**
- [src/services/interactions.ts](src/services/interactions.ts) - search functionality
- Any other services with LIKE/ILIKE queries

---

### C2: Fix Plain Text Password Storage

**Step 1: Install bcrypt**

```bash
npm install bcrypt
npm install --save-dev @types/bcrypt
```

**Step 2: Update config/env.ts**

```typescript
import { z } from 'zod';
import bcrypt from 'bcrypt';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters for HS256 security'),
  ADMIN_PASSWORD: z.string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  CORS_ORIGIN: z.string().default('*'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

// Hash password once at startup
const adminPasswordHash = await bcrypt.hash(parsed.data.ADMIN_PASSWORD, 12);

export const config = {
  databaseUrl: parsed.data.DATABASE_URL,
  jwtSecret: parsed.data.JWT_SECRET,
  adminPasswordHash, // ✅ Store hash only
  port: parsed.data.API_PORT,
  jwtTtlSeconds: parsed.data.JWT_TTL_SECONDS,
  corsOrigin: parsed.data.CORS_ORIGIN,
  dbPoolMax: parsed.data.DB_POOL_MAX,
} as const;
```

**Step 3: Update routes/auth.ts**

```typescript
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { config } from '../config/env.js';
import { db } from '../db/index.js';
import { apiKeys } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { generateApiKey } from '../lib/crypto.js';
import { ok, err } from '../lib/response.js';
import { requireJwt } from '../middleware/auth.js';
import { rateLimitMiddleware } from '../middleware/rate-limit.js';
import { logEvent } from '../lib/logger.js';

export const authRouter = new Hono();

const tokenSchema = z.object({
  password: z.string(),
});

const createKeySchema = z.object({
  name: z.string().min(1),
  expiresAt: z.string().datetime().optional().nullable(),
});

// ✅ Remove timing-unsafe checkPassword, use bcrypt
async function checkPassword(input: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(input, hash);
}

function getIp(c: Parameters<typeof rateLimitMiddleware>[0]): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('cf-connecting-ip') ??
    'unknown'
  );
}

authRouter.post('/token', rateLimitMiddleware, async (c) => {
  const body = tokenSchema.safeParse(await c.req.json());
  if (!body.success) {
    return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  }

  const ip = getIp(c);
  const requestId = c.get('requestId');

  // ✅ Use bcrypt comparison
  if (!(await checkPassword(body.data.password, config.adminPasswordHash))) {
    logEvent({ event: 'auth.token.failure', ip, success: false, request_id: requestId });
    return err(c, 'UNAUTHORIZED', 'Invalid password', 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: 'admin',
    iat: now,
    exp: now + config.jwtTtlSeconds,
  };

  const token = await sign(payload, config.jwtSecret);
  logEvent({ event: 'auth.token.success', ip, success: true, request_id: requestId });
  return ok(c, { token, expires_in: config.jwtTtlSeconds });
});

// Keep rest of file unchanged...
```

**Step 4: Update .env.example**

```env
# Auth — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=<generate-a-32-char-minimum-random-string>

# ADMIN_PASSWORD requirements:
# - Minimum 12 characters
# - Must contain: uppercase, lowercase, number, special character
# Example: MyStr0ng!P@ssw0rd
ADMIN_PASSWORD=<generate-a-strong-password>
```

---

### C3: Fix In-Memory Rate Limiting

**Step 1: Install Redis**

```bash
npm install ioredis
npm install --save-dev @types/ioredis
```

**Step 2: Update config/env.ts**

```typescript
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'), // ✅ Add Redis
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters for HS256 security'),
  // ... rest unchanged
});

export const config = {
  databaseUrl: parsed.data.DATABASE_URL,
  redisUrl: parsed.data.REDIS_URL, // ✅ Export Redis URL
  // ... rest unchanged
} as const;
```

**Step 3: Create db/redis.ts**

```typescript
import Redis from 'ioredis';
import { config } from '../config/env.js';
import { logError } from '../lib/logger.js';

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  enableOfflineQueue: true,
});

redis.on('error', (err) => {
  logError('Redis connection error', err);
});

redis.on('connect', () => {
  console.log('✓ Redis connected');
});
```

**Step 4: Rewrite middleware/rate-limit.ts**

```typescript
import type { MiddlewareHandler } from 'hono';
import { redis } from '../db/redis.js';
import { logEvent } from '../lib/logger.js';

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const WINDOW_SECONDS = Math.floor(WINDOW_MS / 1000);
const MAX_ATTEMPTS = 10;

function getIp(c: Parameters<MiddlewareHandler>[0]): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('cf-connecting-ip') ??
    'unknown'
  );
}

export const rateLimitMiddleware: MiddlewareHandler = async (c, next) => {
  const ip = getIp(c);
  const key = `ratelimit:auth:${ip}`;
  
  try {
    // Increment counter
    const count = await redis.incr(key);
    
    // Set expiration on first request
    if (count === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }
    
    // Get TTL for Retry-After header
    const ttl = await redis.ttl(key);
    
    if (count > MAX_ATTEMPTS) {
      const retryAfter = Math.max(ttl, 1);
      c.header('Retry-After', String(retryAfter));
      
      logEvent({
        event: 'rate_limit.exceeded',
        ip,
        count,
        request_id: c.get('requestId'),
      });
      
      return c.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' } },
        429
      );
    }
    
    // Add rate limit headers
    c.header('X-RateLimit-Limit', String(MAX_ATTEMPTS));
    c.header('X-RateLimit-Remaining', String(Math.max(0, MAX_ATTEMPTS - count)));
    c.header('X-RateLimit-Reset', String(Date.now() + (ttl * 1000)));
    
    return next();
  } catch (error) {
    // Fail open - log error but allow request
    logEvent({
      event: 'rate_limit.error',
      ip,
      error: String(error),
      request_id: c.get('requestId'),
    });
    return next();
  }
};

// ✅ Create flexible rate limiter factory
export function createRateLimiter(options: {
  prefix: string;
  max: number;
  windowSeconds: number;
}): MiddlewareHandler {
  return async (c, next) => {
    const ip = getIp(c);
    const key = `ratelimit:${options.prefix}:${ip}`;
    
    try {
      const count = await redis.incr(key);
      
      if (count === 1) {
        await redis.expire(key, options.windowSeconds);
      }
      
      if (count > options.max) {
        const ttl = await redis.ttl(key);
        c.header('Retry-After', String(Math.max(ttl, 1)));
        return c.json(
          { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
          429
        );
      }
      
      c.header('X-RateLimit-Limit', String(options.max));
      c.header('X-RateLimit-Remaining', String(Math.max(0, options.max - count)));
      
      return next();
    } catch (error) {
      logEvent({ event: 'rate_limit.error', error: String(error) });
      return next();
    }
  };
}
```

**Step 5: Update docker-compose.yml**

```yaml
services:
  api:
    build: .
    ports:
      - "${API_PORT:-3000}:3000"
    environment:
      DATABASE_URL: postgres://kith:${POSTGRES_PASSWORD}@db:5432/kithledger
      REDIS_URL: redis://redis:6379  # ✅ Add Redis URL
      JWT_SECRET: ${JWT_SECRET}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      API_PORT: 3000
      JWT_TTL_SECONDS: ${JWT_TTL_SECONDS:-604800}
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy  # ✅ Wait for Redis
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: kith
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: kithledger
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kith -d kithledger"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped

  # ✅ Add Redis service
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:  # ✅ Add Redis volume
```

**Step 6: Update .env.example**

```env
# Database — matches docker-compose.yml service credentials
POSTGRES_PASSWORD=<generate-a-strong-password>
DATABASE_URL=postgres://kith:<generate-a-strong-password>@localhost:5432/kithledger

# Redis
REDIS_URL=redis://localhost:6379

# ... rest unchanged
```

---

## High Severity Issue Fixes

### H1: Migrate JWT to httpOnly Cookies

**Step 1: Update routes/auth.ts**

```typescript
authRouter.post('/token', rateLimitMiddleware, async (c) => {
  const body = tokenSchema.safeParse(await c.req.json());
  if (!body.success) {
    return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  }

  const ip = getIp(c);
  const requestId = c.get('requestId');

  if (!(await checkPassword(body.data.password, config.adminPasswordHash))) {
    logEvent({ event: 'auth.token.failure', ip, success: false, request_id: requestId });
    return err(c, 'UNAUTHORIZED', 'Invalid password', 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: 'admin',
    iat: now,
    exp: now + config.jwtTtlSeconds,
  };

  const token = await sign(payload, config.jwtSecret);
  
  // ✅ Set httpOnly cookie instead of returning token
  const isProduction = process.env.NODE_ENV === 'production';
  c.cookie('kith_jwt', token, {
    httpOnly: true,
    secure: isProduction, // HTTPS only in production
    sameSite: 'strict',
    maxAge: config.jwtTtlSeconds,
    path: '/',
  });
  
  logEvent({ event: 'auth.token.success', ip, success: true, request_id: requestId });
  
  // Return success without token (it's in cookie)
  return ok(c, { 
    success: true,
    expires_in: config.jwtTtlSeconds 
  });
});

// ✅ Add logout endpoint
authRouter.post('/logout', requireJwt, async (c) => {
  // Clear cookie
  c.cookie('kith_jwt', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });
  
  return ok(c, { success: true });
});
```

**Step 2: Update middleware/jwt.ts**

```typescript
import type { MiddlewareHandler } from 'hono';
import { verify } from 'hono/jwt';
import { config } from '../config/env.js';
import { err } from '../lib/response.js';

export const jwtMiddleware: MiddlewareHandler = async (c, next) => {
  // ✅ Check cookie first, then Authorization header for API keys
  const cookieToken = c.req.cookie('kith_jwt');
  const authorization = c.req.header('Authorization');
  
  let token: string | undefined;
  
  if (cookieToken) {
    token = cookieToken;
  } else if (authorization?.startsWith('Bearer ')) {
    const bearerToken = authorization.slice(7);
    // Only accept JWT tokens here (starting with eyJ), not API keys (kl_)
    if (!bearerToken.startsWith('kl_')) {
      token = bearerToken;
    }
  }
  
  if (!token) {
    return next();
  }

  try {
    const payload = await verify(token, config.jwtSecret, 'HS256');
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
      return err(c, 'UNAUTHORIZED', 'Token expired', 401);
    }
    if (!payload.sub || typeof payload.sub !== 'string') {
      return err(c, 'UNAUTHORIZED', 'Invalid token', 401);
    }
    c.set('auth', {
      type: 'jwt' as const,
      subject: payload.sub,
    });
  } catch {
    return err(c, 'UNAUTHORIZED', 'Invalid token', 401);
  }

  return next();
};
```

**Step 3: Add CSRF protection middleware**

Create **src/middleware/csrf.ts**:

```typescript
import type { MiddlewareHandler } from 'hono';
import { createHash, randomBytes } from 'crypto';
import { err } from '../lib/response.js';

const CSRF_HEADER = 'X-CSRF-Token';
const CSRF_COOKIE = 'csrf_token';

export const csrfProtection: MiddlewareHandler = async (c, next) => {
  const method = c.req.method;
  
  // Only check CSRF on state-changing methods
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    return next();
  }
  
  // Skip CSRF for API key authentication (header-based auth is CSRF-safe)
  const auth = c.get('auth');
  if (auth?.type === 'api_key') {
    return next();
  }
  
  const tokenFromHeader = c.req.header(CSRF_HEADER);
  const tokenFromCookie = c.req.cookie(CSRF_COOKIE);
  
  if (!tokenFromHeader || !tokenFromCookie) {
    return err(c, 'CSRF_TOKEN_MISSING', 'CSRF token required', 403);
  }
  
  if (tokenFromHeader !== tokenFromCookie) {
    return err(c, 'CSRF_TOKEN_INVALID', 'Invalid CSRF token', 403);
  }
  
  return next();
};

// Middleware to generate CSRF token
export const csrfTokenGenerator: MiddlewareHandler = async (c, next) => {
  // Only generate for authenticated JWT sessions
  const auth = c.get('auth');
  if (auth?.type === 'jwt') {
    let csrfToken = c.req.cookie(CSRF_COOKIE);
    
    if (!csrfToken) {
      csrfToken = randomBytes(32).toString('hex');
      c.cookie(CSRF_COOKIE, csrfToken, {
        httpOnly: false, // Client needs to read this
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 86400, // 24 hours
        path: '/',
      });
    }
  }
  
  await next();
};
```

**Step 4: Update app.ts**

```typescript
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
import { csrfProtection, csrfTokenGenerator } from './middleware/csrf.js'; // ✅ Import CSRF

// ... type declarations ...

export function createApp() {
  const app = new Hono();

  app.use('*', trimTrailingSlash());
  app.use('*', requestId);
  app.use('*', securityHeaders);
  app.use('*', logger());
  app.use('*', cors({ 
    origin: config.corsOrigin,
    credentials: true, // ✅ Allow cookies
  }));
  app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024 }));
  
  // ✅ Add CSRF protection
  app.use('/api/*', csrfTokenGenerator);
  app.use('/api/*', csrfProtection);

  mountRoutes(app);

  app.all('/api/*', (c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));

  app.use('/*', serveStatic({ root: './web/dist' }));
  app.get('/*', serveStatic({ root: './web/dist', rewriteRequestPath: () => '/index.html' }));

  app.onError(errorHandler);

  return app;
}
```

**Step 5: Update frontend - web/src/api/client.ts**

```typescript
const BASE_URL = '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ✅ Helper to get CSRF token from cookie
function getCsrfToken(): string | null {
  const match = document.cookie.match(/csrf_token=([^;]+)/);
  return match ? match[1] : null;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  // ✅ Add CSRF token for state-changing requests
  const method = options.method || 'GET';
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }
  
  if (options.headers) {
    Object.assign(headers, options.headers);
  }

  const res = await fetch(`${BASE_URL}${path}`, { 
    ...options, 
    headers,
    credentials: 'include', // ✅ Send cookies
  });

  if (res.status === 401) {
    // Session expired, redirect to login
    window.location.href = '/login';
    throw new ApiError(401, 'UNAUTHORIZED', 'Session expired');
  }

  const json = await res.json();

  if (!res.ok) {
    throw new ApiError(
      res.status,
      json.error?.code ?? 'UNKNOWN',
      json.error?.message ?? 'Request failed',
    );
  }

  return json as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: 'DELETE' });
}
```

**Step 6: Update frontend - web/src/hooks/use-auth.ts**

```typescript
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { login as apiLogin } from '../api/auth';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ✅ JWT is now in httpOnly cookie - more secure
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
  });

  // Check if user is authenticated on mount
  const checkAuth = useCallback(async () => {
    try {
      // Try to fetch user profile or health check
      await fetch('/api/v1/health', { credentials: 'include' });
      setState({ isAuthenticated: true, isLoading: false });
    } catch {
      setState({ isAuthenticated: false, isLoading: false });
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (password: string) => {
    await apiLogin(password);
    // Cookie is automatically set by server
    setState({ isAuthenticated: true, isLoading: false });
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore errors
    }
    setState({ isAuthenticated: false, isLoading: false });
    window.location.href = '/login';
  }, []);

  return React.createElement(
    AuthContext.Provider,
    { value: { ...state, login, logout, checkAuth } },
    children,
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

---

### H2: Add Content Security Policy

**File: src/middleware/security-headers.ts**

```typescript
import type { MiddlewareHandler } from 'hono';

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();

  // ✅ Add Content Security Policy
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
  c.header('X-XSS-Protection', '0');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  const host = c.req.header('host') ?? '';
  if (!host.includes('localhost') && !host.includes('127.0.0.1')) {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  c.res.headers.delete('X-Powered-By');
};
```

---

### H3: Add Account Lockout

**File: src/routes/auth.ts** (updated section)

```typescript
authRouter.post('/token', rateLimitMiddleware, async (c) => {
  const body = tokenSchema.safeParse(await c.req.json());
  if (!body.success) {
    return err(c, 'VALIDATION_ERROR', 'Invalid request body', 400);
  }

  const ip = getIp(c);
  const requestId = c.get('requestId');
  
  // ✅ Check for account lockout
  const lockoutKey = 'auth:lockout:admin';
  try {
    const failedCount = await redis.get(lockoutKey);
    const failedAttempts = failedCount ? parseInt(failedCount, 10) : 0;
    
    if (failedAttempts >= 5) {
      const ttl = await redis.ttl(lockoutKey);
      c.header('Retry-After', String(Math.max(ttl, 1)));
      logEvent({ 
        event: 'auth.account.locked', 
        ip, 
        failed_attempts: failedAttempts,
        request_id: requestId 
      });
      return err(c, 'ACCOUNT_LOCKED', 
        `Account temporarily locked due to too many failed attempts. Try again in ${Math.ceil(ttl / 60)} minutes.`, 
        403);
    }
  } catch (error) {
    // If Redis fails, continue with auth (fail open for availability)
    logEvent({ event: 'auth.lockout.check.error', error: String(error) });
  }

  if (!(await checkPassword(body.data.password, config.adminPasswordHash))) {
    // ✅ Increment failed attempts
    try {
      const newCount = await redis.incr(lockoutKey);
      if (newCount === 1) {
        await redis.expire(lockoutKey, 3600); // 1 hour lockout window
      }
      logEvent({ 
        event: 'auth.token.failure', 
        ip, 
        success: false, 
        failed_attempts: newCount,
        request_id: requestId 
      });
    } catch (error) {
      logEvent({ event: 'auth.lockout.increment.error', error: String(error) });
    }
    
    return err(c, 'UNAUTHORIZED', 'Invalid password', 401);
  }

  // ✅ Success - clear failed attempts
  try {
    await redis.del(lockoutKey);
  } catch {
    // Ignore error
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: 'admin',
    iat: now,
    exp: now + config.jwtTtlSeconds,
  };

  const token = await sign(payload, config.jwtSecret);
  
  const isProduction = process.env.NODE_ENV === 'production';
  c.cookie('kith_jwt', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: config.jwtTtlSeconds,
    path: '/',
  });
  
  logEvent({ event: 'auth.token.success', ip, success: true, request_id: requestId });
  return ok(c, { success: true, expires_in: config.jwtTtlSeconds });
});
```

---

### H5: Add Input Sanitization

**Step 1: Install sanitization library**

```bash
npm install isomorphic-dompurify
```

**Step 2: Update validators/people.ts**

```typescript
import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';

// ✅ Helper to sanitize HTML
function sanitizeHtml(val: string): string {
  return DOMPurify.sanitize(val, { ALLOWED_TAGS: [] }); // Strip all HTML
}

export const createPersonSchema = z.object({
  name: z.string()
    .min(1)
    .max(255, 'Name cannot exceed 255 characters')
    .transform(sanitizeHtml),
  email: z.string()
    .email()
    .max(254)
    .optional()
    .nullable(),
  phone: z.string()
    .max(50, 'Phone cannot exceed 50 characters')
    .transform(val => val ? sanitizeHtml(val) : val)
    .optional()
    .nullable(),
  birthday: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (val) => {
        const date = new Date(val + 'T00:00:00Z');
        return !isNaN(date.getTime()) && date <= new Date();
      },
      { message: 'Birthday must be a valid date and not in the future' }
    )
    .optional()
    .nullable(),
  tags: z.array(
    z.string()
      .max(100, 'Tag cannot exceed 100 characters')
      .transform(sanitizeHtml)
  ).optional().default([]),
  notes: z.string()
    .max(10000, 'Notes cannot exceed 10,000 characters')
    .transform(sanitizeHtml)
    .optional()
    .nullable(),
  avatarUrl: z
    .string()
    .url()
    .max(2048, 'URL too long')
    .refine(
      (val) => {
        try {
          const { protocol } = new URL(val);
          return protocol === 'http:' || protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'Avatar URL must use http or https protocol' }
    )
    .optional()
    .nullable(),
});

export const updatePersonSchema = createPersonSchema.partial();

export const listPeopleQuerySchema = z.object({
  q: z.string()
    .max(200, 'Search query too long')
    .transform(sanitizeHtml)
    .optional(),
  tags: z.string()
    .max(500, 'Tags parameter too long')
    .optional(),
  birthday_month: z.coerce.number().int().min(1).max(12).optional(),
  sort: z.enum(['name', 'created_at', 'updated_at', 'birthday']).optional().default('name'),
  order: z.enum(['asc', 'desc']).optional().default('asc'),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type CreatePersonInput = z.infer<typeof createPersonSchema>;
export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;
export type ListPeopleQuery = z.infer<typeof listPeopleQuerySchema>;
```

Apply similar sanitization to:
- [src/validators/interactions.ts](src/validators/interactions.ts)
- [src/validators/reminders.ts](src/validators/reminders.ts)
- [src/validators/relationships.ts](src/validators/relationships.ts)

---

## Testing Your Security Fixes

### Test SQL Injection Fix

```bash
# Should return empty results, not error
curl "http://localhost:3000/api/v1/people?q='; DROP TABLE people; --"

# Should handle % and _ correctly
curl "http://localhost:3000/api/v1/people?q=%25test%5F"
```

### Test Password Requirements

```bash
# Should fail - too short
ADMIN_PASSWORD="weak" npm start

# Should fail - no special char
ADMIN_PASSWORD="Password123" npm start

# Should succeed
ADMIN_PASSWORD="MyStr0ng!P@ssw0rd" npm start
```

### Test Rate Limiting with Redis

```bash
# Make 11 requests rapidly - 11th should be rate limited
for i in {1..11}; do
  curl -X POST http://localhost:3000/api/v1/auth/token \
    -H "Content-Type: application/json" \
    -d '{"password":"wrong"}'
  echo ""
done
```

### Test Account Lockout

```bash
# Make 5 failed login attempts
for i in {1..5}; do
  curl -X POST http://localhost:3000/api/v1/auth/token \
    -H "Content-Type: application/json" \
    -d '{"password":"wrong"}'
done

# 6th attempt should return 403 ACCOUNT_LOCKED
curl -X POST http://localhost:3000/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"password":"correct"}'
```

### Test CSRF Protection

```bash
# Should fail without CSRF token
curl -X POST http://localhost:3000/api/v1/people \
  -H "Content-Type: application/json" \
  -H "Cookie: kith_jwt=..." \
  -d '{"name":"Test"}'

# Should succeed with CSRF token
curl -X POST http://localhost:3000/api/v1/people \
  -H "Content-Type: application/json" \
  -H "Cookie: kith_jwt=...; csrf_token=..." \
  -H "X-CSRF-Token: ..." \
  -d '{"name":"Test"}'
```

---

## Deployment Checklist

Before deploying these security fixes:

- [ ] Run all tests: `npm test`
- [ ] Test locally with Docker: `npm run docker:reset`
- [ ] Update `.env` with strong password meeting new requirements
- [ ] Update `.env` with Redis URL
- [ ] Run SQL injection tests
- [ ] Run authentication tests
- [ ] Verify CSP doesn't break frontend
- [ ] Test CSRF protection with frontend
- [ ] Monitor logs for security events
- [ ] Set up alerts for failed login attempts
- [ ] Document password requirements for users
- [ ] Update README with Redis requirement
- [ ] Create database backup before deploying

---

## Need Help?

- **Questions about implementation?** Review [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for context
- **Frontend not working?** Check browser console for CSP violations
- **Redis errors?** Verify Redis is running: `redis-cli ping`
- **Still seeing vulnerabilities?** Run: `npm audit` and `npm run test`

