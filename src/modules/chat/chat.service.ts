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
import { MESSAGE_CREATED_EVENT } from './chat.constants';
import { ChatRepository } from './chat.repository';
import type {
  ChatListQueryDto,
  CreateGroupDto,
  SendMessageDto,
} from './dto/chat.dto';

const cursorSchema = z
  .tuple([z.iso.datetime({ offset: true }), z.string().uuid()])
  .transform(([createdAt, id]) => ({ createdAt: new Date(createdAt), id }));

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly repository: ChatRepository,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async createDirect(userId: string, familyId: string, targetMemberId: string) {
    const result = await this.repository.getOrCreateDirect(
      userId,
      familyId,
      targetMemberId,
    );
    if (result.outcome === 'forbidden') this.accessDenied();
    if (result.outcome === 'self') {
      throw new BusinessRuleError(
        ErrorCode.DIRECT_CONVERSATION_CONFLICT,
        'A direct conversation requires another accepted family member',
      );
    }
    return {
      conversation: await this.detail(userId, result.conversationId),
      created: result.outcome === 'created',
    };
  }

  async createGroup(userId: string, familyId: string, dto: CreateGroupDto) {
    const result = await this.repository.createGroup(userId, familyId, dto);
    if (result.outcome === 'forbidden') this.accessDenied();
    if (result.outcome === 'invalid_target') this.invalidMember();
    return this.detail(userId, result.conversationId);
  }

  async list(userId: string, query: ChatListQueryDto) {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.repository.listVisible(userId, query, cursor);
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1)?.conversation;
    return {
      data: page.map((row) =>
        this.mapConversation(row.conversation, row.unreadCount),
      ),
      pagination: {
        limit: query.limit,
        hasMore,
        nextCursor:
          hasMore && last ? this.encodeCursor(last.updatedAt, last.id) : null,
      },
    };
  }

  async detail(userId: string, conversationId: string) {
    const result = await this.repository.detail(userId, conversationId);
    if (!result) this.notFound();
    return this.mapConversation(
      { ...result.access.conversation, members: result.members },
      result.unreadCount,
    );
  }

  async members(userId: string, conversationId: string) {
    const members = await this.repository.listMembers(userId, conversationId);
    if (!members) this.notFound();
    return { data: members.map((member) => this.mapMember(member)) };
  }

  async addMember(userId: string, conversationId: string, memberId: string) {
    const result = await this.repository.addGroupMember(
      userId,
      conversationId,
      memberId,
    );
    if (result.outcome === 'forbidden') this.accessDenied();
    if (result.outcome === 'invalid_target') this.invalidMember();
    if (result.outcome === 'exists') {
      throw new ConflictError(
        'Conversation member already exists',
        ErrorCode.CONVERSATION_MEMBER_ALREADY_EXISTS,
      );
    }
    return this.members(userId, conversationId);
  }

  async removeMember(userId: string, conversationId: string, memberId: string) {
    const result = await this.repository.removeGroupMember(
      userId,
      conversationId,
      memberId,
    );
    if (result.outcome === 'forbidden') this.accessDenied();
    if (result.outcome === 'invalid_target') this.invalidMember();
    if (result.outcome === 'not_found') {
      throw new NotFoundError(
        'Conversation member not found',
        ErrorCode.CONVERSATION_MEMBER_NOT_FOUND,
      );
    }
  }

  async send(userId: string, conversationId: string, dto: SendMessageDto) {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ conversationId, content: dto.content }))
      .digest('hex');
    const result = await this.repository.sendMessage(
      userId,
      conversationId,
      dto,
      fingerprint,
    );
    if (result.outcome === 'forbidden') this.accessDenied();
    if (result.outcome === 'conflict') {
      throw new ConflictError(
        'The client message ID was already used with different content',
        ErrorCode.MESSAGE_IDEMPOTENCY_CONFLICT,
      );
    }
    const message = this.mapMessage(result.message);
    if (result.outcome === 'created') {
      const resolved = await this.repository.resolveMessageRecipients(
        result.message.id,
      );
      for (const recipientUserId of resolved?.recipientUserIds ?? []) {
        try {
          this.realtime.emitToUser(
            recipientUserId,
            MESSAGE_CREATED_EVENT,
            message,
          );
        } catch {
          this.logger.warn('Realtime message delivery failed');
        }
      }
      try {
        await this.notifications.processMessage(result.message.id);
      } catch {
        this.logger.warn(
          'Message notification delivery failed after message commit',
        );
      }
    }
    return { ...message, created: result.outcome === 'created' };
  }

  async history(
    userId: string,
    conversationId: string,
    query: ChatListQueryDto,
  ) {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const result = await this.repository.history(
      userId,
      conversationId,
      query,
      cursor,
    );
    if (result.outcome === 'forbidden') this.notFound();
    const hasMore = result.messages.length > query.limit;
    const page = hasMore
      ? result.messages.slice(0, query.limit)
      : result.messages;
    const last = page.at(-1);
    return {
      data: page.map((message) => this.mapMessage(message)),
      pagination: {
        limit: query.limit,
        hasMore,
        nextCursor:
          hasMore && last ? this.encodeCursor(last.createdAt, last.id) : null,
      },
    };
  }

  async markRead(userId: string, conversationId: string, messageId: string) {
    const result = await this.repository.markRead(
      userId,
      conversationId,
      messageId,
    );
    if (result.outcome === 'forbidden') this.notFound();
    if (result.outcome === 'not_found') {
      throw new NotFoundError('Message not found', ErrorCode.MESSAGE_NOT_FOUND);
    }
    const access = result.access;
    return {
      conversationId,
      lastReadMessageId: access.lastReadMessageId,
      lastReadAt: access.lastReadAt,
      updated: result.outcome === 'updated',
    };
  }

  async unreadCount(userId: string, conversationId: string) {
    const count = await this.repository.unreadCount(userId, conversationId);
    if (count === null) this.notFound();
    return { count };
  }

  private mapConversation(row: any, unreadCount: number) {
    return {
      id: row.id,
      familyId: row.familyId,
      type: row.type,
      title: row.title,
      participants: (row.members ?? []).map((member: any) =>
        this.mapMember(member),
      ),
      latestMessage: row.messages?.[0]
        ? this.mapMessage(row.messages[0])
        : null,
      unreadCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapMember(member: any) {
    return {
      userId: member.userId,
      fullName: member.profile.fullName,
      avatarUrl: member.profile.avatarUrl,
      joinedAt: member.joinedAt ?? null,
    };
  }

  private mapMessage(row: any) {
    return {
      id: row.id,
      conversationId: row.conversationId,
      type: 'text',
      content: row.content,
      sender: {
        id: row.sender.id,
        fullName: row.sender.fullName,
        avatarUrl: row.sender.avatarUrl,
      },
      createdAt: row.createdAt,
    };
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
        [{ path: ['cursor'], message: 'Invalid chat cursor' }],
        'Invalid cursor',
      );
    }
  }

  private notFound(): never {
    throw new NotFoundError(
      'Conversation not found',
      ErrorCode.CONVERSATION_NOT_FOUND,
    );
  }

  private accessDenied(): never {
    throw new NotFoundError(
      'Conversation not found',
      ErrorCode.CONVERSATION_NOT_FOUND,
    );
  }

  private invalidMember(): never {
    throw new BusinessRuleError(
      ErrorCode.CONVERSATION_INVALID_STATE,
      'Conversation members must be current accepted members of the active family',
    );
  }
}
