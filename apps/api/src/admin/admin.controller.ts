import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminService } from './admin.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { PaginationDto } from '../common/dto/pagination.dto';

class AdminSearchDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}

class SuspendDto {
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  suspend!: boolean;
}

class SetRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;
}

@ApiTags('admin')
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  // ───────── Users ─────────

  @Get('users')
  async users(@Query() query: AdminSearchDto) {
    return this.adminService.listUsers(query.q, query.page, query.limit);
  }

  @Patch('users/:id/suspension')
  async suspend(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() dto: SuspendDto,
  ) {
    await this.adminService.setUserSuspension(admin.id, id, dto.suspend);
    return { success: true };
  }

  @Patch('users/:id/role')
  async setRole(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() dto: SetRoleDto,
  ) {
    await this.adminService.setUserRole(admin.id, id, dto.role);
    return { success: true };
  }

  // ───────── Communities ─────────

  @Get('groups')
  async groups(@Query() query: AdminSearchDto) {
    return this.adminService.listGroups(query.q, query.page, query.limit);
  }

  @Delete('groups/:id')
  async removeGroup(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    await this.adminService.removeGroup(admin.id, id);
    return { success: true };
  }

  // ───────── Events ─────────

  @Get('events')
  async events(@Query() query: AdminSearchDto) {
    return this.adminService.listEvents(query.q, query.page, query.limit);
  }

  @Delete('events/:id')
  @HttpCode(HttpStatus.OK)
  async cancelEvent(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    await this.adminService.cancelEvent(admin.id, id);
    return { success: true };
  }

  // ───────── Audit ─────────

  @Get('audit-logs')
  async auditLogs(@Query() query: PaginationDto) {
    return this.adminService.listAuditLogs(query.page, query.limit);
  }

  // ───────── Analytics ─────────

  @Get('analytics/overview')
  async overview() {
    return this.analyticsService.overview();
  }

  @Get('analytics/dau')
  async dau() {
    return this.analyticsService.dailyActiveUsers();
  }

  @Get('analytics/mau')
  async mau() {
    return this.analyticsService.monthlyActiveUsers();
  }

  @Get('analytics/growth')
  async growth() {
    return this.analyticsService.signupGrowth();
  }

  @Get('analytics/retention')
  async retention() {
    return this.analyticsService.weeklyRetention();
  }

  @Get('analytics/attendance')
  async attendance() {
    return this.analyticsService.eventAttendance();
  }
}
