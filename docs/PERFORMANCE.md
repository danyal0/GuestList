# Performance Report

## Frontend

Targets: Lighthouse 95+ on the core journeys (home, browse, detail pages).

What makes it fast:

- **App Router + RSC** — static prerendering for every route that doesn't need per-request data (18 of 21 routes are static); dynamic routes stream.
- **Bundle discipline** — shared First Load JS is ~103 kB; the heaviest route (admin, which ships Recharts) is isolated from user-facing pages. Route-level code splitting is automatic; icons are tree-shaken from `lucide-react`.
- **Images** — CDN-ready (`images.remotePatterns`), lazy-loaded covers, gradient placeholders instead of layout-shifting hero images, explicit dimensions on avatars.
- **Perceived performance** — skeleton loaders for every async surface, optimistic RSVP updates, React Query cache (30s stale) eliminating refetch waterfalls, service-worker stale-while-revalidate for repeat visits.
- **Typography/CSS** — system font stack (zero font download), Tailwind v4 with on-demand utilities, design tokens as CSS variables (no runtime theming cost).

Verify locally:

```bash
npm run build -w apps/web && npm run start -w apps/web
npx lighthouse http://localhost:3000 --preset=desktop
```

## API

Target: p95 < 200 ms.

- **Query shape** — every list endpoint is paginated and selects only projected columns; N+1s avoided via Prisma `include`/`select` on the exact relations the response needs; counts batched with `groupBy`.
- **Indexes** — all hot paths hit covering indexes (see [DATABASE.md](DATABASE.md)); FTS uses GIN indexes rather than `ILIKE` scans; geo filtering pre-filters with a bounding box before haversine.
- **Observed locally** (seeded data, dev hardware): browse/detail endpoints log 2–15 ms; search 5–20 ms; auth (argon2 verify, intentionally slow) ~60–90 ms — all comfortably under budget. The logging interceptor flags any response >500 ms as a warning so regressions surface in logs.
- **Hot-path realtime** — RSVP count broadcasts are fire-and-forget and never block the request path.

## Database

- Serializable transactions are scoped to the tiny RSVP capacity window only.
- Denormalized `memberCount` avoids counting members on every card render.
- Recurring events are materialized as rows at creation (bounded to 52 occurrences), so listing is a plain indexed range query instead of RRULE expansion per request.

## Scaling path

1. Add Redis: session-adjacent caching, Socket.IO adapter for multi-instance fan-out, queue for email.
2. Move uploads to object storage + CDN.
3. Read replicas for browse/search traffic; the search provider swaps to Elasticsearch when relevance tuning demands it.
