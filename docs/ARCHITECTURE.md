# Architecture

## Overview

MKE Plays is a **modular monolith** with three clients sharing one API contract:

```
┌─────────────┐   ┌──────────────┐   ┌───────────────┐
│  Next.js 15 │   │ Expo RN app  │   │  Admin (web)  │
│  (PWA, SSR) │   │ iOS/Android  │   │  /admin route │
└──────┬──────┘   └──────┬───────┘   └───────┬───────┘
       │ HTTPS + WS      │ HTTPS + WS        │
       └────────┬────────┴───────────────────┘
                ▼
        ┌───────────────┐      ┌──────────────┐
        │  NestJS API   │──────│  Socket.IO   │
        │  modular      │      │  gateway     │
        │  monolith     │      └──────────────┘
        └──────┬────────┘
               ▼
        ┌───────────────┐
        │ PostgreSQL 16 │  (Prisma ORM, FTS, pg_trgm)
        └───────────────┘
```

The web client proxies `/api/*` and `/uploads/*` through Next.js rewrites so cookies stay first-party and no CORS is needed in production. The mobile client talks to the API directly with Bearer tokens stored in the platform keychain (expo-secure-store). WebSockets connect straight to the API origin.

## Backend modules

Each NestJS module owns its domain and communicates with others through the DI container and an internal event bus (`@nestjs/event-emitter`), never through cross-module table access:

| Module | Responsibility |
| --- | --- |
| `auth` | Credentials, OAuth (Google/Apple ID-token verification), JWT issuance, refresh rotation, email tokens |
| `users` / `profiles` | Account settings, public profiles, follows, friendships, activity history |
| `groups` | Communities, membership lifecycle, role permissions |
| `events` | Event CRUD, recurrence expansion (RRULE), ICS export, reminder scheduler |
| `rsvp` | Attendance state machine, capacity, waitlist promotion |
| `messaging` | Conversations, messages, read state |
| `notifications` | Event-driven fan-out to in-app + email channels (push-ready) |
| `realtime` | Socket.IO gateway: rooms per user/conversation/event |
| `search` | `SearchProvider` interface + Postgres FTS implementation |
| `recommendations` | Rule-based scoring engine |
| `payments` | `PaymentProvider` interface + internal mock provider |
| `moderation` | Reports, resolutions, takedowns |
| `analytics` | DAU/MAU/retention/growth aggregations |
| `admin` | Platform administration endpoints (RBAC: `ADMIN`) |
| `uploads` | Image uploads with content sniffing |
| `mail`, `audit`, `health`, `prisma` | Cross-cutting infrastructure |

### Request pipeline

```
Throttler → JwtAuthGuard → CsrfGuard → RolesGuard → ValidationPipe → handler → AllExceptionsFilter
```

- **JwtAuthGuard** accepts `Authorization: Bearer` (mobile) or the `mkeplays_access` httpOnly cookie (web) and records which source was used.
- **CsrfGuard** enforces double-submit-cookie CSRF **only** for cookie-authenticated mutations — Bearer requests cannot be forged cross-origin.
- **AllExceptionsFilter** normalizes error bodies and maps Prisma errors (unique violation → 409, not found → 404) without leaking internals.

### Event-driven notifications

Domain modules emit `NOTIFY_EVENT` payloads; the notifications module persists in-app rows, optionally sends email, and the realtime gateway pushes to `user:{id}` rooms. Adding a push channel (APNs/FCM) means adding one subscriber — no domain code changes.

## Microservices migration path

The monolith is deliberately partitioned along future service boundaries:

1. **Extract realtime** — the gateway already communicates with domain modules only via the event bus; swap the in-process bus for Redis pub/sub and run it as its own deployment.
2. **Extract search** — call sites depend on the `SearchProvider` interface; implement an Elasticsearch provider fed by CDC or the outbox pattern.
3. **Extract messaging/notifications** — both are consumers of domain events; move them behind a queue (BullMQ/SQS).
4. **Split core domains** (users, groups, events) last, once scale demands it — each already owns its Prisma models and exposes intent-based service methods.

## Frontend architecture

- **App Router with RSC** — pages are server-rendered shells; interactive islands are client components.
- **React Query** owns all server state (30s stale time, invalidation on mutations, optimistic updates for RSVP).
- **Zustand** holds the tiny bit of global client state: the session user and the in-memory access token used for the Socket.IO handshake.
- **Design system** — tokens as CSS variables in `globals.css` (colors, radius, shadows, motion), components in `src/components/ui` with loading/empty/error states and WCAG-minded semantics.
- **PWA** — installable manifest plus a service worker doing stale-while-revalidate for static assets and network-first with cache fallback for API GETs, with an `/offline` fallback page.

## Mobile architecture

Expo + expo-router mirrors the web information architecture (Discover / Events / Messages / Profile tabs, stack screens for details). The API client refreshes tokens transparently and stores them in SecureStore. The design tokens in `src/lib/theme.ts` mirror the web palette so both clients feel like one product. The architecture is intentionally SwiftUI-ready: every screen maps 1:1 to a SwiftUI view (tab scaffold, list + detail stacks), and the API contract is platform-neutral.

## Key decisions and tradeoffs

| Decision | Tradeoff | Why |
| --- | --- | --- |
| Modular monolith over microservices | Less independent scaling | One deployable unit is dramatically cheaper to operate correctly at this stage; boundaries are enforced in code so extraction is mechanical, not a rewrite |
| Postgres FTS over Elasticsearch | Weaker relevance tuning | Zero extra infrastructure; the provider interface makes the swap non-breaking |
| Cookies (web) + Bearer (mobile) | Two auth paths to maintain | httpOnly cookies eliminate XSS token theft on the web; Bearer suits native clients — the guard abstracts both |
| Serializable transactions for RSVP capacity | Occasional retries under contention | Correctness: a sold-out event must never oversell |
| Rule-based recommendations | Lower ceiling than ML | Explainable, deterministic, testable; signals are already logged for a future pipeline |
