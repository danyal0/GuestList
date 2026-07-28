/** API contract types shared across the mobile client (mirror of the web contract). */

export interface User {
  id: string;
  email: string | null;
  phone: string | null;
  whatsappLid: string | null;
  whatsappLinked: boolean;
  name: string;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
  role: 'USER' | 'MODERATOR' | 'ADMIN';
  interests: string[];
  skills: string[];
  emailVerified: boolean;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
  interests: string[];
  skills: string[];
  createdAt: string;
}

export type GroupCategory =
  | 'TECHNOLOGY' | 'SPORTS' | 'ARTS' | 'MUSIC' | 'EDUCATION' | 'BUSINESS'
  | 'HEALTH' | 'FOOD' | 'OUTDOORS' | 'GAMES' | 'LANGUAGE' | 'PHOTOGRAPHY'
  | 'BOOKS' | 'FILM' | 'SCIENCE' | 'COMMUNITY';

export type GroupPrivacy = 'PUBLIC' | 'PRIVATE' | 'HIDDEN';
export type GroupMemberRole = 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';

export interface Group {
  id: string;
  slug: string;
  name: string;
  description: string;
  rules?: string | null;
  coverImage: string | null;
  category: GroupCategory;
  privacy: GroupPrivacy;
  memberCount: number;
  location: string | null;
  isVerified: boolean;
  createdAt: string;
  distanceKm?: number;
  memberRole?: GroupMemberRole;
}

export interface GroupDetail extends Group {
  ownerId: string;
  upcomingEvents: number;
  followerCount: number;
  viewerMembership: { role: GroupMemberRole; joinedAt: string } | null;
  viewerPending: boolean;
}

export type EventMode = 'IN_PERSON' | 'ONLINE' | 'HYBRID';
export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
export type RsvpStatus = 'GOING' | 'INTERESTED' | 'WAITLISTED' | 'DECLINED';

export interface EventSummary {
  id: string;
  groupId: string;
  title: string;
  description: string;
  coverImage: string | null;
  mode: EventMode;
  locationName: string | null;
  address: string | null;
  onlineUrl: string | null;
  timezone: string;
  startTime: string;
  endTime: string;
  capacity: number | null;
  status: EventStatus;
  goingCount: number;
  spotsLeft: number | null;
  distanceKm?: number;
  rsvpStatus?: RsvpStatus;
  group: { id: string; slug: string; name: string; coverImage: string | null; category: GroupCategory };
  host: { id: string; name: string; avatarUrl: string | null };
}

export interface EventDetail extends EventSummary {
  visibility: 'PUBLIC' | 'MEMBERS';
  allowWaitlist: boolean;
  rsvpDeadline: string | null;
  recurrenceRule: string | null;
  interestedCount: number;
  waitlistCount: number;
  viewerRsvp: { status: RsvpStatus } | null;
  attendeePreview: { id: string; name: string; avatarUrl: string | null }[];
  occurrences: { id: string; startTime: string; endTime: string }[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface Conversation {
  id: string;
  type: 'DIRECT' | 'GROUP';
  title: string | null;
  groupId: string | null;
  group: { id: string; slug: string; name: string; coverImage: string | null } | null;
  participants: {
    userId: string;
    lastReadAt: string | null;
    user: { id: string; name: string; avatarUrl: string | null };
  }[];
  lastMessage: Message | null;
  unreadCount: number;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
  sender: { id: string; name: string; avatarUrl: string | null };
}

export interface Notification {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

export interface ProfileView {
  user: PublicUser;
  stats: {
    groupsJoined: number;
    eventsAttended: number;
    eventsHosted: number;
    friends: number;
    following: number;
  };
  friendshipStatus: 'none' | 'pending_sent' | 'pending_received' | 'friends';
}

export interface SearchResults {
  groups: (Group & { rank: number })[];
  events: {
    id: string; title: string; description: string; coverImage: string | null;
    mode: EventMode; locationName: string | null; startTime: string; endTime: string;
    groupId: string; groupName: string; groupSlug: string; goingCount: number;
    distanceKm: number | null; rank: number;
  }[];
  users: PublicUser[];
}
