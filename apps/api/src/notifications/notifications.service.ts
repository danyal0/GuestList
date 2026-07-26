import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Notification, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NOTIFY_EVENT, NotifyPayload } from './notification.events';
import { Paginated, paginate } from '../common/dto/pagination.dto';

/**
 * Notification fan-out hub. Domain modules emit NOTIFY_EVENT; this service
 * persists the in-app notification, pushes it over Socket.IO (via the
 * realtime module) and optionally sends an email. A push-provider (APNs/FCM)
 * can subscribe to the same event without touching call sites.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  @OnEvent(NOTIFY_EVENT, { async: true })
  async handleNotify(payload: NotifyPayload): Promise<void> {
    try {
      const notification = await this.prisma.notification.create({
        data: {
          userId: payload.userId,
          type: payload.type,
          payload: payload.payload as Prisma.InputJsonValue,
        },
      });

      this.eventEmitter.emit('realtime.notification.created', {
        userId: payload.userId,
        notification,
      });

      if (payload.email) {
        const user = await this.prisma.user.findUnique({
          where: { id: payload.userId },
          select: { email: true, deletedAt: true },
        });
        if (user && !user.deletedAt) {
          const webUrl = this.config.get<string>('webUrl');
          await this.mailService.send({
            to: user.email,
            subject: payload.email.subject,
            heading: payload.email.heading,
            body: payload.email.body,
            ctaLabel: payload.email.ctaLabel,
            ctaUrl: payload.email.ctaPath ? `${webUrl}${payload.email.ctaPath}` : undefined,
          });
        }
      }
    } catch (err) {
      this.logger.error(`Failed to dispatch notification to ${payload.userId}`, err as Error);
    }
  }

  async list(userId: string, page: number, limit: number, unreadOnly: boolean): Promise<Paginated<Notification>> {
    const where = { userId, ...(unreadOnly ? { read: false } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return paginate(items, total, page, limit);
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, read: false } });
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true },
    });
    if (result.count === 0) throw new NotFoundException('Notification not found');
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }
}
