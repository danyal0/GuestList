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
  buildEventDescription,
  inferEventCapacity,
  mergeNamedAttendees,
  preferPmForTennisHour,
  resolveCatalogVenue,
} from './whatsapp-event-enrich';
import {
  findOrCreateNamedAttendee,
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
    locationName?: string | null;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    venueSlug?: string | null;
    venueConfidence?: number | null;
    addressConfidence?: number | null;
    instructions?: string | null;
    notes?: string | null;
    skillLevel?: string | null;
    courtInfo?: string | null;
    durationMinutes?: number | null;
    capacity?: number | null;
    capacityConfidence?: number | null;
    namedAttendees?: string[] | null;
    timezone?: string | null;
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

    const venueClue = [
      body.venueSlug,
      body.locationName,
      body.venue,
      body.address,
      messageBody,
    ]
      .filter(Boolean)
      .join(' ');
    const catalogMatch = resolveCatalogVenue(venueClue);
    const catalog = catalogMatch?.venue ?? null;

    // Strict: prefer verified catalog. Only keep free-form AI place when it
    // includes a street address (digits) — never invent parks from thin air.
    const aiAddress = body.address?.trim() || null;
    const aiHasStreet = Boolean(aiAddress && /\d/.test(aiAddress));
    const venueConfidence =
      typeof body.venueConfidence === 'number' ? body.venueConfidence : null;
    const addressConfidence =
      typeof body.addressConfidence === 'number' ? body.addressConfidence : null;

    let venueId: string | null = null;
    if (catalog) {
      const upserted = await this.upsertCatalogVenue(catalog);
      venueId = upserted.id;
    }

    const locationName =
      catalog?.name ||
      (venueConfidence !== null && venueConfidence >= 0.85
        ? body.locationName?.trim() || body.venue?.trim() || null
        : null) ||
      process.env.WHATSAPP_DEFAULT_VENUE ||
      null;

    const address =
      catalog?.address ||
      (aiHasStreet && (addressConfidence === null || addressConfidence >= 0.85)
        ? aiAddress
        : null) ||
      locationName;

    const latitude =
      catalog?.latitude ??
      (typeof body.latitude === 'number' &&
      Number.isFinite(body.latitude) &&
      addressConfidence !== null &&
      addressConfidence >= 0.85
        ? body.latitude
        : null);
    const longitude =
      catalog?.longitude ??
      (typeof body.longitude === 'number' &&
      Number.isFinite(body.longitude) &&
      addressConfidence !== null &&
      addressConfidence >= 0.85
        ? body.longitude
        : null);

    const timezone =
      (body.timezone && body.timezone.trim()) ||
      process.env.WHATSAPP_DEFAULT_TIMEZONE ||
      'America/Chicago';

    const durationMinutes =
      (typeof body.durationMinutes === 'number' &&
      Number.isFinite(body.durationMinutes) &&
      body.durationMinutes > 0
        ? body.durationMinutes
        : null) ??
      Number(process.env.WHATSAPP_DEFAULT_EVENT_DURATION_MINUTES || '90');

    const { startTime, endTime } = resolveSchedule(body.suggestedTime, {
      timezone,
      durationMinutes,
      messageBody,
    });

    const notes = [
      // Only attach catalog notes (verified). Do not invent AI fluff.
      body.notes?.trim() || null,
      catalog?.notes || null,
    ]
      .filter(Boolean)
      .join('\n');

    // Instructions: only from the message/AI when present — no invented defaults.
    const instructions = body.instructions?.trim() || null;

    const namedAttendees = mergeNamedAttendees(
      body.namedAttendees,
      messageBody,
      [host.name, body.senderName ?? ''].filter(Boolean),
    );

    const capacity = inferEventCapacity({
      aiCapacity: body.capacity,
      capacityConfidence: body.capacityConfidence,
      courtInfo: body.courtInfo,
      messageBody,
      venue: catalog,
    });

    const description = buildEventDescription({
      messageBody,
      instructions,
      notes: notes || null,
      skillLevel: body.skillLevel,
      courtInfo: body.courtInfo,
      suggestedTime: body.suggestedTime,
      whatsappMessageId,
      capacity,
      namedAttendees,
    });

    this.logger.log(
      `Creating event "${title}" venue=${catalog?.slug ?? 'n/a'} capacity=${capacity ?? 'unlimited'} attendees=[${namedAttendees.join(',')}] @ ${locationName ?? 'n/a'} ${address ?? ''} ${startTime.toISOString()} (${timezone})`,
    );

    const event = await this.prisma.event.create({
      data: {
        groupId: group.id,
        hostId: host.id,
        venueId,
        title,
        description,
        mode: 'IN_PERSON',
        locationName,
        address,
        latitude,
        longitude,
        timezone,
        startTime,
        endTime,
        capacity,
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
        address: true,
        latitude: true,
        longitude: true,
        timezone: true,
        capacity: true,
        venueId: true,
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

    const autoRsvped: Array<{ id: string; name: string }> = [];
    for (const attendeeName of namedAttendees) {
      try {
        const person = await findOrCreateNamedAttendee(this.prisma, attendeeName);
        if (!person || person.id === host.id) continue;
        await this.prisma.rsvp.upsert({
          where: {
            eventId_userId: { eventId: event.id, userId: person.id },
          },
          create: {
            eventId: event.id,
            userId: person.id,
            status: 'GOING',
          },
          update: {
            status: 'GOING',
          },
        });
        autoRsvped.push({ id: person.id, name: person.name });
      } catch (err) {
        this.logger.warn(
          `Failed to auto-RSVP named attendee "${attendeeName}": ${(err as Error).message}`,
        );
      }
    }

    return { ok: true, event, namedAttendees: autoRsvped, capacity };
  }

  private async upsertCatalogVenue(catalog: {
    slug: string;
    name: string;
    sport: string;
    city: string;
    region: string;
    country: string;
    address: string;
    latitude: number;
    longitude: number;
    aliases: string[];
    notes?: string | null;
  }) {
    const existing = await this.prisma.venue.findUnique({
      where: { slug: catalog.slug },
      select: { id: true },
    });
    if (existing) {
      return this.prisma.venue.update({
        where: { id: existing.id },
        data: {
          name: catalog.name,
          sport: catalog.sport,
          city: catalog.city,
          region: catalog.region,
          country: catalog.country,
          address: catalog.address,
          latitude: catalog.latitude,
          longitude: catalog.longitude,
          aliases: catalog.aliases,
          notes: catalog.notes ?? null,
          source: 'catalog',
          verifiedAt: new Date(),
        },
        select: { id: true },
      });
    }
    return this.prisma.venue.create({
      data: {
        slug: catalog.slug,
        name: catalog.name,
        sport: catalog.sport,
        city: catalog.city,
        region: catalog.region,
        country: catalog.country,
        address: catalog.address,
        latitude: catalog.latitude,
        longitude: catalog.longitude,
        aliases: catalog.aliases,
        notes: catalog.notes ?? null,
        source: 'catalog',
        verifiedAt: new Date(),
      },
      select: { id: true },
    });
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

function resolveSchedule(
  suggestedTime: string | null | undefined,
  opts: { timezone: string; durationMinutes: number; messageBody?: string },
): { startTime: Date; endTime: Date } {
  const durationMs =
    (Number.isFinite(opts.durationMinutes) ? opts.durationMinutes : 90) *
    60 *
    1000;

  let start =
    tryParseIso(suggestedTime) ||
    tryParseCasualTennisTime(suggestedTime, opts.timezone) ||
    tryParseCasualTennisTime(opts.messageBody, opts.timezone);

  if (!start) {
    // Default: tomorrow 6pm America/Chicago (tennis-friendly), not 10am UTC.
    start = zonedLocalDate(opts.timezone, {
      dayOffset: 1,
      hour: 18,
      minute: 0,
    });
  }

  return {
    startTime: start,
    endTime: new Date(start.getTime() + durationMs),
  };
}

function tryParseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/\d/.test(trimmed)) return null;
  // Only treat as ISO/Date.parse when it looks like a real datetime, not "at 6".
  if (!/\d{4}-\d{2}-\d{2}/.test(trimmed) && !/T\d{2}:/.test(trimmed)) {
    return null;
  }
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Parse clues like "tomorrow at 6", "Sat 6pm", "6:30".
 * Bare hours 1–8 → PM for tennis unless am is explicit.
 */
function tryParseCasualTennisTime(
  value: string | null | undefined,
  timeZone: string,
): Date | null {
  if (!value) return null;
  const text = value.toLowerCase();

  const explicitAmPm = /\b(am|pm|a\.m\.|p\.m\.)\b/i.test(text);
  const timeMatch = text.match(
    /\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i,
  );
  if (!timeMatch) return null;

  let hour = Number(timeMatch[1]);
  const minute = timeMatch[2] ? Number(timeMatch[2]) : 0;
  const meridiem = (timeMatch[3] || '').toLowerCase().replace(/\./g, '');

  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;

  if (meridiem === 'pm' && hour < 12) hour += 12;
  else if (meridiem === 'am' && hour === 12) hour = 0;
  else if (!meridiem) {
    hour = preferPmForTennisHour(hour, false);
  }

  let dayOffset = 0;
  if (/\btomorrow\b/.test(text)) dayOffset = 1;
  else if (/\btoday\b/.test(text)) dayOffset = 0;
  else {
    const weekdays = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    for (let i = 0; i < weekdays.length; i += 1) {
      if (text.includes(weekdays[i]!) || text.includes(weekdays[i]!.slice(0, 3))) {
        const now = new Date();
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone,
          weekday: 'short',
        }).formatToParts(now);
        const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
        const map: Record<string, number> = {
          Sun: 0,
          Mon: 1,
          Tue: 2,
          Wed: 3,
          Thu: 4,
          Fri: 5,
          Sat: 6,
        };
        const current = map[wd] ?? now.getUTCDay();
        dayOffset = (i - current + 7) % 7 || 7;
        break;
      }
    }
    // "at 6" with no day → if that hour already passed today, use tomorrow.
    if (dayOffset === 0 && !/\btoday\b/.test(text)) {
      const candidate = zonedLocalDate(timeZone, { dayOffset: 0, hour, minute });
      if (candidate.getTime() < Date.now() - 5 * 60 * 1000) dayOffset = 1;
    }
  }

  return zonedLocalDate(timeZone, { dayOffset, hour, minute });
}

function zonedLocalDate(
  timeZone: string,
  parts: { dayOffset: number; hour: number; minute: number },
): Date {
  // Build "now" wall-clock in the target zone, then apply offsets.
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const bags = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const baseUtcGuess = Date.UTC(
    Number(bags.year),
    Number(bags.month) - 1,
    Number(bags.day) + parts.dayOffset,
    parts.hour,
    parts.minute,
    0,
  );

  // Correct for the zone offset at that instant.
  const asLocal = new Date(baseUtcGuess);
  const shiftedBags = Object.fromEntries(
    fmt.formatToParts(asLocal).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asLocalUtc = Date.UTC(
    Number(shiftedBags.year),
    Number(shiftedBags.month) - 1,
    Number(shiftedBags.day),
    Number(shiftedBags.hour),
    Number(shiftedBags.minute),
    Number(shiftedBags.second || '0'),
  );
  const offsetMs = asLocalUtc - baseUtcGuess;
  return new Date(baseUtcGuess - offsetMs);
}
