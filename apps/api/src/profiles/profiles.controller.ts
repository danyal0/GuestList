import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ProfilesService, ProfileView } from './profiles.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OptionalAuth } from '../common/decorators/public.decorator';
import { AuthUser } from '../common/types/auth-user';

class FriendRequestDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;
}

class ProfileEventsQuery {
  @IsOptional()
  @IsIn(['attended', 'hosted'])
  kind?: 'attended' | 'hosted';
}

@ApiTags('profiles')
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get('me/follows')
  async myFollows(@CurrentUser() user: AuthUser) {
    return this.profilesService.getFollowedGroups(user.id);
  }

  @Get('me/friends')
  async myFriends(@CurrentUser() user: AuthUser) {
    return this.profilesService.getFriends(user.id);
  }

  @Get('me/friend-requests')
  async myFriendRequests(@CurrentUser() user: AuthUser) {
    return this.profilesService.getPendingRequests(user.id);
  }

  @Get('me/blocks')
  async myBlocks(@CurrentUser() user: AuthUser) {
    return this.profilesService.listBlockedUsers(user.id);
  }

  @Post('follows/:groupId')
  @HttpCode(HttpStatus.CREATED)
  async follow(@CurrentUser() user: AuthUser, @Param('groupId') groupId: string) {
    await this.profilesService.followGroup(user.id, groupId);
    return { success: true };
  }

  @Delete('follows/:groupId')
  async unfollow(@CurrentUser() user: AuthUser, @Param('groupId') groupId: string) {
    await this.profilesService.unfollowGroup(user.id, groupId);
    return { success: true };
  }

  @Post('friend-requests')
  @HttpCode(HttpStatus.CREATED)
  async sendFriendRequest(@CurrentUser() user: AuthUser, @Body() dto: FriendRequestDto) {
    await this.profilesService.sendFriendRequest(user.id, dto.userId);
    return { success: true };
  }

  @Delete('friend-requests/:userId')
  @HttpCode(HttpStatus.OK)
  async cancelFriendRequest(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    await this.profilesService.cancelFriendRequest(user.id, userId);
    return { success: true };
  }

  @Post('friend-requests/:id/accept')
  @HttpCode(HttpStatus.OK)
  async acceptFriendRequest(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.profilesService.respondToFriendRequest(user.id, id, true);
    return { success: true };
  }

  @Post('friend-requests/:id/decline')
  @HttpCode(HttpStatus.OK)
  async declineFriendRequest(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.profilesService.respondToFriendRequest(user.id, id, false);
    return { success: true };
  }

  @Delete('friends/:userId')
  @HttpCode(HttpStatus.OK)
  async removeFriend(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    await this.profilesService.removeFriend(user.id, userId);
    return { success: true };
  }

  @Post('blocks/:userId')
  @HttpCode(HttpStatus.CREATED)
  async blockUser(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    await this.profilesService.blockUser(user.id, userId);
    return { success: true };
  }

  @Delete('blocks/:userId')
  @HttpCode(HttpStatus.OK)
  async unblockUser(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    await this.profilesService.unblockUser(user.id, userId);
    return { success: true };
  }

  @OptionalAuth()
  @Get(':id/communities')
  async profileCommunities(@Param('id') id: string, @CurrentUser() viewer?: AuthUser) {
    return this.profilesService.listProfileCommunities(id, viewer?.id);
  }

  @OptionalAuth()
  @Get(':id/events')
  async profileEvents(
    @Param('id') id: string,
    @Query() query: ProfileEventsQuery,
    @CurrentUser() viewer?: AuthUser,
  ) {
    const kind = query.kind === 'hosted' ? 'hosted' : 'attended';
    return this.profilesService.listProfileEvents(id, kind, viewer?.id);
  }

  @OptionalAuth()
  @Get(':id/friends')
  async profileFriends(@Param('id') id: string, @CurrentUser() viewer?: AuthUser) {
    return this.profilesService.listProfileFriends(id, viewer?.id);
  }

  @OptionalAuth()
  @Get(':id')
  async getProfile(@Param('id') id: string, @CurrentUser() viewer?: AuthUser): Promise<ProfileView> {
    return this.profilesService.getProfile(id, viewer?.id);
  }
}
