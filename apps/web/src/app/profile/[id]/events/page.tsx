'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import { api } from '@/lib/api';
import type { EventSummary, ProfileView } from '@/lib/types';
import { cn } from '@/lib/utils';
import { EventCard, EventCardSkeleton } from '@/components/events/event-card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

function ProfileEventsContent() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const kind = searchParams.get('kind') === 'hosted' ? 'hosted' : 'attended';

  const profile = useQuery({
    queryKey: ['profile', id],
    queryFn: () => api<ProfileView>(`/profiles/${id}`),
  });

  const events = useQuery({
    queryKey: ['profile-events', id, kind],
    queryFn: () => api<EventSummary[]>(`/profiles/${id}/events?kind=${kind}`),
  });

  const name = profile.data?.user.name || 'Member';
  const title = kind === 'hosted' ? `${name}'s hosted events` : `${name}'s events attended`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={`/profile/${id}`}
          className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[var(--color-accent)]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to profile
        </Link>
        <h1 className="mt-2 text-[28px] font-extrabold tracking-tight">
          {profile.isPending ? <Skeleton className="inline-block h-8 w-56" /> : title}
        </h1>
        <div className="mt-4 flex gap-2">
          <Link
            href={`/profile/${id}/events?kind=attended`}
            className={cn(
              'rounded-[var(--radius-pill)] px-4 py-2 text-[14px] font-semibold',
              kind === 'attended'
                ? 'bg-[var(--color-ink)] text-[var(--color-surface)]'
                : 'border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-ink-secondary)]',
            )}
          >
            Attended
          </Link>
          <Link
            href={`/profile/${id}/events?kind=hosted`}
            className={cn(
              'rounded-[var(--radius-pill)] px-4 py-2 text-[14px] font-semibold',
              kind === 'hosted'
                ? 'bg-[var(--color-ink)] text-[var(--color-surface)]'
                : 'border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-ink-secondary)]',
            )}
          >
            Hosted
          </Link>
        </div>
      </div>

      {events.isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <EventCardSkeleton key={i} />
          ))}
        </div>
      ) : events.isError ? (
        <ErrorState onRetry={() => events.refetch()} />
      ) : events.data!.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={kind === 'hosted' ? 'No hosted events' : 'No attended events'}
          description={
            kind === 'hosted'
              ? 'Events this person has hosted will show up here.'
              : 'Past events they went to will show up here.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {events.data!.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProfileEventsPage() {
  return (
    <React.Suspense>
      <ProfileEventsContent />
    </React.Suspense>
  );
}
