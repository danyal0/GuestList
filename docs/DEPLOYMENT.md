# Deployment Guide (Railway)

Gatherly deploys as **two Railway services** in one project: **PostgreSQL** + **one app service** that runs the API and web UI together from this monorepo.

The app service boots Nest (internal `:4000`), Next.js (internal `:3000`), and a tiny reverse proxy on Railway’s public `$PORT` that routes `/api`, `/uploads`, and `/socket.io` to the API and everything else to the UI.

> Keep the service **Root Directory** at `/` (repo root). npm workspaces must install and build from the root.

## 1. Create the project

1. Railway → **New Project** → **Deploy PostgreSQL**.
2. **New service → GitHub repo** → select this repository (**once**).

Railway picks up the root `railway.json` / `railpack.json` (build + `npm start` + health check).

## 2. Configure the app service (`gatherly`)

- **Variables**:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference the DB service) |
| `NODE_ENV` | `production` |
| `WEB_URL` | `https://<your-railway-domain>` |
| `API_URL` | `https://<your-railway-domain>` (same public origin; proxy serves `/api`) |
| `CORS_ORIGINS` | `https://<your-railway-domain>` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | 32+ char random secrets (`openssl rand -base64 48`) |
| `COOKIE_SECURE` | `true` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | Optional mail provider (emails log to console when unset) |
| `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` | OAuth client IDs (optional) |

Leave `NEXT_PUBLIC_API_URL` **unset** so the browser Socket.IO client uses the same origin (proxied to the API).

Optional internals (defaults are fine):

| Variable | Default | Purpose |
| --- | --- | --- |
| `INTERNAL_API_PORT` | `4000` | Nest bind port inside the container |
| `INTERNAL_WEB_PORT` | `3000` | Next.js bind port inside the container |

- **Networking**: generate a public domain on the app service.
- Migrations run on boot (`prisma migrate deploy` before the API listens).
- **Uploads**: attach a Railway **Volume** at `/app/apps/api/uploads` (or the service working directory’s `apps/api/uploads`) so images survive deploys.

## 3. Optional: split API and web into two services

If you later want separate services, use Config-as-code:

- API → `apps/api/railway.json` (Dockerfile), start via that image
- Web → `apps/web/railway.json` (Dockerfile)

Set `API_URL` / `NEXT_PUBLIC_API_URL` to the API’s private/public URLs as described in those files’ comments and the web `.env.example`.

## 4. CI/CD

`.github/workflows/ci.yml` runs lint → unit tests → API integration tests → builds → Playwright E2E on every push/PR. On pushes to `main`, if a `RAILWAY_TOKEN` repository secret is present, it deploys the app service with the Railway CLI (`railway up --service gatherly`). Alternatively, enable Railway’s GitHub auto-deploys and drop the deploy job.

## Local production parity

```bash
npm run build
PORT=8080 DATABASE_URL=... JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... \
  WEB_URL=http://localhost:8080 API_URL=http://localhost:8080 CORS_ORIGINS=http://localhost:8080 \
  npm start
# → http://localhost:8080 (UI + /api via proxy)
```

Or the multi-container setup:

```bash
docker compose up --build   # db + api + web as separate containers
```

## Rollbacks & health

- Railway keeps previous deploys — one-click rollback.
- Health check: `/api/v1/health` (proxied to the API; verifies DB connectivity).
- Structured request logs + audit log table for forensics.
