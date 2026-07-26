import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { RecommendationsService } from './recommendations.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user';

class RecommendationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 12;
}

@ApiTags('recommendations')
@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recommendationsService: RecommendationsService) {}

  @Get('groups')
  async groups(@CurrentUser() user: AuthUser, @Query() query: RecommendationsQueryDto) {
    return this.recommendationsService.recommendGroups(user.id, query.limit);
  }

  @Get('events')
  async events(@CurrentUser() user: AuthUser, @Query() query: RecommendationsQueryDto) {
    return this.recommendationsService.recommendEvents(user.id, query.limit);
  }
}
