'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, UserMinus, UserX, Users } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import type { ProfileView, PublicUser } from '@/lib/types';
import { useAuthStore } from '@/stores/auth-store';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

export default function ProfileFriendsPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isMe = user?.id === id;
  const [confirm, setConfirm] = React.useState<{
    userId: string;
    name: string;
    action: 'unfriend' | 'block';
  } | null>(null);

  const profile = useQuery({
    queryKey: ['profile', id],
    queryFn: () => api<ProfileView>(`/profiles/${id}`),
  });

  const friends = useQuery({
    queryKey: ['profile-friends', id],
    queryFn: () => api<PublicUser[]>(`/profiles/${id}/friends`),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['profile-friends', id] });
    void queryClient.invalidateQueries({ queryKey: ['profile', id] });
    void queryClient.invalidateQueries({ queryKey: ['me-blocks'] });
  };

  const unfriend = useMutation({
    mutationFn: (friendId: string) => api(`/profiles/friends/${friendId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Removed from friends');
      setConfirm(null);
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not unfriend'),
  });

  const block = useMutation({
    mutationFn: (friendId: string) =>
      api(`/profiles/blocks/${friendId}`, { method: 'POST', body: '{}' }),
    onSuccess: () => {
      toast.success('User blocked');
      setConfirm(null);
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not block user'),
  });

  const name = profile.data?.user.name || 'Member';
  const busy = unfriend.isPending || block.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href={`/profile/${id}`}
          className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[var(--color-accent)]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to profile
        </Link>
        <h1 className="mt-2 text-[28px] font-extrabold tracking-tight">
          {profile.isPending ? (
            <Skeleton className="inline-block h-8 w-40" />
          ) : isMe ? (
            'Your friends'
          ) : (
            `${name}'s friends`
          )}
        </h1>
        {isMe ? (
          <p className="mt-1 text-[14px] text-[var(--color-ink-secondary)]">
            Unfriend or block anyone from this list.
          </p>
        ) : null}
      </div>

      {friends.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : friends.isError ? (
        <ErrorState onRetry={() => friends.refetch()} />
      ) : friends.data!.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No friends yet"
          description={
            isMe
              ? 'When you accept friend requests, people show up here.'
              : 'This person has not added friends yet.'
          }
        />
      ) : (
        <ul className="divide-y divide-[var(--color-hairline)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
          {friends.data!.map((friend) => (
            <li key={friend.id} className="flex flex-wrap items-center gap-3 p-4">
              <Link
                href={`/profile/${friend.id}`}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <Avatar src={friend.avatarUrl} name={friend.name || 'Member'} />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold">
                    {friend.name || 'Member'}
                  </span>
                  {friend.location ? (
                    <span className="block truncate text-[13px] text-[var(--color-ink-tertiary)]">
                      {friend.location}
                    </span>
                  ) : null}
                </span>
              </Link>

              {isMe ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      setConfirm({
                        userId: friend.id,
                        name: friend.name || 'Member',
                        action: 'unfriend',
                      })
                    }
                  >
                    <UserMinus className="h-4 w-4" aria-hidden /> Unfriend
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      setConfirm({
                        userId: friend.id,
                        name: friend.name || 'Member',
                        action: 'block',
                      })
                    }
                  >
                    <UserX className="h-4 w-4" aria-hidden /> Block
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={confirm != null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        {confirm ? (
          <DialogContent
            title={
              confirm.action === 'block'
                ? `Block ${confirm.name}?`
                : `Unfriend ${confirm.name}?`
            }
            description={
              confirm.action === 'block'
                ? 'They won’t be able to send you friend requests. Existing friendship is removed.'
                : 'You’ll no longer be friends. You can send a new request later.'
            }
          >
            <div className="flex gap-3">
              <Button
                variant={confirm.action === 'block' ? 'destructive' : 'primary'}
                className="flex-1"
                loading={busy}
                onClick={() =>
                  confirm.action === 'block'
                    ? block.mutate(confirm.userId)
                    : unfriend.mutate(confirm.userId)
                }
              >
                {confirm.action === 'block' ? 'Yes, block' : 'Yes, unfriend'}
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                Cancel
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
