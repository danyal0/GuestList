import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  EventStatus,
  FriendshipStatus,
  GroupMemberStatus,
  GroupPrivacy,
  NotificationType,
  RsvpStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { publicUserSelect, PublicUserSummary, normalizePublicSummary } from '../users/users.service';
import { NOTIFY_EVENT } from '../notifications/notification.events';
import { computeSpotsLeft } from '../common/utils/capacity';

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
        const status =
          friendship.status ??
          (friendship.respondedAt ? FriendshipStatus.ACCEPTED : FriendshipStatus.PENDING);
        friendshipStatus =
          status === FriendshipStatus.ACCEPTED
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

    if (await this.isBlockedEitherWay(requesterId, addresseeId)) {
      throw new ForbiddenException('You cannot send a friend request to this person');
    }

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
      const existingStatus =
        existing.status ??
        (existing.respondedAt ? FriendshipStatus.DECLINED : FriendshipStatus.PENDING);
      if (existingStatus === FriendshipStatus.ACCEPTED) {
        throw new ConflictException('You are already friends');
      }
      if (existingStatus === FriendshipStatus.PENDING) {
        throw new ConflictException('A friend request is already pending');
      }
      // A previously declined request can be retried.
      const updated = await this.prisma.friendship.update({
        where: { id: existing.id },
        data: { requesterId, addresseeId, status: FriendshipStatus.PENDING, respondedAt: null },
      });
      friendshipId = updated.id;
    } else {
      const created = await this.prisma.friendship.create({
        data: { requesterId, addresseeId, status: FriendshipStatus.PENDING },
      });
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
    const pendingStatus =
      friendship?.status ??
      (friendship?.respondedAt ? FriendshipStatus.DECLINED : FriendshipStatus.PENDING);
    if (!friendship || pendingStatus !== FriendshipStatus.PENDING) {
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

  async cancelFriendRequest(requesterId: string, addresseeId: string): Promise<void> {
    if (requesterId === addresseeId) {
      throw new BadRequestException('Invalid friend request');
    }
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        requesterId,
        addresseeId,
        status: FriendshipStatus.PENDING,
      },
    });
    if (!friendship) throw new NotFoundException('Friend request not found');
    await this.prisma.friendship.delete({ where: { id: friendship.id } });
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

  async removeFriend(userId: string, otherUserId: string): Promise<void> {
    if (userId === otherUserId) {
      throw new BadRequestException('Invalid friend');
    }
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [
          { requesterId: userId, addresseeId: otherUserId },
          { requesterId: otherUserId, addresseeId: userId },
        ],
      },
    });
    if (!friendship) throw new NotFoundException('Friendship not found');
    await this.prisma.friendship.delete({ where: { id: friendship.id } });
  }

  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) {
      throw new BadRequestException('You cannot block yourself');
    }
    const target = await this.prisma.user.findFirst({
      where: { id: blockedId, deletedAt: null },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('User not found');

    await this.prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });

    // Remove any friendship or pending request both ways.
    await this.prisma.friendship.deleteMany({
      where: {
        OR: [
          { requesterId: blockerId, addresseeId: blockedId },
          { requesterId: blockedId, addresseeId: blockerId },
        ],
      },
    });
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    await this.prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
  }

  async listBlockedUsers(blockerId: string): Promise<PublicUserSummary[]> {
    const blocks = await this.prisma.userBlock.findMany({
      where: { blockerId },
      include: { blocked: { select: publicUserSelect } },
      orderBy: { createdAt: 'desc' },
    });
    return blocks.map((b) => normalizePublicSummary(b.blocked));
  }

  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    const hit = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
      select: { id: true },
    });
    return hit != null;
  }

  /** Communities the profile belongs to (public/private only for non-self viewers). */
  async listProfileCommunities(profileId: string, viewerId?: string) {
    await this.requireActiveUser(profileId);
    const memberships = await this.prisma.groupMember.findMany({
      where: {
        userId: profileId,
        status: GroupMemberStatus.ACTIVE,
        group: {
          deletedAt: null,
          ...(viewerId === profileId
            ? {}
            : { privacy: { in: [GroupPrivacy.PUBLIC, GroupPrivacy.PRIVATE] } }),
        },
      },
      include: {
        group: {
          select: {
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
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });
    return memberships.map((m) => ({ ...m.group, memberRole: m.role }));
  }

  /** Events attended (past GOING) or hosted for a profile. */
  async listProfileEvents(
    profileId: string,
    kind: 'attended' | 'hosted',
    _viewerId?: string,
  ) {
    await this.requireActiveUser(profileId);

    if (kind === 'hosted') {
      const events = await this.prisma.event.findMany({
        where: {
          hostId: profileId,
          status: { in: [EventStatus.PUBLISHED, EventStatus.CANCELLED, EventStatus.COMPLETED] },
          group: { deletedAt: null },
        },
        include: {
          group: { select: { id: true, slug: true, name: true, coverImage: true, category: true } },
          host: { select: { id: true, name: true, avatarUrl: true } },
          _count: { select: { rsvps: { where: { status: RsvpStatus.GOING } } } },
        },
        orderBy: { startTime: 'desc' },
        take: 50,
      });
      return events.map((e) => this.toEventSummary(e));
    }

    const rsvps = await this.prisma.rsvp.findMany({
      where: {
        userId: profileId,
        status: RsvpStatus.GOING,
        event: {
          endTime: { lt: new Date() },
          status: { in: [EventStatus.PUBLISHED, EventStatus.CANCELLED, EventStatus.COMPLETED] },
          group: { deletedAt: null },
        },
      },
      include: {
        event: {
          include: {
            group: { select: { id: true, slug: true, name: true, coverImage: true, category: true } },
            host: { select: { id: true, name: true, avatarUrl: true } },
            _count: { select: { rsvps: { where: { status: RsvpStatus.GOING } } } },
          },
        },
      },
      orderBy: { event: { startTime: 'desc' } },
      take: 50,
    });
    return rsvps.map((r) => this.toEventSummary(r.event));
  }

  async listProfileFriends(profileId: string, viewerId?: string): Promise<PublicUserSummary[]> {
    await this.requireActiveUser(profileId);
    // Friends list is visible to the owner and to signed-in viewers (not blocked).
    if (viewerId && viewerId !== profileId && (await this.isBlockedEitherWay(viewerId, profileId))) {
      throw new ForbiddenException('Profile unavailable');
    }
    return this.getFriends(profileId);
  }

  private async requireActiveUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
  }

  private toEventSummary(event: {
    id: string;
    groupId: string;
    title: string;
    description: string;
    coverImage: string | null;
    mode: string;
    locationName: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    onlineUrl: string | null;
    timezone: string;
    startTime: Date;
    endTime: Date;
    previousStartTime?: Date | null;
    rescheduledAt?: Date | null;
    capacity: number | null;
    status: string;
    group: { id: string; slug: string; name: string; coverImage: string | null; category: string };
    host: { id: string; name: string; avatarUrl: string | null };
    _count: { rsvps: number };
  }) {
    const goingCount = event._count.rsvps;
    return {
      id: event.id,
      groupId: event.groupId,
      title: event.title,
      description: event.description,
      coverImage: event.coverImage,
      mode: event.mode,
      locationName: event.locationName,
      address: event.address,
      latitude: event.latitude,
      longitude: event.longitude,
      onlineUrl: event.onlineUrl,
      timezone: event.timezone,
      startTime: event.startTime,
      endTime: event.endTime,
      previousStartTime: event.previousStartTime ?? null,
      rescheduledAt: event.rescheduledAt ?? null,
      capacity: event.capacity,
      status: event.status,
      goingCount,
      spotsLeft: computeSpotsLeft(event.capacity, goingCount),
      group: event.group,
      host: event.host,
    };
  }
}
