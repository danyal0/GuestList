import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { ProfilesService, ProfileView } from './profiles.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OptionalAuth } from '../common/decorators/public.decorator';
import { AuthUser } from '../common/types/auth-user';

class FriendRequestDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;
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

  @OptionalAuth()
  @Get(':id')
  async getProfile(@Param('id') id: string, @CurrentUser() viewer?: AuthUser): Promise<ProfileView> {
    return this.profilesService.getProfile(id, viewer?.id);
  }
}
