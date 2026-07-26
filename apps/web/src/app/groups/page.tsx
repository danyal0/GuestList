'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import type { Group, Paginated } from '@/lib/types';
import { CATEGORY_LABELS, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CommunityCard, CommunityCardSkeleton } from '@/components/groups/community-card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';

const SORTS = [
  { value: 'popular', label: 'Popular' },
  { value: 'newest', label: 'Newest' },
] as const;

function GroupsBrowser() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const category = searchParams.get('category') ?? '';
  const sort = searchParams.get('sort') ?? 'popular';
  const [page, setPage] = React.useState(1);

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    setPage(1);
    router.replace(`/groups?${params.toString()}`);
  };

  const query = useQuery({
    queryKey: ['groups', category, sort, page],
    queryFn: () =>
      api<Paginated<Group>>(
        `/groups?limit=12&page=${page}&sort=${sort}${category ? `&category=${category}` : ''}`,
      ),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-tight">Communities</h1>
          <p className="text-[15px] text-[var(--color-ink-secondary)]">
            {query.data ? `${query.data.total} communities to explore` : 'Find where you belong'}
          </p>
        </div>
        <Button asChild>
          <Link href="/groups/new">
            <Plus className="h-4 w-4" aria-hidden /> Create community
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          <button
            onClick={() => setParam('category', '')}
            aria-pressed={!category}
            className={cn(
              'shrink-0 rounded-[var(--radius-pill)] px-4 py-2 text-[13px] font-semibold transition-colors',
              !category
                ? 'bg-[var(--color-ink)] text-[var(--color-surface)]'
                : 'border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-ink-secondary)]',
            )}
          >
            All
          </button>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setParam('category', value === category ? '' : value)}
              aria-pressed={category === value}
              className={cn(
                'shrink-0 rounded-[var(--radius-pill)] px-4 py-2 text-[13px] font-semibold transition-colors',
                category === value
                  ? 'bg-[var(--color-ink)] text-[var(--color-surface)]'
                  : 'border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-ink-secondary)]',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface-3)] p-1">
          {SORTS.map((s) => (
            <button
              key={s.value}
              onClick={() => setParam('sort', s.value)}
              aria-pressed={sort === s.value}
              className={cn(
                'rounded-[10px] px-3 py-1.5 text-[13px] font-semibold transition-all',
                sort === s.value
                  ? 'bg-[var(--color-surface)] shadow-sm'
                  : 'text-[var(--color-ink-secondary)]',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {query.isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CommunityCardSkeleton key={i} />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : query.data!.items.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No communities in this category yet"
          description="Be the pioneer — start the first one and invite your people."
          action={
            <Button asChild>
              <Link href="/groups/new">Create community</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {query.data!.items.map((group) => (
              <CommunityCard key={group.id} group={group} />
            ))}
          </div>
          {query.data!.totalPages > 1 && (
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
                Page {page} of {query.data!.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= query.data!.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

export default function GroupsPage() {
  return (
    <React.Suspense>
      <GroupsBrowser />
    </React.Suspense>
  );
}
