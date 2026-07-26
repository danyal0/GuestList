'use client';

import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth-store';

let socket: Socket | null = null;

/**
 * Lazily-connected singleton Socket.IO client. Connects directly to the API
 * origin (WebSockets do not traverse Next rewrites) using the in-memory
 * access token.
 */
export function getSocket(): Socket | null {
  const token = useAuthStore.getState().accessToken;
  if (!token) return null;

  if (socket?.connected) return socket;

  const url = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  socket?.disconnect();
  socket = io(url, {
    auth: { token },
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
