import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app.error';
import { FirebaseService } from '../../infrastructure/firebase/firebase.service';
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway';
import type {
  CommandAckDto,
  CommandListQueryDto,
  CreatePhoneCommandDto,
  CreatePhoneRuleDto,
  PhoneCursor,
  PhoneUsageDto,
  UpdatePhoneRuleDto,
  UsageListQueryDto,
} from './dto/phone-management.dto';
import { PhoneManagementRepository } from './phone-management.repository';

const cursorSchema = z
  .tuple([z.iso.datetime({ offset: true }), z.string().uuid()])
  .transform(([createdAt, id]) => ({ createdAt: new Date(createdAt), id }));

@Injectable()
export class PhoneManagementService {
  constructor(
    private readonly repository: PhoneManagementRepository,
    private readonly realtime: RealtimeGateway,
    private readonly firebase: FirebaseService,
  ) {}

  async submitUsage(
    userId: string,
    familyId: string,
    memberId: string,
    deviceId: string,
    dto: PhoneUsageDto,
  ) {
    if (new Date(dto.endedAt).getTime() > Date.now() + 5 * 60_000) {
      throw new BusinessRuleError(
        ErrorCode.PHONE_USAGE_INVALID_RECORD,
        'Usage timestamp is unreasonably far in the future',
      );
    }
    const result = await this.repository.createUsage(
      userId,
      familyId,
      memberId,
      deviceId,
      dto,
      this.fingerprint({ familyId, memberId, deviceId, ...dto }),
    );
    if (result.outcome === 'invalid_target') this.usageDenied();
    if (result.outcome === 'conflict') {
      throw new ConflictError(
        'Usage record idempotency key was reused with different data',
        ErrorCode.PHONE_USAGE_INVALID_RECORD,
      );
    }
    return this.mapUsage(result.usage);
  }

  async listOwnUsage(userId: string, query: UsageListQueryDto) {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.repository.listOwnUsage(userId, query, cursor);
    return this.page(rows, query.limit, (row) => row.startedAt, this.mapUsage);
  }

  async listManagedUsage(
    userId: string,
    familyId: string,
    memberId: string,
    query: UsageListQueryDto,
  ) {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const result = await this.repository.listManagedUsage(
      userId,
      familyId,
      memberId,
      query,
      cursor,
    );
    if (result.outcome === 'forbidden') this.usageDenied();
    return this.page(
      result.rows,
      query.limit,
      (row) => row.startedAt,
      this.mapUsage,
    );
  }

  async createRule(
    userId: string,
    familyId: string,
    memberId: string,
    dto: CreatePhoneRuleDto,
  ) {
    const result = await this.repository.createRule(
      userId,
      familyId,
      memberId,
      this.mapRuleWrite(dto),
    );
    if (result.outcome === 'forbidden') this.ruleDenied();
    if (result.outcome === 'conflict') {
      throw new ConflictError(
        'A phone rule already exists for this managed member',
        ErrorCode.PHONE_RULE_ALREADY_EXISTS,
      );
    }
    return this.mapRule(result.rule);
  }

  async listRules(userId: string, familyId: string, memberId: string) {
    const result = await this.repository.listRules(userId, familyId, memberId);
    if (result.outcome === 'forbidden') this.ruleDenied();
    return result.rules.map((rule) => this.mapRule(rule));
  }

  async listOwnRules(userId: string) {
    const rules = await this.repository.listOwnRules(userId);
    return rules.map((rule) => this.mapRule(rule));
  }

  async updateRule(
    userId: string,
    familyId: string,
    memberId: string,
    ruleId: string,
    dto: UpdatePhoneRuleDto,
  ) {
    const result = await this.repository.updateRule(
      userId,
      familyId,
      memberId,
      ruleId,
      this.mapRuleWrite(dto),
    );
    if (result.outcome === 'forbidden') this.ruleDenied();
    if (result.outcome === 'not_found') this.ruleNotFound();
    if (result.outcome === 'invalid_configuration') {
      throw new BusinessRuleError(
        ErrorCode.PHONE_RULE_INVALID_CONFIGURATION,
        'A daily limit or bedtime window is required',
      );
    }
    return this.mapRule(result.rule);
  }

  async deactivateRule(
    userId: string,
    familyId: string,
    memberId: string,
    ruleId: string,
  ) {
    const result = await this.repository.deactivateRule(
      userId,
      familyId,
      memberId,
      ruleId,
    );
    if (result.outcome === 'forbidden') this.ruleDenied();
    if (result.outcome === 'not_found') this.ruleNotFound();
  }

  async createCommand(
    userId: string,
    familyId: string,
    memberId: string,
    deviceId: string,
    dto: CreatePhoneCommandDto,
  ) {
    const fingerprint = this.fingerprint({
      familyId,
      memberId,
      deviceId,
      commandType: dto.commandType,
      message: dto.commandType === 'warning' ? dto.message : null,
    });
    const result = await this.repository.createCommand(
      userId,
      familyId,
      memberId,
      deviceId,
      dto,
      fingerprint,
    );
    if (result.outcome === 'forbidden') this.commandDenied();
    if (result.outcome === 'invalid_target') {
      throw new ForbiddenError(
        'Phone command target is not eligible',
        ErrorCode.PHONE_COMMAND_INVALID_TARGET,
      );
    }
    if (result.outcome === 'conflict') {
      throw new ConflictError(
        'Command idempotency key was reused with different data',
        ErrorCode.PHONE_COMMAND_IDEMPOTENCY_CONFLICT,
      );
    }

    if (result.outcome === 'created') {
      this.emitCommand(result.targetUserId, result.command.id, deviceId);
      if (result.fcmToken) {
        const delivery = await this.safePush(
          result.fcmToken,
          result.command.id,
        );
        if (delivery.status === 'success') {
          try {
            await this.repository.markCommandSent(result.command.id);
            result.command.status = 'sent';
            result.command.sentAt = new Date();
          } catch {
            // The committed command remains authoritative and pollable.
          }
        } else if (delivery.invalidToken) {
          try {
            await this.repository.clearInvalidToken(deviceId, result.fcmToken);
          } catch {
            // Token maintenance must not fail the committed command request.
          }
        }
      }
    }
    return this.mapCommand(result.command);
  }

  async listDeviceCommands(
    userId: string,
    deviceId: string,
    query: CommandListQueryDto,
  ) {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const result = await this.repository.listDeviceCommands(
      userId,
      deviceId,
      query,
      cursor,
    );
    if (result.outcome === 'forbidden') this.commandDenied();
    return this.page(
      result.commands,
      query.limit,
      (row) => row.createdAt,
      this.mapCommand,
    );
  }

  async listManagedCommands(
    userId: string,
    familyId: string,
    memberId: string,
    query: CommandListQueryDto,
  ) {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const result = await this.repository.listManagedCommands(
      userId,
      familyId,
      memberId,
      query,
      cursor,
    );
    if (result.outcome === 'forbidden') this.commandDenied();
    return this.page(
      result.commands,
      query.limit,
      (row) => row.createdAt,
      this.mapCommand,
    );
  }

  async acknowledgeCommand(
    userId: string,
    deviceId: string,
    commandId: string,
    dto: CommandAckDto,
  ) {
    const result = await this.repository.acknowledgeCommand(
      userId,
      deviceId,
      commandId,
      dto,
    );
    if (result.outcome === 'forbidden') this.commandDenied();
    if (result.outcome === 'not_found') {
      throw new NotFoundError(
        'Phone command not found',
        ErrorCode.PHONE_COMMAND_NOT_FOUND,
      );
    }
    if (result.outcome === 'invalid_state') {
      throw new ConflictError(
        'Phone command already has a conflicting terminal result',
        ErrorCode.PHONE_COMMAND_INVALID_STATE,
      );
    }
    return this.mapCommand(result.command);
  }

  private async safePush(token: string, commandId: string) {
    try {
      const result = await this.firebase.sendPushNotification({
        token,
        title: 'Phone management update',
        body: 'A device command is available.',
        data: { type: 'phone_command', commandId },
      });
      return result;
    } catch {
      return { status: 'failure' as const, invalidToken: false };
    }
  }

  private emitCommand(userId: string, commandId: string, deviceId: string) {
    try {
      this.realtime.emitToUser(userId, 'phone_command.created', {
        commandId,
        deviceId,
      });
    } catch {
      // Transport failure never changes durable command state.
    }
  }

  private mapUsage = (row: any) => ({
    id: row.id,
    memberId: row.memberId,
    deviceId: row.deviceId,
    appName: row.appName,
    appPackage: row.appPackage,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationSeconds: row.durationSeconds,
    source: 'managed_device_app' as const,
    createdAt: row.createdAt,
  });

  private mapRule = (row: any) => ({
    id: row.id,
    familyId: row.familyId,
    memberId: row.memberId,
    dailyLimitMinutes: row.dailyLimitMinutes,
    bedtimeStart: this.formatTime(row.bedtimeStart),
    bedtimeEnd: this.formatTime(row.bedtimeEnd),
    isActive: row.isActive,
    enforcementStatus: 'device_enforcement_pending' as const,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  private mapCommand = (row: any) => ({
    id: row.id,
    familyId: row.familyId,
    memberId: row.memberId,
    targetDeviceId: row.targetDeviceId,
    commandType: row.commandType,
    payload:
      row.commandType === 'warning' && row.commandPayload
        ? { message: row.commandPayload.message }
        : null,
    status: row.status,
    resultCode: row.resultCode,
    resultMessage: row.resultMessage,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    acknowledgedAt: row.acknowledgedAt,
    updatedAt: row.updatedAt,
  });

  private mapRuleWrite(dto: CreatePhoneRuleDto | UpdatePhoneRuleDto) {
    return {
      dailyLimitMinutes: dto.dailyLimitMinutes,
      bedtimeStart:
        dto.bedtimeStart === undefined
          ? undefined
          : dto.bedtimeStart === null
            ? null
            : this.parseTime(dto.bedtimeStart),
      bedtimeEnd:
        dto.bedtimeEnd === undefined
          ? undefined
          : dto.bedtimeEnd === null
            ? null
            : this.parseTime(dto.bedtimeEnd),
      ...('isActive' in dto ? { isActive: dto.isActive } : {}),
    };
  }

  private parseTime(value: string) {
    return new Date(`1970-01-01T${value}:00.000Z`);
  }

  private formatTime(value: Date | null) {
    return value ? value.toISOString().slice(11, 16) : null;
  }

  private fingerprint(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private page<T>(
    rows: T[],
    limit: number,
    timestamp: (row: T) => Date,
    map: (row: T) => unknown,
  ) {
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1) as (T & { id: string }) | undefined;
    return {
      data: pageRows.map(map),
      pagination: {
        limit,
        nextCursor:
          hasMore && last ? this.encodeCursor(timestamp(last), last.id) : null,
        hasMore,
      },
    };
  }

  private encodeCursor(createdAt: Date, id: string) {
    return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString(
      'base64url',
    );
  }

  private decodeCursor(value: string): PhoneCursor {
    try {
      const parsed = cursorSchema.safeParse(
        Buffer.from(value, 'base64url').toString('utf8').split('|'),
      );
      if (!parsed.success) throw new Error('invalid cursor');
      return parsed.data;
    } catch {
      throw new ValidationError(
        [{ path: ['cursor'], message: 'Invalid phone-management cursor' }],
        'Invalid cursor',
      );
    }
  }

  private usageDenied(): never {
    throw new ForbiddenError(
      'Phone usage access denied',
      ErrorCode.PHONE_USAGE_ACCESS_DENIED,
    );
  }

  private ruleDenied(): never {
    throw new ForbiddenError(
      'Phone rule access denied',
      ErrorCode.PHONE_RULE_ACCESS_DENIED,
    );
  }

  private commandDenied(): never {
    throw new ForbiddenError(
      'Phone command access denied',
      ErrorCode.PHONE_COMMAND_ACCESS_DENIED,
    );
  }

  private ruleNotFound(): never {
    throw new NotFoundError(
      'Phone rule not found',
      ErrorCode.PHONE_RULE_NOT_FOUND,
    );
  }
}
