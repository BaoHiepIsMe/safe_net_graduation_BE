import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { FamiliesRepository } from '../src/modules/families/families.repository';
import {
  INVITE_CODE_ALPHABET,
  deriveRoleFromLabel,
  invitationCutoff,
  inviteCodeExpiry,
} from '../src/modules/families/families.constants';

// Task 5.3 as an automated run: the real Nest stack (routing, zod pipes,
// guards, throttler, services) over an in-memory repository that mirrors the
// real repository's semantics. It does NOT exercise SQL/Prisma.

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const profiles: Record<string, any> = {
  [A]: { id: A, fullName: 'A', avatarUrl: null, email: 'a@example.com' },
  [B]: { id: B, fullName: 'B', avatarUrl: null, email: 'b@example.com' },
  [C]: { id: C, fullName: 'C', avatarUrl: null, email: 'c@example.com' },
};

class Memory {
  families: any[] = [];
  members: any[] = [];

  private fam(id: string) {
    return this.families.find((f) => f.id === id);
  }

  private view(m: any) {
    return { ...m, profile: profiles[m.userId] };
  }

  createFamilyWithOwner(userId: string, dto: any) {
    const family = {
      id: randomUUID(),
      familyName: dto.familyName,
      ownerUserId: userId,
      avatarUrl: null,
      status: 'active',
      inviteCode: null as string | null,
      inviteCodeExpiresAt: null as Date | null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.families.push(family);
    const membership = this.add(family.id, userId, {
      role: 'manager',
      familyLabel: dto.familyLabel,
      status: 'accepted',
    });
    return Promise.resolve({ family, membership: this.view(membership) });
  }

  private add(familyId: string, userId: string, o: any) {
    const m = {
      id: randomUUID(),
      familyId,
      userId,
      role: o.role,
      familyLabel: o.familyLabel,
      displayName: o.displayName ?? null,
      status: o.status,
      locationSharingEnabled: true,
      invitedAt: new Date(),
      acceptedAt: o.status === 'accepted' ? new Date() : null,
      removedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.members.push(m);
    return m;
  }

  findAccessMembership(userId: string, familyId: string) {
    const m = this.members.find(
      (x) =>
        x.userId === userId &&
        x.familyId === familyId &&
        x.status === 'accepted',
    );
    const family = this.fam(familyId);
    return Promise.resolve(
      m && family?.status === 'active' ? { ...m, family } : null,
    );
  }

  listMembers(familyId: string) {
    const members = this.members
      .filter((m) => m.familyId === familyId && m.status === 'accepted')
      .map((m) => this.view(m));
    return Promise.resolve({ members, total: members.length });
  }

  findMember(familyId: string, id: string) {
    const m = this.members.find((x) => x.id === id && x.familyId === familyId);
    return Promise.resolve(m ? this.view(m) : null);
  }

  findProfileByInvitationTarget(dto: any) {
    const p = Object.values(profiles).find((x) => x.email === dto.email);
    return Promise.resolve(p ? { ...p, accountStatus: 'active' } : null);
  }

  findMembershipForUser(familyId: string, userId: string) {
    const m = this.members.find(
      (x) => x.familyId === familyId && x.userId === userId,
    );
    return Promise.resolve(m ? this.view(m) : null);
  }

  createInvitation(familyId: string, userId: string, actor: string, dto: any) {
    const m = this.add(familyId, userId, { ...dto, status: 'pending' });
    (m as any).invitedByUserId = actor;
    return Promise.resolve(this.view(m));
  }

  renewInvitation(id: string, actor: string, dto: any) {
    const m = this.members.find((x) => x.id === id);
    Object.assign(m, {
      role: dto.role,
      familyLabel: dto.familyLabel,
      status: 'pending',
      invitedAt: new Date(),
      invitedByUserId: actor,
    });
    return Promise.resolve(this.view(m));
  }

  listPendingInvitations(userId: string) {
    const cutoff = invitationCutoff(new Date());
    const invitations = this.members
      .filter(
        (m) =>
          m.userId === userId &&
          m.status === 'pending' &&
          m.invitedAt >= cutoff,
      )
      .map((m) => ({
        ...m,
        family: this.fam(m.familyId),
        inviter: profiles[m.invitedByUserId] ?? null,
      }));
    return Promise.resolve({ invitations, total: invitations.length });
  }

  transitionInvitation(id: string, userId: string, status: string) {
    const m = this.members.find((x) => x.id === id);
    if (!m) return Promise.resolve({ outcome: 'not_found' });
    if (m.userId !== userId) return Promise.resolve({ outcome: 'forbidden' });
    if (m.status !== 'pending') {
      return Promise.resolve({ outcome: 'invalid_state' });
    }
    if (status === 'accepted' && m.invitedAt < invitationCutoff(new Date())) {
      return Promise.resolve({ outcome: 'expired' });
    }
    m.status = status;
    m.acceptedAt = status === 'accepted' ? new Date() : null;
    return Promise.resolve({ outcome: 'updated', membership: this.view(m) });
  }

  updateMemberWithManagerInvariant(_f: string, id: string, dto: any) {
    const m = this.members.find((x) => x.id === id);
    Object.assign(m, dto);
    return Promise.resolve({ outcome: 'updated', member: this.view(m) });
  }

  removeMemberWithManagerInvariant(familyId: string, id: string) {
    const m = this.members.find((x) => x.id === id);
    const managers = this.members.filter(
      (x) =>
        x.familyId === familyId &&
        x.role === 'manager' &&
        x.status === 'accepted',
    );
    if (m.role === 'manager' && managers.length <= 1) {
      return Promise.resolve({ outcome: 'last_manager' });
    }
    m.status = 'removed';
    m.removedAt = new Date();
    return Promise.resolve({ outcome: 'removed' });
  }

  listSentInvitations(familyId: string) {
    const invitations = this.members
      .filter((m) => m.familyId === familyId && m.status === 'pending')
      .map((m) => ({
        ...this.view(m),
        inviter: profiles[m.invitedByUserId],
      }));
    return Promise.resolve({ invitations, total: invitations.length });
  }

  cancelInvitation(familyId: string, id: string) {
    const m = this.members.find((x) => x.id === id && x.familyId === familyId);
    if (!m) return Promise.resolve({ outcome: 'not_found' });
    if (m.status !== 'pending') {
      return Promise.resolve({ outcome: 'invalid_state' });
    }
    m.status = 'removed';
    return Promise.resolve({ outcome: 'cancelled' });
  }

  resendInvitation(familyId: string, id: string, actor: string) {
    const m = this.members.find((x) => x.id === id && x.familyId === familyId);
    if (!m) return Promise.resolve({ outcome: 'not_found' });
    if (m.status !== 'pending') {
      return Promise.resolve({ outcome: 'invalid_state' });
    }
    m.invitedAt = new Date();
    m.invitedByUserId = actor;
    return Promise.resolve({ outcome: 'resent', member: this.view(m) });
  }

  private code() {
    let c = '';
    for (let i = 0; i < 8; i++) {
      c += INVITE_CODE_ALPHABET[Math.floor(Math.random() * 31)];
    }
    return c;
  }

  getOrCreateInviteCode(familyId: string) {
    const f = this.fam(familyId);
    if (f.inviteCode && f.inviteCodeExpiresAt > new Date()) {
      return Promise.resolve({
        code: f.inviteCode,
        expiresAt: f.inviteCodeExpiresAt,
      });
    }
    return this.regenerateInviteCode(familyId);
  }

  regenerateInviteCode(familyId: string) {
    const f = this.fam(familyId);
    let code = this.code();
    while (code === f.inviteCode) code = this.code();
    f.inviteCode = code;
    f.inviteCodeExpiresAt = inviteCodeExpiry(new Date());
    return Promise.resolve({ code, expiresAt: f.inviteCodeExpiresAt });
  }

  joinByInviteCode(userId: string, code: string, dto: any) {
    const family = this.families.find(
      (f) =>
        f.inviteCode === code &&
        f.inviteCodeExpiresAt > new Date() &&
        f.status === 'active',
    );
    if (!family) return Promise.resolve({ outcome: 'invalid_code' });
    const existing = this.members.find(
      (m) => m.familyId === family.id && m.userId === userId,
    );
    if (existing?.status === 'accepted') {
      return Promise.resolve({ outcome: 'already_member' });
    }
    const data = {
      role: deriveRoleFromLabel(dto.familyLabel),
      familyLabel: dto.familyLabel,
      displayName: dto.displayName ?? null,
      status: 'accepted',
    };
    let m = existing;
    if (m) Object.assign(m, data, { acceptedAt: new Date(), removedAt: null });
    else m = this.add(family.id, userId, data);
    return Promise.resolve({
      outcome: 'joined',
      family,
      membership: this.view(m),
    });
  }

  transferOwnership(familyId: string, owner: string, memberId: string) {
    const f = this.fam(familyId);
    if (f.ownerUserId !== owner)
      return Promise.resolve({ outcome: 'not_owner' });
    const t = this.members.find(
      (x) => x.id === memberId && x.familyId === familyId,
    );
    if (
      !t ||
      t.status !== 'accepted' ||
      t.userId === owner ||
      (t.role !== 'adult' && t.role !== 'manager')
    ) {
      return Promise.resolve({ outcome: 'invalid_target' });
    }
    t.role = 'manager';
    f.ownerUserId = t.userId;
    return Promise.resolve({ outcome: 'transferred', family: f });
  }
}

describe('Task 5.3 family flow over HTTP (e2e, in-memory repository)', () => {
  let app: INestApplication<App>;
  const repo = new Memory();
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const http = () => request(app.getHttpServer());
  const errCode = (res: request.Response) => res.body.error?.code;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseService)
      .useValue({
        verifyToken: jest.fn((token: string) => {
          const ids: Record<string, string> = { a: A, b: B, c: C };
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
      .useValue(repo)
      .compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('create -> code -> join -> leave/transfer rules -> leave', async () => {
    // 1. A creates a family
    const created = await http()
      .post('/api/v1/families')
      .set(as('a'))
      .send({ familyName: 'Nhà An', familyLabel: 'father' })
      .expect(201);
    const fid = created.body.data.id as string;
    expect(created.body.data.membership.role).toBe('manager');

    // 2. A gets the invite code; asking again returns the same one
    const code1 = await http()
      .get(`/api/v1/families/${fid}/invite-code`)
      .set(as('a'))
      .expect(200);
    const code = code1.body.data.code as string;
    expect(code).toMatch(new RegExp(`^[${INVITE_CODE_ALPHABET}]{8}$`));
    const again = await http()
      .get(`/api/v1/families/${fid}/invite-code`)
      .set(as('a'))
      .expect(200);
    expect(again.body.data.code).toBe(code);

    // a non-member cannot read it
    const denied = await http()
      .get(`/api/v1/families/${fid}/invite-code`)
      .set(as('b'))
      .expect(403);
    expect(errCode(denied)).toBe('FAMILY_ACCESS_DENIED');

    // 3. B joins with a lowercase, padded code as a daughter -> child
    const joined = await http()
      .post('/api/v1/families/join')
      .set(as('b'))
      .send({ code: ` ${code.toLowerCase()} `, familyLabel: 'daughter' })
      .expect(201);
    expect(joined.body.data.membership.role).toBe('child');
    const dup = await http()
      .post('/api/v1/families/join')
      .set(as('b'))
      .send({ code, familyLabel: 'daughter' })
      .expect(409);
    expect(errCode(dup)).toBe('FAMILY_MEMBER_ALREADY_EXISTS');

    // a non-manager cannot see the code now either
    await http()
      .get(`/api/v1/families/${fid}/invite-code`)
      .set(as('b'))
      .expect(403);

    // 4. a child cannot leave
    const childLeave = await http()
      .post(`/api/v1/families/${fid}/leave`)
      .set(as('b'))
      .expect(403);
    expect(errCode(childLeave)).toBe('CHILD_CANNOT_LEAVE_FAMILY');

    // 5. regenerate -> new code; 6. the old one no longer works
    const regen = await http()
      .post(`/api/v1/families/${fid}/invite-code/regenerate`)
      .set(as('a'))
      .expect(200);
    expect(regen.body.data.code).not.toBe(code);
    const stale = await http()
      .post('/api/v1/families/join')
      .set(as('c'))
      .send({ code, familyLabel: 'other' })
      .expect(404);
    expect(errCode(stale)).toBe('FAMILY_INVITE_CODE_INVALID');

    // 7. invite C by email without a role: grandmother -> elder
    const invite = await http()
      .post(`/api/v1/families/${fid}/invitations`)
      .set(as('a'))
      .send({ email: 'c@example.com', familyLabel: 'grandmother' })
      .expect(201);
    expect(invite.body.data.role).toBe('elder');
    const invitationId = invite.body.data.id as string;

    // 8. A sees it with expiry info; B (non-manager) cannot
    const sent = await http()
      .get(`/api/v1/families/${fid}/invitations`)
      .set(as('a'))
      .expect(200);
    expect(sent.body.data).toHaveLength(1);
    expect(sent.body.data[0]).toMatchObject({ isExpired: false });
    expect(sent.body.data[0].expiresAt).toBeTruthy();
    await http()
      .get(`/api/v1/families/${fid}/invitations`)
      .set(as('b'))
      .expect(403);

    // cancel -> C no longer sees it; invite again; resend keeps it valid
    await http()
      .delete(`/api/v1/families/${fid}/invitations/${invitationId}`)
      .set(as('a'))
      .expect(204);
    const none = await http()
      .get('/api/v1/families/invitations/pending')
      .set(as('c'))
      .expect(200);
    expect(none.body.data).toHaveLength(0);
    await http()
      .post(`/api/v1/families/${fid}/invitations`)
      .set(as('a'))
      .send({ email: 'c@example.com', familyLabel: 'grandmother' })
      .expect(201);
    await http()
      .post(`/api/v1/families/${fid}/invitations/${invitationId}/resend`)
      .set(as('a'))
      .expect(200);

    // 9. C accepts
    const pending = await http()
      .get('/api/v1/families/invitations/pending')
      .set(as('c'))
      .expect(200);
    expect(pending.body.data).toHaveLength(1);
    expect(pending.body.data[0].expiresAt).toBeTruthy();
    await http()
      .post(`/api/v1/families/invitations/${invitationId}/accept`)
      .set(as('c'))
      .expect(200);

    // 10. transfer to a child is refused
    const members = await http()
      .get(`/api/v1/families/${fid}/members`)
      .set(as('a'))
      .expect(200);
    const memberB = members.body.data.find((m: any) => m.userId === B).id;
    const badTransfer = await http()
      .post(`/api/v1/families/${fid}/transfer-ownership`)
      .set(as('a'))
      .send({ memberId: memberB })
      .expect(422);
    expect(errCode(badTransfer)).toBe('OWNERSHIP_TRANSFER_TARGET_INVALID');
    // a non-owner cannot transfer at all
    await http()
      .post(`/api/v1/families/${fid}/transfer-ownership`)
      .set(as('b'))
      .send({ memberId: memberB })
      .expect(403);

    // 11. promote B to adult, transfer works
    await http()
      .patch(`/api/v1/families/${fid}/members/${memberB}`)
      .set(as('a'))
      .send({ role: 'adult' })
      .expect(200);
    const ok = await http()
      .post(`/api/v1/families/${fid}/transfer-ownership`)
      .set(as('a'))
      .send({ memberId: memberB })
      .expect(200);
    expect(ok.body.data.ownerUserId).toBe(B);

    // 12. the old owner (still manager) can now leave
    await http().post(`/api/v1/families/${fid}/leave`).set(as('a')).expect(204);
    await http().get(`/api/v1/families/${fid}`).set(as('a')).expect(403);
  });

  it('rejects malformed join and transfer bodies with 400', async () => {
    await http()
      .post('/api/v1/families/join')
      .set(as('b'))
      .send({ code: '', familyLabel: 'other' })
      .expect(400);
    await http()
      .post(`/api/v1/families/${randomUUID()}/transfer-ownership`)
      .set(as('a'))
      .send({ memberId: 'x' })
      .expect(400);
  });

  // Last: it exhausts the join rate limit for this IP.
  it('13. joining is throttled harder than the global limit (429)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await http()
        .post('/api/v1/families/join')
        .set(as('c'))
        .send({ code: 'NOPE2345', familyLabel: 'other' });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
    expect(statuses.slice(0, 3).every((s) => s === 404)).toBe(true);
  });
});
