import { Body, Controller, Delete, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ActivityType } from '@prisma/client';
import { UsersService, PublicUserSummary, toAuthPublicUser } from './users.service';
import { UpdateUserDto } from './dto/user.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user';
import { Public } from '../common/decorators/public.decorator';
import { PaginationDto, Paginated } from '../common/dto/pagination.dto';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch('me')
  async updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateUserDto) {
    const updated = await this.usersService.updateMe(user.id, dto);
    // Same shape as /auth/me — raw Prisma rows lack whatsappLinked/emailVerified
    // and can omit interests/skills, which crashed Settings after save.
    return toAuthPublicUser(updated);
  }

  @Delete('me')
  async deleteMe(@CurrentUser() user: AuthUser): Promise<{ success: boolean }> {
    await this.usersService.deleteMe(user.id);
    return { success: true };
  }

  @Get('me/activity')
  async myActivity(
    @CurrentUser() user: AuthUser,
    @Query() pagination: PaginationDto,
  ): Promise<Paginated<{ id: string; type: ActivityType; metadata: unknown; createdAt: Date }>> {
    return this.usersService.getActivity(user.id, pagination.page, pagination.limit);
  }

  @Public()
  @Get(':id')
  async getUser(@Param('id') id: string): Promise<PublicUserSummary> {
    return this.usersService.findPublicById(id);
  }
}
