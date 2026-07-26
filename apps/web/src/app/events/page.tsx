'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { api } from '@/lib/api';
import type { EventSummary, Paginated } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { EventCard, EventCardSkeleton } from '@/components/events/event-card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const MODES = [
  { value: '', label: 'All' },
  { value: 'IN_PERSON', label: 'In person' },
  { value: 'ONLINE', label: 'Online' },
  { value: 'HYBRID', label: 'Hybrid' },
];

export default function EventsPage() {
  const user = useAuthStore((s) => s.user);
  const [mode, setMode] = React.useState('');
  const [page, setPage] = React.useState(1);

  const browse = useQuery({
    queryKey: ['events', mode, page],
    queryFn: () =>
      api<Paginated<EventSummary>>(`/events?limit=12&page=${page}${mode ? `&mode=${mode}` : ''}`),
  });

  const mine = useQuery({
    queryKey: ['my-events'],
    queryFn: () => api<Array<EventSummary & { rsvpStatus: string }>>('/events/mine'),
    enabled: !!user,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">Events</h1>
        <p className="text-[15px] text-[var(--color-ink-secondary)]">
          Something for every calendar — online and around the corner.
        </p>
      </div>

      <Tabs defaultValue="browse">
        <TabsList>
          <TabsTrigger value="browse">Browse</TabsTrigger>
          {user && <TabsTrigger value="mine">My events</TabsTrigger>}
        </TabsList>

        <TabsContent value="browse" className="space-y-5">
          <div className="flex gap-2" role="group" aria-label="Filter by mode">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => {
                  setMode(m.value);
                  setPage(1);
                }}
                aria-pressed={mode === m.value}
                className={cn(
                  'rounded-[var(--radius-pill)] px-4 py-2 text-[13px] font-semibold transition-colors',
                  mode === m.value
                    ? 'bg-[var(--color-ink)] text-[var(--color-surface)]'
                    : 'border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-ink-secondary)]',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {browse.isPending ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <EventCardSkeleton key={i} />
              ))}
            </div>
          ) : browse.isError ? (
            <ErrorState onRetry={() => browse.refetch()} />
          ) : browse.data!.items.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No events match your filters"
              description="Try a different mode, or check back soon."
            />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {browse.data!.items.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>
              {browse.data!.totalPages > 1 && (
                <nav aria-label="Pagination" className="flex justify-center gap-2 pt-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <span className="flex items-center px-3 text-[14px] text-[var(--color-ink-secondary)]">
                    Page {page} of {browse.data!.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= browse.data!.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </nav>
              )}
            </>
          )}
        </TabsContent>

        {user && (
          <TabsContent value="mine">
            {mine.isPending ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <EventCardSkeleton key={i} />
                ))}
              </div>
            ) : (mine.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title="No upcoming plans"
                description="RSVP to events you like and they'll show up here."
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {mine.data!.map((event) => (
                  <EventCard key={event.id} event={{ ...event, rsvpStatus: event.rsvpStatus as never }} />
                ))}
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
