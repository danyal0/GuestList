'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import type { Notification, Paginated } from '@/lib/types';
import { cn, formatRelative } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { describeNotification } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

function notificationLink(notification: Notification): string | null {
  const p = notification.payload;
  if (notification.type === 'REPORT_CREATED' || notification.type === 'SYSTEM_ERROR') {
    return '/admin';
  }
  if (typeof p.href === 'string' && p.href.startsWith('/')) return p.href;
  if (typeof p.eventId === 'string') return `/events/${p.eventId}`;
  if (typeof p.conversationId === 'string') return `/messages/${p.conversationId}`;
  if (typeof p.groupId === 'string') return `/groups/${p.groupId}`;
  if (typeof p.fromUserId === 'string') return `/profile/${p.fromUserId}`;
  return null;
}

function friendRequestTargetId(payload: Record<string, unknown>): string | null {
  if (typeof payload.friendshipId === 'string' && payload.friendshipId) return payload.friendshipId;
  if (typeof payload.fromUserId === 'string' && payload.fromUserId) return payload.fromUserId;
  return null;
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const { user, hydrated } = useAuthStore();
  const [responded, setResponded] = React.useState<Record<string, 'accepted' | 'declined'>>({});

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<Paginated<Notification>>('/notifications?limit=50'),
    enabled: !!user,
  });

  const pendingFriendRequests = useQuery({
    queryKey: ['friend-requests-pending'],
    queryFn: () =>
      api<Array<{ id: string; requesterId: string }>>('/profiles/me/friend-requests'),
    enabled: !!user,
  });

  const isPendingFriendRequest = (payload: Record<string, unknown>) => {
    const items = pendingFriendRequests.data ?? [];
    const friendshipId = typeof payload.friendshipId === 'string' ? payload.friendshipId : null;
    const fromUserId = typeof payload.fromUserId === 'string' ? payload.fromUserId : null;
    return items.some(
      (r) =>
        (friendshipId && r.id === friendshipId) ||
        (fromUserId && r.requesterId === fromUserId),
    );
  };

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    void queryClient.invalidateQueries({ queryKey: ['profile'] });
    void queryClient.invalidateQueries({ queryKey: ['friend-requests-pending'] });
  };

  const markRead = useMutation({
    mutationFn: (notificationId: string) =>
      api(`/notifications/${notificationId}/read`, { method: 'POST', body: '{}' }),
    onSuccess: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST', body: '{}' }),
    onSuccess: invalidate,
  });

  const respondFriend = useMutation({
    mutationFn: async ({
      targetId,
      accept,
      notificationId,
    }: {
      targetId: string;
      accept: boolean;
      notificationId: string;
    }) => {
      await api(`/profiles/friend-requests/${targetId}/${accept ? 'accept' : 'decline'}`, {
        method: 'POST',
        body: '{}',
      });
      if (!notifications.data?.items.find((n) => n.id === notificationId)?.read) {
        await api(`/notifications/${notificationId}/read`, { method: 'POST', body: '{}' });
      }
      return accept ? 'accepted' : 'declined';
    },
    onSuccess: (status, vars) => {
      setResponded((prev) => ({ ...prev, [vars.notificationId]: status }));
      toast.success(status === 'accepted' ? 'Friend request accepted' : 'Friend request declined');
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not update friend request'),
  });

  if (hydrated && !user) {
    return <EmptyState icon={Bell} title="Sign in to see notifications" />;
  }

  const hasUnread = notifications.data?.items.some((n) => !n.read) ?? false;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-extrabold tracking-tight">Notifications</h1>
        {hasUnread && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => markAllRead.mutate()}
            loading={markAllRead.isPending}
          >
            <Check className="h-4 w-4" aria-hidden /> Mark all read
          </Button>
        )}
      </div>

      {notifications.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] w-full" />
          ))}
        </div>
      ) : notifications.isError ? (
        <ErrorState onRetry={() => notifications.refetch()} />
      ) : notifications.data!.items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="All caught up"
          description="Notifications about your communities, events and messages appear here."
        />
      ) : (
        <ul className="divide-y divide-[var(--color-hairline)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
          {notifications.data!.items.map((notification) => {
            const described = describeNotification(notification.type, notification.payload) ?? {
              title: 'Notification',
            };
            const href = notificationLink(notification);
            const isFriendRequest = notification.type === 'FRIEND_REQUEST';
            const friendTarget = isFriendRequest
              ? friendRequestTargetId(notification.payload)
              : null;
            const response = responded[notification.id];

            return (
              <li key={notification.id}>
                <div
                  className={cn(
                    'flex items-start gap-3 p-4 transition-colors',
                    !notification.read && 'bg-[var(--color-accent-soft)]/40',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-2 h-2 w-2 shrink-0 rounded-full',
                      notification.read ? 'bg-transparent' : 'bg-[var(--color-accent)]',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    {href && !isFriendRequest ? (
                      <Link
                        href={href}
                        className="block hover:opacity-90"
                        onClick={() => !notification.read && markRead.mutate(notification.id)}
                      >
                        <p className="text-[15px] font-semibold">{described.title}</p>
                        {described.body && (
                          <p className="truncate text-[14px] text-[var(--color-ink-secondary)]">
                            {described.body}
                          </p>
                        )}
                      </Link>
                    ) : (
                      <div>
                        {href ? (
                          <Link
                            href={href}
                            className="text-[15px] font-semibold hover:text-[var(--color-accent)]"
                            onClick={() => !notification.read && markRead.mutate(notification.id)}
                          >
                            {described.title}
                          </Link>
                        ) : (
                          <p className="text-[15px] font-semibold">{described.title}</p>
                        )}
                        {described.body && (
                          <p className="truncate text-[14px] text-[var(--color-ink-secondary)]">
                            {described.body}
                          </p>
                        )}
                      </div>
                    )}
                    <time
                      dateTime={notification.createdAt}
                      className="mt-0.5 block text-[12px] text-[var(--color-ink-tertiary)]"
                    >
                      {formatRelative(notification.createdAt)}
                    </time>

                    {isFriendRequest && friendTarget ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(() => {
                          if (response === 'accepted') {
                            return (
                              <span className="text-[13px] font-semibold text-[var(--color-success)]">
                                Accepted
                              </span>
                            );
                          }
                          if (response === 'declined') {
                            return (
                              <span className="text-[13px] font-semibold text-[var(--color-ink-tertiary)]">
                                Declined
                              </span>
                            );
                          }
                          const stillPending =
                            pendingFriendRequests.isLoading ||
                            (pendingFriendRequests.isSuccess &&
                              isPendingFriendRequest(notification.payload));
                          if (
                            !pendingFriendRequests.isLoading &&
                            pendingFriendRequests.isSuccess &&
                            !stillPending
                          ) {
                            return (
                              <span className="text-[13px] font-semibold text-[var(--color-ink-tertiary)]">
                                Already responded
                              </span>
                            );
                          }
                          return (
                            <>
                              <Button
                                size="sm"
                                loading={
                                  respondFriend.isPending &&
                                  respondFriend.variables?.notificationId === notification.id &&
                                  respondFriend.variables.accept
                                }
                                disabled={respondFriend.isPending}
                                onClick={() =>
                                  respondFriend.mutate({
                                    targetId: friendTarget,
                                    accept: true,
                                    notificationId: notification.id,
                                  })
                                }
                              >
                                Accept
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                loading={
                                  respondFriend.isPending &&
                                  respondFriend.variables?.notificationId === notification.id &&
                                  !respondFriend.variables.accept
                                }
                                disabled={respondFriend.isPending}
                                onClick={() =>
                                  respondFriend.mutate({
                                    targetId: friendTarget,
                                    accept: false,
                                    notificationId: notification.id,
                                  })
                                }
                              >
                                Decline
                              </Button>
                            </>
                          );
                        })()}
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
