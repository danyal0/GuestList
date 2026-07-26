'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { Conversation, Message } from '@/lib/types';
import { cn, formatTime } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { getSocket } from '@/lib/socket';
import { Avatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/empty-state';

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [draft, setDraft] = React.useState('');
  const [typingUser, setTypingUser] = React.useState<string | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const conversations = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api<Conversation[]>('/messaging/conversations'),
    enabled: !!user,
  });
  const conversation = conversations.data?.find((c) => c.id === id);

  const messages = useQuery({
    queryKey: ['messages', id],
    queryFn: () => api<{ items: Message[]; nextCursor?: string }>(`/messaging/conversations/${id}/messages`),
    enabled: !!user,
  });

  // Mark as read when opening and when new messages arrive.
  React.useEffect(() => {
    if (!user || !messages.data) return;
    void api(`/messaging/conversations/${id}/read`, { method: 'POST', body: '{}' }).then(() =>
      queryClient.invalidateQueries({ queryKey: ['conversations'] }),
    );
  }, [id, user, messages.data, queryClient]);

  // Realtime: join the room, stream messages and typing signals.
  React.useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('conversation:join', { conversationId: id });

    const onMessage = (message: Message) => {
      if (message.conversationId !== id) return;
      queryClient.setQueryData<{ items: Message[]; nextCursor?: string }>(['messages', id], (old) =>
        old && !old.items.some((m) => m.id === message.id)
          ? { ...old, items: [...old.items, message] }
          : old,
      );
      setTypingUser(null);
    };
    const onTyping = (payload: { conversationId: string; userId: string }) => {
      if (payload.conversationId !== id || payload.userId === user?.id) return;
      setTypingUser(payload.userId);
      setTimeout(() => setTypingUser(null), 3000);
    };
    socket.on('message', onMessage);
    socket.on('conversation:typing', onTyping);
    return () => {
      socket.emit('conversation:leave', { conversationId: id });
      socket.off('message', onMessage);
      socket.off('conversation:typing', onTyping);
    };
  }, [id, queryClient, user?.id, accessToken]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.data?.items.length, typingUser]);

  const send = useMutation({
    mutationFn: (content: string) =>
      api<Message>(`/messaging/conversations/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }),
    onMutate: () => setDraft(''),
    onSuccess: (message) => {
      queryClient.setQueryData<{ items: Message[]; nextCursor?: string }>(['messages', id], (old) =>
        old && !old.items.some((m) => m.id === message.id)
          ? { ...old, items: [...old.items, message] }
          : old,
      );
    },
    onError: (error, content) => {
      setDraft(content);
      toast.error(error instanceof Error ? error.message : 'Message not sent');
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (trimmed) send.mutate(trimmed);
  };

  const title =
    conversation?.type === 'GROUP'
      ? (conversation.title ?? conversation.group?.name ?? 'Community chat')
      : (conversation?.participants.find((p) => p.userId !== user?.id)?.user.name ?? 'Conversation');

  if (messages.isError) {
    return <ErrorState title="Conversation unavailable" onRetry={() => messages.refetch()} />;
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-180px)] max-w-2xl flex-col md:h-[calc(100dvh-140px)]">
      {/* Header */}
      <div className="glass-subtle sticky top-16 z-10 -mx-4 flex items-center gap-3 px-4 py-3">
        <Link
          href="/messages"
          aria-label="Back to messages"
          className="rounded-full p-1.5 transition-colors hover:bg-[var(--color-surface-3)]"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="truncate text-[17px] font-bold">{title}</h1>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto py-4" role="log" aria-live="polite" aria-label="Messages">
        {messages.isPending ? (
          <div className="space-y-3">
            <Skeleton className="ml-auto h-10 w-48 rounded-[18px]" />
            <Skeleton className="h-10 w-56 rounded-[18px]" />
            <Skeleton className="ml-auto h-10 w-40 rounded-[18px]" />
          </div>
        ) : (
          messages.data?.items.map((message, i) => {
            const mine = message.senderId === user?.id;
            const showAvatar =
              !mine && (i === 0 || messages.data!.items[i - 1]?.senderId !== message.senderId);
            return (
              <div key={message.id} className={cn('flex items-end gap-2', mine && 'flex-row-reverse')}>
                {!mine && (
                  <div className="w-8">
                    {showAvatar && (
                      <Avatar src={message.sender.avatarUrl} name={message.sender.name} size="sm" />
                    )}
                  </div>
                )}
                <div
                  className={cn(
                    'max-w-[75%] rounded-[18px] px-4 py-2.5',
                    mine
                      ? 'rounded-br-md bg-[var(--color-accent)] text-white'
                      : 'rounded-bl-md bg-[var(--color-surface)] shadow-[var(--shadow-card)]',
                  )}
                >
                  {!mine && showAvatar && conversation?.type === 'GROUP' && (
                    <p className="mb-0.5 text-[12px] font-bold text-[var(--color-accent)]">
                      {message.sender.name}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">
                    {message.content}
                  </p>
                  <time
                    dateTime={message.createdAt}
                    className={cn(
                      'mt-0.5 block text-right text-[11px]',
                      mine ? 'text-white/70' : 'text-[var(--color-ink-tertiary)]',
                    )}
                  >
                    {formatTime(message.createdAt)}
                  </time>
                </div>
              </div>
            );
          })
        )}
        {typingUser && (
          <p className="pl-10 text-[13px] italic text-[var(--color-ink-tertiary)]">typing…</p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <form onSubmit={onSubmit} className="glass sticky bottom-[calc(64px+env(safe-area-inset-bottom))] -mx-4 flex items-center gap-2 rounded-t-[var(--radius-lg)] p-3 md:bottom-0">
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            getSocket()?.emit('conversation:typing', { conversationId: id });
          }}
          placeholder="Message…"
          aria-label="Message"
          maxLength={4000}
          className="h-11 flex-1 rounded-[var(--radius-pill)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-4 text-[15px] focus:border-[var(--color-accent)]"
        />
        <button
          type="submit"
          disabled={!draft.trim() || send.isPending}
          aria-label="Send message"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-accent)] text-white transition-transform active:scale-90 disabled:opacity-40"
        >
          <Send className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
}
