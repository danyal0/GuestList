import { timingSafeEqual } from 'crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class WhatsappBotTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.WHATSAPP_BOT_TOKEN;
    const request = context.switchToHttp().getRequest<Request>();
    const headerValue = request.headers['x-whatsapp-bot-token'];
    const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!expected || !provided) {
      throw new UnauthorizedException('Unauthorized');
    }

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Unauthorized');
    }
    return true;
  }
}

export function digitsOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = String(value).replace(/\D/g, '');
  return d.length ? d : null;
}
