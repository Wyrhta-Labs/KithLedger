# Changelog

All notable changes to KithLedger will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/KithLedger/KithLedger/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/KithLedger/KithLedger/commits/v0.1.0
[d906993]: https://github.com/KithLedger/KithLedger/commit/d906993
[b48d3c2]: https://github.com/KithLedger/KithLedger/commit/b48d3c2
[8ec44c2]: https://github.com/KithLedger/KithLedger/commit/8ec44c2
[cf34cc3]: https://github.com/KithLedger/KithLedger/commit/cf34cc3
