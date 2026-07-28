import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FriendshipStatus, GroupMemberStatus, NotificationType, RsvpStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { publicUserSelect, PublicUserSummary, normalizePublicSummary } from '../users/users.service';
import { NOTIFY_EVENT } from '../notifications/notification.events';

export interface ProfileView {
  user: PublicUserSummary;
  stats: {
    groupsJoined: number;
    eventsAttended: number;
    eventsHosted: number;
    friends: number;
    following: number;
  };
  friendshipStatus: 'none' | 'pending_sent' | 'pending_received' | 'friends';
}

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getProfile(profileId: string, viewerId?: string): Promise<ProfileView> {
    const user = await this.prisma.user.findFirst({
      where: { id: profileId, deletedAt: null },
      select: publicUserSelect,
    });
    if (!user) throw new NotFoundException('User not found');

    const [groupsJoined, eventsAttended, eventsHosted, friends, following] =
      await this.prisma.$transaction([
        this.prisma.groupMember.count({
          where: { userId: profileId, status: GroupMemberStatus.ACTIVE },
        }),
        this.prisma.rsvp.count({
          where: {
            userId: profileId,
            status: RsvpStatus.GOING,
            event: { endTime: { lt: new Date() } },
          },
        }),
        this.prisma.event.count({ where: { hostId: profileId } }),
        this.prisma.friendship.count({
          where: {
            status: FriendshipStatus.ACCEPTED,
            OR: [{ requesterId: profileId }, { addresseeId: profileId }],
          },
        }),
        this.prisma.follow.count({ where: { userId: profileId } }),
      ]);

    let friendshipStatus: ProfileView['friendshipStatus'] = 'none';
    if (viewerId && viewerId !== profileId) {
      const friendship = await this.prisma.friendship.findFirst({
        where: {
          OR: [
            { requesterId: viewerId, addresseeId: profileId },
            { requesterId: profileId, addresseeId: viewerId },
          ],
          status: { in: [FriendshipStatus.PENDING, FriendshipStatus.ACCEPTED] },
        },
      });
      if (friendship) {
        friendshipStatus =
          friendship.status === FriendshipStatus.ACCEPTED
            ? 'friends'
            : friendship.requesterId === viewerId
              ? 'pending_sent'
              : 'pending_received';
      }
    }

    return {
      user: normalizePublicSummary({
        ...user,
        name: user.name?.trim() || 'Member',
      }),
      stats: { groupsJoined, eventsAttended, eventsHosted, friends, following },
      friendshipStatus,
    };
  }

  // ───────────────────── Follows (communities) ─────────────────────

  async followGroup(userId: string, groupId: string): Promise<void> {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deletedAt: null },
    });
    if (!group) throw new NotFoundException('Community not found');

    try {
      await this.prisma.follow.create({ data: { userId, groupId } });
    } catch {
      throw new ConflictException('Already following this community');
    }
  }

  async unfollowGroup(userId: string, groupId: string): Promise<void> {
    await this.prisma.follow.deleteMany({ where: { userId, groupId } });
  }

  async getFollowedGroups(userId: string) {
    const follows = await this.prisma.follow.findMany({
      where: { userId },
      include: {
        group: {
          select: {
            id: true,
            slug: true,
            name: true,
            coverImage: true,
            category: true,
            memberCount: true,
            privacy: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return follows.map((f) => f.group);
  }

  // ───────────────────── Friendships ─────────────────────

  async sendFriendRequest(requesterId: string, addresseeId: string): Promise<void> {
    if (requesterId === addresseeId) {
      throw new BadRequestException('You cannot add yourself as a friend');
    }
    const addressee = await this.prisma.user.findFirst({
      where: { id: addresseeId, deletedAt: null },
    });
    if (!addressee) throw new NotFoundException('User not found');

    const existing = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId, addresseeId },
          { requesterId: addresseeId, addresseeId: requesterId },
        ],
      },
    });

    let friendshipId: string;
    if (existing) {
      if (existing.status === FriendshipStatus.ACCEPTED) {
        throw new ConflictException('You are already friends');
      }
      if (existing.status === FriendshipStatus.PENDING) {
        throw new ConflictException('A friend request is already pending');
      }
      // A previously declined request can be retried.
      const updated = await this.prisma.friendship.update({
        where: { id: existing.id },
        data: { requesterId, addresseeId, status: FriendshipStatus.PENDING, respondedAt: null },
      });
      friendshipId = updated.id;
    } else {
      const created = await this.prisma.friendship.create({ data: { requesterId, addresseeId } });
      friendshipId = created.id;
    }

    const requester = await this.prisma.user.findUniqueOrThrow({
      where: { id: requesterId },
      select: { name: true },
    });
    this.eventEmitter.emit(NOTIFY_EVENT, {
      userId: addresseeId,
      type: NotificationType.FRIEND_REQUEST,
      payload: {
        fromUserId: requesterId,
        fromName: requester.name,
        friendshipId,
      },
    });
  }

  async respondToFriendRequest(userId: string, friendshipIdOrRequesterId: string, accept: boolean): Promise<void> {
    let friendship = await this.prisma.friendship.findUnique({
      where: { id: friendshipIdOrRequesterId },
    });
    // Notifications created before friendshipId was in the payload only have fromUserId —
    // also allow responding by requester id for pending inbound requests.
    if (!friendship) {
      friendship = await this.prisma.friendship.findFirst({
        where: {
          addresseeId: userId,
          requesterId: friendshipIdOrRequesterId,
          status: FriendshipStatus.PENDING,
        },
      });
    }
    if (!friendship || friendship.status !== FriendshipStatus.PENDING) {
      throw new NotFoundException('Friend request not found');
    }
    if (friendship.addresseeId !== userId) {
      throw new ForbiddenException('Only the recipient can respond to this request');
    }

    await this.prisma.friendship.update({
      where: { id: friendship.id },
      data: {
        status: accept ? FriendshipStatus.ACCEPTED : FriendshipStatus.DECLINED,
        respondedAt: new Date(),
      },
    });

    if (accept) {
      const addressee = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { name: true },
      });
      this.eventEmitter.emit(NOTIFY_EVENT, {
        userId: friendship.requesterId,
        type: NotificationType.FRIEND_ACCEPTED,
        payload: { fromUserId: userId, fromName: addressee.name },
      });
    }
  }

  async getFriends(userId: string): Promise<PublicUserSummary[]> {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      include: {
        requester: { select: publicUserSelect },
        addressee: { select: publicUserSelect },
      },
    });
    return friendships.map((f) =>
      normalizePublicSummary(f.requesterId === userId ? f.addressee : f.requester),
    );
  }

  async getPendingRequests(userId: string) {
    return this.prisma.friendship.findMany({
      where: { addresseeId: userId, status: FriendshipStatus.PENDING },
      include: { requester: { select: publicUserSelect } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Friend ids used by the recommendation engine's social signal. */
  async getFriendIds(userId: string): Promise<string[]> {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      select: { requesterId: true, addresseeId: true },
    });
    return friendships.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId));
  }
}
