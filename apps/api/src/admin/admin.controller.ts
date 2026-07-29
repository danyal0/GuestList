import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { GroupMemberRole, UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AdminService } from './admin.service';
import { EventImportService } from './event-import.service';
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

class ShadowBanDto {
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  shadowBan!: boolean;
}

class SetRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;
}

class SetGroupMemberRoleDto {
  @IsEnum(GroupMemberRole)
  role!: GroupMemberRole;
}

class BulkIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  ids!: string[];
}

@ApiTags('admin')
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly analyticsService: AnalyticsService,
    private readonly eventImportService: EventImportService,
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

  @Patch('users/:id/shadow-ban')
  async shadowBan(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() dto: ShadowBanDto,
  ) {
    await this.adminService.setUserShadowBan(admin.id, id, dto.shadowBan);
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

  @Delete('users/:id')
  @HttpCode(HttpStatus.OK)
  async deleteUser(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    await this.adminService.softDeleteUser(admin.id, id);
    return { success: true };
  }

  @Post('users/:id/hard-delete')
  @HttpCode(HttpStatus.OK)
  async hardDeleteUser(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    await this.adminService.hardDeleteUser(admin.id, id);
    return { success: true };
  }

  // ───────── Communities ─────────

  @Get('groups')
  async groups(@Query() query: AdminSearchDto) {
    return this.adminService.listGroups(query.q, query.page, query.limit);
  }

  @Get('groups/:id/members')
  async groupMembers(@Param('id') id: string) {
    return this.adminService.listGroupMembers(id);
  }

  @Patch('groups/:id/members/:userId/role')
  async setGroupMemberRole(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: SetGroupMemberRoleDto,
  ) {
    await this.adminService.setGroupMemberRole(admin.id, id, userId, dto.role);
    return { success: true };
  }

  @Delete('groups/:id')
  async removeGroup(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    await this.adminService.removeGroup(admin.id, id);
    return { success: true };
  }

  @Post('groups/:id/hard-delete')
  @HttpCode(HttpStatus.OK)
  async hardDeleteGroup(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    await this.adminService.hardDeleteGroup(admin.id, id);
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

  @Post('events/:id/hard-delete')
  @HttpCode(HttpStatus.OK)
  async hardDeleteEvent(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    await this.adminService.hardDeleteEvent(admin.id, id);
    return { success: true };
  }

  // ───────── Bulk ─────────

  @Post('bulk/users/delete')
  @HttpCode(HttpStatus.OK)
  async bulkDeleteUsers(@CurrentUser() admin: AuthUser, @Body() dto: BulkIdsDto) {
    return this.adminService.bulkSoftDeleteUsers(admin.id, dto.ids);
  }

  @Post('bulk/users/hard-delete')
  @HttpCode(HttpStatus.OK)
  async bulkHardDeleteUsers(@CurrentUser() admin: AuthUser, @Body() dto: BulkIdsDto) {
    return this.adminService.bulkHardDeleteUsers(admin.id, dto.ids);
  }

  @Post('bulk/groups/delete')
  @HttpCode(HttpStatus.OK)
  async bulkDeleteGroups(@CurrentUser() admin: AuthUser, @Body() dto: BulkIdsDto) {
    return this.adminService.bulkRemoveGroups(admin.id, dto.ids);
  }

  @Post('bulk/groups/hard-delete')
  @HttpCode(HttpStatus.OK)
  async bulkHardDeleteGroups(@CurrentUser() admin: AuthUser, @Body() dto: BulkIdsDto) {
    return this.adminService.bulkHardDeleteGroups(admin.id, dto.ids);
  }

  @Post('bulk/events/cancel')
  @HttpCode(HttpStatus.OK)
  async bulkCancelEvents(@CurrentUser() admin: AuthUser, @Body() dto: BulkIdsDto) {
    return this.adminService.bulkCancelEvents(admin.id, dto.ids);
  }

  @Post('bulk/events/hard-delete')
  @HttpCode(HttpStatus.OK)
  async bulkHardDeleteEvents(@CurrentUser() admin: AuthUser, @Body() dto: BulkIdsDto) {
    return this.adminService.bulkHardDeleteEvents(admin.id, dto.ids);
  }

  // ───────── Import ─────────

  @Post('import/events')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async importEvents(
    @CurrentUser() admin: AuthUser,
    @UploadedFile() file?: Express.Multer.File,
    @Query('includeRemote') includeRemote?: string,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a JSON or CSV file');
    const name = file.originalname || 'upload.json';
    if (!/\.(json|csv)$/i.test(name) && file.mimetype !== 'application/json' && file.mimetype !== 'text/csv') {
      throw new BadRequestException('Only .json or .csv uploads are supported');
    }
    return this.eventImportService.importFromUpload(admin.id, file.buffer, name, {
      includeRemote: includeRemote === '1' || includeRemote === 'true',
    });
  }

  // ───────── Audit ─────────

  @Get('audit-logs')
  async auditLogs(@Query() query: PaginationDto) {
    return this.adminService.listAuditLogs(query.page, query.limit);
  }

  // ───────── Analytics ─────────

  @Get('stats/detailed')
  async detailedStats() {
    return this.adminService.detailedStats();
  }

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
