import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GroupCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import {
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
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import {
  SEARCH_PROVIDER,
  SearchProvider,
  SearchFilters,
} from './search-provider.interface';

class SearchQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  q!: string;

  @IsOptional()
  @IsIn(['all', 'groups', 'events', 'users'])
  type: 'all' | 'groups' | 'events' | 'users' = 'all';

  @IsOptional()
  @IsEnum(GroupCategory)
  category?: GroupCategory;

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
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @IsOptional()
  @IsIn(['relevance', 'popularity', 'date', 'distance'])
  sort?: 'relevance' | 'popularity' | 'date' | 'distance';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(@Inject(SEARCH_PROVIDER) private readonly searchProvider: SearchProvider) {}

  @Public()
  @Get()
  async search(@Query() dto: SearchQueryDto) {
    const filters: SearchFilters = {
      query: dto.q,
      category: dto.category,
      lat: dto.lat,
      lng: dto.lng,
      radiusKm: dto.radiusKm,
      from: dto.from,
      to: dto.to,
      sort: dto.sort,
      limit: dto.limit,
      offset: dto.offset,
    };

    const [groups, events, users] = await Promise.all([
      dto.type === 'all' || dto.type === 'groups' ? this.searchProvider.searchGroups(filters) : [],
      dto.type === 'all' || dto.type === 'events' ? this.searchProvider.searchEvents(filters) : [],
      dto.type === 'all' || dto.type === 'users' ? this.searchProvider.searchUsers(filters) : [],
    ]);

    return { groups, events, users };
  }
}
