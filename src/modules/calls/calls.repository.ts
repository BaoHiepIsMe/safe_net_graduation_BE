import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  CALL_TRANSACTION_RETRY_LIMIT,
  CallAction,
  CallStatus,
} from './calls.constants';
import type {
  CallCursor,
  CallHistoryQueryDto,
  CreateCallDto,
} from './dto/call.dto';

const safeCallSelect = {
  id: true,
  familyId: true,
  conversationId: true,
  callerUserId: true,
  calleeUserId: true,
  callType: true,
  status: true,
  createdAt: true,
  expiresAt: true,
  acceptedAt: true,
  terminalAt: true,
  updatedAt: true,
  caller: { select: { id: true, fullName: true, avatarUrl: true } },
  callee: { select: { id: true, fullName: true, avatarUrl: true } },
} as const;

@Injectable()
export class CallsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    callerUserId: string,
    conversationId: string,
    dto: CreateCallDto,
    fingerprint: string,
    expiresAt: Date,
  ) {
    try {
      return await this.withRetry(() =>
        this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw(
              Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`call-request:${callerUserId}:${dto.clientRequestId}`}, 0))`,
            );
            const existing = await tx.callLog.findUnique({
              where: {
                callerUserId_clientRequestId: {
                  callerUserId,
                  clientRequestId: dto.clientRequestId,
                },
              },
              select: { ...safeCallSelect, requestFingerprint: true },
            });
            if (existing) {
              return existing.requestFingerprint === fingerprint
                ? { outcome: 'reused' as const, call: existing }
                : { outcome: 'conflict' as const };
            }

            const conversation = await tx.conversation.findFirst({
              where: {
                id: conversationId,
                family: { status: 'active' },
              },
              select: {
                id: true,
                familyId: true,
                type: true,
                members: {
                  where: { isActive: true },
                  select: {
                    userId: true,
                    profile: {
                      select: {
                        family_members_family_members_user_idToprofiles: {
                          where: { status: 'accepted' },
                          select: { familyId: true },
                        },
                      },
                    },
                  },
                },
              },
            });
            if (!conversation) return { outcome: 'forbidden' as const };
            if (conversation.type !== 'direct') {
              return { outcome: 'group' as const };
            }
            const eligible = conversation.members.filter((member) =>
              member.profile.family_members_family_members_user_idToprofiles.some(
                (membership) => membership.familyId === conversation.familyId,
              ),
            );
            if (
              eligible.length !== 2 ||
              !eligible.some((member) => member.userId === callerUserId)
            ) {
              return { outcome: 'forbidden' as const };
            }
            const calleeUserId = eligible.find(
              (member) => member.userId !== callerUserId,
            )?.userId;
            if (!calleeUserId || calleeUserId === callerUserId) {
              return { outcome: 'self' as const };
            }
            const users = [callerUserId, calleeUserId].sort();
            for (const userId of users) {
              await tx.$queryRaw(
                Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`call-participant:${userId}`}, 0))`,
              );
            }
            const call = await tx.callLog.create({
              data: {
                familyId: conversation.familyId,
                conversationId,
                callerUserId,
                calleeUserId,
                clientRequestId: dto.clientRequestId,
                requestFingerprint: fingerprint,
                callType: dto.callType,
                status: 'ringing',
                expiresAt,
                activeParticipants: {
                  create: users.map((userId) => ({ userId })),
                },
              },
              select: safeCallSelect,
            });
            return { outcome: 'created' as const, call };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { outcome: 'busy' as const };
      }
      throw error;
    }
  }

  transition(userId: string, callId: string, action: CallAction, now: Date) {
    return this.withRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`call-transition:${callId}`}, 0))`,
          );
          const call = await tx.callLog.findFirst({
            where: {
              id: callId,
              OR: [{ callerUserId: userId }, { calleeUserId: userId }],
            },
            select: safeCallSelect,
          });
          if (!call) return { outcome: 'not_found' as const };

          const target = this.targetStatus(action);
          if (call.status === target) {
            return this.actorAllowed(call, userId, action)
              ? { outcome: 'unchanged' as const, call }
              : { outcome: 'forbidden' as const };
          }
          if (!this.actorAllowed(call, userId, action)) {
            return { outcome: 'forbidden' as const };
          }
          if (
            (action === 'accept' || action === 'reject') &&
            !(await this.currentlyAuthorized(tx, call))
          ) {
            return { outcome: 'forbidden' as const };
          }
          if (call.status === 'ringing' && call.expiresAt <= now) {
            const expired = await tx.callLog.update({
              where: { id: call.id },
              data: { status: 'missed', terminalAt: now, updatedAt: now },
              select: safeCallSelect,
            });
            return { outcome: 'expired' as const, call: expired };
          }
          if (!this.allowedTransition(call.status as CallStatus, target)) {
            return { outcome: 'invalid_state' as const, call };
          }
          const terminal = ['rejected', 'cancelled', 'ended'].includes(target);
          const updated = await tx.callLog.update({
            where: { id: call.id },
            data: {
              status: target,
              acceptedAt: target === 'accepted' ? now : call.acceptedAt,
              terminalAt: terminal ? now : call.terminalAt,
              updatedAt: now,
            },
            select: safeCallSelect,
          });
          return { outcome: 'updated' as const, call: updated };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  listOwned(userId: string, query: CallHistoryQueryDto, cursor?: CallCursor) {
    return this.prisma.callLog.findMany({
      where: {
        OR: [{ callerUserId: userId }, { calleeUserId: userId }],
        ...(cursor
          ? {
              AND: [
                {
                  OR: [
                    { createdAt: { lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                  ],
                },
              ],
            }
          : {}),
      },
      select: safeCallSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
  }

  findOwned(userId: string, callId: string) {
    return this.prisma.callLog.findFirst({
      where: {
        id: callId,
        OR: [{ callerUserId: userId }, { calleeUserId: userId }],
      },
      select: safeCallSelect,
    });
  }

  async resolveCurrentParticipants(callId: string) {
    const call = await this.prisma.callLog.findUnique({
      where: { id: callId },
      select: safeCallSelect,
    });
    if (!call || !(await this.currentlyAuthorized(this.prisma, call))) {
      return null;
    }
    return { call, userIds: [call.callerUserId, call.calleeUserId] };
  }

  async authorizeSignal(userId: string, callId: string, signalType: string) {
    const call = await this.prisma.callLog.findFirst({
      where: {
        id: callId,
        OR: [{ callerUserId: userId }, { calleeUserId: userId }],
      },
      select: safeCallSelect,
    });
    if (!call || !(await this.currentlyAuthorized(this.prisma, call))) {
      return null;
    }
    if (!['ringing', 'accepted'].includes(call.status)) return null;
    if (signalType === 'offer' && call.callerUserId !== userId) return null;
    if (
      signalType === 'answer' &&
      (call.calleeUserId !== userId || call.status !== 'accepted')
    ) {
      return null;
    }
    return {
      call,
      targetUserId:
        call.callerUserId === userId ? call.calleeUserId : call.callerUserId,
    };
  }

  async expireDue(now: Date, limit: number) {
    const due = await this.prisma.callLog.findMany({
      where: { status: 'ringing', expiresAt: { lte: now } },
      select: { id: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    const expired = [];
    for (const item of due) {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`call-transition:${item.id}`}, 0))`,
        );
        const updated = await tx.callLog.updateMany({
          where: { id: item.id, status: 'ringing', expiresAt: { lte: now } },
          data: { status: 'missed', terminalAt: now, updatedAt: now },
        });
        return updated.count === 1
          ? tx.callLog.findUnique({
              where: { id: item.id },
              select: safeCallSelect,
            })
          : null;
      });
      if (result) expired.push(result);
    }
    return expired;
  }

  private currentlyAuthorized(
    tx: Prisma.TransactionClient | PrismaService,
    call: {
      conversationId: string;
      familyId: string;
      callerUserId: string;
      calleeUserId: string;
    },
  ) {
    return tx.conversation.findFirst({
      where: {
        id: call.conversationId,
        familyId: call.familyId,
        type: 'direct',
        family: { status: 'active' },
        AND: [
          {
            members: {
              some: {
                userId: call.callerUserId,
                isActive: true,
                profile: {
                  family_members_family_members_user_idToprofiles: {
                    some: { familyId: call.familyId, status: 'accepted' },
                  },
                },
              },
            },
          },
          {
            members: {
              some: {
                userId: call.calleeUserId,
                isActive: true,
                profile: {
                  family_members_family_members_user_idToprofiles: {
                    some: { familyId: call.familyId, status: 'accepted' },
                  },
                },
              },
            },
          },
        ],
      },
      select: { id: true },
    });
  }

  private targetStatus(action: CallAction): CallStatus {
    return {
      accept: 'accepted',
      reject: 'rejected',
      cancel: 'cancelled',
      end: 'ended',
    }[action] as CallStatus;
  }

  private actorAllowed(call: any, userId: string, action: CallAction) {
    if (action === 'accept' || action === 'reject') {
      return call.calleeUserId === userId;
    }
    if (action === 'cancel') return call.callerUserId === userId;
    return call.callerUserId === userId || call.calleeUserId === userId;
  }

  private allowedTransition(from: CallStatus, to: CallStatus) {
    return (
      (from === 'ringing' &&
        ['accepted', 'rejected', 'cancelled'].includes(to)) ||
      (from === 'accepted' && to === 'ended')
    );
  }

  private async withRetry<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= CALL_TRANSACTION_RETRY_LIMIT; attempt++) {
      try {
        return await work();
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034';
        if (!retryable || attempt === CALL_TRANSACTION_RETRY_LIMIT) throw error;
      }
    }
    throw new Error('Unreachable Call transaction retry state');
  }
}
