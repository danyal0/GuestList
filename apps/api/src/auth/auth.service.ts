import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityType, EmailTokenType, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { TokenService, TokenPair } from './token.service';
import { OAuthService, OAuthIdentity } from './oauth.service';
import { generateOpaqueToken, hashToken } from '../common/utils/tokens';

export interface AuthResult {
  user: PublicUser;
  tokens: TokenPair;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
  role: string;
  interests: string[];
  skills: string[];
  emailVerified: boolean;
  createdAt: Date;
}

interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly oauthService: OAuthService,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {}

  async signup(email: string, password: string, name: string, meta: RequestMeta): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await argon2.hash(password);
    const user = await this.prisma.user.create({
      data: { email, passwordHash, name },
    });

    await this.prisma.activityLog.create({ data: { userId: user.id, type: ActivityType.SIGNUP } });
    await this.sendVerificationEmail(user);
    await this.auditService.log({ actorId: user.id, action: 'auth.signup', ip: meta.ip });

    const tokens = await this.tokenService.issuePair(user, meta);
    return { user: this.toPublicUser(user), tokens };
  }

  async login(email: string, password: string, meta: RequestMeta): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Run a dummy hash verification on unknown emails so response timing
    // does not reveal account existence.
    if (!user?.passwordHash) {
      await argon2
        .verify('$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', password)
        .catch(() => undefined);
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      await this.auditService.log({ actorId: user.id, action: 'auth.login_failed', ip: meta.ip });
      throw new UnauthorizedException('Invalid email or password');
    }

    this.assertAccountUsable(user);

    await this.prisma.activityLog.create({ data: { userId: user.id, type: ActivityType.LOGIN } });
    await this.auditService.log({ actorId: user.id, action: 'auth.login', ip: meta.ip });

    const tokens = await this.tokenService.issuePair(user, meta);
    return { user: this.toPublicUser(user), tokens };
  }

  async loginWithGoogle(idToken: string, meta: RequestMeta): Promise<AuthResult> {
    const identity = await this.oauthService.verifyGoogle(idToken);
    return this.upsertOAuthUser(identity, meta);
  }

  async loginWithApple(identityToken: string, name: string | undefined, meta: RequestMeta): Promise<AuthResult> {
    const identity = await this.oauthService.verifyApple(identityToken, name);
    return this.upsertOAuthUser(identity, meta);
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<AuthResult> {
    const { pair, userId } = await this.tokenService.rotate(refreshToken, meta);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { user: this.toPublicUser(user), tokens: pair };
  }

  async logout(refreshToken: string | undefined, userId: string | undefined): Promise<void> {
    if (refreshToken) {
      await this.tokenService.revokeByToken(refreshToken);
    } else if (userId) {
      await this.tokenService.revokeAllForUser(userId);
    }
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Always succeed to prevent account enumeration.
    if (!user || user.deletedAt) return;

    const token = await this.createEmailToken(user.id, EmailTokenType.RESET_PASSWORD, RESET_TTL_MS);
    const webUrl = this.config.get<string>('webUrl');
    await this.mailService.send({
      to: user.email,
      subject: 'Reset your Gatherly password',
      heading: 'Reset your password',
      body: 'We received a request to reset your password. This link expires in 1 hour. If you did not make this request, you can safely ignore this email.',
      ctaLabel: 'Reset password',
      ctaUrl: `${webUrl}/reset-password?token=${token}`,
    });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const record = await this.consumeEmailToken(token, EmailTokenType.RESET_PASSWORD);
    const passwordHash = await argon2.hash(password);
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    });
    // A password reset invalidates every active session.
    await this.tokenService.revokeAllForUser(record.userId);
    await this.auditService.log({ actorId: record.userId, action: 'auth.password_reset' });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash) {
      throw new BadRequestException('This account uses social sign-in and has no password');
    }
    const valid = await argon2.verify(user.passwordHash, currentPassword);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(newPassword) },
    });
    await this.tokenService.revokeAllForUser(userId);
    await this.auditService.log({ actorId: userId, action: 'auth.password_changed' });
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.consumeEmailToken(token, EmailTokenType.VERIFY_EMAIL);
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) throw new BadRequestException('Email is already verified');
    await this.sendVerificationEmail(user);
  }

  async getMe(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.toPublicUser(user);
  }

  toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      location: user.location,
      role: user.role,
      interests: user.interests,
      skills: user.skills,
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt,
    };
  }

  private async upsertOAuthUser(identity: OAuthIdentity, meta: RequestMeta): Promise<AuthResult> {
    const providerField = identity.provider === 'google' ? 'googleId' : 'appleId';

    let user = await this.prisma.user.findFirst({
      where: { [providerField]: identity.providerId },
    });

    if (!user) {
      // Link by verified email if an account already exists.
      const byEmail = await this.prisma.user.findUnique({ where: { email: identity.email } });
      if (byEmail) {
        if (!identity.emailVerified) {
          throw new ForbiddenException(
            'This email is registered — verify it with the provider before linking',
          );
        }
        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: { [providerField]: identity.providerId, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date() },
        });
      } else {
        user = await this.prisma.user.create({
          data: {
            email: identity.email,
            name: identity.name ?? identity.email.split('@')[0],
            avatarUrl: identity.avatarUrl,
            [providerField]: identity.providerId,
            emailVerifiedAt: identity.emailVerified ? new Date() : null,
          },
        });
        await this.prisma.activityLog.create({ data: { userId: user.id, type: ActivityType.SIGNUP } });
      }
    }

    this.assertAccountUsable(user);
    await this.prisma.activityLog.create({ data: { userId: user.id, type: ActivityType.LOGIN } });
    await this.auditService.log({
      actorId: user.id,
      action: `auth.login_${identity.provider}`,
      ip: meta.ip,
    });

    const tokens = await this.tokenService.issuePair(user, meta);
    return { user: this.toPublicUser(user), tokens };
  }

  private assertAccountUsable(user: User): void {
    if (user.deletedAt) throw new UnauthorizedException('This account has been deleted');
    if (user.suspendedAt) throw new ForbiddenException('This account is suspended');
  }

  private async sendVerificationEmail(user: User): Promise<void> {
    const token = await this.createEmailToken(user.id, EmailTokenType.VERIFY_EMAIL, VERIFY_TTL_MS);
    const webUrl = this.config.get<string>('webUrl');
    await this.mailService.send({
      to: user.email,
      subject: 'Verify your Gatherly email',
      heading: `Welcome to Gatherly, ${user.name.split(' ')[0]}!`,
      body: 'Confirm your email address to unlock everything Gatherly has to offer. This link expires in 24 hours.',
      ctaLabel: 'Verify email',
      ctaUrl: `${webUrl}/verify-email?token=${token}`,
    });
  }

  private async createEmailToken(userId: string, type: EmailTokenType, ttlMs: number): Promise<string> {
    // Invalidate previous outstanding tokens of the same type.
    await this.prisma.emailToken.updateMany({
      where: { userId, type, usedAt: null },
      data: { usedAt: new Date() },
    });
    const token = generateOpaqueToken(32);
    await this.prisma.emailToken.create({
      data: {
        userId,
        type,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    return token;
  }

  private async consumeEmailToken(token: string, type: EmailTokenType) {
    const record = await this.prisma.emailToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!record || record.type !== type) {
      throw new BadRequestException('Invalid or expired token');
    }
    if (record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired token');
    }
    await this.prisma.emailToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    return record;
  }
}
