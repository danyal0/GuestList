'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search as SearchIcon } from 'lucide-react';
import { api } from '@/lib/api';
import type { SearchResults } from '@/lib/types';
import { formatDateTime } from '@/lib/utils';
import { SearchBar } from '@/components/search/search-bar';
import { CommunityCard } from '@/components/groups/community-card';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function SearchContent() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q') ?? '';

  const results = useQuery({
    queryKey: ['search', query],
    queryFn: () => api<SearchResults>(`/search?q=${encodeURIComponent(query)}`),
    enabled: query.length > 0,
  });

  const totalHits = results.data
    ? results.data.groups.length + results.data.events.length + results.data.users.length
    : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <SearchBar initialQuery={query} autoFocus={!query} />

      {!query ? (
        <EmptyState
          icon={SearchIcon}
          title="Search Gatherly"
          description="Communities, events and people — all in one place."
        />
      ) : results.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : results.isError ? (
        <ErrorState onRetry={() => results.refetch()} />
      ) : totalHits === 0 ? (
        <EmptyState
          icon={SearchIcon}
          title={`No results for “${query}”`}
          description="Try different keywords, or browse categories instead."
        />
      ) : (
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All ({totalHits})</TabsTrigger>
            <TabsTrigger value="groups">Communities ({results.data!.groups.length})</TabsTrigger>
            <TabsTrigger value="events">Events ({results.data!.events.length})</TabsTrigger>
            <TabsTrigger value="people">People ({results.data!.users.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="space-y-8">
            {results.data!.groups.length > 0 && (
              <section>
                <h2 className="mb-3 text-[19px] font-bold">Communities</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {results.data!.groups.slice(0, 3).map((group) => (
                    <CommunityCard key={group.id} group={group} />
                  ))}
                </div>
              </section>
            )}
            {results.data!.events.length > 0 && (
              <section>
                <h2 className="mb-3 text-[19px] font-bold">Events</h2>
                <EventHits events={results.data!.events} />
              </section>
            )}
            {results.data!.users.length > 0 && (
              <section>
                <h2 className="mb-3 text-[19px] font-bold">People</h2>
                <PeopleHits users={results.data!.users} />
              </section>
            )}
          </TabsContent>

          <TabsContent value="groups">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.data!.groups.map((group) => (
                <CommunityCard key={group.id} group={group} />
              ))}
            </div>
          </TabsContent>
          <TabsContent value="events">
            <EventHits events={results.data!.events} />
          </TabsContent>
          <TabsContent value="people">
            <PeopleHits users={results.data!.users} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function EventHits({ events }: { events: SearchResults['events'] }) {
  return (
    <ul className="divide-y divide-[var(--color-hairline)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
      {events.map((event) => (
        <li key={event.id}>
          <Link href={`/events/${event.id}`} className="block p-4 transition-colors hover:bg-[var(--color-surface-2)]">
            <p className="text-[12px] font-semibold text-[var(--color-accent)]">{event.groupName}</p>
            <p className="text-[15px] font-bold">{event.title}</p>
            <p className="text-[13px] text-[var(--color-ink-secondary)]">
              {formatDateTime(event.startTime)}
              {event.locationName && ` · ${event.locationName}`} · {event.goingCount} going
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PeopleHits({ users }: { users: SearchResults['users'] }) {
  return (
    <ul className="divide-y divide-[var(--color-hairline)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
      {users.map((person) => (
        <li key={person.id}>
          <Link
            href={`/profile/${person.id}`}
            className="flex items-center gap-3 p-4 transition-colors hover:bg-[var(--color-surface-2)]"
          >
            <Avatar src={person.avatarUrl} name={person.name} />
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">{person.name}</p>
              {person.location && (
                <p className="text-[13px] text-[var(--color-ink-tertiary)]">{person.location}</p>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function SearchPage() {
  return (
    <React.Suspense>
      <SearchContent />
    </React.Suspense>
  );
}
