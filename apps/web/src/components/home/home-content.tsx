'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, Sparkles, Users } from 'lucide-react';
import { api } from '@/lib/api';
import type { EventSummary, Group, Paginated } from '@/lib/types';
import { useAuthStore } from '@/stores/auth-store';
import { BrandLogo } from '@/components/brand/brand-logo';
import { Button } from '@/components/ui/button';
import { EventCard, EventCardSkeleton } from '@/components/events/event-card';
import { CommunityCard, CommunityCardSkeleton } from '@/components/groups/community-card';
import { SearchBar } from '@/components/search/search-bar';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { CATEGORY_LABELS } from '@/lib/utils';

const FEATURED_CATEGORIES = ['TECHNOLOGY', 'OUTDOORS', 'SPORTS', 'PHOTOGRAPHY', 'MUSIC', 'BOOKS', 'FOOD', 'ARTS'];

export function HomeContent() {
  const user = useAuthStore((s) => s.user);

  const events = useQuery({
    queryKey: ['home-events'],
    queryFn: () => api<Paginated<EventSummary>>('/events?limit=8&sort=soonest'),
  });

  const groups = useQuery({
    queryKey: ['home-groups'],
    queryFn: () => api<Paginated<Group>>('/groups?limit=8&sort=popular'),
  });

  const recommendations = useQuery({
    queryKey: ['home-recs'],
    queryFn: () => api<Array<EventSummary & { score: number }>>('/recommendations/events?limit=4'),
    enabled: !!user,
  });

  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[var(--radius-xl)] bg-gradient-to-br from-[#0a84ff] via-[#3d6ef7] to-[#5e5ce6] px-6 py-14 text-white md:px-14 md:py-20">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
          className="relative z-10 max-w-2xl"
        >
          <BrandLogo
            size="xl"
            priority
            className="mb-5 h-16 w-16 rounded-2xl shadow-lg ring-1 ring-white/20 md:h-20 md:w-20"
          />
          <h1 className="text-[34px] font-extrabold leading-[1.1] tracking-tight md:text-[52px]">
            Find your people.
            <br />
            Do more of what you love.
          </h1>
          <p className="mt-4 max-w-lg text-[17px] leading-relaxed text-white/80 md:text-[19px]">
            Communities and events for every interest — from sunrise hikes to machine-learning paper
            nights. Real people, real plans, near you.
          </p>
          <div className="mt-8">
            <SearchBar className="max-w-lg" />
          </div>
          {!user && (
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild size="lg" variant="glass" className="text-white">
                <Link href="/signup">
                  Join MKE Plays free <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
            </div>
          )}
        </motion.div>
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 right-20 h-72 w-72 rounded-full bg-[#5e5ce6]/40 blur-3xl"
        />
      </section>

      {/* Category chips */}
      <section aria-label="Browse by category">
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {FEATURED_CATEGORIES.map((category) => (
            <Link
              key={category}
              href={`/groups?category=${category}`}
              className="shrink-0 rounded-[var(--radius-pill)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-4 py-2 text-[14px] font-semibold text-[var(--color-ink-secondary)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              {CATEGORY_LABELS[category]}
            </Link>
          ))}
        </div>
      </section>

      {/* Personalized recommendations */}
      {user && (recommendations.data?.length ?? 0) > 0 && (
        <section aria-labelledby="recs-heading">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="recs-heading" className="flex items-center gap-2 text-[22px] font-bold tracking-tight">
              <Sparkles className="h-5 w-5 text-[var(--color-accent)]" aria-hidden />
              Picked for you
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recommendations.data!.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}

      {/* Upcoming events */}
      <section aria-labelledby="events-heading">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="events-heading" className="text-[22px] font-bold tracking-tight">
            Happening soon
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/events">
              See all <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>
        {events.isPending ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <EventCardSkeleton key={i} />
            ))}
          </div>
        ) : events.isError ? (
          <ErrorState onRetry={() => events.refetch()} />
        ) : events.data!.items.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="No upcoming events yet"
            description="Be the first — create a community and host its first event."
            action={
              <Button asChild>
                <Link href="/groups/new">Create a community</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {events.data!.items.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </section>

      {/* Popular communities */}
      <section aria-labelledby="groups-heading">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="groups-heading" className="text-[22px] font-bold tracking-tight">
            Popular communities
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/groups">
              See all <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>
        {groups.isPending ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <CommunityCardSkeleton key={i} />
            ))}
          </div>
        ) : groups.isError ? (
          <ErrorState onRetry={() => groups.refetch()} />
        ) : groups.data!.items.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No communities yet"
            description="Start the first community on MKE Plays."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {groups.data!.items.map((group) => (
              <CommunityCard key={group.id} group={group} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
