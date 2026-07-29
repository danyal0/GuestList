import { Injectable } from '@nestjs/common';
import { EventMode, EventStatus, GroupCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MILWAUKEE_TENNIS_VENUES,
  resolveCatalogVenue,
  type CatalogVenue,
} from '../whatsapp/whatsapp-event-enrich';
import { askXaiJson } from './xai-json';

export type EventSuggestionFields = {
  title?: string;
  description?: string;
  mode?: EventMode;
  locationName?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  capacity?: number;
  onlineUrl?: string;
  durationMinutes?: number;
};

export type GroupSuggestionFields = {
  name?: string;
  description?: string;
  category?: GroupCategory;
  location?: string;
  rules?: string;
};

export type SuggestionItem<T> = {
  id: string;
  source: 'event' | 'group' | 'venue' | 'ai' | 'heuristic';
  label: string;
  subtitle?: string;
  confidence: number;
  fields: T;
};

const SPORT_KEYWORDS: Array<{ pattern: RegExp; sport: string; category: GroupCategory }> = [
  { pattern: /\btennis\b/i, sport: 'tennis', category: GroupCategory.SPORTS },
  { pattern: /\bpickleball\b/i, sport: 'pickleball', category: GroupCategory.SPORTS },
  { pattern: /\bbasketball\b/i, sport: 'basketball', category: GroupCategory.SPORTS },
  { pattern: /\bsoccer\b|\bfootball\b/i, sport: 'soccer', category: GroupCategory.SPORTS },
  { pattern: /\bvoleyball\b|\bvolleyball\b/i, sport: 'volleyball', category: GroupCategory.SPORTS },
  { pattern: /\bhike\b|\bhiking\b|\btrail\b/i, sport: 'hiking', category: GroupCategory.OUTDOORS },
  { pattern: /\brun\b|\brunning\b|\b5k\b/i, sport: 'running', category: GroupCategory.SPORTS },
  { pattern: /\byoga\b/i, sport: 'yoga', category: GroupCategory.HEALTH },
  { pattern: /\bcycling\b|\bbike\b|\bbiking\b/i, sport: 'cycling', category: GroupCategory.OUTDOORS },
];

@Injectable()
export class SuggestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async suggestEvents(q: string, groupId?: string): Promise<{ items: SuggestionItem<EventSuggestionFields>[] }> {
    const query = q.trim();
    const items: SuggestionItem<EventSuggestionFields>[] = [];

    const venue = resolveCatalogVenue(query) ?? this.fuzzyVenue(query);
    if (venue) {
      items.push(this.venueToEventSuggestion(venue.venue, venue.matchedAlias, query));
    }

    const eventMatches = await this.findSimilarEvents(query, groupId);
    for (const event of eventMatches) {
      items.push({
        id: `event:${event.id}`,
        source: 'event',
        label: event.title,
        subtitle: [event.locationName, event.group.name].filter(Boolean).join(' · ') || undefined,
        confidence: 0.9,
        fields: {
          title: event.title,
          description: event.description,
          mode: event.mode,
          locationName: event.locationName ?? undefined,
          address: event.address ?? undefined,
          latitude: event.latitude ?? undefined,
          longitude: event.longitude ?? undefined,
          capacity: event.capacity ?? undefined,
          onlineUrl: event.onlineUrl ?? undefined,
          durationMinutes: Math.max(
            30,
            Math.round((event.endTime.getTime() - event.startTime.getTime()) / 60_000),
          ),
        },
      });
    }

    const heuristic = this.heuristicEvent(query, venue?.venue);
    if (heuristic && !items.some((i) => i.source === 'venue' || i.source === 'heuristic')) {
      items.push(heuristic);
    } else if (heuristic && items.every((i) => i.source === 'event')) {
      items.push(heuristic);
    }

    if (items.length === 0 || (items.length < 2 && !items.some((i) => i.source === 'ai'))) {
      const ai = await this.aiEventSuggestion(query, venue?.venue);
      if (ai) items.push(ai);
    }

    return { items: this.dedupeByLabel(items).slice(0, 8) };
  }

  async suggestGroups(q: string): Promise<{ items: SuggestionItem<GroupSuggestionFields>[] }> {
    const query = q.trim();
    const items: SuggestionItem<GroupSuggestionFields>[] = [];

    const groups = await this.prisma.group.findMany({
      where: {
        deletedAt: null,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { location: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { memberCount: 'desc' },
      take: 6,
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        location: true,
        rules: true,
        memberCount: true,
      },
    });

    for (const group of groups) {
      items.push({
        id: `group:${group.id}`,
        source: 'group',
        label: group.name,
        subtitle: `${group.category.replace(/_/g, ' ').toLowerCase()} · ${group.memberCount} members`,
        confidence: 0.88,
        fields: {
          name: group.name,
          description: group.description,
          category: group.category,
          location: group.location ?? undefined,
          rules: group.rules ?? undefined,
        },
      });
    }

    const venue = resolveCatalogVenue(query) ?? this.fuzzyVenue(query);
    const sport = this.detectSport(query);
    if (venue || sport) {
      items.push(this.heuristicGroup(query, venue?.venue, sport));
    }

    if (items.length === 0 || (items.length < 2 && !items.some((i) => i.source === 'ai'))) {
      const ai = await this.aiGroupSuggestion(query);
      if (ai) items.push(ai);
    }

    return { items: this.dedupeByLabel(items).slice(0, 8) };
  }

  private async findSimilarEvents(query: string, groupId?: string) {
    const where: Prisma.EventWhereInput = {
      status: { in: [EventStatus.PUBLISHED, EventStatus.COMPLETED, EventStatus.CANCELLED] },
      parentEventId: null,
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { locationName: { contains: query, mode: 'insensitive' } },
        { address: { contains: query, mode: 'insensitive' } },
      ],
      ...(groupId ? { groupId } : {}),
    };

    return this.prisma.event.findMany({
      where,
      orderBy: { startTime: 'desc' },
      take: 6,
      include: { group: { select: { id: true, name: true, slug: true } } },
    });
  }

  private fuzzyVenue(query: string): { venue: CatalogVenue; matchedAlias: string } | null {
    const hay = query.toLowerCase();
    let best: { venue: CatalogVenue; matchedAlias: string; score: number } | null = null;
    for (const venue of MILWAUKEE_TENNIS_VENUES) {
      const candidates = [venue.name, venue.slug.replace(/-/g, ' '), ...venue.aliases];
      for (const alias of candidates) {
        const a = alias.toLowerCase();
        if (a.includes(hay) || hay.includes(a)) {
          const score = Math.min(a.length, hay.length);
          if (!best || score > best.score) best = { venue, matchedAlias: alias, score };
        }
      }
    }
    return best ? { venue: best.venue, matchedAlias: best.matchedAlias } : null;
  }

  private venueToEventSuggestion(
    venue: CatalogVenue,
    matchedAlias: string,
    query: string,
  ): SuggestionItem<EventSuggestionFields> {
    const sport = venue.sport.toLowerCase();
    const titleHint = this.detectSport(query)?.sport ?? sport;
    return {
      id: `venue:${venue.slug}`,
      source: 'venue',
      label: `${this.titleCase(titleHint)} at ${venue.name}`,
      subtitle: venue.address,
      confidence: 0.85,
      fields: {
        title: `${this.titleCase(titleHint)} at ${venue.name}`,
        description: [
          `Meet at ${venue.name} for ${titleHint}.`,
          venue.notes || '',
          'Bring water and arrive a few minutes early.',
        ]
          .filter(Boolean)
          .join(' '),
        mode: EventMode.IN_PERSON,
        locationName: venue.name,
        address: venue.address,
        latitude: venue.latitude,
        longitude: venue.longitude,
        capacity: venue.defaultCapacity ?? undefined,
        durationMinutes: 90,
      },
    };
  }

  private heuristicEvent(
    query: string,
    venue?: CatalogVenue,
  ): SuggestionItem<EventSuggestionFields> | null {
    const sport = this.detectSport(query);
    if (!sport && !venue) return null;
    const sportLabel = sport?.sport ?? venue?.sport.toLowerCase() ?? 'meetup';
    const place = venue?.name ?? this.extractPlace(query);
    const title = place
      ? `${this.titleCase(sportLabel)} at ${place}`
      : `${this.titleCase(sportLabel)} meetup`;
    return {
      id: `heuristic:event:${title.toLowerCase().replace(/\s+/g, '-')}`,
      source: 'heuristic',
      label: title,
      subtitle: venue?.address ?? 'Suggested from what you typed',
      confidence: 0.6,
      fields: {
        title,
        description: `Join us for ${sportLabel}${place ? ` at ${place}` : ''}. All skill levels welcome — RSVP so we know you're coming.`,
        mode: EventMode.IN_PERSON,
        locationName: place ?? venue?.name,
        address: venue?.address,
        latitude: venue?.latitude,
        longitude: venue?.longitude,
        capacity: venue?.defaultCapacity ?? (sportLabel === 'tennis' ? 16 : undefined),
        durationMinutes: 90,
      },
    };
  }

  private heuristicGroup(
    query: string,
    venue: CatalogVenue | undefined,
    sport: { sport: string; category: GroupCategory } | null,
  ): SuggestionItem<GroupSuggestionFields> {
    const sportLabel = sport?.sport ?? venue?.sport.toLowerCase() ?? 'community';
    const city = venue?.city ?? 'Milwaukee';
    const name = `${city} ${this.titleCase(sportLabel)} Club`;
    return {
      id: `heuristic:group:${name.toLowerCase().replace(/\s+/g, '-')}`,
      source: 'heuristic',
      label: name,
      subtitle: 'Suggested community from venue / sport',
      confidence: 0.62,
      fields: {
        name,
        description: `A friendly ${sportLabel} community in ${city}. We organize regular meetups, welcome all skill levels, and keep things welcoming.`,
        category: sport?.category ?? GroupCategory.SPORTS,
        location: venue ? `${venue.city}, ${venue.region}` : city,
        rules: '1. Be kind.\n2. Show up when you RSVP.\n3. Help newcomers feel welcome.',
      },
    };
  }

  private async aiEventSuggestion(
    query: string,
    venue?: CatalogVenue,
  ): Promise<SuggestionItem<EventSuggestionFields> | null> {
    const parsed = await askXaiJson<{
      title?: string;
      description?: string;
      mode?: string;
      locationName?: string;
      address?: string;
      capacity?: number;
      durationMinutes?: number;
    }>({
      system: `You help hosts draft community sports/social events (Milwaukee area).
Given a partial title or notes, return ONLY JSON with optional fields:
title, description, mode (IN_PERSON|ONLINE|HYBRID), locationName, address, capacity, durationMinutes.
Prefer tennis/pickleball venues when relevant. Keep description under 400 chars.`,
      user: JSON.stringify({
        query,
        knownVenue: venue
          ? {
              name: venue.name,
              address: venue.address,
              capacity: venue.defaultCapacity,
              sport: venue.sport,
            }
          : null,
      }),
    });
    if (!parsed?.title) return null;
    const mode =
      parsed.mode === 'ONLINE' || parsed.mode === 'HYBRID' || parsed.mode === 'IN_PERSON'
        ? (parsed.mode as EventMode)
        : EventMode.IN_PERSON;
    return {
      id: `ai:event:${parsed.title.toLowerCase().slice(0, 40)}`,
      source: 'ai',
      label: parsed.title,
      subtitle: 'AI suggestion',
      confidence: 0.55,
      fields: {
        title: parsed.title,
        description: parsed.description,
        mode,
        locationName: parsed.locationName ?? venue?.name,
        address: parsed.address ?? venue?.address,
        latitude: venue?.latitude,
        longitude: venue?.longitude,
        capacity: parsed.capacity ?? venue?.defaultCapacity ?? undefined,
        durationMinutes: parsed.durationMinutes ?? 90,
      },
    };
  }

  private async aiGroupSuggestion(
    query: string,
  ): Promise<SuggestionItem<GroupSuggestionFields> | null> {
    const parsed = await askXaiJson<{
      name?: string;
      description?: string;
      category?: string;
      location?: string;
      rules?: string;
    }>({
      system: `You help people create community groups on MKE Plays.
Return ONLY JSON: name, description, category (one of TECHNOLOGY,SPORTS,ARTS,MUSIC,EDUCATION,BUSINESS,HEALTH,FOOD,OUTDOORS,GAMES,LANGUAGE,PHOTOGRAPHY,BOOKS,FILM,SCIENCE,COMMUNITY), location, rules.
Keep description under 400 chars. Prefer Milwaukee WI when location is ambiguous.`,
      user: JSON.stringify({ query }),
    });
    if (!parsed?.name) return null;
    const category =
      parsed.category && Object.values(GroupCategory).includes(parsed.category as GroupCategory)
        ? (parsed.category as GroupCategory)
        : GroupCategory.COMMUNITY;
    return {
      id: `ai:group:${parsed.name.toLowerCase().slice(0, 40)}`,
      source: 'ai',
      label: parsed.name,
      subtitle: 'AI suggestion',
      confidence: 0.55,
      fields: {
        name: parsed.name,
        description: parsed.description,
        category,
        location: parsed.location,
        rules: parsed.rules,
      },
    };
  }

  private detectSport(query: string) {
    for (const row of SPORT_KEYWORDS) {
      if (row.pattern.test(query)) return { sport: row.sport, category: row.category };
    }
    return null;
  }

  private extractPlace(query: string): string | undefined {
    const at = query.match(/\bat\s+(.+)$/i);
    if (at?.[1]) return this.titleCase(at[1].trim());
    return undefined;
  }

  private titleCase(value: string): string {
    return value
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  private dedupeByLabel<T>(items: SuggestionItem<T>[]): SuggestionItem<T>[] {
    const seen = new Set<string>();
    const out: SuggestionItem<T>[] = [];
    for (const item of items.sort((a, b) => b.confidence - a.confidence)) {
      const key = item.label.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }
}
