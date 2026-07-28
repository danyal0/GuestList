import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { hashToken } from '../common/utils/tokens';
import { TokenService } from './token.service';

const user = { id: 'usr_1', email: 'a@b.co', phone: '14145550100', role: 'USER' as const };

describe('TokenService', () => {
  let service: TokenService;
  let prisma: {
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenService,
        JwtService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({
                'jwt.accessSecret': 'test-access-secret',
                'jwt.accessTtlSeconds': 900,
                'jwt.refreshTtlSeconds': 3600,
              })[key],
          },
        },
      ],
    }).compile();

    service = moduleRef.get(TokenService);
  });

  describe('issuePair', () => {
    it('returns a signed access token and an opaque refresh token', async () => {
      const pair = await service.issuePair(user);
      expect(pair.accessToken.split('.')).toHaveLength(3);
      expect(pair.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(pair.accessExpiresIn).toBe(900);
    });

    it('persists only the hash of the refresh token', async () => {
      const pair = await service.issuePair(user);
      const stored = prisma.refreshToken.create.mock.calls[0][0].data;
      expect(stored.tokenHash).toBe(hashToken(pair.refreshToken));
      expect(stored.tokenHash).not.toBe(pair.refreshToken);
    });
  });

  describe('rotate', () => {
    it('rejects unknown tokens', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.rotate('nope')).rejects.toThrow(UnauthorizedException);
    });

    it('revokes the whole family when a rotated token is replayed', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt_1',
        family: 'fam_1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 10_000),
        user: { ...user, suspendedAt: null, deletedAt: null },
        userId: user.id,
      });

      await expect(service.rotate('replayed')).rejects.toThrow('Refresh token reuse detected');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { family: 'fam_1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('rejects expired tokens', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt_1',
        family: 'fam_1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        user: { ...user, suspendedAt: null, deletedAt: null },
        userId: user.id,
      });
      await expect(service.rotate('expired')).rejects.toThrow('Refresh token expired');
    });

    it('rejects and revokes the family for suspended accounts', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt_1',
        family: 'fam_1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10_000),
        user: { ...user, suspendedAt: new Date(), deletedAt: null },
        userId: user.id,
      });
      await expect(service.rotate('token')).rejects.toThrow('Account unavailable');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    });

    it('revokes the presented token and links its successor on success', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt_1',
        family: 'fam_1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 10_000),
        user: { ...user, suspendedAt: null, deletedAt: null },
        userId: user.id,
      });

      const { pair, userId } = await service.rotate('valid-token');
      expect(userId).toBe(user.id);
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt_1' },
        data: { revokedAt: expect.any(Date), replacedById: hashToken(pair.refreshToken) },
      });
      // The new token belongs to the same family.
      const created = prisma.refreshToken.create.mock.calls[0][0].data;
      expect(created.family).toBe('fam_1');
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes every active token for the user', async () => {
      await service.revokeAllForUser('usr_1');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'usr_1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
