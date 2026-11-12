import { Test } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ProfilesRepository } from './profiles.repository';

describe('ProfilesRepository', () => {
  let repository: ProfilesRepository;
  const update = jest.fn().mockResolvedValue({});
  const upsert = jest.fn().mockResolvedValue({});

  beforeEach(async () => {
    update.mockClear();
    upsert.mockClear();
    const module = await Test.createTestingModule({
      providers: [
        ProfilesRepository,
        {
          provide: PrismaService,
          useValue: { profile: { update }, userSetting: { upsert } },
        },
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

  it.each([
    [{ theme: 'dark' as const }, { theme: 'dark', darkMode: true }],
    [{ darkMode: true }, { theme: 'dark', darkMode: true }],
    [{ darkMode: false }, { theme: 'light', darkMode: false }],
    [
      { theme: 'system' as const, darkMode: true },
      { theme: 'system', darkMode: false },
    ],
    [{ language: 'en' as const }, { theme: undefined, darkMode: undefined }],
  ])('derives theme/darkMode from %j', async (dto, expected) => {
    await repository.updateSettings('user-id', dto);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining(expected),
      }),
    );
  });
});
