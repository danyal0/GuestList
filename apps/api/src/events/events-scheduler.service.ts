import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventStatus, NotificationType, RsvpStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFY_EVENT, NotifyPayload } from '../notifications/notification.events';

/**
 * Background jobs for the event lifecycle:
 * - 24-hour reminders for attendees marked GOING
 * - transition PUBLISHED → COMPLETED once the end time passes
 */
@Injectable()
export class EventsSchedulerService {
  private readonly logger = new Logger(EventsSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async sendEventReminders(): Promise<void> {
    const windowEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const events = await this.prisma.event.findMany({
      where: {
        status: EventStatus.PUBLISHED,
        remindersSentAt: null,
        startTime: { gte: new Date(), lte: windowEnd },
      },
      include: {
        rsvps: { where: { status: RsvpStatus.GOING }, select: { userId: true } },
      },
      take: 200,
    });

    for (const event of events) {
      for (const rsvp of event.rsvps) {
        this.eventEmitter.emit(NOTIFY_EVENT, {
          userId: rsvp.userId,
          type: NotificationType.EVENT_REMINDER,
          payload: {
            eventId: event.id,
            eventTitle: event.title,
            startTime: event.startTime.toISOString(),
          },
          email: {
            subject: `Reminder: ${event.title} is coming up`,
            heading: 'Your event starts soon',
            body: `"${event.title}" starts at ${event.startTime.toUTCString()}. See you there!`,
            ctaLabel: 'View event',
            ctaPath: `/events/${event.id}`,
          },
        } satisfies NotifyPayload);
      }
      await this.prisma.event.update({
        where: { id: event.id },
        data: { remindersSentAt: new Date() },
      });
    }

    if (events.length > 0) {
      this.logger.log(`Sent reminders for ${events.length} event(s)`);
    }
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async completePastEvents(): Promise<void> {
    const result = await this.prisma.event.updateMany({
      where: { status: EventStatus.PUBLISHED, endTime: { lt: new Date() } },
      data: { status: EventStatus.COMPLETED },
    });
    if (result.count > 0) {
      this.logger.log(`Marked ${result.count} event(s) as completed`);
    }
  }
}
