# Deployment Guide (Railway)

Gatherly deploys as **three Railway services** in one project: PostgreSQL, the API, and the web app.

> **Important:** Keep each service’s **Root Directory** at `/` (repo root). This is an npm workspaces monorepo — installs and builds must run from the root. Point each service at its Config-as-code file (below) so Railway uses the Dockerfiles instead of Railpack. If Config-as-code is unset, Railpack builds from the root `package.json` and needs the root `start` / `start:web` scripts (already defined).

## 1. Create the project

1. Railway → **New Project** → **Deploy PostgreSQL** (this provisions the database and a `DATABASE_URL`).
2. **New service → GitHub repo** → select this repository. Do this **twice** (one service for the API, one for the web app).

## 2. Configure the API service (`gatherly-api`)

- **Settings → Config-as-code file**: `apps/api/railway.json` (builds `apps/api/Dockerfile` with the repo root as context; health check on `/api/v1/health`).
- **Railpack fallback** (only if not using the Dockerfile): Build Command `npm run build:api`, Start Command `npm run start:api`.
- **Variables**:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference the DB service) |
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `WEB_URL` | `https://<your-web-domain>` |
| `API_URL` | `https://<your-api-domain>` |
| `CORS_ORIGINS` | `https://<your-web-domain>` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | 32+ char random secrets (`openssl rand -base64 48`) |
| `COOKIE_SECURE` | `true` |
| `COOKIE_DOMAIN` | apex domain if web+api share it, else unset |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | Your mail provider (emails log to console when unset) |
| `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` | OAuth client IDs (optional) |

- **Networking**: generate a public domain.
- Migrations run automatically on boot (`prisma migrate deploy` in the container CMD). Seed once if desired: `railway run --service gatherly-api npm run prisma:seed -w apps/api`.
- **Uploads**: attach a Railway **Volume** mounted at `/app/apps/api/uploads` so uploaded images survive deploys (or point the uploads module at S3-compatible storage later).

## 3. Configure the web service (`gatherly-web`)

- **Settings → Config-as-code file**: `apps/web/railway.json`.
- **Railpack fallback** (only if not using the Dockerfile): Build Command `npm run build:web`, Start Command `npm run start:web`.
- **Build args / variables**:

| Variable | Value |
| --- | --- |
| `API_URL` | Internal API URL, e.g. `http://gatherly-api.railway.internal:4000` (baked into rewrites at build time) |
| `NEXT_PUBLIC_API_URL` | Public API URL for the browser's Socket.IO connection, e.g. `https://<your-api-domain>` |
| `NEXT_PUBLIC_SITE_URL` | `https://<your-web-domain>` |

- **Networking**: generate/attach your public domain.

Using Railway's **private networking** for `API_URL` keeps proxied API traffic off the public internet; only WebSocket traffic uses the public API domain.

## 4. CI/CD

`.github/workflows/ci.yml` runs lint → unit tests → API integration tests (with a Postgres service container) → builds → Playwright E2E on every push/PR. On pushes to `main`, if a `RAILWAY_TOKEN` repository secret is present, it deploys both services with the Railway CLI (`railway up`). Alternatively, enable Railway's built-in GitHub auto-deploys and drop the deploy job — CI still gates on the branch protection check.

## Local production parity

```bash
docker compose up --build   # db + api + web, exactly as deployed
```

## Rollbacks & health

- Railway keeps previous deploys — one-click rollback.
- API healthcheck: `/api/v1/health` verifies DB connectivity; Docker HEALTHCHECK and Railway's healthcheckPath both use it.
- Structured request logs + audit log table for forensics.
