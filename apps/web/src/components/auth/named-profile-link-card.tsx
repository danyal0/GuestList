'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

export type LinkSuggestionClue = {
  eventId: string;
  title: string;
  startTime: string;
  venueName: string | null;
  locationName: string | null;
  hostName: string | null;
  summary: string;
};

export type LinkSuggestion = {
  userId: string;
  name: string;
  clues: LinkSuggestionClue[];
};

/**
 * Shown after signup (or on settings) when WhatsApp already created a
 * name-only placeholder (e.g. "Khatera is going") that may be this person.
 */
export function NamedProfileLinkCard({
  suggestions: initial,
  onLinked,
  onDismiss,
}: {
  suggestions: LinkSuggestion[];
  onLinked?: () => void;
  onDismiss?: () => void;
}) {
  const [suggestions, setSuggestions] = React.useState(initial);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  if (suggestions.length === 0) return null;

  const claim = async (placeholderUserId: string, name: string) => {
    setBusyId(placeholderUserId);
    try {
      await api<{ linkedName: string }>('/auth/claim-named-profile', {
        method: 'POST',
        body: JSON.stringify({ placeholderUserId }),
      });
      toast.success(`Linked your prior activity as ${name}. History is on this account now.`);
      setSuggestions((prev) => prev.filter((s) => s.userId !== placeholderUserId));
      onLinked?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not link that profile');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      className="rounded-[var(--radius-lg)] border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] p-4"
      aria-label="Link prior WhatsApp activity"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-[var(--color-ink)]">
            Is this you from WhatsApp?
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink-secondary)]">
            Someone already RSVP’d under a matching name. Link to keep that history on this
            account. WhatsApp LID/phone will still attach when you message the group.
          </p>
        </div>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 text-[13px] font-semibold text-[var(--color-ink-tertiary)] hover:text-[var(--color-ink)]"
          >
            Not now
          </button>
        ) : null}
      </div>

      <ul className="mt-4 space-y-3">
        {suggestions.map((suggestion) => (
          <li
            key={suggestion.userId}
            className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3"
          >
            <p className="text-[14px] font-semibold">{suggestion.name}</p>
            <ul className="mt-2 space-y-1.5">
              {suggestion.clues.slice(0, 3).map((clue) => (
                <li
                  key={clue.eventId}
                  className="text-[13px] leading-snug text-[var(--color-ink-secondary)]"
                >
                  {clue.summary}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                loading={busyId === suggestion.userId}
                onClick={() => void claim(suggestion.userId, suggestion.name)}
              >
                Yes, link this profile
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
