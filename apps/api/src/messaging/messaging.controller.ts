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
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MessagingService } from './messaging.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user';

class OpenDirectDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;
}

class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string;
}

class MessagesQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}

@ApiTags('messaging')
@Controller('messaging')
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Get('conversations')
  async conversations(@CurrentUser() user: AuthUser) {
    return this.messagingService.listConversations(user.id);
  }

  @Post('conversations/direct')
  @HttpCode(HttpStatus.OK)
  async openDirect(@CurrentUser() user: AuthUser, @Body() dto: OpenDirectDto) {
    return this.messagingService.openDirectConversation(user.id, dto.userId);
  }

  @Post('conversations/group/:groupId')
  @HttpCode(HttpStatus.OK)
  async openGroup(@CurrentUser() user: AuthUser, @Param('groupId') groupId: string) {
    return this.messagingService.openGroupConversation(user.id, groupId);
  }

  @Get('conversations/:id/messages')
  async messages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: MessagesQueryDto,
  ) {
    return this.messagingService.getMessages(id, user.id, query.cursor, query.limit);
  }

  @Post('conversations/:id/messages')
  async send(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messagingService.sendMessage(id, user.id, dto.content);
  }

  @Post('conversations/:id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.messagingService.markRead(id, user.id);
    return { success: true };
  }

  @Delete('messages/:id')
  async deleteMessage(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.messagingService.deleteMessage(id, user.id);
    return { success: true };
  }
}
