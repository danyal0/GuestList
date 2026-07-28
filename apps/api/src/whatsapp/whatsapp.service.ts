import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationType, RsvpStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFY_EVENT, NotifyPayload } from '../notifications/notification.events';
import { digitsOnly } from './whatsapp-bot.guard';
import {
  buildEventDescription,
  detectCancelCues,
  detectRescheduleCues,
  extractEventIdFromText,
  extractMapsUrls,
  hasPlaceCue,
  inferEventCapacity,
  mergeNamedAttendees,
  preferPmForTennisHour,
  resolveCatalogVenue,
  scoreRescheduleCandidate,
  type RescheduleCandidate,
} from './whatsapp-event-enrich';
import {
  findOrCreateNamedAttendee,
  findOrLinkWhatsappUser,
  resolveWhatsappDefaultGroup,
} from './whatsapp-identity';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createEvent(body: {
    senderPhone?: string;
    senderLid?: string | null;
    senderJid?: string | null;
    senderName?: string | null;
    messageBody?: string;
    whatsappMessageId?: string;
    /** Original invite message id when this message is a WhatsApp reply. */
    targetWhatsappMessageId?: string | null;
    /** In-app event id (from /events/:id link in quote or body). */
    targetEventId?: string | null;
    /** Text of the WhatsApp message being replied to. */
    quotedText?: string | null;
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
    /** 0–1 from AI: host is changing an existing plan. */
    rescheduleConfidence?: number | null;
    isReschedule?: boolean | null;
    /** 0–1 from AI/local: host is cancelling an existing plan. */
    cancelConfidence?: number | null;
    isCancel?: boolean | null;
  }) {
    const senderPhone = digitsOnly(body.senderPhone) ?? '';
    const senderLid = digitsOnly(body.senderLid) ?? '';
    const messageBody = (body.messageBody ?? '').trim();
    const whatsappMessageId = String(body.whatsappMessageId ?? '').trim();
    const targetWhatsappMessageId = String(
      body.targetWhatsappMessageId ?? '',
    ).trim();
    const quotedText = String(body.quotedText ?? '').trim();
    const targetEventId =
      String(body.targetEventId ?? '').trim() ||
      extractEventIdFromText(messageBody) ||
      extractEventIdFromText(quotedText) ||
      '';

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

    const cancelCueEarly = detectCancelCues(messageBody);
    const isCancelEarly =
      cancelCueEarly.matched ||
      Boolean(body.isCancel) ||
      (typeof body.cancelConfidence === 'number' && body.cancelConfidence >= 0.7);

    const venueClue = isCancelEarly
      ? [body.venueSlug, body.locationName, body.venue, body.address]
          .filter(Boolean)
          .join(' ')
      : [body.venueSlug, body.locationName, body.venue, body.address, messageBody]
          .filter(Boolean)
          .join(' ');
    // Cancel-only ("its cancelled") must not invent a catalog venue from the
    // message body — that poisons soft-matching against app-created events.
    const catalogMatch = venueClue.trim()
      ? resolveCatalogVenue(venueClue)
      : null;
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

    const locationName = isCancelEarly
      ? catalog?.name ||
        body.locationName?.trim() ||
        body.venue?.trim() ||
        null
      : catalog?.name ||
        (venueConfidence !== null && venueConfidence >= 0.85
          ? body.locationName?.trim() || body.venue?.trim() || null
          : null) ||
        process.env.WHATSAPP_DEFAULT_VENUE ||
        null;

    const address = isCancelEarly
      ? catalog?.address || (aiHasStreet ? aiAddress : null) || locationName
      : catalog?.address ||
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

    const mapsUrls = extractMapsUrls(messageBody);
    const cancelCue = detectCancelCues(messageBody);
    const cancelConfidence = Math.max(
      cancelCue.confidence,
      typeof body.cancelConfidence === 'number' ? body.cancelConfidence : 0,
      body.isCancel ? 0.9 : 0,
    );
    const rescheduleCue = detectRescheduleCues(messageBody);
    const rescheduleConfidence = Math.max(
      rescheduleCue.confidence,
      typeof body.rescheduleConfidence === 'number' ? body.rescheduleConfidence : 0,
      body.isReschedule ? 0.85 : 0,
      // A reply to an existing invite with a new time is usually an update.
      targetWhatsappMessageId && !cancelConfidence ? 0.75 : 0,
    );

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
      mapsUrls,
    });

    const eventSelect = {
      id: true,
      title: true,
      startTime: true,
      endTime: true,
      previousStartTime: true,
      rescheduledAt: true,
      status: true,
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
      description: true,
    } as const;

    const matchOpts = {
      hostId: host.id,
      groupId: group.id,
      targetWhatsappMessageId: targetWhatsappMessageId || null,
      targetEventId: targetEventId || null,
      quotedText: quotedText || null,
      venueId,
      locationName,
      address,
      startTime,
      messageBody,
      direction: rescheduleCue.direction,
      timezone,
      preferSingleCandidate: cancelConfidence >= 0.7,
    };

    // Cancel wins over create/reschedule — even when the message restates time/venue.
    if (cancelConfidence >= 0.7) {
      const match = await this.findUpdateTarget(matchOpts);
      if (match) {
        this.logger.log(
          `Cancel match event=${match.id} score=${match.score.toFixed(2)} cue="${cancelCue.matchedPhrase ?? 'ai'}" via=${targetWhatsappMessageId ? 'reply' : 'soft'}`,
        );
        const updatedDescription = appendWhatsappUpdate(
          match.description,
          messageBody,
          whatsappMessageId,
          mapsUrls,
        );
        const cancelled = await this.prisma.event.update({
          where: { id: match.id },
          data: {
            status: 'CANCELLED',
            description: updatedDescription,
          },
          select: eventSelect,
        });
        await this.notifyEventCancelled(cancelled, {
          message: `"${cancelled.title}" has been cancelled via WhatsApp.`,
          excludeUserId: host.id,
        });
        this.eventEmitter.emit('realtime.event.updated', {
          eventId: cancelled.id,
          event: cancelled,
        });
        return {
          ok: true,
          cancelled: true,
          event: cancelled,
          namedAttendees: [],
          capacity: cancelled.capacity,
        };
      }
      this.logger.log(
        `Cancel cues present (conf=${cancelConfidence}) but no matching event — not creating a new one`,
      );
      return {
        ok: true,
        cancelled: false,
        reason: 'no_matching_event',
        event: null,
      };
    }

    // Soft-match an existing plan when the host is rescheduling
    // ("earlier than planned", "moved to 6", reply to invite, etc.).
    if (rescheduleConfidence >= 0.7 || targetWhatsappMessageId) {
      const match = await this.findUpdateTarget(matchOpts);
      if (match) {
        this.logger.log(
          `Reschedule match event=${match.id} score=${match.score.toFixed(2)} cue="${rescheduleCue.matchedPhrase ?? (targetWhatsappMessageId ? 'reply' : 'ai')}" → ${startTime.toISOString()}`,
        );
        const previousStart = match.startTime;
        const updatedDescription = appendWhatsappUpdate(
          match.description,
          messageBody,
          whatsappMessageId,
          mapsUrls,
        );
        const updated = await this.prisma.event.update({
          where: { id: match.id },
          data: {
            title: title || match.title,
            description: updatedDescription,
            locationName: locationName ?? match.locationName,
            address: address ?? match.address,
            latitude: latitude ?? undefined,
            longitude: longitude ?? undefined,
            venueId: venueId ?? match.venueId,
            timezone,
            startTime,
            endTime,
            previousStartTime: previousStart,
            rescheduledAt: new Date(),
            ...(capacity != null ? { capacity } : {}),
          },
          select: eventSelect,
        });

        const autoRsvped = await this.rsvpNamedAttendees(
          updated.id,
          host.id,
          namedAttendees,
        );

        const scheduleChanged =
          previousStart.getTime() !== updated.startTime.getTime() ||
          match.locationName !== updated.locationName ||
          match.address !== updated.address;

        if (scheduleChanged) {
          await this.notifyEventUpdated(updated, {
            previousStart,
            message: buildRescheduleNotifyMessage(updated, previousStart),
            excludeUserId: host.id,
          });
          this.eventEmitter.emit('realtime.event.updated', {
            eventId: updated.id,
            event: updated,
          });
        }

        return {
          ok: true,
          updated: true,
          rescheduled: true,
          event: updated,
          namedAttendees: autoRsvped,
          capacity: updated.capacity,
        };
      }
      if (rescheduleConfidence >= 0.7) {
        this.logger.log(
          `Reschedule cues present (conf=${rescheduleConfidence}) but no strong candidate — creating new event`,
        );
      }
    }

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
      select: eventSelect,
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

    const autoRsvped = await this.rsvpNamedAttendees(
      event.id,
      host.id,
      namedAttendees,
    );

    return { ok: true, event, namedAttendees: autoRsvped, capacity };
  }

  private async rsvpNamedAttendees(
    eventId: string,
    hostId: string,
    namedAttendees: string[],
  ): Promise<Array<{ id: string; name: string }>> {
    const autoRsvped: Array<{ id: string; name: string }> = [];
    for (const attendeeName of namedAttendees) {
      try {
        const person = await findOrCreateNamedAttendee(this.prisma, attendeeName);
        if (!person || person.id === hostId) continue;
        await this.prisma.rsvp.upsert({
          where: {
            eventId_userId: { eventId, userId: person.id },
          },
          create: {
            eventId,
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
    return autoRsvped;
  }

  private async findUpdateTarget(opts: {
    hostId: string;
    groupId: string;
    targetWhatsappMessageId?: string | null;
    targetEventId?: string | null;
    quotedText?: string | null;
    venueId: string | null;
    locationName: string | null;
    address: string | null;
    startTime: Date;
    messageBody: string;
    direction: ReturnType<typeof detectRescheduleCues>['direction'];
    timezone: string;
    /** When cancelling, accept a single clear host event more readily. */
    preferSingleCandidate?: boolean;
  }): Promise<(RescheduleCandidate & { score: number }) | null> {
    const candidateSelect = {
      id: true,
      title: true,
      startTime: true,
      endTime: true,
      locationName: true,
      address: true,
      venueId: true,
      whatsappMessageId: true,
      description: true,
      capacity: true,
    } as const;

    if (opts.targetEventId) {
      const byId = await this.prisma.event.findFirst({
        where: {
          id: opts.targetEventId,
          status: 'PUBLISHED',
          hostId: opts.hostId,
        },
        select: candidateSelect,
      });
      if (byId) {
        this.logger.log(`Matched event by targetEventId=${opts.targetEventId}`);
        return { ...byId, score: 1 };
      }
    }

    if (opts.targetWhatsappMessageId) {
      const byReply = await this.prisma.event.findFirst({
        where: {
          whatsappMessageId: opts.targetWhatsappMessageId,
          status: 'PUBLISHED',
          hostId: opts.hostId,
        },
        select: candidateSelect,
      });
      if (byReply) {
        return { ...byReply, score: 1 };
      }
      const byDesc = await this.prisma.event.findMany({
        where: {
          hostId: opts.hostId,
          status: 'PUBLISHED',
          description: { contains: opts.targetWhatsappMessageId },
        },
        select: candidateSelect,
        take: 5,
      });
      if (byDesc.length === 1) {
        return { ...byDesc[0]!, score: 0.98 };
      }
    }

    const now = Date.now();
    const windowStart = new Date(
      now - (opts.preferSingleCandidate ? 12 : 2) * 60 * 60 * 1000,
    );
    const windowEnd = new Date(
      now + (opts.preferSingleCandidate ? 14 : 2) * 24 * 60 * 60 * 1000,
    );

    // Cancel: search all of the host's published events (app-created ones may
    // not be in the WhatsApp default group, and have no whatsappMessageId).
    const candidates = await this.prisma.event.findMany({
      where: {
        hostId: opts.hostId,
        status: 'PUBLISHED',
        startTime: { gte: windowStart, lte: windowEnd },
        ...(opts.preferSingleCandidate ? {} : { groupId: opts.groupId }),
      },
      select: candidateSelect,
      orderBy: { startTime: 'asc' },
      take: 40,
    });

    if (candidates.length === 0) return null;

    if (opts.preferSingleCandidate && candidates.length === 1) {
      return { ...candidates[0]!, score: 0.9 };
    }

    // Quote/body title hint for app-created events (no WhatsApp message id).
    const titleHint = `${opts.quotedText || ''} ${opts.messageBody || ''}`.toLowerCase();
    if (opts.preferSingleCandidate && titleHint.trim()) {
      const titled = candidates
        .map((c) => {
          const title = (c.title || '').toLowerCase();
          const loc = (c.locationName || '').toLowerCase();
          let score = 0;
          if (title && titleHint.includes(title.slice(0, Math.min(title.length, 24)))) {
            score += 0.7;
          }
          if (loc && loc.length >= 4 && titleHint.includes(loc.slice(0, Math.min(loc.length, 16)))) {
            score += 0.25;
          }
          return { ...c, score };
        })
        .filter((c) => c.score >= 0.7)
        .sort((a, b) => b.score - a.score);
      if (titled[0] && (!titled[1] || titled[0].score - titled[1].score >= 0.15)) {
        return titled[0];
      }
    }

    const messageHasPlaceCue = hasPlaceCue(opts.messageBody) || Boolean(opts.venueId);

    // Cancel with no place/time in the message → soonest upcoming host event.
    if (opts.preferSingleCandidate && !messageHasPlaceCue) {
      const upcoming = candidates
        .filter((c) => c.startTime.getTime() >= now - 2 * 60 * 60 * 1000)
        .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
      if (upcoming.length === 1) {
        return { ...upcoming[0]!, score: 0.88 };
      }
      if (upcoming.length >= 2) {
        const gapHours =
          (upcoming[1]!.startTime.getTime() - upcoming[0]!.startTime.getTime()) /
          (60 * 60 * 1000);
        // Prefer the next game when it's clearly sooner than the one after.
        if (gapHours >= 4) {
          return { ...upcoming[0]!, score: 0.82 };
        }
      }
      // Fall back to sole / soonest event in the WhatsApp default group.
      const groupOnly = await this.prisma.event.findMany({
        where: {
          hostId: opts.hostId,
          groupId: opts.groupId,
          status: 'PUBLISHED',
          startTime: { gte: windowStart, lte: windowEnd },
        },
        select: candidateSelect,
        orderBy: { startTime: 'asc' },
        take: 10,
      });
      if (groupOnly.length === 1) {
        return { ...groupOnly[0]!, score: 0.86 };
      }
      const groupUpcoming = groupOnly
        .filter((c) => c.startTime.getTime() >= now - 2 * 60 * 60 * 1000)
        .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
      if (groupUpcoming.length === 1) {
        return { ...groupUpcoming[0]!, score: 0.86 };
      }
      if (groupUpcoming.length >= 2) {
        const gapHours =
          (groupUpcoming[1]!.startTime.getTime() -
            groupUpcoming[0]!.startTime.getTime()) /
          (60 * 60 * 1000);
        if (gapHours >= 4) {
          return { ...groupUpcoming[0]!, score: 0.8 };
        }
      }
    }

    // Don't let an invented venue poison cancel scoring when the message
    // itself has no place words.
    const scoreVenueId = messageHasPlaceCue ? opts.venueId : null;
    const scoreLocation = messageHasPlaceCue ? opts.locationName : null;
    const scoreAddress = messageHasPlaceCue ? opts.address : null;

    const scored = candidates
      .map((c) => ({
        ...c,
        score: scoreRescheduleCandidate(c, {
          venueId: scoreVenueId,
          locationName: scoreLocation,
          address: scoreAddress,
          newStart: opts.startTime,
          messageBody: opts.messageBody,
          direction: opts.direction,
          timezone: opts.timezone,
        }),
      }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const minScore = opts.preferSingleCandidate ? 0.45 : 0.7;
    if (!best || best.score < minScore) return null;
    const second = scored[1];
    if (
      second &&
      best.score - second.score < 0.08 &&
      second.score >= minScore
    ) {
      this.logger.warn(
        `Ambiguous update candidates ${best.id} (${best.score}) vs ${second.id} (${second.score}) — skipping update`,
      );
      return null;
    }
    return best;
  }

  private async notifyEventCancelled(
    event: {
      id: string;
      title: string;
      startTime: Date;
      locationName: string | null;
    },
    opts: { message: string; excludeUserId?: string },
  ): Promise<void> {
    const rsvps = await this.prisma.rsvp.findMany({
      where: {
        eventId: event.id,
        status: {
          in: [RsvpStatus.GOING, RsvpStatus.WAITLISTED, RsvpStatus.INTERESTED],
        },
        ...(opts.excludeUserId ? { userId: { not: opts.excludeUserId } } : {}),
      },
      select: { userId: true },
    });

    for (const rsvp of rsvps) {
      this.eventEmitter.emit(NOTIFY_EVENT, {
        userId: rsvp.userId,
        type: NotificationType.EVENT_CANCELLED,
        payload: {
          eventId: event.id,
          eventTitle: event.title,
          message: opts.message,
          startTime: event.startTime.toISOString(),
          locationName: event.locationName,
        },
        email: {
          subject: `Cancelled: ${event.title}`,
          heading: 'Event cancelled',
          body: opts.message,
          ctaLabel: 'View event',
          ctaPath: `/events/${event.id}`,
        },
      } satisfies NotifyPayload);
    }
  }

  private async notifyEventUpdated(
    event: {
      id: string;
      title: string;
      startTime: Date;
      locationName: string | null;
    },
    opts: { previousStart: Date; message: string; excludeUserId?: string },
  ): Promise<void> {
    const rsvps = await this.prisma.rsvp.findMany({
      where: {
        eventId: event.id,
        status: {
          in: [RsvpStatus.GOING, RsvpStatus.WAITLISTED, RsvpStatus.INTERESTED],
        },
        ...(opts.excludeUserId ? { userId: { not: opts.excludeUserId } } : {}),
      },
      select: { userId: true },
    });

    const when = event.startTime.toUTCString();
    for (const rsvp of rsvps) {
      this.eventEmitter.emit(NOTIFY_EVENT, {
        userId: rsvp.userId,
        type: NotificationType.EVENT_UPDATED,
        payload: {
          eventId: event.id,
          eventTitle: event.title,
          message: opts.message,
          previousStart: opts.previousStart.toISOString(),
          startTime: event.startTime.toISOString(),
          locationName: event.locationName,
        },
        email: {
          subject: `Updated: ${event.title}`,
          heading: 'Event time/location updated',
          body: `${opts.message}\n\nNew start (UTC): ${when}`,
          ctaLabel: 'View event',
          ctaPath: `/events/${event.id}`,
        },
      } satisfies NotifyPayload);
    }
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

function appendWhatsappUpdate(
  previousDescription: string,
  messageBody: string,
  whatsappMessageId: string,
  mapsUrls: string[],
): string {
  const stamp = new Date().toISOString();
  const parts = [
    previousDescription.trim(),
    '---',
    `Updated via WhatsApp (${stamp}):`,
    messageBody.trim(),
  ];
  if (mapsUrls.length) {
    parts.push(`Maps:\n${mapsUrls.join('\n')}`);
  }
  parts.push(`Update source: WhatsApp message ${whatsappMessageId}`);
  return parts.join('\n\n');
}

function buildRescheduleNotifyMessage(
  event: { title: string; startTime: Date; locationName: string | null },
  previousStart: Date,
): string {
  const place = event.locationName ? ` at ${event.locationName}` : '';
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    return `"${event.title}" was updated via WhatsApp: now ${fmt.format(event.startTime)}${place} (was ${fmt.format(previousStart)}).`;
  } catch {
    return `"${event.title}" was updated via WhatsApp${place}.`;
  }
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
