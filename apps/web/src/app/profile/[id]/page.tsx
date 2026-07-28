'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, MapPin, MessageCircle, Settings, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { ProfileView } from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

export default function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isMe = user?.id === id;

  const profile = useQuery({
    queryKey: ['profile', id],
    queryFn: () => api<ProfileView>(`/profiles/${id}`),
  });

  const friendRequest = useMutation({
    mutationFn: () =>
      api('/profiles/friend-requests', { method: 'POST', body: JSON.stringify({ userId: id }) }),
    onSuccess: () => {
      toast.success('Friend request sent!');
      void queryClient.invalidateQueries({ queryKey: ['profile', id] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not send request'),
  });

  const respondFriend = useMutation({
    mutationFn: (accept: boolean) =>
      api(`/profiles/friend-requests/${id}/${accept ? 'accept' : 'decline'}`, {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: (_data, accept) => {
      toast.success(accept ? 'Friend request accepted' : 'Friend request declined');
      void queryClient.invalidateQueries({ queryKey: ['profile', id] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Could not update friend request'),
  });

  const openChat = async () => {
    try {
      const conversation = await api<{ id: string }>('/messaging/conversations/direct', {
        method: 'POST',
        body: JSON.stringify({ userId: id }),
      });
      router.push(`/messages/${conversation.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open the conversation');
    }
  };

  if (profile.isPending) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-5">
          <Skeleton className="h-24 w-24 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (profile.isError || !profile.data) {
    return <ErrorState title="Profile not found" />;
  }

  const { user: profileUser, stats, friendshipStatus } = profile.data;
  const interests = Array.isArray(profileUser.interests) ? profileUser.interests : [];
  const skills = Array.isArray(profileUser.skills) ? profileUser.skills : [];
  const joinedLabel = formatDate(profileUser.createdAt, {
    weekday: undefined,
    year: 'numeric',
    day: undefined,
  });

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Header — Apple Contacts feel */}
      <div className="flex flex-col items-center text-center">
        <Avatar src={profileUser.avatarUrl} name={profileUser.name || 'Member'} size="xl" />
        <h1 className="mt-4 text-[28px] font-extrabold tracking-tight">
          {profileUser.name || 'Member'}
        </h1>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[14px] text-[var(--color-ink-secondary)]">
          {profileUser.location && (
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" aria-hidden /> {profileUser.location}
            </span>
          )}
          {joinedLabel ? (
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" aria-hidden /> Joined {joinedLabel}
            </span>
          ) : null}
        </div>
        {profileUser.bio && (
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-[var(--color-ink-secondary)]">
            {profileUser.bio}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          {isMe ? (
            <Button asChild variant="secondary">
              <Link href="/settings">
                <Settings className="h-4 w-4" aria-hidden /> Edit profile
              </Link>
            </Button>
          ) : user ? (
            <>
              <Button onClick={openChat} variant="secondary">
                <MessageCircle className="h-4 w-4" aria-hidden /> Message
              </Button>
              {friendshipStatus === 'none' && (
                <Button onClick={() => friendRequest.mutate()} loading={friendRequest.isPending}>
                  <UserPlus className="h-4 w-4" aria-hidden /> Add friend
                </Button>
              )}
              {friendshipStatus === 'pending_sent' && (
                <Button disabled variant="outline">
                  Request sent
                </Button>
              )}
              {friendshipStatus === 'pending_received' && (
                <>
                  <Button
                    onClick={() => respondFriend.mutate(true)}
                    loading={respondFriend.isPending && respondFriend.variables === true}
                    disabled={respondFriend.isPending}
                  >
                    Accept request
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => respondFriend.mutate(false)}
                    loading={respondFriend.isPending && respondFriend.variables === false}
                    disabled={respondFriend.isPending}
                  >
                    Decline
                  </Button>
                </>
              )}
              {friendshipStatus === 'friends' && <Badge variant="success">Friends</Badge>}
            </>
          ) : null}
        </div>
      </div>

      {/* Stats */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Communities', value: stats.groupsJoined, icon: Users },
          { label: 'Events attended', value: stats.eventsAttended, icon: CalendarDays },
          { label: 'Events hosted', value: stats.eventsHosted, icon: CalendarDays },
          { label: 'Friends', value: stats.friends, icon: UserPlus },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 text-center"
          >
            <dd className="text-[24px] font-extrabold tracking-tight">{value}</dd>
            <dt className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink-tertiary)]">
              {label}
            </dt>
          </div>
        ))}
      </dl>

      {/* Interests + skills */}
      {(interests.length > 0 || skills.length > 0) && (
        <div className="space-y-5">
          {interests.length > 0 && (
            <section>
              <h2 className="mb-2 text-[15px] font-bold uppercase tracking-wide text-[var(--color-ink-tertiary)]">
                Interests
              </h2>
              <div className="flex flex-wrap gap-2">
                {interests.map((interest) => (
                  <Badge key={interest}>{interest}</Badge>
                ))}
              </div>
            </section>
          )}
          {skills.length > 0 && (
            <section>
              <h2 className="mb-2 text-[15px] font-bold uppercase tracking-wide text-[var(--color-ink-tertiary)]">
                Skills
              </h2>
              <div className="flex flex-wrap gap-2">
                {skills.map((skill) => (
                  <Badge key={skill} variant="neutral">
                    {skill}
                  </Badge>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
