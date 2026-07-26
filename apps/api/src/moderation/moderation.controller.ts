import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ReportStatus, ReportTargetType, UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ModerationService } from './moderation.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { PaginationDto } from '../common/dto/pagination.dto';

class CreateReportDto {
  @IsEnum(ReportTargetType)
  targetType!: ReportTargetType;

  @IsString()
  @IsNotEmpty()
  targetId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  details?: string;
}

class ListReportsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;
}

class ResolveReportDto {
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  dismiss!: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  resolution!: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  takedown?: boolean;
}

@ApiTags('moderation')
@Controller('moderation')
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Post('reports')
  async createReport(@CurrentUser() user: AuthUser, @Body() dto: CreateReportDto) {
    return this.moderationService.createReport(
      user.id,
      dto.targetType,
      dto.targetId,
      dto.reason,
      dto.details,
    );
  }

  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @Get('reports')
  async listReports(@Query() query: ListReportsDto) {
    return this.moderationService.listReports(query.status, query.page, query.limit);
  }

  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @Post('reports/:id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolveReport(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.moderationService.resolveReport(
      user.id,
      id,
      dto.dismiss,
      dto.resolution,
      dto.takedown ?? false,
    );
  }
}
