# Testing Report

## Layers

| Layer | Tooling | Location | Count |
| --- | --- | --- | --- |
| API unit | Jest + ts-jest | `apps/api/src/**/*.spec.ts` | 74 tests / 8 suites |
| API integration | Supertest against a real Postgres (`mkeplays_test`) | `apps/api/test/app.e2e-spec.ts` | 32 tests |
| Web unit/component | Jest + React Testing Library (jsdom) | `apps/web/src/**/*.test.ts(x)` | 49 tests / 5 suites |
| Browser E2E | Playwright (Chromium + iPhone 13 WebKit) | `apps/web/e2e/*.spec.ts` | 9 scenarios × 2 projects = 18 |
| Mobile | `tsc --noEmit` + `expo lint` + `expo export` (both platforms bundle) | `apps/mobile` | build-level gates |

All suites pass locally and run in CI (see `.github/workflows/ci.yml`).

## What is covered (happy path / failure / edge)

**Auth**
- ✅ signup, login, `/me`, token pair issuance
- ❌ duplicate email (409), weak password (400), wrong password & unknown email (both 401 with identical generic message), suspended/deleted accounts
- ⚠️ refresh rotation; **reuse of a rotated token revokes the whole family**; expired tokens; password reset invalidates every session; single-use email tokens; CSRF rejection for cookie-authenticated mutations

**Communities**
- ✅ create, browse, slug resolution with viewer context, instant join
- ❌ member editing community (403), moderating equal/higher roles, non-member access to hidden groups (404, no existence leak)
- ⚠️ private-group approval queue, role hierarchy inheritance

**Events & RSVP**
- ✅ create, RSVP GOING/INTERESTED/DECLINED, ICS export, cancellation
- ✅ recurring create (daily/weekly/monthly RRULE), cancel one occurrence (`scope=one`), cancel series (`scope=series`)
- ❌ end-before-start (400), plain members creating events (403), RSVP after start/deadline/cancellation, requesting WAITLISTED directly
- ⚠️ capacity 1 → second RSVP waitlisted; decline → **FIFO waitlist promotion** + notification; self-exclusion from capacity counts when switching status

**Web UI**
- Component states: button loading/disabled/asChild, empty & error states with retry, event card variants (online, full, cancelled, RSVP badges)
- Validation schemas: password complexity, event time ordering, mode-dependent required fields
- E2E: signup → authenticated shell; invalid login shows error; client-side validation blocks weak passwords; guest guards on protected pages; discover → browse → detail navigation; search; 404 page

## Running

```bash
npm run test                 # API + web unit suites
npm run test:e2e             # API integration (creates/migrates mkeplays_test)
cd apps/web && npx playwright test
npm run test:cov -w apps/api # coverage
```

## Coverage philosophy

Coverage is collected for services/controllers (API) and lib/ui (web) via `test:cov`. The suites prioritize **behavioral coverage of the risk-bearing paths** — auth token lifecycle, permission boundaries, capacity concurrency, money-adjacent flows — over line-count vanity on presentational code. Every feature listed above has happy-path, failure and edge assertions; gaps (e.g., mail rendering, socket gateway internals) are integration-tested indirectly through the flows that use them.
