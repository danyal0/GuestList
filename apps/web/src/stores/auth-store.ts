'use client';

import { create } from 'zustand';
import type { User } from '@/lib/types';

interface AuthState {
  user: User | null;
  /** In-memory access token (used for Socket.IO auth; never persisted). */
  accessToken: string | null;
  hydrated: boolean;
  setSession: (user: User, accessToken: string) => void;
  setUser: (user: User) => void;
  setHydrated: () => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  hydrated: false,
  setSession: (user, accessToken) => set({ user, accessToken, hydrated: true }),
  setUser: (user) => set({ user }),
  setHydrated: () => set({ hydrated: true }),
  clear: () => set({ user: null, accessToken: null, hydrated: true }),
}));
