# Database

PostgreSQL 16 with Prisma ORM. Schema source of truth: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma).

## Entity overview

```
User ──< GroupMember >── Group ──< Event ──< Rsvp >── User
  │            │            │        │
  │            │            └──< Follow          └──< Notification
  ├──< RefreshToken (rotation families)
  ├──< EmailToken (verify / reset, hashed, single-use)
  ├──< Friendship (requester/addressee + status)
  ├──< ConversationParticipant >── Conversation ──< Message
  ├──< Report (polymorphic target)
  ├──< AuditLog
  ├──< Payment
  └──< ActivityLog (signals for analytics + recommendations)
```

## Core tables

| Table | Highlights |
| --- | --- |
| `users` | argon2 `passwordHash` (nullable for OAuth-only), `role` (`USER`/`MODERATOR`/`ADMIN`), `interests[]`, `skills[]`, coordinates, soft delete (`deletedAt`), suspension (`suspendedAt`) |
| `refresh_tokens` | SHA-256 `tokenHash` (unique), rotation `family`, `revokedAt`, `replacedById`, device metadata — powers reuse detection |
| `groups` | unique `slug`, `category` enum, `privacy` (`PUBLIC`/`PRIVATE`/`HIDDEN`), denormalized `memberCount`, coordinates, soft delete |
| `group_members` | unique `(groupId, userId)`, `role` (Owner/Admin/Moderator/Member), `status` (`ACTIVE`/`PENDING`/`BANNED`), `joinedAt` |
| `events` | `mode` (in-person/online/hybrid), `status` lifecycle (`DRAFT`→`PUBLISHED`→`COMPLETED`/`CANCELLED`), `capacity`, `allowWaitlist`, `rsvpDeadline`, `recurrenceRule` (RRULE) + `parentEventId` for occurrences, timezone |
| `rsvps` | unique `(eventId, userId)`, `status` (`GOING`/`INTERESTED`/`WAITLISTED`/`DECLINED`) |
| `conversations` / `messages` | direct + group chats, soft-deleted messages, `lastReadAt` per participant |
| `notifications` | `type` enum + JSONB `payload`, `read` flag |
| `audit_logs` | actor, action, target, IP — append-only |

## Indexing strategy

- **Lookup paths**: every FK used in list queries carries an index (`events(groupId, startTime)`, `rsvps(eventId, status)`, `messages(conversationId, createdAt)`, `notifications(userId, read, createdAt)` …).
- **Uniqueness as integrity**: `(groupId,userId)`, `(eventId,userId)`, `refresh_tokens.tokenHash`, `groups.slug`, `users.email` are unique constraints, not application checks.
- **Full-text search** (manual migration `20260726021700_fts_indexes`):
  - GIN on `to_tsvector('english', name || ' ' || description)` for `groups` and `events`;
  - `pg_trgm` GIN on `users.name` for fuzzy people search;
  - B-tree partial indexes for upcoming published events.

## Concurrency correctness

RSVP capacity decisions (count → decide → write) run inside **serializable transactions**, so two concurrent "going" requests for the last seat cannot both succeed; the loser is automatically waitlisted (or rejected when the waitlist is off). Waitlist promotion is FIFO by `createdAt` inside the same isolation level.

## Migrations & seed

```bash
npm run db:migrate     # prisma migrate deploy (idempotent, used in prod/start)
npm run db:seed        # rich demo data: 8 users, 6 communities, ~20 events,
                       # RSVPs, friendships, follows, conversations, notifications
```

Migrations live in `apps/api/prisma/migrations` and are applied automatically on container boot (`prisma migrate deploy` in the Docker CMD).
