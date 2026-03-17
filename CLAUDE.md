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

## Environment

Copy `.env.example` → `.env`:

```
DATABASE_URL=postgres://kith:changeme@localhost:5432/kithledger
JWT_SECRET=<long random string>
ADMIN_PASSWORD=<admin password>
API_PORT=3000
JWT_TTL_SECONDS=604800
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
│   ├── auth.ts        # requireAuth / requireJwt guards
│   ├── api-key.ts     # API key extraction + DB validation
│   ├── jwt.ts         # JWT verification (HS256)
│   └── error-handler.ts
├── routes/            # HTTP method + path only — no business logic
├── services/          # All business logic + Drizzle queries
├── validators/        # Zod input schemas (request body + query params)
└── lib/
    ├── response.ts    # ok(c, data, meta?) and err(c, code, msg, status)
    ├── pagination.ts  # parsePagination(query) → { limit, offset }
    └── crypto.ts      # generateApiKey() → { raw, hash, prefix }
```

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
