import type { PrismaService } from '../prisma/prisma.service';
import { digitsOnly } from './whatsapp-bot.guard';

export type WhatsappUserIdentity = {
  id: string;
  name: string;
  phone: string | null;
  whatsappLid: string | null;
};

function isPlausiblePhone(digits: string): boolean {
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * Resolve a MKE Plays user from WhatsApp sender identity.
 * Preference: whatsappLid → phone → endsWith phone.
 * When found, persist newly learned LID / phone / name links.
 * When missing but we have a phone and/or LID, auto-create a lightweight
 * account so events/RSVPs work without a prior web signup (claimable later
 * by signing up with the same phone).
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

  let user: WhatsappUserIdentity | null = null;

  if (lid) {
    user = await prisma.user.findFirst({
      where: { whatsappLid: lid, deletedAt: null },
      select: { id: true, name: true, phone: true, whatsappLid: true },
    });
  }

  if (!user && phone) {
    user = await prisma.user.findFirst({
      where: {
        OR: [{ phone }, { phone: { endsWith: phone } }],
        deletedAt: null,
      },
      select: { id: true, name: true, phone: true, whatsappLid: true },
    });
  }

  if (!user) {
    if (!autoCreate || (!phone && !lid)) return null;

    const displayName =
      (nameHint && nameHint.length >= 2 && nameHint.length <= 80
        ? nameHint
        : null) ||
      (phone ? `WhatsApp ${phone.slice(-4)}` : `WhatsApp ${lid!.slice(-6)}`);

    user = await prisma.user.create({
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

    return user;
  }

  const patch: { whatsappLid?: string; phone?: string; name?: string } = {};
  if (lid && !user.whatsappLid) patch.whatsappLid = lid;
  if (phone && !user.phone && isPlausiblePhone(phone)) {
    patch.phone = phone;
  }
  if (nameHint && nameHint.length >= 2 && nameHint.length <= 80 && user.name !== nameHint) {
    const placeholder =
      !user.name ||
      user.name.startsWith('WhatsApp ') ||
      user.name === phone ||
      user.name === lid;
    if (placeholder) patch.name = nameHint;
  }

  if (Object.keys(patch).length > 0) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: patch,
      select: { id: true, name: true, phone: true, whatsappLid: true },
    });
  }

  return user;
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
