import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';

export type JsonRow = Record<string, unknown>;

export interface MockDatabase {
  meta?: Record<string, unknown>;
  users: JsonRow[];
  refreshTokens: JsonRow[];
  emailTokens: JsonRow[];
  groups: JsonRow[];
  groupMembers: JsonRow[];
  follows: JsonRow[];
  events: JsonRow[];
  rsvps: JsonRow[];
  conversations: JsonRow[];
  conversationParticipants: JsonRow[];
  messages: JsonRow[];
  friendships: JsonRow[];
  notifications: JsonRow[];
  reports: JsonRow[];
  auditLogs: JsonRow[];
  payments: JsonRow[];
  activityLogs: JsonRow[];
}

export type CollectionName = Exclude<keyof MockDatabase, 'meta'>;

const DATE_KEYS = new Set([
  'createdAt',
  'updatedAt',
  'deletedAt',
  'suspendedAt',
  'emailVerifiedAt',
  'joinedAt',
  'lastReadAt',
  'respondedAt',
  'startTime',
  'endTime',
  'rsvpDeadline',
  'cancelledAt',
  'expiresAt',
  'revokedAt',
  'usedAt',
  'readAt',
]);

const COLLECTION_MAP: Record<string, CollectionName> = {
  user: 'users',
  refreshToken: 'refreshTokens',
  emailToken: 'emailTokens',
  group: 'groups',
  groupMember: 'groupMembers',
  follow: 'follows',
  event: 'events',
  rsvp: 'rsvps',
  conversation: 'conversations',
  conversationParticipant: 'conversationParticipants',
  message: 'messages',
  friendship: 'friendships',
  notification: 'notifications',
  report: 'reports',
  auditLog: 'auditLogs',
  payment: 'payments',
  activityLog: 'activityLogs',
};

const COMPOUND_UNIQUES: Record<string, string[]> = {
  groupId_userId: ['groupId', 'userId'],
  userId_groupId: ['userId', 'groupId'],
  eventId_userId: ['eventId', 'userId'],
  conversationId_userId: ['conversationId', 'userId'],
  requesterId_addresseeId: ['requesterId', 'addresseeId'],
};

function defaultSeedPath(): string {
  return join(process.cwd(), 'data', 'mock-db.json');
}

function writablePath(): string {
  return process.env.MOCK_DB_PATH || join('/tmp', 'gatherly-mock-db.json');
}

export class FileStore {
  private db!: MockDatabase;
  private path!: string;

  load(): void {
    const seed = process.env.MOCK_DB_SEED_PATH || defaultSeedPath();
    const target = writablePath();
    this.path = target;

    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      if (!existsSync(seed)) {
        throw new Error(`Mock data file not found at ${seed}`);
      }
      copyFileSync(seed, target);
    }

    this.db = JSON.parse(readFileSync(this.path, 'utf8')) as MockDatabase;
    this.rebaseEventDates();
  }

  private rebaseEventDates(): void {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    let changed = false;
    for (const event of this.db.events) {
      const offset = event._startOffsetDays;
      const hours = event._durationHours;
      if (typeof offset !== 'number' || typeof hours !== 'number') continue;
      if (event.status === 'COMPLETED') continue;
      const start = now + offset * day;
      const nextStart = new Date(start).toISOString();
      const nextEnd = new Date(start + hours * 60 * 60 * 1000).toISOString();
      if (event.startTime !== nextStart || event.endTime !== nextEnd) {
        event.startTime = nextStart;
        event.endTime = nextEnd;
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  persist(): void {
    writeFileSync(this.path, `${JSON.stringify(this.db, null, 2)}\n`);
  }

  collection(model: string): JsonRow[] {
    const key = COLLECTION_MAP[model];
    if (!key) throw new Error(`Unknown file-db model: ${model}`);
    return this.db[key];
  }

  hydrate(row: JsonRow | null): JsonRow | null {
    if (!row) return null;
    const out: JsonRow = { ...row };
    for (const [key, value] of Object.entries(out)) {
      if (DATE_KEYS.has(key) && typeof value === 'string') {
        out[key] = new Date(value);
      }
    }
    // Internal helpers are not part of the Prisma shape.
    delete out._startOffsetDays;
    delete out._durationHours;
    return out;
  }

  dehydrate(row: JsonRow): JsonRow {
    const out: JsonRow = { ...row };
    for (const [key, value] of Object.entries(out)) {
      if (value instanceof Date) out[key] = value.toISOString();
    }
    return out;
  }

  newId(prefix: string): string {
    return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }

  resolveCompound(where: Record<string, unknown>): Record<string, unknown> | null {
    for (const [key, fields] of Object.entries(COMPOUND_UNIQUES)) {
      if (where[key] && typeof where[key] === 'object') {
        return where[key] as Record<string, unknown>;
      }
      // Also accept flat compound if somehow passed
      if (fields.every((f) => f in where)) {
        return Object.fromEntries(fields.map((f) => [f, where[f]]));
      }
    }
    return null;
  }
}

export const fileStore = new FileStore();
