import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { haversineKm } from '../common/utils/geo';
import {
  EventSearchHit,
  GroupSearchHit,
  SearchFilters,
  SearchProvider,
  UserSearchHit,
} from './search-provider.interface';

/**
 * Simple substring search over the file-backed store (no Postgres FTS).
 */
@Injectable()
export class FileSearchProvider implements SearchProvider {
  constructor(private readonly prisma: PrismaService) {}

  async searchGroups(f: SearchFilters): Promise<GroupSearchHit[]> {
    const q = f.query.toLowerCase();
    const groups = await this.prisma.group.findMany({
      where: {
        deletedAt: null,
        privacy: { not: 'HIDDEN' },
        ...(f.category ? { category: f.category } : {}),
      },
    });

    let hits = groups
      .filter((g) =>
        `${g.name} ${g.description} ${g.location ?? ''}`.toLowerCase().includes(q),
      )
      .map((g) => {
        const distanceKm =
          f.lat !== undefined &&
          f.lng !== undefined &&
          g.latitude != null &&
          g.longitude != null
            ? Math.round(haversineKm(f.lat, f.lng, g.latitude, g.longitude) * 10) / 10
            : null;
        return {
          id: g.id,
          slug: g.slug,
          name: g.name,
          description: g.description,
          coverImage: g.coverImage,
          category: g.category,
          memberCount: g.memberCount,
          location: g.location,
          distanceKm,
          rank: 1,
        } satisfies GroupSearchHit;
      });

    if (f.radiusKm !== undefined) {
      hits = hits.filter((h) => h.distanceKm == null || h.distanceKm <= f.radiusKm!);
    }

    hits.sort((a, b) => {
      if (f.sort === 'popularity') return b.memberCount - a.memberCount;
      if (f.sort === 'distance') return (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9);
      return a.name.localeCompare(b.name);
    });

    return hits.slice(f.offset, f.offset + f.limit);
  }

  async searchEvents(f: SearchFilters): Promise<EventSearchHit[]> {
    const q = f.query.toLowerCase();
    const events = await this.prisma.event.findMany({
      where: {
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        startTime: { gte: f.from ?? new Date(), ...(f.to ? { lte: f.to } : {}) },
      },
      include: { group: true },
    });

    let hits: EventSearchHit[] = [];
    for (const e of events) {
      const group = e.group as {
        name: string;
        slug: string;
        deletedAt: Date | null;
        privacy: string;
        category: string;
      };
      if (!group || group.deletedAt || group.privacy === 'HIDDEN') continue;
      if (f.category && group.category !== f.category) continue;
      if (!`${e.title} ${e.description} ${e.locationName ?? ''}`.toLowerCase().includes(q)) continue;

      const goingCount = await this.prisma.rsvp.count({
        where: { eventId: e.id, status: 'GOING' },
      });
      const distanceKm =
        f.lat !== undefined &&
        f.lng !== undefined &&
        e.latitude != null &&
        e.longitude != null
          ? Math.round(haversineKm(f.lat, f.lng, e.latitude, e.longitude) * 10) / 10
          : null;

      hits.push({
        id: e.id,
        title: e.title,
        description: e.description,
        coverImage: e.coverImage,
        mode: e.mode,
        locationName: e.locationName,
        startTime: e.startTime,
        endTime: e.endTime,
        groupId: e.groupId,
        groupName: group.name,
        groupSlug: group.slug,
        goingCount,
        distanceKm,
        rank: 1,
      });
    }

    if (f.radiusKm !== undefined) {
      hits = hits.filter((h) => h.distanceKm == null || h.distanceKm <= f.radiusKm!);
    }

    hits.sort((a, b) => {
      if (f.sort === 'popularity') return b.goingCount - a.goingCount;
      if (f.sort === 'distance') return (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9);
      return a.startTime.getTime() - b.startTime.getTime();
    });

    return hits.slice(f.offset, f.offset + f.limit);
  }

  async searchUsers(f: SearchFilters): Promise<UserSearchHit[]> {
    const q = f.query.toLowerCase();
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, suspendedAt: null },
    });
    return users
      .filter((u) => u.name.toLowerCase().includes(q))
      .slice(f.offset, f.offset + f.limit)
      .map((u) => ({
        id: u.id,
        name: u.name,
        avatarUrl: u.avatarUrl,
        location: u.location,
        bio: u.bio,
      }));
  }
}
