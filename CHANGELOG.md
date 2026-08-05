# Changelog

All notable changes to KithLedger will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-08-05

### Added

- **Birthday reminders** — adding a person with a birthday now offers a recurring
  yearly reminder (checkbox, checked by default) with a selectable lead time (on the
  day, or 1/3/7 days before) at 09:00 local ([6f28ab3]). `reminders` gains `kind`
  (`generic`|`birthday`, NOT NULL DEFAULT `generic`, CHECK-constrained) and
  `lead_days`; both are additive, so existing rows and clients stay valid.
  Completing a birthday reminder recomputes the next due date from the person's
  current birthday instead of adding `P1Y` — with a non-zero lead, `+P1Y` repeats
  the wrong day across leap years — which also means the reminder self-heals when
  the birthday is later edited. `kind` is not PATCHable: `updateReminderSchema` is
  strict and omits it, so a PATCH naming it fails loudly. The dashboard's birthday
  widget now lists only birthdays without an **active** (pending or snoozed)
  reminder, via a new comma-separated `statuses` filter on the reminders list, and
  its empty state distinguishes "none upcoming" from "all upcoming are tracked".
- **Validation errors name the offending fields** ([e7fa767]) — all 16 call sites
  route through a shared `validationError()` that folds the Zod issue paths into the
  message (`Invalid request body — email: Invalid email; birthday: Invalid`). The
  wire shape stays `{ code, message }`, so the web UI's existing toast surfaces it
  unchanged.
- **End-to-end tests** — `npm run test:e2e` drives the real React UI in Chromium
  against a running API (Playwright; eight specs across the login form, the Add
  Person birthday flow, and the dashboard) ([362b8c8]). This is the project's first
  browser-level coverage. The specs write to the API's real database: everything
  they create is prefixed `E2E-` and removed in fixture teardown. They run serially
  and log in once per worker, seeding the JWT into `localStorage`, because
  `POST /auth/token` allows only 10 requests per 15 minutes per IP.
- `.env` auto-load for local dev (`src/config/env.ts`): read from the working
  directory, never overriding exported variables. A `.dockerignore` was added so
  `.env` can never be baked into an image ([655e513]).
- A favicon and a `web/public/` directory, neither of which existed — the SPA
  fallback answers any unmatched path with `index.html` and a 200, so the missing
  file never surfaced as a 404 ([72d4444]).

### Changed

- PostgreSQL baseline moved from **16** to **18** (`docker-compose.yml` now pins
  `postgres:18-alpine`; docs and the `run-local` skill updated to match) ([5a9f5e3]).
  Existing PG16 data directories/volumes are not readable by PG18 — dump and restore
  (or `pg_upgrade`) when moving an existing deployment. The `postgres_data` volume is
  now mounted at `/var/lib/postgresql` (PG18's declared volume) rather than the
  pre-18 `/var/lib/postgresql/data`, which would leave the container running on an
  anonymous volume that never persists.
- Single-branch workflow for pre-alpha: `main` is the only branch, and the GHCR
  workflow now triggers on `main` pushes plus `v*` tags instead of every branch
  except `main` ([4f143a3]). Image tags follow: main pushes publish `:main` and an
  immutable `:main-<sha>`; semver and `latest` remain release-tag-only. The
  `:staging` / `:staging-<sha>` tags are no longer produced — deployments tracking
  `:staging` must move to `:main` or a version tag.
- Dev ports moved to **4002** (API) and **5174** (Vite) per the cross-service
  dev port allocation (Heorth 4000/5173, Feoh 4001, KithLedger 4002/5174) so
  all services can run side by side locally ([ba91b69], [55fed6f]). The
  container-internal port stays 3000.
- **The destructive test suite's database guard is now an allowlist** — the database
  name must end in `_test` ([e3e463b]). The previous denylist merely rejected names
  containing `_dev`, which failed open: a primary name like `kithledger` passed the
  check and had every table truncated. The error names the offending database but
  never the URL, which carries a password.
- `@wyrhta/core` bumped to **v0.1.3**, which surfaces the UPPER_SNAKE_CASE domain
  error codes thrown by MCP tool handlers — the `NOT_FOUND`/`CONFLICT` mapping in
  `src/mcp/tools/*` was previously swallowed by core's scaffold and never reached
  MCP clients. The default MCP auth adapter now reads `config.mcpApiKey` instead of
  `process.env` directly ([25ebb89]).
- `GET /auth/keys` returns the key prefix as `keyPrefix`, matching what
  `POST /auth/keys` already returned; the two endpoints previously disagreed on the
  field name for the same value ([e7fa767]).
- CI actions moved onto the **node24** runtime (checkout v7, setup-node v7,
  buildx v4, login v4, metadata v6, build-push v7), which clears GitHub's
  per-run deprecation annotations ([42cede6]). `node-version` stays **22** to match
  the `node:22-alpine` stages the shipped image is built from.

### Fixed

- Trailing-slash redirects now send a **relative** `Location` ([#1]). Hono's
  `trimTrailingSlash()` built the target from the URL the app itself sees, so the
  301 named a scheme and host: behind a proxy that strips a path prefix the client
  was redirected out of that prefix, and a proxy that does not preserve `Host` (or
  that terminates TLS) leaked the internal upstream hostname or downgraded the
  redirect to `http://`. Replaced with `src/lib/trailing-slash.ts`, which emits the
  path plus query string only.
- **The "Interactions This Month" stat never worked** — the dashboard sent a
  local-offset timestamp (`2026-08-01T00:00:00+02:00`) where the server accepts only
  UTC `Z`, so every dashboard load 400'd and the card rendered an em dash ([631a2e8]).
- **`listPeople` combined its filters with OR**, so adding a filter widened the
  result instead of narrowing it (`?q=jane&birthday_month=3` returned everyone named
  jane *plus* everyone born in March). Now AND, matching the other three list
  services ([631a2e8]).
- **`listPeople`'s count query had no `WHERE` clause**, so `total` always described
  the whole table — a search returning zero rows still reported the full count, and
  every paginated search showed pages that do not exist ([631a2e8]).
- **Five list callers requested `limit: 200` where the validators cap at 100**, so
  each request 400'd: the birthday widget had never rendered anything, and the person
  dropdowns in Quick Actions, the relationships list, the interactions page, and
  Recent Interactions were silently empty. Clamped to a `MAX_LIST_LIMIT` constant
  mirroring the server cap ([f3b18dc]).
- **The reminder form typed `personId` as optional** while the schema requires a UUID
  and the column is NOT NULL, so setting a reminder from Quick Actions without
  choosing a person always failed ([f3b18dc]).
- **Blank optional fields could not be cleared on edit** — `updateInteraction` and
  `updateReminder` read `undefined` as "leave unchanged", so the channel select's
  "None" option and blank notes/sentiment/recurrence silently kept the old value.
  They now send `null`, as the person form already did ([f3b18dc]).
- **Creating a person with only a name was impossible** — untouched optional fields
  were submitted as `""`, which the server's `.email()`, `.url()`, and date-regex
  validators all reject. They now send `null` ([d69feb3]).
- **Every `datetime-local` field returned 400 unconditionally** — the interaction
  form, the reminder form, and the snooze dialog sent the raw local-time value where
  the server requires ISO-8601 UTC. The read direction was wrong too, shifting the
  displayed time by the timezone offset. `toApiDateTime` / `toDateTimeInputValue` are
  now the single bridge at every site ([d69feb3]).
- **The interaction channel was a free-text input feeding a server-side enum** —
  replaced with a select over the accepted values, with the type narrowed so the
  compiler catches this rather than the server at runtime ([d69feb3]).
- **API keys could not be revoked from the UI at all** — the `ApiKey` type declared
  `expiresAt`, `isActive`, and `scopes`, none of which exist as columns or are ever
  returned; `isActive` gated the revoke button, so every active key rendered as
  "Revoked". The phantom fields are gone, `lastUsedAt` (collected but never shown) is
  displayed, and the revoke button always renders ([d69feb3]).
- **A wrong password on the login form appeared to do nothing** — a 401 from
  `POST /auth/token` was treated as an expired session and redirected to `/login`,
  which on the login page reloaded it and wiped the error the form had just set. The
  redirect now skips the login endpoint ([362b8c8]).
- **The dashboard's Relationships stat card was hardcoded to an em dash** and never
  queried anything; it is now wired to a `limit: 1` query that reads only
  `meta.total` ([362b8c8]).
- `handleSnooze` awaited a mutation with no error path, so both it and
  `toApiDateTime` could throw uncaught ([f3b18dc]).
- Removed an unused `declare module 'hono' { ContextVariableMap { auth } }` block in `src/app.ts` — nothing ever set or read an `auth` context variable (core declares its own `principal` variable) ([c50c2b8]).
- Container image build (GHCR workflow) failing since 2026-07-13: `web/vite.config.ts` uses `path`/`__dirname` but `web/` lacked `@types/node`, so the isolated Docker web build's typecheck failed. Added `@types/node` to `web/` devDependencies (same fix Heorth received on 2026-07-14) ([889c782]).

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

[0.3.0]: https://github.com/Wyrhta-Labs/KithLedger/commits/v0.3.0
[6f28ab3]: https://github.com/Wyrhta-Labs/KithLedger/commit/6f28ab3
[e7fa767]: https://github.com/Wyrhta-Labs/KithLedger/commit/e7fa767
[362b8c8]: https://github.com/Wyrhta-Labs/KithLedger/commit/362b8c8
[655e513]: https://github.com/Wyrhta-Labs/KithLedger/commit/655e513
[72d4444]: https://github.com/Wyrhta-Labs/KithLedger/commit/72d4444
[5a9f5e3]: https://github.com/Wyrhta-Labs/KithLedger/commit/5a9f5e3
[4f143a3]: https://github.com/Wyrhta-Labs/KithLedger/commit/4f143a3
[ba91b69]: https://github.com/Wyrhta-Labs/KithLedger/commit/ba91b69
[55fed6f]: https://github.com/Wyrhta-Labs/KithLedger/commit/55fed6f
[e3e463b]: https://github.com/Wyrhta-Labs/KithLedger/commit/e3e463b
[25ebb89]: https://github.com/Wyrhta-Labs/KithLedger/commit/25ebb89
[631a2e8]: https://github.com/Wyrhta-Labs/KithLedger/commit/631a2e8
[f3b18dc]: https://github.com/Wyrhta-Labs/KithLedger/commit/f3b18dc
[d69feb3]: https://github.com/Wyrhta-Labs/KithLedger/commit/d69feb3
[42cede6]: https://github.com/Wyrhta-Labs/KithLedger/commit/42cede6
[c50c2b8]: https://github.com/Wyrhta-Labs/KithLedger/commit/c50c2b8
[889c782]: https://github.com/Wyrhta-Labs/KithLedger/commit/889c782
[#1]: https://github.com/Wyrhta-Labs/KithLedger/issues/1
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
