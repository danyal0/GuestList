import { NotificationType } from '@prisma/client';

/** Internal event name used to fan out notifications across channels. */
export const NOTIFY_EVENT = 'notification.dispatch';

export interface NotifyPayload {
  userId: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  /** When true also send an email (reminders, RSVP confirmations, etc.). */
  email?: {
    subject: string;
    heading: string;
    body: string;
    ctaLabel?: string;
    ctaPath?: string;
  };
}
