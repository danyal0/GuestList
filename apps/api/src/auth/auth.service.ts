import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityType, EmailTokenType, User, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { TokenService, TokenPair } from './token.service';
import { OAuthService, OAuthIdentity } from './oauth.service';
import { generateOpaqueToken, hashToken } from '../common/utils/tokens';
import {
  isPlausiblePhone,
  normalizePhoneDigits,
  phoneMatchWhere,
  preferCanonicalPhone,
} from '../common/utils/phone';
import {
  claimNamedPlaceholder,
  findNamedPlaceholderSuggestions,
  suggestionForWhatsappPhoneUser,
  type NamedProfileLinkSuggestion,
} from '../whatsapp/whatsapp-identity';
import { toAuthPublicUser } from '../users/users.service';

export interface AuthResult {
  user: PublicUser;
  tokens: TokenPair;
  linkSuggestions?: NamedProfileLinkSuggestion[];
}

export type { NamedProfileLinkSuggestion };

export interface PublicUser {
  id: string;
  email: string | null;
  phone: string | null;
  whatsappLid: string | null;
  whatsappLinked: boolean;
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

  async signup(
    input: { name: string; phone: string; password: string; email?: string },
    meta: RequestMeta,
  ): Promise<AuthResult> {
    const rawPhone = normalizePhoneDigits(input.phone);
    if (!rawPhone || !isPlausiblePhone(rawPhone)) {
      throw new BadRequestException('Enter a valid phone number');
    }
    const phone = preferCanonicalPhone(rawPhone);

    const email =
      input.email && String(input.email).trim()
        ? String(input.email).toLowerCase().trim()
        : null;

    // Match US 10-digit ↔ 11-digit variants so WhatsApp rows can't be duplicated at signup.
    const existingPhone = await this.prisma.user.findFirst({
      where: phoneMatchWhere(phone),
      select: {
        id: true,
        name: true,
        phone: true,
        whatsappLid: true,
        passwordHash: true,
        email: true,
        deletedAt: true,
      },
    });

    let whatsappLinkCandidate: {
      id: string;
      name: string;
      whatsappLid: string | null;
    } | null = null;

    if (existingPhone) {
      if (existingPhone.deletedAt) {
        // Free unique phone/LID on soft-deleted rows so the number can be reused.
        await this.prisma.user.update({
          where: { id: existingPhone.id },
          data: { phone: null, whatsappLid: null },
        });
      } else if (existingPhone.passwordHash) {
        throw new ConflictException('An account with this phone already exists');
      } else {
        // Passwordless WhatsApp bridge account — move the phone onto the new
        // signup and offer to merge LID/RSVP history (same UX as named placeholders).
        whatsappLinkCandidate = {
          id: existingPhone.id,
          name: existingPhone.name,
          whatsappLid: existingPhone.whatsappLid,
        };
        await this.prisma.user.update({
          where: { id: existingPhone.id },
          data: { phone: null },
        });
      }
    }

    if (email) {
      const existingEmail = await this.prisma.user.findUnique({ where: { email } });
      if (existingEmail && !existingEmail.deletedAt) {
        // Roll back phone move if we already detached a WA row.
        if (whatsappLinkCandidate) {
          await this.prisma.user.update({
            where: { id: whatsappLinkCandidate.id },
            data: { phone },
          }).catch(() => undefined);
        }
        throw new ConflictException('An account with this email already exists');
      }
    }

    const passwordHash = await argon2.hash(input.password);
    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        phone,
        email,
        passwordHash,
        deletedAt: null,
        suspendedAt: null,
        whatsappLid: null,
      },
    });

    await this.prisma.activityLog.create({ data: { userId: user.id, type: ActivityType.SIGNUP } });
    if (email) {
      await this.sendVerificationEmail(user);
    }
    await this.auditService.log({
      actorId: user.id,
      action: whatsappLinkCandidate ? 'auth.signup_with_whatsapp_phone_match' : 'auth.signup',
      ip: meta.ip,
      ...(whatsappLinkCandidate
        ? { targetType: 'USER', targetId: whatsappLinkCandidate.id }
        : {}),
    });

    const tokens = await this.tokenService.issuePair(user, meta);
    const linkSuggestions: NamedProfileLinkSuggestion[] = [];
    if (whatsappLinkCandidate) {
      linkSuggestions.push(
        await suggestionForWhatsappPhoneUser(this.prisma, whatsappLinkCandidate),
      );
    }
    const named = await findNamedPlaceholderSuggestions(this.prisma, input.name, {
      excludeUserId: user.id,
    });
    for (const suggestion of named) {
      if (!linkSuggestions.some((s) => s.userId === suggestion.userId)) {
        linkSuggestions.push(suggestion);
      }
    }
    return {
      user: this.toPublicUser(user),
      tokens,
      linkSuggestions: linkSuggestions.length ? linkSuggestions : undefined,
    };
  }

  /** Profiles created from WhatsApp (name placeholders or phone/LID bridge) that may belong to this user. */
  async listNamedLinkSuggestions(userId: string): Promise<NamedProfileLinkSuggestion[]> {
    const me = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, name: true, phone: true },
    });
    if (!me) throw new UnauthorizedException('Not authenticated');

    const suggestions: NamedProfileLinkSuggestion[] = [];

    if (me.phone) {
      const waMatch = await this.prisma.user.findFirst({
        where: {
          deletedAt: null,
          passwordHash: null,
          id: { not: me.id },
          OR: [
            ...phoneMatchWhere(me.phone).OR,
            // After signup we may have moved the phone off the WA row; still surface LID-only
            // bridge accounts that share the signup display name.
            {
              whatsappLid: { not: null },
              phone: null,
              name: { equals: me.name, mode: 'insensitive' },
            },
          ],
        },
        select: { id: true, name: true, phone: true, whatsappLid: true, passwordHash: true },
      });
      if (waMatch && (waMatch.phone || waMatch.whatsappLid)) {
        suggestions.push(await suggestionForWhatsappPhoneUser(this.prisma, waMatch));
      }
    }

    const named = await findNamedPlaceholderSuggestions(this.prisma, me.name, {
      excludeUserId: me.id,
    });
    for (const suggestion of named) {
      if (!suggestions.some((s) => s.userId === suggestion.userId)) {
        suggestions.push(suggestion);
      }
    }
    return suggestions;
  }

  /**
   * Merge a named WhatsApp placeholder into the signed-in account.
   * Keeps RSVP history; WhatsApp LID/phone continue to attach via existing flows.
   */
  async claimNamedProfile(
    userId: string,
    placeholderUserId: string,
  ): Promise<{ user: PublicUser; linkedName: string }> {
    try {
      const linked = await claimNamedPlaceholder(
        this.prisma,
        userId,
        placeholderUserId,
      );
      await this.auditService.log({
        actorId: userId,
        action: 'auth.claim_named_profile',
        targetType: 'USER',
        targetId: placeholderUserId,
      });
      const user = await this.prisma.user.findFirstOrThrow({
        where: { id: userId },
      });
      return { user: this.toPublicUser(user), linkedName: linked.name };
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Could not link that profile',
      );
    }
  }

  async login(identifier: string, password: string, meta: RequestMeta): Promise<AuthResult> {
    let user = await this.findUserByIdentifier(identifier);
    // Run a dummy hash verification on unknown accounts so response timing
    // does not reveal account existence.
    if (!user?.passwordHash) {
      await argon2
        .verify('$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', password)
        .catch(() => undefined);
      throw new UnauthorizedException('Invalid phone or password');
    }

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      await this.auditService.log({ actorId: user.id, action: 'auth.login_failed', ip: meta.ip });
      throw new UnauthorizedException('Invalid phone or password');
    }

    this.assertAccountUsable(user);
    user = await this.ensureConfiguredAdmin(user);

    await this.prisma.activityLog.create({ data: { userId: user.id, type: ActivityType.LOGIN } });
    await this.auditService.log({ actorId: user.id, action: 'auth.login', ip: meta.ip });

    const tokens = await this.tokenService.issuePair(user, meta);
    return { user: this.toPublicUser(user), tokens };
  }

  private async findUserByIdentifier(identifier: string): Promise<User | null> {
    const raw = String(identifier).trim();
    if (!raw) return null;

    const phone = normalizePhoneDigits(raw);
    if (phone && isPlausiblePhone(phone) && !raw.includes('@')) {
      return this.prisma.user.findFirst({
        where: phoneMatchWhere(preferCanonicalPhone(phone)),
      });
    }

    return this.prisma.user.findUnique({
      where: { email: raw.toLowerCase() },
    });
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
    let user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    user = await this.ensureConfiguredAdmin(user);
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
    if (!user || user.deletedAt || !user.email) return;

    const token = await this.createEmailToken(user.id, EmailTokenType.RESET_PASSWORD, RESET_TTL_MS);
    const webUrl = this.config.get<string>('webUrl');
    await this.mailService.send({
      to: user.email,
      subject: 'Reset your MKE Plays password',
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
    if (!user.email) throw new BadRequestException('This account has no email address');
    if (user.emailVerifiedAt) throw new BadRequestException('Email is already verified');
    await this.sendVerificationEmail(user);
  }

  async getMe(userId: string): Promise<PublicUser> {
    let user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    user = await this.ensureConfiguredAdmin(user);
    return this.toPublicUser(user);
  }

  toPublicUser(user: User): PublicUser {
    return toAuthPublicUser(user) as PublicUser;
  }

  /**
   * Promote accounts listed in ADMIN_EMAILS / ADMIN_PHONES (plus seed admin)
   * so the platform owner can always reach /admin even if the file DB role drifted.
   */
  private async ensureConfiguredAdmin(user: User): Promise<User> {
    if (user.role === UserRole.ADMIN) return user;
    const emailsRaw = this.config.get<string[] | string>('adminEmails');
    const phonesRaw = this.config.get<string[] | string>('adminPhones');
    const emails = Array.isArray(emailsRaw) ? emailsRaw : [];
    const phones = Array.isArray(phonesRaw) ? phonesRaw : [];
    const email = user.email?.toLowerCase() ?? '';
    const phone = normalizePhoneDigits(user.phone) ?? '';
    const match =
      (email && emails.includes(email)) ||
      (phone && phones.some((p) => p === phone || p === preferCanonicalPhone(phone)));
    if (!match) return user;

    return this.prisma.user.update({
      where: { id: user.id },
      data: { role: UserRole.ADMIN },
    });
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
    user = await this.ensureConfiguredAdmin(user);
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
    if (!user.email) return;
    const token = await this.createEmailToken(user.id, EmailTokenType.VERIFY_EMAIL, VERIFY_TTL_MS);
    const webUrl = this.config.get<string>('webUrl');
    await this.mailService.send({
      to: user.email,
      subject: 'Verify your MKE Plays email',
      heading: `Welcome to MKE Plays, ${user.name.split(' ')[0]}!`,
      body: 'Confirm your email address to unlock everything MKE Plays has to offer. This link expires in 24 hours.',
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
