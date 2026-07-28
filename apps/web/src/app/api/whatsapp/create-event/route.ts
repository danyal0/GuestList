import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  isValidWhatsappBotToken,
  normalizePhone,
} from '@/lib/whatsapp-bot-auth';
import { resolveWhatsappDefaultGroup } from '@/lib/whatsapp-default-group';
import { findOrLinkWhatsappUser } from '@/lib/whatsapp-user-lookup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CreateEventBody = {
  senderPhone?: string;
  senderLid?: string | null;
  senderJid?: string | null;
  senderName?: string | null;
  messageBody?: string;
  whatsappMessageId?: string;
  title?: string | null;
  suggestedTime?: string | null;
  venue?: string | null;
  confidence?: number;
};

/**
 * POST /api/whatsapp/create-event
 *
 * Secured bridge endpoint used by `scripts/whatsapp-bot.js` when Grok
 * classifies a group message as CREATE_EVENT.
 */
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('x-whatsapp-bot-token');
    if (!isValidWhatsappBotToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as CreateEventBody;
    const senderPhone = normalizePhone(body.senderPhone ?? '');
    const senderLid = normalizePhone(body.senderLid ?? '');
    const messageBody = (body.messageBody ?? '').trim();
    const whatsappMessageId = String(body.whatsappMessageId ?? '').trim();

    if ((!senderPhone && !senderLid) || !whatsappMessageId) {
      return NextResponse.json(
        {
          error: 'whatsappMessageId and senderPhone or senderLid are required',
          missing: {
            senderPhone: !senderPhone,
            senderLid: !senderLid,
            whatsappMessageId: !whatsappMessageId,
          },
        },
        { status: 400 },
      );
    }

    // Idempotency: the same WhatsApp message must not create duplicate events.
    const existing = await prisma.event.findUnique({
      where: { whatsappMessageId },
      select: { id: true, title: true, whatsappMessageId: true },
    });
    if (existing) {
      return NextResponse.json({
        ok: true,
        deduped: true,
        event: existing,
      });
    }

    let host = await findOrLinkWhatsappUser(prisma, {
      senderPhone: senderPhone || null,
      senderLid: senderLid || null,
      senderJid: body.senderJid,
      senderName: body.senderName,
    });

    if (!host && process.env.WHATSAPP_DEFAULT_HOST_USER_ID) {
      host = await prisma.user.findFirst({
        where: {
          id: process.env.WHATSAPP_DEFAULT_HOST_USER_ID,
          deletedAt: null,
        },
        select: { id: true, name: true, phone: true, whatsappLid: true },
      });
      if (host) {
        console.warn(
          `[api/whatsapp/create-event] No user for lid/phone; using WHATSAPP_DEFAULT_HOST_USER_ID=${host.id}`,
        );
      }
    }

    if (!host) {
      return NextResponse.json(
        {
          error: 'No user found for WhatsApp sender',
          senderPhone: senderPhone || null,
          senderLid: senderLid || null,
          senderJid: body.senderJid ?? null,
          senderName: body.senderName ?? null,
          hint:
            'Sign up with your phone on MKE Plays, then message the group again so we can link your WhatsApp LID. Or set WHATSAPP_DEFAULT_HOST_USER_ID.',
        },
        { status: 404 },
      );
    }

    const { group, via: groupVia } = await resolveWhatsappDefaultGroup(prisma);
    if (!group) {
      return NextResponse.json(
        {
          error: 'No MKE Plays group available for WhatsApp events',
          hint:
            'Create a tennis/sports community, or set WHATSAPP_DEFAULT_GROUP_ID (cuid), WHATSAPP_DEFAULT_GROUP_SLUG, or WHATSAPP_DEFAULT_GROUP_NAME.',
        },
        { status: 500 },
      );
    }
    if (groupVia !== 'WHATSAPP_DEFAULT_GROUP_ID') {
      console.warn(
        `[api/whatsapp/create-event] Using group "${group.name}" (${group.id}) via ${groupVia}. Set WHATSAPP_DEFAULT_GROUP_ID to pin it.`,
      );
    }

    const title =
      (body.title && body.title.trim()) ||
      deriveTitleFromMessage(messageBody) ||
      'Tennis match';

    const venue =
      (body.venue && body.venue.trim()) ||
      process.env.WHATSAPP_DEFAULT_VENUE ||
      null;

    const { startTime, endTime } = resolveSchedule(body.suggestedTime);
    const description = [
      messageBody || 'Match proposed via WhatsApp.',
      body.suggestedTime ? `Suggested time clue: ${body.suggestedTime}` : null,
      `Source: WhatsApp message ${whatsappMessageId}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const event = await prisma.event.create({
      data: {
        groupId: group.id,
        hostId: host.id,
        title,
        description,
        mode: 'IN_PERSON',
        locationName: venue,
        address: venue,
        timezone: process.env.WHATSAPP_DEFAULT_TIMEZONE || 'UTC',
        startTime,
        endTime,
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        whatsappMessageId,
      },
      select: {
        id: true,
        title: true,
        startTime: true,
        endTime: true,
        locationName: true,
        whatsappMessageId: true,
        hostId: true,
        groupId: true,
      },
    });

    // Auto-RSVP the host as GOING.
    await prisma.rsvp.upsert({
      where: {
        eventId_userId: { eventId: event.id, userId: host.id },
      },
      create: {
        eventId: event.id,
        userId: host.id,
        status: 'GOING',
      },
      update: {
        status: 'GOING',
      },
    });

    return NextResponse.json({ ok: true, event }, { status: 201 });
  } catch (err) {
    console.error('[api/whatsapp/create-event]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

function deriveTitleFromMessage(messageBody: string): string | null {
  const trimmed = messageBody.trim();
  if (!trimmed) return null;
  const firstLine = trimmed.split(/\n/)[0]!.trim();
  if (firstLine.length <= 80) return firstLine;
  return `${firstLine.slice(0, 77)}…`;
}

function resolveSchedule(suggestedTime: string | null | undefined): {
  startTime: Date;
  endTime: Date;
} {
  const durationMinutes = Number(
    process.env.WHATSAPP_DEFAULT_EVENT_DURATION_MINUTES || '90',
  );
  const durationMs =
    (Number.isFinite(durationMinutes) ? durationMinutes : 90) * 60 * 1000;

  let start = tryParseDate(suggestedTime);

  if (!start) {
    // Default: tomorrow at 10:00 UTC (or WHATSAPP_DEFAULT_HOUR).
    const hour = Number(process.env.WHATSAPP_DEFAULT_HOUR || '10');
    start = new Date();
    start.setUTCDate(start.getUTCDate() + 1);
    start.setUTCHours(Number.isFinite(hour) ? hour : 10, 0, 0, 0);
  }

  return {
    startTime: start,
    endTime: new Date(start.getTime() + durationMs),
  };
}

function tryParseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}
