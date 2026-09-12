import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type {
  ChatCursor,
  ChatListQueryDto,
  CreateGroupDto,
  SendMessageDto,
} from './dto/chat.dto';
import { CHAT_TRANSACTION_RETRY_LIMIT } from './chat.constants';

const messageSelect = {
  id: true,
  conversationId: true,
  senderUserId: true,
  type: true,
  content: true,
  createdAt: true,
  sender: { select: { id: true, fullName: true, avatarUrl: true } },
} as const;

@Injectable()
export class ChatRepository {
  constructor(private readonly prisma: PrismaService) {}

  getOrCreateDirect(
    actorUserId: string,
    familyId: string,
    targetMemberId: string,
  ) {
    return this.withRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const [actor, target] = await Promise.all([
            tx.familyMember.findFirst({
              where: {
                familyId,
                userId: actorUserId,
                status: 'accepted',
                family: { status: 'active' },
              },
              select: { id: true, userId: true },
            }),
            tx.familyMember.findFirst({
              where: {
                id: targetMemberId,
                familyId,
                status: 'accepted',
                family: { status: 'active' },
              },
              select: { id: true, userId: true },
            }),
          ]);
          if (!actor || !target) return { outcome: 'forbidden' as const };
          if (actor.userId === target.userId)
            return { outcome: 'self' as const };
          const directKey = [actor.userId, target.userId].sort().join(':');
          await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`direct:${familyId}:${directKey}`}, 0))`,
          );
          const existing = await tx.conversation.findUnique({
            where: { familyId_directKey: { familyId, directKey } },
            select: { id: true },
          });
          if (existing) {
            return {
              outcome: 'existing' as const,
              conversationId: existing.id,
            };
          }
          const conversation = await tx.conversation.create({
            data: {
              familyId,
              type: 'direct',
              directKey,
              members: {
                create: [{ userId: actor.userId }, { userId: target.userId }],
              },
            },
            select: { id: true },
          });
          return {
            outcome: 'created' as const,
            conversationId: conversation.id,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  createGroup(actorUserId: string, familyId: string, dto: CreateGroupDto) {
    return this.prisma.$transaction(async (tx) => {
      const manager = await tx.familyMember.findFirst({
        where: {
          familyId,
          userId: actorUserId,
          role: 'manager',
          status: 'accepted',
          family: { status: 'active' },
        },
        select: { id: true, userId: true },
      });
      if (!manager) return { outcome: 'forbidden' as const };
      const targets = await tx.familyMember.findMany({
        where: {
          id: { in: dto.memberIds },
          familyId,
          status: 'accepted',
          family: { status: 'active' },
        },
        select: { id: true, userId: true },
      });
      if (targets.length !== dto.memberIds.length) {
        return { outcome: 'invalid_target' as const };
      }
      const userIds = [
        ...new Set([actorUserId, ...targets.map((x) => x.userId)]),
      ];
      const conversation = await tx.conversation.create({
        data: {
          familyId,
          title: dto.title,
          type: 'group',
          members: { create: userIds.map((userId) => ({ userId })) },
        },
        select: { id: true },
      });
      return { outcome: 'created' as const, conversationId: conversation.id };
    });
  }

  async listVisible(
    userId: string,
    query: ChatListQueryDto,
    cursor?: ChatCursor,
  ) {
    const rows = await this.prisma.conversationMember.findMany({
      where: {
        userId,
        isActive: true,
        conversation: {
          family: {
            status: 'active',
            members: { some: { userId, status: 'accepted' } },
          },
          ...(cursor
            ? {
                OR: [
                  { updatedAt: { lt: cursor.createdAt } },
                  { updatedAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
      },
      select: {
        joinedAt: true,
        lastReadMessageId: true,
        lastReadMessageCreatedAt: true,
        conversation: {
          select: {
            id: true,
            familyId: true,
            type: true,
            title: true,
            createdAt: true,
            updatedAt: true,
            messages: {
              select: messageSelect,
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
            },
          },
        },
      },
      orderBy: [
        { conversation: { updatedAt: 'desc' } },
        { conversation: { id: 'desc' } },
      ],
      take: query.limit + 1,
    });
    const ids = rows.map((row) => row.conversation.id);
    const [counts, participants] = await Promise.all([
      this.unreadCounts(userId, ids),
      this.currentParticipants(ids),
    ]);
    return rows.map((row) => ({
      ...row,
      conversation: {
        ...row.conversation,
        members: participants.get(row.conversation.id) ?? [],
      },
      unreadCount: counts.get(row.conversation.id) ?? 0,
    }));
  }

  async detail(userId: string, conversationId: string) {
    const access = await this.getAccess(userId, conversationId);
    if (!access) return null;
    const members = await this.listCurrentMembers(
      conversationId,
      access.conversation.familyId,
    );
    const unreadCount = await this.countUnread(userId, access);
    return { access, members, unreadCount };
  }

  async listMembers(userId: string, conversationId: string) {
    const access = await this.getAccess(userId, conversationId);
    if (!access) return null;
    return this.listCurrentMembers(
      conversationId,
      access.conversation.familyId,
    );
  }

  addGroupMember(
    actorUserId: string,
    conversationId: string,
    memberId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const managed = await this.getManagedGroup(
        actorUserId,
        conversationId,
        tx,
      );
      if (!managed) return { outcome: 'forbidden' as const };
      const target = await tx.familyMember.findFirst({
        where: {
          id: memberId,
          familyId: managed.familyId,
          status: 'accepted',
          family: { status: 'active' },
        },
        select: { userId: true },
      });
      if (!target) return { outcome: 'invalid_target' as const };
      const existing = await tx.conversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId,
            userId: target.userId,
          },
        },
        select: { id: true, isActive: true },
      });
      if (existing?.isActive) return { outcome: 'exists' as const };
      const latest = await tx.message.findFirst({
        where: { conversationId },
        select: { id: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const now = new Date();
      if (existing) {
        await tx.conversationMember.update({
          where: { id: existing.id },
          data: {
            isActive: true,
            joinedAt: now,
            removedAt: null,
            lastReadMessageId: latest?.id ?? null,
            lastReadMessageCreatedAt: latest?.createdAt ?? null,
            lastReadAt: latest ? now : null,
          },
        });
      } else {
        await tx.conversationMember.create({
          data: {
            conversationId,
            userId: target.userId,
            joinedAt: now,
            lastReadMessageId: latest?.id,
            lastReadMessageCreatedAt: latest?.createdAt,
            lastReadAt: latest ? now : null,
          },
        });
      }
      return { outcome: 'added' as const };
    });
  }

  removeGroupMember(
    actorUserId: string,
    conversationId: string,
    memberId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const managed = await this.getManagedGroup(
        actorUserId,
        conversationId,
        tx,
      );
      if (!managed) return { outcome: 'forbidden' as const };
      const target = await tx.familyMember.findFirst({
        where: { id: memberId, familyId: managed.familyId },
        select: { userId: true },
      });
      if (!target || target.userId === actorUserId) {
        return { outcome: 'invalid_target' as const };
      }
      const membership = await tx.conversationMember.findFirst({
        where: { conversationId, userId: target.userId, isActive: true },
        select: { id: true },
      });
      if (!membership) return { outcome: 'not_found' as const };
      await tx.conversationMember.update({
        where: { id: membership.id },
        data: { isActive: false, removedAt: new Date() },
      });
      return { outcome: 'removed' as const };
    });
  }

  sendMessage(
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
    fingerprint: string,
  ) {
    return this.withRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`message:${conversationId}:${userId}:${dto.clientMessageId}`}, 0))`,
          );
          const access = await this.getAccess(userId, conversationId, tx);
          if (!access) return { outcome: 'forbidden' as const };
          const existing = await tx.message.findUnique({
            where: {
              conversationId_senderUserId_clientMessageId: {
                conversationId,
                senderUserId: userId,
                clientMessageId: dto.clientMessageId,
              },
            },
            select: { ...messageSelect, requestFingerprint: true },
          });
          if (existing) {
            return existing.requestFingerprint === fingerprint
              ? { outcome: 'reused' as const, message: existing }
              : { outcome: 'conflict' as const };
          }
          const message = await tx.message.create({
            data: {
              conversationId,
              senderUserId: userId,
              clientMessageId: dto.clientMessageId,
              requestFingerprint: fingerprint,
              type: 'text',
              content: dto.content,
            },
            select: messageSelect,
          });
          await tx.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: message.createdAt },
          });
          return { outcome: 'created' as const, message };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async resolveMessageRecipients(messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        ...messageSelect,
        conversation: { select: { familyId: true } },
      },
    });
    if (!message) return null;
    const recipients = await this.prisma.conversationMember.findMany({
      where: {
        conversationId: message.conversationId,
        isActive: true,
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
      select: { userId: true },
    });
    return { message, recipientUserIds: recipients.map((x) => x.userId) };
  }

  async history(
    userId: string,
    conversationId: string,
    query: ChatListQueryDto,
    cursor?: ChatCursor,
  ) {
    const access = await this.getAccess(userId, conversationId);
    if (!access) return { outcome: 'forbidden' as const };
    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        createdAt: { gte: access.joinedAt },
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: messageSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return { outcome: 'listed' as const, messages };
  }

  markRead(userId: string, conversationId: string, messageId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`conversation-read:${conversationId}:${userId}`}, 0))`,
      );
      const access = await this.getAccess(userId, conversationId, tx);
      if (!access) return { outcome: 'forbidden' as const };
      const message = await tx.message.findFirst({
        where: {
          id: messageId,
          conversationId,
          createdAt: { gte: access.joinedAt },
        },
        select: { id: true, createdAt: true },
      });
      if (!message) return { outcome: 'not_found' as const };
      const currentTime = access.lastReadMessageCreatedAt;
      const currentId = access.lastReadMessageId;
      if (
        currentTime &&
        (message.createdAt < currentTime ||
          (message.createdAt.getTime() === currentTime.getTime() &&
            currentId &&
            message.id.localeCompare(currentId) <= 0))
      ) {
        return { outcome: 'unchanged' as const, access };
      }
      const updated = await tx.conversationMember.update({
        where: { id: access.id },
        data: {
          lastReadMessageId: message.id,
          lastReadMessageCreatedAt: message.createdAt,
          lastReadAt: new Date(),
        },
        select: {
          id: true,
          joinedAt: true,
          lastReadMessageId: true,
          lastReadMessageCreatedAt: true,
          lastReadAt: true,
          conversation: { select: { id: true, familyId: true } },
        },
      });
      return { outcome: 'updated' as const, access: updated };
    });
  }

  async unreadCount(userId: string, conversationId: string) {
    const access = await this.getAccess(userId, conversationId);
    if (!access) return null;
    return this.countUnread(userId, access);
  }

  private getAccess(
    userId: string,
    conversationId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return tx.conversationMember.findFirst({
      where: {
        conversationId,
        userId,
        isActive: true,
        conversation: {
          family: {
            status: 'active',
            members: { some: { userId, status: 'accepted' } },
          },
        },
      },
      select: {
        id: true,
        joinedAt: true,
        lastReadMessageId: true,
        lastReadMessageCreatedAt: true,
        lastReadAt: true,
        conversation: {
          select: {
            id: true,
            familyId: true,
            type: true,
            title: true,
            createdAt: true,
            updatedAt: true,
            messages: {
              select: messageSelect,
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
            },
          },
        },
      },
    });
  }

  private async getManagedGroup(
    actorUserId: string,
    conversationId: string,
    tx: Prisma.TransactionClient | PrismaService,
  ) {
    const conversation = await tx.conversation.findFirst({
      where: {
        id: conversationId,
        type: 'group',
        family: {
          status: 'active',
          members: {
            some: {
              userId: actorUserId,
              role: 'manager',
              status: 'accepted',
            },
          },
        },
      },
      select: { id: true, familyId: true },
    });
    return conversation;
  }

  private listCurrentMembers(conversationId: string, familyId: string) {
    return this.prisma.conversationMember.findMany({
      where: {
        conversationId,
        isActive: true,
        profile: {
          family_members_family_members_user_idToprofiles: {
            some: {
              familyId,
              status: 'accepted',
              family: { status: 'active' },
            },
          },
        },
      },
      select: {
        userId: true,
        joinedAt: true,
        profile: { select: { fullName: true, avatarUrl: true } },
      },
      orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }],
      take: 100,
    });
  }

  private countUnread(userId: string, access: any) {
    return this.prisma.message.count({
      where: {
        conversationId: access.conversation.id,
        senderUserId: { not: userId },
        createdAt: { gte: access.joinedAt },
        ...(access.lastReadMessageCreatedAt
          ? {
              OR: [
                { createdAt: { gt: access.lastReadMessageCreatedAt } },
                {
                  createdAt: access.lastReadMessageCreatedAt,
                  id: { gt: access.lastReadMessageId },
                },
              ],
            }
          : {}),
      },
    });
  }

  private async unreadCounts(userId: string, conversationIds: string[]) {
    if (conversationIds.length === 0) return new Map<string, number>();
    const rows = await this.prisma.$queryRaw<
      Array<{ conversationId: string; count: number }>
    >(Prisma.sql`
      SELECT cm.conversation_id AS "conversationId", count(m.id)::int AS count
      FROM conversation_members cm
      JOIN messages m ON m.conversation_id = cm.conversation_id
      WHERE cm.user_id = ${userId}::uuid
        AND cm.is_active = TRUE
        AND cm.conversation_id IN (${Prisma.join(
          conversationIds.map((id) => Prisma.sql`${id}::uuid`),
        )})
        AND m.sender_id <> ${userId}::uuid
        AND m.created_at >= cm.joined_at
        AND (
          cm.last_read_message_id IS NULL
          OR (m.created_at, m.id) > (
            cm.last_read_message_created_at,
            cm.last_read_message_id
          )
        )
      GROUP BY cm.conversation_id
    `);
    return new Map(rows.map((row) => [row.conversationId, row.count]));
  }

  private async currentParticipants(conversationIds: string[]) {
    if (conversationIds.length === 0) {
      return new Map<
        string,
        Array<{
          userId: string;
          profile: { fullName: string | null; avatarUrl: string | null };
        }>
      >();
    }
    const rows = await this.prisma.$queryRaw<
      Array<{
        conversationId: string;
        userId: string;
        fullName: string | null;
        avatarUrl: string | null;
      }>
    >(Prisma.sql`
      SELECT cm.conversation_id AS "conversationId",
             cm.user_id AS "userId",
             p.full_name AS "fullName",
             p.avatar_url AS "avatarUrl"
      FROM conversation_members cm
      JOIN conversations c ON c.id = cm.conversation_id
      JOIN families f ON f.id = c.family_id AND f.status = 'active'
      JOIN family_members fm
        ON fm.family_id = c.family_id
       AND fm.user_id = cm.user_id
       AND fm.status = 'accepted'
      JOIN profiles p ON p.id = cm.user_id
      WHERE cm.is_active = TRUE
        AND cm.conversation_id IN (${Prisma.join(
          conversationIds.map((id) => Prisma.sql`${id}::uuid`),
        )})
      ORDER BY cm.conversation_id, cm.joined_at, cm.user_id
    `);
    const grouped = new Map<
      string,
      Array<{
        userId: string;
        profile: { fullName: string | null; avatarUrl: string | null };
      }>
    >();
    for (const row of rows) {
      const values = grouped.get(row.conversationId) ?? [];
      values.push({
        userId: row.userId,
        profile: { fullName: row.fullName, avatarUrl: row.avatarUrl },
      });
      grouped.set(row.conversationId, values);
    }
    return grouped;
  }

  private async withRetry<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= CHAT_TRANSACTION_RETRY_LIMIT; attempt++) {
      try {
        return await work();
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2002' || error.code === 'P2034');
        if (!retryable || attempt === CHAT_TRANSACTION_RETRY_LIMIT) throw error;
      }
    }
    throw new Error('Unreachable chat transaction retry state');
  }
}
