import { Test, TestingModule } from '@nestjs/testing';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

describe('ProfilesController', () => {
  let controller: ProfilesController;

  const mockProfilesService = {
    getProfile: jest.fn().mockResolvedValue({
      id: 'usr-1',
      fullName: 'Alice',
      avatarUrl: null,
      role: 'parent',
      accountStatus: 'active',
    }),
    updateProfile: jest.fn().mockResolvedValue({
      id: 'usr-1',
      fullName: 'Alice Updated',
      avatarUrl: null,
      accountStatus: 'active',
    }),
    getUserSettings: jest.fn().mockResolvedValue({
      userId: 'usr-1',
      language: 'vi',
      pushNotificationsEnabled: true,
    }),
    updateUserSettings: jest.fn().mockResolvedValue({
      userId: 'usr-1',
      language: 'en',
      pushNotificationsEnabled: true,
    }),
    getBiometricSettings: jest.fn().mockResolvedValue({
      userId: 'usr-1',
      biometricEnabled: false,
      biometricType: 'fingerprint',
    }),
    updateBiometricSettings: jest.fn().mockResolvedValue({
      userId: 'usr-1',
      biometricEnabled: true,
      biometricType: 'fingerprint',
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProfilesController],
      providers: [
        {
          provide: ProfilesService,
          useValue: mockProfilesService,
        },
      ],
    }).compile();

    controller = module.get<ProfilesController>(ProfilesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return current user profile', async () => {
    const res = await controller.getMyProfile({ id: 'usr-1' });
    expect(res.id).toBe('usr-1');
    expect(res.fullName).toBe('Alice');
    expect(res.role).toBe('parent');
  });

  it('should return user settings', async () => {
    const res = await controller.getSettings({ id: 'usr-1' });
    expect(res.userId).toBe('usr-1');
    expect(res.language).toBe('vi');
  });
});
