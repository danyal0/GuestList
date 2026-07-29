export function eventShareUrl(eventId: string): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/events/${eventId}`;
  }
  const base =
    process.env.NEXT_PUBLIC_WEB_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/events/${eventId}`;
}

export type ShareEventResult = 'shared' | 'copied';

/** Copy the event link, then open the native share sheet when available. */
export async function shareEvent(input: {
  id: string;
  title: string;
  groupName?: string;
}): Promise<ShareEventResult> {
  const url = eventShareUrl(input.id);
  const text = input.groupName ? `${input.title} · ${input.groupName}` : input.title;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: input.title, text, url });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'copied';
      }
      if (error instanceof Error && error.name === 'AbortError') {
        return 'copied';
      }
      throw error;
    }
  }

  return 'copied';
}
