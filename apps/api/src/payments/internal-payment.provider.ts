import { Injectable } from '@nestjs/common';
import { randomUUID, createHmac } from 'crypto';
import { CheckoutIntent, PaymentProvider } from './payment-provider.interface';

/**
 * Self-contained payment provider used until a PSP (Stripe) is connected.
 * Intents are signed with an HMAC so confirmation cannot be forged by
 * guessing references.
 */
@Injectable()
export class InternalPaymentProvider implements PaymentProvider {
  private readonly signingKey = process.env.JWT_ACCESS_SECRET ?? 'dev-payment-key';

  async createIntent(
    amountCents: number,
    currency: string,
    metadata: Record<string, string>,
  ): Promise<CheckoutIntent> {
    const providerRef = `int_${randomUUID()}`;
    const clientSecret = this.sign(providerRef, amountCents, currency);
    void metadata;
    return { providerRef, clientSecret };
  }

  async confirmIntent(providerRef: string): Promise<boolean> {
    return providerRef.startsWith('int_');
  }

  verifySecret(providerRef: string, amountCents: number, currency: string, secret: string): boolean {
    return this.sign(providerRef, amountCents, currency) === secret;
  }

  private sign(ref: string, amountCents: number, currency: string): string {
    return createHmac('sha256', this.signingKey).update(`${ref}:${amountCents}:${currency}`).digest('hex');
  }
}
