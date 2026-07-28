import type { PrismaService } from '../prisma/prisma.service';
import { digitsOnly } from './whatsapp-bot.guard';

export type WhatsappUserIdentity = {
  id: string;
  name: string;
  phone: string | null;
  whatsappLid: string | null;
};

type UserRow = WhatsappUserIdentity & {
  passwordHash?: string | null;
  email?: string | null;
  deletedAt?: Date | null;
};

function isPlausiblePhone(digits: string): boolean {
  return digits.length >= 7 && digits.length <= 15;
}

const identitySelect = {
  id: true,
  name: true,
  phone: true,
  whatsappLid: true,
  passwordHash: true,
  email: true,
  deletedAt: true,
} as const;

function toIdentity(user: UserRow): WhatsappUserIdentity {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    whatsappLid: user.whatsappLid,
  };
}

/**
 * Prefer the account that can log into the web app; otherwise keep the LID row.
 */
export function pickSurvivor(a: UserRow, b: UserRow): { survivor: UserRow; loser: UserRow } {
  const aHasPass = Boolean(a.passwordHash);
  const bHasPass = Boolean(b.passwordHash);
  if (aHasPass && !bHasPass) return { survivor: a, loser: b };
  if (bHasPass && !aHasPass) return { survivor: b, loser: a };
  // Both (or neither) have passwords — prefer the one that already has a LID.
  if (a.whatsappLid && !b.whatsappLid) return { survivor: a, loser: b };
  if (b.whatsappLid && !a.whatsappLid) return { survivor: b, loser: a };
  // Stable: keep the older-looking id lexicographically (cuid/random — either is fine).
  return a.id <= b.id ? { survivor: a, loser: b } : { survivor: b, loser: a };
}

/**
 * Fold loser into survivor: move events/RSVPs, copy phone/LID/name, soft-delete loser.
 */
export async function mergeWhatsappUsers(
  prisma: PrismaService,
  survivor: UserRow,
  loser: UserRow,
  extras: { phone?: string | null; lid?: string | null; name?: string | null },
): Promise<WhatsappUserIdentity> {
  if (survivor.id === loser.id) return toIdentity(survivor);

  await prisma.event.updateMany({
    where: { hostId: loser.id },
    data: { hostId: survivor.id },
  });

  const loserRsvps = await prisma.rsvp.findMany({
    where: { userId: loser.id },
    select: { id: true, eventId: true, status: true },
  });
  for (const rsvp of loserRsvps) {
    await prisma.rsvp.upsert({
      where: {
        eventId_userId: { eventId: rsvp.eventId, userId: survivor.id },
      },
      create: {
        eventId: rsvp.eventId,
        userId: survivor.id,
        status: rsvp.status,
      },
      update: { status: rsvp.status },
    });
    await prisma.rsvp.delete({ where: { id: rsvp.id } });
  }

  // Free unique phone/LID on loser before writing them onto survivor.
  await prisma.user.update({
    where: { id: loser.id },
    data: {
      deletedAt: new Date(),
      phone: null,
      whatsappLid: null,
      email: `merged-${loser.id}@deleted.mkeplays.app`,
      passwordHash: null,
      name: 'Merged WhatsApp identity',
    },
  });

  const phone =
    extras.phone || survivor.phone || loser.phone || null;
  const lid = extras.lid || survivor.whatsappLid || loser.whatsappLid || null;
  let name = survivor.name;
  const nameHint = extras.name?.trim();
  if (
    nameHint &&
    nameHint.length >= 2 &&
    nameHint.length <= 80 &&
    (survivor.name.startsWith('WhatsApp ') ||
      !survivor.passwordHash ||
      survivor.name === survivor.phone)
  ) {
    name = nameHint;
  } else if (
    loser.name &&
    !loser.name.startsWith('WhatsApp ') &&
    survivor.name.startsWith('WhatsApp ')
  ) {
    name = loser.name;
  }

  const updated = await prisma.user.update({
    where: { id: survivor.id },
    data: {
      phone,
      whatsappLid: lid,
      name,
      deletedAt: null,
    },
    select: { id: true, name: true, phone: true, whatsappLid: true },
  });

  return updated;
}

/**
 * Resolve a MKE Plays user from WhatsApp sender identity.
 *
 * - LID-only → find or auto-create (phone optional)
 * - Phone-only → find or auto-create
 * - Both → find each; if two different users, merge into one and keep LID+phone
 * - Signup later with phone claims passwordless WhatsApp users; next WhatsApp
 *   message with LID links/merges into that account.
 */
export async function findOrLinkWhatsappUser(
  prisma: PrismaService,
  input: {
    senderPhone?: string | null;
    senderLid?: string | null;
    senderJid?: string | null;
    senderName?: string | null;
    /** When true (default), create a user if none matches. */
    autoCreate?: boolean;
  },
): Promise<WhatsappUserIdentity | null> {
  const lid =
    digitsOnly(input.senderLid) ||
    (input.senderJid?.includes('@lid')
      ? digitsOnly(input.senderJid.split('@')[0])
      : null);
  let phone = digitsOnly(input.senderPhone);
  if (phone && lid && phone === lid) phone = null;
  if (phone && !isPlausiblePhone(phone)) phone = null;

  const autoCreate = input.autoCreate !== false;
  const nameHint = input.senderName?.trim() || null;

  let byLid: UserRow | null = null;
  let byPhone: UserRow | null = null;

  if (lid) {
    byLid = await prisma.user.findFirst({
      where: { whatsappLid: lid, deletedAt: null },
      select: identitySelect,
    });
  }

  if (phone) {
    byPhone = await prisma.user.findFirst({
      where: {
        OR: [{ phone }, { phone: { endsWith: phone } }],
        deletedAt: null,
      },
      select: identitySelect,
    });
  }

  // Two different accounts for the same person → merge.
  if (byLid && byPhone && byLid.id !== byPhone.id) {
    const { survivor, loser } = pickSurvivor(byLid, byPhone);
    return mergeWhatsappUsers(prisma, survivor, loser, {
      phone,
      lid,
      name: nameHint,
    });
  }

  let user: UserRow | null = byLid || byPhone;

  if (!user) {
    if (!autoCreate || (!phone && !lid)) return null;

    const displayName =
      (nameHint && nameHint.length >= 2 && nameHint.length <= 80
        ? nameHint
        : null) ||
      (phone ? `WhatsApp ${phone.slice(-4)}` : `WhatsApp ${lid!.slice(-6)}`);

    const created = await prisma.user.create({
      data: {
        name: displayName,
        phone: phone ?? null,
        whatsappLid: lid ?? null,
        email: null,
        passwordHash: null,
        deletedAt: null,
        suspendedAt: null,
      },
      select: { id: true, name: true, phone: true, whatsappLid: true },
    });

    return created;
  }

  const patch: { whatsappLid?: string; phone?: string; name?: string } = {};
  if (lid && user.whatsappLid !== lid) patch.whatsappLid = lid;
  if (phone && user.phone !== phone) patch.phone = phone;
  if (nameHint && nameHint.length >= 2 && nameHint.length <= 80 && user.name !== nameHint) {
    const placeholder =
      !user.name ||
      user.name.startsWith('WhatsApp ') ||
      user.name === user.phone ||
      user.name === lid;
    if (placeholder) patch.name = nameHint;
  }

  if (Object.keys(patch).length > 0) {
    try {
      user = await prisma.user.update({
        where: { id: user.id },
        data: patch,
        select: identitySelect,
      });
    } catch {
      user = await prisma.user.findFirstOrThrow({
        where: { id: user.id },
        select: identitySelect,
      });
    }
  }

  return toIdentity(user);
}

/**
 * Find an active user by display name for WhatsApp auto-RSVP.
 * Prefer exact match; only fall back to startsWith for longer names.
 * Never use loose contains — that can attach RSVPs to the wrong person.
 */
export async function findUserByDisplayName(
  prisma: PrismaService,
  rawName: string,
): Promise<WhatsappUserIdentity | null> {
  const name = rawName.trim();
  if (name.length < 2 || name.length > 80) return null;

  const exact = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      name: { equals: name, mode: 'insensitive' },
    },
    select: { id: true, name: true, phone: true, whatsappLid: true },
  });
  if (exact) return exact;

  // "Khatera J." style — only when the query is a clear first token (≥3 chars).
  if (name.length >= 3 && !/\s/.test(name)) {
    const starts = await prisma.user.findFirst({
      where: {
        deletedAt: null,
        name: { startsWith: name, mode: 'insensitive' },
      },
      select: { id: true, name: true, phone: true, whatsappLid: true },
    });
    if (starts) return starts;
  }

  return null;
}

export const NAMED_PLACEHOLDER_EMAIL_DOMAIN = '@wa.mkeplays.app';

type PlaceholderRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsappLid: string | null;
  passwordHash?: string | null;
};

/** Passwordless WhatsApp-named attendee (no phone/LID yet). */
export function isNamedPlaceholder(user: {
  email?: string | null;
  phone?: string | null;
  whatsappLid?: string | null;
  passwordHash?: string | null;
  deletedAt?: Date | null;
}): boolean {
  if (user.deletedAt) return false;
  if (user.passwordHash) return false;
  if (user.phone) return false;
  // LID-only WhatsApp users are real bridge identities — not name placeholders.
  if (user.whatsappLid) return false;
  const email = (user.email ?? '').toLowerCase();
  // Canonical named-*@wa.mkeplays.app placeholders.
  if (email.endsWith(NAMED_PLACEHOLDER_EMAIL_DOMAIN) && email.startsWith('named-')) {
    return true;
  }
  // Legacy / partial rows: passwordless shell with no contact identifiers.
  // Still claimable when email is missing but the account was only used for RSVPs.
  if (!email) return true;
  return email.startsWith('named-') || email.endsWith(NAMED_PLACEHOLDER_EMAIL_DOMAIN);
}

export type NamedProfileClue = {
  eventId: string;
  title: string;
  startTime: Date;
  venueName: string | null;
  locationName: string | null;
  hostName: string | null;
  /** One-line human clue for the signup UI. */
  summary: string;
};

export type NamedProfileLinkSuggestion = {
  userId: string;
  name: string;
  clues: NamedProfileClue[];
};

function formatClueTime(date: Date): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Chicago',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function formatNamedProfileClueSummary(parts: {
  title: string;
  startTime: Date;
  venueName?: string | null;
  locationName?: string | null;
  hostName?: string | null;
}): string {
  const place =
    parts.venueName?.trim() ||
    parts.locationName?.trim() ||
    'a Milwaukee tennis meetup';
  const when = formatClueTime(parts.startTime);
  const host = parts.hostName?.trim();
  if (host) {
    return `You played “${parts.title}” at ${place} on ${when}, hosted by ${host}`;
  }
  return `You played “${parts.title}” at ${place} on ${when}`;
}

export async function buildNamedProfileClues(
  prisma: PrismaService,
  userId: string,
  limit = 5,
): Promise<NamedProfileClue[]> {
  const rsvps = await prisma.rsvp.findMany({
    where: {
      userId,
      status: { in: ['GOING', 'WAITLISTED', 'INTERESTED'] },
    },
    orderBy: { createdAt: 'desc' },
    take: Math.max(limit * 3, 15),
    include: {
      event: {
        select: {
          id: true,
          title: true,
          startTime: true,
          locationName: true,
          venue: { select: { name: true } },
          host: { select: { name: true } },
        },
      },
    },
  });

  const clues = rsvps.map((r) => {
    const venueName = r.event.venue?.name ?? null;
    const locationName = r.event.locationName ?? null;
    const hostName = r.event.host?.name ?? null;
    return {
      eventId: r.event.id,
      title: r.event.title,
      startTime: r.event.startTime,
      venueName,
      locationName,
      hostName,
      summary: formatNamedProfileClueSummary({
        title: r.event.title,
        startTime: r.event.startTime,
        venueName,
        locationName,
        hostName,
      }),
    };
  });

  return clues
    .sort(
      (a, b) =>
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
    )
    .slice(0, limit);
}

/**
 * Find unclaimed named placeholders that match the signup display name
 * (exact full name, or same first token for "Khatera" vs "Khatera J.").
 */
export async function findNamedPlaceholderSuggestions(
  prisma: PrismaService,
  rawName: string,
  opts: { excludeUserId?: string; limit?: number } = {},
): Promise<NamedProfileLinkSuggestion[]> {
  const name = rawName.trim();
  if (name.length < 2) return [];
  const limit = opts.limit ?? 5;
  const firstToken = name.split(/\s+/)[0] ?? name;

  const rows = await prisma.user.findMany({
    where: {
      deletedAt: null,
      passwordHash: null,
      phone: null,
      whatsappLid: null,
      email: { endsWith: NAMED_PLACEHOLDER_EMAIL_DOMAIN },
      ...(opts.excludeUserId ? { id: { not: opts.excludeUserId } } : {}),
      OR: [
        { name: { equals: name, mode: 'insensitive' } },
        ...(firstToken.length >= 3
          ? [
              { name: { equals: firstToken, mode: 'insensitive' as const } },
              {
                name: {
                  startsWith: `${firstToken} `,
                  mode: 'insensitive' as const,
                },
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      whatsappLid: true,
      passwordHash: true,
    },
    take: 20,
  });

  const placeholders = rows.filter((u) => isNamedPlaceholder(u as PlaceholderRow));
  const suggestions: NamedProfileLinkSuggestion[] = [];
  for (const placeholder of placeholders) {
    const clues = await buildNamedProfileClues(prisma, placeholder.id);
    // Only suggest when there is history to reclaim (RSVPs from WhatsApp).
    if (clues.length === 0) continue;
    suggestions.push({
      userId: placeholder.id,
      name: placeholder.name,
      clues,
    });
    if (suggestions.length >= limit) break;
  }
  return suggestions;
}

/**
 * Fold a named placeholder into the signed-up account (RSVPs, hosted events).
 * Survivor keeps password/phone; any future WhatsApp LID still links via existing flows.
 */
export async function claimNamedPlaceholder(
  prisma: PrismaService,
  survivorId: string,
  placeholderId: string,
): Promise<WhatsappUserIdentity> {
  if (survivorId === placeholderId) {
    throw new Error('Cannot claim your own profile');
  }

  const [survivor, placeholder] = await Promise.all([
    prisma.user.findFirst({
      where: { id: survivorId, deletedAt: null },
      select: identitySelect,
    }),
    prisma.user.findFirst({
      where: { id: placeholderId, deletedAt: null },
      select: identitySelect,
    }),
  ]);

  if (!survivor) throw new Error('Account not found');
  if (!placeholder) {
    throw new Error('No matching unclaimed profile found');
  }
  if (!isNamedPlaceholder(placeholder)) {
    throw new Error(
      'That profile is already linked to a phone, WhatsApp, or password account',
    );
  }
  if (!survivor.passwordHash) {
    throw new Error('Sign up fully before linking a prior profile');
  }

  return mergeWhatsappUsers(prisma, survivor, placeholder, {
    phone: survivor.phone,
    lid: survivor.whatsappLid,
    name: survivor.name,
  });
}

/**
 * Create a lightweight placeholder account for a named WhatsApp attendee
 * who is not yet on MKE Plays — so "Khatera is going" still shows 2 going.
 * OK with no phone / LID; signup later can claim this profile by name + clues.
 */
export async function findOrCreateNamedAttendee(
  prisma: PrismaService,
  rawName: string,
): Promise<WhatsappUserIdentity | null> {
  const name = rawName.trim();
  if (name.length < 2 || name.length > 80) return null;

  // Prefer an existing exact-name placeholder so history stays on one row.
  const placeholder = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      passwordHash: null,
      phone: null,
      whatsappLid: null,
      email: { endsWith: NAMED_PLACEHOLDER_EMAIL_DOMAIN },
      name: { equals: name, mode: 'insensitive' },
    },
    select: identitySelect,
  });
  if (placeholder && isNamedPlaceholder(placeholder)) {
    return toIdentity(placeholder);
  }

  const existing = await findUserByDisplayName(prisma, name);
  if (existing) return existing;

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);

  const created = await prisma.user.create({
    data: {
      name,
      phone: null,
      whatsappLid: null,
      email: `named-${slug || 'attendee'}-${Date.now().toString(36)}${NAMED_PLACEHOLDER_EMAIL_DOMAIN}`,
      passwordHash: null,
      deletedAt: null,
      suspendedAt: null,
    },
    select: { id: true, name: true, phone: true, whatsappLid: true },
  });
  return created;
}

export type GroupRef = { id: string; name: string };

/**
 * Resolve which community owns WhatsApp-created events.
 * Works in file mode (no DATABASE_URL) and Postgres.
 */
export async function resolveWhatsappDefaultGroup(
  prisma: PrismaService,
): Promise<{ group: GroupRef | null; via: string }> {
  const id = (process.env.WHATSAPP_DEFAULT_GROUP_ID || '').trim();
  if (id) {
    const group = await prisma.group.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true },
    });
    if (group) return { group, via: 'WHATSAPP_DEFAULT_GROUP_ID' };
  }

  const slug = (process.env.WHATSAPP_DEFAULT_GROUP_SLUG || '').trim();
  if (slug) {
    const group = await prisma.group.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true, name: true },
    });
    if (group) return { group, via: 'WHATSAPP_DEFAULT_GROUP_SLUG' };
  }

  const nameCandidates = [
    process.env.WHATSAPP_DEFAULT_GROUP_NAME,
    process.env.WHATSAPP_GROUP_NAME,
    'Tennis',
  ]
    .map((v) => (v || '').trim())
    .filter(Boolean);

  for (const name of nameCandidates) {
    const group = await prisma.group.findFirst({
      where: {
        deletedAt: null,
        name: { contains: name, mode: 'insensitive' },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
    if (group) return { group, via: `name:${name}` };
  }

  const sports = await prisma.group.findFirst({
    where: {
      deletedAt: null,
      category: 'SPORTS',
      privacy: 'PUBLIC',
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });
  if (sports) return { group: sports, via: 'category:SPORTS' };

  return { group: null, via: 'none' };
}
