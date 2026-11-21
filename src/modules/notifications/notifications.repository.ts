import { Injectable } from '@nestjs/common';
import { isEffectiveCareRecipient } from '../../common/utils/age.util';
import { Prisma } from '../../generated/prisma/client';
import {
  effectiveCareRecipientWhere,
  findCareManagerUserIds,
} from '../families/care-scope.util';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  NotificationCursor,
  NotificationListQueryDto,
} from './dto/notification.dto';
import {
  NOTIFICATION_SOURCE_CALL,
  NOTIFICATION_SOURCE_GEOFENCE_EVENT,
  NOTIFICATION_SOURCE_LOCATION_SIGNAL,
  NOTIFICATION_SOURCE_REMINDER_LOG,
  NOTIFICATION_SOURCE_MESSAGE,
  NOTIFICATION_SOURCE_SOS_EVENT,
  NotificationType,
} from './notifications.constants';

export const safeNotificationSelect = {
  id: true,
  family_id: true,
  notification_type: true,
  title: true,
  message: true,
  metadata: true,
  is_read: true,
  read_at: true,
  created_at: true,
} as const;

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createFromGeofenceEvent(eventId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`notification:${eventId}`}, 0))`,
        );
        const event = await tx.geofenceEvent.findFirst({
          where: {
            id: eventId,
            event_type: { in: ['enter', 'exit'] },
            Family: { status: 'active' },
            // Zone alerts exist only for care recipients and go to the people
            // who canManage them; the recipient's own sharing, visibility and
            // exit-alert switches cannot silence them.
            FamilyMember: {
              status: 'accepted',
              ...effectiveCareRecipientWhere(),
            },
            Geofence: { is_active: true },
          },
          select: {
            id: true,
            family_id: true,
            member_id: true,
            event_type: true,
            detected_at: true,
            Geofence: { select: { id: true, name: true } },
            FamilyMember: {
              select: {
                userId: true,
                displayName: true,
                profile: { select: { fullName: true } },
              },
            },
          },
        });
        if (!event) return [];

        const assignment = await tx.geofenceMember.findFirst({
          where: {
            family_id: event.family_id,
            geofence_id: event.Geofence.id,
            member_id: event.member_id,
          },
          select: { notify_on_enter: true, notify_on_exit: true },
        });
        if (
          !assignment ||
          (event.event_type === 'enter'
            ? !assignment.notify_on_enter
            : !assignment.notify_on_exit)
        ) {
          return [];
        }

        const managerUserIds = await findCareManagerUserIds(
          tx,
          event.family_id,
          { memberId: event.member_id, userId: event.FamilyMember.userId },
        );
        if (managerUserIds.length === 0) return [];

        const recipients = await tx.familyMember.findMany({
          where: {
            familyId: event.family_id,
            status: 'accepted',
            family: { status: 'active' },
            userId: { in: managerUserIds },
          },
          distinct: ['userId'],
          select: {
            userId: true,
            profile: {
              select: {
                UserSetting: {
                  select: { pushNotificationsEnabled: true },
                },
                Device: {
                  where: { isActive: true, fcmToken: { not: null } },
                  select: { id: true },
                },
              },
            },
          },
        });

        const type: NotificationType =
          event.event_type === 'enter' ? 'geofence_enter' : 'geofence_exit';
        const displayName =
          event.FamilyMember.displayName ??
          event.FamilyMember.profile.fullName ??
          'Thành viên gia đình';
        const transitionText =
          event.event_type === 'enter' ? 'đã vào' : 'đã rời';
        const created = [];
        for (const recipient of recipients) {
          const existing = await tx.notification.findUnique({
            where: {
              recipient_user_id_related_table_related_id: {
                recipient_user_id: recipient.userId,
                related_table: NOTIFICATION_SOURCE_GEOFENCE_EVENT,
                related_id: event.id,
              },
            },
            select: { id: true },
          });
          if (existing) continue;
          const notification = await tx.notification.create({
            data: {
              family_id: event.family_id,
              recipient_user_id: recipient.userId,
              sender_user_id: event.FamilyMember.userId,
              notification_type: type,
              title:
                event.event_type === 'enter'
                  ? 'Đã vào vùng an toàn'
                  : 'Đã rời vùng an toàn',
              message: `${displayName} ${transitionText} ${event.Geofence.name}`,
              related_table: NOTIFICATION_SOURCE_GEOFENCE_EVENT,
              related_id: event.id,
              metadata: {
                geofenceId: event.Geofence.id,
                geofenceName: event.Geofence.name,
                memberId: event.member_id,
                transition: event.event_type,
                occurredAt: event.detected_at.toISOString(),
              },
            },
            select: safeNotificationSelect,
          });
          const pushEnabled =
            recipient.profile.UserSetting?.pushNotificationsEnabled !== false;
          if (pushEnabled && recipient.profile.Device.length > 0) {
            await tx.notificationDelivery.createMany({
              data: recipient.profile.Device.map((device) => ({
                notificationId: notification.id,
                deviceId: device.id,
              })),
              skipDuplicates: true,
            });
          }
          created.push({ notification, recipientUserId: recipient.userId });
        }
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Tells the family that [input.userId]'s phone went silent. One notification
   * per recipient per silence: the key is the last location id, which changes
   * as soon as the phone reports again.
   */
  async createFromSignalLoss(input: {
    userId: string;
    locationId: string;
    reason: 'no_connection' | 'no_location';
    silentMinutes: number;
    lastLocationAt: Date;
    lastSeenAt: Date;
    latitude: number;
    longitude: number;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`notification:signal:${input.locationId}`}, 0))`,
        );
        const owner = await tx.userSetting.findUnique({
          where: { userId: input.userId },
          select: {
            locationSharingEnabled: true,
            notifyOnSignalLost: true,
            locationVisibility: true,
          },
        });
        const ownerMemberships = await tx.familyMember.findMany({
          where: {
            userId: input.userId,
            status: 'accepted',
            family: { status: 'active' },
          },
          select: {
            id: true,
            familyId: true,
            displayName: true,
            isCareRecipient: true,
            locationSharingEnabled: true,
            profile: { select: { fullName: true, dateOfBirth: true } },
          },
        });
        if (ownerMemberships.length === 0) return [];
        const allowedViewers =
          owner?.locationVisibility === 'selected'
            ? new Set(
                (
                  await tx.locationShareViewer.findMany({
                    where: { ownerUserId: input.userId },
                    select: { viewerUserId: true },
                  })
                ).map((v) => v.viewerUserId),
              )
            : null;

        // Per family: a care recipient's care managers are always told (their
        // own switches cannot silence it); anyone else follows their sharing,
        // notifyOnSignalLost and visibility settings.
        const allowedByFamily = new Map<string, Set<string> | null>();
        for (const membership of ownerMemberships) {
          if (isEffectiveCareRecipient(membership)) {
            allowedByFamily.set(
              membership.familyId,
              new Set(
                await findCareManagerUserIds(tx, membership.familyId, {
                  memberId: membership.id,
                  userId: input.userId,
                }),
              ),
            );
          } else if (
            owner?.locationSharingEnabled &&
            owner.notifyOnSignalLost &&
            membership.locationSharingEnabled
          ) {
            allowedByFamily.set(membership.familyId, allowedViewers);
          }
        }
        if (allowedByFamily.size === 0) return [];

        const candidates = await tx.familyMember.findMany({
          where: {
            familyId: { in: [...allowedByFamily.keys()] },
            status: 'accepted',
            userId: { not: input.userId },
            family: { status: 'active' },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            userId: true,
            familyId: true,
            profile: {
              select: {
                UserSetting: { select: { pushNotificationsEnabled: true } },
                Device: {
                  where: { isActive: true, fcmToken: { not: null } },
                  select: { id: true },
                },
              },
            },
          },
        });
        const seenUserIds = new Set<string>();
        const recipients = candidates.filter((candidate) => {
          const allowed = allowedByFamily.get(candidate.familyId);
          if (allowed === undefined) return false;
          if (allowed !== null && !allowed.has(candidate.userId)) return false;
          if (seenUserIds.has(candidate.userId)) return false;
          seenUserIds.add(candidate.userId);
          return true;
        });

        const name =
          ownerMemberships[0].displayName ??
          ownerMemberships[0].profile.fullName ??
          'Thành viên gia đình';
        const message =
          input.reason === 'no_connection'
            ? `${name} đã khoảng ${input.silentMinutes} phút không gửi vị trí. Có thể điện thoại đã tắt, hết mạng hoặc ứng dụng bị đóng.`
            : `${name} đang mở ứng dụng nhưng không lấy được vị trí. Có thể đã tắt GPS hoặc thu hồi quyền vị trí.`;
        const created = [];
        for (const recipient of recipients) {
          const existing = await tx.notification.findUnique({
            where: {
              recipient_user_id_related_table_related_id: {
                recipient_user_id: recipient.userId,
                related_table: NOTIFICATION_SOURCE_LOCATION_SIGNAL,
                related_id: input.locationId,
              },
            },
            select: { id: true },
          });
          if (existing) continue;
          const memberId = ownerMemberships.find(
            (m) => m.familyId === recipient.familyId,
          )?.id;
          const notification = await tx.notification.create({
            data: {
              family_id: recipient.familyId,
              recipient_user_id: recipient.userId,
              sender_user_id: input.userId,
              notification_type: 'location_signal_lost',
              title: 'Mất tín hiệu vị trí',
              message,
              related_table: NOTIFICATION_SOURCE_LOCATION_SIGNAL,
              related_id: input.locationId,
              metadata: {
                memberId,
                reason: input.reason,
                lastLocationAt: input.lastLocationAt.toISOString(),
                lastSeenAt: input.lastSeenAt.toISOString(),
                latitude: input.latitude,
                longitude: input.longitude,
              },
            },
            select: safeNotificationSelect,
          });
          const pushEnabled =
            recipient.profile.UserSetting?.pushNotificationsEnabled !== false;
          if (pushEnabled && recipient.profile.Device.length > 0) {
            await tx.notificationDelivery.createMany({
              data: recipient.profile.Device.map((device) => ({
                notificationId: notification.id,
                deviceId: device.id,
              })),
              skipDuplicates: true,
            });
          }
          created.push({ notification, recipientUserId: recipient.userId });
        }
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async createFromSosEvent(eventId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`notification:sos:${eventId}`}, 0))`,
        );
        const event = await tx.sosEvent.findUnique({
          where: { id: eventId },
          select: {
            id: true,
            actorUserId: true,
            triggeredAt: true,
            actor: { select: { fullName: true } },
            recipients: {
              select: {
                recipientUserId: true,
                recipient: {
                  select: {
                    UserSetting: {
                      select: { pushNotificationsEnabled: true },
                    },
                    Device: {
                      where: { isActive: true, fcmToken: { not: null } },
                      select: { id: true },
                    },
                  },
                },
              },
            },
          },
        });
        if (!event) return [];

        const created = [];
        for (const recipient of event.recipients) {
          if (recipient.recipientUserId === event.actorUserId) continue;
          const existing = await tx.notification.findUnique({
            where: {
              recipient_user_id_related_table_related_id: {
                recipient_user_id: recipient.recipientUserId,
                related_table: NOTIFICATION_SOURCE_SOS_EVENT,
                related_id: event.id,
              },
            },
            select: { id: true },
          });
          if (existing) continue;
          const displayName = event.actor.fullName ?? 'Một thành viên gia đình';
          const notification = await tx.notification.create({
            data: {
              recipient_user_id: recipient.recipientUserId,
              sender_user_id: event.actorUserId,
              notification_type: 'sos_alert',
              title: 'SOS khẩn cấp',
              message: `${displayName} cần trợ giúp.`,
              related_table: NOTIFICATION_SOURCE_SOS_EVENT,
              related_id: event.id,
              metadata: {
                sosEventId: event.id,
                occurredAt: event.triggeredAt.toISOString(),
              },
            },
            select: safeNotificationSelect,
          });
          const pushEnabled =
            recipient.recipient.UserSetting?.pushNotificationsEnabled !== false;
          if (pushEnabled && recipient.recipient.Device.length > 0) {
            await tx.notificationDelivery.createMany({
              data: recipient.recipient.Device.map((device) => ({
                notificationId: notification.id,
                deviceId: device.id,
              })),
              skipDuplicates: true,
            });
          }
          created.push({
            notification,
            recipientUserId: recipient.recipientUserId,
          });
        }
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async createFromReminderLog(logId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`notification:reminder:${logId}`}, 0))`,
        );
        const log = await tx.reminderLog.findUnique({
          where: { id: logId },
          select: {
            id: true,
            status: true,
            memberId: true,
            scheduledAt: true,
            reminder: {
              select: {
                id: true,
                familyId: true,
                creatorUserId: true,
                title: true,
                family: { select: { status: true } },
                targets: { select: { memberId: true } },
              },
            },
            member: {
              select: {
                familyId: true,
                status: true,
                userId: true,
                profile: {
                  select: {
                    UserSetting: {
                      select: { pushNotificationsEnabled: true },
                    },
                    Device: {
                      where: { isActive: true, fcmToken: { not: null } },
                      select: { id: true },
                    },
                  },
                },
              },
            },
          },
        });
        if (
          !log ||
          log.status !== 'due' ||
          log.member.status !== 'accepted' ||
          log.member.familyId !== log.reminder.familyId ||
          log.reminder.family.status !== 'active' ||
          !log.reminder.targets.some(
            (target) => target.memberId === log.memberId,
          )
        ) {
          return [];
        }
        const recipientUserId = log.member.userId;
        const existing = await tx.notification.findUnique({
          where: {
            recipient_user_id_related_table_related_id: {
              recipient_user_id: recipientUserId,
              related_table: NOTIFICATION_SOURCE_REMINDER_LOG,
              related_id: log.id,
            },
          },
          select: { id: true },
        });
        if (existing) return [];
        const notification = await tx.notification.create({
          data: {
            family_id: log.reminder.familyId,
            recipient_user_id: recipientUserId,
            sender_user_id: log.reminder.creatorUserId,
            notification_type: 'reminder',
            title: 'Đến giờ nhắc nhở',
            message: log.reminder.title,
            related_table: NOTIFICATION_SOURCE_REMINDER_LOG,
            related_id: log.id,
            metadata: {
              reminderId: log.reminder.id,
              reminderLogId: log.id,
              occurredAt: log.scheduledAt.toISOString(),
            },
          },
          select: safeNotificationSelect,
        });
        const pushEnabled =
          log.member.profile.UserSetting?.pushNotificationsEnabled !== false;
        if (pushEnabled && log.member.profile.Device.length > 0) {
          await tx.notificationDelivery.createMany({
            data: log.member.profile.Device.map((device) => ({
              notificationId: notification.id,
              deviceId: device.id,
            })),
            skipDuplicates: true,
          });
        }
        return [{ notification, recipientUserId }];
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async createFromMessage(messageId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`notification:message:${messageId}`}, 0))`,
        );
        const message = await tx.message.findFirst({
          where: {
            id: messageId,
            type: 'text',
            conversation: {
              family: { status: 'active' },
            },
          },
          select: {
            id: true,
            conversationId: true,
            senderUserId: true,
            createdAt: true,
            sender: { select: { fullName: true } },
            conversation: {
              select: {
                familyId: true,
                family: { select: { status: true } },
              },
            },
          },
        });
        if (!message) return [];
        const senderCurrent = await tx.conversationMember.findFirst({
          where: {
            conversationId: message.conversationId,
            userId: message.senderUserId,
            isActive: true,
            profile: {
              family_members_family_members_user_idToprofiles: {
                some: {
                  familyId: message.conversation.familyId,
                  status: 'accepted',
                },
              },
            },
          },
          select: { id: true },
        });
        if (!senderCurrent) return [];

        const recipients = await tx.conversationMember.findMany({
          where: {
            conversationId: message.conversationId,
            isActive: true,
            userId: { not: message.senderUserId },
            profile: {
              family_members_family_members_user_idToprofiles: {
                some: {
                  familyId: message.conversation.familyId,
                  status: 'accepted',
                  family: { status: 'active' },
                },
              },
            },
          },
          distinct: ['userId'],
          select: {
            userId: true,
            profile: {
              select: {
                UserSetting: { select: { pushNotificationsEnabled: true } },
                Device: {
                  where: { isActive: true, fcmToken: { not: null } },
                  select: { id: true },
                },
              },
            },
          },
        });
        const created = [];
        for (const recipient of recipients) {
          const existing = await tx.notification.findUnique({
            where: {
              recipient_user_id_related_table_related_id: {
                recipient_user_id: recipient.userId,
                related_table: NOTIFICATION_SOURCE_MESSAGE,
                related_id: message.id,
              },
            },
            select: { id: true },
          });
          if (existing) continue;
          const displayName =
            message.sender.fullName ?? 'Một thành viên gia đình';
          const notification = await tx.notification.create({
            data: {
              family_id: message.conversation.familyId,
              recipient_user_id: recipient.userId,
              sender_user_id: message.senderUserId,
              notification_type: 'message',
              title: 'Tin nhắn mới',
              message: `Tin nhắn mới từ ${displayName}`,
              related_table: NOTIFICATION_SOURCE_MESSAGE,
              related_id: message.id,
              metadata: {
                conversationId: message.conversationId,
                messageId: message.id,
                occurredAt: message.createdAt.toISOString(),
              },
            },
            select: safeNotificationSelect,
          });
          if (
            recipient.profile.UserSetting?.pushNotificationsEnabled !== false &&
            recipient.profile.Device.length > 0
          ) {
            await tx.notificationDelivery.createMany({
              data: recipient.profile.Device.map((device) => ({
                notificationId: notification.id,
                deviceId: device.id,
              })),
              skipDuplicates: true,
            });
          }
          created.push({ notification, recipientUserId: recipient.userId });
        }
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async createFromCall(callId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`notification:call:${callId}`}, 0))`,
        );
        const call = await tx.callLog.findFirst({
          where: { id: callId, status: 'ringing' },
          select: {
            id: true,
            familyId: true,
            conversationId: true,
            callerUserId: true,
            calleeUserId: true,
            callType: true,
            createdAt: true,
            caller: { select: { fullName: true } },
            callee: {
              select: {
                UserSetting: { select: { pushNotificationsEnabled: true } },
                Device: {
                  where: { isActive: true, fcmToken: { not: null } },
                  select: { id: true },
                },
              },
            },
          },
        });
        if (!call) return [];
        const authorized = await tx.conversation.findFirst({
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
        if (!authorized) return [];
        const existing = await tx.notification.findUnique({
          where: {
            recipient_user_id_related_table_related_id: {
              recipient_user_id: call.calleeUserId,
              related_table: NOTIFICATION_SOURCE_CALL,
              related_id: call.id,
            },
          },
          select: { id: true },
        });
        if (existing) return [];
        const displayName = call.caller.fullName ?? 'Một thành viên gia đình';
        const notification = await tx.notification.create({
          data: {
            family_id: call.familyId,
            recipient_user_id: call.calleeUserId,
            sender_user_id: call.callerUserId,
            notification_type: 'call_incoming',
            title:
              call.callType === 'video'
                ? 'Cuộc gọi video đến'
                : 'Cuộc gọi thoại đến',
            message: `${displayName} đang gọi`,
            related_table: NOTIFICATION_SOURCE_CALL,
            related_id: call.id,
            metadata: {
              callId: call.id,
              conversationId: call.conversationId,
              callType: call.callType,
              occurredAt: call.createdAt.toISOString(),
            },
          },
          select: safeNotificationSelect,
        });
        if (
          call.callee.UserSetting?.pushNotificationsEnabled !== false &&
          call.callee.Device.length > 0
        ) {
          await tx.notificationDelivery.createMany({
            data: call.callee.Device.map((device) => ({
              notificationId: notification.id,
              deviceId: device.id,
            })),
            skipDuplicates: true,
          });
        }
        return [{ notification, recipientUserId: call.calleeUserId }];
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async createFamilyNotifications(input: {
    familyId: string;
    senderUserId: string | null;
    recipientUserIds: string[];
    type: NotificationType;
    title: string;
    message: string;
    metadata?: Record<string, unknown>;
  }) {
    const uniqueRecipientIds = [...new Set(input.recipientUserIds)].filter(
      Boolean,
    );
    if (uniqueRecipientIds.length === 0) return [];

    return this.prisma.$transaction(async (tx) => {
      const profiles = await tx.profile.findMany({
        where: { id: { in: uniqueRecipientIds } },
        select: {
          id: true,
          UserSetting: { select: { pushNotificationsEnabled: true } },
          Device: {
            where: { isActive: true, fcmToken: { not: null } },
            select: { id: true },
          },
        },
      });
      const created: Array<{
        notification: Prisma.NotificationGetPayload<{
          select: typeof safeNotificationSelect;
        }>;
        recipientUserId: string;
      }> = [];

      for (const recipient of profiles) {
        const notification = await tx.notification.create({
          data: {
            family_id: input.familyId,
            recipient_user_id: recipient.id,
            sender_user_id: input.senderUserId,
            notification_type: input.type,
            title: input.title,
            message: input.message,
            related_table: null,
            related_id: null,
            metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
          },
          select: safeNotificationSelect,
        });
        const pushEnabled =
          recipient.UserSetting?.pushNotificationsEnabled !== false;
        if (pushEnabled && recipient.Device.length > 0) {
          await tx.notificationDelivery.createMany({
            data: recipient.Device.map((device) => ({
              notificationId: notification.id,
              deviceId: device.id,
            })),
            skipDuplicates: true,
          });
        }
        created.push({ notification, recipientUserId: recipient.id });
      }
      return created;
    });
  }

  listOwned(
    userId: string,
    query: NotificationListQueryDto,
    cursor?: NotificationCursor,
  ) {
    return this.prisma.notification.findMany({
      where: {
        recipient_user_id: userId,
        ...(query.read === 'read'
          ? { is_read: true }
          : query.read === 'unread'
            ? { is_read: false }
            : {}),
        ...(query.type ? { notification_type: query.type } : {}),
        ...(cursor
          ? {
              OR: [
                { created_at: { lt: cursor.createdAt } },
                { created_at: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: safeNotificationSelect,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
  }

  findOwned(userId: string, notificationId: string) {
    return this.prisma.notification.findFirst({
      where: { id: notificationId, recipient_user_id: userId },
      select: safeNotificationSelect,
    });
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { recipient_user_id: userId, is_read: false },
    });
  }

  markAllRead(userId: string) {
    const now = new Date();
    return this.prisma.notification.updateMany({
      where: { recipient_user_id: userId, is_read: false },
      data: { is_read: true, read_at: now },
    });
  }

  markRead(userId: string, notificationId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.notification.findFirst({
        where: { id: notificationId, recipient_user_id: userId },
        select: safeNotificationSelect,
      });
      if (!existing || existing.is_read) return existing;
      return tx.notification.update({
        where: { id: notificationId },
        data: { is_read: true, read_at: new Date() },
        select: safeNotificationSelect,
      });
    });
  }

  listPendingDeliveries(notificationId: string) {
    return this.prisma.notificationDelivery.findMany({
      where: { notificationId, status: 'pending' },
      select: {
        id: true,
        attemptCount: true,
        device: { select: { id: true, fcmToken: true, isActive: true } },
        notification: {
          select: {
            id: true,
            title: true,
            message: true,
            notification_type: true,
            profiles_notifications_recipient_user_idToprofiles: {
              select: {
                UserSetting: {
                  select: { pushNotificationsEnabled: true },
                },
              },
            },
          },
        },
      },
    });
  }

  recordDeliveryAttempt(
    deliveryId: string,
    result: { status: 'pending' | 'sent' | 'failed'; errorCategory?: string },
  ) {
    const now = new Date();
    return this.prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: result.status,
        attemptCount: { increment: 1 },
        lastAttemptAt: now,
        sentAt: result.status === 'sent' ? now : null,
        errorCategory: result.status === 'sent' ? null : result.errorCategory,
        updatedAt: now,
      },
    });
  }

  clearInvalidToken(deviceId: string, token: string) {
    return this.prisma.device.updateMany({
      where: { id: deviceId, fcmToken: token },
      data: { fcmToken: null, updatedAt: new Date() },
    });
  }
}
