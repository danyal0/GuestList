'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Users } from 'lucide-react';
import { api } from '@/lib/api';
import type { Group, ProfileView } from '@/lib/types';
import { CommunityCard, CommunityCardSkeleton } from '@/components/groups/community-card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

export default function ProfileCommunitiesPage() {
  const { id } = useParams<{ id: string }>();

  const profile = useQuery({
    queryKey: ['profile', id],
    queryFn: () => api<ProfileView>(`/profiles/${id}`),
  });

  const communities = useQuery({
    queryKey: ['profile-communities', id],
    queryFn: () => api<Array<Group & { memberRole?: string }>>(`/profiles/${id}/communities`),
  });

  const name = profile.data?.user.name || 'Member';

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
          {profile.isPending ? <Skeleton className="inline-block h-8 w-48" /> : `${name}'s communities`}
        </h1>
      </div>

      {communities.isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <CommunityCardSkeleton key={i} />
          ))}
        </div>
      ) : communities.isError ? (
        <ErrorState onRetry={() => communities.refetch()} />
      ) : communities.data!.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No communities yet"
          description="Communities this person has joined will show up here."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {communities.data!.map((group) => (
            <CommunityCard key={group.id} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}
