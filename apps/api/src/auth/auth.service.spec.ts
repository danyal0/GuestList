import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';
import { OAuthService } from './oauth.service';
import { TokenService } from './token.service';

const TOKENS = {
  accessToken: 'access',
  refreshToken: 'refresh',
  accessExpiresIn: 900,
  refreshExpiresIn: 3600,
};

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'usr_1',
    email: 'ada@example.com',
    phone: '14145550100',
    whatsappLid: null as string | null,
    passwordHash: null as string | null,
    name: 'Ada Lovelace',
    avatarUrl: null,
    bio: null,
    location: null,
    role: 'USER',
    interests: [],
    skills: [],
    emailVerifiedAt: null,
    suspendedAt: null,
    deletedAt: null,
    googleId: null,
    appleId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findFirstOrThrow: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    rsvp: { findMany: jest.Mock };
    activityLog: { create: jest.Mock };
    emailToken: { updateMany: jest.Mock; create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  };
  let tokenService: { issuePair: jest.Mock; rotate: jest.Mock; revokeAllForUser: jest.Mock; revokeByToken: jest.Mock };
  let mailService: { send: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findFirstOrThrow: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      },
      rsvp: { findMany: jest.fn().mockResolvedValue([]) },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
      emailToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    tokenService = {
      issuePair: jest.fn().mockResolvedValue(TOKENS),
      rotate: jest.fn(),
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
      revokeByToken: jest.fn().mockResolvedValue(undefined),
    };
    mailService = { send: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: TokenService, useValue: tokenService },
        { provide: OAuthService, useValue: { verifyGoogle: jest.fn(), verifyApple: jest.fn() } },
        { provide: MailService, useValue: mailService },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
        { provide: ConfigService, useValue: { get: () => 'http://localhost:3000' } },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('signup', () => {
    it('rejects duplicate phones with 409', async () => {
      prisma.user.findFirst.mockResolvedValue(makeUser({ passwordHash: 'existing-hash' }));
      await expect(
        service.signup({ name: 'Ada', phone: '14145550100', password: 'Str0ngPassw0rd!' }, {}),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects the same handset when WhatsApp stored it without country code', async () => {
      prisma.user.findFirst.mockResolvedValue(
        makeUser({ phone: '4145550100', passwordHash: 'existing-hash' }),
      );
      await expect(
        service.signup({ name: 'Ada', phone: '1 (414) 555-0100', password: 'Str0ngPassw0rd!' }, {}),
      ).rejects.toThrow(ConflictException);
    });

    it('suggests linking a WhatsApp-only phone account instead of silently claiming it', async () => {
      const waUser = makeUser({
        id: 'wa_1',
        phone: '4145550100',
        passwordHash: null,
        whatsappLid: '173709952336025',
        name: 'WhatsApp 0100',
      });
      prisma.user.findFirst
        .mockResolvedValueOnce(waUser) // phone match
        .mockResolvedValue(null);
      prisma.user.update.mockResolvedValue({ ...waUser, phone: null });
      prisma.user.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(makeUser({ ...data, id: 'usr_new' })),
      );
      prisma.user.findMany.mockResolvedValue([]);
      prisma.rsvp.findMany.mockResolvedValue([]);

      const result = await service.signup(
        { name: 'Ada', phone: '14145550100', password: 'Str0ngPassw0rd!' },
        {},
      );

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wa_1' },
          data: { phone: null },
        }),
      );
      expect(result.user.id).toBe('usr_new');
      expect(result.linkSuggestions?.[0]).toMatchObject({
        userId: 'wa_1',
        match: 'phone',
      });
    });

    it('hashes the password with argon2 and issues tokens', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(makeUser(data)),
      );

      const result = await service.signup(
        { name: 'Ada', phone: '+1 (414) 555-0100', password: 'Str0ngPassw0rd!' },
        {},
      );

      const created = prisma.user.create.mock.calls[0][0].data;
      expect(created.phone).toBe('14145550100');
      expect(created.passwordHash).not.toBe('Str0ngPassw0rd!');
      expect(created.passwordHash).toMatch(/^\$argon2/);
      await expect(argon2.verify(created.passwordHash, 'Str0ngPassw0rd!')).resolves.toBe(true);
      expect(result.tokens).toEqual(TOKENS);
      expect(mailService.send).not.toHaveBeenCalled();
    });

    it('never exposes the password hash in the response', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(makeUser(data)),
      );
      const result = await service.signup(
        { name: 'Ada', phone: '14145550100', password: 'Str0ngPassw0rd!' },
        {},
      );
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user.phone).toBe('14145550100');
    });
  });

  describe('login', () => {
    it('rejects unknown phones with a generic message', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.login('14145550999', 'whatever', {})).rejects.toThrow(
        'Invalid phone or password',
      );
    });

    it('rejects a wrong password with the same generic message', async () => {
      const passwordHash = await argon2.hash('correct-password');
      prisma.user.findFirst.mockResolvedValue(makeUser({ passwordHash }));
      await expect(service.login('14145550100', 'wrong-password', {})).rejects.toThrow(
        'Invalid phone or password',
      );
    });

    it('rejects suspended accounts even with valid credentials', async () => {
      const passwordHash = await argon2.hash('correct-password');
      prisma.user.findFirst.mockResolvedValue(makeUser({ passwordHash, suspendedAt: new Date() }));
      await expect(service.login('14145550100', 'correct-password', {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects soft-deleted accounts', async () => {
      const passwordHash = await argon2.hash('correct-password');
      prisma.user.findFirst.mockResolvedValue(makeUser({ passwordHash, deletedAt: new Date() }));
      await expect(service.login('14145550100', 'correct-password', {})).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns the user and tokens for valid credentials', async () => {
      const passwordHash = await argon2.hash('correct-password');
      prisma.user.findFirst.mockResolvedValue(makeUser({ passwordHash }));

      const result = await service.login('14145550100', 'correct-password', {});
      expect(result.user.phone).toBe('14145550100');
      expect(result.tokens).toEqual(TOKENS);
      expect(tokenService.issuePair).toHaveBeenCalled();
    });

    it('still accepts email identifiers for older accounts', async () => {
      const passwordHash = await argon2.hash('correct-password');
      prisma.user.findUnique.mockResolvedValue(makeUser({ passwordHash }));
      const result = await service.login('ada@example.com', 'correct-password', {});
      expect(result.user.email).toBe('ada@example.com');
    });
  });

  describe('forgotPassword', () => {
    it('silently succeeds for unknown emails (no enumeration)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.forgotPassword('ghost@example.com')).resolves.toBeUndefined();
      expect(mailService.send).not.toHaveBeenCalled();
    });

    it('sends a reset email and stores only a token hash for real accounts', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      await service.forgotPassword('ada@example.com');

      expect(mailService.send).toHaveBeenCalled();
      const stored = prisma.emailToken.create.mock.calls[0][0].data;
      const mailedUrl: string = mailService.send.mock.calls[0][0].ctaUrl;
      const mailedToken = new URL(mailedUrl).searchParams.get('token')!;
      expect(stored.tokenHash).not.toBe(mailedToken);
      expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('resetPassword', () => {
    it('rejects invalid tokens', async () => {
      prisma.emailToken.findUnique.mockResolvedValue(null);
      await expect(service.resetPassword('bad-token', 'NewPassw0rd!!')).rejects.toThrow(
        'Invalid or expired token',
      );
    });

    it('rejects used tokens (single use)', async () => {
      prisma.emailToken.findUnique.mockResolvedValue({
        id: 'et_1',
        userId: 'usr_1',
        type: 'RESET_PASSWORD',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 10_000),
      });
      await expect(service.resetPassword('used-token', 'NewPassw0rd!!')).rejects.toThrow(
        'Invalid or expired token',
      );
    });

    it('updates the password and revokes every session', async () => {
      prisma.emailToken.findUnique.mockResolvedValue({
        id: 'et_1',
        userId: 'usr_1',
        type: 'RESET_PASSWORD',
        usedAt: null,
        expiresAt: new Date(Date.now() + 10_000),
      });
      prisma.user.update.mockResolvedValue(makeUser());

      await service.resetPassword('good-token', 'NewPassw0rd!!');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'usr_1' } }),
      );
      expect(tokenService.revokeAllForUser).toHaveBeenCalledWith('usr_1');
    });
  });

  describe('verifyEmail', () => {
    it('rejects a token of the wrong type', async () => {
      prisma.emailToken.findUnique.mockResolvedValue({
        id: 'et_1',
        userId: 'usr_1',
        type: 'RESET_PASSWORD',
        usedAt: null,
        expiresAt: new Date(Date.now() + 10_000),
      });
      await expect(service.verifyEmail('wrong-type')).rejects.toThrow('Invalid or expired token');
    });

    it('marks the email verified for a valid token', async () => {
      prisma.emailToken.findUnique.mockResolvedValue({
        id: 'et_1',
        userId: 'usr_1',
        type: 'VERIFY_EMAIL',
        usedAt: null,
        expiresAt: new Date(Date.now() + 10_000),
      });
      prisma.user.update.mockResolvedValue(makeUser({ emailVerifiedAt: new Date() }));

      await service.verifyEmail('valid');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'usr_1' },
        data: { emailVerifiedAt: expect.any(Date) },
      });
    });
  });

  describe('toPublicUser', () => {
    it('defaults missing interests/skills so settings/profile clients do not crash', () => {
      const raw = makeUser({
        interests: undefined,
        skills: null,
        name: '  ',
        whatsappLid: '173709952336025',
      });
      const pub = service.toPublicUser(raw as never);
      expect(pub.interests).toEqual([]);
      expect(pub.skills).toEqual([]);
      expect(pub.name).toBe('Member');
      expect(pub.whatsappLinked).toBe(true);
      expect(pub.emailVerified).toBe(false);
    });
  });
});
