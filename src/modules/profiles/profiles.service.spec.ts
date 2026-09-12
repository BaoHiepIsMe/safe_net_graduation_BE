import { Test, TestingModule } from '@nestjs/testing';
import { ProfilesService } from './profiles.service';
import { ProfilesRepository } from './profiles.repository';
import { NotFoundError } from '../../common/errors/app.error';

describe('ProfilesService', () => {
  let service: ProfilesService;
  let mockRepository: any;

  beforeEach(async () => {
    mockRepository = {
      findProfileById: jest.fn(),
      updateProfile: jest.fn(),
      findSettingsByUserId: jest.fn(),
      updateSettings: jest.fn(),
      findBiometricSettingsByUserId: jest.fn(),
      updateBiometricSettings: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfilesService,
        {
          provide: ProfilesRepository,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<ProfilesService>(ProfilesService);
  });

  it('should get mapped profile when user exists', async () => {
    mockRepository.findProfileById.mockResolvedValue({
      id: 'usr-1',
      fullName: 'Bob Caregiver',
      avatarUrl: 'https://example.com/avatar.png',
      accountStatus: 'active',
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z',
    });

    const result = await service.getProfile('usr-1');
    expect(result.id).toBe('usr-1');
    expect(result.fullName).toBe('Bob Caregiver');
    expect(result.avatarUrl).toBe('https://example.com/avatar.png');
  });

  it('should throw NotFoundError when profile is missing', async () => {
    mockRepository.findProfileById.mockResolvedValue(null);

    await expect(service.getProfile('non-existent')).rejects.toThrow(
      NotFoundError,
    );
  });
});
