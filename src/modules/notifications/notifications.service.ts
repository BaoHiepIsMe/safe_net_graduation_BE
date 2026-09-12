import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ErrorCode } from '../../common/constants/error-codes';
import { NotFoundError, ValidationError } from '../../common/errors/app.error';
import { FirebaseService } from '../../infrastructure/firebase/firebase.service';
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway';
import {
  NotificationCursor,
  NotificationListQueryDto,
} from './dto/notification.dto';
import {
  NOTIFICATION_CREATED_EVENT,
  NOTIFICATION_DELIVERY_MAX_ATTEMPTS,
} from './notifications.constants';
import { NotificationsRepository } from './notifications.repository';

const cursorSchema = z
  .tuple([z.iso.datetime({ offset: true }), z.string().uuid()])
  .transform(([createdAt, id]) => ({ createdAt: new Date(createdAt), id }));

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly firebase: FirebaseService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async processGeofenceEvent(eventId: string) {
    const created = await this.repository.createFromGeofenceEvent(eventId);
    this.emitCreated(created);
    await this.deliverCreated(created);
    return created;
  }

  async processSosEvent(eventId: string, afterNotificationCommit?: () => void) {
    const created = await this.repository.createFromSosEvent(eventId);
    this.emitCreated(created);
    afterNotificationCommit?.();
    await this.deliverCreated(created);
    return created;
  }

  async processReminderLog(logId: string) {
    const created = await this.repository.createFromReminderLog(logId);
    this.emitCreated(created);
    await this.deliverCreated(created);
    return created;
  }

  async processMessage(messageId: string) {
    const created = await this.repository.createFromMessage(messageId);
    this.emitCreated(created);
    await this.deliverCreated(created);
    return created;
  }

  async processCall(callId: string) {
    const created = await this.repository.createFromCall(callId);
    this.emitCreated(created);
    await this.deliverCreated(created);
    return created;
  }

  private emitCreated(
    created: Array<{
      notification: Record<string, any>;
      recipientUserId: string;
    }>,
  ) {
    for (const item of created) {
      try {
        this.realtime.emitToUser(
          item.recipientUserId,
          NOTIFICATION_CREATED_EVENT,
          this.mapNotification(item.notification),
        );
      } catch {
        this.logger.warn('Realtime notification delivery failed');
      }
    }
  }

  private async deliverCreated(
    created: Array<{ notification: { id: string } }>,
  ) {
    for (const item of created) {
      await this.deliverNotification(item.notification.id);
    }
  }

  async list(userId: string, query: NotificationListQueryDto) {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.repository.listOwned(userId, query, cursor);
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const last = pageRows.at(-1);
    return {
      data: pageRows.map((row) => this.mapNotification(row)),
      pagination: {
        limit: query.limit,
        nextCursor: hasMore && last ? this.encodeCursor(last) : null,
        hasMore,
      },
    };
  }

  async getOne(userId: string, notificationId: string) {
    const row = await this.repository.findOwned(userId, notificationId);
    if (!row) this.notFound();
    return this.mapNotification(row);
  }

  async unreadCount(userId: string) {
    return { count: await this.repository.unreadCount(userId) };
  }

  async markAllRead(userId: string) {
    const result = await this.repository.markAllRead(userId);
    return { updatedCount: result.count };
  }

  async markRead(userId: string, notificationId: string) {
    const row = await this.repository.markRead(userId, notificationId);
    if (!row) this.notFound();
    return this.mapNotification(row);
  }

  private async deliverNotification(notificationId: string) {
    let deliveries;
    try {
      deliveries = await this.repository.listPendingDeliveries(notificationId);
    } catch {
      this.logger.warn('Notification delivery lookup failed');
      return;
    }
    for (const delivery of deliveries) {
      if (
        delivery.notification.profiles_notifications_recipient_user_idToprofiles
          .UserSetting?.pushNotificationsEnabled === false
      ) {
        await this.safeRecord(delivery.id, 'failed', 'preference_disabled');
        continue;
      }
      const token = delivery.device.fcmToken;
      if (!delivery.device.isActive || !token) {
        await this.safeRecord(delivery.id, 'failed', 'token_unavailable');
        continue;
      }
      let attempts = delivery.attemptCount;
      while (attempts < NOTIFICATION_DELIVERY_MAX_ATTEMPTS) {
        const result = await this.firebase.sendPushNotification({
          token,
          title: delivery.notification.title,
          body: delivery.notification.message,
          data: {
            notificationId: delivery.notification.id,
            type: delivery.notification.notification_type,
          },
        });
        attempts++;
        if (result.status === 'success') {
          await this.safeRecord(delivery.id, 'sent');
          break;
        }
        if (result.status === 'disabled') {
          await this.safeRecord(delivery.id, 'failed', 'provider_disabled');
          break;
        }
        if (result.invalidToken) {
          await this.safeRecord(delivery.id, 'failed', 'invalid_token');
          try {
            await this.repository.clearInvalidToken(delivery.device.id, token);
          } catch {
            this.logger.warn('Invalid FCM token cleanup failed');
          }
          break;
        }
        const retry =
          result.retryable && attempts < NOTIFICATION_DELIVERY_MAX_ATTEMPTS;
        await this.safeRecord(
          delivery.id,
          retry ? 'pending' : 'failed',
          result.errorCategory ?? 'permanent',
        );
        if (!retry) break;
      }
    }
  }

  private async safeRecord(
    id: string,
    status: 'pending' | 'sent' | 'failed',
    errorCategory?: string,
  ) {
    try {
      await this.repository.recordDeliveryAttempt(id, {
        status,
        errorCategory,
      });
    } catch {
      this.logger.warn('Notification delivery audit update failed');
    }
  }

  private mapNotification(row: any) {
    return {
      id: row.id,
      familyId: row.family_id,
      type: row.notification_type,
      title: row.title,
      message: row.message,
      metadata: this.mapMetadata(row.metadata),
      isRead: row.is_read,
      readAt: row.read_at,
      createdAt: row.created_at,
    };
  }

  private mapMetadata(value: unknown) {
    const metadata =
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)
        : {};
    return {
      geofenceId:
        typeof metadata.geofenceId === 'string' ? metadata.geofenceId : null,
      geofenceName:
        typeof metadata.geofenceName === 'string'
          ? metadata.geofenceName
          : null,
      memberId:
        typeof metadata.memberId === 'string' ? metadata.memberId : null,
      transition:
        metadata.transition === 'enter' || metadata.transition === 'exit'
          ? metadata.transition
          : null,
      occurredAt:
        typeof metadata.occurredAt === 'string' ? metadata.occurredAt : null,
      sosEventId:
        typeof metadata.sosEventId === 'string' ? metadata.sosEventId : null,
      reminderId:
        typeof metadata.reminderId === 'string' ? metadata.reminderId : null,
      reminderLogId:
        typeof metadata.reminderLogId === 'string'
          ? metadata.reminderLogId
          : null,
      conversationId:
        typeof metadata.conversationId === 'string'
          ? metadata.conversationId
          : null,
      messageId:
        typeof metadata.messageId === 'string' ? metadata.messageId : null,
      callId: typeof metadata.callId === 'string' ? metadata.callId : null,
      callType:
        metadata.callType === 'voice' || metadata.callType === 'video'
          ? metadata.callType
          : null,
    };
  }

  private encodeCursor(row: { id: string; created_at: Date }) {
    return Buffer.from(
      `${row.created_at.toISOString()}|${row.id}`,
      'utf8',
    ).toString('base64url');
  }

  private decodeCursor(cursor: string): NotificationCursor {
    try {
      const parsed = cursorSchema.safeParse(
        Buffer.from(cursor, 'base64url').toString('utf8').split('|'),
      );
      if (!parsed.success) throw new Error('invalid cursor');
      return parsed.data;
    } catch {
      throw new ValidationError(
        [{ path: ['cursor'], message: 'Invalid notification cursor' }],
        'Invalid cursor',
      );
    }
  }

  private notFound(): never {
    throw new NotFoundError(
      'Notification not found',
      ErrorCode.NOTIFICATION_NOT_FOUND,
    );
  }
}
