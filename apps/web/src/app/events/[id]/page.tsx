'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  CalendarPlus,
  Clock,
  Globe,
  MapPin,
  Repeat,
  Users,
  Video,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { EventDetail } from '@/lib/types';
import { formatDate, formatTime } from '@/lib/utils';
import { formatSpotsLabel, hasSpotsLeft } from '@/lib/capacity';
import { useAuthStore } from '@/stores/auth-store';
import { getSocket } from '@/lib/socket';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RsvpButtons } from '@/components/events/rsvp-buttons';
import { ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const event = useQuery({
    queryKey: ['event', id],
    queryFn: () => api<EventDetail>(`/events/${id}`),
  });

  // Live RSVP counts + event changes while viewing.
  React.useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('event:watch', { eventId: id });
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ['event', id] });
    socket.on('rsvp:updated', refresh);
    socket.on('event:updated', refresh);
    return () => {
      socket.emit('event:unwatch', { eventId: id });
      socket.off('rsvp:updated', refresh);
      socket.off('event:updated', refresh);
    };
  }, [id, queryClient, user]);

  if (event.isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Skeleton className="h-64 w-full rounded-[var(--radius-xl)]" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (event.isError || !event.data) {
    return <ErrorState title="Event not found" message="It may be members-only or no longer exist." />;
  }

  const e = event.data;
  const isFull = hasSpotsLeft(e.spotsLeft) && e.spotsLeft === 0;

  return (
    <article className="mx-auto max-w-3xl space-y-6">
      {/* Cover */}
      <div className="relative h-56 overflow-hidden rounded-[var(--radius-xl)] bg-gradient-to-br from-[var(--color-accent)] to-[#5e5ce6] md:h-72">
        {e.coverImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={e.coverImage} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <CalendarDays className="h-16 w-16 text-white/50" aria-hidden />
          </div>
        )}
        {e.status === 'CANCELLED' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55">
            <Badge variant="danger" className="px-4 py-1.5 text-[15px]">
              This event was cancelled
            </Badge>
          </div>
        )}
      </div>

      {/* Header */}
      <header>
        <Link
          href={`/groups/${e.group.slug}`}
          className="text-[14px] font-semibold text-[var(--color-accent)]"
        >
          {e.group.name}
        </Link>
        <h1 className="mt-1 text-[30px] font-extrabold leading-tight tracking-tight">{e.title}</h1>
        <p className="mt-2 flex items-center gap-2 text-[14px] text-[var(--color-ink-secondary)]">
          Hosted by
          <Link href={`/profile/${e.host.id}`} className="flex items-center gap-1.5 font-semibold text-[var(--color-ink)]">
            <Avatar src={e.host.avatarUrl} name={e.host.name} size="sm" /> {e.host.name}
          </Link>
        </p>
      </header>

      {/* Key facts */}
      <div className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5 sm:grid-cols-2">
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 h-5 w-5 text-[var(--color-accent)]" aria-hidden />
          <div>
            <p className="text-[15px] font-semibold">
              {formatDate(e.startTime, { year: 'numeric' })}
            </p>
            <p className="text-[14px] text-[var(--color-ink-secondary)]">
              {formatTime(e.startTime)} – {formatTime(e.endTime)}
              <span className="text-[var(--color-ink-tertiary)]"> · {e.timezone}</span>
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          {e.mode === 'ONLINE' ? (
            <Video className="mt-0.5 h-5 w-5 text-[var(--color-accent)]" aria-hidden />
          ) : (
            <MapPin className="mt-0.5 h-5 w-5 text-[var(--color-accent)]" aria-hidden />
          )}
          <div>
            <p className="text-[15px] font-semibold">
              {e.mode === 'ONLINE' ? 'Online event' : e.locationName ?? 'Location TBD'}
              {e.mode === 'HYBRID' && ' · Hybrid'}
            </p>
            {e.address && <p className="text-[14px] text-[var(--color-ink-secondary)]">{e.address}</p>}
            {e.onlineUrl && (e.viewerRsvp?.status === 'GOING' ? (
              <a
                href={e.onlineUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[14px] font-semibold text-[var(--color-accent)]"
              >
                Join online <Globe className="mb-0.5 inline h-3.5 w-3.5" aria-hidden />
              </a>
            ) : (
              <p className="text-[13px] text-[var(--color-ink-tertiary)]">Link visible after you RSVP</p>
            ))}
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Users className="mt-0.5 h-5 w-5 text-[var(--color-accent)]" aria-hidden />
          <div>
            <p className="text-[15px] font-semibold">
              {e.goingCount} going · {e.interestedCount} interested
            </p>
            <p className="text-[14px] text-[var(--color-ink-secondary)]">
              {formatSpotsLabel({
                capacity: e.capacity,
                spotsLeft: e.spotsLeft,
                waitlistCount: e.waitlistCount,
                isFull,
              })}
            </p>
          </div>
        </div>
        {e.recurrenceRule && (
          <div className="flex items-start gap-3">
            <Repeat className="mt-0.5 h-5 w-5 text-[var(--color-accent)]" aria-hidden />
            <div>
              <p className="text-[15px] font-semibold">Recurring event</p>
              {e.occurrences.length > 0 && (
                <p className="text-[14px] text-[var(--color-ink-secondary)]">
                  Next: {e.occurrences.slice(0, 2).map((o) => formatDate(o.startTime)).join(', ')}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* RSVP + calendar */}
      <div className="space-y-3">
        <RsvpButtons event={e} />
        <Button asChild variant="outline" className="w-full">
          <a href={`/api/v1/events/${e.id}/calendar.ics`} download>
            <CalendarPlus className="h-4 w-4" aria-hidden /> Add to calendar
          </a>
        </Button>
      </div>

      {/* Attendees */}
      {e.attendeePreview.length > 0 && (
        <section aria-labelledby="attendees-heading">
          <h2 id="attendees-heading" className="mb-3 text-[19px] font-bold tracking-tight">
            Who&apos;s going
          </h2>
          <div className="flex flex-wrap gap-3">
            {e.attendeePreview.map((attendee) => (
              <Link
                key={attendee.id}
                href={`/profile/${attendee.id}`}
                className="flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-hairline)] bg-[var(--color-surface)] py-1.5 pl-1.5 pr-4 transition-colors hover:border-[var(--color-accent)]"
              >
                <Avatar src={attendee.avatarUrl} name={attendee.name} size="sm" />
                <span className="text-[14px] font-semibold">{attendee.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Description */}
      <section aria-labelledby="details-heading">
        <h2 id="details-heading" className="mb-3 text-[19px] font-bold tracking-tight">
          Details
        </h2>
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--color-ink-secondary)]">
            {e.description}
          </p>
        </div>
      </section>
    </article>
  );
}
