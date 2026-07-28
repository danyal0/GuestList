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

const FILTERS = [
  { value: '', label: 'Upcoming', mode: '', status: '' },
  { value: 'IN_PERSON', label: 'In person', mode: 'IN_PERSON', status: '' },
  { value: 'ONLINE', label: 'Online', mode: 'ONLINE', status: '' },
  { value: 'HYBRID', label: 'Hybrid', mode: 'HYBRID', status: '' },
  { value: 'CANCELLED', label: 'Cancelled', mode: '', status: 'CANCELLED' },
];

export default function EventsPage() {
  const user = useAuthStore((s) => s.user);
  const [filter, setFilter] = React.useState('');
  const [page, setPage] = React.useState(1);
  const active = FILTERS.find((f) => f.value === filter) ?? FILTERS[0]!;

  const browse = useQuery({
    queryKey: ['events', filter, page],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '12', page: String(page) });
      if (active.mode) params.set('mode', active.mode);
      if (active.status) params.set('status', active.status);
      return api<Paginated<EventSummary>>(`/events?${params.toString()}`);
    },
  });

  const mine = useQuery({
    queryKey: ['my-events'],
    queryFn: () => api<Array<EventSummary & { rsvpStatus: string }>>('/events/mine'),
    enabled: !!user,
  });

  const mineUpcoming = (mine.data ?? []).filter((e) => e.status !== 'CANCELLED');
  const mineCancelled = (mine.data ?? []).filter((e) => e.status === 'CANCELLED');

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
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter events">
            {FILTERS.map((m) => (
              <button
                key={m.value}
                onClick={() => {
                  setFilter(m.value);
                  setPage(1);
                }}
                aria-pressed={filter === m.value}
                className={cn(
                  'rounded-[var(--radius-pill)] px-4 py-2 text-[13px] font-semibold transition-colors',
                  filter === m.value
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
              title={
                active.status === 'CANCELLED'
                  ? 'No cancelled events'
                  : 'No events match your filters'
              }
              description={
                active.status === 'CANCELLED'
                  ? 'Cancelled plans from the last 60 days will show up here.'
                  : 'Try a different mode, or check back soon.'
              }
            />
          ) : (
            <>
              {active.status === 'CANCELLED' ? (
                <p className="text-[14px] text-[var(--color-ink-secondary)]">
                  Cancelled events stay listed here so you can still open details and see what
                  changed.
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {browse.data!.items.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>
              {browse.data!.totalPages > 1 && (
                <nav aria-label="Pagination" className="flex justify-center gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
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
          <TabsContent value="mine" className="space-y-8">
            {mine.isPending ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <EventCardSkeleton key={i} />
                ))}
              </div>
            ) : mineUpcoming.length === 0 && mineCancelled.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title="No upcoming plans"
                description="RSVP to events you like and they'll show up here."
              />
            ) : (
              <>
                <section className="space-y-4">
                  <h2 className="text-[17px] font-bold tracking-tight">Upcoming</h2>
                  {mineUpcoming.length === 0 ? (
                    <p className="text-[14px] text-[var(--color-ink-secondary)]">
                      No upcoming RSVPs right now.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {mineUpcoming.map((event) => (
                        <EventCard
                          key={event.id}
                          event={{ ...event, rsvpStatus: event.rsvpStatus as never }}
                        />
                      ))}
                    </div>
                  )}
                </section>
                {mineCancelled.length > 0 ? (
                  <section className="space-y-4">
                    <h2 className="text-[17px] font-bold tracking-tight">Cancelled</h2>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {mineCancelled.map((event) => (
                        <EventCard
                          key={event.id}
                          event={{ ...event, rsvpStatus: event.rsvpStatus as never }}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}
              </>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
