'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';
import type { Conversation } from '@/lib/types';
import { formatRelative } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

export default function MessagesPage() {
  const { user, hydrated } = useAuthStore();

  const conversations = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api<Conversation[]>('/messaging/conversations'),
    enabled: !!user,
    refetchInterval: 30_000,
  });

  if (hydrated && !user) {
    return (
      <EmptyState
        icon={MessageCircle}
        title="Sign in to see your messages"
        description="Chat with friends and your communities."
      />
    );
  }

  const conversationName = (c: Conversation): { name: string; avatarUrl: string | null } => {
    if (c.type === 'GROUP') return { name: c.title ?? c.group?.name ?? 'Community chat', avatarUrl: c.group?.coverImage ?? null };
    const other = c.participants.find((p) => p.userId !== user?.id)?.user;
    return { name: other?.name ?? 'Conversation', avatarUrl: other?.avatarUrl ?? null };
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-[28px] font-extrabold tracking-tight">Messages</h1>

      {conversations.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px] w-full" />
          ))}
        </div>
      ) : conversations.isError ? (
        <ErrorState onRetry={() => conversations.refetch()} />
      ) : conversations.data!.length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          title="No conversations yet"
          description="Visit a member's profile to say hi, or open your community's chat."
        />
      ) : (
        <ul className="divide-y divide-[var(--color-hairline)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
          {conversations.data!.map((conversation) => {
            const { name, avatarUrl } = conversationName(conversation);
            return (
              <li key={conversation.id}>
                <Link
                  href={`/messages/${conversation.id}`}
                  className="flex items-center gap-3 p-4 transition-colors hover:bg-[var(--color-surface-2)]"
                >
                  <Avatar src={avatarUrl} name={name} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-[15px] font-semibold">{name}</p>
                      {conversation.lastMessage && (
                        <time
                          dateTime={conversation.lastMessage.createdAt}
                          className="shrink-0 text-[12px] text-[var(--color-ink-tertiary)]"
                        >
                          {formatRelative(conversation.lastMessage.createdAt)}
                        </time>
                      )}
                    </div>
                    <p className="truncate text-[14px] text-[var(--color-ink-secondary)]">
                      {conversation.lastMessage
                        ? `${conversation.lastMessage.sender.id === user?.id ? 'You: ' : ''}${conversation.lastMessage.content}`
                        : 'Say hello 👋'}
                    </p>
                  </div>
                  {conversation.unreadCount > 0 && (
                    <span
                      aria-label={`${conversation.unreadCount} unread`}
                      className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--color-accent)] px-1.5 text-[12px] font-bold text-white"
                    >
                      {conversation.unreadCount}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
