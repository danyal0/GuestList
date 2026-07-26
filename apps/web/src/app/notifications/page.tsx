'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check } from 'lucide-react';
import { api } from '@/lib/api';
import type { Notification, Paginated } from '@/lib/types';
import { cn, formatRelative } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { describeNotification } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

function notificationLink(notification: Notification): string | null {
  const p = notification.payload;
  if (typeof p.eventId === 'string') return `/events/${p.eventId}`;
  if (typeof p.conversationId === 'string') return `/messages/${p.conversationId}`;
  if (typeof p.groupId === 'string') return `/groups/${p.groupId}`;
  if (typeof p.fromUserId === 'string') return `/profile/${p.fromUserId}`;
  return null;
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const { user, hydrated } = useAuthStore();

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<Paginated<Notification>>('/notifications?limit=50'),
    enabled: !!user,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
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
            const content = (
              <div
                className={cn(
                  'flex items-start gap-3 p-4 transition-colors',
                  href && 'hover:bg-[var(--color-surface-2)]',
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
                  <p className="text-[15px] font-semibold">{described.title}</p>
                  {described.body && (
                    <p className="truncate text-[14px] text-[var(--color-ink-secondary)]">
                      {described.body}
                    </p>
                  )}
                  <time
                    dateTime={notification.createdAt}
                    className="text-[12px] text-[var(--color-ink-tertiary)]"
                  >
                    {formatRelative(notification.createdAt)}
                  </time>
                </div>
              </div>
            );
            return (
              <li key={notification.id}>
                {href ? (
                  <Link href={href} onClick={() => !notification.read && markRead.mutate(notification.id)}>
                    {content}
                  </Link>
                ) : (
                  <button
                    className="w-full text-left"
                    onClick={() => !notification.read && markRead.mutate(notification.id)}
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
