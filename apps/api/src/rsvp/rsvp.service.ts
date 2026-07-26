import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ActivityType,
  EventStatus,
  EventVisibility,
  GroupPrivacy,
  NotificationType,
  Rsvp,
  RsvpStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GroupPermissionsService } from '../groups/group-permissions.service';
import { NOTIFY_EVENT, NotifyPayload } from '../notifications/notification.events';

export interface RsvpResult {
  rsvp: Rsvp;
  /** True when the requested GOING became WAITLISTED due to capacity. */
  waitlisted: boolean;
}

@Injectable()
export class RsvpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: GroupPermissionsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Sets (or changes) a user's RSVP. All capacity decisions happen inside a
   * serializable transaction so concurrent RSVPs cannot oversell an event.
   */
  async setRsvp(eventId: string, userId: string, requested: RsvpStatus): Promise<RsvpResult> {
    if (requested === RsvpStatus.WAITLISTED) {
      throw new BadRequestException('Waitlist placement is automatic and cannot be requested');
    }

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { group: { select: { privacy: true } } },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException('This event is not open for RSVPs');
    }
    if (event.startTime < new Date()) {
      throw new BadRequestException('This event has already started');
    }
    if (event.rsvpDeadline && event.rsvpDeadline < new Date()) {
      throw new BadRequestException('The RSVP deadline has passed');
    }

    // Members-only events and hidden groups require an active membership.
    if (event.visibility === EventVisibility.MEMBERS || event.group.privacy === GroupPrivacy.HIDDEN) {
      const membership = await this.permissions.getActiveMembership(event.groupId, userId);
      if (!membership) throw new BadRequestException('This event is for community members only');
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.rsvp.findUnique({
          where: { eventId_userId: { eventId, userId } },
        });

        let finalStatus: RsvpStatus = requested;
        if (requested === RsvpStatus.GOING && event.capacity !== null) {
          const goingCount = await tx.rsvp.count({
            where: { eventId, status: RsvpStatus.GOING, userId: { not: userId } },
          });
          if (goingCount >= event.capacity) {
            // Schema default is true; treat missing (e.g. older mock rows) as enabled.
            if (event.allowWaitlist === false) {
              throw new BadRequestException('This event is at capacity');
            }
            finalStatus = RsvpStatus.WAITLISTED;
          }
        }

        const rsvp = existing
          ? await tx.rsvp.update({ where: { id: existing.id }, data: { status: finalStatus } })
          : await tx.rsvp.create({ data: { eventId, userId, status: finalStatus } });

        await tx.activityLog.create({
          data: {
            userId,
            type: ActivityType.EVENT_RSVP,
            metadata: { eventId, status: finalStatus },
          },
        });

        const freedSpot =
          existing?.status === RsvpStatus.GOING && finalStatus !== RsvpStatus.GOING;
        return { rsvp, waitlisted: finalStatus === RsvpStatus.WAITLISTED, freedSpot };
      },
      { isolationLevel: 'Serializable' },
    );

    if (result.freedSpot) {
      await this.promoteFromWaitlist(eventId);
    }

    // Confirmation notification for the user.
    this.eventEmitter.emit(NOTIFY_EVENT, {
      userId,
      type: NotificationType.RSVP_CONFIRMED,
      payload: {
        eventId,
        eventTitle: event.title,
        status: result.rsvp.status,
      },
      email:
        result.rsvp.status === RsvpStatus.GOING
          ? {
              subject: `You're going to ${event.title}`,
              heading: "You're in!",
              body: `Your spot for "${event.title}" on ${event.startTime.toUTCString()} is confirmed.`,
              ctaLabel: 'View event',
              ctaPath: `/events/${eventId}`,
            }
          : undefined,
    } satisfies NotifyPayload);

    this.emitRsvpUpdate(eventId);
    return { rsvp: result.rsvp, waitlisted: result.waitlisted };
  }

  async cancelRsvp(eventId: string, userId: string): Promise<void> {
    const existing = await this.prisma.rsvp.findUnique({
      where: { eventId_userId: { eventId, userId } },
    });
    if (!existing) throw new NotFoundException('No RSVP found for this event');

    const wasGoing = existing.status === RsvpStatus.GOING;
    await this.prisma.rsvp.delete({ where: { id: existing.id } });

    if (wasGoing) {
      await this.promoteFromWaitlist(eventId);
    }
    this.emitRsvpUpdate(eventId);
  }

  /** FIFO promotion of the oldest waitlisted attendee once capacity frees up. */
  private async promoteFromWaitlist(eventId: string): Promise<void> {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event || event.capacity === null) return;

    const promoted = await this.prisma.$transaction(
      async (tx) => {
        const goingCount = await tx.rsvp.count({
          where: { eventId, status: RsvpStatus.GOING },
        });
        if (goingCount >= event.capacity!) return null;

        const next = await tx.rsvp.findFirst({
          where: { eventId, status: RsvpStatus.WAITLISTED },
          orderBy: { createdAt: 'asc' },
        });
        if (!next) return null;

        return tx.rsvp.update({
          where: { id: next.id },
          data: { status: RsvpStatus.GOING },
        });
      },
      { isolationLevel: 'Serializable' },
    );

    if (promoted) {
      this.eventEmitter.emit(NOTIFY_EVENT, {
        userId: promoted.userId,
        type: NotificationType.RSVP_PROMOTED,
        payload: { eventId, eventTitle: event.title },
        email: {
          subject: `A spot opened up for ${event.title}`,
          heading: "You're off the waitlist!",
          body: `Good news — a spot opened up and you're now confirmed for "${event.title}".`,
          ctaLabel: 'View event',
          ctaPath: `/events/${eventId}`,
        },
      } satisfies NotifyPayload);
      this.emitRsvpUpdate(eventId);
    }
  }

  private emitRsvpUpdate(eventId: string): void {
    // Fire-and-forget count refresh pushed to everyone viewing the event.
    void this.prisma.rsvp
      .groupBy({ by: ['status'], where: { eventId }, _count: true })
      .then((counts) => {
        const summary: Record<string, number> = {};
        for (const c of counts) summary[c.status] = c._count;
        this.eventEmitter.emit('realtime.rsvp.updated', { eventId, counts: summary });
      })
      .catch(() => undefined);
  }
}
