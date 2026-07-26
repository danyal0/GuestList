#!/usr/bin/env node
/**
 * Generates apps/api/data/mock-db.json with demo content (no Postgres required).
 * Password for every user: Passw0rd!
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '../apps/api/data/mock-db.json');

const PASSWORD = 'Passw0rd!';
const now = Date.now();
const day = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

const passwordHash = await argon2.hash(PASSWORD);

const users = [
  {
    id: 'user_admin',
    email: 'admin@gatherly.app',
    name: 'Avery Admin',
    role: 'ADMIN',
    location: 'San Francisco, CA',
    latitude: 37.7749,
    longitude: -122.4194,
    interests: ['technology', 'community'],
    skills: ['moderation'],
  },
  {
    id: 'user_maya',
    email: 'maya@example.com',
    name: 'Maya Chen',
    role: 'USER',
    location: 'San Francisco, CA',
    latitude: 37.7793,
    longitude: -122.4192,
    interests: ['photography', 'hiking', 'technology'],
    skills: ['photo editing', 'javascript'],
  },
  {
    id: 'user_diego',
    email: 'diego@example.com',
    name: 'Diego Ramirez',
    role: 'USER',
    location: 'Oakland, CA',
    latitude: 37.8044,
    longitude: -122.2712,
    interests: ['soccer', 'cooking', 'music'],
    skills: ['guitar', 'spanish'],
  },
  {
    id: 'user_priya',
    email: 'priya@example.com',
    name: 'Priya Sharma',
    role: 'USER',
    location: 'San Jose, CA',
    latitude: 37.3382,
    longitude: -121.8863,
    interests: ['machine learning', 'books', 'yoga'],
    skills: ['python', 'public speaking'],
  },
  {
    id: 'user_sam',
    email: 'sam@example.com',
    name: 'Sam Okafor',
    role: 'USER',
    location: 'Berkeley, CA',
    latitude: 37.8715,
    longitude: -122.273,
    interests: ['climbing', 'board games', 'technology'],
    skills: ['route setting', 'rust'],
  },
  {
    id: 'user_leo',
    email: 'leo@example.com',
    name: 'Leo Fischer',
    role: 'USER',
    location: 'San Francisco, CA',
    latitude: 37.7599,
    longitude: -122.4148,
    interests: ['film', 'photography', 'coffee'],
    skills: ['color grading', 'german'],
  },
].map((u, i) => ({
  ...u,
  passwordHash,
  avatarUrl: null,
  bio: null,
  emailVerifiedAt: iso(now - 30 * day),
  suspendedAt: null,
  deletedAt: null,
  createdAt: iso(now - (40 - i) * day),
  updatedAt: iso(now - (40 - i) * day),
}));

const groups = [
  {
    id: 'group_trails',
    slug: 'bay-area-trail-collective',
    name: 'Bay Area Trail Collective',
    description:
      'Weekly hikes across the Bay Area — from casual Golden Gate strolls to full-day Marin Headlands treks. All paces welcome; we never leave anyone behind.',
    category: 'OUTDOORS',
    privacy: 'PUBLIC',
    location: 'San Francisco, CA',
    latitude: 37.7694,
    longitude: -122.4862,
    ownerId: 'user_maya',
    rules: '1. RSVP honestly so we can plan carpools.\n2. Pack out what you pack in.\n3. Be kind to slower hikers.',
    isVerified: false,
    memberCount: 5,
  },
  {
    id: 'group_ml',
    slug: 'sf-machine-learning-guild',
    name: 'SF Machine Learning Guild',
    description:
      'Paper readings, hands-on workshops and lightning talks for ML practitioners of every level. We meet twice a month and stream every session.',
    category: 'TECHNOLOGY',
    privacy: 'PUBLIC',
    location: 'San Francisco, CA',
    latitude: 37.7825,
    longitude: -122.3959,
    ownerId: 'user_priya',
    rules: 'Be curious, cite your sources, no recruiting pitches during sessions.',
    isVerified: true,
    memberCount: 5,
  },
  {
    id: 'group_photo',
    slug: 'golden-hour-photography',
    name: 'Golden Hour Photography',
    description:
      'Photo walks at sunrise and sunset, monthly critique circles, and an annual zine. Film shooters and phone photographers equally loved.',
    category: 'PHOTOGRAPHY',
    privacy: 'PUBLIC',
    location: 'San Francisco, CA',
    latitude: 37.8087,
    longitude: -122.4098,
    ownerId: 'user_leo',
    rules: null,
    isVerified: false,
    memberCount: 5,
  },
  {
    id: 'group_futbol',
    slug: 'east-bay-futbol-club',
    name: 'East Bay Fútbol Club',
    description:
      'Pick-up soccer every Saturday morning at Bushrod Park. Co-ed, friendly, competitive-ish. First game is free, then we split field costs.',
    category: 'SPORTS',
    privacy: 'PUBLIC',
    location: 'Oakland, CA',
    latitude: 37.8349,
    longitude: -122.2681,
    ownerId: 'user_diego',
    rules: null,
    isVerified: false,
    memberCount: 5,
  },
  {
    id: 'group_books',
    slug: 'founders-book-circle',
    name: 'Founders Book Circle',
    description:
      'A private reading group for startup founders and operators. One book a month, honest discussion, Chatham House rules.',
    category: 'BOOKS',
    privacy: 'PRIVATE',
    location: 'San Francisco, CA',
    latitude: 37.7936,
    longitude: -122.3965,
    ownerId: 'user_sam',
    rules: 'What is said in the circle stays in the circle.',
    isVerified: false,
    memberCount: 1,
  },
].map((g) => ({
  ...g,
  coverImage: null,
  deletedAt: null,
  createdAt: iso(now - 20 * day),
  updatedAt: iso(now - 20 * day),
}));

const memberEmails = ['user_maya', 'user_diego', 'user_priya', 'user_sam', 'user_leo'];
const groupMembers = [];
let gm = 0;
for (const group of groups) {
  groupMembers.push({
    id: `gm_${++gm}`,
    groupId: group.id,
    userId: group.ownerId,
    role: 'OWNER',
    status: 'ACTIVE',
    joinedAt: iso(now - 20 * day),
  });
}
for (const group of groups.slice(0, 4)) {
  let n = 0;
  for (const userId of memberEmails) {
    if (userId === group.ownerId) continue;
    n += 1;
    groupMembers.push({
      id: `gm_${++gm}`,
      groupId: group.id,
      userId,
      role: n === 1 ? 'ADMIN' : n === 2 ? 'MODERATOR' : 'MEMBER',
      status: 'ACTIVE',
      joinedAt: iso(now - (18 - n) * day),
    });
  }
}

const follows = [
  { id: 'follow_1', userId: 'user_maya', groupId: 'group_ml', createdAt: iso(now - 10 * day) },
  { id: 'follow_2', userId: 'user_diego', groupId: 'group_trails', createdAt: iso(now - 9 * day) },
  { id: 'follow_3', userId: 'user_leo', groupId: 'group_trails', createdAt: iso(now - 8 * day) },
];

const friendships = [
  {
    id: 'friend_1',
    requesterId: 'user_maya',
    addresseeId: 'user_leo',
    status: 'ACCEPTED',
    createdAt: iso(now - 15 * day),
    respondedAt: iso(now - 14 * day),
  },
  {
    id: 'friend_2',
    requesterId: 'user_diego',
    addresseeId: 'user_sam',
    status: 'ACCEPTED',
    createdAt: iso(now - 12 * day),
    respondedAt: iso(now - 11 * day),
  },
  {
    id: 'friend_3',
    requesterId: 'user_priya',
    addresseeId: 'user_maya',
    status: 'PENDING',
    createdAt: iso(now - 2 * day),
    respondedAt: null,
  },
];

const eventsRaw = [
  {
    id: 'event_lands_end',
    groupId: 'group_trails',
    hostId: 'user_maya',
    title: 'Lands End Sunrise Hike',
    description:
      'A 5-mile coastal loop with the best sunrise view in the city. Meet at the Lands End Lookout parking lot. Bring layers — it gets windy.',
    mode: 'IN_PERSON',
    locationName: 'Lands End Lookout',
    address: '680 Point Lobos Ave, San Francisco, CA',
    latitude: 37.7799,
    longitude: -122.5115,
    startOffsetDays: 3,
    hours: 3,
    capacity: 20,
  },
  {
    id: 'event_marin',
    groupId: 'group_trails',
    hostId: 'user_maya',
    title: 'Marin Headlands Full-Day Trek',
    description:
      '12 miles, 2,300 ft of climbing, unforgettable views of the Golden Gate. Intermediate+ fitness recommended.',
    mode: 'IN_PERSON',
    locationName: 'Tennessee Valley Trailhead',
    address: 'Tennessee Valley Rd, Mill Valley, CA',
    latitude: 37.8607,
    longitude: -122.5361,
    startOffsetDays: 10,
    hours: 7,
    capacity: 12,
  },
  {
    id: 'event_paper_night',
    groupId: 'group_ml',
    hostId: 'user_priya',
    title: 'Paper Night: Attention Is All You Need, Revisited',
    description:
      'We revisit the transformer paper with 2026 eyes: what held up, what did not, and what the field learned.',
    mode: 'HYBRID',
    locationName: 'Founders Hub SoMa',
    address: '535 Mission St, San Francisco, CA',
    latitude: 37.7891,
    longitude: -122.3979,
    onlineUrl: 'https://meet.gatherly.app/ml-guild-paper-night',
    startOffsetDays: 5,
    hours: 2,
    capacity: 60,
  },
  {
    id: 'event_finetune',
    groupId: 'group_ml',
    hostId: 'user_priya',
    title: 'Hands-on: Fine-tuning Open Models',
    description: 'Bring a laptop; leave with a fine-tuned model. Basic Python required.',
    mode: 'ONLINE',
    onlineUrl: 'https://meet.gatherly.app/ml-guild-finetune',
    startOffsetDays: 14,
    hours: 3,
    capacity: 100,
  },
  {
    id: 'event_crissy',
    groupId: 'group_photo',
    hostId: 'user_leo',
    title: 'Golden Hour Walk: Crissy Field',
    description: 'Sunset walk from Crissy Field to Fort Point. All cameras welcome.',
    mode: 'IN_PERSON',
    locationName: 'Crissy Field East Beach',
    address: '1199 East Beach, San Francisco, CA',
    latitude: 37.8039,
    longitude: -122.464,
    startOffsetDays: 2,
    hours: 2,
    capacity: 15,
  },
  {
    id: 'event_soccer',
    groupId: 'group_futbol',
    hostId: 'user_diego',
    title: 'Saturday Pick-up Match',
    description: 'Our weekly co-ed pick-up game. Cleats recommended, bibs provided.',
    mode: 'IN_PERSON',
    locationName: 'Bushrod Park',
    address: '560 59th St, Oakland, CA',
    latitude: 37.8452,
    longitude: -122.2646,
    startOffsetDays: 6,
    hours: 2,
    capacity: 30,
  },
  {
    id: 'event_critique',
    groupId: 'group_photo',
    hostId: 'user_leo',
    title: 'Critique Circle: Street Photography',
    description: 'Bring 3 prints or a small digital set. Constructive, specific, kind feedback.',
    mode: 'IN_PERSON',
    locationName: 'Four Barrel Coffee',
    address: '375 Valencia St, San Francisco, CA',
    latitude: 37.767,
    longitude: -122.4216,
    startOffsetDays: -7,
    hours: 2,
    capacity: 10,
    past: true,
  },
];

const events = eventsRaw.map((e) => {
  const start = now + e.startOffsetDays * day;
  return {
    id: e.id,
    groupId: e.groupId,
    hostId: e.hostId,
    title: e.title,
    description: e.description,
    coverImage: null,
    mode: e.mode,
    status: e.past ? 'COMPLETED' : 'PUBLISHED',
    visibility: 'PUBLIC',
    locationName: e.locationName ?? null,
    address: e.address ?? null,
    latitude: e.latitude ?? null,
    longitude: e.longitude ?? null,
    onlineUrl: e.onlineUrl ?? null,
    timezone: 'America/Los_Angeles',
    startTime: iso(start),
    endTime: iso(start + e.hours * 60 * 60 * 1000),
    capacity: e.capacity,
    rsvpDeadline: null,
    recurrenceRule: null,
    parentEventId: null,
    cancelledAt: null,
    createdAt: iso(now - 5 * day),
    updatedAt: iso(now - 5 * day),
    _startOffsetDays: e.startOffsetDays,
    _durationHours: e.hours,
  };
});

const rsvpMatrix = [
  ['event_lands_end', 'user_diego', 'GOING'],
  ['event_lands_end', 'user_priya', 'GOING'],
  ['event_lands_end', 'user_sam', 'INTERESTED'],
  ['event_lands_end', 'user_leo', 'GOING'],
  ['event_marin', 'user_sam', 'GOING'],
  ['event_marin', 'user_diego', 'INTERESTED'],
  ['event_paper_night', 'user_maya', 'GOING'],
  ['event_paper_night', 'user_sam', 'GOING'],
  ['event_paper_night', 'user_leo', 'INTERESTED'],
  ['event_finetune', 'user_maya', 'GOING'],
  ['event_crissy', 'user_maya', 'GOING'],
  ['event_crissy', 'user_priya', 'GOING'],
  ['event_soccer', 'user_sam', 'GOING'],
  ['event_soccer', 'user_maya', 'INTERESTED'],
  ['event_critique', 'user_maya', 'GOING'],
  ['event_critique', 'user_priya', 'GOING'],
];

const rsvps = rsvpMatrix.map(([eventId, userId, status], i) => ({
  id: `rsvp_${i + 1}`,
  eventId,
  userId,
  status,
  createdAt: iso(now - (4 - (i % 4)) * day),
  updatedAt: iso(now - (4 - (i % 4)) * day),
}));

const conversations = [
  {
    id: 'conv_maya_leo',
    type: 'DIRECT',
    groupId: null,
    title: null,
    createdAt: iso(now - 6 * day),
    updatedAt: iso(now - 1 * day),
  },
  {
    id: 'conv_trails',
    type: 'GROUP',
    groupId: 'group_trails',
    title: 'Bay Area Trail Collective',
    createdAt: iso(now - 10 * day),
    updatedAt: iso(now - 1 * day),
  },
];

const conversationParticipants = [
  { id: 'cp_1', conversationId: 'conv_maya_leo', userId: 'user_maya', joinedAt: iso(now - 6 * day), lastReadAt: iso(now - 1 * day) },
  { id: 'cp_2', conversationId: 'conv_maya_leo', userId: 'user_leo', joinedAt: iso(now - 6 * day), lastReadAt: iso(now - 2 * day) },
  { id: 'cp_3', conversationId: 'conv_trails', userId: 'user_maya', joinedAt: iso(now - 10 * day), lastReadAt: iso(now - 1 * day) },
  { id: 'cp_4', conversationId: 'conv_trails', userId: 'user_diego', joinedAt: iso(now - 10 * day), lastReadAt: null },
  { id: 'cp_5', conversationId: 'conv_trails', userId: 'user_sam', joinedAt: iso(now - 10 * day), lastReadAt: null },
];

const messages = [
  {
    id: 'msg_1',
    conversationId: 'conv_maya_leo',
    senderId: 'user_maya',
    content: 'Hey Leo! Are you shooting the Crissy Field walk this week?',
    createdAt: iso(now - 5 * day),
  },
  {
    id: 'msg_2',
    conversationId: 'conv_maya_leo',
    senderId: 'user_leo',
    content: 'Absolutely — bringing the film camera this time. You in?',
    createdAt: iso(now - 5 * day + 3600000),
  },
  {
    id: 'msg_3',
    conversationId: 'conv_maya_leo',
    senderId: 'user_maya',
    content: "Wouldn't miss it. I'll RSVP now. Want to grab coffee before?",
    createdAt: iso(now - 4 * day),
  },
  {
    id: 'msg_4',
    conversationId: 'conv_maya_leo',
    senderId: 'user_leo',
    content: 'Four Barrel at 5? Golden hour starts around 6:40.',
    createdAt: iso(now - 4 * day + 1800000),
  },
  {
    id: 'msg_5',
    conversationId: 'conv_trails',
    senderId: 'user_maya',
    content: 'Sunrise hike this Saturday — carpool sign-up is open!',
    createdAt: iso(now - 1 * day),
  },
].map((m) => ({ ...m, deletedAt: null, updatedAt: m.createdAt }));

const activityLogs = users.map((u, i) => ({
  id: `act_signup_${i}`,
  userId: u.id,
  type: 'SIGNUP',
  metadata: {},
  createdAt: u.createdAt,
}));

const db = {
  meta: {
    version: 1,
    passwordHint: PASSWORD,
    generatedAt: iso(now),
  },
  users,
  refreshTokens: [],
  emailTokens: [],
  groups,
  groupMembers,
  follows,
  events,
  rsvps,
  conversations,
  conversationParticipants,
  messages,
  friendships,
  notifications: [],
  reports: [],
  auditLogs: [],
  payments: [],
  activityLogs,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(db, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
console.log(`Demo login: maya@example.com / ${PASSWORD}`);
