# KithLedger

*Kith* — an Old English word for one's circle of friends, acquaintances, and family — is the foundation of KithLedger: an API-first database for tracking and nurturing personal relationships. KithLedger provides structured **REST and MCP** endpoints for both web interfaces and AI agents, keeping your entire social graph programmatically accessible. A ledger for the people who matter.

---

## Quick Start

### With Docker (recommended)

```bash
cp .env.example .env
# Edit .env — set JWT_SECRET, ADMIN_PASSWORD, POSTGRES_PASSWORD
npm run docker:up
```

The API starts at `http://localhost:4002`. Migrations run automatically on startup.

### Local development

Requires PostgreSQL 16 running locally.

```bash
cp .env.example .env
# Edit .env with your local DATABASE_URL
npm install
npm run db:migrate
npm run dev
```

---

## Authentication

### Get a JWT

```bash
curl -X POST http://localhost:4002/api/v1/auth/token \
  -H 'Content-Type: application/json' \
  -d '{"password": "your-admin-password"}'
```

### Create an API key

```bash
curl -X POST http://localhost:4002/api/v1/auth/keys \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"name": "my-agent"}'
# Returns a kl_... key — save it, shown only once
```

Use `Authorization: Bearer kl_...` or `Authorization: Bearer <jwt>` on all protected routes.

---

## MCP Server

KithLedger exposes its domain to AI agents over the Model Context Protocol, in
addition to REST. The MCP server calls the same service layer as REST, so
business rules (recurrence, mutual relationships, conflict handling) and the
audit trail are identical.

### Run it

```bash
npm run mcp   # migrations + admin seed run automatically, then stdio transport
```

### Authenticate

The MCP server reads a `kl_` API key from the `KITHLEDGER_MCP_API_KEY`
environment variable. Create one over REST while authenticated as the admin
(JWT), then set it in the MCP server's environment:

```bash
curl -X POST http://localhost:4002/api/v1/auth/keys \
  -H 'Authorization: Bearer <jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"name": "mcp-agent"}'
# Returns a kl_... key — save it, shown only once

export KITHLEDGER_MCP_API_KEY=kl_...
npm run mcp
```

A valid key resolves to the single admin user. A missing, invalid, or
non-`kl_` value is rejected — the server errors on the first tool call.

### Tools (namespaced `kith.*`)

| Tool | Behavior |
|---|---|
| `kith.list_people` | List people (`q`, `tags`, `birthday_month`) |
| `kith.get_person` | Get one person |
| `kith.create_person` | Create a person |
| `kith.update_person` | Update a person |
| `kith.get_person_graph` | Ego network (`depth` 1-3) |
| `kith.list_interactions` | List interactions (`person_id`, `type`, `from`, `to`) |
| `kith.log_interaction` | Log an interaction |
| `kith.list_reminders` | List reminders (`status`, `overdue`) |
| `kith.create_reminder` | Create a reminder |
| `kith.complete_reminder` | Complete (creates next if recurring) |
| `kith.snooze_reminder` | Snooze a reminder |
| `kith.list_relationships` | List relationships |
| `kith.create_relationship` | Create a relationship |

---

## Endpoint Reference

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/api/v1/auth/token` | Issue JWT |
| GET | `/api/v1/auth/keys` | List API keys |
| POST | `/api/v1/auth/keys` | Create API key |
| DELETE | `/api/v1/auth/keys/:id` | Revoke API key |
| GET | `/api/v1/people` | List people (`?q=`, `?tags=`, `?birthday_month=`) |
| POST | `/api/v1/people` | Create person |
| GET | `/api/v1/people/:id` | Get person |
| PATCH | `/api/v1/people/:id` | Update person |
| DELETE | `/api/v1/people/:id` | Delete person |
| GET | `/api/v1/people/:id/graph` | Ego network (`?depth=1`) |
| GET | `/api/v1/interactions` | List interactions (`?person_id=`, `?type=`, `?from=`, `?to=`) |
| POST | `/api/v1/interactions` | Log interaction |
| GET | `/api/v1/interactions/:id` | Get interaction |
| PATCH | `/api/v1/interactions/:id` | Update interaction |
| DELETE | `/api/v1/interactions/:id` | Delete interaction |
| GET | `/api/v1/reminders` | List reminders (`?person_id=`, `?status=`, `?overdue=true`) |
| POST | `/api/v1/reminders` | Create reminder |
| GET | `/api/v1/reminders/:id` | Get reminder |
| PATCH | `/api/v1/reminders/:id` | Update reminder |
| DELETE | `/api/v1/reminders/:id` | Delete reminder |
| POST | `/api/v1/reminders/:id/complete` | Mark done (creates next if recurring) |
| POST | `/api/v1/reminders/:id/snooze` | Snooze (`{"snooze_until": "..."}`) |
| POST | `/api/v1/reminders/:id/dismiss` | Dismiss |
| GET | `/api/v1/relationships` | List relationships (`?person_id=`, `?type=`) |
| POST | `/api/v1/relationships` | Create link |
| GET | `/api/v1/relationships/:id` | Get relationship |
| PATCH | `/api/v1/relationships/:id` | Update relationship |
| DELETE | `/api/v1/relationships/:id` | Delete relationship |

### Response envelope

```jsonc
// Success
{ "data": { ... }, "meta": {} }

// Collection
{ "data": [...], "meta": { "total": 42, "limit": 20, "offset": 0 } }

// Error
{ "error": { "code": "NOT_FOUND", "message": "Person not found" } }
```

Pagination: `?limit=20&offset=0` (max 100).

---

## Running Tests

Tests require a running PostgreSQL instance with `DATABASE_URL` set.

```bash
npm test
```
