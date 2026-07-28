import type { PrismaClient } from '@prisma/client';

type UserIdentity = {
  id: string;
  name: string;
  phone: string | null;
  whatsappLid: string | null;
};

function digitsOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = value.replace(/\D/g, '');
  return d.length ? d : null;
}

/**
 * Resolve a MKE Plays user from WhatsApp sender identity.
 * Preference: whatsappLid → phone → endsWith phone.
 * When found by phone and a LID is provided, persist the LID link.
 */
export async function findOrLinkWhatsappUser(
  prisma: PrismaClient,
  input: {
    senderPhone?: string | null;
    senderLid?: string | null;
    senderJid?: string | null;
    senderName?: string | null;
  },
): Promise<UserIdentity | null> {
  const lid =
    digitsOnly(input.senderLid) ||
    (input.senderJid?.includes('@lid')
      ? digitsOnly(input.senderJid.split('@')[0])
      : null);
  let phone = digitsOnly(input.senderPhone);
  // Never treat a LID local-part as a phone number.
  if (phone && lid && phone === lid) phone = null;

  let user: UserIdentity | null = null;

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

  // Link LID ↔ phone (and refresh name) when we learned something new.
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
