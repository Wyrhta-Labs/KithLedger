---
name: run-local
description: Use when asked to run, start, launch, or smoke-test KithLedger locally (API + web UI) for manual testing.
---

# Run KithLedger locally

KithLedger is a Hono API (`tsx`/Node) plus a Vite + React web UI in `web/`.
Both run against a shared Postgres. The web dev server proxies `/api` → the API.

## 1. Postgres (shared `kith-testdb`)

Both KithLedger and Heorth use one Postgres container on host port **55432**
(user `kith` / `kithpw`, databases `kithledger` and `heorth`). The API's
`.env` `DATABASE_URL` already points at it.

```bash
docker info >/dev/null 2>&1 || {              # Docker Desktop down? start it and wait
  "/c/Program Files/Docker/Docker/Docker Desktop.exe" &
  for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 5; done
}
docker start kith-testdb                        # container already exists & is seeded
docker exec kith-testdb pg_isready -U kith      # → accepting connections
```

If `kith-testdb` doesn't exist, create it:
`docker run -d --name kith-testdb -e POSTGRES_USER=kith -e POSTGRES_PASSWORD=kithpw -e POSTGRES_DB=kithledger -p 55432:5432 postgres:18-alpine`.
The app runs migrations + seeds the admin on boot, so an empty DB self-populates.

## 2. Run (background)

`.env` is **not** auto-loaded (no dotenv / `--env-file` in package scripts), so
pass `--env-file` explicitly.

**Standalone** (nothing else on 3000/5173 — no edits needed):

```bash
npx tsx --env-file=.env src/index.ts &> /tmp/kith-api.log &         # API :3000
( cd web && npx vite --port 5173 --strictPort ) &> /tmp/kith-web.log &  # web :5173
```

**Alongside Heorth** (Heorth owns 3000/5173, so move to 3001/5174):

```bash
API_PORT=3001 npx tsx --env-file=.env src/index.ts &> /tmp/kith-api.log &
( cd web && npx vite --port 5174 --strictPort ) &> /tmp/kith-web.log &
```

> ⚠️ `web/vite.config.ts` hardcodes the proxy target `http://localhost:3000`.
> When running on `API_PORT=3001`, change it to `:3001` for the web UI to reach
> the API — and **revert it before committing** (it's a local-only tweak). The
> API itself is fine on any port; only the web proxy needs the match.

Ready line in the API log: `KithLedger API running on http://localhost:<port>`.

## 3. Verify (drive it, don't just launch)

```bash
# standalone: web 5173 → API 3000
bash .claude/skills/run-local/smoke.sh 5173 admin-test-password
# alongside Heorth: web 5174 → API 3001 (proxy edited to :3001)
bash .claude/skills/run-local/smoke.sh 5174 admin-test-password
```

Exercises web → Vite proxy → API → Postgres → seeded admin by logging in and
checking for a JWT. Exit 0 = the whole stack is healthy. Open the web URL in a
browser to click through the UI (title: "KithLedger").

## 4. Stop

```bash
pkill -f "tsx --env-file=.env src/index.ts"
pkill -f "vite --port 517"     # matches 5173 or 5174
```

## Environment

Login is **password-only** (email is fixed internally to `admin@kithledger.local`):
`POST /api/v1/auth/token` with `{"password"}`.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://kith:kithpw@localhost:55432/kithledger` | shared `kith-testdb` |
| `API_PORT` | `3000` | set `3001` to run beside Heorth |
| `ADMIN_PASSWORD` | `admin-test-password` | seeded on boot |
| `JWT_SECRET` | (in `.env`) | ≥32 chars |
