import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFY_EVENT, NotifyPayload } from '../notifications/notification.events';

const ERROR_ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const ERROR_ALERT_GLOBAL_MIN_MS = 60 * 1000;

@Injectable()
export class AdminAlertService {
  private readonly logger = new Logger(AdminAlertService.name);
  private readonly errorLastByKey = new Map<string, number>();
  private lastGlobalErrorAlertAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async notifyStaff(notification: Omit<NotifyPayload, 'userId'>): Promise<void> {
    const staff = await this.prisma.user.findMany({
      where: {
        role: { in: [UserRole.ADMIN, UserRole.MODERATOR] },
        deletedAt: null,
        suspendedAt: null,
      },
      select: { id: true },
    });
    for (const user of staff) {
      this.eventEmitter.emit(NOTIFY_EVENT, {
        ...notification,
        userId: user.id,
      } satisfies NotifyPayload);
    }
  }

  async notifyNewReport(input: {
    reportId: string;
    reporterId: string;
    reporterName?: string;
    targetType: string;
    targetId: string;
    reason: string;
    details?: string | null;
  }): Promise<void> {
    const who = input.reporterName?.trim() || 'Someone';
    const detail = input.details?.trim();
    await this.notifyStaff({
      type: NotificationType.REPORT_CREATED,
      payload: {
        reportId: input.reportId,
        reporterId: input.reporterId,
        reporterName: who,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        href: '/admin',
      },
      email: {
        subject: `New report: ${input.targetType.toLowerCase()} — ${input.reason}`,
        heading: 'New content report',
        body: `${who} reported a ${input.targetType.toLowerCase()} (${input.reason}).${
          detail ? ` Details: ${detail.slice(0, 280)}` : ''
        }`,
        ctaLabel: 'Open backoffice',
        ctaPath: '/admin',
      },
    });
  }

  async notifySystemError(input: {
    statusCode: number;
    path: string;
    method?: string;
    message: string;
    error?: string;
  }): Promise<void> {
    const path = (input.path || '/').split('?')[0] ?? '/';
    const key = `${input.statusCode}:${input.method ?? 'GET'}:${path}`;
    const now = Date.now();

    if (now - this.lastGlobalErrorAlertAt < ERROR_ALERT_GLOBAL_MIN_MS) return;
    const last = this.errorLastByKey.get(key) ?? 0;
    if (now - last < ERROR_ALERT_COOLDOWN_MS) return;

    this.errorLastByKey.set(key, now);
    this.lastGlobalErrorAlertAt = now;

    // Bound memory for long-running processes
    if (this.errorLastByKey.size > 200) {
      const cutoff = now - ERROR_ALERT_COOLDOWN_MS;
      for (const [k, t] of this.errorLastByKey) {
        if (t < cutoff) this.errorLastByKey.delete(k);
      }
    }

    const shortMessage = input.message.slice(0, 240);
    try {
      await this.notifyStaff({
        type: NotificationType.SYSTEM_ERROR,
        payload: {
          statusCode: input.statusCode,
          path,
          method: input.method ?? null,
          message: shortMessage,
          error: input.error ?? null,
          href: '/admin',
        },
        email: {
          subject: `API ${input.statusCode} on ${path}`,
          heading: 'Server error alert',
          body: `${input.method ?? 'GET'} ${path} returned ${input.statusCode}: ${shortMessage}`,
          ctaLabel: 'Open backoffice',
          ctaPath: '/admin',
        },
      });
    } catch (err) {
      this.logger.error('Failed to alert staff about system error', err as Error);
    }
  }
}
