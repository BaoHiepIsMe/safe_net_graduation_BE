import { FamilyAccessService } from './family-access.service';
import { FamiliesRepository } from './families.repository';
import { ForbiddenError } from '../../common/errors/app.error';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FAMILY_ID = '22222222-2222-4222-8222-222222222222';

describe('FamilyAccessService', () => {
  it('allows an accepted member', async () => {
    const repository = {
      findAccessMembership: jest.fn().mockResolvedValue({ role: 'adult' }),
    } as unknown as FamiliesRepository;
    await expect(
      new FamilyAccessService(repository).requireAcceptedMember(
        USER_ID,
        FAMILY_ID,
      ),
    ).resolves.toMatchObject({ role: 'adult' });
  });

  it.each(['foreign', 'pending', 'rejected', 'removed'])(
    'denies %s users without an accepted access row',
    async () => {
      const repository = {
        findAccessMembership: jest.fn().mockResolvedValue(null),
      } as unknown as FamiliesRepository;
      await expect(
        new FamilyAccessService(repository).requireAcceptedMember(
          USER_ID,
          FAMILY_ID,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    },
  );

  it('denies a non-manager from manager actions', async () => {
    const repository = {
      findAccessMembership: jest.fn().mockResolvedValue({ role: 'adult' }),
    } as unknown as FamiliesRepository;
    await expect(
      new FamilyAccessService(repository).requireManager(USER_ID, FAMILY_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('denies a non-owner manager from archiving the family', async () => {
    const repository = {
      findAccessMembership: jest.fn().mockResolvedValue({
        role: 'manager',
        family: { ownerUserId: 'another-user' },
      }),
    } as unknown as FamiliesRepository;
    await expect(
      new FamilyAccessService(repository).requireOwner(USER_ID, FAMILY_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
