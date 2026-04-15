# AGENTS.md

This file provides guidance to Codex when working with code in this repository.

## Project Overview

**KithLedger** is an API-first personal relationship manager (people, interactions, reminders, relationships). Built with Node.js 22 + TypeScript, Hono, Drizzle ORM, PostgreSQL 16, Zod, and Vitest.

## Commands

| Script | Purpose |
|---|---|
| `npm run dev` | Start with hot-reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled output |
| `npm run typecheck` | Type-check without emitting |
| `npm run db:generate` | Generate Drizzle migration SQL |
| `npm run db:migrate` | Apply migrations to the database |
| `npm run db:push` | Push schema directly (no migration file) |
| `npm run db:studio` | Open Drizzle Studio |
| `npm test` | Run integration tests (requires DB; see Testing) |
| `npm run test:watch` | Watch mode tests |
| `npm run docker:up` | Start API + Postgres containers |
| `npm run docker:down` | Stop containers |
| `npm run docker:reset` | Wipe volumes and restart |
| `npm run dev:web` | Start Vite dev server for the React frontend |
| `npm run dev:all` | Start API + Vite simultaneously |
| `npm run build:web` | Build React frontend to `web/dist/` |

## Environment

Copy `.env.example` to `.env`:

```env
DATABASE_URL=postgres://kith:<password>@localhost:5432/kithledger
JWT_SECRET=<32+ char random string>
ADMIN_PASSWORD=<password>
API_PORT=3000
JWT_TTL_SECONDS=604800
CORS_ORIGIN=*
DB_POOL_MAX=10
```

Notes:
- `JWT_SECRET` must be at least 32 characters.
- Set `CORS_ORIGIN` to your frontend origin in production.

## Module Structure

```text
src/
|- index.ts           # Entrypoint: run migrations, start server
|- app.ts             # Hono app factory + middleware wiring
|- config/env.ts      # Zod-validated env vars (single source of truth)
|- db/
|  |- index.ts        # Drizzle client singleton
|  |- schema/
|  |  |- index.ts          # Re-exports (uses .js extensions for ESM runtime)
|  |  `- drizzle-schema.ts # Re-exports without .js for drizzle-kit CJS compat
|  `- migrations/     # Generated SQL migration files
|- middleware/
|  |- auth.ts             # requireAuth / requireJwt guards
|  |- api-key.ts          # API key extraction + DB validation
|  |- jwt.ts              # JWT verification (HS256)
|  |- rate-limit.ts       # In-memory rate limiter for /auth/token
|  |- request-id.ts       # Generates X-Request-Id; sets c.get('requestId')
|  |- security-headers.ts # Security header middleware
|  `- error-handler.ts
|- routes/            # HTTP method + path only; no business logic
|- services/          # Business logic + Drizzle queries
|- validators/        # Zod input schemas
`- lib/
   |- response.ts     # ok(c, data, meta?) and err(c, code, msg, status)
   |- pagination.ts   # parsePagination(query) -> { limit, offset }
   |- logger.ts       # logEvent()/logError() structured audit logging
   `- crypto.ts       # generateApiKey() -> { raw, hash, prefix }
```

## Web UI

React SPA in `web/` using Vite, React 18, TanStack Router + Query, Tailwind, and shadcn/ui.

- Source lives in `web/src/`.
- `npm run dev:all` starts the API on port 3000 and Vite on port 5173.
- Built frontend assets in `web/dist/` are served by the Hono API in production.
- `web/src/lib/types.ts` is manually synced from backend schema; there is no codegen yet.

## Architecture Notes

- Layer rule: `routes/` -> `services/` -> `db/`. Routes should not access Drizzle directly.
- Auth dispatch: `Bearer kl_xxx` uses API key auth; `Bearer eyJ...` uses JWT auth.
- Key-management routes under `/auth/keys` reject API key auth and require JWT.
- API keys are `kl_` plus 32 random bytes in hex; only the SHA-256 hash is stored.
- Recurring reminders: `POST /reminders/:id/complete` updates the current row and inserts the next one in a Drizzle transaction when `recurrence` is set.
- Relationships: one row with `is_mutual = true` represents a bidirectional link.
- Migrations run programmatically in `src/index.ts` before `serve()`.

## Adding a New Resource

Use this pattern for a new resource such as `notes`:

1. Add `src/db/schema/notes.ts`.
2. Re-export it from `src/db/schema/index.ts` and `src/db/schema/drizzle-schema.ts`.
3. Run `npm run db:generate`, review the SQL, then run `npm run db:migrate`.
4. Add `src/validators/notes.ts`.
5. Add `src/services/notes.ts`.
6. Add `src/routes/notes.ts` and protect it with `requireAuth` if appropriate.
7. Mount it in `src/routes/index.ts`.
8. Add integration tests in `tests/notes.test.ts`.

## Testing

Tests are integration tests against a real PostgreSQL database.

```bash
# Option A: use Docker
npm run docker:up

# Option B: use a local DB and point DATABASE_URL at it

npm test
```

`tests/setup.ts` runs migrations and truncates all tables before each test. Tests run in a single fork to avoid parallel DB conflicts.

## Gotchas

- `drizzle-kit` must run via `tsx`; the `db:*` scripts already handle this.
- Use `timestamp('col', { withTimezone: true })`; there is no `timestamptz` export in Drizzle.
- `hono/jwt` `verify()` takes three args: `verify(token, secret, 'HS256')`.
- PostgreSQL unique violation code is `23505`; map it to conflict responses where needed.
- `JWT_SECRET` shorter than 32 characters will fail validation in `src/config/env.ts`.
- Every request gets `c.get('requestId')` from `request-id.ts`; use it in logs.
- Use `logEvent({ event: 'foo.bar', ... })` from `src/lib/logger.ts` for security-relevant audit events.
