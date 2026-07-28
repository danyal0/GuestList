# MKE Plays

**Find your people.** MKE Plays is a production-ready community discovery and events platform — discover communities, join groups, host events, RSVP, chat in real time, and manage communities professionally.

| App | Stack | Path |
| --- | --- | --- |
| API | NestJS 11 · TypeScript · Prisma · PostgreSQL 16 · Socket.IO | `apps/api` |
| Web | Next.js 15 (App Router) · Tailwind CSS 4 · React Query · Zustand · Framer Motion · PWA | `apps/web` |
| Mobile (iOS + Android) | Expo SDK 57 · React Native · expo-router · React Query | `apps/mobile` |

## Features

- **Authentication** — email/password (argon2), Google & Apple sign-in, email verification, password reset, rotating refresh tokens with reuse detection, secure httpOnly cookies + CSRF protection, rate limiting.
- **Communities** — create/join/leave, categories, rules, cover images, `PUBLIC` / `PRIVATE` (approval queue) / `HIDDEN` privacy, role hierarchy (Owner → Admin → Moderator → Member) with downward-only moderation, ownership transfer.
- **Events** — one-time / recurring (RRULE) / online / in-person / hybrid, capacity with automatic FIFO waitlist promotion, RSVP deadline, ICS calendar export, reminders, cancellation.
- **Messaging** — direct and community chats over Socket.IO with typing indicators, read state and unread counts.
- **Notifications** — in-app + email (push-ready payloads) for new members, event reminders, RSVP confirmations, waitlist promotions, messages, and community updates.
- **Search** — PostgreSQL full-text search (tsvector + GIN, pg_trgm for people) behind a provider interface that swaps for Elasticsearch without touching call sites.
- **Recommendations** — explainable rule-based scoring (interests, location, attendance history, friends, popularity) designed to be replaced by an ML pipeline.
- **Admin** — user/community/event management, moderation queue, audit log, and analytics (DAU, MAU, signup growth, weekly retention cohorts, event attendance).

## Quick start

Prerequisites: Node 20+. Postgres is optional — by default the API uses file mock data in `apps/api/data/mock-db.json`.

```bash
# 1. Install dependencies
npm install

# 2. (Optional) Configure the API — defaults use file data + Railway URL
cp apps/api/.env.example apps/api/.env

# 3. Run API (:4000) + Web (:3000) together
npm run dev
```

Open http://localhost:3000. Demo accounts (password `Passw0rd!`):

- `maya@example.com` — member
- `admin@mkeplays.app` — platform admin

To use Postgres instead: set `DATA_SOURCE=postgres`, start DB (`docker compose up db -d`), then `npm run db:migrate && npm run db:seed`.

### Full stack via Docker

```bash
docker compose up --build
```

### Mobile app

```bash
npm run mobile:install
npm run dev:mobile          # scan the QR code with Expo Go (iOS/Android)
```

The dev client auto-targets your machine's API on port 4000; set `EXPO_PUBLIC_API_URL` for other environments.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | API + web concurrently |
| `npm run build` | Production builds for API + web |
| `npm run start` | Production: API + web behind one proxy (Railway single service) |
| `npm run start:api` / `start:web` | Start only API or only web |
| `npm run lint` | ESLint across API + web |
| `npm run test` | Jest unit tests (API + web) |
| `npm run test:e2e` | API integration tests (Supertest, isolated `mkeplays_test` DB) |
| `npm run smoke:file` | Smoke-test file-backed API mode |
| `npm run whatsapp:install` | Install bot-only deps (Puppeteer) — **not** used by Railway |
| `npm run whatsapp:bot` | Long-running WhatsApp ↔ app bridge (`scripts/whatsapp/bot.js`) |

## WhatsApp tennis-group bridge

A long-running Node process watches a WhatsApp group, classifies messages with xAI/Grok, and POSTs into Next.js routes that write Events / RSVPs via Prisma.

**Railway-only:** set `WHATSAPP_BOT_ENABLED=true` on the Railway service. The production starter launches the bot beside API + web (uses system Chromium from railpack). See [Deployment → WhatsApp](docs/DEPLOYMENT.md).

**Or run separately:**

```bash
# 1. Env for the bot (repo root)
cp .env.whatsapp.example .env
# fill WHATSAPP_BOT_TOKEN, XAI_API_KEY, APP_BASE_URL, WHATSAPP_GROUP_NAME

# 2. Env for Next.js / Railway
# WHATSAPP_BOT_TOKEN, DATABASE_URL, WHATSAPP_DEFAULT_GROUP_ID

# 3. Apply schema (User.phone + Event.whatsappMessageId)
npm run db:migrate

# 4. Local / VPS only:
npm run whatsapp:install
npm run whatsapp:bot   # scan QR on first run
```

| Variable | Where | Purpose |
| --- | --- | --- |
| `WHATSAPP_BOT_TOKEN` | bot + web | Shared secret (`x-whatsapp-bot-token` header) |
| `XAI_API_KEY` | bot | Grok classification |
| `XAI_API_URL` | bot | Defaults to `https://api.x.ai/v1/chat/completions` |
| `XAI_MODEL` | bot | Defaults to `grok-4-1-fast-non-reasoning-latest` |
| `WHATSAPP_GROUP_NAME` | bot | Group to monitor (default `Tennis Group`); name fallback for events |
| `APP_BASE_URL` | bot | Next.js origin for `/api/whatsapp/*` |
| `DATABASE_URL` | api | Optional Postgres; omit for file-backed `/data/mock-db.json` |
| `WHATSAPP_DEFAULT_GROUP_ID` | web | Preferred community cuid (optional; falls back by name/slug/SPORTS) |
| `WHATSAPP_DEFAULT_GROUP_SLUG` / `_NAME` | web | Fallbacks when id unset |

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database](docs/DATABASE.md)
- [API reference](docs/API.md) (live Swagger at `/api/docs` in dev)
- [Deployment guide (Railway — one app service)](docs/DEPLOYMENT.md)
- [Testing report](docs/TESTING.md)
- [Security checklist](docs/SECURITY.md)
- [Performance report](docs/PERFORMANCE.md)

## License

MIT
