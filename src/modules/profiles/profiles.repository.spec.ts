import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ProfilesRepository } from './profiles.repository';

describe('ProfilesRepository calendar dates', () => {
  let repository: ProfilesRepository;
  const update = jest.fn().mockResolvedValue({});

  beforeEach(async () => {
    update.mockClear();
    const module = await Test.createTestingModule({
      providers: [
        ProfilesRepository,
        { provide: PrismaService, useValue: { profile: { update } } },
      ],
    }).compile();
    repository = module.get(ProfilesRepository);
  });

  it('converts a leap-day birthday to the Date value required by Prisma', async () => {
    await repository.updateProfile('user-id', { dateOfBirth: '2000-02-29' });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dateOfBirth: new Date('2000-02-29T00:00:00.000Z'),
        }),
      }),
    );
  });

  it('preserves null to explicitly clear the birthday', async () => {
    await repository.updateProfile('user-id', { dateOfBirth: null });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dateOfBirth: null }),
      }),
    );
  });

  it('leaves the birthday unchanged when updating another profile field', async () => {
    await repository.updateProfile('user-id', { fullName: 'Safe User' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dateOfBirth: undefined }),
      }),
    );
  });
});
