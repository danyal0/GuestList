import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';
import { AuthUser } from '../types/auth-user';

export const CSRF_COOKIE = 'gatherly_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit-cookie CSRF protection.
 *
 * Only cookie-authenticated requests are vulnerable to CSRF (Authorization
 * headers cannot be forged cross-origin), so the check applies exclusively
 * when the JWT was read from a cookie on a state-changing method.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();

    if (SAFE_METHODS.has(request.method)) return true;
    // Refresh authenticates via the httpOnly refresh cookie itself — CSRF is redundant
    // and breaks session restore when a still-valid access cookie is also present.
    if (request.path?.endsWith('/auth/refresh') || request.url?.includes('/auth/refresh')) {
      return true;
    }
    if (!request.user || request.user.authSource !== 'cookie') return true;

    const cookieValue: string | undefined = (request.cookies ?? {})[CSRF_COOKIE];
    const headerValue = request.headers['x-csrf-token'];

    if (!cookieValue || typeof headerValue !== 'string' || headerValue.length === 0) {
      throw new ForbiddenException('Missing CSRF token');
    }

    const a = Buffer.from(cookieValue);
    const b = Buffer.from(headerValue);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Invalid CSRF token');
    }
    return true;
  }
}
