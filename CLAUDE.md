# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**KithLedger** is an API-first database for tracking and nurturing personal relationships.

## Tech Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 22 + TypeScript |
| HTTP Framework | Hono + `@hono/node-server` |
| ORM | Drizzle ORM |
| Database | PostgreSQL 16 |
| Validation | Zod |
| Testing | Vitest |
| Deployment | Docker Compose (self-hosted) |
| Auth | API keys (`kl_` prefix) + JWT (HS256) |

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
| `npm test` | Run integration tests (requires DB) |
| `npm run test:watch` | Watch mode tests |
| `npm run docker:up` | Start API + Postgres containers |
| `npm run docker:down` | Stop containers |
| `npm run docker:reset` | Wipe volumes and restart |

## Environment

Copy `.env.example` → `.env` and fill in values:

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
├── config/env.ts      # Zod-validated env vars
├── db/
│   ├── index.ts       # Drizzle client singleton
│   ├── schema/        # Drizzle table definitions
│   └── migrations/    # Generated SQL migration files
├── middleware/
│   ├── auth.ts        # requireAuth / requireJwt guards
│   ├── api-key.ts     # API key extraction + DB validation
│   ├── jwt.ts         # JWT verification
│   └── error-handler.ts
├── routes/            # Hono route handlers (HTTP layer only)
├── services/          # Business logic + Drizzle queries
├── validators/        # Zod input schemas
└── lib/
    ├── response.ts    # ok() / err() envelope helpers
    ├── pagination.ts  # Parse limit/offset query params
    └── crypto.ts      # generateApiKey(), hashKey()
```

## Architecture Notes

- **Layer rule:** `routes/` → calls `services/` → uses `db/`. No DB access in routes.
- **Auth flow:** `Authorization: Bearer kl_xxx` → API key path; `Bearer eyJ…` → JWT path.
  - Key mgmt routes (`/auth/keys`) require JWT only.
- **API keys:** SHA-256 of a 32-byte random hex string prefixed with `kl_`. Raw key shown once at creation.
- **Recurring reminders:** On `POST /reminders/:id/complete`, a new pending reminder is inserted in the same transaction when `recurrence` (ISO 8601 duration like `P1M`) is set.
- **Relationships:** `is_mutual = true` means one row represents a bidirectional link.
- **Migrations at startup:** `migrate()` is called programmatically in `src/index.ts` before `serve()`.

## API Base URL

`/api/v1` — all resource endpoints require `Authorization` header.

### Endpoints summary

- `GET /health` — health check (no auth)
- `POST /api/v1/auth/token` — get JWT from admin password
- `GET|POST|DELETE /api/v1/auth/keys` — manage API keys (JWT only)
- `GET|POST /api/v1/people` + `GET|PATCH|DELETE /api/v1/people/:id`
- `GET /api/v1/people/:id/graph?depth=1` — ego network
- `GET|POST /api/v1/interactions` + `GET|PATCH|DELETE /api/v1/interactions/:id`
- `GET|POST /api/v1/reminders` + `GET|PATCH|DELETE /api/v1/reminders/:id`
  - `POST /api/v1/reminders/:id/complete|snooze|dismiss`
- `GET|POST /api/v1/relationships` + `GET|PATCH|DELETE /api/v1/relationships/:id`

## Important: drizzle-kit

`drizzle-kit` must be run via `tsx` because the schema files use ESM `.js` extension imports. The `db:*` npm scripts handle this automatically.
