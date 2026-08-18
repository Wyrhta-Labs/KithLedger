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

Requires PostgreSQL 18 running locally.

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

### Heorth-issued member tokens (optional)

Heorth is the household's identity provider. It signs short-lived
(5-minute), audience-bound **member tokens** with an asymmetric key and
publishes the public half at `GET /.well-known/jwks.json`; KithLedger
**verifies** them and holds no signing key for this — it is structurally unable
to mint one (ADR 0002 phase B, ADR 0009).

Configuration is optional **as a group**. Absent (the default), KithLedger
behaves exactly as before and satellite tokens are simply not accepted:

| Variable | Required | Meaning |
|---|---|---|
| `HEORTH_JWKS_URL` | with `SATELLITE_AUDIENCE` | Heorth's public key set, e.g. `http://heorth:4000/.well-known/jwks.json` |
| `SATELLITE_AUDIENCE` | with `HEORTH_JWKS_URL` | This service's own audience name — the only `aud` accepted (e.g. `kithledger`) |
| `HEORTH_ISSUER` | no | Expected `iss`; defaults to `heorth`. Setting it without the group is a startup error |

A `Bearer` JWT signed with an asymmetric algorithm is dispatched to this path;
`kl_` API keys and the local admin JWT (HS256) keep their existing path
untouched. Verification enforces the signature, `iss`, `aud` and `exp` with a
**60 second clock-skew leeway** (ADR 0009 open question 3).

**Key rotation and outages.** The public keys are cached in memory. A `kid`
already cached never causes a fetch, so a Heorth outage does not break
verification — cached keys keep working, and a failed refresh never clears
them. An **unknown** `kid` (i.e. Heorth rotated a key, per its README's
rotation procedure) triggers a refresh, rate-limited to **one attempt per
minute** counted from the last attempt, failures included. That bound is what
makes a stream of forged `kid`s cost nothing: an attacker gets one Heorth round
trip per minute regardless of request rate, and every such token is rejected.

### Household members are provisioned just in time

Members are authored in **exactly one place: Heorth**. KithLedger never holds a
roster and never syncs one — that coupling is what ADR 0007 cited when it
deleted Feoh. Instead, the first request carrying a validly signed token for a
`sub` this service has not seen creates the member's local record then and
there. There is no provisioning endpoint and no staleness window, and
consequently **no route to create a household member**: Heorth creates them,
and the seeded admin covers local operation.

The local record is a row in the shared `users` table whose **id is Heorth's
`sub`**, so one `users.id` identifies both members and the local admin (which
is what ADR 0004's forthcoming owner columns need). A companion
`household_members` row records that the account was authored by Heorth. Two
consequences worth stating plainly:

- **A member cannot authenticate locally.** Their stored password hash is not
  an argon2 hash at all, so no password verifies against it — structurally, not
  improbably. Their synthesised address is under the RFC 2606 reserved
  `.invalid` domain and can never receive mail.
- **A member cannot hold `kl_` API keys.** Key management requires a local JWT
  (which Heorth, signing asymmetrically, cannot mint) *and* refuses
  Heorth-authored callers outright. A `kl_` key is long-lived; handing one to
  the bearer of a 5-minute token would give back exactly what the short TTL is
  for, and would outlive Heorth offboarding them.

`/auth/keys` acts on the authenticated caller throughout — creating, listing
and revoking are scoped to whoever presented the JWT.

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
