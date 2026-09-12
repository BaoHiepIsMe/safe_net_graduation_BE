import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app.error';
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CALL_ACCEPTED_EVENT,
  CALL_CANCELLED_EVENT,
  CALL_CREATED_EVENT,
  CALL_ENDED_EVENT,
  CALL_MISSED_EVENT,
  CALL_REJECTED_EVENT,
  CallAction,
} from './calls.constants';
import { CallsRepository } from './calls.repository';
import type { CallHistoryQueryDto, CreateCallDto } from './dto/call.dto';

const cursorSchema = z
  .tuple([z.iso.datetime({ offset: true }), z.string().uuid()])
  .transform(([createdAt, id]) => ({ createdAt: new Date(createdAt), id }));

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly repository: CallsRepository,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly config: ConfigService,
  ) {}

  async create(userId: string, conversationId: string, dto: CreateCallDto) {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ conversationId, callType: dto.callType }))
      .digest('hex');
    const timeoutSeconds =
      this.config.get<number>('calls.ringTimeoutSeconds') ?? 45;
    const expiresAt = new Date(Date.now() + timeoutSeconds * 1000);
    const result = await this.repository.create(
      userId,
      conversationId,
      dto,
      fingerprint,
      expiresAt,
    );
    if (result.outcome === 'forbidden') this.notFound();
    if (result.outcome === 'group') {
      throw new BusinessRuleError(
        ErrorCode.GROUP_CALL_NOT_SUPPORTED,
        'Group Calls are not supported in Phase 13',
      );
    }
    if (result.outcome === 'self') {
      throw new BusinessRuleError(
        ErrorCode.CALL_INVALID_STATE,
        'A Call requires two distinct participants',
      );
    }
    if (result.outcome === 'conflict') {
      throw new ConflictError(
        'The client request ID was already used for a different Call',
        ErrorCode.CALL_IDEMPOTENCY_CONFLICT,
      );
    }
    if (result.outcome === 'busy') {
      throw new ConflictError(
        'A Call participant is already busy',
        ErrorCode.CALL_PARTICIPANT_BUSY,
      );
    }
    if (result.outcome === 'created') {
      try {
        await this.notifications.processCall(result.call.id);
      } catch {
        this.logger.warn('Incoming Call notification failed after Call commit');
      }
      await this.emitCurrent(result.call.id, CALL_CREATED_EVENT);
    }
    return {
      ...this.mapCall(result.call),
      created: result.outcome === 'created',
    };
  }

  async transition(userId: string, callId: string, action: CallAction) {
    const result = await this.repository.transition(
      userId,
      callId,
      action,
      new Date(),
    );
    if (result.outcome === 'not_found') this.notFound();
    if (result.outcome === 'forbidden') {
      throw new ForbiddenError(
        'This participant cannot perform that Call action',
        ErrorCode.CALL_ACCESS_DENIED,
      );
    }
    if (result.outcome === 'invalid_state') {
      throw new BusinessRuleError(
        ErrorCode.CALL_INVALID_STATE,
        'The Call cannot perform that transition from its current state',
      );
    }
    if (result.outcome === 'expired') {
      await this.emitCurrent(result.call.id, CALL_MISSED_EVENT);
      throw new ConflictError('The Call has expired', ErrorCode.CALL_EXPIRED);
    }
    if (result.outcome === 'updated') {
      await this.emitCurrent(result.call.id, this.eventFor(action));
    }
    return {
      ...this.mapCall(result.call),
      updated: result.outcome === 'updated',
    };
  }

  async history(userId: string, query: CallHistoryQueryDto) {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.repository.listOwned(userId, query, cursor);
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      data: page.map((call) => this.mapCall(call)),
      pagination: {
        limit: query.limit,
        hasMore,
        nextCursor:
          hasMore && last ? this.encodeCursor(last.createdAt, last.id) : null,
      },
    };
  }

  async detail(userId: string, callId: string) {
    const call = await this.repository.findOwned(userId, callId);
    if (!call) this.notFound();
    return this.mapCall(call);
  }

  async emitMissed(callId: string) {
    await this.emitCurrent(callId, CALL_MISSED_EVENT);
  }

  private async emitCurrent(callId: string, event: string) {
    const resolved = await this.repository.resolveCurrentParticipants(callId);
    if (!resolved) return;
    const payload = this.mapCall(resolved.call);
    for (const userId of resolved.userIds) {
      try {
        this.realtime.emitToUser(userId, event, payload);
      } catch {
        this.logger.warn('Realtime Call delivery failed');
      }
    }
  }

  private mapCall(call: any) {
    const sessionDurationSeconds =
      call.status === 'ended' && call.acceptedAt && call.terminalAt
        ? Math.max(
            0,
            Math.floor(
              (call.terminalAt.getTime() - call.acceptedAt.getTime()) / 1000,
            ),
          )
        : null;
    return {
      id: call.id,
      familyId: call.familyId,
      conversationId: call.conversationId,
      callType: call.callType,
      status: call.status,
      caller: call.caller,
      callee: call.callee,
      createdAt: call.createdAt,
      expiresAt: call.expiresAt,
      acceptedAt: call.acceptedAt,
      terminalAt: call.terminalAt,
      signalingSessionDurationSeconds: sessionDurationSeconds,
      updatedAt: call.updatedAt,
    };
  }

  private eventFor(action: CallAction) {
    return {
      accept: CALL_ACCEPTED_EVENT,
      reject: CALL_REJECTED_EVENT,
      cancel: CALL_CANCELLED_EVENT,
      end: CALL_ENDED_EVENT,
    }[action];
  }

  private encodeCursor(date: Date, id: string) {
    return Buffer.from(`${date.toISOString()}|${id}`, 'utf8').toString(
      'base64url',
    );
  }

  private decodeCursor(value: string) {
    try {
      const parsed = cursorSchema.safeParse(
        Buffer.from(value, 'base64url').toString('utf8').split('|'),
      );
      if (!parsed.success) throw new Error('invalid cursor');
      return parsed.data;
    } catch {
      throw new ValidationError(
        [{ path: ['cursor'], message: 'Invalid Call cursor' }],
        'Invalid cursor',
      );
    }
  }

  private notFound(): never {
    throw new NotFoundError('Call not found', ErrorCode.CALL_NOT_FOUND);
  }
}
