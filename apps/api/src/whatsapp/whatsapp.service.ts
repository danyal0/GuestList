import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
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
  resolveCatalogVenue,
  scoreEventAgainstQuote,
  scoreRescheduleCandidate,
  whatsappIdFromMeVariants,
  type CatalogVenue,
  type RescheduleCandidate,
} from './whatsapp-event-enrich';
import {
  findOrCreateNamedAttendee,
  findOrLinkWhatsappUser,
  resolveWhatsappDefaultGroup,
} from './whatsapp-identity';
import {
  hasExplicitTimeCue,
  isWithinVenueHours,
  validateWhatsappEventProposal,
  type WhatsappCreateValidationResult,
} from './whatsapp-event-validate';
import { askAiEventSenseCheck } from './whatsapp-sense-check';
import { resolveSchedule } from './whatsapp-time';

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
    timeConfidence?: number | null;
    /** 0–1 from AI: host is changing an existing plan. */
    rescheduleConfidence?: number | null;
    isReschedule?: boolean | null;
    /** 0–1 from AI/local: host is cancelling an existing plan. */
    cancelConfidence?: number | null;
    isCancel?: boolean | null;
    /** Prior thread message ids that helped form this invite (for RSVP soft-match). */
    relatedWhatsappMessageIds?: string[] | null;
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
    const relatedWhatsappMessageIds = (body.relatedWhatsappMessageIds || [])
      .map((id) => String(id || '').trim())
      .filter(Boolean);
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
      relatedWhatsappMessageIds,
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
          `Cancel match event=${match.id} score=${match.score.toFixed(2)} cue="${cancelCue.matchedPhrase ?? 'ai'}" quote=${quotedText ? 'yes' : 'no'} replyId=${targetWhatsappMessageId || 'n/a'}`,
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
        const notified = await this.notifyEventCancelled(cancelled, {
          message: `"${cancelled.title}" has been cancelled via WhatsApp.`,
          excludeUserId: host.id,
        });
        this.logger.log(
          `Cancelled event=${cancelled.id} notifiedRsvps=${notified}`,
        );
        this.eventEmitter.emit('realtime.event.updated', {
          eventId: cancelled.id,
          event: cancelled,
        });
        return {
          ok: true,
          cancelled: true,
          event: cancelled,
          notifiedRsvps: notified,
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
        const timeWasExplicit = hasExplicitTimeCue(
          messageBody,
          body.suggestedTime,
          body.title,
        );
        const venueWasExplicit = Boolean(catalog) || hasPlaceCue(messageBody);

        // Only apply fields the host actually changed — don't invent a new
        // default time when they only moved the venue (and vice versa).
        const nextStart = timeWasExplicit ? startTime : match.startTime;
        const nextEnd = timeWasExplicit
          ? endTime
          : new Date(
              match.startTime.getTime() +
                Math.max(1, durationMinutes) * 60 * 1000,
            );
        const nextVenueId = venueWasExplicit ? venueId : match.venueId;
        const nextLocation = venueWasExplicit
          ? locationName
          : match.locationName;
        const nextAddress = venueWasExplicit ? address : match.address;

        const timeChanged = match.startTime.getTime() !== nextStart.getTime();
        const venueChanged =
          (nextVenueId ?? null) !== (match.venueId ?? null) ||
          (nextLocation || null) !== (match.locationName || null);

        const effectiveCatalog =
          catalog ??
          (await this.catalogVenueForId(nextVenueId ?? match.venueId));

        // Description-only reply: keep schedule/venue, just append WhatsApp note.
        if (!timeChanged && !venueChanged) {
          this.logger.log(
            `Reschedule/reply match event=${match.id} with no time/venue change — description update only`,
          );
          const updatedDescription = appendWhatsappUpdate(
            match.description,
            messageBody,
            whatsappMessageId,
            mapsUrls,
          );
          const updated = await this.prisma.event.update({
            where: { id: match.id },
            data: { description: updatedDescription },
            select: eventSelect,
          });
          return {
            ok: true,
            updated: true,
            rescheduled: false,
            event: updated,
            namedAttendees: [],
            capacity: updated.capacity,
          };
        }

        this.logger.log(
          `Reschedule match event=${match.id} score=${match.score.toFixed(2)} cue="${rescheduleCue.matchedPhrase ?? (targetWhatsappMessageId ? 'reply' : 'ai')}" timeChanged=${timeChanged} venueChanged=${venueChanged} → ${nextStart.toISOString()}`,
        );

        await this.assertEventProposalValid({
          mode: 'reschedule',
          messageBody,
          title,
          suggestedTime: body.suggestedTime,
          venue: body.venue,
          locationName: nextLocation,
          address: nextAddress,
          catalogVenue: effectiveCatalog,
          freeformLocation: effectiveCatalog ? null : nextLocation,
          startTime: nextStart,
          timezone,
          timeWasExplicit,
          venueWasExplicit: venueWasExplicit || Boolean(effectiveCatalog),
          botConfidence: body.confidence,
          venueConfidence: body.venueConfidence,
          timeConfidence: body.timeConfidence,
          changes: { timeChanged, venueChanged },
        });

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
            ...(venueWasExplicit
              ? {
                  locationName: nextLocation,
                  address: nextAddress,
                  venueId: nextVenueId,
                  ...(latitude != null ? { latitude } : {}),
                  ...(longitude != null ? { longitude } : {}),
                }
              : {}),
            timezone,
            startTime: nextStart,
            endTime: nextEnd,
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

        await this.notifyEventUpdated(updated, {
          previousStart,
          message: buildRescheduleNotifyMessage(updated, previousStart),
          excludeUserId: host.id,
        });
        this.eventEmitter.emit('realtime.event.updated', {
          eventId: updated.id,
          event: updated,
        });

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

    await this.assertEventProposalValid({
      mode: 'create',
      messageBody,
      title,
      suggestedTime: body.suggestedTime,
      venue: body.venue,
      locationName,
      address,
      catalogVenue: catalog,
      freeformLocation: catalog ? null : locationName,
      startTime,
      timezone,
      timeWasExplicit: hasExplicitTimeCue(
        messageBody,
        body.suggestedTime,
        body.title,
      ),
      venueWasExplicit: Boolean(catalog) || hasPlaceCue(messageBody),
      botConfidence: body.confidence,
      venueConfidence: body.venueConfidence,
      timeConfidence: body.timeConfidence,
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

  private throwEventValidation(validation: WhatsappCreateValidationResult): never {
    if (validation.ok) {
      throw new Error('throwEventValidation called with ok result');
    }
    this.logger.warn(
      `WhatsApp event rejected code=${validation.code} msg=${validation.message}`,
    );
    throw new UnprocessableEntityException({
      error: 'Event validation failed',
      code: validation.code,
      message: validation.message,
      hints: validation.hints,
      details: validation.details ?? null,
    });
  }

  private async catalogVenueForId(
    venueId: string | null | undefined,
  ): Promise<CatalogVenue | null> {
    if (!venueId) return null;
    const row = await this.prisma.venue.findFirst({
      where: { id: venueId },
      select: { slug: true, name: true },
    });
    if (!row) return null;
    return (
      resolveCatalogVenue(row.slug)?.venue ??
      resolveCatalogVenue(row.name)?.venue ??
      null
    );
  }

  /** Structural rules + local sense gate + optional live LLM self-check. */
  private async assertEventProposalValid(input: {
    mode: 'create' | 'reschedule';
    messageBody: string;
    title: string;
    suggestedTime?: string | null;
    venue?: string | null;
    locationName: string | null;
    address: string | null;
    catalogVenue: CatalogVenue | null;
    freeformLocation: string | null;
    startTime: Date;
    timezone: string;
    timeWasExplicit: boolean;
    venueWasExplicit: boolean;
    botConfidence?: number | null;
    venueConfidence?: number | null;
    timeConfidence?: number | null;
    changes?: { timeChanged: boolean; venueChanged: boolean };
  }): Promise<void> {
    const ai = await askAiEventSenseCheck({
      mode: input.mode,
      messageBody: input.messageBody,
      title: input.title,
      venueName: input.catalogVenue?.name ?? input.locationName,
      venueSlug: input.catalogVenue?.slug ?? null,
      startTime: input.startTime,
      timezone: input.timezone,
      changes: input.changes ?? null,
    });
    if (ai) {
      this.logger.log(
        `AI sense-check mode=${input.mode} makesSense=${ai.makesSense} confidence=${ai.confidence.toFixed(2)} reason=${ai.reason}`,
      );
    }

    // If AI still claims "too late" but the local wall-clock is within court hours,
    // drop the AI veto (classic UTC 23:00Z vs 6pm Chicago confusion).
    let aiSenseConfidence: number | null = ai
      ? ai.makesSense
        ? ai.confidence
        : Math.min(ai.confidence, 0.49)
      : null;
    let aiSenseReason: string | null = ai?.reason ?? null;
    if (
      ai &&
      !ai.makesSense &&
      isWithinVenueHours(input.startTime, input.timezone, input.catalogVenue) &&
      /\b(23:00|22:00|too late|absurd)/i.test(ai.reason)
    ) {
      this.logger.warn(
        `Ignoring AI sense-check UTC/lateness false positive: ${ai.reason}`,
      );
      aiSenseConfidence = null;
      aiSenseReason = null;
    }

    const validation = validateWhatsappEventProposal({
      ...input,
      aiSenseConfidence,
      aiSenseReason,
    });
    if (!validation.ok) this.throwEventValidation(validation);
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

    const replyIds = whatsappIdFromMeVariants(opts.targetWhatsappMessageId);
    if (replyIds.length) {
      const byReply = await this.prisma.event.findFirst({
        where: {
          whatsappMessageId: { in: replyIds },
          status: 'PUBLISHED',
          hostId: opts.hostId,
        },
        select: candidateSelect,
      });
      if (byReply) {
        return { ...byReply, score: 1 };
      }
      for (const replyId of replyIds) {
        const byDesc = await this.prisma.event.findMany({
          where: {
            hostId: opts.hostId,
            status: 'PUBLISHED',
            description: { contains: replyId },
          },
          select: candidateSelect,
          take: 5,
        });
        if (byDesc.length === 1) {
          return { ...byDesc[0]!, score: 0.98 };
        }
      }
    }

    // Quote body often equals / is embedded in the original invite description.
    const quote = opts.quotedText?.trim() || '';
    const quoteCatalog = quote ? resolveCatalogVenue(quote) : null;
    if (quoteCatalog) {
      const venueRow = await this.prisma.venue.findUnique({
        where: { slug: quoteCatalog.venue.slug },
        select: { id: true },
      });
      const windowForQuote = {
        gte: new Date(Date.now() - 12 * 60 * 60 * 1000),
        lte: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      };
      if (venueRow) {
        const byVenue = await this.prisma.event.findMany({
          where: {
            hostId: opts.hostId,
            status: 'PUBLISHED',
            venueId: venueRow.id,
            startTime: windowForQuote,
          },
          select: candidateSelect,
          orderBy: { startTime: 'asc' },
          take: 8,
        });
        if (byVenue.length === 1) {
          this.logger.log(
            `Matched event by quoted venue slug=${quoteCatalog.venue.slug} → ${byVenue[0]!.id}`,
          );
          return { ...byVenue[0]!, score: 0.96 };
        }
        if (byVenue.length > 1) {
          const scoredVenue = byVenue
            .map((c) => ({ ...c, score: scoreEventAgainstQuote(c, quote) }))
            .sort((a, b) => b.score - a.score);
          if (
            scoredVenue[0] &&
            (!scoredVenue[1] || scoredVenue[0].score - scoredVenue[1].score >= 0.08)
          ) {
            return { ...scoredVenue[0], score: Math.max(scoredVenue[0].score, 0.9) };
          }
        }
      }
      const placeKey =
        quoteCatalog.matchedAlias ||
        quoteCatalog.venue.aliases.find((a) => a.length >= 4) ||
        quoteCatalog.venue.name.split(' ')[0] ||
        '';
      if (placeKey.length >= 4) {
        const byPlace = await this.prisma.event.findMany({
          where: {
            hostId: opts.hostId,
            status: 'PUBLISHED',
            startTime: windowForQuote,
            OR: [
              { locationName: { contains: placeKey, mode: 'insensitive' } },
              { title: { contains: placeKey, mode: 'insensitive' } },
              { description: { contains: placeKey, mode: 'insensitive' } },
              { address: { contains: placeKey, mode: 'insensitive' } },
            ],
          },
          select: candidateSelect,
          take: 8,
        });
        if (byPlace.length === 1) {
          this.logger.log(
            `Matched event by quoted place "${placeKey}" → ${byPlace[0]!.id}`,
          );
          return { ...byPlace[0]!, score: 0.95 };
        }
        if (byPlace.length > 1) {
          const scoredPlace = byPlace
            .map((c) => ({ ...c, score: scoreEventAgainstQuote(c, quote) }))
            .sort((a, b) => b.score - a.score);
          if (
            scoredPlace[0] &&
            scoredPlace[0].score >= 0.5 &&
            (!scoredPlace[1] || scoredPlace[0].score - scoredPlace[1].score >= 0.08)
          ) {
            return { ...scoredPlace[0], score: Math.max(scoredPlace[0].score, 0.9) };
          }
        }
      }
    }

    if (quote.length >= 16) {
      const snippet = quote.slice(0, 40);
      const bySnippet = await this.prisma.event.findMany({
        where: {
          hostId: opts.hostId,
          status: 'PUBLISHED',
          description: { contains: snippet.slice(0, 24) },
        },
        select: candidateSelect,
        take: 8,
      });
      if (bySnippet.length === 1) {
        this.logger.log(
          `Matched event by quoted invite snippet → ${bySnippet[0]!.id}`,
        );
        return { ...bySnippet[0]!, score: 0.97 };
      }
      if (bySnippet.length > 1) {
        const scoredSnips = bySnippet
          .map((c) => ({
            ...c,
            score: scoreEventAgainstQuote(c, quote),
          }))
          .sort((a, b) => b.score - a.score);
        if (
          scoredSnips[0] &&
          scoredSnips[0].score >= 0.7 &&
          (!scoredSnips[1] || scoredSnips[0].score - scoredSnips[1].score >= 0.1)
        ) {
          return scoredSnips[0];
        }
      }
    }

    const now = Date.now();
    const windowStart = new Date(
      now - (opts.preferSingleCandidate ? 12 : 2) * 60 * 60 * 1000,
    );
    const windowEnd = new Date(
      now + (opts.preferSingleCandidate ? 14 : 2) * 24 * 60 * 60 * 1000,
    );

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

    if (opts.preferSingleCandidate && candidates.length === 1 && !quote) {
      return { ...candidates[0]!, score: 0.9 };
    }

    // Prefer quote place/title over "soonest upcoming" — otherwise we cancel
    // the wrong game when the host has multiple plans.
    if (quote) {
      const quotedScores = candidates
        .map((c) => ({
          ...c,
          score: scoreEventAgainstQuote(c, quote),
        }))
        .sort((a, b) => b.score - a.score);
      const bestQ = quotedScores[0];
      const secondQ = quotedScores[1];
      if (bestQ && bestQ.score >= 0.7) {
        if (!secondQ || bestQ.score - secondQ.score >= 0.1 || secondQ.score < 0.7) {
          this.logger.log(
            `Matched event by quoted place/text score=${bestQ.score.toFixed(2)} → ${bestQ.id}`,
          );
          return bestQ;
        }
      }
      // Quote present but ambiguous/weak — do NOT guess the soonest event.
      this.logger.warn(
        `Quoted cancel/reschedule text present but no strong event match (best=${bestQ?.id ?? 'none'}@${bestQ?.score?.toFixed(2) ?? 0})`,
      );
      if (opts.preferSingleCandidate) {
        return null;
      }
    }

    const messageHasPlaceCue = hasPlaceCue(opts.messageBody) || Boolean(opts.venueId);

    // Cancel with no place in the cancel text AND no quote → soonest upcoming.
    if (opts.preferSingleCandidate && !messageHasPlaceCue && !quote) {
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
        if (gapHours >= 4) {
          return { ...upcoming[0]!, score: 0.82 };
        }
      }
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
    const minScore = 0.7;
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
  ): Promise<number> {
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

    this.logger.log(
      `Cancel notify event=${event.id} rsvpRecipients=${rsvps.length}`,
    );

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
    return rsvps.length;
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
    reactorName?: string | null;
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

    const eventSelect = {
      id: true,
      title: true,
      status: true,
      whatsappMessageId: true,
    } as const;

    let event = await this.prisma.event.findUnique({
      where: { whatsappMessageId },
      select: eventSelect,
    });

    // Soft-match: reaction/RSVP on a follow-up in the same planning thread,
    // or plain "I'm in" without quoting the invite message.
    if (!event) {
      const byDesc = await this.prisma.event.findFirst({
        where: {
          status: 'PUBLISHED',
          whatsappMessageId: { not: null },
          description: { contains: whatsappMessageId },
          startTime: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
        select: eventSelect,
      });
      if (byDesc) {
        this.logger.log(
          `RSVP soft-match via description contains messageId → event=${byDesc.id}`,
        );
        event = byDesc;
      }
    }

    if (!event) {
      const { group } = await resolveWhatsappDefaultGroup(this.prisma);
      if (group) {
        const latest = await this.prisma.event.findFirst({
          where: {
            groupId: group.id,
            status: 'PUBLISHED',
            whatsappMessageId: { not: null },
            startTime: { gte: new Date() },
          },
          orderBy: { createdAt: 'desc' },
          select: eventSelect,
        });
        if (latest) {
          this.logger.log(
            `RSVP soft-match latest open WhatsApp invite → event=${latest.id} (requested=${whatsappMessageId})`,
          );
          event = latest;
        }
      }
    }

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
      senderName: body.reactorName,
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
