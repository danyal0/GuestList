/**
 * Simulates WhatsApp group messages + app signup linking for both directions:
 * 1) WhatsApp-first (name / LID / phone) → signup claims password onto that identity
 * 2) Signup-first → later WhatsApp message attaches LID (and name/phone only when missing)
 */
import * as argon2 from 'argon2';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import { OAuthService } from '../auth/oauth.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  claimNamedPlaceholder,
  findOrCreateNamedAttendee,
  findOrLinkWhatsappUser,
} from './whatsapp-identity';
import { phonesMatch } from '../common/utils/phone';

type UserRow = {
  id: string;
  name: string;
  phone: string | null;
  whatsappLid: string | null;
  email: string | null;
  passwordHash: string | null;
  deletedAt: Date | null;
  suspendedAt: Date | null;
  role: string;
  interests: string[];
  skills: string[];
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
  emailVerifiedAt: Date | null;
  googleId: string | null;
  appleId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RsvpRow = {
  id: string;
  eventId: string;
  userId: string;
  status: string;
  createdAt: Date;
};

type EventRow = {
  id: string;
  title: string;
  startTime: Date;
  locationName: string | null;
  hostId: string;
  venueId: string | null;
};

function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  if (!where) return true;
  if (where.AND && Array.isArray(where.AND)) {
    return (where.AND as Record<string, unknown>[]).every((part) => matchesWhere(row, part));
  }
  if (where.OR && Array.isArray(where.OR)) {
    return (where.OR as Record<string, unknown>[]).some((part) => matchesWhere(row, part));
  }
  if (where.NOT) {
    const not = where.NOT as Record<string, unknown>;
    if (Array.isArray(not)) {
      if (not.some((part) => matchesWhere(row, part))) return false;
    } else if (matchesWhere(row, not)) {
      return false;
    }
  }

  for (const [key, expected] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') continue;
    const actual = row[key];
    if (expected === null) {
      if (actual != null) return false;
      continue;
    }
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      const op = expected as Record<string, unknown>;
      if ('equals' in op) {
        const mode = op.mode === 'insensitive';
        const left = String(actual ?? '');
        const right = String(op.equals ?? '');
        if (mode ? left.toLowerCase() !== right.toLowerCase() : left !== right) return false;
        continue;
      }
      if ('startsWith' in op) {
        const mode = op.mode === 'insensitive';
        const left = String(actual ?? '');
        const right = String(op.startsWith ?? '');
        if (mode) {
          if (!left.toLowerCase().startsWith(right.toLowerCase())) return false;
        } else if (!left.startsWith(right)) {
          return false;
        }
        continue;
      }
      if ('endsWith' in op) {
        if (!String(actual ?? '').endsWith(String(op.endsWith ?? ''))) return false;
        continue;
      }
      if ('not' in op) {
        if (actual === op.not) return false;
        continue;
      }
      if ('in' in op && Array.isArray(op.in)) {
        if (!op.in.includes(actual)) return false;
        continue;
      }
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function project<T extends Record<string, unknown>>(
  row: T,
  select?: Record<string, boolean>,
): Partial<T> {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(select)) {
    if (v) out[k] = row[k];
  }
  return out as Partial<T>;
}

function createMemoryPrisma() {
  const users: UserRow[] = [];
  const rsvps: RsvpRow[] = [];
  const events: EventRow[] = [];
  let seq = 1;
  const nextId = (prefix: string) => `${prefix}_${seq++}`;

  const prisma = {
    user: {
      async findFirst(args: { where?: Record<string, unknown>; select?: Record<string, boolean> } = {}) {
        const row = users.find((u) => matchesWhere(u as unknown as Record<string, unknown>, args.where ?? {}));
        return row ? project(row, args.select) : null;
      },
      async findFirstOrThrow(args: { where?: Record<string, unknown>; select?: Record<string, boolean> } = {}) {
        const row = await this.findFirst(args);
        if (!row) throw new Error('Not found');
        return row;
      },
      async findUnique(args: { where: Record<string, unknown>; select?: Record<string, boolean> }) {
        const where = args.where;
        const row = users.find((u) => {
          if (where.id) return u.id === where.id;
          if (where.email) return u.email === where.email;
          if (where.phone) return u.phone === where.phone;
          if (where.whatsappLid) return u.whatsappLid === where.whatsappLid;
          return false;
        });
        return row ? project(row, args.select) : null;
      },
      async findUniqueOrThrow(args: { where: Record<string, unknown>; select?: Record<string, boolean> }) {
        const row = await this.findUnique(args);
        if (!row) throw new Error('Not found');
        return row;
      },
      async findMany(args: { where?: Record<string, unknown>; select?: Record<string, boolean>; take?: number } = {}) {
        let rows = users.filter((u) => matchesWhere(u as unknown as Record<string, unknown>, args.where ?? {}));
        if (args.take != null) rows = rows.slice(0, args.take);
        return rows.map((r) => project(r, args.select));
      },
      async create(args: { data: Partial<UserRow>; select?: Record<string, boolean> }) {
        const now = new Date();
        const row: UserRow = {
          id: nextId('usr'),
          name: args.data.name ?? 'User',
          phone: args.data.phone ?? null,
          whatsappLid: args.data.whatsappLid ?? null,
          email: args.data.email ?? null,
          passwordHash: args.data.passwordHash ?? null,
          deletedAt: args.data.deletedAt ?? null,
          suspendedAt: args.data.suspendedAt ?? null,
          role: 'USER',
          interests: [],
          skills: [],
          avatarUrl: null,
          bio: null,
          location: null,
          emailVerifiedAt: null,
          googleId: null,
          appleId: null,
          createdAt: now,
          updatedAt: now,
        };
        // Unique phone / LID
        if (row.phone && users.some((u) => !u.deletedAt && u.phone === row.phone)) {
          throw Object.assign(new Error('Unique constraint failed on phone'), { code: 'P2002' });
        }
        if (row.whatsappLid && users.some((u) => !u.deletedAt && u.whatsappLid === row.whatsappLid)) {
          throw Object.assign(new Error('Unique constraint failed on whatsappLid'), { code: 'P2002' });
        }
        users.push(row);
        return project(row, args.select);
      },
      async update(args: { where: { id: string }; data: Partial<UserRow>; select?: Record<string, boolean> }) {
        const idx = users.findIndex((u) => u.id === args.where.id);
        if (idx < 0) throw new Error('Not found');
        const next = { ...users[idx]!, ...args.data, updatedAt: new Date() };
        if (next.phone) {
          const clash = users.find((u) => u.id !== next.id && !u.deletedAt && u.phone === next.phone);
          if (clash) throw Object.assign(new Error('Unique constraint failed on phone'), { code: 'P2002' });
        }
        if (next.whatsappLid) {
          const clash = users.find(
            (u) => u.id !== next.id && !u.deletedAt && u.whatsappLid === next.whatsappLid,
          );
          if (clash) throw Object.assign(new Error('Unique constraint failed on whatsappLid'), { code: 'P2002' });
        }
        users[idx] = next;
        return project(next, args.select);
      },
    },
    rsvp: {
      async findMany(args: {
        where?: Record<string, unknown>;
        select?: Record<string, boolean>;
        include?: Record<string, unknown>;
        orderBy?: unknown;
        take?: number;
      } = {}) {
        let rows = rsvps.filter((r) => matchesWhere(r as unknown as Record<string, unknown>, args.where ?? {}));
        if (args.take != null) rows = rows.slice(0, args.take);
        return rows.map((r) => {
          const base = project(r, args.select);
          if (args.include && (args.include as { event?: boolean }).event) {
            const event = events.find((e) => e.id === r.eventId);
            return {
              ...base,
              event: event
                ? {
                    id: event.id,
                    title: event.title,
                    startTime: event.startTime,
                    locationName: event.locationName,
                    venue: null,
                    host: users.find((u) => u.id === event.hostId)
                      ? { name: users.find((u) => u.id === event.hostId)!.name }
                      : null,
                  }
                : null,
            };
          }
          return base;
        });
      },
      async upsert(args: {
        where: { eventId_userId: { eventId: string; userId: string } };
        create: { eventId: string; userId: string; status: string };
        update: { status: string };
      }) {
        const existing = rsvps.find(
          (r) =>
            r.eventId === args.where.eventId_userId.eventId &&
            r.userId === args.where.eventId_userId.userId,
        );
        if (existing) {
          existing.status = args.update.status;
          return existing;
        }
        const created: RsvpRow = {
          id: nextId('rsvp'),
          eventId: args.create.eventId,
          userId: args.create.userId,
          status: args.create.status,
          createdAt: new Date(),
        };
        rsvps.push(created);
        return created;
      },
      async delete(args: { where: { id: string } }) {
        const idx = rsvps.findIndex((r) => r.id === args.where.id);
        if (idx >= 0) rsvps.splice(idx, 1);
        return { id: args.where.id };
      },
    },
    event: {
      async updateMany(args: { where: { hostId: string }; data: { hostId: string } }) {
        let count = 0;
        for (const e of events) {
          if (e.hostId === args.where.hostId) {
            e.hostId = args.data.hostId;
            count += 1;
          }
        }
        return { count };
      },
    },
    activityLog: {
      async create() {
        return {};
      },
    },
    emailToken: {
      async updateMany() {
        return { count: 0 };
      },
      async create() {
        return {};
      },
    },
    _users: users,
    _rsvps: rsvps,
    _events: events,
    _seedEvent(hostId: string, title = 'Atwater tennis') {
      const event: EventRow = {
        id: nextId('evt'),
        title,
        startTime: new Date('2026-07-30T23:00:00.000Z'),
        locationName: 'Atwater Elementary',
        hostId,
        venueId: null,
      };
      events.push(event);
      return event;
    },
    _seedRsvp(eventId: string, userId: string, status = 'GOING') {
      const rsvp: RsvpRow = {
        id: nextId('rsvp'),
        eventId,
        userId,
        status,
        createdAt: new Date(),
      };
      rsvps.push(rsvp);
      return rsvp;
    },
  };

  return prisma;
}

describe('WhatsApp ↔ signup linking scenarios', () => {
  describe('scenario 1: WhatsApp-first (name) → message saves LID/phone → signup links password', () => {
    it('creates name-only attendee, attaches LID+exact name+phone on group message, then signup claims it', async () => {
      const prisma = createMemoryPrisma();

      // Host mentions Khatera by name only in a WhatsApp event message.
      const placeholder = await findOrCreateNamedAttendee(prisma as unknown as PrismaService, 'Khatera');
      expect(placeholder).toMatchObject({
        name: 'Khatera',
        phone: null,
        whatsappLid: null,
      });
      const host = await findOrLinkWhatsappUser(prisma as unknown as PrismaService, {
        senderLid: '999000111222333',
        senderName: 'Host Danyal',
        senderPhone: '4145550999',
      });
      const event = prisma._seedEvent(host!.id);
      prisma._seedRsvp(event.id, placeholder!.id);

      // Khatera herself later messages in the group (RSVP) — bot sends LID + exact name + phone.
      const linked = await findOrLinkWhatsappUser(prisma as unknown as PrismaService, {
        senderLid: '173709952336025',
        senderJid: '173709952336025@lid',
        senderName: 'Khatera Javed',
        senderPhone: '4145550100',
      });

      expect(linked!.id).toBe(placeholder!.id);
      expect(linked).toMatchObject({
        name: 'Khatera Javed',
        phone: '14145550100',
        whatsappLid: '173709952336025',
      });

      // Same person registers via signup form — should offer phone link, then claim merges password account.
      const moduleRef = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: PrismaService, useValue: prisma },
          {
            provide: TokenService,
            useValue: {
              issuePair: jest.fn().mockResolvedValue({
                accessToken: 'a',
                refreshToken: 'r',
                accessExpiresIn: 900,
                refreshExpiresIn: 3600,
              }),
            },
          },
          { provide: OAuthService, useValue: {} },
          { provide: MailService, useValue: { send: jest.fn() } },
          { provide: AuditService, useValue: { log: jest.fn() } },
          {
            provide: ConfigService,
            useValue: { get: () => undefined },
          },
        ],
      }).compile();
      const auth = moduleRef.get(AuthService);

      const signup = await auth.signup(
        {
          name: 'Khatera Javed',
          phone: '1 (414) 555-0100',
          password: 'Str0ngPassw0rd!',
        },
        {},
      );

      expect(signup.linkSuggestions?.some((s) => s.userId === placeholder!.id && s.match === 'phone')).toBe(
        true,
      );
      expect(signup.user.passwordHash).toBeUndefined();
      expect(signup.user.phone).toBe('14145550100');
      expect(signup.user.whatsappLid).toBeNull();

      const claimed = await auth.claimNamedProfile(signup.user.id, placeholder!.id);
      expect(claimed.user.id).toBe(signup.user.id);
      expect(claimed.user.whatsappLid).toBe('173709952336025');
      expect(claimed.user.phone).toBe('14145550100');
      expect(claimed.user.name).toBe('Khatera Javed');

      const survivor = prisma._users.find((u) => u.id === signup.user.id)!;
      expect(survivor.passwordHash).toBeTruthy();
      expect(survivor.whatsappLid).toBe('173709952336025');

      const loser = prisma._users.find((u) => u.id === placeholder!.id)!;
      expect(loser.deletedAt).toBeTruthy();
      expect(loser.whatsappLid).toBeNull();
      expect(loser.phone).toBeNull();

      // RSVP history moved onto the password account.
      expect(prisma._rsvps.some((r) => r.userId === signup.user.id && r.eventId === event.id)).toBe(true);
    });

    it('creates LID-only bridge user from a WhatsApp message, fills phone later, then signup links', async () => {
      const prisma = createMemoryPrisma();

      // First WhatsApp message: only LID + display name (no phone yet from contact API).
      const wa = await findOrLinkWhatsappUser(prisma as unknown as PrismaService, {
        senderLid: '173709952336025',
        senderJid: '173709952336025@lid',
        senderName: 'Ada',
      });
      expect(wa).toMatchObject({
        name: 'Ada',
        phone: null,
        whatsappLid: '173709952336025',
      });

      // Later message enrichment has exact name + phone.
      const updated = await findOrLinkWhatsappUser(prisma as unknown as PrismaService, {
        senderLid: '173709952336025',
        senderName: 'Ada Lovelace',
        senderPhone: '4145550100',
      });
      expect(updated!.id).toBe(wa!.id);
      expect(updated).toMatchObject({
        name: 'Ada Lovelace',
        phone: '14145550100',
        whatsappLid: '173709952336025',
      });

      const claimed = await (async () => {
        // Simulate signup+claim without Nest for the core merge path.
        const passwordHash = await argon2.hash('Str0ngPassw0rd!');
        // Detach phone from WA row like AuthService.signup does.
        await prisma.user.update({
          where: { id: wa!.id },
          data: { phone: null },
        });
        const signupUser = await prisma.user.create({
          data: {
            name: 'Ada Lovelace',
            phone: '14145550100',
            passwordHash,
          },
        });
        return claimNamedPlaceholder(
          prisma as unknown as PrismaService,
          signupUser.id!,
          wa!.id,
        );
      })();

      expect(claimed.whatsappLid).toBe('173709952336025');
      expect(claimed.phone).toBe('14145550100');
      expect(claimed.name).toBe('Ada Lovelace');
      const survivor = prisma._users.find((u) => u.id === claimed.id)!;
      expect(survivor.passwordHash).toBeTruthy();
    });
  });

  describe('scenario 2: signup-first → WhatsApp message links LID without clobbering phone/name', () => {
    it('attaches LID and exact WhatsApp name only when the account is bridge-like; keeps signup phone/name', async () => {
      const prisma = createMemoryPrisma();
      const passwordHash = await argon2.hash('Str0ngPassw0rd!');
      const signup = await prisma.user.create({
        data: {
          name: 'Sam Player',
          phone: '14145550200',
          passwordHash,
        },
      });

      // Same person messages in WhatsApp group — bot has LID + a different phone format + contact name.
      const linked = await findOrLinkWhatsappUser(prisma as unknown as PrismaService, {
        senderLid: '155566677788899',
        senderJid: '155566677788899@lid',
        senderPhone: '4145550200', // 10-digit variant of the signup phone
        senderName: 'Sam From WhatsApp',
      });

      expect(linked!.id).toBe(signup.id);
      expect(linked!.whatsappLid).toBe('155566677788899');
      // Signup phone kept (already saved); 10-digit WA form must not replace it with a different number.
      expect(linked!.phone).toBe('14145550200');
      expect(phonesMatch(linked!.phone, '4145550200')).toBe(true);
      // Password account keeps the name chosen at signup.
      expect(linked!.name).toBe('Sam Player');
    });

    it('does not overwrite an already-saved signup phone with a different WhatsApp number', async () => {
      const prisma = createMemoryPrisma();
      const passwordHash = await argon2.hash('Str0ngPassw0rd!');
      const signup = await prisma.user.create({
        data: {
          name: 'Jordan Lee',
          phone: '14145550300',
          passwordHash,
          whatsappLid: '111222333444555',
        },
      });

      const linked = await findOrLinkWhatsappUser(prisma as unknown as PrismaService, {
        senderLid: '111222333444555',
        senderPhone: '4145559999', // different number from WhatsApp contact
        senderName: 'Jordan WA',
      });

      expect(linked!.id).toBe(signup.id);
      expect(linked!.phone).toBe('14145550300');
      expect(linked!.name).toBe('Jordan Lee');
      expect(linked!.whatsappLid).toBe('111222333444555');
    });

    it('merges a separate LID-only bridge row into the signup account when both identities appear', async () => {
      const prisma = createMemoryPrisma();
      const passwordHash = await argon2.hash('Str0ngPassw0rd!');
      const signup = await prisma.user.create({
        data: {
          name: 'Priya Shah',
          phone: '14145550400',
          passwordHash,
        },
      });
      // Earlier WhatsApp activity created a LID-only row (no phone observed yet).
      const lidOnly = await findOrLinkWhatsappUser(prisma as unknown as PrismaService, {
        senderLid: '200300400500600',
        senderName: 'Priya',
      });
      expect(lidOnly!.id).not.toBe(signup.id);

      // Later message includes both phone (matches signup) and LID → merge into password account.
      const merged = await findOrLinkWhatsappUser(prisma as unknown as PrismaService, {
        senderLid: '200300400500600',
        senderPhone: '4145550400',
        senderName: 'Priya Shah',
      });

      expect(merged!.id).toBe(signup.id);
      expect(merged!.whatsappLid).toBe('200300400500600');
      expect(merged!.phone).toBe('14145550400');
      expect(merged!.name).toBe('Priya Shah');
      expect(prisma._users.find((u) => u.id === lidOnly!.id)!.deletedAt).toBeTruthy();
    });
  });
});
