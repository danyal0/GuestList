import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { WhatsappBotTokenGuard } from './whatsapp-bot.guard';
import { WhatsappCreateEventDto, WhatsappRsvpDto } from './whatsapp.dto';
import { WhatsappService } from './whatsapp.service';

/**
 * Bot bridge endpoints. Unversioned under /api/whatsapp/* so the WhatsApp
 * process can POST without caring about /api/v1. Uses the same PrismaService
 * as the rest of the API — including file-backed mock DB when DATABASE_URL
 * is unset.
 */
@ApiExcludeController()
@Public()
@UseGuards(WhatsappBotTokenGuard)
@Controller({ path: 'whatsapp', version: VERSION_NEUTRAL })
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('create-event')
  async createEvent(@Body() body: WhatsappCreateEventDto) {
    const result = await this.whatsappService.createEvent(body);
    return result;
  }

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('rsvp')
  @HttpCode(HttpStatus.OK)
  rsvp(@Body() body: WhatsappRsvpDto) {
    return this.whatsappService.rsvp(body);
  }
}
