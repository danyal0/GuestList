import type { PrismaClient } from '@prisma/client';

type GroupRef = { id: string; name: string };

/**
 * Resolve which MKE Plays community owns WhatsApp-created events.
 *
 * Order:
 *   1) WHATSAPP_DEFAULT_GROUP_ID (exact cuid)
 *   2) WHATSAPP_DEFAULT_GROUP_SLUG
 *   3) Name match: WHATSAPP_DEFAULT_GROUP_NAME → WHATSAPP_GROUP_NAME → "Tennis"
 *   4) First public SPORTS group
 */
export async function resolveWhatsappDefaultGroup(
  prisma: PrismaClient,
): Promise<{ group: GroupRef | null; via: string }> {
  const id = (process.env.WHATSAPP_DEFAULT_GROUP_ID || '').trim();
  if (id) {
    const group = await prisma.group.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true },
    });
    if (group) return { group, via: 'WHATSAPP_DEFAULT_GROUP_ID' };
    console.warn(
      `[whatsapp] WHATSAPP_DEFAULT_GROUP_ID=${id} not found; trying name/slug fallbacks`,
    );
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
