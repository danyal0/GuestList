export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface CheckoutIntent {
  /** Provider-side reference (e.g. Stripe PaymentIntent id). */
  providerRef: string;
  /** Client secret / redirect URL the frontend uses to complete payment. */
  clientSecret: string;
}

export interface PaymentProvider {
  createIntent(amountCents: number, currency: string, metadata: Record<string, string>): Promise<CheckoutIntent>;
  /** Returns true when the provider confirms the charge succeeded. */
  confirmIntent(providerRef: string): Promise<boolean>;
}
