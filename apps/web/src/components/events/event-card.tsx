'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { CalendarDays, MapPin, Users, Video } from 'lucide-react';
import type { EventSummary } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { cn, formatDate, formatTime } from '@/lib/utils';

const CATEGORY_GRADIENTS: Record<string, string> = {
  TECHNOLOGY: 'from-sky-500 to-indigo-600',
  SPORTS: 'from-emerald-500 to-teal-600',
  OUTDOORS: 'from-green-500 to-lime-600',
  PHOTOGRAPHY: 'from-amber-500 to-orange-600',
  MUSIC: 'from-fuchsia-500 to-purple-600',
  BOOKS: 'from-rose-400 to-red-500',
  FOOD: 'from-orange-400 to-amber-600',
  ARTS: 'from-pink-500 to-rose-600',
};

export function EventCard({ event, className }: { event: EventSummary; className?: string }) {
  const gradient = CATEGORY_GRADIENTS[event.group.category] ?? 'from-slate-500 to-slate-700';
  const isFull = event.spotsLeft === 0;
  const cancelled = event.status === 'CANCELLED';

  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      className={className}
    >
      <Link
        href={`/events/${event.id}`}
        aria-label={`${event.title}, ${formatDate(event.startTime)}`}
        className="group block overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-float)]"
      >
        <div className={cn('relative h-36 bg-gradient-to-br', gradient)}>
          {event.coverImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={event.coverImage}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <CalendarDays className="h-10 w-10 text-white/60" aria-hidden />
            </div>
          )}
          <div className="glass absolute left-3 top-3 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-center leading-none">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-danger)]">
              {new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(event.startTime))}
            </div>
            <div className="mt-0.5 text-[17px] font-extrabold">
              {new Date(event.startTime).getDate()}
            </div>
          </div>
          {cancelled && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <Badge variant="danger" className="text-[13px]">Cancelled</Badge>
            </div>
          )}
        </div>
        <div className="p-4">
          <p className="text-[12px] font-semibold text-[var(--color-accent)]">
            {event.group.name}
          </p>
          <h3 className="mt-0.5 line-clamp-2 text-[16px] font-bold leading-snug tracking-tight">
            {event.title}
          </h3>
          <div className="mt-2.5 space-y-1.5 text-[13px] text-[var(--color-ink-secondary)]">
            <p className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {formatDate(event.startTime)} · {formatTime(event.startTime)}
            </p>
            <p className="flex items-center gap-1.5">
              {event.mode === 'ONLINE' ? (
                <>
                  <Video className="h-3.5 w-3.5 shrink-0" aria-hidden /> Online event
                </>
              ) : (
                <>
                  <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">
                    {event.locationName ?? 'Location TBD'}
                    {event.mode === 'HYBRID' && ' · also online'}
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-ink-secondary)]">
              <Users className="h-3.5 w-3.5" aria-hidden />
              {event.goingCount} going
              {event.distanceKm !== undefined && ` · ${event.distanceKm} km away`}
            </p>
            {isFull ? (
              <Badge variant="warning">Waitlist</Badge>
            ) : event.rsvpStatus === 'GOING' ? (
              <Badge variant="success">Going</Badge>
            ) : event.rsvpStatus === 'WAITLISTED' ? (
              <Badge variant="warning">Waitlisted</Badge>
            ) : null}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

export function EventCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
      <div className="skeleton h-36" />
      <div className="space-y-2.5 p-4">
        <div className="skeleton h-3 w-24 rounded" />
        <div className="skeleton h-5 w-4/5 rounded" />
        <div className="skeleton h-3.5 w-3/5 rounded" />
        <div className="skeleton h-3.5 w-2/5 rounded" />
      </div>
    </div>
  );
}
