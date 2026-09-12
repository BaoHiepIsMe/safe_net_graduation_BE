import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service';

const uuidSchema = z.string().uuid();
const supportedRoomTypes = ['user', 'family', 'member', 'chat'] as const;
type RoomType = (typeof supportedRoomTypes)[number];

export interface AuthorizedRoom {
  type: RoomType;
  resourceId: string;
  name: string;
}

@Injectable()
export class RealtimeRoomAuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async authorize(
    userId: string,
    room: unknown,
  ): Promise<AuthorizedRoom | null> {
    const parsed = this.parseRoom(room);
    if (!parsed) return null;

    let allowed = false;
    switch (parsed.type) {
      case 'user':
        allowed = parsed.resourceId === userId;
        break;
      case 'family':
        allowed = await this.hasAcceptedFamilyMembership(
          userId,
          parsed.resourceId,
        );
        break;
      case 'member':
        allowed = await this.canAccessMember(userId, parsed.resourceId);
        break;
      case 'chat':
        allowed = await this.hasConversationMembership(
          userId,
          parsed.resourceId,
        );
        break;
    }

    return allowed ? parsed : null;
  }

  private parseRoom(room: unknown): AuthorizedRoom | null {
    if (typeof room !== 'string' || room.length > 128) return null;
    const parts = room.split(':');
    if (parts.length !== 2) return null;

    const [type, resourceId] = parts;
    if (!supportedRoomTypes.includes(type as RoomType)) return null;
    if (!uuidSchema.safeParse(resourceId).success) return null;

    return { type: type as RoomType, resourceId, name: room };
  }

  private async hasAcceptedFamilyMembership(
    userId: string,
    familyId: string,
  ): Promise<boolean> {
    const membership = await this.prisma.familyMember.findFirst({
      where: {
        familyId,
        userId,
        status: 'accepted',
        family: { status: 'active' },
      },
      select: { id: true },
    });
    return Boolean(membership);
  }

  private async canAccessMember(
    userId: string,
    memberId: string,
  ): Promise<boolean> {
    const member = await this.prisma.familyMember.findFirst({
      where: { id: memberId, status: 'accepted' },
      select: { familyId: true },
    });
    if (!member) return false;
    return this.hasAcceptedFamilyMembership(userId, member.familyId);
  }

  private async hasConversationMembership(
    userId: string,
    conversationId: string,
  ): Promise<boolean> {
    const membership = await this.prisma.conversationMember.findFirst({
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
      select: { id: true },
    });
    return Boolean(membership);
  }
}
