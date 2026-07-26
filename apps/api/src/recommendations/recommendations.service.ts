import { Injectable } from '@nestjs/common';
import {
  EventStatus,
  EventVisibility,
  GroupCategory,
  GroupMemberStatus,
  GroupPrivacy,
  RsvpStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../profiles/profiles.service';
import { haversineKm } from '../common/utils/geo';

/**
 * Rule-based recommendation engine (v1).
 *
 * Scoring signals and weights are deliberately explicit and centralized so
 * the eventual ML pipeline (feature extraction → offline training → ranker
 * service) can replace `scoreGroup`/`scoreEvent` while keeping the candidate
 * generation and API contract identical. Signals:
 *   - interest ↔ category/text match
 *   - geographic proximity
 *   - historical attendance categories
 *   - friends who are members
 *   - overall popularity (log-scaled so big communities don't dominate)
 */
const WEIGHTS = {
  interestMatch: 3.0,
  attendedCategory: 2.5,
  friendMember: 2.0,
  proximity: 2.0,
  popularity: 1.0,
  followedCategory: 1.5,
};

const CANDIDATE_POOL = 200;

interface UserContext {
  interests: string[];
  latitude: number | null;
  longitude: number | null;
  memberGroupIds: Set<string>;
  attendedCategories: Map<GroupCategory, number>;
  followedCategories: Set<GroupCategory>;
  friendGroupIds: Map<string, number>;
}

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesService: ProfilesService,
  ) {}

  async recommendGroups(userId: string, limit = 12) {
    const ctx = await this.buildUserContext(userId);

    const candidates = await this.prisma.group.findMany({
      where: {
        deletedAt: null,
        privacy: { in: [GroupPrivacy.PUBLIC, GroupPrivacy.PRIVATE] },
        id: { notIn: [...ctx.memberGroupIds] },
      },
      orderBy: { memberCount: 'desc' },
      take: CANDIDATE_POOL,
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        coverImage: true,
        category: true,
        memberCount: true,
        location: true,
        latitude: true,
        longitude: true,
      },
    });

    return candidates
      .map((group) => ({ ...group, score: this.scoreGroup(group, ctx) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async recommendEvents(userId: string, limit = 12) {
    const ctx = await this.buildUserContext(userId);

    const rsvped = await this.prisma.rsvp.findMany({
      where: { userId },
      select: { eventId: true },
    });
    const rsvpedIds = new Set(rsvped.map((r) => r.eventId));

    const candidates = await this.prisma.event.findMany({
      where: {
        status: EventStatus.PUBLISHED,
        visibility: EventVisibility.PUBLIC,
        startTime: { gte: new Date() },
        group: { deletedAt: null, privacy: { not: GroupPrivacy.HIDDEN } },
      },
      orderBy: { startTime: 'asc' },
      take: CANDIDATE_POOL,
      include: {
        group: { select: { id: true, slug: true, name: true, category: true, coverImage: true } },
        _count: { select: { rsvps: { where: { status: RsvpStatus.GOING } } } },
      },
    });

    return candidates
      .filter((e) => !rsvpedIds.has(e.id))
      .map((event) => {
        const { _count, ...rest } = event;
        return {
          ...rest,
          goingCount: _count.rsvps,
          score: this.scoreEvent(event, _count.rsvps, ctx),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private scoreGroup(
    group: {
      category: GroupCategory;
      name: string;
      description: string;
      memberCount: number;
      latitude: number | null;
      longitude: number | null;
      id: string;
    },
    ctx: UserContext,
  ): number {
    let score = 0;
    score += WEIGHTS.interestMatch * this.interestAffinity(group.category, `${group.name} ${group.description}`, ctx);
    score += WEIGHTS.attendedCategory * Math.min(1, (ctx.attendedCategories.get(group.category) ?? 0) / 3);
    score += WEIGHTS.followedCategory * (ctx.followedCategories.has(group.category) ? 1 : 0);
    score += WEIGHTS.friendMember * Math.min(1, (ctx.friendGroupIds.get(group.id) ?? 0) / 2);
    score += WEIGHTS.proximity * this.proximityScore(group.latitude, group.longitude, ctx);
    score += WEIGHTS.popularity * Math.min(1, Math.log10(group.memberCount + 1) / 4);
    return Math.round(score * 1000) / 1000;
  }

  private scoreEvent(
    event: {
      title: string;
      description: string;
      latitude: number | null;
      longitude: number | null;
      startTime: Date;
      group: { id: string; category: GroupCategory };
    },
    goingCount: number,
    ctx: UserContext,
  ): number {
    let score = 0;
    score += WEIGHTS.interestMatch * this.interestAffinity(event.group.category, `${event.title} ${event.description}`, ctx);
    score += WEIGHTS.attendedCategory * Math.min(1, (ctx.attendedCategories.get(event.group.category) ?? 0) / 3);
    score += WEIGHTS.friendMember * Math.min(1, (ctx.friendGroupIds.get(event.group.id) ?? 0) / 2);
    score += WEIGHTS.proximity * this.proximityScore(event.latitude, event.longitude, ctx);
    score += WEIGHTS.popularity * Math.min(1, Math.log10(goingCount + 1) / 3);
    // Slight boost for events happening soon (within 2 weeks).
    const daysAway = (event.startTime.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysAway <= 14) score += 0.5 * (1 - daysAway / 14);
    // Belonging to one of the user's groups is a strong signal.
    if (ctx.memberGroupIds.has(event.group.id)) score += 2;
    return Math.round(score * 1000) / 1000;
  }

  private interestAffinity(category: GroupCategory, text: string, ctx: UserContext): number {
    if (ctx.interests.length === 0) return 0;
    const lowerText = text.toLowerCase();
    const categoryWord = category.toLowerCase();
    let hits = 0;
    for (const interest of ctx.interests) {
      const term = interest.toLowerCase();
      if (categoryWord.includes(term) || term.includes(categoryWord) || lowerText.includes(term)) {
        hits += 1;
      }
    }
    return Math.min(1, hits / 2);
  }

  private proximityScore(lat: number | null, lng: number | null, ctx: UserContext): number {
    if (lat === null || lng === null || ctx.latitude === null || ctx.longitude === null) return 0;
    const km = haversineKm(ctx.latitude, ctx.longitude, lat, lng);
    if (km <= 5) return 1;
    if (km >= 200) return 0;
    return 1 - km / 200;
  }

  private async buildUserContext(userId: string): Promise<UserContext> {
    const [user, memberships, attendance, follows, friendIds] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { interests: true, latitude: true, longitude: true },
      }),
      this.prisma.groupMember.findMany({
        where: { userId, status: GroupMemberStatus.ACTIVE },
        select: { groupId: true },
      }),
      this.prisma.rsvp.findMany({
        where: { userId, status: RsvpStatus.GOING },
        select: { event: { select: { group: { select: { category: true } } } } },
        take: 100,
      }),
      this.prisma.follow.findMany({
        where: { userId },
        select: { group: { select: { category: true } } },
      }),
      this.profilesService.getFriendIds(userId),
    ]);

    const attendedCategories = new Map<GroupCategory, number>();
    for (const rsvp of attendance) {
      const cat = rsvp.event.group.category;
      attendedCategories.set(cat, (attendedCategories.get(cat) ?? 0) + 1);
    }

    const friendGroupIds = new Map<string, number>();
    if (friendIds.length > 0) {
      const friendMemberships = await this.prisma.groupMember.findMany({
        where: { userId: { in: friendIds }, status: GroupMemberStatus.ACTIVE },
        select: { groupId: true },
      });
      for (const m of friendMemberships) {
        friendGroupIds.set(m.groupId, (friendGroupIds.get(m.groupId) ?? 0) + 1);
      }
    }

    return {
      interests: user.interests,
      latitude: user.latitude,
      longitude: user.longitude,
      memberGroupIds: new Set(memberships.map((m) => m.groupId)),
      attendedCategories,
      followedCategories: new Set(follows.map((f) => f.group.category)),
      friendGroupIds,
    };
  }
}
