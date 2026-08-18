# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
├── validators/        # Zod input schemas (also reused as MCP tool inputSchemas)
└── mcp/               # MCP server: auth adapter, kith.* tools, registry, entrypoint
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
- **Household members (JIT provisioning, B4):** members are authored in Heorth ALONE — no roster, no sync, no provisioning route. The first request carrying a verified token for an unseen `sub` creates the local record (`src/services/members.ts`), a row in core's `users` table **whose id IS the `sub`**, plus a `household_members` row recording Heorth provenance. Reusing `users` (rather than a separate member table) is what lets ADR 0004 / B5's `owner` columns foreign-key ONE table and cover the local admin too; the synthesised `email`/`handle` are derived from the `sub` (`.invalid` domain, `heorth-` prefix) and the `password_hash` is a non-argon2 sentinel, so **a member can never log in locally**. `requireLocalAccount` additionally keeps members off the long-lived `kl_` key routes. Role comes from the token every request and is never elevated; `users.role` is a mirror kept in step with the last token seen. An unknown role or a non-uuid `sub` is refused (401), as is a `sub` colliding with a locally authored account.
- **Per-member visibility (B5, schema only):** every node (`people`) and every edge (`interactions`, `relationships`, `reminders`) carries `owner_id` (FK `users.id`, `ON DELETE RESTRICT` — offboarding must reassign, never cascade) and `visibility` (`private` | `shared` | `household`, CHECK-constrained, defaulting to `household`). `household` is an explicit state, **not** a share list containing every member, so new members see household items automatically and `shared` subsets never silently grow. The `shared` set lives in four per-entity tables (`person_shares`, `interaction_shares`, `relationship_shares`, `reminder_shares`), composite PK `(entity_id, member_id)`, both sides foreign-keyed. **Enforcement (B6, ADR 0004 §2 + §4):** `src/services/scope.ts` is the ONE place the read predicate exists — `visibleTo(entity, scope, alias?)` emits `visibility = 'household' OR owner_id = :me OR (visibility = 'shared' AND EXISTS <share>)` for any table and any alias, and every list, get, count and existence pre-check in `src/services/` applies it. Never consult a share table without the `visibility = 'shared'` guard: grants outlive a `shared` -> `private` flip, so dropping it is a permanent leak. Counts reuse their rows' `where` (a total of 5 when you see 3 is a leak). Out-of-scope items are 404, never 403 (§3.1). Routes resolve `c.get('principal')` to a `Scope` and pass it as the first service argument; they still never touch Drizzle. Writes stamp `owner_id` from the principal (NOT NULL as of migration `0005`); `visibility` and the `sharedWith` set are owner-only (§4, sharing is not transitive), content edits deliberately follow read scope. `role === 'admin'` is never consulted — there is no god-mode to bypass with. `HOUSEHOLD_SCOPE` expresses the always-on dashboard's read-only `household`-only scope (§2.2); B8 gives it a credential. **Traversal (B7, ADR 0004 §3):** `getPersonGraph(scope, personId, depth)` applies the same `visibleTo` at every hop. An edge is returned only when its own row is visible AND both endpoints resolve to a visible person (`visibleTo` is per-row; the endpoint `EXISTS` conjuncts are separate, because §1 makes edge visibility independent of its endpoints). That combined fragment sits in the depth-1 `where`, in the recursive CTE's base term AND in its recursive term — which is what stops pass-through: every row in the CTE has two visible endpoints, so the recursion can only pivot on already-visible nodes and `You -> [hidden] -> Cousin` has no second hop, while an independent visible path to Cousin still works. Filtering the CTE's OUTPUT would traverse the hidden node first and surface Cousin; `DISTINCT ON (id)` runs after traversal, so anything applied there is too late. Node hydration is a separate query and re-applies the predicate — filtering only edges hydrates hidden people's names, filtering only nodes leaves edges naming hidden ids. An invisible root 404s exactly as a non-existent one does.
- **Per-user auth:** `POST /auth/token` authenticates the supplied `email` (optional, defaulting to the seeded admin so the web UI's password-only form is unchanged); `/auth/keys` create/list/revoke act on `c.get('principal').userId`, not on a hardcoded admin.
- **MCP surface:** `src/mcp/` assembles the `kith.*` tool registry via core's `createMcpServer`; tools call the service layer directly and share REST's auth and audit trail. The MCP server reads a `kl_` API key from the `KITHLEDGER_MCP_API_KEY` environment variable (create one via `POST /api/v1/auth/keys`, JWT-authenticated) — a valid key resolves to the admin user, and a missing/invalid/non-`kl_` value is rejected on the first tool call. Run with `npm run mcp`.

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
