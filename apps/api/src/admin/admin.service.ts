import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listUsers(q: string | undefined, page: number, limit: number) {
    const where: Prisma.UserWhereInput = q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          role: true,
          location: true,
          emailVerifiedAt: true,
          suspendedAt: true,
          deletedAt: true,
          createdAt: true,
          _count: { select: { memberships: true, rsvps: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(items, total, page, limit);
  }

  async setUserSuspension(adminId: string, userId: string, suspend: boolean): Promise<void> {
    if (adminId === userId) throw new BadRequestException('You cannot suspend yourself');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { suspendedAt: suspend ? new Date() : null },
      }),
      ...(suspend
        ? [
            this.prisma.refreshToken.updateMany({
              where: { userId, revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          ]
        : []),
    ]);

    await this.auditService.log({
      actorId: adminId,
      action: suspend ? 'admin.user_suspend' : 'admin.user_unsuspend',
      targetType: 'USER',
      targetId: userId,
    });
  }

  async setUserRole(adminId: string, userId: string, role: UserRole): Promise<void> {
    if (adminId === userId) throw new BadRequestException('You cannot change your own role');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');

    await this.prisma.user.update({ where: { id: userId }, data: { role } });
    await this.auditService.log({
      actorId: adminId,
      action: 'admin.user_role_change',
      targetType: 'USER',
      targetId: userId,
      metadata: { role },
    });
  }

  async listGroups(q: string | undefined, page: number, limit: number) {
    const where: Prisma.GroupWhereInput = q
      ? { name: { contains: q, mode: 'insensitive' } }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.group.findMany({
        where,
        include: {
          owner: { select: { id: true, name: true, email: true } },
          _count: { select: { events: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.group.count({ where }),
    ]);
    return paginate(items, total, page, limit);
  }

  async removeGroup(adminId: string, groupId: string): Promise<void> {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group || group.deletedAt) throw new NotFoundException('Community not found');
    await this.prisma.group.update({
      where: { id: groupId },
      data: { deletedAt: new Date() },
    });
    await this.auditService.log({
      actorId: adminId,
      action: 'admin.group_remove',
      targetType: 'GROUP',
      targetId: groupId,
    });
  }

  async listEvents(q: string | undefined, page: number, limit: number) {
    const where: Prisma.EventWhereInput = q
      ? { title: { contains: q, mode: 'insensitive' } }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        include: {
          group: { select: { id: true, name: true, slug: true } },
          host: { select: { id: true, name: true } },
          _count: { select: { rsvps: true } },
        },
        orderBy: { startTime: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.event.count({ where }),
    ]);
    return paginate(items, total, page, limit);
  }

  async cancelEvent(adminId: string, eventId: string): Promise<void> {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');
    if (event.status === EventStatus.CANCELLED) {
      throw new BadRequestException('Event is already cancelled');
    }
    await this.prisma.event.update({
      where: { id: eventId },
      data: { status: EventStatus.CANCELLED },
    });
    await this.auditService.log({
      actorId: adminId,
      action: 'admin.event_cancel',
      targetType: 'EVENT',
      targetId: eventId,
    });
  }

  async listAuditLogs(page: number, limit: number) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        include: { actor: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count(),
    ]);
    return paginate(items, total, page, limit);
  }
}
