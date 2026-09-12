import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { FamiliesRepository } from '../src/modules/families/families.repository';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';
const FAMILY_ID = '44444444-4444-4444-8444-444444444444';
const MEMBER_A = '55555555-5555-4555-8555-555555555555';
const MEMBER_B = '66666666-6666-4666-8666-666666666666';

const profiles = {
  [USER_A]: { id: USER_A, fullName: 'User A', avatarUrl: null },
  [USER_B]: { id: USER_B, fullName: 'User B', avatarUrl: null },
  [USER_C]: { id: USER_C, fullName: 'User C', avatarUrl: null },
};

class InMemoryFamiliesRepository {
  family: any = null;
  members: any[] = [];

  createFamilyWithOwner(userId: string, dto: any) {
    const now = new Date();
    this.family = {
      id: FAMILY_ID,
      familyName: dto.familyName,
      ownerUserId: userId,
      avatarUrl: dto.avatarUrl ?? null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    const membership = this.member({
      id: MEMBER_A,
      userId,
      role: 'manager',
      familyLabel: dto.familyLabel,
      status: 'accepted',
      acceptedAt: now,
    });
    this.members.push(membership);
    return Promise.resolve({ family: this.family, membership });
  }

  findAccessMembership(userId: string, familyId: string) {
    const membership = this.members.find(
      (item) =>
        item.userId === userId &&
        item.familyId === familyId &&
        item.status === 'accepted' &&
        this.family?.status === 'active',
    );
    return Promise.resolve(
      membership
        ? {
            id: membership.id,
            userId,
            familyId,
            role: membership.role,
            familyLabel: membership.familyLabel,
            family: this.family,
          }
        : null,
    );
  }

  listFamilies(userId: string) {
    const membership = this.members.find(
      (item) => item.userId === userId && item.status === 'accepted',
    );
    return Promise.resolve({
      memberships: membership
        ? [
            {
              role: membership.role,
              familyLabel: membership.familyLabel,
              family: this.family,
            },
          ]
        : [],
      total: membership ? 1 : 0,
    });
  }

  updateFamily(_familyId: string, dto: any) {
    this.family = { ...this.family, ...dto, updatedAt: new Date() };
    return Promise.resolve(this.family);
  }

  archiveFamily() {
    this.family.status = 'archived';
    return Promise.resolve({ id: FAMILY_ID });
  }

  listMembers() {
    const members = this.members.filter((item) => item.status === 'accepted');
    return Promise.resolve({ members, total: members.length });
  }

  findMember(familyId: string, memberId: string) {
    return Promise.resolve(
      this.members.find(
        (item) => item.familyId === familyId && item.id === memberId,
      ) ?? null,
    );
  }

  findProfileByInvitationTarget(dto: any) {
    if (dto.email === 'userb@example.com') {
      return Promise.resolve({ ...profiles[USER_B], accountStatus: 'active' });
    }
    return Promise.resolve(null);
  }

  findMembershipForUser(familyId: string, userId: string) {
    return Promise.resolve(
      this.members.find(
        (item) => item.familyId === familyId && item.userId === userId,
      ) ?? null,
    );
  }

  createInvitation(
    _familyId: string,
    userId: string,
    _actorUserId: string,
    dto: any,
  ) {
    const invitation = this.member({
      id: MEMBER_B,
      userId,
      role: dto.role,
      familyLabel: dto.familyLabel,
      status: 'pending',
      acceptedAt: null,
    });
    this.members.push(invitation);
    return Promise.resolve(invitation);
  }

  renewInvitation(id: string, _actorUserId: string, dto: any) {
    const invitation = this.members.find((item) => item.id === id);
    Object.assign(invitation, {
      role: dto.role,
      familyLabel: dto.familyLabel,
      status: 'pending',
    });
    return Promise.resolve(invitation);
  }

  listPendingInvitations(userId: string) {
    const invitations = this.members
      .filter((item) => item.userId === userId && item.status === 'pending')
      .map((item) => ({
        ...item,
        family: this.family,
        inviter: profiles[USER_A],
      }));
    return Promise.resolve({ invitations, total: invitations.length });
  }

  transitionInvitation(id: string, userId: string, status: string) {
    const invitation = this.members.find((item) => item.id === id);
    if (!invitation) return Promise.resolve({ outcome: 'not_found' });
    if (invitation.userId !== userId) {
      return Promise.resolve({ outcome: 'forbidden' });
    }
    if (invitation.status !== 'pending') {
      return Promise.resolve({ outcome: 'invalid_state' });
    }
    invitation.status = status;
    invitation.acceptedAt = status === 'accepted' ? new Date() : null;
    return Promise.resolve({ outcome: 'updated', membership: invitation });
  }

  updateMemberWithManagerInvariant(_familyId: string, id: string, dto: any) {
    const target = this.members.find((item) => item.id === id);
    Object.assign(target, dto);
    return Promise.resolve({ outcome: 'updated', member: target });
  }

  removeMemberWithManagerInvariant(_familyId: string, id: string) {
    const target = this.members.find((item) => item.id === id);
    target.status = 'removed';
    return Promise.resolve({ outcome: 'removed' });
  }

  private member(overrides: any) {
    const now = new Date();
    const userId = overrides.userId as keyof typeof profiles;
    return {
      id: overrides.id,
      familyId: FAMILY_ID,
      userId,
      role: overrides.role,
      familyLabel: overrides.familyLabel,
      displayName: null,
      status: overrides.status,
      locationSharingEnabled: true,
      invitedAt: now,
      acceptedAt: overrides.acceptedAt,
      removedAt: null,
      createdAt: now,
      updatedAt: now,
      profile: profiles[userId],
    };
  }
}

describe('Phase 2 Families (e2e)', () => {
  let app: INestApplication<App>;
  const repository = new InMemoryFamiliesRepository();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseService)
      .useValue({
        verifyToken: jest.fn((token: string) => {
          const ids: Record<string, string> = {
            'token-a': USER_A,
            'token-b': USER_B,
            'token-c': USER_C,
          };
          return Promise.resolve(ids[token] ? { id: ids[token] } : null);
        }),
      })
      .overrideProvider(PrismaService)
      .useValue({
        profile: { findFirst: jest.fn(), findUnique: jest.fn() },
        familyMember: { findFirst: jest.fn() },
        conversationMember: { findFirst: jest.fn() },
      })
      .overrideProvider(FamiliesRepository)
      .useValue(repository)
      .compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  it('enforces the complete create, invite, accept and removal access flow', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/families')
      .set(auth('token-a'))
      .send({ familyName: 'Gia đình An', familyLabel: 'caregiver' })
      .expect(201);
    expect(created.body.data.membership).toMatchObject({
      role: 'manager',
      status: 'accepted',
    });

    await request(app.getHttpServer())
      .get(`/api/v1/families/${FAMILY_ID}`)
      .set(auth('token-b'))
      .expect(403);

    const invited = await request(app.getHttpServer())
      .post(`/api/v1/families/${FAMILY_ID}/invitations`)
      .set(auth('token-a'))
      .send({
        email: 'userb@example.com',
        familyLabel: 'other',
        role: 'adult',
      })
      .expect(201);
    expect(invited.body.data.status).toBe('pending');

    const pending = await request(app.getHttpServer())
      .get('/api/v1/families/invitations/pending')
      .set(auth('token-b'))
      .expect(200);
    expect(pending.body.data).toHaveLength(1);

    await request(app.getHttpServer())
      .post(`/api/v1/families/invitations/${MEMBER_B}/accept`)
      .set(auth('token-b'))
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/families/${FAMILY_ID}`)
      .set(auth('token-b'))
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/families/${FAMILY_ID}`)
      .set(auth('token-c'))
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/v1/families/${FAMILY_ID}`)
      .set(auth('token-b'))
      .send({ familyName: 'Unauthorized' })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/families/${FAMILY_ID}/members/${MEMBER_B}`)
      .set(auth('token-a'))
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/families/${FAMILY_ID}`)
      .set(auth('token-b'))
      .expect(403);
  });

  it('rejects malformed IDs, invalid roles and unknown fields', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/families/not-a-uuid')
      .set(auth('token-a'))
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/families/${FAMILY_ID}/invitations`)
      .set(auth('token-a'))
      .send({
        email: 'userb@example.com',
        familyLabel: 'other',
        role: 'manager',
      })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/families/${FAMILY_ID}/members/${MEMBER_A}`)
      .set(auth('token-a'))
      .send({ status: 'removed' })
      .expect(400);
  });

  afterAll(async () => {
    await app.close();
  });
});
