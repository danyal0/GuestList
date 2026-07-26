import {
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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GroupsService } from './groups.service';
import {
  CreateGroupDto,
  ListGroupsDto,
  TransferOwnershipDto,
  UpdateGroupDto,
  UpdateMemberRoleDto,
} from './dto/group.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OptionalAuth } from '../common/decorators/public.decorator';
import { AuthUser } from '../common/types/auth-user';
import { PaginationDto } from '../common/dto/pagination.dto';

@ApiTags('groups')
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateGroupDto) {
    return this.groupsService.create(user.id, dto);
  }

  @OptionalAuth()
  @Get()
  async list(@Query() dto: ListGroupsDto, @CurrentUser() user?: AuthUser) {
    return this.groupsService.list(dto, user?.id);
  }

  @Get('mine')
  async myGroups(@CurrentUser() user: AuthUser) {
    return this.groupsService.getMyGroups(user.id);
  }

  @OptionalAuth()
  @Get(':idOrSlug')
  async get(@Param('idOrSlug') idOrSlug: string, @CurrentUser() user?: AuthUser) {
    return this.groupsService.getByIdOrSlug(idOrSlug, user?.id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groupsService.update(id, user.id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.groupsService.delete(id, user.id);
    return { success: true };
  }

  @Post(':id/transfer-ownership')
  @HttpCode(HttpStatus.OK)
  async transferOwnership(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: TransferOwnershipDto,
  ) {
    await this.groupsService.transferOwnership(id, user.id, dto.newOwnerId);
    return { success: true };
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.CREATED)
  async join(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.groupsService.join(id, user.id);
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  async leave(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.groupsService.leave(id, user.id);
    return { success: true };
  }

  @Get(':id/members')
  async members(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.groupsService.listMembers(id, user.id, pagination.page, pagination.limit);
  }

  @Get(':id/members/pending')
  async pendingMembers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.groupsService.listPendingMembers(id, user.id);
  }

  @Post(':id/members/:userId/approve')
  @HttpCode(HttpStatus.OK)
  async approveMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') memberUserId: string,
  ) {
    await this.groupsService.approveMember(id, user.id, memberUserId);
    return { success: true };
  }

  @Post(':id/members/:userId/reject')
  @HttpCode(HttpStatus.OK)
  async rejectMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') memberUserId: string,
  ) {
    await this.groupsService.rejectMember(id, user.id, memberUserId);
    return { success: true };
  }

  @Patch(':id/members/:userId/role')
  async updateMemberRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') memberUserId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    await this.groupsService.updateMemberRole(id, user.id, memberUserId, dto.role);
    return { success: true };
  }

  @Post(':id/members/:userId/ban')
  @HttpCode(HttpStatus.OK)
  async banMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') memberUserId: string,
  ) {
    await this.groupsService.banMember(id, user.id, memberUserId);
    return { success: true };
  }

  @Post(':id/members/:userId/unban')
  @HttpCode(HttpStatus.OK)
  async unbanMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') memberUserId: string,
  ) {
    await this.groupsService.unbanMember(id, user.id, memberUserId);
    return { success: true };
  }
}
