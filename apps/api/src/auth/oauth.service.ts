import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface OAuthIdentity {
  provider: 'google' | 'apple';
  providerId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  avatarUrl?: string;
}

const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUER = 'https://appleid.apple.com';

/**
 * ID-token verification for Google and Apple sign-in.
 *
 * Token-based verification (instead of a server-side redirect code flow)
 * works identically for web, iOS and Android clients: each platform obtains
 * an ID token with its native SDK and posts it here for verification.
 */
@Injectable()
export class OAuthService {
  private googleClient?: OAuth2Client;
  private appleJwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: ConfigService) {}

  async verifyGoogle(idToken: string): Promise<OAuthIdentity> {
    const clientId = this.config.get<string>('oauth.googleClientId');
    if (!clientId) {
      throw new ServiceUnavailableException('Google sign-in is not configured');
    }
    this.googleClient ??= new OAuth2Client(clientId);

    try {
      const ticket = await this.googleClient.verifyIdToken({ idToken, audience: clientId });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) {
        throw new UnauthorizedException('Google token missing required claims');
      }
      return {
        provider: 'google',
        providerId: payload.sub,
        email: payload.email.toLowerCase(),
        emailVerified: payload.email_verified === true,
        name: payload.name,
        avatarUrl: payload.picture,
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid Google token');
    }
  }

  async verifyApple(identityToken: string, fallbackName?: string): Promise<OAuthIdentity> {
    const clientId = this.config.get<string>('oauth.appleClientId');
    if (!clientId) {
      throw new ServiceUnavailableException('Apple sign-in is not configured');
    }
    this.appleJwks ??= createRemoteJWKSet(new URL(APPLE_JWKS_URL));

    try {
      const { payload } = await jwtVerify(identityToken, this.appleJwks, {
        issuer: APPLE_ISSUER,
        audience: clientId,
      });
      const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined;
      if (!payload.sub || !email) {
        throw new UnauthorizedException('Apple token missing required claims');
      }
      return {
        provider: 'apple',
        providerId: payload.sub,
        email,
        emailVerified: payload.email_verified === true || payload.email_verified === 'true',
        name: fallbackName,
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid Apple token');
    }
  }
}
