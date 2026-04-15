# Changelog

All notable changes to KithLedger will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-04-16

### Added

- **Structured audit logging** — `src/lib/logger.ts` emits JSON events to stdout for auth and key-lifecycle actions (`auth.token.success/failure`, `auth.key.created/revoked/used`) ([87617f5])
- **Security headers middleware** — `X-Content-Type-Options`, `X-Frame-Options: DENY`, `X-XSS-Protection: 0`, `Referrer-Policy`, `Permissions-Policy`, and `Strict-Transport-Security` (non-localhost only)
- **Request ID middleware** — Every request receives a UUID via `X-Request-Id` response header; propagated via `c.get('requestId')` for use in log events
- **Rate limiting** — `POST /api/v1/auth/token` limited to 10 attempts per 15 minutes per IP; returns `429` with `Retry-After` header
- **Configurable CORS** — `CORS_ORIGIN` env var (default `*`); set to a specific origin in production
- **DB connection pool config** — `DB_POOL_MAX` env var (default `10`) passed to the postgres client
- **Health check DB probe** — `GET /health` now executes `SELECT 1` and returns `{ db: "connected" }` or `503 { db: "disconnected" }` if the database is unreachable
- **Profile page and navigation updates** — Added a profile screen plus refreshed app-shell navigation for the web UI
- **Global graph mode** — `/graph` can now show all people and relationships at once, with `Me` pinned in the center and isolated people included

### Changed

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
- **Vite dev proxy reads root env** — The web dev server now follows repo-level `API_PORT` and `VITE_API_PROXY_TARGET` values during local development

### Fixed

- **Non-null assertions removed** — `row!` in `createPerson` and `createRelationship` replaced with explicit null checks and descriptive errors
- **API key cleared on settings page unmount** — `useEffect` cleanup in `settings.tsx` clears the one-time raw key from React state when navigating away
- **Avatar XSS guard in frontend** — `person-detail.tsx` validates `avatarUrl` protocol before rendering an `<img>` tag; unsafe URLs fall back to the initials avatar; `referrerPolicy="no-referrer"` added
- **`person.tsx` non-null cast removed** — `id as string` replaced with a runtime guard that renders an error boundary for missing route params
- **Web form/API mismatches resolved** — Dashboard queries now respect API pagination limits, and interaction/reminder datetime fields are submitted in backend-valid ISO format

### Documentation

- **Cascade delete comments** — JSDoc added to all `onDelete: 'cascade'` FK columns in schema files explaining what gets deleted
- **Accepted security trade-offs documented** — Comments in `use-auth.ts` (localStorage JWT), `client.ts` (CSRF via Authorization header), and `types.ts` (manual schema duplication) explain the reasoning

---

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

[Unreleased]: https://github.com/KithLedger/KithLedger/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/KithLedger/KithLedger/compare/v0.1.0...v0.2.0
[87617f5]: https://github.com/KithLedger/KithLedger/commit/87617f5
[0.1.0]: https://github.com/KithLedger/KithLedger/commits/v0.1.0
[d906993]: https://github.com/KithLedger/KithLedger/commit/d906993
[b48d3c2]: https://github.com/KithLedger/KithLedger/commit/b48d3c2
[8ec44c2]: https://github.com/KithLedger/KithLedger/commit/8ec44c2
[cf34cc3]: https://github.com/KithLedger/KithLedger/commit/cf34cc3
