import { Injectable } from '@nestjs/common';
import { isMinor } from '../../common/utils/age.util';
import { Prisma } from '../../generated/prisma/client';
import { isWithinHiredScope } from '../families/care-scope.util';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type {
  CommandAckDto,
  CommandListQueryDto,
  CreatePhoneCommandDto,
  PhoneCursor,
  PhoneUsageDto,
  UsageListQueryDto,
} from './dto/phone-management.dto';
import { PHONE_TRANSACTION_RETRY_LIMIT } from './phone-management.constants';

const usageSelect = {
  id: true,
  memberId: true,
  deviceId: true,
  appName: true,
  appPackage: true,
  startedAt: true,
  endedAt: true,
  durationSeconds: true,
  createdAt: true,
} as const;

const ruleSelect = {
  id: true,
  familyId: true,
  memberId: true,
  dailyLimitMinutes: true,
  bedtimeStart: true,
  bedtimeEnd: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const commandSelect = {
  id: true,
  familyId: true,
  memberId: true,
  targetDeviceId: true,
  commandType: true,
  commandPayload: true,
  status: true,
  resultCode: true,
  resultMessage: true,
  createdAt: true,
  sentAt: true,
  acknowledgedAt: true,
  updatedAt: true,
} as const;

interface RuleWrite {
  dailyLimitMinutes?: number | null;
  bedtimeStart?: Date | null;
  bedtimeEnd?: Date | null;
  isActive?: boolean;
}

@Injectable()
export class PhoneManagementRepository {
  constructor(private readonly prisma: PrismaService) {}

  createUsage(
    actorUserId: string,
    familyId: string,
    memberId: string,
    deviceId: string,
    dto: PhoneUsageDto,
    fingerprint: string,
  ) {
    return this.withRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`phone-usage:${deviceId}:${dto.clientRecordId}`}, 0))`,
          );
          const target = await tx.familyMember.findFirst({
            where: {
              id: memberId,
              familyId,
              userId: actorUserId,
              status: 'accepted',
              family: { status: 'active' },
            },
            select: {
              id: true,
              profile: { select: { dateOfBirth: true } },
            },
          });
          const device = await tx.device.findFirst({
            where: { id: deviceId, userId: actorUserId, isActive: true },
            select: { id: true },
          });
          if (!target || !isMinor(target.profile.dateOfBirth) || !device) {
            return { outcome: 'invalid_target' as const };
          }

          const existing = await tx.phoneUsageLog.findUnique({
            where: {
              deviceId_clientRecordId: {
                deviceId,
                clientRecordId: dto.clientRecordId,
              },
            },
            select: { ...usageSelect, requestFingerprint: true },
          });
          if (existing) {
            if (existing.requestFingerprint !== fingerprint) {
              return { outcome: 'conflict' as const };
            }
            return { outcome: 'reused' as const, usage: existing };
          }

          const usage = await tx.phoneUsageLog.create({
            data: {
              memberId,
              deviceId,
              clientRecordId: dto.clientRecordId,
              requestFingerprint: fingerprint,
              appName: dto.appName,
              appPackage: dto.appPackage,
              startedAt: new Date(dto.startedAt),
              endedAt: new Date(dto.endedAt),
              durationSeconds: dto.durationSeconds,
            },
            select: usageSelect,
          });
          return { outcome: 'created' as const, usage };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async listOwnUsage(
    userId: string,
    query: UsageListQueryDto,
    cursor?: PhoneCursor,
  ) {
    return this.listUsage(
      {
        device: { userId },
        member: {
          userId,
          status: 'accepted',
          family: { status: 'active' },
        },
      },
      query,
      cursor,
    );
  }

  async listManagedUsage(
    actorUserId: string,
    familyId: string,
    memberId: string,
    query: UsageListQueryDto,
    cursor?: PhoneCursor,
  ) {
    const allowed = await this.hasManagerTarget(
      actorUserId,
      familyId,
      memberId,
    );
    if (!allowed) return { outcome: 'forbidden' as const };
    const rows = await this.listUsage({ memberId }, query, cursor);
    return { outcome: 'listed' as const, rows };
  }

  createRule(
    actorUserId: string,
    familyId: string,
    memberId: string,
    data: RuleWrite,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`phone-rule:${familyId}:${memberId}`}, 0))`,
      );
      if (!(await this.hasManagerTarget(actorUserId, familyId, memberId, tx))) {
        return { outcome: 'forbidden' as const };
      }
      const existing = await tx.phoneRule.findUnique({
        where: { familyId_memberId: { familyId, memberId } },
        select: { id: true },
      });
      if (existing) return { outcome: 'conflict' as const };
      const rule = await tx.phoneRule.create({
        data: {
          familyId,
          memberId,
          creatorUserId: actorUserId,
          dailyLimitMinutes: data.dailyLimitMinutes,
          bedtimeStart: data.bedtimeStart,
          bedtimeEnd: data.bedtimeEnd,
          isActive: true,
        },
        select: ruleSelect,
      });
      return { outcome: 'created' as const, rule };
    });
  }

  async listRules(actorUserId: string, familyId: string, memberId: string) {
    if (!(await this.hasManagerTarget(actorUserId, familyId, memberId))) {
      return { outcome: 'forbidden' as const };
    }
    const rules = await this.prisma.phoneRule.findMany({
      where: { familyId, memberId },
      select: ruleSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return { outcome: 'listed' as const, rules };
  }

  listOwnRules(userId: string) {
    return this.prisma.phoneRule.findMany({
      where: {
        isActive: true,
        member: {
          userId,
          status: 'accepted',
          family: { status: 'active' },
        },
      },
      select: ruleSelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }

  updateRule(
    actorUserId: string,
    familyId: string,
    memberId: string,
    ruleId: string,
    data: RuleWrite,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`phone-rule:${ruleId}`}, 0))`,
      );
      if (!(await this.hasManagerTarget(actorUserId, familyId, memberId, tx))) {
        return { outcome: 'forbidden' as const };
      }
      const existing = await tx.phoneRule.findFirst({
        where: { id: ruleId, familyId, memberId },
        select: ruleSelect,
      });
      if (!existing) return { outcome: 'not_found' as const };
      const dailyLimitMinutes =
        data.dailyLimitMinutes === undefined
          ? existing.dailyLimitMinutes
          : data.dailyLimitMinutes;
      const bedtimeStart =
        data.bedtimeStart === undefined
          ? existing.bedtimeStart
          : data.bedtimeStart;
      const bedtimeEnd =
        data.bedtimeEnd === undefined ? existing.bedtimeEnd : data.bedtimeEnd;
      if (
        dailyLimitMinutes === null &&
        (bedtimeStart === null || bedtimeEnd === null)
      ) {
        return { outcome: 'invalid_configuration' as const };
      }
      const rule = await tx.phoneRule.update({
        where: { id: ruleId },
        data: {
          ...data,
          updatedAt: new Date(),
        },
        select: ruleSelect,
      });
      return { outcome: 'updated' as const, rule };
    });
  }

  deactivateRule(
    actorUserId: string,
    familyId: string,
    memberId: string,
    ruleId: string,
  ) {
    return this.updateRule(actorUserId, familyId, memberId, ruleId, {
      isActive: false,
    });
  }

  createCommand(
    actorUserId: string,
    familyId: string,
    memberId: string,
    deviceId: string,
    dto: CreatePhoneCommandDto,
    fingerprint: string,
  ) {
    return this.withRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`phone-command:${actorUserId}:${dto.clientRequestId}`}, 0))`,
          );
          const target = await this.getManagerTarget(
            actorUserId,
            familyId,
            memberId,
            tx,
          );
          if (!target) return { outcome: 'forbidden' as const };
          const device = await tx.device.findFirst({
            where: { id: deviceId, userId: target.userId, isActive: true },
            select: { id: true, fcmToken: true },
          });
          if (!device) return { outcome: 'invalid_target' as const };

          const existing = await tx.phoneCommand.findUnique({
            where: {
              creatorUserId_clientRequestId: {
                creatorUserId: actorUserId,
                clientRequestId: dto.clientRequestId,
              },
            },
            select: { ...commandSelect, requestFingerprint: true },
          });
          if (existing) {
            if (existing.requestFingerprint !== fingerprint) {
              return { outcome: 'conflict' as const };
            }
            return {
              outcome: 'reused' as const,
              command: existing,
              targetUserId: target.userId,
              fcmToken: device.fcmToken,
            };
          }

          const command = await tx.phoneCommand.create({
            data: {
              familyId,
              memberId,
              targetDeviceId: deviceId,
              creatorUserId: actorUserId,
              clientRequestId: dto.clientRequestId,
              requestFingerprint: fingerprint,
              commandType: dto.commandType,
              commandPayload:
                dto.commandType === 'warning'
                  ? { message: dto.message }
                  : Prisma.JsonNull,
            },
            select: commandSelect,
          });
          return {
            outcome: 'created' as const,
            command,
            targetUserId: target.userId,
            fcmToken: device.fcmToken,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  markCommandSent(commandId: string) {
    return this.prisma.phoneCommand.updateMany({
      where: { id: commandId, status: 'pending' },
      data: { status: 'sent', sentAt: new Date(), updatedAt: new Date() },
    });
  }

  clearInvalidToken(deviceId: string, token: string) {
    return this.prisma.device.updateMany({
      where: { id: deviceId, fcmToken: token },
      data: { fcmToken: null, updatedAt: new Date() },
    });
  }

  async listDeviceCommands(
    userId: string,
    deviceId: string,
    query: CommandListQueryDto,
    cursor?: PhoneCursor,
  ) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, userId, isActive: true },
      select: { id: true },
    });
    if (!device) return { outcome: 'forbidden' as const };
    const commands = await this.listCommands(
      {
        targetDeviceId: deviceId,
        member: {
          userId,
          status: 'accepted',
          family: { status: 'active' },
        },
      },
      query,
      cursor,
    );
    return { outcome: 'listed' as const, commands };
  }

  async listManagedCommands(
    actorUserId: string,
    familyId: string,
    memberId: string,
    query: CommandListQueryDto,
    cursor?: PhoneCursor,
  ) {
    if (!(await this.hasManagerTarget(actorUserId, familyId, memberId))) {
      return { outcome: 'forbidden' as const };
    }
    const commands = await this.listCommands(
      { familyId, memberId },
      query,
      cursor,
    );
    return { outcome: 'listed' as const, commands };
  }

  acknowledgeCommand(
    userId: string,
    deviceId: string,
    commandId: string,
    dto: CommandAckDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`phone-command:${commandId}`}, 0))`,
      );
      const device = await tx.device.findFirst({
        where: { id: deviceId, userId, isActive: true },
        select: { id: true },
      });
      if (!device) return { outcome: 'forbidden' as const };
      const command = await tx.phoneCommand.findFirst({
        where: {
          id: commandId,
          targetDeviceId: deviceId,
          member: {
            userId,
            status: 'accepted',
            family: { status: 'active' },
          },
        },
        select: commandSelect,
      });
      if (!command) return { outcome: 'not_found' as const };
      if (command.status === 'completed' || command.status === 'failed') {
        const same =
          command.status === dto.status &&
          command.resultCode === (dto.resultCode ?? null) &&
          command.resultMessage === (dto.message ?? null);
        return same
          ? { outcome: 'unchanged' as const, command }
          : { outcome: 'invalid_state' as const };
      }
      const updated = await tx.phoneCommand.update({
        where: { id: commandId },
        data: {
          status: dto.status,
          resultCode: dto.resultCode,
          resultMessage: dto.message,
          acknowledgedAt: new Date(),
          updatedAt: new Date(),
        },
        select: commandSelect,
      });
      return { outcome: 'updated' as const, command: updated };
    });
  }

  private async hasManagerTarget(
    actorUserId: string,
    familyId: string,
    memberId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return Boolean(
      await this.getManagerTarget(actorUserId, familyId, memberId, tx),
    );
  }

  private async getManagerTarget(
    actorUserId: string,
    familyId: string,
    memberId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const [manager, target] = await Promise.all([
      tx.familyMember.findFirst({
        where: {
          familyId,
          userId: actorUserId,
          canManageCare: true,
          status: 'accepted',
          family: { status: 'active' },
        },
        select: {
          id: true,
          userId: true,
          canManageCare: true,
          isHired: true,
          careScopes: { select: { targetMemberId: true } },
          family: { select: { ownerUserId: true } },
        },
      }),
      tx.familyMember.findFirst({
        where: {
          id: memberId,
          familyId,
          status: 'accepted',
          family: { status: 'active' },
        },
        select: {
          id: true,
          userId: true,
          profile: { select: { dateOfBirth: true } },
        },
      }),
    ]);
    if (!manager || !target) return null;
    if (target.userId === actorUserId) return null;
    if (!isMinor(target.profile.dateOfBirth)) return null;
    if (!isWithinHiredScope(manager, target.id)) return null;
    return target;
  }

  private listUsage(
    where: Prisma.PhoneUsageLogWhereInput,
    query: UsageListQueryDto,
    cursor?: PhoneCursor,
  ) {
    return this.prisma.phoneUsageLog.findMany({
      where: {
        ...where,
        startedAt: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lte: new Date(query.to) } : {}),
        },
        ...(cursor
          ? {
              OR: [
                { startedAt: { lt: cursor.createdAt } },
                { startedAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: usageSelect,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
  }

  private listCommands(
    where: Prisma.PhoneCommandWhereInput,
    query: CommandListQueryDto,
    cursor?: PhoneCursor,
  ) {
    return this.prisma.phoneCommand.findMany({
      where: {
        ...where,
        ...(query.status === 'all' ? {} : { status: query.status }),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: commandSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
  }

  private async withRetry<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= PHONE_TRANSACTION_RETRY_LIMIT; attempt++) {
      try {
        return await work();
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2002' || error.code === 'P2034');
        if (!retryable || attempt === PHONE_TRANSACTION_RETRY_LIMIT)
          throw error;
      }
    }
    throw new Error('Unreachable phone management transaction retry state');
  }
}
