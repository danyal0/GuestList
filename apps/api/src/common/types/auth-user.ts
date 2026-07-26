import { UserRole } from '@prisma/client';

/** Shape attached to `request.user` after JWT verification. */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  /** Where credentials came from — cookie-authenticated requests require CSRF tokens. */
  authSource: 'header' | 'cookie';
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  type: 'access';
}
