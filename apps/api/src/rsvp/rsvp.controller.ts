import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RsvpStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';
import { RsvpService, RsvpResult } from './rsvp.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user';

class SetRsvpDto {
  @IsEnum(RsvpStatus)
  status!: RsvpStatus;
}

@ApiTags('rsvp')
@Controller('events/:eventId/rsvp')
export class RsvpController {
  constructor(private readonly rsvpService: RsvpService) {}

  @Put()
  @HttpCode(HttpStatus.OK)
  async setRsvp(
    @CurrentUser() user: AuthUser,
    @Param('eventId') eventId: string,
    @Body() dto: SetRsvpDto,
  ): Promise<RsvpResult> {
    return this.rsvpService.setRsvp(eventId, user.id, dto.status);
  }

  @Delete()
  async cancelRsvp(@CurrentUser() user: AuthUser, @Param('eventId') eventId: string) {
    await this.rsvpService.cancelRsvp(eventId, user.id);
    return { success: true };
  }
}
