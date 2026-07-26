import { io, type Socket } from 'socket.io-client';
import { apiOrigin } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

let socket: Socket | null = null;

/** Lazily-connected singleton Socket.IO client authenticated with the access token. */
export function getSocket(): Socket | null {
  const token = useAuthStore.getState().accessToken;
  if (!token) return null;
  if (socket?.connected) return socket;

  socket?.disconnect();
  socket = io(apiOrigin(), {
    auth: { token },
    transports: ['websocket'],
  });
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
