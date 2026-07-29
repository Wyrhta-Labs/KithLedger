# Changelog

All notable changes to KithLedger will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `.env` auto-load for local dev (`src/config/env.ts`): loaded from the working
  directory, never overriding exported variables. Test setup refuses to run
  against a `_dev` database. `.dockerignore` added so `.env` can never be baked
  into images.

### Changed

- PostgreSQL baseline moved from **16** to **18** (`docker-compose.yml` now pins
  `postgres:18-alpine`; docs and the `run-local` skill updated to match). Existing
  PG16 data directories/volumes are not readable by PG18 — dump and restore (or
  `pg_upgrade`) when moving an existing deployment. The `postgres_data` volume is
  now mounted at `/var/lib/postgresql` (PG18's declared volume) rather than the
  pre-18 `/var/lib/postgresql/data`, which would leave the container running on an
  anonymous volume that never persists.
- Single-branch workflow for pre-alpha: `main` is the only branch, and the GHCR
  workflow now triggers on `main` pushes plus `v*` tags instead of every branch
  except `main`. Image tags follow: main pushes publish `:main` and an immutable
  `:main-<sha>`; semver and `latest` remain release-tag-only. The `:staging` /
  `:staging-<sha>` tags are no longer produced — deployments tracking `:staging`
  must move to `:main` or a version tag.
- Dev ports moved to **4002** (API) and **5174** (Vite) per the cross-service
  dev port allocation (Heorth 4000/5173, Feoh 4001, KithLedger 4002/5174) so
  all services can run side by side locally. Container-internal port stays 3000.

### Fixed

- Removed an unused `declare module 'hono' { ContextVariableMap { auth } }` block in `src/app.ts` — nothing ever set or read an `auth` context variable (core declares its own `principal` variable).
- Container image build (GHCR workflow) failing since 2026-07-13: `web/vite.config.ts` uses `path`/`__dirname` but `web/` lacked `@types/node`, so the isolated Docker web build's typecheck failed. Added `@types/node` to `web/` devDependencies (same fix Heorth received on 2026-07-14).

## [0.2.0] - 2026-07-23

### Added

- **Web UI** — Full React SPA for managing all resources from the browser ([8ec44c2])
  - Dashboard with stats, upcoming reminders, recent interactions, birthday widget, and quick actions
  - People: searchable list with pagination, create/edit/delete, detail view with tabbed sections
  - Interactions: timeline view with sentiment indicators, type/channel filters, CRUD
  - Reminders: status-filtered list with complete/snooze/dismiss actions, recurring support
  - Relationships: bidirectional link management with type labels
  - Graph Explorer: force-directed relationship graph with depth control and click-to-navigate
  - Settings: API key creation, one-time reveal, and revocation
  - Login page with JWT auth flow
- **CI/CD** — GitHub Actions workflow to build and push container images to GHCR ([cf34cc3])
  - Tagged pushes produce semver image tags; branch pushes use branch name
  - Build skippable via `[skip ci]`, `[skipci]`, `[no ci]`, or `[no build]` in commit message
- **Static serving** — Hono serves `web/dist/` with SPA fallback for production deployments ([8ec44c2])
- **Dev workflow** — `npm run dev:all` runs API and Vite dev server concurrently ([8ec44c2])
- **MCP server** — `src/mcp/` exposes 13 `kith.*` tools (people, interactions, reminders, relationships) over the Model Context Protocol via `npm run mcp`, calling the same service layer as REST so business rules and the audit trail are shared ([d05c4b8], [549ad8b])
  - Authenticates via a `kl_` API key in `KITHLEDGER_MCP_API_KEY`, resolved to the single admin user
- **Structured audit logging** — `src/lib/logger.ts` emits JSON events to stdout for auth and key-lifecycle actions (`auth.token.success/failure`, `auth.key.created/revoked/used`) ([87617f5])
- **Security headers middleware** — `X-Content-Type-Options`, `X-Frame-Options: DENY`, `X-XSS-Protection: 0`, `Referrer-Policy`, `Permissions-Policy`, and `Strict-Transport-Security` (non-localhost only)
- **Request ID middleware** — Every request receives a UUID via `X-Request-Id` response header; propagated via `c.get('requestId')` for use in log events
- **Rate limiting** — `POST /api/v1/auth/token` limited to 10 attempts per 15 minutes per IP; returns `429` with `Retry-After` header
- **Configurable CORS** — `CORS_ORIGIN` env var (default `*`); set to a specific origin in production
- **DB connection pool config** — `DB_POOL_MAX` env var (default `10`) passed to the postgres client
- **Health check DB probe** — `GET /health` now executes `SELECT 1` and returns `{ db: "connected" }` or `503 { db: "disconnected" }` if the database is unreachable

### Changed

- **Migrated onto `@wyrhta/core`** — response envelope, pagination, request-id/security-headers/rate-limit/error-handler middleware, structured logger, crypto/api-key, and identity (users + api_keys, JWT, guards) now come from the shared foundation library (git-tag dependency, currently `v0.1.1`); KithLedger seeds a single admin user from `ADMIN_PASSWORD` at startup ([e81b268], [ec15ace], [b626d5e], [b48dfed], [ca2e8f9], [1f692b7], [e6fcac6])
- **Timing-safe password comparison** — `POST /auth/token` now uses `crypto.timingSafeEqual` (SHA-256 digests) instead of `===` to prevent timing-based password enumeration
- **JWT secret minimum raised** — `JWT_SECRET` must be at least 32 characters (was 16); process exits at startup if the constraint is not met
- **JWT `sub` claim validated** — Tokens without a non-empty string `sub` are now rejected with `401`
- **Body size limit** — All `/api/*` routes reject request bodies larger than 1 MB
- **Trailing slash normalisation** — Requests with a trailing slash are redirected/normalised automatically
- **Avatar URL restricted to http/https** — `javascript:` and other non-web protocols are rejected at the validator level (backend) and silently fall back to initials in the frontend
- **Validation errors sanitised in production** — Zod field-level details are omitted from error responses when `NODE_ENV=production`
- **`console.error` replaced with structured logger** — The error handler now calls `logError()` instead of logging raw error objects to stderr
- **Graph CTE depth capped at 5** — Defence-in-depth beyond the validator's `max(3)` to prevent runaway recursive queries
- **`.env.example` credentials replaced with placeholders** — Real `changeme` values removed; each var now has an instructional comment

### Fixed

- **Non-null assertions removed** — `row!` in `createPerson` and `createRelationship` replaced with explicit null checks and descriptive errors
- **API key cleared on settings page unmount** — `useEffect` cleanup in `settings.tsx` clears the one-time raw key from React state when navigating away
- **Avatar XSS guard in frontend** — `person-detail.tsx` validates `avatarUrl` protocol before rendering an `<img>` tag; unsafe URLs fall back to the initials avatar; `referrerPolicy="no-referrer"` added
- **`person.tsx` non-null cast removed** — `id as string` replaced with a runtime guard that renders an error boundary for missing route params

### Documentation

- **Cascade delete comments** — JSDoc added to all `onDelete: 'cascade'` FK columns in schema files explaining what gets deleted
- **Accepted security trade-offs documented** — Comments in `use-auth.ts` (localStorage JWT), `client.ts` (CSRF via Authorization header), and `types.ts` (manual schema duplication) explain the reasoning
- **MCP surface and `@wyrhta/core` foundation documented** — README and CLAUDE.md updated with the MCP tool table, auth flow, and shared-foundation architecture notes ([549ad8b])

### Tech Stack (Web UI)

- React 19, Vite 6, TypeScript
- TanStack Router + TanStack Query v5
- Tailwind CSS v4, hand-crafted shadcn-style components
- react-force-graph-2d, react-hook-form + Zod, date-fns, Lucide icons

## [0.1.0] — 2025-03-16

### Added

- **REST API** — Full CRUD for people, interactions, reminders, relationships ([d906993])
  - People: name, email, phone, birthday, tags, notes, avatar URL
  - Interactions: type (meeting/call/message/email/other), channel, sentiment, notes
  - Reminders: due date, title, recurrence (ISO 8601), complete/snooze/dismiss actions
  - Relationships: typed links (friend/family/colleague/acquaintance/other), mutual flag
  - Graph endpoint: `GET /people/:id/graph?depth=N` returns nodes and edges
- **Authentication** — JWT (HS256) via admin password + API key support (`kl_` prefix, SHA-256 hashed) ([d906993])
  - `Bearer eyJ…` for JWT, `Bearer kl_…` for API keys
  - Key management endpoints (JWT-only): list, create, revoke
- **Database** — PostgreSQL 16 with Drizzle ORM, migrations run at startup ([d906993])
- **Docker** — Multi-stage Dockerfile, `docker compose` for API + Postgres ([d906993])
- **Developer docs** — CLAUDE.md with architecture notes, module structure, and gotchas ([b48d3c2])

[Unreleased]: https://github.com/Wyrhta-Labs/KithLedger/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Wyrhta-Labs/KithLedger/commits/v0.2.0
[87617f5]: https://github.com/Wyrhta-Labs/KithLedger/commit/87617f5
[0.1.0]: https://github.com/Wyrhta-Labs/KithLedger/commits/v0.1.0
[d906993]: https://github.com/Wyrhta-Labs/KithLedger/commit/d906993
[b48d3c2]: https://github.com/Wyrhta-Labs/KithLedger/commit/b48d3c2
[8ec44c2]: https://github.com/Wyrhta-Labs/KithLedger/commit/8ec44c2
[cf34cc3]: https://github.com/Wyrhta-Labs/KithLedger/commit/cf34cc3
[d05c4b8]: https://github.com/Wyrhta-Labs/KithLedger/commit/d05c4b8
[549ad8b]: https://github.com/Wyrhta-Labs/KithLedger/commit/549ad8b
[e81b268]: https://github.com/Wyrhta-Labs/KithLedger/commit/e81b268
[ec15ace]: https://github.com/Wyrhta-Labs/KithLedger/commit/ec15ace
[b626d5e]: https://github.com/Wyrhta-Labs/KithLedger/commit/b626d5e
[b48dfed]: https://github.com/Wyrhta-Labs/KithLedger/commit/b48dfed
[ca2e8f9]: https://github.com/Wyrhta-Labs/KithLedger/commit/ca2e8f9
[1f692b7]: https://github.com/Wyrhta-Labs/KithLedger/commit/1f692b7
[e6fcac6]: https://github.com/Wyrhta-Labs/KithLedger/commit/e6fcac6
