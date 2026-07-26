'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { useAuthStore } from '@/stores/auth-store';
import { getSocket, disconnectSocket } from '@/lib/socket';
import { toast } from 'sonner';

function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const { setSession, setHydrated, clear, accessToken, user } = useAuthStore();

  // Restore the session on first load via the refresh cookie.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (cancelled) return;
        if (response.ok) {
          const data = await response.json();
          setSession(data.user, data.accessToken);
        } else {
          clear();
        }
      } catch {
        if (!cancelled) setHydrated();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setSession, setHydrated, clear]);

  // Live notification stream once authenticated.
  React.useEffect(() => {
    if (!accessToken || !user) return;
    const socket = getSocket();
    if (!socket) return;

    const onNotification = (notification: { type: string; payload: Record<string, unknown> }) => {
      const message = describeNotification(notification.type, notification.payload);
      if (message) toast(message.title, { description: message.body });
    };
    socket.on('notification', onNotification);
    return () => {
      socket.off('notification', onNotification);
    };
  }, [accessToken, user]);

  React.useEffect(() => {
    if (!user) disconnectSocket();
  }, [user]);

  return <>{children}</>;
}

export function describeNotification(
  type: string,
  payload: Record<string, unknown>,
): { title: string; body?: string } | null {
  const str = (key: string): string => (typeof payload[key] === 'string' ? (payload[key] as string) : '');
  switch (type) {
    case 'NEW_MEMBER':
      return { title: `${str('memberName')} joined ${str('groupName')}` };
    case 'MEMBER_APPROVED':
      return { title: `You're in! Welcome to ${str('groupName')}` };
    case 'EVENT_REMINDER':
      return { title: 'Event reminder', body: `${str('eventTitle')} is coming up soon` };
    case 'EVENT_CREATED':
      return { title: 'New event', body: str('eventTitle') };
    case 'EVENT_UPDATED':
      return { title: 'Event updated', body: str('eventTitle') };
    case 'EVENT_CANCELLED':
      return { title: 'Event cancelled', body: str('eventTitle') };
    case 'RSVP_CONFIRMED':
      return { title: 'RSVP confirmed', body: str('eventTitle') };
    case 'RSVP_PROMOTED':
      return { title: "You're off the waitlist!", body: str('eventTitle') };
    case 'MESSAGE_RECEIVED':
      return { title: `Message from ${str('fromName')}`, body: str('preview') };
    case 'COMMUNITY_UPDATE':
      return { title: str('groupName'), body: str('message') };
    case 'FRIEND_REQUEST':
      return { title: `${str('fromName')} sent you a friend request` };
    case 'FRIEND_ACCEPTED':
      return { title: `${str('fromName')} accepted your friend request` };
    case 'REPORT_RESOLVED':
      return { title: 'Your report was reviewed', body: str('resolution') };
    default:
      return null;
  }
}

function ServiceWorkerRegistration() {
  React.useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <SessionBootstrap>{children}</SessionBootstrap>
        <Toaster position="top-center" richColors closeButton />
        <ServiceWorkerRegistration />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
