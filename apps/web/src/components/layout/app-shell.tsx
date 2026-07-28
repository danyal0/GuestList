'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  CalendarDays,
  Compass,
  MessageCircle,
  Plus,
  Search,
  Shield,
  User,
  Users,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { disconnectSocket } from '@/lib/socket';

const NAV_ITEMS = [
  { href: '/', label: 'Discover', icon: Compass },
  { href: '/events', label: 'Events', icon: CalendarDays },
  { href: '/groups', label: 'Communities', icon: Users },
  { href: '/messages', label: 'Messages', icon: MessageCircle },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clear } = useAuthStore();

  const { data: unread } = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api<{ count: number }>('/notifications/unread-count'),
    enabled: !!user,
    refetchInterval: 60_000,
  });

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: '{}' });
    } finally {
      clear();
      disconnectSocket();
      router.push('/');
      router.refresh();
    }
  };

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <div className="min-h-dvh pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
      {/* Skip link for keyboard users */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-[var(--color-accent)] focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>

      {/* Top navigation — glass */}
      <header className="glass-subtle sticky top-0 z-40">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <Link href="/" className="flex items-center gap-2" aria-label="MKE Plays home">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-[var(--color-accent)] to-[#5e5ce6] text-white">
              <Users className="h-4.5 w-4.5" aria-hidden />
            </span>
            <span className="text-[19px] font-extrabold tracking-tight">MKE Plays</span>
          </Link>

          <nav aria-label="Primary" className="ml-6 hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(href) ? 'page' : undefined}
                className={cn(
                  'rounded-[var(--radius-pill)] px-4 py-2 text-[14px] font-semibold transition-colors',
                  isActive(href)
                    ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                    : 'text-[var(--color-ink-secondary)] hover:bg-[var(--color-surface-3)]',
                )}
              >
                {label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/search"
              aria-label="Search"
              className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-surface-3)]"
            >
              <Search className="h-5 w-5" aria-hidden />
            </Link>

            {user ? (
              <>
                <Link
                  href="/notifications"
                  aria-label={`Notifications${unread?.count ? `, ${unread.count} unread` : ''}`}
                  className="relative flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-surface-3)]"
                >
                  <Bell className="h-5 w-5" aria-hidden />
                  {(unread?.count ?? 0) > 0 && (
                    <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-danger)] px-1 text-[10px] font-bold text-white">
                      {unread!.count > 99 ? '99+' : unread!.count}
                    </span>
                  )}
                </Link>

                <Button asChild size="sm" className="hidden md:inline-flex">
                  <Link href="/groups/new">
                    <Plus className="h-4 w-4" aria-hidden /> Create
                  </Link>
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label="Account menu"
                    className="rounded-full transition-transform active:scale-95"
                  >
                    <Avatar src={user.avatarUrl} name={user.name} size="md" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => router.push(`/profile/${user.id}`)}>
                      <User className="h-4 w-4" aria-hidden /> My profile
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => router.push('/settings')}>
                      Settings
                    </DropdownMenuItem>
                    {user.role === 'ADMIN' && (
                      <DropdownMenuItem onSelect={() => router.push('/admin')}>
                        <Shield className="h-4 w-4" aria-hidden /> Admin
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={logout}>
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Button asChild variant="ghost" size="sm">
                  <Link href="/login">Sign in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/signup">Join free</Link>
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 py-6">
        {children}
      </main>

      {/* Bottom tab bar — mobile only, iOS style */}
      <nav
        aria-label="Primary mobile"
        className="glass fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-hairline)] pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="grid h-16 grid-cols-5">
          {[...NAV_ITEMS, { href: user ? `/profile/${user.id}` : '/login', label: 'Profile', icon: User }].map(
            ({ href, label, icon: Icon }) => (
              <Link
                key={label}
                href={href}
                aria-current={isActive(href) ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors',
                  isActive(href) ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-tertiary)]',
                )}
              >
                <Icon className="h-[22px] w-[22px]" aria-hidden />
                {label}
              </Link>
            ),
          )}
        </div>
      </nav>
    </div>
  );
}
