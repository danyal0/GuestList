import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { PaymentsService } from './payments.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user';

class GroupPremiumCheckoutDto {
  @IsString()
  @IsNotEmpty()
  groupId!: string;
}

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('checkout/group-premium')
  async checkoutGroupPremium(@CurrentUser() user: AuthUser, @Body() dto: GroupPremiumCheckoutDto) {
    return this.paymentsService.createGroupPremiumCheckout(user.id, dto.groupId);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.paymentsService.confirm(user.id, id);
  }

  @Get('mine')
  async mine(@CurrentUser() user: AuthUser) {
    return this.paymentsService.listMine(user.id);
  }
}
