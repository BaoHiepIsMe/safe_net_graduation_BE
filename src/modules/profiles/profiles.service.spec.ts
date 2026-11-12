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
      role: 'guardian',
      accountStatus: 'active',
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z',
    });

    const result = await service.getProfile('usr-1');
    expect(result.id).toBe('usr-1');
    expect(result.fullName).toBe('Bob Caregiver');
    expect(result.avatarUrl).toBe('https://example.com/avatar.png');
    expect(result.role).toBe('guardian');
  });

  it('should throw NotFoundError when profile is missing', async () => {
    mockRepository.findProfileById.mockResolvedValue(null);

    await expect(service.getProfile('non-existent')).rejects.toThrow(
      NotFoundError,
    );
  });

  it('returns a database birthday as a calendar date without a time or timezone', async () => {
    mockRepository.findProfileById.mockResolvedValue({
      id: 'usr-1',
      dateOfBirth: new Date('2000-02-29T00:00:00.000Z'),
    });
    await expect(service.getProfile('usr-1')).resolves.toMatchObject({
      dateOfBirth: '2000-02-29',
    });
  });

  it('returns the calendar date after a profile update', async () => {
    mockRepository.findProfileById.mockResolvedValue({ id: 'usr-1' });
    mockRepository.updateProfile.mockResolvedValue({
      id: 'usr-1',
      dateOfBirth: new Date('2000-02-29T00:00:00.000Z'),
    });
    await expect(
      service.updateProfile('usr-1', { dateOfBirth: '2000-02-29' }),
    ).resolves.toMatchObject({ dateOfBirth: '2000-02-29' });
  });

  it('returns null when a birthday is cleared', async () => {
    mockRepository.findProfileById.mockResolvedValue({ id: 'usr-1' });
    mockRepository.updateProfile.mockResolvedValue({
      id: 'usr-1',
      dateOfBirth: null,
    });
    await expect(
      service.updateProfile('usr-1', { dateOfBirth: null }),
    ).resolves.toMatchObject({ dateOfBirth: null });
  });

  it('maps settings with default theme and HH:mm quiet hours', async () => {
    mockRepository.findSettingsByUserId.mockResolvedValue({
      userId: 'usr-1',
      theme: null,
      darkMode: true,
      quietHoursStart: new Date('1970-01-01T22:00:00Z'),
      quietHoursEnd: new Date('1970-01-01T06:30:00Z'),
    });
    await expect(service.getUserSettings('usr-1')).resolves.toMatchObject({
      theme: 'system',
      darkMode: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '06:30',
    });
  });

  it('derives darkMode from theme and keeps null quiet hours', async () => {
    mockRepository.findSettingsByUserId.mockResolvedValue({
      userId: 'usr-1',
      theme: 'dark',
      quietHoursStart: null,
      quietHoursEnd: null,
    });
    await expect(service.getUserSettings('usr-1')).resolves.toMatchObject({
      theme: 'dark',
      darkMode: true,
      quietHoursStart: null,
    });
  });
});
