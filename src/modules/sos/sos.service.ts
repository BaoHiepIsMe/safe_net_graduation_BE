import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app.error';
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateSosContactDto,
  SosContactListQueryDto,
  SosHistoryCursor,
  SosHistoryQueryDto,
  TriggerSosDto,
  UpdateSosContactDto,
} from './dto/sos.dto';
import {
  SOS_CANCELLED_EVENT,
  SOS_CREATED_EVENT,
  SOS_RESOLVED_EVENT,
  SosStatus,
} from './sos.constants';
import { SosRepository } from './sos.repository';

const cursorSchema = z
  .tuple([z.iso.datetime({ offset: true }), z.string().uuid()])
  .transform(([triggeredAt, id]) => ({
    triggeredAt: new Date(triggeredAt),
    id,
  }));

@Injectable()
export class SosService {
  private readonly logger = new Logger(SosService.name);

  constructor(
    private readonly repository: SosRepository,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async createContact(userId: string, dto: CreateSosContactDto) {
    const result = await this.repository.createContact(userId, dto);
    if (result.outcome === 'duplicate') this.contactDuplicate();
    if (result.outcome === 'invalid_link') this.invalidContactLink();
    return result.contact;
  }

  async listContacts(userId: string, query: SosContactListQueryDto) {
    const { rows, total } = await this.repository.listContacts(userId, query);
    return {
      data: rows,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async updateContact(
    userId: string,
    contactId: string,
    dto: UpdateSosContactDto,
  ) {
    const result = await this.repository.updateContact(userId, contactId, dto);
    if (result.outcome === 'not_found') this.contactNotFound();
    if (result.outcome === 'duplicate') this.contactDuplicate();
    if (result.outcome === 'invalid_link') this.invalidContactLink();
    return result.contact;
  }

  async deleteContact(userId: string, contactId: string) {
    const result = await this.repository.deleteContact(userId, contactId);
    if (result.count === 0) this.contactNotFound();
  }

  async trigger(userId: string, dto: TriggerSosDto) {
    const fingerprint = this.fingerprint(dto);
    const result = await this.repository.trigger(userId, dto, fingerprint);
    if (result.outcome === 'idempotency_conflict') {
      throw new ConflictError(
        'The client request ID was already used with different SOS data',
        ErrorCode.SOS_IDEMPOTENCY_CONFLICT,
      );
    }
    if (result.outcome === 'already_active') {
      throw new ConflictError(
        'An SOS incident is already active',
        ErrorCode.SOS_ALREADY_ACTIVE,
      );
    }
    if (result.outcome === 'invalid_device') {
      throw new NotFoundError('Device not found', ErrorCode.DEVICE_NOT_FOUND);
    }

    const emitCreated = () => {
      if (result.outcome !== 'created') return;
      this.emitSosCreated(result.event);
    };
    try {
      await this.notifications.processSosEvent(result.event.id, emitCreated);
    } catch {
      this.logger.warn('SOS notification persistence failed');
    }

    return this.mapEvent(result.event, userId);
  }

  async history(userId: string, query: SosHistoryQueryDto) {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.repository.listHistory(userId, query, cursor);
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const last = pageRows.at(-1);
    return {
      data: pageRows.map((row) => this.mapEvent(row, userId)),
      pagination: {
        limit: query.limit,
        nextCursor: hasMore && last ? this.encodeCursor(last) : null,
        hasMore,
      },
    };
  }

  async detail(userId: string, eventId: string) {
    const event = await this.repository.findAuthorized(userId, eventId);
    if (!event) this.eventNotFound();
    return this.mapEvent(event, userId);
  }

  resolve(userId: string, eventId: string) {
    return this.transition(userId, eventId, 'resolved');
  }

  cancel(userId: string, eventId: string) {
    return this.transition(userId, eventId, 'cancelled');
  }

  private async transition(userId: string, eventId: string, target: SosStatus) {
    const result = await this.repository.transition(userId, eventId, target);
    if (result.outcome === 'not_found') this.eventNotFound();
    if (result.outcome === 'invalid_state') {
      throw new BusinessRuleError(
        ErrorCode.SOS_INVALID_STATE,
        `Cannot change a ${result.currentStatus} SOS incident to ${target}`,
      );
    }
    if (result.outcome === 'updated') {
      this.emitToRecipients(
        result.event.recipients.map((item) => item.recipientUserId),
        target === 'resolved' ? SOS_RESOLVED_EVENT : SOS_CANCELLED_EVENT,
        {
          id: result.event.id,
          status: result.event.status,
          occurredAt:
            target === 'resolved'
              ? result.event.resolvedAt
              : result.event.cancelledAt,
        },
      );
    }
    return this.mapEvent(result.event, userId);
  }

  private emitToRecipients(
    recipientUserIds: string[],
    event: string,
    payload: Record<string, unknown>,
  ) {
    [...new Set(recipientUserIds)].forEach((recipientUserId) => {
      try {
        this.realtime.emitToUser(recipientUserId, event, payload);
      } catch {
        this.logger.warn('SOS realtime delivery failed');
      }
    });
  }

  private emitSosCreated(event: any) {
    this.emitToRecipients(
      event.recipients.map((item: any) => item.recipientUserId),
      SOS_CREATED_EVENT,
      {
        id: event.id,
        status: event.status,
        actor: event.actor,
        locationAvailable: event.latitude !== null && event.longitude !== null,
        triggeredAt: event.triggeredAt,
      },
    );
  }

  private mapEvent(row: any, viewerUserId: string) {
    const locationAvailable = row.latitude !== null && row.longitude !== null;
    return {
      id: row.id,
      clientRequestId:
        row.actorUserId === viewerUserId ? row.clientRequestId : null,
      status: row.status,
      actor: row.actor,
      message: row.note,
      location: {
        available: locationAvailable,
        latitude: locationAvailable ? Number(row.latitude) : null,
        longitude: locationAvailable ? Number(row.longitude) : null,
        accuracy: locationAvailable ? row.locationAccuracy : null,
        recordedAt: locationAvailable ? row.locationRecordedAt : null,
      },
      triggeredAt: row.triggeredAt,
      resolvedAt: row.resolvedAt,
      cancelledAt: row.cancelledAt,
    };
  }

  private fingerprint(dto: TriggerSosDto) {
    return createHash('sha256')
      .update(
        JSON.stringify({
          deviceId: dto.deviceId ?? null,
          message: dto.message ?? null,
        }),
      )
      .digest('hex');
  }

  private encodeCursor(row: { id: string; triggeredAt: Date }) {
    return Buffer.from(
      `${row.triggeredAt.toISOString()}|${row.id}`,
      'utf8',
    ).toString('base64url');
  }

  private decodeCursor(cursor: string): SosHistoryCursor {
    try {
      const parsed = cursorSchema.safeParse(
        Buffer.from(cursor, 'base64url').toString('utf8').split('|'),
      );
      if (!parsed.success) throw new Error('invalid cursor');
      return parsed.data;
    } catch {
      throw new ValidationError(
        [{ path: ['cursor'], message: 'Invalid SOS history cursor' }],
        'Invalid cursor',
      );
    }
  }

  private eventNotFound(): never {
    throw new NotFoundError(
      'SOS event not found',
      ErrorCode.SOS_EVENT_NOT_FOUND,
    );
  }

  private contactNotFound(): never {
    throw new NotFoundError(
      'Emergency contact not found',
      ErrorCode.EMERGENCY_CONTACT_NOT_FOUND,
    );
  }

  private contactDuplicate(): never {
    throw new ConflictError(
      'An emergency contact with this phone already exists',
      ErrorCode.EMERGENCY_CONTACT_ALREADY_EXISTS,
    );
  }

  private invalidContactLink(): never {
    throw new BusinessRuleError(
      ErrorCode.EMERGENCY_CONTACT_INVALID,
      'A linked SafeNet contact must be another accepted member of an active shared family',
    );
  }
}
