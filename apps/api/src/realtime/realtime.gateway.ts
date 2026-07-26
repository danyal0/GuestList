import { Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Message, Notification } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { AccessTokenPayload } from '../common/types/auth-user';
import { MessagingService } from '../messaging/messaging.service';

interface AuthedSocket extends Socket {
  data: { userId?: string };
}

/**
 * Single Socket.IO gateway for all live features: notifications, chat,
 * event updates and RSVP counters. Rooms:
 *   user:{id}         — personal notification stream (joined automatically)
 *   conversation:{id} — chat rooms (membership verified on join)
 *   event:{id}        — live RSVP counts / event changes (public data only)
 */
@WebSocketGateway({
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly messagingService: MessagingService,
  ) {}

  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) throw new UnauthorizedException();
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
      client.data.userId = payload.sub;
      await client.join(`user:${payload.sub}`);
    } catch {
      client.emit('error', { message: 'Authentication failed' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket): void {
    // Rooms are cleaned up automatically by Socket.IO.
    void client;
  }

  @SubscribeMessage('conversation:join')
  async joinConversation(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId: string },
  ): Promise<{ ok: boolean }> {
    const userId = client.data.userId;
    if (!userId || !body?.conversationId) return { ok: false };

    const allowed = await this.messagingService.isParticipant(body.conversationId, userId);
    if (!allowed) return { ok: false };

    await client.join(`conversation:${body.conversationId}`);
    return { ok: true };
  }

  @SubscribeMessage('conversation:leave')
  async leaveConversation(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId: string },
  ): Promise<{ ok: boolean }> {
    if (body?.conversationId) await client.leave(`conversation:${body.conversationId}`);
    return { ok: true };
  }

  @SubscribeMessage('conversation:typing')
  async typing(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId: string },
  ): Promise<void> {
    const userId = client.data.userId;
    if (!userId || !body?.conversationId) return;
    client.to(`conversation:${body.conversationId}`).emit('conversation:typing', {
      conversationId: body.conversationId,
      userId,
    });
  }

  @SubscribeMessage('event:watch')
  async watchEvent(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { eventId: string },
  ): Promise<{ ok: boolean }> {
    if (!body?.eventId) return { ok: false };
    await client.join(`event:${body.eventId}`);
    return { ok: true };
  }

  @SubscribeMessage('event:unwatch')
  async unwatchEvent(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { eventId: string },
  ): Promise<{ ok: boolean }> {
    if (body?.eventId) await client.leave(`event:${body.eventId}`);
    return { ok: true };
  }

  // ─────────── Internal event bridge → socket rooms ───────────

  @OnEvent('realtime.notification.created')
  onNotification(payload: { userId: string; notification: Notification }): void {
    this.server.to(`user:${payload.userId}`).emit('notification', payload.notification);
  }

  @OnEvent('realtime.message.created')
  onMessage(payload: { conversationId: string; message: Message }): void {
    this.server.to(`conversation:${payload.conversationId}`).emit('message', payload.message);
  }

  @OnEvent('realtime.message.deleted')
  onMessageDeleted(payload: { conversationId: string; messageId: string }): void {
    this.server.to(`conversation:${payload.conversationId}`).emit('message:deleted', payload);
  }

  @OnEvent('realtime.rsvp.updated')
  onRsvpUpdated(payload: { eventId: string; counts: Record<string, number> }): void {
    this.server.to(`event:${payload.eventId}`).emit('rsvp:updated', payload);
  }

  @OnEvent('realtime.event.updated')
  onEventUpdated(payload: { eventId: string; event: unknown }): void {
    this.server.to(`event:${payload.eventId}`).emit('event:updated', payload);
  }

  private extractToken(client: AuthedSocket): string | undefined {
    const fromAuth = (client.handshake.auth as { token?: string })?.token;
    if (fromAuth) return fromAuth;
    const header = client.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    const cookies = client.handshake.headers.cookie;
    const match = cookies?.match(/gatherly_access=([^;]+)/);
    return match?.[1];
  }
}
