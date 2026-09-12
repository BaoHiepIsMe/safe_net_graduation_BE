import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Server, Socket } from 'socket.io';
import { SupabaseService } from '../supabase/supabase.service';
import { RealtimeRoomAuthorizationService } from './realtime-room-authorization.service';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  CALL_SIGNAL_EVENT,
  CALL_SIGNAL_MAX_PER_WINDOW,
  CALL_SIGNAL_WINDOW_MS,
} from '../../modules/calls/calls.constants';
import { callSignalSchema } from '../../modules/calls/dto/call.dto';
import { CallSignalingService } from '../../modules/calls/call-signaling.service';

@WebSocketGateway()
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private authenticatedUsers = new Map<string, string>(); // socket.id -> userId
  private signalWindows = new Map<
    string,
    { startedAt: number; count: number }
  >();

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly roomAuthorization: RealtimeRoomAuthorizationService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const authHeader =
        client.handshake.auth?.token || client.handshake.headers?.authorization;
      if (!authHeader) {
        this.logger.warn(
          `Unauthenticated WS connection attempted: ${client.id}`,
        );
        client.disconnect();
        return;
      }

      const token = authHeader.startsWith('Bearer ')
        ? authHeader.split(' ')[1]
        : authHeader;

      const user = await this.supabaseService.verifyToken(token);
      if (!user) {
        this.logger.warn(`Invalid token for WS client: ${client.id}`);
        client.disconnect();
        return;
      }

      this.authenticatedUsers.set(client.id, user.id);
      // Automatically join user's private room
      void client.join(`user:${user.id}`);
      this.logger.log(
        `WS Client authenticated: ${client.id} (user: ${user.id})`,
      );
    } catch {
      this.logger.error('WS connection failed during authentication');
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.authenticatedUsers.delete(client.id);
    this.signalWindows.delete(client.id);
    this.logger.log(`WS Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { room: string },
  ) {
    const userId = this.authenticatedUsers.get(client.id);
    if (!userId) {
      return this.roomDenied();
    }

    if (!payload?.room) {
      return this.roomDenied();
    }

    const authorizedRoom = await this.roomAuthorization.authorize(
      userId,
      payload.room,
    );
    if (!authorizedRoom) return this.roomDenied();

    await client.join(authorizedRoom.name);
    this.logger.log(
      `Socket ${client.id} joined authorized ${authorizedRoom.type} room`,
    );
    return { success: true, data: { room: authorizedRoom.name } };
  }

  @SubscribeMessage('leave_room')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { room: string },
  ) {
    if (payload?.room) {
      void client.leave(payload.room);
    }
    return { success: true };
  }

  @SubscribeMessage(CALL_SIGNAL_EVENT)
  async handleCallSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ) {
    const userId = this.authenticatedUsers.get(client.id);
    if (!userId || !this.consumeSignalCapacity(client.id)) {
      return this.callSignalDenied();
    }
    const parsed = callSignalSchema.safeParse(payload);
    if (!parsed.success) return this.callSignalInvalid();
    const signaling = this.moduleRef?.get(CallSignalingService, {
      strict: false,
    });
    if (!signaling) return this.callSignalDenied();
    const authorization = await signaling.authorize(
      userId,
      parsed.data.callId,
      parsed.data.signalType,
    );
    if (!authorization) return this.callSignalDenied();
    this.emitToUser(authorization.targetUserId, CALL_SIGNAL_EVENT, {
      callId: parsed.data.callId,
      signalType: parsed.data.signalType,
      payload: parsed.data.payload,
      fromUserId: userId,
    });
    return {
      success: true,
      data: {
        callId: parsed.data.callId,
        signalType: parsed.data.signalType,
      },
    };
  }

  // Broadcasters for domain services
  emitToUser(userId: string, event: string, data: any) {
    if (this.server) {
      this.server.to(`user:${userId}`).emit(event, data);
    }
  }

  emitToFamily(familyId: string, event: string, data: any) {
    if (this.server) {
      this.server.to(`family:${familyId}`).emit(event, data);
    }
  }

  emitToChat(conversationId: string, event: string, data: any) {
    if (this.server) {
      this.server.to(`chat:${conversationId}`).emit(event, data);
    }
  }

  private roomDenied() {
    return {
      success: false,
      error: {
        code: ErrorCode.REALTIME_ROOM_ACCESS_DENIED,
        message: 'Không thể tham gia phòng realtime',
        details: null,
      },
    };
  }

  private consumeSignalCapacity(socketId: string) {
    const now = Date.now();
    const current = this.signalWindows.get(socketId);
    if (!current || now - current.startedAt >= CALL_SIGNAL_WINDOW_MS) {
      this.signalWindows.set(socketId, { startedAt: now, count: 1 });
      return true;
    }
    if (current.count >= CALL_SIGNAL_MAX_PER_WINDOW) return false;
    current.count++;
    return true;
  }

  private callSignalDenied() {
    return {
      success: false,
      error: {
        code: ErrorCode.CALL_SIGNAL_NOT_ALLOWED,
        message: 'Call signaling is not allowed',
        details: null,
      },
    };
  }

  private callSignalInvalid() {
    return {
      success: false,
      error: {
        code: ErrorCode.CALL_SIGNAL_INVALID,
        message: 'Invalid Call signaling payload',
        details: null,
      },
    };
  }
}
