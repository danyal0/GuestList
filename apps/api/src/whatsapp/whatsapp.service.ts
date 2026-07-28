import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { digitsOnly } from './whatsapp-bot.guard';
import {
  findOrLinkWhatsappUser,
  resolveWhatsappDefaultGroup,
} from './whatsapp-identity';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createEvent(body: {
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
  }) {
    const senderPhone = digitsOnly(body.senderPhone) ?? '';
    const senderLid = digitsOnly(body.senderLid) ?? '';
    const messageBody = (body.messageBody ?? '').trim();
    const whatsappMessageId = String(body.whatsappMessageId ?? '').trim();

    if ((!senderPhone && !senderLid) || !whatsappMessageId) {
      throw new BadRequestException({
        error: 'whatsappMessageId and senderPhone or senderLid are required',
        missing: {
          senderPhone: !senderPhone,
          senderLid: !senderLid,
          whatsappMessageId: !whatsappMessageId,
        },
      });
    }

    const existing = await this.prisma.event.findUnique({
      where: { whatsappMessageId },
      select: { id: true, title: true, whatsappMessageId: true },
    });
    if (existing) {
      return { ok: true, deduped: true, event: existing };
    }

    let host = await findOrLinkWhatsappUser(this.prisma, {
      senderPhone: senderPhone || null,
      senderLid: senderLid || null,
      senderJid: body.senderJid,
      senderName: body.senderName,
      autoCreate: true,
    });

    if (host) {
      this.logger.log(
        `Resolved host ${host.id} phone=${host.phone ?? 'n/a'} lid=${host.whatsappLid ?? 'n/a'}`,
      );
    }

    if (!host && process.env.WHATSAPP_DEFAULT_HOST_USER_ID) {
      host = await this.prisma.user.findFirst({
        where: {
          id: process.env.WHATSAPP_DEFAULT_HOST_USER_ID,
          deletedAt: null,
        },
        select: { id: true, name: true, phone: true, whatsappLid: true },
      });
      if (host) {
        this.logger.warn(
          `No user for lid/phone; using WHATSAPP_DEFAULT_HOST_USER_ID=${host.id}`,
        );
      }
    }

    if (!host) {
      throw new NotFoundException({
        error: 'No user found for WhatsApp sender',
        senderPhone: senderPhone || null,
        senderLid: senderLid || null,
        senderJid: body.senderJid ?? null,
        senderName: body.senderName ?? null,
        hint:
          'Sign up with your phone on MKE Plays, then message the group again so we can link your WhatsApp LID. Or set WHATSAPP_DEFAULT_HOST_USER_ID.',
      });
    }

    const { group, via: groupVia } = await resolveWhatsappDefaultGroup(this.prisma);
    if (!group) {
      throw new ServiceUnavailableException({
        error: 'No MKE Plays group available for WhatsApp events',
        hint:
          'Create a tennis/sports community, or set WHATSAPP_DEFAULT_GROUP_ID / SLUG / NAME. File mode ships with a SPORTS group in mock-db.json.',
      });
    }
    if (groupVia !== 'WHATSAPP_DEFAULT_GROUP_ID') {
      this.logger.warn(
        `Using group "${group.name}" (${group.id}) via ${groupVia}. Set WHATSAPP_DEFAULT_GROUP_ID to pin it.`,
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

    const event = await this.prisma.event.create({
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

    await this.prisma.rsvp.upsert({
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

    return { ok: true, event };
  }

  async rsvp(body: {
    whatsappMessageId?: string;
    reactorPhone?: string;
    reactorLid?: string | null;
    reactorJid?: string | null;
    status?: string;
    confidence?: number;
  }) {
    const whatsappMessageId = (body.whatsappMessageId ?? '').trim();
    const reactorPhone = digitsOnly(body.reactorPhone) ?? '';
    const reactorLid = digitsOnly(body.reactorLid) ?? '';
    const status = body.status;

    if (!whatsappMessageId || (!reactorPhone && !reactorLid)) {
      throw new BadRequestException(
        'whatsappMessageId and reactorPhone or reactorLid are required',
      );
    }

    if (status !== 'attending' && status !== 'cancelled') {
      throw new BadRequestException('status must be "attending" or "cancelled"');
    }

    const event = await this.prisma.event.findUnique({
      where: { whatsappMessageId },
      select: {
        id: true,
        title: true,
        status: true,
        whatsappMessageId: true,
      },
    });

    if (!event) {
      throw new NotFoundException({
        error: 'No event found for whatsappMessageId',
        whatsappMessageId,
      });
    }

    if (event.status === 'CANCELLED' || event.status === 'COMPLETED') {
      throw new ConflictException({
        error: `Event is ${event.status.toLowerCase()} and no longer accepts RSVPs`,
        eventId: event.id,
      });
    }

    const user = await findOrLinkWhatsappUser(this.prisma, {
      senderPhone: reactorPhone || null,
      senderLid: reactorLid || null,
      senderJid: body.reactorJid,
    });

    if (!user) {
      throw new NotFoundException({
        error: 'No user found for WhatsApp reactor',
        reactorPhone: reactorPhone || null,
        reactorLid: reactorLid || null,
        hint: 'Sign up with your phone on MKE Plays so we can link your WhatsApp identity.',
      });
    }

    if (status === 'attending') {
      const rsvp = await this.prisma.rsvp.upsert({
        where: {
          eventId_userId: { eventId: event.id, userId: user.id },
        },
        create: {
          eventId: event.id,
          userId: user.id,
          status: 'GOING',
        },
        update: {
          status: 'GOING',
        },
        select: {
          id: true,
          eventId: true,
          userId: true,
          status: true,
        },
      });

      return {
        ok: true,
        action: 'attending',
        event: { id: event.id, title: event.title },
        rsvp,
      };
    }

    const existing = await this.prisma.rsvp.findUnique({
      where: {
        eventId_userId: { eventId: event.id, userId: user.id },
      },
      select: { id: true },
    });

    if (!existing) {
      const rsvp = await this.prisma.rsvp.create({
        data: {
          eventId: event.id,
          userId: user.id,
          status: 'DECLINED',
        },
        select: {
          id: true,
          eventId: true,
          userId: true,
          status: true,
        },
      });

      return {
        ok: true,
        action: 'cancelled',
        event: { id: event.id, title: event.title },
        rsvp,
      };
    }

    const rsvp = await this.prisma.rsvp.update({
      where: {
        eventId_userId: { eventId: event.id, userId: user.id },
      },
      data: { status: 'DECLINED' },
      select: {
        id: true,
        eventId: true,
        userId: true,
        status: true,
      },
    });

    return {
      ok: true,
      action: 'cancelled',
      event: { id: event.id, title: event.title },
      rsvp,
    };
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
