import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { useAuthStore } from '@/stores/auth';
import type { User } from '@/lib/types';

const ACCESS_KEY = 'mkeplays.access';
const REFRESH_KEY = 'mkeplays.refresh';

/**
 * Resolve the API origin:
 * 1. EXPO_PUBLIC_API_URL when provided (production builds, staging).
 * 2. The Metro host with port 4000 during development, so a device on the
 *    same LAN reaches the API without extra configuration.
 */
export function apiOrigin(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const hostUri = Constants.expoConfig?.hostUri;
  const host = hostUri?.split(':')[0];
  if (host) return `http://${host}:4000`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
}

const BASE = () => `${apiOrigin()}/api/v1`;

// SecureStore is unavailable on web (Expo web preview) — fall back to memory.
const memoryStore = new Map<string, string>();
const canUseSecureStore = Platform.OS !== 'web';

async function getStored(key: string): Promise<string | null> {
  if (!canUseSecureStore) return memoryStore.get(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function setStored(key: string, value: string | null): Promise<void> {
  if (!canUseSecureStore) {
    if (value === null) memoryStore.delete(key);
    else memoryStore.set(key, value);
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface AuthTokens {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export async function storeSession(tokens: AuthTokens): Promise<void> {
  await Promise.all([
    setStored(ACCESS_KEY, tokens.accessToken),
    setStored(REFRESH_KEY, tokens.refreshToken),
  ]);
  useAuthStore.getState().setSession(tokens.user, tokens.accessToken);
}

export async function clearSession(): Promise<void> {
  const refreshToken = await getStored(REFRESH_KEY);
  await Promise.all([setStored(ACCESS_KEY, null), setStored(REFRESH_KEY, null)]);
  useAuthStore.getState().clearSession();
  if (refreshToken) {
    // Best-effort server-side revocation.
    fetch(`${BASE()}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }
}

let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const refreshToken = await getStored(REFRESH_KEY);
      if (!refreshToken) return false;
      try {
        const res = await fetch(`${BASE()}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as AuthTokens;
        await storeSession(data);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/** Restore the persisted session on app launch. */
export async function bootstrapSession(): Promise<void> {
  const store = useAuthStore.getState();
  try {
    const ok = await refreshSession();
    if (!ok) store.clearSession();
  } finally {
    useAuthStore.getState().setHydrated();
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: string;
  skipRefresh?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { skipRefresh, headers, ...init } = options;

  const doFetch = async (): Promise<Response> => {
    const accessToken = await getStored(ACCESS_KEY);
    return fetch(`${BASE()}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(headers as Record<string, string> | undefined),
      },
    });
  };

  let res = await doFetch();
  if (res.status === 401 && !skipRefresh) {
    const ok = await refreshSession();
    if (ok) res = await doFetch();
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      const m = body.message;
      message = Array.isArray(m) ? m[0] : (m ?? message);
    } catch {
      // keep default message
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Get the current access token (for the Socket.IO handshake). */
export async function currentAccessToken(): Promise<string | null> {
  return getStored(ACCESS_KEY);
}

/** Resolve relative upload URLs (e.g. /uploads/abc.webp) against the API origin. */
export function absoluteUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${apiOrigin()}${url}`;
}
