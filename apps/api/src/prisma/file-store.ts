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
  venues: JsonRow[];
  events: JsonRow[];
  rsvps: JsonRow[];
  conversations: JsonRow[];
  conversationParticipants: JsonRow[];
  messages: JsonRow[];
  friendships: JsonRow[];
  userBlocks: JsonRow[];
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
  'previousStartTime',
  'rescheduledAt',
  'remindersSentAt',
  'rsvpDeadline',
  'cancelledAt',
  'verifiedAt',
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
  venue: 'venues',
  event: 'events',
  rsvp: 'rsvps',
  conversation: 'conversations',
  conversationParticipant: 'conversationParticipants',
  message: 'messages',
  friendship: 'friendships',
  userBlock: 'userBlocks',
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
  blockerId_blockedId: ['blockerId', 'blockedId'],
};

function defaultSeedPath(): string {
  const candidates = [
    process.env.MOCK_DB_SEED_PATH,
    join(process.cwd(), 'data', 'mock-db.json'),
    join(process.cwd(), 'apps', 'api', 'data', 'mock-db.json'),
    join(__dirname, '..', '..', 'data', 'mock-db.json'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

/**
 * Writable mock DB path.
 * Prefer the Railway volume at /data so signups + WhatsApp links survive redeploys.
 */
function writablePath(): string {
  if (process.env.MOCK_DB_PATH) return process.env.MOCK_DB_PATH;
  if (existsSync('/data') || process.env.RAILWAY_ENVIRONMENT) {
    return join('/data', 'mock-db.json');
  }
  return join('/tmp', 'mkeplays-mock-db.json');
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
    if (!Array.isArray(this.db.venues)) this.db.venues = [];
    this.ensureWhatsappExtras();
    this.repairOrphanedRelations();
    this.rebaseEventDates();
  }

  /**
   * Remove rows left behind by older file-mode deletes that did not cascade.
   * Fixes production DBs where hard-deleted communities left orphan events
   * (admin backoffice then crashed on null `event.group`).
   */
  private repairOrphanedRelations(): void {
    const groupIds = new Set(this.db.groups.map((g) => g.id));
    const userIds = new Set(this.db.users.map((u) => u.id));
    let changed = false;

    const beforeEvents = this.db.events.length;
    this.db.events = this.db.events.filter((e) => groupIds.has(e.groupId));
    if (this.db.events.length !== beforeEvents) changed = true;

    const eventIds = new Set(this.db.events.map((e) => e.id));
    const beforeRsvps = this.db.rsvps.length;
    this.db.rsvps = this.db.rsvps.filter(
      (r) => eventIds.has(r.eventId) && userIds.has(r.userId),
    );
    if (this.db.rsvps.length !== beforeRsvps) changed = true;

    const beforeMembers = this.db.groupMembers.length;
    this.db.groupMembers = this.db.groupMembers.filter(
      (m) => groupIds.has(m.groupId) && userIds.has(m.userId),
    );
    if (this.db.groupMembers.length !== beforeMembers) changed = true;

    const beforeFollows = this.db.follows.length;
    this.db.follows = this.db.follows.filter(
      (f) => groupIds.has(f.groupId) && userIds.has(f.userId),
    );
    if (this.db.follows.length !== beforeFollows) changed = true;

    for (const payment of this.db.payments) {
      if (payment.groupId != null && !groupIds.has(payment.groupId)) {
        payment.groupId = null;
        changed = true;
      }
    }

    const beforeConversations = this.db.conversations.length;
    this.db.conversations = this.db.conversations.filter(
      (c) => c.groupId == null || groupIds.has(c.groupId),
    );
    if (this.db.conversations.length !== beforeConversations) changed = true;

    const conversationIds = new Set(this.db.conversations.map((c) => c.id));
    const beforeParticipants = this.db.conversationParticipants.length;
    this.db.conversationParticipants = this.db.conversationParticipants.filter(
      (p) => conversationIds.has(p.conversationId) && userIds.has(p.userId),
    );
    if (this.db.conversationParticipants.length !== beforeParticipants) changed = true;

    const beforeMessages = this.db.messages.length;
    this.db.messages = this.db.messages.filter((m) =>
      conversationIds.has(m.conversationId),
    );
    if (this.db.messages.length !== beforeMessages) changed = true;

    for (const event of this.db.events) {
      if (event.parentEventId != null && !eventIds.has(event.parentEventId)) {
        event.parentEventId = null;
        changed = true;
      }
    }

    if (changed) {
      console.warn('[file-store] repaired orphaned rows after non-cascade deletes');
      this.persist();
    }
  }

  /**
   * Patch older persisted mock DBs (on /data) so WhatsApp file-mode works
   * without wiping user signups.
   */
  private ensureWhatsappExtras(): void {
    let changed = false;
    if (!Array.isArray(this.db.venues)) {
      this.db.venues = [];
      changed = true;
    }
    if (!Array.isArray(this.db.userBlocks)) {
      this.db.userBlocks = [];
      changed = true;
    }

    for (const friendship of this.db.friendships) {
      if (!friendship.status) {
        friendship.status = friendship.respondedAt ? 'ACCEPTED' : 'PENDING';
        changed = true;
      }
    }

    for (const user of this.db.users) {
      if (!('shadowBannedAt' in user)) {
        user.shadowBannedAt = null;
        changed = true;
      }
    }

    // Seed / refresh canonical venues from catalog JSON (idempotent by slug).
    try {
      const catalogPath = join(__dirname, '..', 'data', 'venues-catalog.json');
      const seedPath = join(process.cwd(), 'data', 'venues-catalog.json');
      const srcPath = join(process.cwd(), 'src', 'data', 'venues-catalog.json');
      const pathToUse = existsSync(catalogPath)
        ? catalogPath
        : existsSync(srcPath)
          ? srcPath
          : existsSync(seedPath)
            ? seedPath
            : join(process.cwd(), 'apps', 'api', 'src', 'data', 'venues-catalog.json');
      if (existsSync(pathToUse)) {
        const catalog = JSON.parse(readFileSync(pathToUse, 'utf8')) as Array<
          Record<string, unknown>
        >;
        const now = new Date().toISOString();
        for (const row of catalog) {
          const slug = String(row.slug || '');
          if (!slug) continue;
          const existing = this.db.venues.find((v) => v.slug === slug);
          if (existing) {
            // Keep verified user edits; refresh catalog fields when source=catalog.
            if (existing.source === 'catalog' || !existing.source) {
              Object.assign(existing, {
                name: row.name,
                sport: row.sport,
                city: row.city,
                region: row.region,
                country: row.country,
                address: row.address,
                latitude: row.latitude,
                longitude: row.longitude,
                aliases: row.aliases,
                notes: row.notes ?? null,
                courtCount: row.courtCount ?? null,
                defaultCapacity: row.defaultCapacity ?? null,
                source: 'catalog',
                verifiedAt: now,
                updatedAt: now,
              });
              changed = true;
            }
            continue;
          }
          this.db.venues.push({
            id: `venue_${slug.replace(/-/g, '').slice(0, 16)}`,
            slug,
            name: row.name,
            sport: row.sport,
            city: row.city,
            region: row.region,
            country: row.country,
            address: row.address,
            latitude: row.latitude,
            longitude: row.longitude,
            aliases: row.aliases,
            notes: row.notes ?? null,
            courtCount: row.courtCount ?? null,
            defaultCapacity: row.defaultCapacity ?? null,
            source: 'catalog',
            verifiedAt: now,
            createdAt: now,
            updatedAt: now,
          });
          changed = true;
        }
      }
    } catch (err) {
      // Non-fatal — venue catalog is best-effort in file mode.
      console.warn('[file-store] venue catalog seed failed:', (err as Error).message);
    }

    for (const user of this.db.users) {
      if (!('whatsappLid' in user)) {
        user.whatsappLid = null;
        changed = true;
      }
      if (!('phone' in user)) {
        user.phone = null;
        changed = true;
      }
      if (!('deletedAt' in user)) {
        user.deletedAt = null;
        changed = true;
      }
      if (!Array.isArray(user.interests)) {
        user.interests = [];
        changed = true;
      }
      if (!Array.isArray(user.skills)) {
        user.skills = [];
        changed = true;
      }
      if (!user.role) {
        user.role = 'USER';
        changed = true;
      }
    }

    for (const group of this.db.groups) {
      if (typeof group.memberCount !== 'number') {
        const activeMembers = this.db.groupMembers.filter(
          (m) => m.groupId === group.id && (m.status === 'ACTIVE' || m.status == null),
        ).length;
        group.memberCount = Math.max(1, activeMembers);
        changed = true;
      }
      if (group.isVerified === undefined) {
        group.isVerified = false;
        changed = true;
      }
      if (!group.privacy) {
        group.privacy = 'PUBLIC';
        changed = true;
      }
    }

    const hasTennis = this.db.groups.some(
      (g) => typeof g.name === 'string' && /tennis/i.test(g.name),
    );
    if (!hasTennis) {
      const owner =
        this.db.users.find((u) => u.email === 'diego@example.com') ||
        this.db.users[0];
      if (owner?.id) {
        const now = new Date().toISOString();
        this.db.groups.unshift({
          id: 'group_mke_tennis',
          slug: 'mke-tennis-group',
          name: 'MKE Tennis Group',
          description:
            'Pickup tennis matches — courts, times, and RSVPs synced from WhatsApp.',
          category: 'SPORTS',
          privacy: 'PUBLIC',
          location: 'Milwaukee, WI',
          latitude: 43.0389,
          longitude: -87.9065,
          ownerId: owner.id,
          rules: 'RSVP honestly. Be kind on and off the court.',
          isVerified: false,
          memberCount: 1,
          coverImage: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        this.db.groupMembers.push({
          id: `gm_tennis_${String(owner.id).slice(-6)}`,
          groupId: 'group_mke_tennis',
          userId: owner.id,
          role: 'OWNER',
          status: 'ACTIVE',
          joinedAt: now,
        });
        changed = true;
      }
    }

    if (changed) this.persist();
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
