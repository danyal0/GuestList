'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { BadgeCheck, Lock, MapPin, Users } from 'lucide-react';
import type { Group } from '@/lib/types';
import { cn, CATEGORY_LABELS } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

const CATEGORY_GRADIENTS: Record<string, string> = {
  TECHNOLOGY: 'from-sky-500 to-indigo-600',
  SPORTS: 'from-emerald-500 to-teal-600',
  OUTDOORS: 'from-green-500 to-lime-600',
  PHOTOGRAPHY: 'from-amber-500 to-orange-600',
  MUSIC: 'from-fuchsia-500 to-purple-600',
  BOOKS: 'from-rose-400 to-red-500',
  FOOD: 'from-orange-400 to-amber-600',
  ARTS: 'from-pink-500 to-rose-600',
  EDUCATION: 'from-violet-500 to-purple-700',
  BUSINESS: 'from-slate-500 to-gray-700',
};

export function CommunityCard({ group, className }: { group: Group; className?: string }) {
  const gradient = CATEGORY_GRADIENTS[group.category] ?? 'from-slate-500 to-slate-700';

  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      className={className}
    >
      <Link
        href={`/groups/${group.slug}`}
        aria-label={`${group.name}, ${group.memberCount} members`}
        className="group block overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-float)]"
      >
        <div className={cn('relative h-28 bg-gradient-to-br', gradient)}>
          {group.coverImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={group.coverImage} alt="" loading="lazy" className="h-full w-full object-cover" />
          )}
          <Badge variant="neutral" className="glass absolute left-3 top-3 border-0 text-white">
            {CATEGORY_LABELS[group.category] ?? group.category}
          </Badge>
        </div>
        <div className="p-4">
          <h3 className="flex items-center gap-1.5 text-[16px] font-bold leading-snug tracking-tight">
            <span className="truncate">{group.name}</span>
            {group.isVerified && (
              <BadgeCheck className="h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-label="Verified community" />
            )}
            {group.privacy !== 'PUBLIC' && (
              <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-tertiary)]" aria-label="Private community" />
            )}
          </h3>
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-[var(--color-ink-secondary)]">
            {group.description}
          </p>
          <div className="mt-3 flex items-center gap-3 text-[13px] font-medium text-[var(--color-ink-secondary)]">
            <span className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" aria-hidden />
              {group.memberCount.toLocaleString()}
            </span>
            {group.location && (
              <span className="flex min-w-0 items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{group.location}</span>
              </span>
            )}
            {group.distanceKm !== undefined && <span>{group.distanceKm} km</span>}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

export function CommunityCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
      <div className="skeleton h-28" />
      <div className="space-y-2.5 p-4">
        <div className="skeleton h-5 w-3/5 rounded" />
        <div className="skeleton h-3.5 w-full rounded" />
        <div className="skeleton h-3.5 w-2/5 rounded" />
      </div>
    </div>
  );
}
