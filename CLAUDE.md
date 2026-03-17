# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**KithLedger** is an API-first personal relationship manager (people, interactions, reminders, relationships). Built with Node.js 22 + TypeScript, Hono, Drizzle ORM, PostgreSQL 16, Zod, Vitest.

## Commands

| Script | Purpose |
|---|---|
| `npm run dev` | Start with hot-reload (`tsx watch`) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run compiled output |
| `npm run typecheck` | Type-check without emitting |
| `npm run db:generate` | Generate Drizzle migration SQL |
| `npm run db:migrate` | Apply migrations to the database |
| `npm run db:push` | Push schema directly (no migration file) |
| `npm run db:studio` | Open Drizzle Studio |
| `npm test` | Run integration tests (**requires DB — see Testing**) |
| `npm run test:watch` | Watch mode tests |
| `npm run docker:up` | Start API + Postgres containers |
| `npm run docker:down` | Stop containers |
| `npm run docker:reset` | Wipe volumes and restart |
| `npm run dev:web` | Start Vite dev server for the React frontend |
| `npm run dev:all` | Start API + Vite simultaneously (concurrently) |
| `npm run build:web` | Build React frontend → `web/dist/` (served by API in prod) |

## Environment

Copy `.env.example` → `.env`:

```
DATABASE_URL=postgres://kith:<password>@localhost:5432/kithledger
JWT_SECRET=<32+ char random string>   # min 32 chars, e.g. openssl rand -hex 32
ADMIN_PASSWORD=<password>
API_PORT=3000
JWT_TTL_SECONDS=604800
CORS_ORIGIN=*                          # set to your frontend origin in production
DB_POOL_MAX=10
```

## Module Structure

```
src/
├── index.ts           # Entrypoint: run migrations, start server
├── app.ts             # Hono app factory + middleware wiring
├── config/env.ts      # Zod-validated env vars (single source of truth)
├── db/
│   ├── index.ts       # Drizzle client singleton
│   ├── schema/
│   │   ├── index.ts          # Re-exports (uses .js extensions — ESM runtime)
│   │   └── drizzle-schema.ts # Re-exports without .js — for drizzle-kit CJS compat
│   └── migrations/    # Generated SQL migration files
├── middleware/
│   ├── auth.ts             # requireAuth / requireJwt guards
│   ├── api-key.ts          # API key extraction + DB validation
│   ├── jwt.ts              # JWT verification (HS256)
│   ├── rate-limit.ts       # In-memory rate limiter (10 req/15 min) for /auth/token
│   ├── request-id.ts       # Generates X-Request-Id; sets c.get('requestId')
│   ├── security-headers.ts # X-Content-Type-Options, HSTS, X-Frame-Options, etc.
│   └── error-handler.ts
├── routes/            # HTTP method + path only — no business logic
├── services/          # All business logic + Drizzle queries
├── validators/        # Zod input schemas (request body + query params)
└── lib/
    ├── response.ts    # ok(c, data, meta?) and err(c, code, msg, status)
    ├── pagination.ts  # parsePagination(query) → { limit, offset }
    ├── logger.ts      # logEvent()/logError() — structured JSON audit logging
    └── crypto.ts      # generateApiKey() → { raw, hash, prefix }
```

## Web UI

React SPA in `web/` (Vite, React 18, TanStack Router + Query, Tailwind, shadcn/ui).
Built output is served as static files from `web/dist/` by the Hono API in production.

- Source: `web/src/` — pages, components, hooks, api client, lib/types
- Dev: `npm run dev:all` starts both API (port 3000) and Vite (port 5173) concurrently
- Types in `web/src/lib/types.ts` are manually synced from backend schema (no codegen yet)

## Architecture Notes

- **Layer rule:** `routes/` → `services/` → `db/`. Routes never touch Drizzle directly.
- **Auth dispatch:** `Bearer kl_xxx` → API key path; `Bearer eyJ…` → JWT path. Key-management routes (`/auth/keys`) reject API key auth — require JWT only.
- **API keys:** SHA-256 of a `kl_` + 32-byte random hex. Raw key returned once at creation; only hash stored.
- **Recurring reminders:** `POST /reminders/:id/complete` wraps update + new-row insert in a Drizzle transaction when `recurrence` (ISO 8601, e.g. `P1M`) is set.
- **Relationships:** One row with `is_mutual = true` represents a bidirectional link. Graph queries union `from_person_id = X` with `to_person_id = X WHERE is_mutual = true`.
- **Migrations at startup:** `migrate()` runs programmatically in `src/index.ts` before `serve()`.

## Adding a New Resource

Follow this pattern (example: a new `notes` resource):

1. `src/db/schema/notes.ts` — Drizzle table, export types
2. Add re-export to `src/db/schema/index.ts` and `src/db/schema/drizzle-schema.ts`
3. `npm run db:generate` → review SQL, then `npm run db:migrate`
4. `src/validators/notes.ts` — Zod schemas for create/update/list query
5. `src/services/notes.ts` — CRUD functions using `db`
6. `src/routes/notes.ts` — Hono router, `use('*', requireAuth)`, call service
7. Mount in `src/routes/index.ts`
8. `tests/notes.test.ts` — integration tests

## Testing

Tests are **integration tests** that hit a real PostgreSQL database. Before running:

```bash
# Option A: use Docker DB
npm run docker:up   # start DB (and API)
# Option B: use local DB — ensure DATABASE_URL points to a running instance

npm test
```

`tests/setup.ts` runs migrations and truncates all tables before each test. Tests run in a single fork (`singleFork: true`) to avoid parallel DB conflicts.

## Gotchas

- **`drizzle-kit` must run via `tsx`** — schema files use `.js` extension imports (ESM runtime requirement) which drizzle-kit's CJS bundler can't resolve. The `db:*` scripts handle this.
- **`timestamp` not `timestamptz`** — Drizzle uses `timestamp('col', { withTimezone: true })`. There is no `timestamptz` export.
- **`hono/jwt` `verify()` takes 3 args** — `verify(token, secret, 'HS256')`. Omitting the algorithm throws `JwtAlgorithmRequired`.
- **Postgres UNIQUE violation = error code `23505`** — catch this in services to return a `CONFLICT` response (see `src/services/relationships.ts`).
- **`JWT_SECRET` minimum is 32 chars** — `env.ts` enforces `.min(32)`. Shorter values exit the process at startup.
- **`c.get('requestId')`** — every request gets a UUID set by `request-id.ts` middleware. Use this when logging from route handlers or services.
- **Audit events** — use `logEvent({ event: 'foo.bar', ... })` from `src/lib/logger.ts` for security-relevant actions (auth, key lifecycle). Output is structured JSON to stdout.
