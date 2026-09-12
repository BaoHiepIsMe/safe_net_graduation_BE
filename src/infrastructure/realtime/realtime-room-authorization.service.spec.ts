import { RealtimeRoomAuthorizationService } from './realtime-room-authorization.service';
import { PrismaService } from '../database/prisma.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FOREIGN_USER_ID = '22222222-2222-4222-8222-222222222222';
const FAMILY_ID = '33333333-3333-4333-8333-333333333333';
const MEMBER_ID = '44444444-4444-4444-8444-444444444444';
const CHAT_ID = '55555555-5555-4555-8555-555555555555';

function createService(...results: Array<{ data: any; error: any }>) {
  const findFirst = jest.fn();
  for (const result of results) findFirst.mockResolvedValueOnce(result.data);
  const prisma = {
    familyMember: { findFirst },
    conversationMember: { findFirst },
  } as unknown as PrismaService;
  return new RealtimeRoomAuthorizationService(prisma);
}

describe('RealtimeRoomAuthorizationService', () => {
  it('allows only the caller personal room', async () => {
    const service = createService();
    await expect(
      service.authorize(USER_ID, `user:${USER_ID}`),
    ).resolves.toEqual(expect.objectContaining({ type: 'user' }));
    await expect(
      service.authorize(USER_ID, `user:${FOREIGN_USER_ID}`),
    ).resolves.toBeNull();
  });

  it('allows an accepted family membership', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'membership' });
    const service = new RealtimeRoomAuthorizationService({
      familyMember: { findFirst },
      conversationMember: { findFirst: jest.fn() },
    } as unknown as PrismaService);
    await expect(
      service.authorize(USER_ID, `family:${FAMILY_ID}`),
    ).resolves.toEqual(expect.objectContaining({ type: 'family' }));
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        familyId: FAMILY_ID,
        userId: USER_ID,
        status: 'accepted',
        family: { status: 'active' },
      },
      select: { id: true },
    });
  });

  it('denies a foreign family', async () => {
    const service = createService({ data: null, error: null });
    await expect(
      service.authorize(USER_ID, `family:${FAMILY_ID}`),
    ).resolves.toBeNull();
  });

  it('allows access to an accepted member in the caller family', async () => {
    const service = createService(
      { data: { familyId: FAMILY_ID }, error: null },
      { data: { id: 'requester-membership' }, error: null },
    );
    await expect(
      service.authorize(USER_ID, `member:${MEMBER_ID}`),
    ).resolves.toEqual(expect.objectContaining({ type: 'member' }));
  });

  it('denies a foreign-family member', async () => {
    const service = createService(
      { data: { familyId: FAMILY_ID }, error: null },
      { data: null, error: null },
    );
    await expect(
      service.authorize(USER_ID, `member:${MEMBER_ID}`),
    ).resolves.toBeNull();
  });

  it('allows only conversations containing the caller', async () => {
    const allowed = createService({ data: { id: 'membership' }, error: null });
    const denied = createService({ data: null, error: null });
    await expect(
      allowed.authorize(USER_ID, `chat:${CHAT_ID}`),
    ).resolves.toEqual(expect.objectContaining({ type: 'chat' }));
    await expect(
      denied.authorize(USER_ID, `chat:${CHAT_ID}`),
    ).resolves.toBeNull();
  });

  it('requires active chat membership plus current accepted active-family membership', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'membership' });
    const service = new RealtimeRoomAuthorizationService({
      familyMember: { findFirst: jest.fn() },
      conversationMember: { findFirst },
    } as unknown as PrismaService);
    await service.authorize(USER_ID, `chat:${CHAT_ID}`);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        conversationId: CHAT_ID,
        userId: USER_ID,
        isActive: true,
        conversation: {
          family: {
            status: 'active',
            members: { some: { userId: USER_ID, status: 'accepted' } },
          },
        },
      },
      select: { id: true },
    });
  });

  it.each([
    ['missing separator', 'family'],
    ['malformed UUID', 'family:not-a-uuid'],
    ['extra segment', `family:${FAMILY_ID}:extra`],
    ['unknown type', `other:${FAMILY_ID}`],
  ])('denies malformed room: %s', async (_case, room) => {
    await expect(createService().authorize(USER_ID, room)).resolves.toBeNull();
  });
});
