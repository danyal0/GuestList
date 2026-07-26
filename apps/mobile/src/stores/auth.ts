import { create } from 'zustand';
import type { User } from '@/lib/types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  hydrated: boolean;
  setSession: (user: User, accessToken: string) => void;
  clearSession: () => void;
  setHydrated: () => void;
  updateUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  hydrated: false,
  setSession: (user, accessToken) => set({ user, accessToken }),
  clearSession: () => set({ user: null, accessToken: null }),
  setHydrated: () => set({ hydrated: true }),
  updateUser: (user) => set({ user }),
}));
