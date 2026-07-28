# Deployment Guide (Railway)

MKE Plays deploys as **one Railway app service** (+ optional Postgres later).

By default the API uses **file-backed mock data** — no database required. On Railway the writable copy lives on the `/data` volume (`MOCK_DB_PATH=/data/mock-db.json`) so signups and WhatsApp LID links survive redeploys. When you are ready, set `DATA_SOURCE=postgres` and `DATABASE_URL`.

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
- `admin@mkeplays.app` — platform admin

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

## WhatsApp bot (Railway-only or separate host)

The bot can run **inside the same Railway service** as a sibling process.

### Option A — all on Railway (recommended for simplicity)

1. Merge this branch and redeploy.
2. Railway → service → **Variables**:

| Variable | Value |
| --- | --- |
| `WHATSAPP_BOT_ENABLED` | `true` |
| `WHATSAPP_BOT_TOKEN` | long random secret (same value used by Next.js routes) |
| `WHATSAPP_GROUP_NAME` | `Tennis Group` (exact WhatsApp title; also used to find an MKE Plays community by name if id unset) |
| `XAI_API_KEY` | from https://console.x.ai |
| `WHATSAPP_DEFAULT_GROUP_ID` | optional cuid; if unset we fall back to name/slug/SPORTS group |
| `WHATSAPP_DEFAULT_GROUP_SLUG` | optional, e.g. `mke-tennis-group` |
| `WHATSAPP_DEFAULT_GROUP_NAME` | optional name contains match (defaults toward `Tennis`) |
| `DATABASE_URL` | optional Postgres URL; omit to stay on file mode |
| `DATA_SOURCE` | `file` (default) or `postgres` |
| `MOCK_DB_PATH` | writable file DB (default `/data/mock-db.json` on Railway) |
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/chromium` (default in railpack) |

3. Railway → service → **Volumes** (important): mount a volume at `/data` so WhatsApp login survives redeploys. Auth files go to `/data/wwebjs_auth`.
4. Open **Deploy Logs**. On first boot look for `[whatsapp-bot] Or open: https://api.qrserver.com/...` — open that URL and scan with WhatsApp → Linked Devices.
5. After “Ready”, leave it running. Bot crashes auto-restart without taking down the website.

Use a Railway plan with **≥1–2 GB RAM** — Chromium is heavy.

### Option B — laptop / VPS

```bash
npm run whatsapp:install
npm run whatsapp:bot
```

Point `APP_BASE_URL` at your Railway public URL. Keep `WHATSAPP_BOT_ENABLED=false` on Railway.
