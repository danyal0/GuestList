import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { GroupMemberRole, Payment, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { GroupPermissionsService } from '../groups/group-permissions.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment-provider.interface';

export const GROUP_PREMIUM_PRICE_CENTS = 2900;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: GroupPermissionsService,
    private readonly auditService: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /** Starts checkout for upgrading a community to premium (verified badge). */
  async createGroupPremiumCheckout(userId: string, groupId: string) {
    await this.permissions.requireRole(groupId, userId, GroupMemberRole.OWNER);

    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId } });
    if (group.isVerified) {
      throw new BadRequestException('This community is already premium');
    }

    const intent = await this.provider.createIntent(GROUP_PREMIUM_PRICE_CENTS, 'usd', {
      groupId,
      userId,
      purpose: 'GROUP_PREMIUM',
    });

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        groupId,
        amountCents: GROUP_PREMIUM_PRICE_CENTS,
        currency: 'usd',
        status: PaymentStatus.PENDING,
        provider: 'internal',
        providerRef: intent.providerRef,
        purpose: 'GROUP_PREMIUM',
      },
    });

    return {
      paymentId: payment.id,
      clientSecret: intent.clientSecret,
      amountCents: GROUP_PREMIUM_PRICE_CENTS,
      currency: 'usd',
    };
  }

  /** Confirms a pending payment (provider webhook equivalent). */
  async confirm(userId: string, paymentId: string): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.userId !== userId) throw new NotFoundException('Payment not found');
    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException('This payment is not pending');
    }

    const confirmed = payment.providerRef
      ? await this.provider.confirmIntent(payment.providerRef)
      : false;

    const updated = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: confirmed ? PaymentStatus.SUCCEEDED : PaymentStatus.FAILED },
    });

    if (confirmed && payment.purpose === 'GROUP_PREMIUM' && payment.groupId) {
      await this.prisma.group.update({
        where: { id: payment.groupId },
        data: { isVerified: true },
      });
    }

    await this.auditService.log({
      actorId: userId,
      action: confirmed ? 'payment.succeeded' : 'payment.failed',
      targetType: 'PAYMENT',
      targetId: paymentId,
      metadata: { amountCents: payment.amountCents, purpose: payment.purpose },
    });

    return updated;
  }

  async listMine(userId: string): Promise<Payment[]> {
    return this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
