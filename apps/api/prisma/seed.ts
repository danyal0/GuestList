/**
 * Seed data for local development and demos.
 * Idempotent: wipes and recreates deterministic demo content.
 *
 * Logins (password for everyone: Passw0rd!):
 *   admin@mkeplays.app   — platform admin
 *   maya@example.com … leo@example.com — regular members
 */
import { PrismaClient, GroupCategory, GroupPrivacy, GroupMemberRole, EventMode, RsvpStatus, UserRole, ConversationType, ActivityType } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const PASSWORD = 'Passw0rd!';

const USERS = [
  { email: 'admin@mkeplays.app', name: 'Avery Admin', role: UserRole.ADMIN, location: 'San Francisco, CA', latitude: 37.7749, longitude: -122.4194, interests: ['technology', 'community'], skills: ['moderation'] },
  { email: 'maya@example.com', name: 'Maya Chen', role: UserRole.USER, location: 'San Francisco, CA', latitude: 37.7793, longitude: -122.4192, interests: ['photography', 'hiking', 'technology'], skills: ['photo editing', 'javascript'] },
  { email: 'diego@example.com', name: 'Diego Ramirez', role: UserRole.USER, location: 'Oakland, CA', latitude: 37.8044, longitude: -122.2712, interests: ['soccer', 'cooking', 'music'], skills: ['guitar', 'spanish'] },
  { email: 'priya@example.com', name: 'Priya Sharma', role: UserRole.USER, location: 'San Jose, CA', latitude: 37.3382, longitude: -121.8863, interests: ['machine learning', 'books', 'yoga'], skills: ['python', 'public speaking'] },
  { email: 'sam@example.com', name: 'Sam Okafor', role: UserRole.USER, location: 'Berkeley, CA', latitude: 37.8715, longitude: -122.273, interests: ['climbing', 'board games', 'technology'], skills: ['route setting', 'rust'] },
  { email: 'leo@example.com', name: 'Leo Fischer', role: UserRole.USER, location: 'San Francisco, CA', latitude: 37.7599, longitude: -122.4148, interests: ['film', 'photography', 'coffee'], skills: ['color grading', 'german'] },
];

const GROUPS: Array<{
  name: string; description: string; category: GroupCategory; privacy: GroupPrivacy;
  location: string; latitude: number; longitude: number; ownerEmail: string; rules?: string; coverImage?: string;
}> = [
  {
    name: 'Bay Area Trail Collective',
    description: 'Weekly hikes across the Bay Area — from casual Golden Gate strolls to full-day Marin Headlands treks. All paces welcome; we never leave anyone behind.',
    category: GroupCategory.OUTDOORS, privacy: GroupPrivacy.PUBLIC,
    location: 'San Francisco, CA', latitude: 37.7694, longitude: -122.4862,
    ownerEmail: 'maya@example.com',
    rules: '1. RSVP honestly so we can plan carpools.\n2. Pack out what you pack in.\n3. Be kind to slower hikers.',
  },
  {
    name: 'SF Machine Learning Guild',
    description: 'Paper readings, hands-on workshops and lightning talks for ML practitioners of every level. We meet twice a month and stream every session.',
    category: GroupCategory.TECHNOLOGY, privacy: GroupPrivacy.PUBLIC,
    location: 'San Francisco, CA', latitude: 37.7825, longitude: -122.3959,
    ownerEmail: 'priya@example.com',
    rules: 'Be curious, cite your sources, no recruiting pitches during sessions.',
  },
  {
    name: 'Golden Hour Photography',
    description: 'Photo walks at sunrise and sunset, monthly critique circles, and an annual zine. Film shooters and phone photographers equally loved.',
    category: GroupCategory.PHOTOGRAPHY, privacy: GroupPrivacy.PUBLIC,
    location: 'San Francisco, CA', latitude: 37.8087, longitude: -122.4098,
    ownerEmail: 'leo@example.com',
  },
  {
    name: 'East Bay Fútbol Club',
    description: 'Pick-up soccer every Saturday morning at Bushrod Park. Co-ed, friendly, competitive-ish. First game is free, then we split field costs.',
    category: GroupCategory.SPORTS, privacy: GroupPrivacy.PUBLIC,
    location: 'Oakland, CA', latitude: 37.8349, longitude: -122.2681,
    ownerEmail: 'diego@example.com',
  },
  {
    name: 'Founders Book Circle',
    description: 'A private reading group for startup founders and operators. One book a month, honest discussion, Chatham House rules.',
    category: GroupCategory.BOOKS, privacy: GroupPrivacy.PRIVATE,
    location: 'San Francisco, CA', latitude: 37.7936, longitude: -122.3965,
    ownerEmail: 'sam@example.com',
    rules: 'What is said in the circle stays in the circle.',
  },
];

async function main(): Promise<void> {
  console.log('Seeding database…');

  // Wipe in dependency order.
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.activityLog.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.report.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.message.deleteMany(),
    prisma.conversationParticipant.deleteMany(),
    prisma.conversation.deleteMany(),
    prisma.friendship.deleteMany(),
    prisma.follow.deleteMany(),
    prisma.rsvp.deleteMany(),
    prisma.event.deleteMany(),
    prisma.groupMember.deleteMany(),
    prisma.group.deleteMany(),
    prisma.emailToken.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const passwordHash = await argon2.hash(PASSWORD);

  const users = new Map<string, { id: string }>();
  for (const u of USERS) {
    const user = await prisma.user.create({
      data: { ...u, passwordHash, emailVerifiedAt: new Date() },
    });
    users.set(u.email, user);
    await prisma.activityLog.create({ data: { userId: user.id, type: ActivityType.SIGNUP } });
  }
  console.log(`Created ${users.size} users`);

  const groups: Array<{ id: string; name: string; ownerEmail: string }> = [];
  for (const g of GROUPS) {
    const owner = users.get(g.ownerEmail)!;
    const slug = g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const group = await prisma.group.create({
      data: {
        slug,
        name: g.name,
        description: g.description,
        category: g.category,
        privacy: g.privacy,
        location: g.location,
        latitude: g.latitude,
        longitude: g.longitude,
        rules: g.rules,
        ownerId: owner.id,
        isVerified: g.category === GroupCategory.TECHNOLOGY,
      },
    });
    await prisma.groupMember.create({
      data: { groupId: group.id, userId: owner.id, role: GroupMemberRole.OWNER },
    });
    groups.push({ id: group.id, name: g.name, ownerEmail: g.ownerEmail });
  }
  console.log(`Created ${groups.length} groups`);

  // Cross-join memberships: everyone joins the public groups they don't own.
  const memberEmails = USERS.filter((u) => u.role === UserRole.USER).map((u) => u.email);
  let memberCountByGroup = new Map<string, number>();
  for (const group of groups.slice(0, 4)) {
    let count = 1;
    for (const email of memberEmails) {
      if (email === group.ownerEmail) continue;
      const user = users.get(email)!;
      const role = count === 1 ? GroupMemberRole.ADMIN : count === 2 ? GroupMemberRole.MODERATOR : GroupMemberRole.MEMBER;
      await prisma.groupMember.create({
        data: { groupId: group.id, userId: user.id, role },
      });
      count += 1;
    }
    memberCountByGroup.set(group.id, count);
    await prisma.group.update({ where: { id: group.id }, data: { memberCount: count } });
  }

  // Follows and friendships.
  await prisma.follow.createMany({
    data: [
      { userId: users.get('maya@example.com')!.id, groupId: groups[1].id },
      { userId: users.get('diego@example.com')!.id, groupId: groups[0].id },
      { userId: users.get('leo@example.com')!.id, groupId: groups[0].id },
    ],
  });
  await prisma.friendship.createMany({
    data: [
      { requesterId: users.get('maya@example.com')!.id, addresseeId: users.get('leo@example.com')!.id, status: 'ACCEPTED', respondedAt: new Date() },
      { requesterId: users.get('diego@example.com')!.id, addresseeId: users.get('sam@example.com')!.id, status: 'ACCEPTED', respondedAt: new Date() },
      { requesterId: users.get('priya@example.com')!.id, addresseeId: users.get('maya@example.com')!.id, status: 'PENDING' },
    ],
  });

  // Events: a healthy mix of future/past, modes, capacities.
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const eventsData = [
    {
      group: groups[0], hostEmail: 'maya@example.com', title: 'Lands End Sunrise Hike',
      description: 'A 5-mile coastal loop with the best sunrise view in the city. Meet at the Lands End Lookout parking lot. Bring layers — it gets windy.',
      mode: EventMode.IN_PERSON, locationName: 'Lands End Lookout', address: '680 Point Lobos Ave, San Francisco, CA',
      latitude: 37.7799, longitude: -122.5115, start: now + 3 * day, hours: 3, capacity: 20,
    },
    {
      group: groups[0], hostEmail: 'maya@example.com', title: 'Marin Headlands Full-Day Trek',
      description: '12 miles, 2,300 ft of climbing, unforgettable views of the Golden Gate. Intermediate+ fitness recommended. Carpool coordination in the group chat.',
      mode: EventMode.IN_PERSON, locationName: 'Tennessee Valley Trailhead', address: 'Tennessee Valley Rd, Mill Valley, CA',
      latitude: 37.8607, longitude: -122.5361, start: now + 10 * day, hours: 7, capacity: 12,
    },
    {
      group: groups[1], hostEmail: 'priya@example.com', title: 'Paper Night: Attention Is All You Need, Revisited',
      description: 'We revisit the transformer paper with 2026 eyes: what held up, what did not, and what the field learned. Short talks + open discussion. Streamed live.',
      mode: EventMode.HYBRID, locationName: 'Founders Hub SoMa', address: '535 Mission St, San Francisco, CA',
      latitude: 37.7891, longitude: -122.3979, onlineUrl: 'https://meet.mkeplays.app/ml-guild-paper-night',
      start: now + 5 * day, hours: 2, capacity: 60,
    },
    {
      group: groups[1], hostEmail: 'priya@example.com', title: 'Hands-on: Fine-tuning Open Models',
      description: 'Bring a laptop; leave with a fine-tuned model. GPUs provided via cloud credits. Basic Python required.',
      mode: EventMode.ONLINE, onlineUrl: 'https://meet.mkeplays.app/ml-guild-finetune',
      start: now + 14 * day, hours: 3, capacity: 100,
    },
    {
      group: groups[2], hostEmail: 'leo@example.com', title: 'Golden Hour Walk: Crissy Field',
      description: 'Sunset walk from Crissy Field to Fort Point. All cameras welcome. We end with optional dinner at the Warming Hut.',
      mode: EventMode.IN_PERSON, locationName: 'Crissy Field East Beach', address: '1199 East Beach, San Francisco, CA',
      latitude: 37.8039, longitude: -122.4640, start: now + 2 * day, hours: 2, capacity: 15,
    },
    {
      group: groups[3], hostEmail: 'diego@example.com', title: 'Saturday Pick-up Match',
      description: 'Our weekly co-ed pick-up game. Two fields booked, all levels rotate in. Cleats recommended, bibs provided.',
      mode: EventMode.IN_PERSON, locationName: 'Bushrod Park', address: '560 59th St, Oakland, CA',
      latitude: 37.8452, longitude: -122.2646, start: now + 6 * day, hours: 2, capacity: 30,
    },
    {
      group: groups[2], hostEmail: 'leo@example.com', title: 'Critique Circle: Street Photography',
      description: 'Bring 3 prints or a small digital set. Constructive, specific, kind feedback — that is the whole format.',
      mode: EventMode.IN_PERSON, locationName: 'Four Barrel Coffee', address: '375 Valencia St, San Francisco, CA',
      latitude: 37.7670, longitude: -122.4216, start: now - 7 * day, hours: 2, capacity: 10, past: true,
    },
  ];

  const createdEvents: string[] = [];
  for (const e of eventsData) {
    const host = users.get(e.hostEmail)!;
    const event = await prisma.event.create({
      data: {
        groupId: e.group.id,
        hostId: host.id,
        title: e.title,
        description: e.description,
        mode: e.mode,
        locationName: e.locationName,
        address: e.address,
        latitude: e.latitude,
        longitude: e.longitude,
        onlineUrl: e.onlineUrl,
        timezone: 'America/Los_Angeles',
        startTime: new Date(e.start),
        endTime: new Date(e.start + e.hours * 60 * 60 * 1000),
        capacity: e.capacity,
        status: e.past ? 'COMPLETED' : 'PUBLISHED',
      },
    });
    createdEvents.push(event.id);
    await prisma.activityLog.create({
      data: { userId: host.id, type: ActivityType.EVENT_CREATED, metadata: { eventId: event.id } },
    });
  }
  console.log(`Created ${createdEvents.length} events`);

  // RSVPs.
  const rsvpMatrix: Array<[number, string, RsvpStatus]> = [
    [0, 'diego@example.com', RsvpStatus.GOING],
    [0, 'priya@example.com', RsvpStatus.GOING],
    [0, 'sam@example.com', RsvpStatus.INTERESTED],
    [0, 'leo@example.com', RsvpStatus.GOING],
    [1, 'sam@example.com', RsvpStatus.GOING],
    [1, 'diego@example.com', RsvpStatus.INTERESTED],
    [2, 'maya@example.com', RsvpStatus.GOING],
    [2, 'sam@example.com', RsvpStatus.GOING],
    [2, 'leo@example.com', RsvpStatus.INTERESTED],
    [3, 'maya@example.com', RsvpStatus.GOING],
    [4, 'maya@example.com', RsvpStatus.GOING],
    [4, 'priya@example.com', RsvpStatus.GOING],
    [5, 'sam@example.com', RsvpStatus.GOING],
    [5, 'maya@example.com', RsvpStatus.INTERESTED],
    [6, 'maya@example.com', RsvpStatus.GOING],
    [6, 'priya@example.com', RsvpStatus.GOING],
  ];
  for (const [eventIdx, email, status] of rsvpMatrix) {
    const user = users.get(email)!;
    await prisma.rsvp.create({
      data: { eventId: createdEvents[eventIdx], userId: user.id, status },
    });
    await prisma.activityLog.create({
      data: { userId: user.id, type: ActivityType.EVENT_RSVP, metadata: { eventId: createdEvents[eventIdx], status } },
    });
  }

  // A direct conversation with a little history.
  const maya = users.get('maya@example.com')!;
  const leo = users.get('leo@example.com')!;
  const conversation = await prisma.conversation.create({
    data: {
      type: ConversationType.DIRECT,
      participants: { create: [{ userId: maya.id }, { userId: leo.id }] },
    },
  });
  const chat: Array<[string, string]> = [
    [maya.id, 'Hey Leo! Are you shooting the Crissy Field walk this week?'],
    [leo.id, 'Absolutely — bringing the film camera this time. You in?'],
    [maya.id, "Wouldn't miss it. I'll RSVP now. Want to grab coffee before?"],
    [leo.id, 'Four Barrel at 5? Golden hour starts around 6:40.'],
  ];
  for (const [senderId, content] of chat) {
    await prisma.message.create({
      data: { conversationId: conversation.id, senderId, content },
    });
  }

  // Group chat for the hiking collective.
  const hikeChat = await prisma.conversation.create({
    data: {
      type: ConversationType.GROUP,
      groupId: groups[0].id,
      title: 'Bay Area Trail Collective',
      participants: {
        create: [maya.id, users.get('diego@example.com')!.id, users.get('sam@example.com')!.id].map(
          (userId) => ({ userId }),
        ),
      },
    },
  });
  await prisma.message.create({
    data: {
      conversationId: hikeChat.id,
      senderId: maya.id,
      content: 'Sunrise hike this Saturday — carpool sign-up is open! 🌄',
    },
  });

  console.log('Seed complete.');
  console.log(`Login with any seeded account, e.g. maya@example.com / ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
