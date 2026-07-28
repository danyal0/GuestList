import { EventMode, EventStatus, EventVisibility } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  groupId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(140)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  title!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(10000)
  description!: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  coverImage?: string;

  @IsEnum(EventMode)
  mode!: EventMode;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  locationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  onlineUrl?: string;

  @IsTimeZone()
  timezone!: string;

  @Type(() => Date)
  @IsDate()
  startTime!: Date;

  @Type(() => Date)
  @IsDate()
  endTime!: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  capacity?: number;

  @IsOptional()
  @IsEnum(EventVisibility)
  visibility?: EventVisibility;

  @IsOptional()
  @IsBoolean()
  allowWaitlist?: boolean;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  rsvpDeadline?: Date;

  /** iCalendar RRULE string, e.g. "FREQ=WEEKLY;COUNT=8". */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  recurrenceRule?: string;

  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;
}

export class UpdateEventDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(140)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  coverImage?: string;

  @IsOptional()
  @IsEnum(EventMode)
  mode?: EventMode;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  locationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  onlineUrl?: string;

  @IsOptional()
  @IsTimeZone()
  timezone?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startTime?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endTime?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  capacity?: number;

  @IsOptional()
  @IsEnum(EventVisibility)
  visibility?: EventVisibility;

  @IsOptional()
  @IsBoolean()
  allowWaitlist?: boolean;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  rsvpDeadline?: Date;

  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;
}

export class ListEventsDto extends PaginationDto {
  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsEnum(EventMode)
  mode?: EventMode;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20000)
  radiusKm?: number;

  @IsOptional()
  @IsIn(['soonest', 'popular', 'newest'])
  sort?: 'soonest' | 'popular' | 'newest';

  /** Defaults to PUBLISHED. Pass CANCELLED to browse cancelled events. */
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;
}
