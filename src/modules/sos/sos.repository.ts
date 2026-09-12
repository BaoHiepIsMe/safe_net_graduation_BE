import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  CreateSosContactDto,
  SosContactListQueryDto,
  SosHistoryCursor,
  SosHistoryQueryDto,
  TriggerSosDto,
  UpdateSosContactDto,
} from './dto/sos.dto';
import { SOS_TRANSACTION_RETRY_LIMIT, SosStatus } from './sos.constants';

const safeContactSelect = {
  id: true,
  contactName: true,
  phone: true,
  priority: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  linkedUser: { select: { id: true, fullName: true, avatarUrl: true } },
} as const;

const safeSosSelect = {
  id: true,
  actorUserId: true,
  clientRequestId: true,
  status: true,
  latitude: true,
  longitude: true,
  locationAccuracy: true,
  locationRecordedAt: true,
  note: true,
  triggeredAt: true,
  resolvedAt: true,
  cancelledAt: true,
  actor: { select: { id: true, fullName: true, avatarUrl: true } },
  recipients: { select: { recipientUserId: true } },
} as const;

@Injectable()
export class SosRepository {
  constructor(private readonly prisma: PrismaService) {}

  createContact(ownerUserId: string, dto: CreateSosContactDto) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.contactUserId === ownerUserId)
        return { outcome: 'invalid_link' as const };
      const memberId = dto.contactUserId
        ? await this.findSharedAcceptedMembership(
            tx,
            ownerUserId,
            dto.contactUserId,
          )
        : null;
      if (dto.contactUserId && !memberId)
        return { outcome: 'invalid_link' as const };
      const duplicate = await tx.sosContact.findFirst({
        where: {
          ownerUserId,
          OR: [
            { phone: dto.phone },
            ...(dto.contactUserId
              ? [{ contactUserId: dto.contactUserId }]
              : []),
          ],
        },
        select: { id: true },
      });
      if (duplicate) return { outcome: 'duplicate' as const };
      const contact = await tx.sosContact.create({
        data: {
          ownerUserId,
          memberId,
          contactUserId: dto.contactUserId,
          contactName: dto.contactName,
          phone: dto.phone,
          priority: dto.priority,
        },
        select: safeContactSelect,
      });
      return { outcome: 'created' as const, contact };
    });
  }

  async listContacts(ownerUserId: string, query: SosContactListQueryDto) {
    const where = {
      ownerUserId,
      ...(query.active === undefined ? {} : { isActive: query.active }),
    } satisfies Prisma.SosContactWhereInput;
    const [rows, total] = await Promise.all([
      this.prisma.sosContact.findMany({
        where,
        select: safeContactSelect,
        orderBy: [{ priority: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.sosContact.count({ where }),
    ]);
    return { rows, total };
  }

  updateContact(
    ownerUserId: string,
    contactId: string,
    dto: UpdateSosContactDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.sosContact.findFirst({
        where: { id: contactId, ownerUserId },
        select: { id: true, phone: true, contactUserId: true },
      });
      if (!existing) return { outcome: 'not_found' as const };
      const contactUserId =
        dto.contactUserId === undefined
          ? existing.contactUserId
          : dto.contactUserId;
      if (contactUserId === ownerUserId)
        return { outcome: 'invalid_link' as const };
      const memberId = contactUserId
        ? await this.findSharedAcceptedMembership(
            tx,
            ownerUserId,
            contactUserId,
          )
        : null;
      if (contactUserId && !memberId)
        return { outcome: 'invalid_link' as const };
      const phone = dto.phone ?? existing.phone;
      const duplicate = await tx.sosContact.findFirst({
        where: {
          ownerUserId,
          id: { not: contactId },
          OR: [{ phone }, ...(contactUserId ? [{ contactUserId }] : [])],
        },
        select: { id: true },
      });
      if (duplicate) return { outcome: 'duplicate' as const };
      const contact = await tx.sosContact.update({
        where: { id: contactId },
        data: {
          contactName: dto.contactName,
          phone: dto.phone,
          contactUserId: dto.contactUserId,
          memberId,
          priority: dto.priority,
          isActive: dto.isActive,
          updatedAt: new Date(),
        },
        select: safeContactSelect,
      });
      return { outcome: 'updated' as const, contact };
    });
  }

  deleteContact(ownerUserId: string, contactId: string) {
    return this.prisma.sosContact.deleteMany({
      where: { id: contactId, ownerUserId },
    });
  }

  trigger(actorUserId: string, dto: TriggerSosDto, requestFingerprint: string) {
    return this.withTransactionRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`sos:${actorUserId}`}, 0))`,
          );
          const existing = await tx.sosEvent.findUnique({
            where: {
              actorUserId_clientRequestId: {
                actorUserId,
                clientRequestId: dto.clientRequestId,
              },
            },
            select: { ...safeSosSelect, requestFingerprint: true },
          });
          if (existing) {
            if (existing.requestFingerprint !== requestFingerprint) {
              return { outcome: 'idempotency_conflict' as const };
            }
            return { outcome: 'reused' as const, event: existing };
          }

          const active = await tx.sosEvent.findFirst({
            where: { actorUserId, status: 'active' },
            select: { id: true },
          });
          if (active)
            return { outcome: 'already_active' as const, eventId: active.id };

          if (dto.deviceId) {
            const device = await tx.device.findFirst({
              where: { id: dto.deviceId, userId: actorUserId, isActive: true },
              select: { id: true },
            });
            if (!device) return { outcome: 'invalid_device' as const };
          }

          const [current, memberships] = await Promise.all([
            tx.currentLocation.findUnique({
              where: { userId: actorUserId },
              select: {
                locationId: true,
                latitude: true,
                longitude: true,
                accuracy: true,
                recordedAt: true,
              },
            }),
            tx.familyMember.findMany({
              where: {
                userId: actorUserId,
                status: 'accepted',
                family: { status: 'active' },
              },
              select: { id: true, familyId: true },
              orderBy: { id: 'asc' },
            }),
          ]);
          const familyIds = memberships.map((item) => item.familyId);
          const familyRecipients: Array<{ userId: string }> = familyIds.length
            ? await tx.familyMember.findMany({
                where: {
                  familyId: { in: familyIds },
                  status: 'accepted',
                  family: { status: 'active' },
                },
                distinct: ['userId'],
                select: { userId: true },
              })
            : [];
          const linkedContacts = await tx.sosContact.findMany({
            where: {
              ownerUserId: actorUserId,
              isActive: true,
              contactUserId: { not: null },
            },
            select: { contactUserId: true },
          });

          const recipients = new Map<string, string>();
          recipients.set(actorUserId, 'actor');
          familyRecipients.forEach((item) =>
            recipients.set(
              item.userId,
              item.userId === actorUserId ? 'actor' : 'family',
            ),
          );
          const familyRecipientIds = new Set(
            familyRecipients.map((item) => item.userId),
          );
          linkedContacts.forEach((contact) => {
            if (
              contact.contactUserId &&
              familyRecipientIds.has(contact.contactUserId) &&
              contact.contactUserId !== actorUserId
            ) {
              recipients.set(contact.contactUserId, 'emergency_contact');
            }
          });

          const primaryMembership = memberships[0];
          const event = await tx.sosEvent.create({
            data: {
              actorUserId,
              clientRequestId: dto.clientRequestId,
              requestFingerprint,
              familyId: primaryMembership?.familyId,
              memberId: primaryMembership?.id,
              sourceDeviceId: dto.deviceId,
              sourceLocationId: current?.locationId,
              latitude: current?.latitude,
              longitude: current?.longitude,
              locationAccuracy: current?.accuracy,
              locationRecordedAt: current?.recordedAt,
              note: dto.message,
              recipients: {
                create: [...recipients].map(([recipientUserId, source]) => ({
                  recipientUserId,
                  source,
                })),
              },
            },
            select: safeSosSelect,
          });
          return { outcome: 'created' as const, event };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  listHistory(
    actorUserId: string,
    query: SosHistoryQueryDto,
    cursor?: SosHistoryCursor,
  ) {
    return this.prisma.sosEvent.findMany({
      where: {
        actorUserId,
        ...(query.status ? { status: query.status } : {}),
        ...(cursor
          ? {
              OR: [
                { triggeredAt: { lt: cursor.triggeredAt } },
                { triggeredAt: cursor.triggeredAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: safeSosSelect,
      orderBy: [{ triggeredAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
  }

  findAuthorized(userId: string, eventId: string) {
    return this.prisma.sosEvent.findFirst({
      where: {
        id: eventId,
        OR: [
          { actorUserId: userId },
          { recipients: { some: { recipientUserId: userId } } },
        ],
      },
      select: safeSosSelect,
    });
  }

  transition(actorUserId: string, eventId: string, target: SosStatus) {
    return this.withTransactionRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.sosEvent.findFirst({
            where: { id: eventId, actorUserId },
            select: safeSosSelect,
          });
          if (!existing) return { outcome: 'not_found' as const };
          if (existing.status === target)
            return { outcome: 'unchanged' as const, event: existing };
          if (existing.status !== 'active') {
            return {
              outcome: 'invalid_state' as const,
              currentStatus: existing.status,
            };
          }
          const now = new Date();
          const event = await tx.sosEvent.update({
            where: { id: eventId },
            data: {
              status: target,
              resolvedAt: target === 'resolved' ? now : null,
              cancelledAt: target === 'cancelled' ? now : null,
              updatedAt: now,
            },
            select: safeSosSelect,
          });
          return { outcome: 'updated' as const, event };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  private async findSharedAcceptedMembership(
    tx: Prisma.TransactionClient,
    ownerUserId: string,
    contactUserId: string,
  ) {
    const membership = await tx.familyMember.findFirst({
      where: {
        userId: ownerUserId,
        status: 'accepted',
        family: {
          status: 'active',
          members: {
            some: { userId: contactUserId, status: 'accepted' },
          },
        },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return membership?.id ?? null;
  }

  private async withTransactionRetry<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= SOS_TRANSACTION_RETRY_LIMIT; attempt++) {
      try {
        return await work();
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034';
        if (!retryable || attempt === SOS_TRANSACTION_RETRY_LIMIT) throw error;
      }
    }
    throw new Error('Unreachable SOS transaction retry state');
  }
}
