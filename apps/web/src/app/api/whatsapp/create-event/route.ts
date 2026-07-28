import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  isValidWhatsappBotToken,
  normalizePhone,
} from '@/lib/whatsapp-bot-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CreateEventBody = {
  senderPhone?: string;
  senderJid?: string | null;
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
    const messageBody = (body.messageBody ?? '').trim();
    const whatsappMessageId = String(body.whatsappMessageId ?? '').trim();

    if (!senderPhone || !whatsappMessageId) {
      return NextResponse.json(
        {
          error: 'senderPhone and whatsappMessageId are required',
          missing: {
            senderPhone: !senderPhone,
            whatsappMessageId: !whatsappMessageId,
          },
        },
        { status: 400 },
      );
    }

    const defaultGroupId = process.env.WHATSAPP_DEFAULT_GROUP_ID;
    if (!defaultGroupId) {
      return NextResponse.json(
        { error: 'WHATSAPP_DEFAULT_GROUP_ID is not configured' },
        { status: 500 },
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

    let host = await prisma.user.findFirst({
      where: {
        OR: [
          { phone: senderPhone },
          // Allow stored values that still include a leading "+" / formatting.
          { phone: { endsWith: senderPhone } },
        ],
        deletedAt: null,
      },
      select: { id: true, name: true, phone: true },
    });

    if (!host && process.env.WHATSAPP_DEFAULT_HOST_USER_ID) {
      host = await prisma.user.findFirst({
        where: {
          id: process.env.WHATSAPP_DEFAULT_HOST_USER_ID,
          deletedAt: null,
        },
        select: { id: true, name: true, phone: true },
      });
      if (host) {
        console.warn(
          `[api/whatsapp/create-event] No user for phone=${senderPhone}; using WHATSAPP_DEFAULT_HOST_USER_ID=${host.id}`,
        );
      }
    }

    if (!host) {
      return NextResponse.json(
        {
          error: 'No user found for senderPhone',
          senderPhone,
          senderJid: body.senderJid ?? null,
          hint:
            'Set User.phone to this senderPhone value (WhatsApp may send a @lid id, not a real phone). Or set WHATSAPP_DEFAULT_HOST_USER_ID as a fallback host.',
        },
        { status: 404 },
      );
    }

    const group = await prisma.group.findFirst({
      where: { id: defaultGroupId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!group) {
      return NextResponse.json(
        { error: 'WHATSAPP_DEFAULT_GROUP_ID does not match an existing group' },
        { status: 500 },
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
