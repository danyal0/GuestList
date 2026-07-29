import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RsvpStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { EventsService } from './events.service';
import {
  CancelEventQueryDto,
  CreateEventDto,
  ListEventsDto,
  UpdateEventDto,
} from './dto/event.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OptionalAuth } from '../common/decorators/public.decorator';
import { AuthUser } from '../common/types/auth-user';
import { PaginationDto } from '../common/dto/pagination.dto';

class AttendeesQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(RsvpStatus)
  status: RsvpStatus = RsvpStatus.GOING;
}

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateEventDto) {
    return this.eventsService.create(user.id, dto);
  }

  @OptionalAuth()
  @Get()
  async list(@Query() dto: ListEventsDto, @CurrentUser() user?: AuthUser) {
    return this.eventsService.list(dto, user?.id);
  }

  @Get('mine')
  async myEvents(@CurrentUser() user: AuthUser) {
    return this.eventsService.getMyEvents(user.id);
  }

  @OptionalAuth()
  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.eventsService.getById(id, user?.id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventsService.update(id, user.id, dto);
  }

  @Delete(':id')
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: CancelEventQueryDto,
  ) {
    await this.eventsService.cancel(id, user.id, query.scope ?? 'one');
    return { success: true };
  }

  @Get(':id/attendees')
  async attendees(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: AttendeesQueryDto,
  ) {
    return this.eventsService.listAttendees(id, user.id, query.status, query.page, query.limit);
  }

  @OptionalAuth()
  @Get(':id/calendar.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="event.ics"')
  @HttpCode(HttpStatus.OK)
  async calendar(@Param('id') id: string, @CurrentUser() user?: AuthUser): Promise<string> {
    return this.eventsService.exportIcs(id, user?.id);
  }
}
