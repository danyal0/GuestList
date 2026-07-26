import { GroupCategory } from '@prisma/client';

export const SEARCH_PROVIDER = Symbol('SEARCH_PROVIDER');

export interface SearchFilters {
  query: string;
  category?: GroupCategory;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  from?: Date;
  to?: Date;
  sort?: 'relevance' | 'popularity' | 'date' | 'distance';
  limit: number;
  offset: number;
}

export interface GroupSearchHit {
  id: string;
  slug: string;
  name: string;
  description: string;
  coverImage: string | null;
  category: GroupCategory;
  memberCount: number;
  location: string | null;
  distanceKm: number | null;
  rank: number;
}

export interface EventSearchHit {
  id: string;
  title: string;
  description: string;
  coverImage: string | null;
  mode: string;
  locationName: string | null;
  startTime: Date;
  endTime: Date;
  groupId: string;
  groupName: string;
  groupSlug: string;
  goingCount: number;
  distanceKm: number | null;
  rank: number;
}

export interface UserSearchHit {
  id: string;
  name: string;
  avatarUrl: string | null;
  location: string | null;
  bio: string | null;
}

export interface SearchProvider {
  searchGroups(filters: SearchFilters): Promise<GroupSearchHit[]>;
  searchEvents(filters: SearchFilters): Promise<EventSearchHit[]>;
  searchUsers(filters: SearchFilters): Promise<UserSearchHit[]>;
}
