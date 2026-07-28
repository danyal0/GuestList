import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_OPTIONAL_AUTH_KEY, IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AccessTokenPayload, AuthUser } from '../types/auth-user';

export const ACCESS_COOKIE = 'mkeplays_access';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const isOptional = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const { token, source } = this.extractToken(request);

    if (!token) {
      if (isPublic || isOptional) return true;
      throw new UnauthorizedException('Authentication required');
    }

    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
      if (payload.type !== 'access') throw new UnauthorizedException('Invalid token type');
      request.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        authSource: source,
      };
      return true;
    } catch {
      if (isPublic || isOptional) return true;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractToken(request: Request): { token?: string; source: 'header' | 'cookie' } {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      return { token: header.slice(7), source: 'header' };
    }
    const cookie = (request.cookies ?? {})[ACCESS_COOKIE];
    return { token: cookie, source: 'cookie' };
  }
}
