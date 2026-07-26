import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ActivityType,
  Group,
  GroupMemberRole,
  GroupMemberStatus,
  GroupPrivacy,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { GroupPermissionsService } from './group-permissions.service';
import { CreateGroupDto, ListGroupsDto, UpdateGroupDto } from './dto/group.dto';
import { slugify } from '../common/utils/slug';
import { Paginated, paginate } from '../common/dto/pagination.dto';
import { publicUserSelect } from '../users/users.service';
import { NOTIFY_EVENT, NotifyPayload } from '../notifications/notification.events';

const groupListSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  coverImage: true,
  category: true,
  privacy: true,
  memberCount: true,
  location: true,
  latitude: true,
  longitude: true,
  isVerified: true,
  createdAt: true,
} satisfies Prisma.GroupSelect;

export type GroupSummary = Prisma.GroupGetPayload<{ select: typeof groupListSelect }>;

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: GroupPermissionsService,
    private readonly auditService: AuditService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(ownerId: string, dto: CreateGroupDto): Promise<Group> {
    const group = await this.prisma.$transaction(async (tx) => {
      const created = await tx.group.create({
        data: {
          slug: slugify(dto.name),
          name: dto.name,
          description: dto.description,
          category: dto.category,
          privacy: dto.privacy ?? GroupPrivacy.PUBLIC,
          rules: dto.rules,
          coverImage: dto.coverImage,
          location: dto.location,
          latitude: dto.latitude,
          longitude: dto.longitude,
          ownerId,
        },
      });
      await tx.groupMember.create({
        data: {
          groupId: created.id,
          userId: ownerId,
          role: GroupMemberRole.OWNER,
          status: GroupMemberStatus.ACTIVE,
        },
      });
      await tx.activityLog.create({
        data: { userId: ownerId, type: ActivityType.GROUP_CREATED, metadata: { groupId: created.id } },
      });
      return created;
    });

    await this.auditService.log({
      actorId: ownerId,
      action: 'group.create',
      targetType: 'GROUP',
      targetId: group.id,
    });
    return group;
  }

  async list(dto: ListGroupsDto, _viewerId?: string): Promise<Paginated<GroupSummary & { distanceKm?: number }>> {
    // Hidden groups never appear in discovery; private ones do (join requires approval).
    const where: Prisma.GroupWhereInput = {
      deletedAt: null,
      privacy: { in: [GroupPrivacy.PUBLIC, GroupPrivacy.PRIVATE] },
      ...(dto.category ? { category: dto.category } : {}),
      ...(dto.q
        ? {
            OR: [
              { name: { contains: dto.q, mode: 'insensitive' } },
              { description: { contains: dto.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.GroupOrderByWithRelationInput =
      dto.sort === 'newest' ? { createdAt: 'desc' } : { memberCount: 'desc' };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.group.findMany({
        where,
        select: groupListSelect,
        orderBy,
        skip: dto.skip,
        take: dto.limit,
      }),
      this.prisma.group.count({ where }),
    ]);

    // Distance annotation + optional radius filtering happens in memory on
    // the current page for simplicity; the search module does it in SQL.
    let results: (GroupSummary & { distanceKm?: number })[] = items;
    if (dto.lat !== undefined && dto.lng !== undefined) {
      const { haversineKm } = await import('../common/utils/geo');
      results = items.map((g) => ({
        ...g,
        distanceKm:
          g.latitude !== null && g.longitude !== null
            ? Math.round(haversineKm(dto.lat!, dto.lng!, g.latitude, g.longitude) * 10) / 10
            : undefined,
      }));
      if (dto.radiusKm) {
        results = results.filter((g) => g.distanceKm === undefined || g.distanceKm <= dto.radiusKm!);
      }
      if (dto.sort === 'nearby') {
        results.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
      }
    }

    return paginate(results, total, dto.page, dto.limit);
  }

  async getByIdOrSlug(idOrSlug: string, viewerId?: string) {
    const group = await this.permissions.requireVisibleGroup(idOrSlug, viewerId);

    const [membership, upcomingEvents, followerCount] = await Promise.all([
      viewerId ? this.permissions.getActiveMembership(group.id, viewerId) : null,
      this.prisma.event.count({
        where: { groupId: group.id, status: 'PUBLISHED', startTime: { gte: new Date() } },
      }),
      this.prisma.follow.count({ where: { groupId: group.id } }),
    ]);

    let pendingMembership = false;
    if (viewerId && !membership) {
      const pending = await this.prisma.groupMember.findFirst({
        where: { groupId: group.id, userId: viewerId, status: GroupMemberStatus.PENDING },
      });
      pendingMembership = pending !== null;
    }

    return {
      ...group,
      upcomingEvents,
      followerCount,
      viewerMembership: membership
        ? { role: membership.role, joinedAt: membership.joinedAt }
        : null,
      viewerPending: pendingMembership,
    };
  }

  async update(groupId: string, userId: string, dto: UpdateGroupDto): Promise<Group> {
    await this.permissions.requireRole(groupId, userId, GroupMemberRole.ADMIN);

    const group = await this.prisma.group.update({
      where: { id: groupId },
      data: { ...dto },
    });

    await this.auditService.log({
      actorId: userId,
      action: 'group.update',
      targetType: 'GROUP',
      targetId: groupId,
    });
    await this.notifyMembers(groupId, userId, {
      type: NotificationType.COMMUNITY_UPDATE,
      payload: { groupId, groupName: group.name, message: 'Community details were updated' },
    });
    return group;
  }

  async delete(groupId: string, userId: string): Promise<void> {
    await this.permissions.requireRole(groupId, userId, GroupMemberRole.OWNER);
    await this.prisma.group.update({
      where: { id: groupId },
      data: { deletedAt: new Date() },
    });
    await this.auditService.log({
      actorId: userId,
      action: 'group.delete',
      targetType: 'GROUP',
      targetId: groupId,
    });
  }

  async transferOwnership(groupId: string, userId: string, newOwnerId: string): Promise<void> {
    await this.permissions.requireRole(groupId, userId, GroupMemberRole.OWNER);
    if (userId === newOwnerId) throw new BadRequestException('You already own this community');

    const newOwnerMembership = await this.permissions.getActiveMembership(groupId, newOwnerId);
    if (!newOwnerMembership) {
      throw new BadRequestException('The new owner must be an active member of the community');
    }

    await this.prisma.$transaction([
      this.prisma.groupMember.updateMany({
        where: { groupId, userId },
        data: { role: GroupMemberRole.ADMIN },
      }),
      this.prisma.groupMember.update({
        where: { id: newOwnerMembership.id },
        data: { role: GroupMemberRole.OWNER },
      }),
      this.prisma.group.update({ where: { id: groupId }, data: { ownerId: newOwnerId } }),
    ]);

    await this.auditService.log({
      actorId: userId,
      action: 'group.transfer_ownership',
      targetType: 'GROUP',
      targetId: groupId,
      metadata: { newOwnerId },
    });
  }

  // ───────────────────── Membership ─────────────────────

  async join(groupId: string, userId: string): Promise<{ status: GroupMemberStatus }> {
    const group = await this.permissions.requireVisibleGroup(groupId, userId);

    const existing = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: group.id, userId } },
    });
    if (existing) {
      if (existing.status === GroupMemberStatus.BANNED) {
        throw new ForbiddenException('You are banned from this community');
      }
      throw new ConflictException(
        existing.status === GroupMemberStatus.PENDING
          ? 'Your membership request is pending approval'
          : 'You are already a member',
      );
    }

    const status =
      group.privacy === GroupPrivacy.PUBLIC ? GroupMemberStatus.ACTIVE : GroupMemberStatus.PENDING;

    await this.prisma.$transaction(async (tx) => {
      await tx.groupMember.create({ data: { groupId: group.id, userId, status } });
      if (status === GroupMemberStatus.ACTIVE) {
        await tx.group.update({
          where: { id: group.id },
          data: { memberCount: { increment: 1 } },
        });
        await tx.activityLog.create({
          data: { userId, type: ActivityType.GROUP_JOINED, metadata: { groupId: group.id } },
        });
      }
    });

    if (status === GroupMemberStatus.ACTIVE) {
      const joiner = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { name: true },
      });
      await this.notifyAdmins(group.id, {
        type: NotificationType.NEW_MEMBER,
        payload: { groupId: group.id, groupName: group.name, memberName: joiner.name, memberId: userId },
      });
    }

    return { status };
  }

  async leave(groupId: string, userId: string): Promise<void> {
    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!membership || membership.status === GroupMemberStatus.BANNED) {
      throw new NotFoundException('You are not a member of this community');
    }
    if (membership.role === GroupMemberRole.OWNER) {
      throw new BadRequestException('Transfer ownership before leaving the community');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.groupMember.delete({ where: { id: membership.id } });
      if (membership.status === GroupMemberStatus.ACTIVE) {
        await tx.group.update({ where: { id: groupId }, data: { memberCount: { decrement: 1 } } });
        await tx.activityLog.create({
          data: { userId, type: ActivityType.GROUP_LEFT, metadata: { groupId } },
        });
      }
    });
  }

  async listMembers(groupId: string, viewerId: string, page: number, limit: number) {
    const group = await this.permissions.requireVisibleGroup(groupId, viewerId);
    if (group.privacy !== GroupPrivacy.PUBLIC) {
      await this.permissions.requireRole(group.id, viewerId, GroupMemberRole.MEMBER);
    }

    const where = { groupId: group.id, status: GroupMemberStatus.ACTIVE };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.groupMember.findMany({
        where,
        include: { user: { select: publicUserSelect } },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.groupMember.count({ where }),
    ]);
    return paginate(items, total, page, limit);
  }

  async listPendingMembers(groupId: string, actorId: string) {
    await this.permissions.requireRole(groupId, actorId, GroupMemberRole.ADMIN);
    return this.prisma.groupMember.findMany({
      where: { groupId, status: GroupMemberStatus.PENDING },
      include: { user: { select: publicUserSelect } },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async approveMember(groupId: string, actorId: string, memberUserId: string): Promise<void> {
    await this.permissions.requireRole(groupId, actorId, GroupMemberRole.ADMIN);

    const membership = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: memberUserId } },
    });
    if (!membership || membership.status !== GroupMemberStatus.PENDING) {
      throw new NotFoundException('No pending request for this user');
    }

    const group = await this.prisma.$transaction(async (tx) => {
      await tx.groupMember.update({
        where: { id: membership.id },
        data: { status: GroupMemberStatus.ACTIVE, joinedAt: new Date() },
      });
      await tx.activityLog.create({
        data: { userId: memberUserId, type: ActivityType.GROUP_JOINED, metadata: { groupId } },
      });
      return tx.group.update({
        where: { id: groupId },
        data: { memberCount: { increment: 1 } },
      });
    });

    this.eventEmitter.emit(NOTIFY_EVENT, {
      userId: memberUserId,
      type: NotificationType.MEMBER_APPROVED,
      payload: { groupId, groupName: group.name },
    } satisfies NotifyPayload);
  }

  async rejectMember(groupId: string, actorId: string, memberUserId: string): Promise<void> {
    await this.permissions.requireRole(groupId, actorId, GroupMemberRole.ADMIN);
    const deleted = await this.prisma.groupMember.deleteMany({
      where: { groupId, userId: memberUserId, status: GroupMemberStatus.PENDING },
    });
    if (deleted.count === 0) throw new NotFoundException('No pending request for this user');
  }

  async updateMemberRole(
    groupId: string,
    actorId: string,
    memberUserId: string,
    role: GroupMemberRole,
  ): Promise<void> {
    if (role === GroupMemberRole.OWNER) {
      throw new BadRequestException('Use the transfer-ownership endpoint to change owners');
    }
    // Granting/revoking ADMIN is owner-only; MODERATOR changes need ADMIN.
    const requiredRole =
      role === GroupMemberRole.ADMIN ? GroupMemberRole.OWNER : GroupMemberRole.ADMIN;
    const actor = await this.permissions.requireRole(groupId, actorId, requiredRole);

    const target = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: memberUserId } },
    });
    if (!target || target.status !== GroupMemberStatus.ACTIVE) {
      throw new NotFoundException('Member not found');
    }
    if (target.role === GroupMemberRole.OWNER) {
      throw new ForbiddenException('The owner role cannot be changed here');
    }
    this.permissions.assertOutranks(actor, target);

    await this.prisma.groupMember.update({ where: { id: target.id }, data: { role } });
    await this.auditService.log({
      actorId,
      action: 'group.member_role_change',
      targetType: 'GROUP',
      targetId: groupId,
      metadata: { memberUserId, role },
    });
  }

  async banMember(groupId: string, actorId: string, memberUserId: string): Promise<void> {
    const actor = await this.permissions.requireRole(groupId, actorId, GroupMemberRole.MODERATOR);

    const target = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: memberUserId } },
    });
    if (!target) throw new NotFoundException('Member not found');
    this.permissions.assertOutranks(actor, target);

    await this.prisma.$transaction(async (tx) => {
      const wasActive = target.status === GroupMemberStatus.ACTIVE;
      await tx.groupMember.update({
        where: { id: target.id },
        data: { status: GroupMemberStatus.BANNED, role: GroupMemberRole.MEMBER },
      });
      if (wasActive) {
        await tx.group.update({ where: { id: groupId }, data: { memberCount: { decrement: 1 } } });
      }
    });

    await this.auditService.log({
      actorId,
      action: 'group.member_ban',
      targetType: 'GROUP',
      targetId: groupId,
      metadata: { memberUserId },
    });
  }

  async unbanMember(groupId: string, actorId: string, memberUserId: string): Promise<void> {
    await this.permissions.requireRole(groupId, actorId, GroupMemberRole.MODERATOR);
    const deleted = await this.prisma.groupMember.deleteMany({
      where: { groupId, userId: memberUserId, status: GroupMemberStatus.BANNED },
    });
    if (deleted.count === 0) throw new NotFoundException('This user is not banned');
  }

  async getMyGroups(userId: string) {
    const memberships = await this.prisma.groupMember.findMany({
      where: { userId, status: GroupMemberStatus.ACTIVE, group: { deletedAt: null } },
      include: { group: { select: groupListSelect } },
      orderBy: { joinedAt: 'desc' },
    });
    return memberships.map((m) => ({ ...m.group, memberRole: m.role }));
  }

  private async notifyAdmins(groupId: string, notification: Omit<NotifyPayload, 'userId'>): Promise<void> {
    const admins = await this.prisma.groupMember.findMany({
      where: {
        groupId,
        status: GroupMemberStatus.ACTIVE,
        role: { in: [GroupMemberRole.OWNER, GroupMemberRole.ADMIN] },
      },
      select: { userId: true },
    });
    for (const admin of admins) {
      this.eventEmitter.emit(NOTIFY_EVENT, { ...notification, userId: admin.userId });
    }
  }

  private async notifyMembers(
    groupId: string,
    excludeUserId: string,
    notification: Omit<NotifyPayload, 'userId'>,
  ): Promise<void> {
    const members = await this.prisma.groupMember.findMany({
      where: { groupId, status: GroupMemberStatus.ACTIVE, userId: { not: excludeUserId } },
      select: { userId: true },
    });
    for (const member of members) {
      this.eventEmitter.emit(NOTIFY_EVENT, { ...notification, userId: member.userId });
    }
  }
}
