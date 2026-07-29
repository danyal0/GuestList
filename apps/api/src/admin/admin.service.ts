import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventStatus, FriendshipStatus, GroupMemberRole, GroupMemberStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/dto/pagination.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async detailedStats() {
    const [
      totalUsers,
      activeUsers,
      suspendedUsers,
      shadowBannedUsers,
      deletedUsers,
      totalGroups,
      deletedGroups,
      publishedEvents,
      cancelledEvents,
      completedEvents,
      draftEvents,
      openReports,
      resolvedReports,
      dismissedReports,
      acceptedFriends,
      pendingFriends,
      totalRsvps,
      totalMessages,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({
        where: { deletedAt: null, suspendedAt: null, shadowBannedAt: null },
      }),
      this.prisma.user.count({ where: { suspendedAt: { not: null }, deletedAt: null } }),
      this.prisma.user.count({ where: { shadowBannedAt: { not: null }, deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: { not: null } } }),
      this.prisma.group.count({ where: { deletedAt: null } }),
      this.prisma.group.count({ where: { deletedAt: { not: null } } }),
      this.prisma.event.count({ where: { status: EventStatus.PUBLISHED } }),
      this.prisma.event.count({ where: { status: EventStatus.CANCELLED } }),
      this.prisma.event.count({ where: { status: EventStatus.COMPLETED } }),
      this.prisma.event.count({ where: { status: EventStatus.DRAFT } }),
      this.prisma.report.count({ where: { status: 'OPEN' } }),
      this.prisma.report.count({ where: { status: 'RESOLVED' } }),
      this.prisma.report.count({ where: { status: 'DISMISSED' } }),
      this.prisma.friendship.count({ where: { status: 'ACCEPTED' } }),
      this.prisma.friendship.count({ where: { status: 'PENDING' } }),
      this.prisma.rsvp.count(),
      this.prisma.message.count({ where: { deletedAt: null } }),
    ]);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        suspended: suspendedUsers,
        shadowBanned: shadowBannedUsers,
        deleted: deletedUsers,
      },
      groups: { active: totalGroups, deleted: deletedGroups },
      events: {
        published: publishedEvents,
        cancelled: cancelledEvents,
        completed: completedEvents,
        draft: draftEvents,
      },
      reports: {
        open: openReports,
        resolved: resolvedReports,
        dismissed: dismissedReports,
      },
      social: { friendships: acceptedFriends, pendingRequests: pendingFriends },
      engagement: { rsvps: totalRsvps, messages: totalMessages },
    };
  }

  async listUsers(q: string | undefined, page: number, limit: number) {
    const where: Prisma.UserWhereInput = q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
          ],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          avatarUrl: true,
          role: true,
          location: true,
          emailVerifiedAt: true,
          suspendedAt: true,
          shadowBannedAt: true,
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

  async setUserShadowBan(adminId: string, userId: string, shadowBan: boolean): Promise<void> {
    if (adminId === userId) throw new BadRequestException('You cannot shadow-ban yourself');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id: userId },
      data: { shadowBannedAt: shadowBan ? new Date() : null },
    });
    await this.auditService.log({
      actorId: adminId,
      action: shadowBan ? 'admin.user_shadow_ban' : 'admin.user_shadow_unban',
      targetType: 'USER',
      targetId: userId,
    });
  }

  async softDeleteUser(adminId: string, userId: string): Promise<void> {
    if (adminId === userId) throw new BadRequestException('You cannot delete yourself');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.deletedAt) throw new BadRequestException('User is already deleted');

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          deletedAt: new Date(),
          email: `deleted-${userId}@deleted.mkeplays.app`,
          name: 'Deleted member',
          avatarUrl: null,
          bio: null,
          location: null,
          phone: null,
          whatsappLid: null,
          passwordHash: null,
          suspendedAt: new Date(),
          shadowBannedAt: null,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.auditService.log({
      actorId: adminId,
      action: 'admin.user_delete',
      targetType: 'USER',
      targetId: userId,
    });
  }

  /**
   * Permanently remove a user and dependent rows that would block deletion
   * (hosted events, owned groups, messages, payments).
   */
  async hardDeleteUser(adminId: string, userId: string): Promise<void> {
    if (adminId === userId) throw new BadRequestException('You cannot hard-delete yourself');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.$transaction(async (tx) => {
      const owned = await tx.group.findMany({
        where: { ownerId: userId },
        select: { id: true },
      });
      for (const g of owned) {
        await tx.group.delete({ where: { id: g.id } });
      }

      await tx.event.deleteMany({ where: { hostId: userId } });
      await tx.message.deleteMany({ where: { senderId: userId } });
      await tx.payment.deleteMany({ where: { userId } });
      await tx.report.updateMany({
        where: { resolvedById: userId },
        data: { resolvedById: null },
      });

      await tx.user.delete({ where: { id: userId } });
    });

    await this.auditService.log({
      actorId: adminId,
      action: 'admin.user_hard_delete',
      targetType: 'USER',
      targetId: userId,
      metadata: { name: user.name, email: user.email, phone: user.phone },
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
    const where: Prisma.GroupWhereInput = {
      ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.group.findMany({
        where,
        include: {
          owner: { select: { id: true, name: true, email: true } },
          _count: { select: { events: true, members: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.group.count({ where }),
    ]);
    return paginate(items, total, page, limit);
  }

  async listGroupMembers(groupId: string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Community not found');
    const members = await this.prisma.groupMember.findMany({
      where: { groupId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
            deletedAt: true,
          },
        },
      },
      orderBy: [{ joinedAt: 'asc' }],
    });
    return {
      group: { id: group.id, name: group.name, slug: group.slug, ownerId: group.ownerId },
      members,
    };
  }

  /**
   * Platform admin can assign any community role, including OWNER.
   * Creates an ACTIVE membership when the user is not yet a member.
   */
  async setGroupMemberRole(
    adminId: string,
    groupId: string,
    memberUserId: string,
    role: GroupMemberRole,
  ): Promise<void> {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group || group.deletedAt) throw new NotFoundException('Community not found');

    const user = await this.prisma.user.findUnique({ where: { id: memberUserId } });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');

    const existing = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: memberUserId } },
    });

    await this.prisma.$transaction(async (tx) => {
      if (role === GroupMemberRole.OWNER) {
        if (group.ownerId !== memberUserId) {
          await tx.groupMember.updateMany({
            where: { groupId, role: GroupMemberRole.OWNER },
            data: { role: GroupMemberRole.ADMIN },
          });
          await tx.group.update({
            where: { id: groupId },
            data: { ownerId: memberUserId },
          });
        }
      } else if (group.ownerId === memberUserId) {
        throw new BadRequestException(
          'Transfer ownership to someone else before demoting the current owner',
        );
      }

      if (existing) {
        await tx.groupMember.update({
          where: { id: existing.id },
          data: {
            role,
            status: GroupMemberStatus.ACTIVE,
          },
        });
      } else {
        await tx.groupMember.create({
          data: {
            groupId,
            userId: memberUserId,
            role,
            status: GroupMemberStatus.ACTIVE,
          },
        });
        await tx.group.update({
          where: { id: groupId },
          data: { memberCount: { increment: 1 } },
        });
      }
    });

    await this.auditService.log({
      actorId: adminId,
      action: 'admin.group_member_role',
      targetType: 'GROUP',
      targetId: groupId,
      metadata: { memberUserId, role, created: !existing },
    });
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

  async hardDeleteGroup(adminId: string, groupId: string): Promise<void> {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Community not found');

    // Explicit dependents so file-mode (which historically lacked cascades) and
    // Postgres both leave a consistent store. Schema cascades cover the rest.
    await this.prisma.$transaction(async (tx) => {
      await tx.event.deleteMany({ where: { groupId } });
      await tx.groupMember.deleteMany({ where: { groupId } });
      await tx.follow.deleteMany({ where: { groupId } });
      await tx.conversation.deleteMany({ where: { groupId } });
      await tx.payment.updateMany({ where: { groupId }, data: { groupId: null } });
      await tx.group.delete({ where: { id: groupId } });
    });

    await this.auditService.log({
      actorId: adminId,
      action: 'admin.group_hard_delete',
      targetType: 'GROUP',
      targetId: groupId,
      metadata: { name: group.name, slug: group.slug },
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

  async hardDeleteEvent(adminId: string, eventId: string): Promise<void> {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    await this.prisma.event.delete({ where: { id: eventId } });
    await this.auditService.log({
      actorId: adminId,
      action: 'admin.event_hard_delete',
      targetType: 'EVENT',
      targetId: eventId,
      metadata: { title: event.title, status: event.status },
    });
  }

  async bulkSoftDeleteUsers(adminId: string, ids: string[]): Promise<{ deleted: number }> {
    const unique = [...new Set(ids)].filter((id) => id && id !== adminId);
    let deleted = 0;
    for (const id of unique) {
      try {
        await this.softDeleteUser(adminId, id);
        deleted += 1;
      } catch {
        // skip missing / already deleted
      }
    }
    await this.auditService.log({
      actorId: adminId,
      action: 'admin.bulk_user_delete',
      metadata: { requested: unique.length, deleted },
    });
    return { deleted };
  }

  async bulkHardDeleteUsers(adminId: string, ids: string[]): Promise<{ deleted: number }> {
    const unique = [...new Set(ids)].filter((id) => id && id !== adminId);
    let deleted = 0;
    for (const id of unique) {
      try {
        await this.hardDeleteUser(adminId, id);
        deleted += 1;
      } catch {
        // skip
      }
    }
    await this.auditService.log({
      actorId: adminId,
      action: 'admin.bulk_user_hard_delete',
      metadata: { requested: unique.length, deleted },
    });
    return { deleted };
  }

  async bulkRemoveGroups(adminId: string, ids: string[]): Promise<{ deleted: number }> {
    const unique = [...new Set(ids)].filter(Boolean);
    let deleted = 0;
    for (const id of unique) {
      try {
        await this.removeGroup(adminId, id);
        deleted += 1;
      } catch {
        // skip
      }
    }
    await this.auditService.log({
      actorId: adminId,
      action: 'admin.bulk_group_remove',
      metadata: { requested: unique.length, deleted },
    });
    return { deleted };
  }

  async bulkHardDeleteGroups(adminId: string, ids: string[]): Promise<{ deleted: number }> {
    const unique = [...new Set(ids)].filter(Boolean);
    let deleted = 0;
    for (const id of unique) {
      try {
        await this.hardDeleteGroup(adminId, id);
        deleted += 1;
      } catch {
        // skip
      }
    }
    await this.auditService.log({
      actorId: adminId,
      action: 'admin.bulk_group_hard_delete',
      metadata: { requested: unique.length, deleted },
    });
    return { deleted };
  }

  async bulkCancelEvents(adminId: string, ids: string[]): Promise<{ cancelled: number }> {
    const unique = [...new Set(ids)].filter(Boolean);
    let cancelled = 0;
    for (const id of unique) {
      try {
        await this.cancelEvent(adminId, id);
        cancelled += 1;
      } catch {
        // skip
      }
    }
    await this.auditService.log({
      actorId: adminId,
      action: 'admin.bulk_event_cancel',
      metadata: { requested: unique.length, cancelled },
    });
    return { cancelled };
  }

  async bulkHardDeleteEvents(adminId: string, ids: string[]): Promise<{ deleted: number }> {
    const unique = [...new Set(ids)].filter(Boolean);
    let deleted = 0;
    for (const id of unique) {
      try {
        await this.hardDeleteEvent(adminId, id);
        deleted += 1;
      } catch {
        // skip
      }
    }
    await this.auditService.log({
      actorId: adminId,
      action: 'admin.bulk_event_hard_delete',
      metadata: { requested: unique.length, deleted },
    });
    return { deleted };
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

  async listConversations(q: string | undefined, page: number, limit: number) {
    const where: Prisma.ConversationWhereInput = q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { group: { name: { contains: q, mode: 'insensitive' } } },
            {
              participants: {
                some: {
                  user: {
                    OR: [
                      { name: { contains: q, mode: 'insensitive' } },
                      { email: { contains: q, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            },
          ],
        }
      : {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        include: {
          group: { select: { id: true, name: true, slug: true } },
          participants: {
            include: {
              user: { select: { id: true, name: true, email: true, avatarUrl: true } },
            },
          },
          _count: { select: { messages: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return paginate(
      items.map(({ _count, ...rest }) => ({
        ...rest,
        messageCount: _count.messages,
      })),
      total,
      page,
      limit,
    );
  }

  async hardDeleteConversation(adminId: string, conversationId: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, type: true, title: true, groupId: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.message.deleteMany({ where: { conversationId } });
      await tx.conversationParticipant.deleteMany({ where: { conversationId } });
      await tx.conversation.delete({ where: { id: conversationId } });
    });

    await this.auditService.log({
      actorId: adminId,
      action: 'admin.conversation_hard_delete',
      targetType: 'CONVERSATION',
      targetId: conversationId,
      metadata: {
        type: conversation.type,
        title: conversation.title,
        groupId: conversation.groupId,
      },
    });
  }

  async bulkHardDeleteConversations(
    adminId: string,
    ids: string[],
  ): Promise<{ deleted: number }> {
    const unique = [...new Set(ids)].filter(Boolean);
    let deleted = 0;
    for (const id of unique) {
      try {
        await this.hardDeleteConversation(adminId, id);
        deleted += 1;
      } catch {
        // skip missing
      }
    }
    await this.auditService.log({
      actorId: adminId,
      action: 'admin.bulk_conversation_hard_delete',
      metadata: { requested: unique.length, deleted },
    });
    return { deleted };
  }

  async listFriendships(
    q: string | undefined,
    status: 'ACCEPTED' | 'PENDING' | undefined,
    page: number,
    limit: number,
  ) {
    const where: Prisma.FriendshipWhereInput = {
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { requester: { name: { contains: q, mode: 'insensitive' } } },
              { requester: { email: { contains: q, mode: 'insensitive' } } },
              { addressee: { name: { contains: q, mode: 'insensitive' } } },
              { addressee: { email: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.friendship.findMany({
        where,
        include: {
          requester: { select: { id: true, name: true, email: true, avatarUrl: true } },
          addressee: { select: { id: true, name: true, email: true, avatarUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.friendship.count({ where }),
    ]);
    return paginate(items, total, page, limit);
  }

  async removeFriendship(adminId: string, friendshipId: string): Promise<void> {
    const friendship = await this.prisma.friendship.findUnique({
      where: { id: friendshipId },
      include: {
        requester: { select: { id: true, name: true } },
        addressee: { select: { id: true, name: true } },
      },
    });
    if (!friendship) throw new NotFoundException('Friendship not found');

    await this.prisma.friendship.delete({ where: { id: friendshipId } });
    await this.auditService.log({
      actorId: adminId,
      action: 'admin.friendship_remove',
      targetType: 'FRIENDSHIP',
      targetId: friendshipId,
      metadata: {
        status: friendship.status,
        requesterId: friendship.requesterId,
        addresseeId: friendship.addresseeId,
        requesterName: friendship.requester.name,
        addresseeName: friendship.addressee.name,
      },
    });
  }

  async bulkRemoveFriendships(adminId: string, ids: string[]): Promise<{ removed: number }> {
    const unique = [...new Set(ids)].filter(Boolean);
    let removed = 0;
    for (const id of unique) {
      try {
        await this.removeFriendship(adminId, id);
        removed += 1;
      } catch {
        // skip
      }
    }
    await this.auditService.log({
      actorId: adminId,
      action: 'admin.bulk_friendship_remove',
      metadata: { requested: unique.length, removed },
    });
    return { removed };
  }
}
