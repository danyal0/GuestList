import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ActivityType,
  Event,
  EventStatus,
  EventVisibility,
  GroupMemberRole,
  GroupPrivacy,
  NotificationType,
  Prisma,
  RsvpStatus,
} from '@prisma/client';
import { RRule } from 'rrule';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { GroupPermissionsService } from '../groups/group-permissions.service';
import { CreateEventDto, ListEventsDto, UpdateEventDto } from './dto/event.dto';
import { paginate } from '../common/dto/pagination.dto';
import { haversineKm } from '../common/utils/geo';
import { publicUserSelect } from '../users/users.service';
import { NOTIFY_EVENT, NotifyPayload } from '../notifications/notification.events';
import { eventToIcs } from './ics.util';
import { computeSpotsLeft, normalizeCapacity } from '../common/utils/capacity';

const MAX_OCCURRENCES = 26;
const RECURRENCE_HORIZON_MS = 1000 * 60 * 60 * 24 * 183; // ~6 months

const eventListInclude = {
  group: { select: { id: true, slug: true, name: true, coverImage: true, category: true } },
  host: { select: { id: true, name: true, avatarUrl: true } },
  _count: { select: { rsvps: { where: { status: RsvpStatus.GOING } } } },
} satisfies Prisma.EventInclude;

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: GroupPermissionsService,
    private readonly auditService: AuditService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(hostId: string, dto: CreateEventDto): Promise<Event> {
    await this.permissions.requireRole(dto.groupId, hostId, GroupMemberRole.MODERATOR);
    this.validateSchedule(dto.startTime, dto.endTime, dto.rsvpDeadline);
    this.validateModeFields(dto.mode, dto);

    let occurrenceStarts: Date[] = [];
    if (dto.recurrenceRule) {
      occurrenceStarts = this.expandRecurrence(dto.recurrenceRule, dto.startTime);
    }

    const durationMs = dto.endTime.getTime() - dto.startTime.getTime();
    const baseData = {
      groupId: dto.groupId,
      hostId,
      title: dto.title,
      description: dto.description,
      coverImage: dto.coverImage,
      mode: dto.mode,
      locationName: dto.locationName,
      address: dto.address,
      latitude: dto.latitude,
      longitude: dto.longitude,
      onlineUrl: dto.onlineUrl,
      timezone: dto.timezone,
      capacity: dto.capacity,
      visibility: dto.visibility ?? EventVisibility.PUBLIC,
      allowWaitlist: dto.allowWaitlist ?? true,
      rsvpDeadline: dto.rsvpDeadline,
      status: dto.status ?? EventStatus.PUBLISHED,
    };

    const event = await this.prisma.$transaction(async (tx) => {
      const parent = await tx.event.create({
        data: {
          ...baseData,
          startTime: dto.startTime,
          endTime: dto.endTime,
          recurrenceRule: dto.recurrenceRule,
        },
      });

      if (occurrenceStarts.length > 0) {
        await tx.event.createMany({
          data: occurrenceStarts.map((start) => ({
            ...baseData,
            startTime: start,
            endTime: new Date(start.getTime() + durationMs),
            parentEventId: parent.id,
          })),
        });
      }

      await tx.activityLog.create({
        data: { userId: hostId, type: ActivityType.EVENT_CREATED, metadata: { eventId: parent.id } },
      });
      return parent;
    });

    await this.auditService.log({
      actorId: hostId,
      action: 'event.create',
      targetType: 'EVENT',
      targetId: event.id,
    });

    if (event.status === EventStatus.PUBLISHED) {
      await this.notifyGroupMembers(event, hostId, NotificationType.EVENT_CREATED, {
        message: `New event: ${event.title}`,
      });
    }

    return event;
  }

  async list(dto: ListEventsDto, viewerId?: string) {
    const status =
      dto.status === EventStatus.CANCELLED
        ? EventStatus.CANCELLED
        : EventStatus.PUBLISHED;
    // Cancelled events drop out of "upcoming" — keep them visible for ~60 days.
    const defaultFrom =
      status === EventStatus.CANCELLED
        ? new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
        : new Date();

    // Materialized occurrences (parent + children) each appear as their own card so
    // upcoming dates stay discoverable after the series start, and hosts can cancel one.
    const where: Prisma.EventWhereInput = {
      status,
      group: { deletedAt: null, privacy: { not: GroupPrivacy.HIDDEN } },
      visibility: EventVisibility.PUBLIC,
      ...(dto.groupId ? { groupId: dto.groupId } : {}),
      ...(dto.mode ? { mode: dto.mode } : {}),
      startTime: { gte: dto.from ?? defaultFrom, ...(dto.to ? { lte: dto.to } : {}) },
      ...(dto.q
        ? {
            OR: [
              { title: { contains: dto.q, mode: 'insensitive' } },
              { description: { contains: dto.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    // Members can see members-only events of their groups in group-scoped lists.
    if (dto.groupId && viewerId) {
      const membership = await this.permissions.getActiveMembership(dto.groupId, viewerId);
      if (membership) delete (where as { visibility?: unknown }).visibility;
    }

    const orderBy: Prisma.EventOrderByWithRelationInput =
      status === EventStatus.CANCELLED
        ? { startTime: 'desc' }
        : dto.sort === 'newest'
          ? { createdAt: 'desc' }
          : { startTime: 'asc' };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        include: eventListInclude,
        orderBy,
        skip: dto.skip,
        take: dto.limit,
      }),
      this.prisma.event.count({ where }),
    ]);

    let results = items.map((e) => this.decorateListItem(e, dto.lat, dto.lng));
    if (dto.radiusKm !== undefined && dto.lat !== undefined && dto.lng !== undefined) {
      results = results.filter((e) => e.distanceKm === undefined || e.distanceKm <= dto.radiusKm!);
    }
    if (dto.sort === 'popular' && status === EventStatus.PUBLISHED) {
      results.sort((a, b) => b.goingCount - a.goingCount);
    }

    return paginate(results, total, dto.page, dto.limit);
  }

  async getById(eventId: string, viewerId?: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        group: {
          select: { id: true, slug: true, name: true, coverImage: true, category: true, privacy: true },
        },
        host: { select: publicUserSelect },
        parentEvent: { select: { id: true, title: true, recurrenceRule: true } },
        occurrences: {
          where: { startTime: { gte: new Date() }, status: EventStatus.PUBLISHED },
          orderBy: { startTime: 'asc' },
          take: 5,
          select: { id: true, startTime: true, endTime: true },
        },
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    await this.assertViewable(event.groupId, event.visibility, event.group.privacy, viewerId);

    const seriesRootId = event.parentEventId ?? (event.recurrenceRule ? event.id : null);
    let occurrences = event.occurrences;
    // Child occurrences don't own the RRULE — surface upcoming siblings from the series root.
    if (event.parentEventId && occurrences.length === 0) {
      occurrences = await this.prisma.event.findMany({
        where: {
          OR: [{ id: event.parentEventId }, { parentEventId: event.parentEventId }],
          id: { not: event.id },
          startTime: { gte: new Date() },
          status: EventStatus.PUBLISHED,
        },
        orderBy: { startTime: 'asc' },
        take: 5,
        select: { id: true, startTime: true, endTime: true },
      });
    }

    const [goingCount, interestedCount, waitlistCount, viewerRsvp, attendees] = await Promise.all([
      this.prisma.rsvp.count({ where: { eventId, status: RsvpStatus.GOING } }),
      this.prisma.rsvp.count({ where: { eventId, status: RsvpStatus.INTERESTED } }),
      this.prisma.rsvp.count({ where: { eventId, status: RsvpStatus.WAITLISTED } }),
      viewerId
        ? this.prisma.rsvp.findUnique({ where: { eventId_userId: { eventId, userId: viewerId } } })
        : null,
      this.prisma.rsvp.findMany({
        where: { eventId, status: RsvpStatus.GOING },
        take: 12,
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      }),
    ]);

    const capacity = normalizeCapacity(event.capacity);
    return {
      ...event,
      occurrences,
      recurrenceRule: event.recurrenceRule ?? event.parentEvent?.recurrenceRule ?? null,
      isRecurring: Boolean(seriesRootId),
      seriesId: seriesRootId,
      capacity,
      goingCount,
      interestedCount,
      waitlistCount,
      spotsLeft: computeSpotsLeft(capacity, goingCount),
      viewerRsvp: viewerRsvp ? { status: viewerRsvp.status } : null,
      attendeePreview: attendees.map((a) => a.user),
    };
  }

  async update(eventId: string, userId: string, dto: UpdateEventDto): Promise<Event> {
    const event = await this.requireManageable(eventId, userId);

    const startTime = dto.startTime ?? event.startTime;
    const endTime = dto.endTime ?? event.endTime;
    this.validateSchedule(startTime, endTime, dto.rsvpDeadline ?? event.rsvpDeadline ?? undefined);

    if (dto.status === EventStatus.CANCELLED) {
      throw new BadRequestException('Use the cancel endpoint to cancel an event');
    }

    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: { ...dto },
    });

    await this.notifyAttendees(updated, NotificationType.EVENT_UPDATED, {
      message: `"${updated.title}" was updated`,
    });
    this.eventEmitter.emit('realtime.event.updated', { eventId, event: updated });
    return updated;
  }

  /**
   * Cancel one occurrence (`scope=one`, default) or the whole recurring series (`scope=series`).
   * Series cancel covers the series root plus every non-completed sibling occurrence.
   */
  async cancel(
    eventId: string,
    userId: string,
    scope: 'one' | 'series' = 'one',
  ): Promise<void> {
    const event = await this.requireManageable(eventId, userId);
    if (event.status === EventStatus.CANCELLED) {
      throw new BadRequestException('Event is already cancelled');
    }

    const ids =
      scope === 'series' ? await this.seriesEventIds(event) : [event.id];

    const cancellable = await this.prisma.event.findMany({
      where: {
        id: { in: ids },
        status: { in: [EventStatus.PUBLISHED, EventStatus.DRAFT] },
      },
    });
    if (cancellable.length === 0) {
      throw new BadRequestException('Event is already cancelled');
    }

    await this.prisma.event.updateMany({
      where: { id: { in: cancellable.map((e) => e.id) } },
      data: { status: EventStatus.CANCELLED },
    });

    await this.auditService.log({
      actorId: userId,
      action: scope === 'series' ? 'event.cancel.series' : 'event.cancel',
      targetType: 'EVENT',
      targetId: eventId,
      metadata: { scope, cancelledIds: cancellable.map((e) => e.id) },
    });

    for (const cancelled of cancellable) {
      await this.notifyAttendees(cancelled, NotificationType.EVENT_CANCELLED, {
        message:
          scope === 'series'
            ? `"${cancelled.title}" series has been cancelled`
            : `"${cancelled.title}" has been cancelled`,
      });
      this.eventEmitter.emit('realtime.event.updated', {
        eventId: cancelled.id,
        event: { ...cancelled, status: EventStatus.CANCELLED },
      });
    }
  }

  /** Resolve every event id that belongs to the same recurrence series. */
  private async seriesEventIds(event: Event): Promise<string[]> {
    const rootId = event.parentEventId ?? event.id;
    const siblings = await this.prisma.event.findMany({
      where: {
        OR: [{ id: rootId }, { parentEventId: rootId }],
      },
      select: { id: true },
    });
    return siblings.map((s) => s.id);
  }

  async listAttendees(eventId: string, viewerId: string, status: RsvpStatus, page: number, limit: number) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { group: { select: { privacy: true } } },
    });
    if (!event) throw new NotFoundException('Event not found');
    await this.assertViewable(event.groupId, event.visibility, event.group.privacy, viewerId);

    const where = { eventId, status };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.rsvp.findMany({
        where,
        include: { user: { select: publicUserSelect } },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.rsvp.count({ where }),
    ]);
    return paginate(items, total, page, limit);
  }

  async exportIcs(eventId: string, viewerId?: string): Promise<string> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { group: { select: { privacy: true } } },
    });
    if (!event) throw new NotFoundException('Event not found');
    await this.assertViewable(event.groupId, event.visibility, event.group.privacy, viewerId);

    const webUrl = process.env.WEB_URL ?? 'http://localhost:3000';
    return eventToIcs(event, `${webUrl}/events/${event.id}`);
  }

  async getMyEvents(userId: string) {
    const rsvps = await this.prisma.rsvp.findMany({
      where: {
        userId,
        status: { in: [RsvpStatus.GOING, RsvpStatus.INTERESTED, RsvpStatus.WAITLISTED] },
        event: {
          startTime: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
          status: { in: [EventStatus.PUBLISHED, EventStatus.CANCELLED] },
        },
      },
      include: { event: { include: eventListInclude } },
      orderBy: { event: { startTime: 'asc' } },
    });
    return rsvps.map((r) => ({
      rsvpStatus: r.status,
      ...this.decorateListItem(r.event),
    }));
  }

  /** Host or community admin may manage an event. */
  private async requireManageable(eventId: string, userId: string): Promise<Event> {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    if (event.hostId !== userId) {
      const membership = await this.permissions.getActiveMembership(event.groupId, userId);
      if (!membership || this.permissions.rank(membership.role) < this.permissions.rank(GroupMemberRole.ADMIN)) {
        throw new ForbiddenException('Only the host or community admins can manage this event');
      }
    }
    return event;
  }

  private async assertViewable(
    groupId: string,
    visibility: EventVisibility,
    groupPrivacy: GroupPrivacy,
    viewerId?: string,
  ): Promise<void> {
    const needsMembership = visibility === EventVisibility.MEMBERS || groupPrivacy === GroupPrivacy.HIDDEN;
    if (!needsMembership) return;
    if (!viewerId) throw new NotFoundException('Event not found');
    const membership = await this.permissions.getActiveMembership(groupId, viewerId);
    if (!membership) throw new NotFoundException('Event not found');
  }

  private validateSchedule(start: Date, end: Date, rsvpDeadline?: Date | null): void {
    if (end <= start) throw new BadRequestException('End time must be after start time');
    if (rsvpDeadline && rsvpDeadline > start) {
      throw new BadRequestException('RSVP deadline must be before the event starts');
    }
  }

  private validateModeFields(mode: string, dto: CreateEventDto): void {
    if ((mode === 'ONLINE' || mode === 'HYBRID') && !dto.onlineUrl) {
      throw new BadRequestException('Online and hybrid events require an online URL');
    }
    if ((mode === 'IN_PERSON' || mode === 'HYBRID') && !dto.locationName && !dto.address) {
      throw new BadRequestException('In-person and hybrid events require a location');
    }
  }

  private expandRecurrence(rule: string, startTime: Date): Date[] {
    let rrule: RRule;
    try {
      rrule = new RRule({ ...RRule.parseString(rule), dtstart: startTime });
    } catch {
      throw new BadRequestException('Invalid recurrence rule');
    }
    const horizon = new Date(Date.now() + RECURRENCE_HORIZON_MS);
    const occurrences = rrule.between(startTime, horizon, false).slice(0, MAX_OCCURRENCES);
    // The first generated occurrence duplicates the parent start.
    return occurrences.filter((d) => d.getTime() !== startTime.getTime());
  }

  private decorateListItem(
    event: Prisma.EventGetPayload<{ include: typeof eventListInclude }>,
    lat?: number,
    lng?: number,
  ) {
    const { _count, ...rest } = event;
    const capacity = normalizeCapacity(event.capacity);
    return {
      ...rest,
      capacity,
      goingCount: _count.rsvps,
      spotsLeft: computeSpotsLeft(capacity, _count.rsvps),
      distanceKm:
        lat !== undefined && lng !== undefined && event.latitude !== null && event.longitude !== null
          ? Math.round(haversineKm(lat, lng, event.latitude, event.longitude) * 10) / 10
          : undefined,
    };
  }

  private async notifyGroupMembers(
    event: Event,
    excludeUserId: string,
    type: NotificationType,
    extra: Record<string, unknown>,
  ): Promise<void> {
    const members = await this.prisma.groupMember.findMany({
      where: { groupId: event.groupId, status: 'ACTIVE', userId: { not: excludeUserId } },
      select: { userId: true },
    });
    for (const member of members) {
      this.eventEmitter.emit(NOTIFY_EVENT, {
        userId: member.userId,
        type,
        payload: { eventId: event.id, eventTitle: event.title, groupId: event.groupId, ...extra },
      } satisfies NotifyPayload);
    }
  }

  private async notifyAttendees(
    event: Event,
    type: NotificationType,
    extra: Record<string, unknown>,
  ): Promise<void> {
    const rsvps = await this.prisma.rsvp.findMany({
      where: { eventId: event.id, status: { in: [RsvpStatus.GOING, RsvpStatus.WAITLISTED, RsvpStatus.INTERESTED] } },
      select: { userId: true },
    });
    for (const rsvp of rsvps) {
      this.eventEmitter.emit(NOTIFY_EVENT, {
        userId: rsvp.userId,
        type,
        payload: { eventId: event.id, eventTitle: event.title, ...extra },
        email:
          type === NotificationType.EVENT_CANCELLED
            ? {
                subject: `Cancelled: ${event.title}`,
                heading: 'Event cancelled',
                body: `"${event.title}" scheduled for ${event.startTime.toUTCString()} has been cancelled by the organizers.`,
              }
            : undefined,
      } satisfies NotifyPayload);
    }
  }
}
