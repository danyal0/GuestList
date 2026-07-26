# Deployment Guide (Railway)

Gatherly deploys as **one Railway app service** (+ optional Postgres later).

By default the API uses **file-backed mock data** from `apps/api/data/mock-db.json` — no database required. When you are ready, set `DATA_SOURCE=postgres` and `DATABASE_URL`.

The app service boots Nest (internal `:4000`), Next.js (internal `:3000`), and a reverse proxy on Railway’s public `$PORT`:

- `/api`, `/uploads`, `/socket.io` → API
- everything else → web UI

## Public port

**Do not hardcode a public port in Railway.**  
Railway injects `PORT` automatically (often something like `8080`). Our `npm start` proxy listens on that value.

Point your custom domain at the **Railway service** (HTTPS on the default edge). You do **not** append `:4000` or `:3000` to `https://mkeplays-production.up.railway.app`.

| Port | Role |
| --- | --- |
| `$PORT` (Railway) | **Public** — only port to expose |
| `4000` | Internal API (container only) |
| `3000` | Internal Next.js (container only) |

## 1. Create the project

1. Railway → **New Project** → deploy this GitHub repo (**one** service).
2. Root directory: `/` (repo root).
3. Railway picks up `railway.json` / `railpack.json`.

Postgres is optional until you switch `DATA_SOURCE=postgres`.

## 2. Variables (defaults already set in `railpack.json`)

| Variable | Default |
| --- | --- |
| `DATA_SOURCE` | `file` |
| `PUBLIC_URL` / `WEB_URL` / `API_URL` / `CORS_ORIGINS` | `https://mkeplays-production.up.railway.app` |
| `NEXT_PUBLIC_SITE_URL` | `https://mkeplays-production.up.railway.app` |
| `COOKIE_SECURE` | `true` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | dev placeholders (change for real traffic) |

Leave `NEXT_PUBLIC_API_URL` **unset** so Socket.IO uses the same origin.

### Demo logins (file mode)

Password for all: `Passw0rd!`

- `maya@example.com` — member
- `admin@gatherly.app` — platform admin

## 3. When you add Postgres

1. Railway → **Add PostgreSQL** plugin.
2. Set:

| Variable | Value |
| --- | --- |
| `DATA_SOURCE` | `postgres` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |

3. Redeploy. Migrations run on boot; optionally seed:  
   `railway run --service gatherly npm run prisma:seed -w apps/api`

## 4. CI/CD

On pushes to `main`, if `RAILWAY_TOKEN` is set, CI runs `railway up --service gatherly`.

## Local production parity

```bash
npm run build
PORT=8080 npm start
# → http://localhost:8080  (mock file data)
```

## Health

- `GET /api/v1/health` → `{ status: "ok", database: "file" }` in mock mode  
  or `database: "up"` with Postgres.
