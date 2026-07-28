import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  NotificationType,
  Report,
  ReportStatus,
  ReportTargetType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AdminAlertService } from '../admin/admin-alert.service';
import { Paginated, paginate } from '../common/dto/pagination.dto';
import { NOTIFY_EVENT, NotifyPayload } from '../notifications/notification.events';

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly eventEmitter: EventEmitter2,
    private readonly adminAlertService: AdminAlertService,
  ) {}

  async createReport(
    reporterId: string,
    targetType: ReportTargetType,
    targetId: string,
    reason: string,
    details?: string,
  ): Promise<Report> {
    await this.assertTargetExists(targetType, targetId);

    const existing = await this.prisma.report.findFirst({
      where: { reporterId, targetType, targetId, status: ReportStatus.OPEN },
    });
    if (existing) {
      throw new BadRequestException('You already have an open report for this content');
    }

    const report = await this.prisma.report.create({
      data: { reporterId, targetType, targetId, reason, details },
    });

    const reporter = await this.prisma.user.findUnique({
      where: { id: reporterId },
      select: { name: true },
    });

    void this.adminAlertService.notifyNewReport({
      reportId: report.id,
      reporterId,
      reporterName: reporter?.name,
      targetType,
      targetId,
      reason,
      details,
    });

    return report;
  }

  async listReports(
    status: ReportStatus | undefined,
    page: number,
    limit: number,
  ): Promise<Paginated<Report>> {
    const where = status ? { status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({
        where,
        include: { reporter: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.report.count({ where }),
    ]);
    return paginate(items, total, page, limit);
  }

  async resolveReport(
    moderatorId: string,
    reportId: string,
    dismiss: boolean,
    resolution: string,
    takedown: boolean,
  ): Promise<Report> {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== ReportStatus.OPEN) {
      throw new BadRequestException('Report has already been handled');
    }

    if (takedown && !dismiss) {
      await this.applyTakedown(moderatorId, report.targetType, report.targetId);
    }

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: dismiss ? ReportStatus.DISMISSED : ReportStatus.RESOLVED,
        resolvedById: moderatorId,
        resolution,
        resolvedAt: new Date(),
      },
    });

    await this.auditService.log({
      actorId: moderatorId,
      action: dismiss ? 'moderation.report_dismissed' : 'moderation.report_resolved',
      targetType: report.targetType,
      targetId: report.targetId,
      metadata: { reportId, takedown },
    });

    this.eventEmitter.emit(NOTIFY_EVENT, {
      userId: report.reporterId,
      type: NotificationType.REPORT_RESOLVED,
      payload: { reportId, status: updated.status, resolution },
    } satisfies NotifyPayload);

    return updated;
  }

  private async applyTakedown(
    moderatorId: string,
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<void> {
    switch (targetType) {
      case ReportTargetType.MESSAGE:
        await this.prisma.message.updateMany({
          where: { id: targetId, deletedAt: null },
          data: { deletedAt: new Date(), content: '' },
        });
        break;
      case ReportTargetType.EVENT:
        await this.prisma.event.updateMany({
          where: { id: targetId },
          data: { status: 'CANCELLED' },
        });
        break;
      case ReportTargetType.GROUP:
        await this.prisma.group.updateMany({
          where: { id: targetId },
          data: { deletedAt: new Date() },
        });
        break;
      case ReportTargetType.USER:
        await this.prisma.$transaction([
          this.prisma.user.updateMany({
            where: { id: targetId },
            data: { suspendedAt: new Date() },
          }),
          this.prisma.refreshToken.updateMany({
            where: { userId: targetId, revokedAt: null },
            data: { revokedAt: new Date() },
          }),
        ]);
        break;
    }
    await this.auditService.log({
      actorId: moderatorId,
      action: 'moderation.takedown',
      targetType,
      targetId,
    });
  }

  private async assertTargetExists(targetType: ReportTargetType, targetId: string): Promise<void> {
    let exists = false;
    switch (targetType) {
      case ReportTargetType.USER:
        exists = (await this.prisma.user.findFirst({ where: { id: targetId, deletedAt: null } })) !== null;
        break;
      case ReportTargetType.GROUP:
        exists = (await this.prisma.group.findFirst({ where: { id: targetId, deletedAt: null } })) !== null;
        break;
      case ReportTargetType.EVENT:
        exists = (await this.prisma.event.findUnique({ where: { id: targetId } })) !== null;
        break;
      case ReportTargetType.MESSAGE:
        exists = (await this.prisma.message.findFirst({ where: { id: targetId, deletedAt: null } })) !== null;
        break;
    }
    if (!exists) throw new NotFoundException('Reported content not found');
  }
}
