'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { EventDetail, RsvpStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { useRouter } from 'next/navigation';

interface RsvpButtonsProps {
  event: EventDetail;
}

const OPTIONS: Array<{ status: RsvpStatus; label: string; icon: React.ElementType }> = [
  { status: 'GOING', label: 'Going', icon: Check },
  { status: 'INTERESTED', label: 'Interested', icon: Star },
  { status: 'DECLINED', label: "Can't go", icon: X },
];

/** RSVP segmented control with optimistic updates and waitlist awareness. */
export function RsvpButtons({ event }: RsvpButtonsProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const current = event.viewerRsvp?.status;

  const mutation = useMutation({
    mutationFn: (status: RsvpStatus) =>
      api<{ rsvp: { status: RsvpStatus }; waitlisted: boolean }>(`/events/${event.id}/rsvp`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      }),
    onMutate: async (status) => {
      // Optimistic update — snapshot for rollback.
      await queryClient.cancelQueries({ queryKey: ['event', event.id] });
      const previous = queryClient.getQueryData<EventDetail>(['event', event.id]);
      queryClient.setQueryData<EventDetail>(['event', event.id], (old) =>
        old ? { ...old, viewerRsvp: { status } } : old,
      );
      return { previous };
    },
    onError: (error, _status, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['event', event.id], context.previous);
      }
      toast.error(error instanceof Error ? error.message : 'Could not update your RSVP');
    },
    onSuccess: (data) => {
      if (data.waitlisted) {
        toast.info("This event is full — you've been added to the waitlist.");
      } else if (data.rsvp.status === 'GOING') {
        toast.success("You're going! We sent a confirmation.");
      }
      void queryClient.invalidateQueries({ queryKey: ['event', event.id] });
      void queryClient.invalidateQueries({ queryKey: ['my-events'] });
    },
  });

  const eventStarted = new Date(event.startTime) < new Date();
  const deadlinePassed = event.rsvpDeadline ? new Date(event.rsvpDeadline) < new Date() : false;
  const disabled = event.status !== 'PUBLISHED' || eventStarted || deadlinePassed;

  const handleClick = (status: RsvpStatus) => {
    if (!user) {
      router.push(`/login?next=/events/${event.id}`);
      return;
    }
    mutation.mutate(status);
  };

  if (disabled) {
    return (
      <p className="rounded-[var(--radius-md)] bg-[var(--color-surface-3)] px-4 py-3 text-center text-[14px] font-medium text-[var(--color-ink-secondary)]">
        {event.status === 'CANCELLED'
          ? 'This event was cancelled'
          : eventStarted
            ? 'This event has started'
            : 'RSVPs are closed'}
      </p>
    );
  }

  return (
    <div role="group" aria-label="RSVP to this event" className="flex gap-2">
      {OPTIONS.map(({ status, label, icon: Icon }) => {
        const active = current === status || (status === 'GOING' && current === 'WAITLISTED');
        const waitlisted = current === 'WAITLISTED' && status === 'GOING';
        return (
          <button
            key={status}
            type="button"
            aria-pressed={active}
            disabled={mutation.isPending}
            onClick={() => handleClick(status)}
            className={cn(
              'flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)] text-[14px] font-semibold transition-all active:scale-[0.97] disabled:opacity-60',
              active
                ? waitlisted
                  ? 'bg-[var(--color-warning)] text-white'
                  : 'bg-[var(--color-accent)] text-white'
                : 'border border-[var(--color-hairline)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]',
            )}
          >
            {waitlisted ? <Clock className="h-4 w-4" aria-hidden /> : <Icon className="h-4 w-4" aria-hidden />}
            {waitlisted ? 'Waitlisted' : label}
          </button>
        );
      })}
    </div>
  );
}
