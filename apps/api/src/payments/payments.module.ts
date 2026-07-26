import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { InternalPaymentProvider } from './internal-payment.provider';
import { GroupsModule } from '../groups/groups.module';

/**
 * Payments run through the PAYMENT_PROVIDER abstraction. The internal
 * provider handles the full ledger lifecycle; swapping in Stripe means
 * implementing the same interface with PaymentIntents + webhooks and
 * changing this binding.
 */
@Module({
  imports: [GroupsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, { provide: PAYMENT_PROVIDER, useClass: InternalPaymentProvider }],
})
export class PaymentsModule {}
