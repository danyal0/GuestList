import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ActivityType,
  ConversationType,
  GroupMemberStatus,
  Message,
  NotificationType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GroupPermissionsService } from '../groups/group-permissions.service';
import { NOTIFY_EVENT, NotifyPayload } from '../notifications/notification.events';

const senderSelect = { id: true, name: true, avatarUrl: true };

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: GroupPermissionsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Finds or creates the 1:1 conversation between two users. */
  async openDirectConversation(userId: string, otherUserId: string) {
    if (userId === otherUserId) {
      throw new BadRequestException('You cannot message yourself');
    }
    const other = await this.prisma.user.findFirst({
      where: { id: otherUserId, deletedAt: null },
    });
    if (!other) throw new NotFoundException('User not found');

    const existing = await this.prisma.conversation.findFirst({
      where: {
        type: ConversationType.DIRECT,
        AND: [
          { participants: { some: { userId } } },
          { participants: { some: { userId: otherUserId } } },
        ],
      },
      include: { participants: { include: { user: { select: senderSelect } } } },
    });
    if (existing) return existing;

    return this.prisma.conversation.create({
      data: {
        type: ConversationType.DIRECT,
        participants: { create: [{ userId }, { userId: otherUserId }] },
      },
      include: { participants: { include: { user: { select: senderSelect } } } },
    });
  }

  /** Finds or creates the shared chat for a community (members only). */
  async openGroupConversation(userId: string, groupId: string) {
    await this.permissions.requireRole(groupId, userId, 'MEMBER');

    const existing = await this.prisma.conversation.findFirst({
      where: { type: ConversationType.GROUP, groupId },
    });

    const conversation =
      existing ??
      (await this.prisma.conversation.create({
        data: {
          type: ConversationType.GROUP,
          groupId,
          title: (await this.prisma.group.findUniqueOrThrow({ where: { id: groupId } })).name,
        },
      }));

    // Lazily enroll the member as a participant.
    await this.prisma.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId: conversation.id, userId } },
      create: { conversationId: conversation.id, userId },
      update: {},
    });

    return this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      include: { participants: { include: { user: { select: senderSelect } } } },
    });
  }

  async listConversations(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { participants: { some: { userId } } },
      include: {
        participants: { include: { user: { select: senderSelect } } },
        group: { select: { id: true, slug: true, name: true, coverImage: true } },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { sender: { select: senderSelect } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return Promise.all(
      conversations.map(async (c) => {
        const me = c.participants.find((p) => p.userId === userId);
        const unreadCount = await this.prisma.message.count({
          where: {
            conversationId: c.id,
            deletedAt: null,
            senderId: { not: userId },
            createdAt: me?.lastReadAt ? { gt: me.lastReadAt } : undefined,
          },
        });
        const { messages, ...rest } = c;
        return { ...rest, lastMessage: messages[0] ?? null, unreadCount };
      }),
    );
  }

  async getMessages(conversationId: string, userId: string, cursor?: string, limit = 50) {
    await this.requireParticipant(conversationId, userId);

    const messages = await this.prisma.message.findMany({
      where: { conversationId, deletedAt: null },
      include: { sender: { select: senderSelect } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = messages.length > limit;
    const page = hasMore ? messages.slice(0, limit) : messages;
    return {
      items: page.reverse(),
      nextCursor: hasMore ? page[0]?.id : undefined,
    };
  }

  async sendMessage(conversationId: string, senderId: string, content: string): Promise<Message> {
    const trimmed = content.trim();
    if (trimmed.length === 0) throw new BadRequestException('Message cannot be empty');
    if (trimmed.length > 4000) throw new BadRequestException('Message is too long');

    const conversation = await this.requireParticipant(conversationId, senderId);

    // For group chats, banned members lose access even if still participants.
    if (conversation.type === ConversationType.GROUP && conversation.groupId) {
      const membership = await this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: conversation.groupId, userId: senderId } },
      });
      if (!membership || membership.status !== GroupMemberStatus.ACTIVE) {
        throw new ForbiddenException('You can no longer send messages in this community');
      }
    }

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: { conversationId, senderId, content: trimmed },
        include: { sender: { select: senderSelect } },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
      this.prisma.activityLog.create({
        data: { userId: senderId, type: ActivityType.MESSAGE_SENT, metadata: { conversationId } },
      }),
    ]);

    this.eventEmitter.emit('realtime.message.created', { conversationId, message });

    // Notify offline participants (direct chats only — group chat pings would be noisy).
    if (conversation.type === ConversationType.DIRECT) {
      const others = await this.prisma.conversationParticipant.findMany({
        where: { conversationId, userId: { not: senderId } },
        select: { userId: true },
      });
      const sender = (message as Message & { sender: { name: string } }).sender;
      for (const p of others) {
        this.eventEmitter.emit(NOTIFY_EVENT, {
          userId: p.userId,
          type: NotificationType.MESSAGE_RECEIVED,
          payload: {
            conversationId,
            fromUserId: senderId,
            fromName: sender.name,
            preview: trimmed.slice(0, 120),
          },
        } satisfies NotifyPayload);
      }
    }

    return message;
  }

  async deleteMessage(messageId: string, userId: string): Promise<void> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt) throw new NotFoundException('Message not found');
    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only delete your own messages');
    }
    await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), content: '' },
    });
    this.eventEmitter.emit('realtime.message.deleted', {
      conversationId: message.conversationId,
      messageId,
    });
  }

  async markRead(conversationId: string, userId: string): Promise<void> {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!participant) throw new NotFoundException('Conversation not found');
    await this.prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: { lastReadAt: new Date() },
    });
  }

  /** Used by the realtime gateway to authorize room subscriptions. */
  async isParticipant(conversationId: string, userId: string): Promise<boolean> {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    return participant !== null;
  }

  private async requireParticipant(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: { where: { userId }, select: { id: true } } },
    });
    if (!conversation || conversation.participants.length === 0) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }
}
