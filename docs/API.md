# API Reference

Base URL: `/api/v1` · Interactive Swagger docs at **`/api/docs`** (non-production).

## Conventions

- **Auth**: `Authorization: Bearer <accessToken>` (mobile) or httpOnly cookies (web). Cookie-based mutations additionally require `X-CSRF-Token` matching the `mkeplays_csrf` cookie.
- **Pagination**: `?page=1&limit=20` → `{ items, total, page, limit, totalPages }`.
- **Errors**: `{ statusCode, message, error, path, timestamp }`. Validation errors return `message` as an array.
- **Rate limits**: 120 req/min global; stricter on auth endpoints (login/signup 10/min, forgot-password 5/min, resend-verification 3/min).

## Auth

| Method | Path | Description |
| --- | --- | --- |
| POST | `/auth/signup` | Create account → user + token pair (+ cookies) |
| POST | `/auth/login` | Email/password login |
| POST | `/auth/google` | Google ID-token sign-in |
| POST | `/auth/apple` | Apple identity-token sign-in |
| POST | `/auth/refresh` | Rotate refresh token (body or cookie) |
| POST | `/auth/logout` | Revoke session(s), clear cookies |
| GET | `/auth/me` | Current user |
| POST | `/auth/forgot-password` | Always 200 (no enumeration) |
| POST | `/auth/reset-password` | Consume token, revoke all sessions |
| POST | `/auth/verify-email` | Consume verification token |
| POST | `/auth/resend-verification` | Re-send verification mail |
| POST | `/auth/change-password` | Requires current password |

## Users & profiles

| Method | Path | Description |
| --- | --- | --- |
| PATCH | `/users/me` | Update name/bio/location/interests/skills/avatar |
| DELETE | `/users/me` | Soft-delete account, revoke sessions |
| GET | `/users/me/activity` | Activity history |
| GET | `/profiles/:id` | Public profile + stats + friendship status |
| GET | `/profiles/me/follows` | Communities I follow |
| POST/DELETE | `/profiles/follows/:groupId` | Follow / unfollow |
| POST | `/profiles/friends/:userId` | Send friend request |
| POST | `/profiles/friends/:userId/accept` · `/decline` | Respond |
| GET | `/profiles/me/friends` | Friends + pending requests |

## Communities

| Method | Path | Description |
| --- | --- | --- |
| POST | `/groups` | Create (creator becomes Owner) |
| GET | `/groups` | Browse: `category`, `q`, `sort=popular\|new\|active`, `lat/lng/radiusKm`, pagination |
| GET | `/groups/mine` | My memberships |
| GET | `/groups/:idOrSlug` | Detail + viewer membership context |
| PATCH | `/groups/:id` | Admin+ |
| DELETE | `/groups/:id` | Owner only (soft delete) |
| POST | `/groups/:id/transfer-ownership` | Owner only |
| POST | `/groups/:id/join` · `/leave` | Join (instant or pending) / leave |
| GET | `/groups/:id/members` · `/members/pending` | Rosters |
| POST | `/groups/:id/members/:userId/approve` · `/reject` · `/ban` · `/unban` | Member lifecycle (Admin+, outranking enforced) |
| PATCH | `/groups/:id/members/:userId/role` | Promote/demote (Admin+) |

## Events

| Method | Path | Description |
| --- | --- | --- |
| POST | `/events` | Create (Moderator+ in the community); RRULE generates daily/weekly/monthly/custom occurrences |
| GET | `/events` | Browse: `groupId`, `mode`, `from/to`, `q`, geo filters, `sort=soonest\|popular` |
| GET | `/events/mine` | My upcoming RSVPs |
| GET | `/events/:id` | Detail + viewer RSVP + attendee preview + occurrences |
| PATCH | `/events/:id` | Host/Admin+ (notifies attendees) |
| DELETE | `/events/:id` | Cancel (`?scope=one\|series`, default `one`); notifies attendees |
| GET | `/events/:id/attendees` | Attendee management (host view includes waitlist order) |
| GET | `/events/:id/calendar.ics` | RFC 5545 export |
| PUT | `/events/:id/rsvp` | Set `GOING`/`INTERESTED`/`DECLINED` → `{ rsvp, waitlisted }` |
| DELETE | `/events/:id/rsvp` | Remove RSVP (frees a spot → FIFO promotion) |

## Messaging

| Method | Path | Description |
| --- | --- | --- |
| GET | `/messaging/conversations` | My conversations + unread counts |
| POST | `/messaging/conversations/direct` | Open/reuse a DM `{ userId }` |
| POST | `/messaging/conversations/group/:groupId` | Open/join community chat |
| GET | `/messaging/conversations/:id/messages` | Cursor-paginated history |
| POST | `/messaging/conversations/:id/messages` | Send `{ content }` |
| POST | `/messaging/conversations/:id/read` | Mark read |
| DELETE | `/messaging/messages/:id` | Soft-delete own message |

## Notifications, search, recommendations

| Method | Path | Description |
| --- | --- | --- |
| GET | `/notifications` | Paginated list |
| GET | `/notifications/unread-count` | Badge count |
| POST | `/notifications/:id/read` · `/read-all` | Mark read |
| GET | `/search?q=&category=&lat=&lng=&radiusKm=` | Groups + events + people (FTS) |
| GET | `/recommendations/groups` · `/events` | Personalized suggestions |

## Payments, moderation, admin

| Method | Path | Description |
| --- | --- | --- |
| POST | `/payments/checkout` | Start premium upgrade for a group |
| POST | `/payments/:id/confirm` | Confirm (internal provider) |
| GET | `/payments/mine` | Payment history |
| POST | `/moderation/reports` | Report user/group/event/message |
| GET | `/moderation/reports` | Open reports (Moderator+) |
| POST | `/moderation/reports/:id/resolve` | Dismiss / resolve / takedown |
| GET | `/admin/users` · `/groups` · `/events` · `/audit-logs` | Admin lists (RBAC `ADMIN`) |
| PATCH | `/admin/users/:id/suspension` · `/role` | Suspend / change role |
| GET | `/admin/analytics/overview` · `/dau` · `/mau` · `/growth` · `/retention` · `/attendance` | Dashboard data |
| GET | `/admin/conversations` | List chats system-wide |
| DELETE | `/admin/conversations/:id` | Hard-delete chat + messages |
| POST | `/admin/bulk/conversations/hard-delete` | Bulk hard-delete chats |
| GET | `/admin/friendships` | List friendships / pending requests |
| DELETE | `/admin/friendships/:id` | Remove friendship / cancel pending request |
| POST | `/admin/bulk/friendships/remove` | Bulk unfriend / cancel requests |
| POST | `/admin/import/events` | Import events from JSON/CSV (`?includeRemote=1`); returns `importedEvents`, `createdEvents`, `updatedEvents` |

## Realtime (Socket.IO)

Connect to the API origin with `auth: { token: <accessToken> }`.

| Direction | Event | Payload |
| --- | --- | --- |
| client → | `conversation:join` / `conversation:leave` | `{ conversationId }` |
| client → | `conversation:typing` | `{ conversationId }` |
| client → | `event:watch` / `event:unwatch` | `{ eventId }` |
| → client | `notification` | Notification row |
| → client | `message` / `message:deleted` | Message / `{ messageId }` |
| → client | `rsvp:updated` | `{ eventId, counts }` |
| → client | `event:updated` | `{ eventId, event }` |
