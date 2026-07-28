import type { PrismaService } from '../prisma/prisma.service';
import { digitsOnly } from './whatsapp-bot.guard';

export type WhatsappUserIdentity = {
  id: string;
  name: string;
  phone: string | null;
  whatsappLid: string | null;
};

/**
 * Resolve a MKE Plays user from WhatsApp sender identity.
 * Preference: whatsappLid → phone → endsWith phone.
 * When found, persist newly learned LID / phone / name links.
 */
export async function findOrLinkWhatsappUser(
  prisma: PrismaService,
  input: {
    senderPhone?: string | null;
    senderLid?: string | null;
    senderJid?: string | null;
    senderName?: string | null;
  },
): Promise<WhatsappUserIdentity | null> {
  const lid =
    digitsOnly(input.senderLid) ||
    (input.senderJid?.includes('@lid')
      ? digitsOnly(input.senderJid.split('@')[0])
      : null);
  let phone = digitsOnly(input.senderPhone);
  if (phone && lid && phone === lid) phone = null;

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

  if (!user) return null;

  const patch: { whatsappLid?: string; phone?: string; name?: string } = {};
  if (lid && !user.whatsappLid) patch.whatsappLid = lid;
  if (phone && !user.phone && phone.length >= 7 && phone.length <= 15) {
    patch.phone = phone;
  }
  const name = input.senderName?.trim();
  if (name && name.length >= 2 && name.length <= 80 && user.name !== name) {
    const placeholder =
      !user.name ||
      user.name.startsWith('WhatsApp ') ||
      user.name === phone ||
      user.name === lid;
    if (placeholder) patch.name = name;
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
