'use client';

import { useAuthStore } from '@/stores/auth-store';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : undefined;
}

let refreshPromise: Promise<boolean> | null = null;

/**
 * Client API wrapper. Auth cookies flow automatically (same-origin proxy);
 * the CSRF token is attached to mutating requests and expired sessions are
 * transparently refreshed exactly once with request replay.
 */
export async function api<T>(
  path: string,
  options: RequestInit & { skipRefresh?: boolean } = {},
): Promise<T> {
  const { skipRefresh, ...init } = options;
  const method = (init.method ?? 'GET').toUpperCase();

  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = readCookie('mkeplays_csrf');
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }

  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (response.status === 401 && !skipRefresh && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return api<T>(path, { ...options, skipRefresh: true });
    }
    useAuthStore.getState().clear();
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? message);
    } catch {
      // Non-JSON error body — keep default message.
    }
    throw new ApiError(response.status, message);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return (await response.text()) as unknown as T;
  }
  return response.json() as Promise<T>;
}

/** Shared session restore — used by Providers bootstrap and 401 retries. */
export async function refreshSession(): Promise<boolean> {
  // Deduplicate concurrent refreshes — rotation invalidates old tokens.
  refreshPromise ??= (async () => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const csrf = readCookie('mkeplays_csrf');
      if (csrf) headers['X-CSRF-Token'] = csrf;

      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: '{}',
      });
      if (!response.ok) return false;
      const data = await response.json();
      useAuthStore.getState().setSession(data.user, data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => {
        refreshPromise = null;
      }, 50);
    }
  })();
  return refreshPromise;
}
