'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  Bell,
  BellOff,
  CalendarDays,
  Lock,
  MapPin,
  MessageCircle,
  Plus,
  ScrollText,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import type { EventSummary, GroupDetail, Paginated, PublicUser } from '@/lib/types';
import { CATEGORY_LABELS, formatDate } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EventCard, EventCardSkeleton } from '@/components/events/event-card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

interface Member {
  id: string;
  role: 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER';
  joinedAt: string;
  user: PublicUser;
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MODERATOR: 'Moderator',
  MEMBER: 'Member',
};

export default function GroupDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const group = useQuery({
    queryKey: ['group', slug],
    queryFn: () => api<GroupDetail>(`/groups/${slug}`),
  });

  const events = useQuery({
    queryKey: ['group-events', group.data?.id],
    queryFn: () => api<Paginated<EventSummary>>(`/events?groupId=${group.data!.id}&limit=12`),
    enabled: !!group.data?.id,
  });

  const members = useQuery({
    queryKey: ['group-members', group.data?.id],
    queryFn: () => api<Paginated<Member>>(`/groups/${group.data!.id}/members?limit=50`),
    enabled: !!group.data?.id && !!user,
  });

  const follows = useQuery({
    queryKey: ['my-follows'],
    queryFn: () => api<Array<{ id: string }>>('/profiles/me/follows'),
    enabled: !!user,
  });
  const isFollowing = follows.data?.some((g) => g.id === group.data?.id) ?? false;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['group', slug] });
    void queryClient.invalidateQueries({ queryKey: ['my-follows'] });
  };

  const joinMutation = useMutation({
    mutationFn: () => api<{ status: string }>(`/groups/${group.data!.id}/join`, { method: 'POST', body: '{}' }),
    onSuccess: (data) => {
      toast.success(
        data.status === 'PENDING'
          ? 'Request sent — an admin will review it shortly.'
          : `Welcome to ${group.data!.name}!`,
      );
      invalidate();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not join'),
  });

  const leaveMutation = useMutation({
    mutationFn: () => api(`/groups/${group.data!.id}/leave`, { method: 'POST', body: '{}' }),
    onSuccess: () => {
      toast.success('You left the community.');
      invalidate();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not leave'),
  });

  const followMutation = useMutation({
    mutationFn: () =>
      isFollowing
        ? api(`/profiles/follows/${group.data!.id}`, { method: 'DELETE' })
        : api(`/profiles/follows/${group.data!.id}`, { method: 'POST', body: '{}' }),
    onSuccess: invalidate,
  });

  const deleteCommunity = useMutation({
    mutationFn: () => api(`/groups/${group.data!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(`${group.data!.name} was deleted.`);
      setDeleteOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['home-groups'] });
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
      router.push('/groups');
      router.refresh();
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not delete the community'),
  });

  const openChat = async () => {
    try {
      const conversation = await api<{ id: string }>(
        `/messaging/conversations/group/${group.data!.id}`,
        { method: 'POST', body: '{}' },
      );
      router.push(`/messages/${conversation.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open chat');
    }
  };

  if (group.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-56 w-full rounded-[var(--radius-xl)]" />
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }
  if (group.isError || !group.data) {
    return <ErrorState title="Community not found" message="It may be private or no longer exist." />;
  }

  const g = group.data;
  const membership = g.viewerMembership;
  const canManage = membership && ['OWNER', 'ADMIN'].includes(membership.role);
  const canHost = membership && ['OWNER', 'ADMIN', 'MODERATOR'].includes(membership.role);
  const isOwner = membership?.role === 'OWNER';

  return (
    <div className="space-y-6">
      {/* Cover */}
      <div className="relative h-48 overflow-hidden rounded-[var(--radius-xl)] bg-gradient-to-br from-[var(--color-accent)] to-[#5e5ce6] md:h-64">
        {g.coverImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={g.coverImage} alt="" className="h-full w-full object-cover" />
        )}
        <Badge variant="neutral" className="glass absolute left-4 top-4 border-0 text-white">
          {CATEGORY_LABELS[g.category] ?? g.category}
        </Badge>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-[28px] font-extrabold tracking-tight">
            <span className="truncate">{g.name}</span>
            {g.isVerified && (
              <BadgeCheck className="h-6 w-6 shrink-0 text-[var(--color-accent)]" aria-label="Verified community" />
            )}
            {g.privacy !== 'PUBLIC' && (
              <Lock className="h-5 w-5 shrink-0 text-[var(--color-ink-tertiary)]" aria-label="Private" />
            )}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-[var(--color-ink-secondary)]">
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4" aria-hidden /> {(g.memberCount ?? 0).toLocaleString()} members
            </span>
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" aria-hidden /> {g.upcomingEvents ?? 0} upcoming
            </span>
            {g.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4" aria-hidden /> {g.location}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {user && (
            <Button
              variant="outline"
              size="md"
              aria-pressed={isFollowing}
              onClick={() => followMutation.mutate()}
              loading={followMutation.isPending}
            >
              {isFollowing ? <BellOff className="h-4 w-4" aria-hidden /> : <Bell className="h-4 w-4" aria-hidden />}
              {isFollowing ? 'Following' : 'Follow'}
            </Button>
          )}
          {membership ? (
            <>
              <Button variant="secondary" onClick={openChat}>
                <MessageCircle className="h-4 w-4" aria-hidden /> Chat
              </Button>
              {canHost && (
                <Button asChild>
                  <Link href={`/events/new?groupId=${g.id}`}>
                    <Plus className="h-4 w-4" aria-hidden /> Host event
                  </Link>
                </Button>
              )}
              {membership.role !== 'OWNER' && (
                <Button
                  variant="outline"
                  onClick={() => leaveMutation.mutate()}
                  loading={leaveMutation.isPending}
                >
                  Leave
                </Button>
              )}
            </>
          ) : g.viewerPending ? (
            <Button disabled variant="secondary">
              Request pending
            </Button>
          ) : (
            <Button
              onClick={() => (user ? joinMutation.mutate() : router.push(`/login?next=/groups/${slug}`))}
              loading={joinMutation.isPending}
            >
              {g.privacy === 'PUBLIC' ? 'Join community' : 'Request to join'}
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="about">
        <TabsList>
          <TabsTrigger value="about">About</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          {user && membership && <TabsTrigger value="members">Members</TabsTrigger>}
        </TabsList>

        <TabsContent value="about" className="space-y-6">
          <section className="rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6">
            <h2 className="text-[17px] font-bold">About this community</h2>
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--color-ink-secondary)]">
              {g.description}
            </p>
          </section>
          {g.rules && (
            <section className="rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6">
              <h2 className="flex items-center gap-2 text-[17px] font-bold">
                <ScrollText className="h-4.5 w-4.5" aria-hidden /> Community rules
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--color-ink-secondary)]">
                {g.rules}
              </p>
            </section>
          )}
        </TabsContent>

        <TabsContent value="events">
          {events.isPending ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <EventCardSkeleton key={i} />
              ))}
            </div>
          ) : (events.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No upcoming events"
              description={canHost ? 'Host the first one!' : 'Check back soon.'}
              action={
                canHost ? (
                  <Button asChild>
                    <Link href={`/events/new?groupId=${g.id}`}>Host an event</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {events.data!.items.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </TabsContent>

        {user && membership && (
          <TabsContent value="members">
            {members.isPending ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : (
              <ul className="divide-y divide-[var(--color-hairline)] rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
                {members.data?.items.map((member) => (
                  <li key={member.id} className="flex items-center gap-3 p-4">
                    <Link href={`/profile/${member.user.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar src={member.user.avatarUrl} name={member.user.name} />
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-semibold">{member.user.name}</span>
                        <span className="block text-[13px] text-[var(--color-ink-tertiary)]">
                          Joined {formatDate(member.joinedAt, { weekday: undefined, year: 'numeric' })}
                        </span>
                      </span>
                    </Link>
                    <Badge variant={member.role === 'OWNER' ? 'default' : 'neutral'}>
                      {ROLE_LABEL[member.role]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            {canManage && !isOwner && (
              <p className="mt-3 text-[13px] text-[var(--color-ink-tertiary)]">
                Manage roles, approvals and bans from the API or the admin dashboard.
              </p>
            )}
            {isOwner && (
              <p className="mt-3 text-[13px] text-[var(--color-ink-tertiary)]">
                As owner you can delete this community from the section below.
              </p>
            )}
          </TabsContent>
        )}
      </Tabs>

      {isOwner ? (
        <section className="rounded-[var(--radius-lg)] border border-[var(--color-danger)]/30 p-5">
          <h2 className="text-[17px] font-bold text-[var(--color-danger)]">Owner controls</h2>
          <p className="mt-1 text-[14px] text-[var(--color-ink-secondary)]">
            Deleting this community removes it from discovery. This cannot be undone from the app.
          </p>
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" className="mt-4">
                <Trash2 className="h-4 w-4" aria-hidden /> Delete community
              </Button>
            </DialogTrigger>
            <DialogContent
              title={`Delete ${g.name}?`}
              description="Members lose access and the community disappears from search. Prefer leaving it up if you might come back."
            >
              <div className="flex gap-3">
                <Button
                  variant="destructive"
                  className="flex-1"
                  loading={deleteCommunity.isPending}
                  onClick={() => deleteCommunity.mutate()}
                >
                  Yes, delete it
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setDeleteOpen(false)}
                  disabled={deleteCommunity.isPending}
                >
                  Keep community
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </section>
      ) : null}
    </div>
  );
}
