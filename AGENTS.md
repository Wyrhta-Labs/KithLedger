# AGENTS.md

This file provides guidance to coding agents (Claude Code, Codex, and others) working in this repository.

## Project Overview

**KithLedger** is an API-first personal relationship manager (people, interactions, reminders, relationships). Built with Node.js 22 + TypeScript, Hono, Drizzle ORM, PostgreSQL 18, Zod, Vitest.

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
| `npm run test:e2e` | Run Playwright browser tests (**requires a running API — see Testing**) |
| `npm run test:e2e:ui` | Playwright interactive UI mode |
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
API_PORT=4002   # dev port allocation: Heorth 4000, Feoh 4001, KithLedger 4002
JWT_TTL_SECONDS=604800
CORS_ORIGIN=*                          # set to your frontend origin in production
DB_POOL_MAX=10
```

## Module Structure

```
src/
├── index.ts           # Entrypoint: migrations, seed admin, start server
├── app.ts             # Hono app factory + middleware wiring (core middleware)
├── identity.ts        # @wyrhta/core identity service + auth guards, wired to db/config; seedAdmin/getAdminUser
├── config/env.ts      # Zod-validated env vars (single source of truth)
├── db/
│   ├── index.ts       # Drizzle client singleton
│   ├── schema/        # domain tables + re-export of core users/api_keys
│   └── migrations/    # Generated SQL migration files
├── satellite/         # JWKS client + verification of Heorth-issued member tokens
├── routes/            # HTTP method + path only — no business logic
├── services/          # All business logic + Drizzle queries
└── validators/        # Zod input schemas
```

## Web UI

React SPA in `web/` (Vite, React 18, TanStack Router + Query, Tailwind, shadcn/ui).
Built output is served as static files from `web/dist/` by the Hono API in production.

- Source: `web/src/` — pages, components, hooks, api client, lib/types
- Dev: `npm run dev:all` starts both API (port 4002) and Vite (port 5174) concurrently
- Types in `web/src/lib/types.ts` are manually synced from backend schema (no codegen yet)

## Architecture Notes

- **Layer rule:** `routes/` → `services/` → `db/`. Routes never touch Drizzle directly.
- **Auth dispatch:** `Bearer kl_xxx` → API key path; `Bearer eyJ…` → JWT path. Key-management routes (`/auth/keys`) reject API key auth — require JWT only.
- **API keys:** SHA-256 of a `kl_` + 32-byte random hex. Raw key returned once at creation; only hash stored.
- **Recurring reminders:** `POST /reminders/:id/complete` wraps update + new-row insert in a Drizzle transaction when `recurrence` (ISO 8601, e.g. `P1M`) is set.
- **Relationships:** One row with `is_mutual = true` represents a bidirectional link. Graph queries union `from_person_id = X` with `to_person_id = X WHERE is_mutual = true`.
- **Migrations at startup:** `migrate()` runs programmatically in `src/index.ts` before `serve()`.
- **Shared foundation:** the response envelope, pagination, request-id / security-headers / rate-limit / error-handler middleware, structured logger, crypto/api-key, and identity (users + api_keys, JWT, guards) come from `@wyrhta/core` (git-tag dependency). One `admin` user is seeded from `ADMIN_PASSWORD` at first boot and is how the service is bootstrapped and operated; `POST /auth/token` authenticates a local account (the admin by default) and returns a core-issued JWT. Household members are not local accounts — see JIT provisioning below.
- **Satellite identity (verify-only):** with `HEORTH_JWKS_URL` + `SATELLITE_AUDIENCE` set (optional as a group), a `Bearer` JWT signed with an **asymmetric** algorithm is verified against Heorth's published JWKS (`src/satellite/`) and resolves to a `Principal`; `kl_` keys and the local HS256 admin JWT keep their existing path. KithLedger **verifies and never mints** — it holds no signing key for this, by design (ADR 0009). Keys are cached; an unknown `kid` refreshes at most once a minute, and a failed refresh never clears the cache, so a Heorth outage does not break verification. `src/satellite/auth.ts`'s `SatellitePrincipalResolver` seam is filled by B4's just-in-time provisioning (below).
- **Access control (B4–B9, ADR 0004 + 0009) — full detail in [docs/access-control.md](docs/access-control.md); read it before touching scope, graph traversal, member provisioning or offboarding.** The rules a change must not break:
  - **Members are authored in Heorth alone.** No roster, no sync, no provisioning route. A verified token for an unseen `sub` provisions a `users` row **whose id IS the `sub`** plus a `household_members` row in ONE statement (a CTE). Role comes from the token every request; a member can never log in locally.
  - **`src/services/scope.ts` is the ONE place the read predicate exists.** Every list, get, count and existence pre-check applies `visibleTo(entity, scope, alias?)`. Never consult a share table without the `visibility = 'shared'` guard — grants outlive a `shared` → `private` flip. Counts reuse their rows' `where`. Out-of-scope items are **404, never 403**. `role === 'admin'` is never consulted: there is no god-mode.
  - **Graph traversal applies the same predicate at every hop** — in the depth-1 `where`, in the recursive CTE's base term AND in its recursive term. Filtering the CTE's *output* leaks pass-through paths. Node hydration re-applies it separately.
  - **Writes** stamp `owner_id` (NOT NULL) and `updated_by` from the acting principal. `visibility` and the `sharedWith` set are owner-only; content edits follow read scope. **Delete is narrower:** `private`/`shared` items are owner-only to delete, `household` items are not.
  - **Three credential kinds** (`member` | `household` | `ops`) live in `api_key_credentials` and are decided at authentication, never from the request. `scopeFor` is the single mapping. A key with no credentials row is refused (401) — never read as a member key.
  - **Offboarding** (`/api/v1/members/:id/offboarding`) is what makes `owner_id`'s RESTRICT resolvable. It SELECTs no content, exposes only `hasOwnedItems`, and reassigns only to a current Heorth-authored member. Remove the member in Heorth first or they are re-provisioned.
- **Per-user auth:** `POST /auth/token` authenticates the supplied `email` (optional, defaulting to the seeded admin so the web UI's password-only form is unchanged); `/auth/keys` create/list/revoke act on `c.get('principal').userId`, not on a hardcoded admin.
- **No MCP surface (A8, ADR 0008):** KithLedger is REST-only. The `kith.*` tools now live in `Wyrhta-Labs/heorth-mcp`, a standalone MCP server that calls this service's REST API like any other client — so the routes, the auth dispatch and B6-B9's access control are the only enforcement path there is. The deleted `src/mcp/` server spoke **stdio only and was never deployable** next to the containerised API, which is why `docs/strategy.md`'s old "move KithLedger's MCP to HTTP" prerequisite was dropped rather than done. Nothing in `src/` may import `@wyrhta/core/mcp`; a tool that needs new data needs a REST route.

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

`tests/setup.ts` runs migrations and truncates all tables before each test. It
**refuses to run unless the database name ends in `_test`** — it truncates every
table, so pointing it at the dev stack would wipe real data.

### End-to-end tests (`e2e/`)

`npm run test:e2e` drives the real React UI in Chromium against a **running API**
(it does not start one):

```bash
npm run docker:up                                  # API on :4002
ADMIN_PASSWORD=<the API's admin password> npm run test:e2e
```

Playwright starts Vite itself (`webServer` in `playwright.config.ts`); `web/`'s
proxy sends `/api` to port 4002. Override with `E2E_API_URL` / `E2E_WEB_PORT`.

- **These specs write to the API's real database.** Everything they create is
  named with the `E2E-` prefix and deleted in fixture teardown, but run them
  against the dev stack, not anything you care about.
- **`POST /auth/token` is rate-limited to 10 requests per 15 minutes per IP.**
  The suite logs in once per worker and seeds the JWT into `localStorage` for the
  rest; only `e2e/auth.spec.ts` drives the form. Several runs back to back can
  still exhaust the window — the limiter is in-memory, so restarting the API
  clears it.
- Specs run serially (`workers: 1`): they share one database and assert on list
  contents.
- Vitest is configured to exclude `e2e/`, so `npm test` will not try to run these.
  They are type-checked via `tsconfig.e2e.json`, which `npm run typecheck` includes.

## Gotchas

- **`drizzle-kit` must run via `tsx`** — schema files use `.js` extension imports (ESM runtime requirement) which drizzle-kit's CJS bundler can't resolve. The `db:*` scripts handle this.
- **Postgres 18 volume path** — `postgres:18` sets `PGDATA` to `/var/lib/postgresql/<major>/docker` and declares its volume at `/var/lib/postgresql`, so `docker-compose.yml` mounts `postgres_data` there and **not** at the pre-18 `/var/lib/postgresql/data`. Mounting the old path makes the container start against an anonymous volume and silently stop persisting data. A volume created under 16 won't start under 18: `npm run docker:reset` (or `pg_upgrade`).
- **`timestamp` not `timestamptz`** — Drizzle uses `timestamp('col', { withTimezone: true })`. There is no `timestamptz` export.
- **`hono/jwt` `verify()` takes 3 args** — `verify(token, secret, 'HS256')`. Omitting the algorithm throws `JwtAlgorithmRequired`.
- **Postgres UNIQUE violation = error code `23505`** — catch this in services to return a `CONFLICT` response (see `src/services/relationships.ts`).
- **`JWT_SECRET` minimum is 32 chars** — `env.ts` enforces `.min(32)`. Shorter values exit the process at startup.
- **`c.get('requestId')`** — every request gets a UUID set by `request-id.ts` middleware. Use this when logging from route handlers or services.
- **Audit events** — use `logEvent({ event: 'foo.bar', ... })` from `src/lib/logger.ts` for security-relevant actions (auth, key lifecycle). Output is structured JSON to stdout.
