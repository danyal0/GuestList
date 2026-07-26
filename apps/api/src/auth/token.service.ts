import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { generateOpaqueToken, hashToken } from '../common/utils/tokens';
import { AccessTokenPayload } from '../common/types/auth-user';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  refreshExpiresIn: number;
}

interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

/**
 * Refresh-token rotation with family-based reuse detection.
 *
 * Every login starts a token "family". Each refresh revokes the presented
 * token and issues a successor in the same family. If a revoked token is
 * ever presented again (theft or replay), the entire family is revoked,
 * forcing re-authentication on all devices in that chain.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async issuePair(user: Pick<User, 'id' | 'email' | 'role'>, meta: RequestMeta = {}): Promise<TokenPair> {
    return this.createPair(user, randomUUID(), meta);
  }

  async rotate(presentedToken: string, meta: RequestMeta = {}): Promise<{ pair: TokenPair; userId: string }> {
    const tokenHash = hashToken(presentedToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record) throw new UnauthorizedException('Invalid refresh token');

    if (record.revokedAt) {
      // Reuse of a rotated token — assume compromise, kill the whole family.
      await this.revokeFamily(record.family);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (record.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (record.user.suspendedAt || record.user.deletedAt) {
      await this.revokeFamily(record.family);
      throw new UnauthorizedException('Account unavailable');
    }

    const pair = await this.createPair(record.user, record.family, meta);
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date(), replacedById: hashToken(pair.refreshToken) },
    });

    return { pair, userId: record.userId };
  }

  async revokeByToken(presentedToken: string): Promise<void> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(presentedToken) },
    });
    if (record) await this.revokeFamily(record.family);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async revokeFamily(family: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createPair(
    user: Pick<User, 'id' | 'email' | 'role'>,
    family: string,
    meta: RequestMeta,
  ): Promise<TokenPair> {
    const accessTtl = this.config.get<number>('jwt.accessTtlSeconds') ?? 900;
    const refreshTtl = this.config.get<number>('jwt.refreshTtlSeconds') ?? 2592000;

    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
    };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: accessTtl,
    });

    const refreshToken = generateOpaqueToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        family,
        userAgent: meta.userAgent?.slice(0, 255),
        ip: meta.ip,
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });

    return { accessToken, refreshToken, accessExpiresIn: accessTtl, refreshExpiresIn: refreshTtl };
  }
}
