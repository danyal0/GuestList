'use client';

import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth-store';

let socket: Socket | null = null;

/**
 * Lazily-connected singleton Socket.IO client.
 *
 * - Local dev: API on :4000 (WebSockets do not traverse Next rewrites).
 * - Single-service production: same origin (public reverse proxy → API).
 * - Split deploy: set NEXT_PUBLIC_API_URL to the public API origin.
 */
function socketUrl(): string | undefined {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (process.env.NODE_ENV === 'production') return undefined;
  return 'http://localhost:4000';
}

export function getSocket(): Socket | null {
  const token = useAuthStore.getState().accessToken;
  if (!token) return null;

  if (socket?.connected) return socket;

  socket?.disconnect();
  socket = io(socketUrl(), {
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
