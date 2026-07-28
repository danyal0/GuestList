import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(30_000);

interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

describe('MKE Plays API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  let alice: Session;
  let bob: Session;
  let carol: Session;

  const signup = async (email: string, name: string): Promise<Session> => {
    const res = await request(http)
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Sup3rSecret!', name })
      .expect(201);
    return {
      accessToken: res.body.accessToken,
      refreshToken: res.body.refreshToken,
      userId: res.body.user.id,
    };
  };

  const auth = (session: Session) => ({ Authorization: `Bearer ${session.accessToken}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    http = app.getHttpServer();

    // Clean slate — the suite owns the mkeplays_test database.
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE "audit_logs", "activity_logs", "payments", "reports", "notifications",
        "friendships", "messages", "conversation_participants", "conversations",
        "rsvps", "events", "follows", "group_members", "groups",
        "email_tokens", "refresh_tokens", "users" CASCADE
    `);

    alice = await signup('alice@test.dev', 'Alice Chen');
    bob = await signup('bob@test.dev', 'Bob Okafor');
    carol = await signup('carol@test.dev', 'Carol Diaz');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health', () => {
    it('GET /health reports database connectivity', async () => {
      const res = await request(http).get('/api/v1/health').expect(200);
      expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
    });
  });

  describe('Authentication', () => {
    it('rejects signup with a weak password', async () => {
      const res = await request(http)
        .post('/api/v1/auth/signup')
        .send({ email: 'weak@test.dev', password: 'short', name: 'Weak' })
        .expect(400);
      expect(JSON.stringify(res.body.message)).toContain('8 characters');
    });

    it('rejects duplicate signups with 409', async () => {
      await request(http)
        .post('/api/v1/auth/signup')
        .send({ email: 'alice@test.dev', password: 'Sup3rSecret!', name: 'Impostor' })
        .expect(409);
    });

    it('rejects login with a wrong password using a generic message', async () => {
      const res = await request(http)
        .post('/api/v1/auth/login')
        .send({ email: 'alice@test.dev', password: 'WrongPassw0rd' })
        .expect(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('logs in with correct credentials and never leaks the hash', async () => {
      const res = await request(http)
        .post('/api/v1/auth/login')
        .send({ email: 'alice@test.dev', password: 'Sup3rSecret!' })
        .expect(200);
      expect(res.body.user.email).toBe('alice@test.dev');
      expect(res.body.user.passwordHash).toBeUndefined();
      expect(res.body.accessToken).toBeTruthy();
    });

    it('returns the profile for a valid bearer token', async () => {
      const res = await request(http).get('/api/v1/auth/me').set(auth(alice)).expect(200);
      expect(res.body.id).toBe(alice.userId);
    });

    it('rejects protected routes without a token', async () => {
      await request(http).get('/api/v1/auth/me').expect(401);
    });

    it('rotates refresh tokens and detects reuse of the old token', async () => {
      const session = await signup('dave@test.dev', 'Dave Kim');

      const rotated = await request(http)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(200);
      expect(rotated.body.refreshToken).not.toBe(session.refreshToken);

      // Replaying the consumed token must fail and revoke the family.
      await request(http)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);

      // The successor was revoked along with the family.
      await request(http)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rotated.body.refreshToken })
        .expect(401);
    });

    it('enforces CSRF for cookie-authenticated mutations', async () => {
      const login = await request(http)
        .post('/api/v1/auth/login')
        .send({ email: 'alice@test.dev', password: 'Sup3rSecret!' })
        .expect(200);
      const cookies = login.headers['set-cookie'] as unknown as string[];

      // Cookie session without the X-CSRF-Token header → 403.
      const res = await request(http)
        .post('/api/v1/groups')
        .set('Cookie', cookies.map((c) => c.split(';')[0]).join('; '))
        .send({ name: 'CSRF Group', description: 'Should not be created', category: 'GAMES' });
      expect(res.status).toBe(403);
      expect(res.body.message).toContain('CSRF');
    });
  });

  describe('Communities', () => {
    let groupId: string;
    let groupSlug: string;
    let privateGroupId: string;

    it('creates a public community', async () => {
      const res = await request(http)
        .post('/api/v1/groups')
        .set(auth(alice))
        .send({
          name: 'E2E Hiking Club',
          description: 'We hike every weekend, rain or shine.',
          category: 'OUTDOORS',
          location: 'San Francisco, CA',
        })
        .expect(201);
      groupId = res.body.id;
      groupSlug = res.body.slug;
      expect(res.body.memberCount).toBe(1);
    });

    it('rejects invalid payloads (missing description)', async () => {
      await request(http)
        .post('/api/v1/groups')
        .set(auth(alice))
        .send({ name: 'No Description', category: 'GAMES' })
        .expect(400);
    });

    it('resolves a community by slug with viewer context', async () => {
      const res = await request(http)
        .get(`/api/v1/groups/${groupSlug}`)
        .set(auth(alice))
        .expect(200);
      expect(res.body.viewerMembership.role).toBe('OWNER');
    });

    it('lets another user join a public community instantly', async () => {
      const res = await request(http)
        .post(`/api/v1/groups/${groupId}/join`)
        .set(auth(bob))
        .send({})
        .expect(201);
      expect(res.body.status).toBe('ACTIVE');
    });

    it('forbids a plain member from editing the community', async () => {
      await request(http)
        .patch(`/api/v1/groups/${groupId}`)
        .set(auth(bob))
        .send({ name: 'Hijacked Club' })
        .expect(403);
    });

    it('allows the owner to edit the community', async () => {
      const res = await request(http)
        .patch(`/api/v1/groups/${groupId}`)
        .set(auth(alice))
        .send({ description: 'We hike every weekend — all levels welcome!' })
        .expect(200);
      expect(res.body.description).toContain('all levels');
    });

    it('queues joins to private communities for approval', async () => {
      const created = await request(http)
        .post('/api/v1/groups')
        .set(auth(alice))
        .send({
          name: 'E2E Secret Society',
          description: 'A very private club for e2e testing.',
          category: 'COMMUNITY',
          privacy: 'PRIVATE',
        })
        .expect(201);
      privateGroupId = created.body.id;

      const join = await request(http)
        .post(`/api/v1/groups/${privateGroupId}/join`)
        .set(auth(carol))
        .send({})
        .expect(201);
      expect(join.body.status).toBe('PENDING');
    });

    it('lets the owner approve pending members', async () => {
      await request(http)
        .post(`/api/v1/groups/${privateGroupId}/members/${carol.userId}/approve`)
        .set(auth(alice))
        .send({})
        .expect(200);

      const members = await request(http)
        .get(`/api/v1/groups/${privateGroupId}/members`)
        .set(auth(alice))
        .expect(200);
      const carolRow = members.body.items.find(
        (m: { user: { id: string } }) => m.user.id === carol.userId,
      );
      expect(carolRow).toBeDefined();
    });
  });

  describe('Events & RSVP', () => {
    let groupId: string;
    let eventId: string;

    beforeAll(async () => {
      const group = await request(http)
        .post('/api/v1/groups')
        .set(auth(alice))
        .send({
          name: 'E2E Events Guild',
          description: 'A community that exists to host e2e events.',
          category: 'TECHNOLOGY',
        })
        .expect(201);
      groupId = group.body.id;
      await request(http).post(`/api/v1/groups/${groupId}/join`).set(auth(bob)).send({}).expect(201);
      await request(http).post(`/api/v1/groups/${groupId}/join`).set(auth(carol)).send({}).expect(201);
    });

    it('creates an event with capacity 1', async () => {
      const start = new Date(Date.now() + 7 * 86_400_000);
      const end = new Date(start.getTime() + 2 * 3_600_000);
      const res = await request(http)
        .post('/api/v1/events')
        .set(auth(alice))
        .send({
          groupId,
          title: 'Tiny Capacity Meetup',
          description: 'Only one seat available — waitlist test.',
          mode: 'IN_PERSON',
          locationName: 'Test HQ',
          timezone: 'America/Los_Angeles',
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          capacity: 1,
        })
        .expect(201);
      eventId = res.body.id;
      expect(res.body.status).toBe('PUBLISHED');
    });

    it('rejects events that end before they start', async () => {
      const start = new Date(Date.now() + 86_400_000);
      await request(http)
        .post('/api/v1/events')
        .set(auth(alice))
        .send({
          groupId,
          title: 'Time Travel Meetup',
          description: 'Ends before it starts, which is not allowed.',
          mode: 'ONLINE',
          onlineUrl: 'https://meet.example.com/x',
          timezone: 'UTC',
          startTime: start.toISOString(),
          endTime: new Date(start.getTime() - 3_600_000).toISOString(),
        })
        .expect(400);
    });

    it('forbids plain members from creating events', async () => {
      const start = new Date(Date.now() + 86_400_000);
      await request(http)
        .post('/api/v1/events')
        .set(auth(bob))
        .send({
          groupId,
          title: 'Unauthorized Event',
          description: 'Bob is a member, not a moderator.',
          mode: 'ONLINE',
          onlineUrl: 'https://meet.example.com/x',
          timezone: 'UTC',
          startTime: start.toISOString(),
          endTime: new Date(start.getTime() + 3_600_000).toISOString(),
        })
        .expect(403);
    });

    it('confirms the first GOING RSVP', async () => {
      const res = await request(http)
        .put(`/api/v1/events/${eventId}/rsvp`)
        .set(auth(bob))
        .send({ status: 'GOING' })
        .expect(200);
      expect(res.body.rsvp.status).toBe('GOING');
      expect(res.body.waitlisted).toBe(false);
    });

    it('waitlists the second GOING RSVP when at capacity', async () => {
      const res = await request(http)
        .put(`/api/v1/events/${eventId}/rsvp`)
        .set(auth(carol))
        .send({ status: 'GOING' })
        .expect(200);
      expect(res.body.rsvp.status).toBe('WAITLISTED');
      expect(res.body.waitlisted).toBe(true);
    });

    it('rejects requesting WAITLISTED directly', async () => {
      await request(http)
        .put(`/api/v1/events/${eventId}/rsvp`)
        .set(auth(bob))
        .send({ status: 'WAITLISTED' })
        .expect(400);
    });

    it('promotes the waitlisted attendee when a spot frees up', async () => {
      await request(http)
        .put(`/api/v1/events/${eventId}/rsvp`)
        .set(auth(bob))
        .send({ status: 'DECLINED' })
        .expect(200);

      const detail = await request(http)
        .get(`/api/v1/events/${eventId}`)
        .set(auth(carol))
        .expect(200);
      expect(detail.body.viewerRsvp.status).toBe('GOING');
    });

    it('notifies the promoted attendee', async () => {
      const res = await request(http).get('/api/v1/notifications').set(auth(carol)).expect(200);
      const promotion = res.body.items.find(
        (n: { type: string }) => n.type === 'RSVP_PROMOTED',
      );
      expect(promotion).toBeDefined();
    });

    it('exports a valid ICS calendar file', async () => {
      const res = await request(http).get(`/api/v1/events/${eventId}/calendar.ics`).expect(200);
      expect(res.headers['content-type']).toContain('text/calendar');
      expect(res.text).toContain('BEGIN:VCALENDAR');
      expect(res.text).toContain('SUMMARY:Tiny Capacity Meetup');
    });

    it('lets the host cancel the event and blocks further RSVPs', async () => {
      await request(http).delete(`/api/v1/events/${eventId}`).set(auth(alice)).expect(200);
      await request(http)
        .put(`/api/v1/events/${eventId}/rsvp`)
        .set(auth(carol))
        .send({ status: 'GOING' })
        .expect(400);
    });
  });

  describe('Search & discovery', () => {
    it('finds communities by full-text search', async () => {
      const res = await request(http).get('/api/v1/search?q=hiking').expect(200);
      const names = res.body.groups.map((g: { name: string }) => g.name);
      expect(names).toContain('E2E Hiking Club');
    });

    it('returns empty results (not an error) for nonsense queries', async () => {
      const res = await request(http).get('/api/v1/search?q=zzzqqqxxx').expect(200);
      expect(res.body.groups).toHaveLength(0);
      expect(res.body.events).toHaveLength(0);
    });

    it('serves recommendations for an authenticated user', async () => {
      const res = await request(http)
        .get('/api/v1/recommendations/groups')
        .set(auth(carol))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('Authorization boundaries', () => {
    it('blocks non-admins from the admin API', async () => {
      await request(http).get('/api/v1/admin/users').set(auth(alice)).expect(403);
    });

    it('allows admins into the admin API', async () => {
      await prisma.user.update({ where: { id: alice.userId }, data: { role: 'ADMIN' } });
      // Fresh token so the JWT carries the ADMIN role claim.
      const login = await request(http)
        .post('/api/v1/auth/login')
        .send({ email: 'alice@test.dev', password: 'Sup3rSecret!' })
        .expect(200);

      const res = await request(http)
        .get('/api/v1/admin/analytics/overview')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
      expect(res.body.totalUsers).toBeGreaterThan(0);
    });
  });
});
