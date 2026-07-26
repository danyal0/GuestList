# Gatherly

**Find your people.** Gatherly is a production-ready community discovery and events platform — discover communities, join groups, host events, RSVP, chat in real time, and manage communities professionally.

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

Prerequisites: Node 20+, Docker (or a local PostgreSQL 16).

```bash
# 1. Install dependencies
npm install

# 2. Start PostgreSQL (or use your own and set DATABASE_URL)
docker compose up db -d

# 3. Configure the API
cp apps/api/.env.example apps/api/.env

# 4. Migrate and seed
npm run db:migrate
npm run db:seed

# 5. Run API (:4000) + Web (:3000) together
npm run dev
```

Open http://localhost:3000. Seeded demo accounts (password `Passw0rd!demo`):

- `maya@gatherly.dev` — platform admin
- `liam@gatherly.dev`, `sofia@gatherly.dev`, … — regular members

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
| `npm run lint` | ESLint across API + web |
| `npm run test` | Jest unit tests (API + web) |
| `npm run test:e2e` | API integration tests (Supertest, isolated `gatherly_test` DB) |
| `npm run db:migrate` / `db:seed` / `db:generate` | Prisma workflows |
| `npx playwright test` (in `apps/web`) | Browser E2E (Chromium + mobile Safari) |

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database](docs/DATABASE.md)
- [API reference](docs/API.md) (live Swagger at `/api/docs` in dev)
- [Deployment guide (Railway)](docs/DEPLOYMENT.md)
- [Testing report](docs/TESTING.md)
- [Security checklist](docs/SECURITY.md)
- [Performance report](docs/PERFORMANCE.md)

## License

MIT
