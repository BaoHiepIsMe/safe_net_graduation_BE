import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import {
  AppError,
  ConflictError,
  UnauthorizedError,
} from '../../common/errors/app.error';
import { ErrorCode } from '../../common/constants/error-codes';
import { ProfilesRepository } from '../profiles/profiles.repository';

describe('AuthService', () => {
  const registration = {
    email: 'test@safenet.vn',
    password: 'password123',
    phoneNumber: '+84912345678',
    fullName: 'Test User',
    gender: 'female' as const,
    dateOfBirth: '2000-02-29',
  };
  let service: AuthService;
  let authClient: any;
  let adminClient: any;
  let profilesRepository: any;

  beforeEach(async () => {
    authClient = {
      auth: {
        resend: jest.fn().mockResolvedValue({ error: null }),
        signInWithPassword: jest.fn(),
        refreshSession: jest.fn(),
        resetPasswordForEmail: jest.fn(),
      },
    };
    adminClient = {
      auth: {
        admin: {
          createUser: jest.fn(),
          getUserById: jest.fn().mockResolvedValue({
            data: {
              user: {
                id: 'usr-1',
                email: registration.email,
                phone: '84912345678',
              },
            },
            error: null,
          }),
          updateUserById: jest.fn(),
          signOut: jest.fn(),
        },
      },
    };
    profilesRepository = {
      findProfileByPhoneNumber: jest.fn().mockResolvedValue({ id: 'usr-1' }),
      findProfileById: jest.fn().mockResolvedValue({
        fullName: 'Test User',
        avatarUrl: null,
        accountStatus: 'active',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: SupabaseService,
          useValue: {
            getAuthClient: () => authClient,
            getAdminAuthClient: () => adminClient,
          },
        },
        {
          provide: ProfilesRepository,
          useValue: profilesRepository,
        },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('registers through Supabase Auth and relies on the database trigger', async () => {
    adminClient.auth.admin.createUser.mockResolvedValue({
      data: {
        user: {
          id: 'usr-1',
          email: 'test@safenet.vn',
          identities: [{ id: 'identity-1' }],
        },
        session: null,
      },
      error: null,
    });

    const result = await service.register({
      ...registration,
      email: 'test@safenet.vn',
      password: 'password123',
      fullName: 'Test User',
    });

    expect(result.user.id).toBe('usr-1');
    expect(adminClient.auth.admin.createUser).toHaveBeenCalledWith({
      email: registration.email,
      phone: registration.phoneNumber,
      password: registration.password,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: {
        full_name: registration.fullName,
        phone_number: registration.phoneNumber,
        gender: registration.gender,
        date_of_birth: registration.dateOfBirth,
        ui_mode: 'adult',
      },
    });
    expect(result).toEqual({
      user: {
        id: 'usr-1',
        email: registration.email,
        phoneNumber: registration.phoneNumber,
        fullName: registration.fullName,
        gender: registration.gender,
        dateOfBirth: registration.dateOfBirth,
        uiMode: 'adult',
      },
      session: null,
    });
    expect(authClient.auth.resend).not.toHaveBeenCalled();
  });

  it('forces kid uiMode for <13 and defaults assisted for >=60 on register', async () => {
    adminClient.auth.admin.createUser.mockResolvedValue({
      data: {
        user: {
          id: 'usr-1',
          email: 'test@safenet.vn',
          identities: [{ id: 'identity-1' }],
        },
        session: null,
      },
      error: null,
    });

    const childResult = await service.register({
      ...registration,
      dateOfBirth: '2018-01-01',
      uiMode: 'adult',
    });
    expect(childResult.user.uiMode).toBe('kid');

    const elderResult = await service.register({
      ...registration,
      dateOfBirth: '1950-01-01',
    });
    expect(elderResult.user.uiMode).toBe('assisted');
  });

  it('maps duplicate registration to a stable conflict', async () => {
    adminClient.auth.admin.createUser.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'user_already_exists', message: 'provider text' },
    });

    await expect(
      service.register({
        ...registration,
        email: 'test@safenet.vn',
        password: 'password123',
        fullName: 'Test User',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('maps a provider registration error without exposing provider text', async () => {
    adminClient.auth.admin.createUser.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'provider_failure', message: 'private provider text' },
    });

    const registration = service.register({
      email: 'test@safenet.vn',
      phoneNumber: '+84912345678',
      gender: 'female',
      dateOfBirth: '2000-02-29',
      password: 'password123',
      fullName: 'Test User',
    });

    await expect(registration).rejects.toMatchObject({
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      customMessage: 'Không thể đăng ký tài khoản lúc này',
    });
    await expect(registration).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a nullable provider success response', async () => {
    adminClient.auth.admin.createUser.mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    });

    await expect(
      service.register({
        ...registration,
        email: 'test@safenet.vn',
        password: 'password123',
        fullName: 'Test User',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      customMessage: 'Không thể đăng ký tài khoản lúc này',
    });
  });

  it.each(['email_exists', 'phone_exists'])(
    'rejects duplicate %s without updating an existing account',
    async (code) => {
      adminClient.auth.admin.createUser.mockResolvedValue({
        data: { user: null },
        error: { code },
      });
      await expect(service.register(registration)).rejects.toMatchObject({
        code: ErrorCode.USER_ALREADY_EXISTS,
      });
      expect(authClient.auth.resend).not.toHaveBeenCalled();
      expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
    },
  );

  it('logs in an active user', async () => {
    authClient.auth.signInWithPassword.mockResolvedValue({
      data: {
        user: { id: 'usr-1', email: 'test@safenet.vn' },
        session: {
          access_token: 'access',
          refresh_token: 'refresh',
          expires_in: 3600,
          token_type: 'bearer',
        },
      },
      error: null,
    });

    const result = await service.login({
      email: 'test@safenet.vn',
      password: 'password123',
    });
    expect(result.session.accessToken).toBe('access');
    expect(authClient.auth.signInWithPassword).toHaveBeenCalledWith({
      email: registration.email,
      password: 'password123',
    });
    expect(adminClient.auth.admin.getUserById).not.toHaveBeenCalled();
  });

  function successfulPhoneLogin() {
    authClient.auth.signInWithPassword.mockResolvedValue({
      data: {
        user: { id: 'usr-1', email: registration.email, phone: '84912345678' },
        session: {
          access_token: 'access',
          refresh_token: 'refresh',
          expires_in: 3600,
          token_type: 'bearer',
        },
      },
      error: null,
    });
  }

  it('uses the Auth-owned email for phone/password login while the phone is unverified', async () => {
    successfulPhoneLogin();
    const result = await service.login({
      phoneNumber: registration.phoneNumber,
      password: registration.password,
    });
    expect(result.user.id).toBe('usr-1');
    expect(authClient.auth.signInWithPassword).toHaveBeenCalledWith({
      email: registration.email,
      password: registration.password,
    });
    expect(adminClient.auth.admin.getUserById).toHaveBeenCalledWith('usr-1');
    expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('rejects an unknown phone without returning account information', async () => {
    profilesRepository.findProfileByPhoneNumber.mockResolvedValue(null);
    await expect(
      service.login({
        phoneNumber: registration.phoneNumber,
        password: registration.password,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    expect(adminClient.auth.admin.getUserById).not.toHaveBeenCalled();
    expect(authClient.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it.each([
    { data: { user: null }, error: { code: 'user_not_found' } },
    {
      data: {
        user: { id: 'usr-1', email: registration.email, phone: '84987654321' },
      },
      error: null,
    },
    {
      data: {
        user: {
          id: 'another-user',
          email: registration.email,
          phone: '84912345678',
        },
      },
      error: null,
    },
    { data: { user: { id: 'usr-1', phone: '84912345678' } }, error: null },
  ])(
    'rejects a stale or inconsistent phone/Auth binding %# before password verification',
    async (result) => {
      adminClient.auth.admin.getUserById.mockResolvedValue(result);
      await expect(
        service.login({
          phoneNumber: registration.phoneNumber,
          password: registration.password,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
      expect(authClient.auth.signInWithPassword).not.toHaveBeenCalled();
    },
  );

  it.each([
    { id: 'another-user', email: registration.email, phone: '84912345678' },
    { id: 'usr-1', email: registration.email, phone: '84987654321' },
  ])(
    'rejects a binding that changes while the password request is in flight %#',
    async (user) => {
      successfulPhoneLogin();
      authClient.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user, session: { access_token: 'access' } },
        error: null,
      });
      await expect(
        service.login({
          phoneNumber: registration.phoneNumber,
          password: registration.password,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    },
  );

  it('preserves the Supabase email-confirmation requirement during phone login', async () => {
    authClient.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'email_not_confirmed' },
    });
    await expect(
      service.login({
        phoneNumber: registration.phoneNumber,
        password: registration.password,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    expect(adminClient.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('rejects phone login for an inactive profile', async () => {
    successfulPhoneLogin();
    profilesRepository.findProfileById.mockResolvedValue({
      accountStatus: 'locked',
    });
    await expect(
      service.login({
        phoneNumber: registration.phoneNumber,
        password: registration.password,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.ACCESS_DENIED });
  });

  it('maps invalid credentials without exposing provider text', async () => {
    authClient.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'private provider text' },
    });

    await expect(
      service.login({ email: 'wrong@safenet.vn', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('revokes the current session on logout', async () => {
    adminClient.auth.admin.signOut.mockResolvedValue({ error: null });
    await expect(service.logout('verified-token')).resolves.toBeUndefined();
    expect(adminClient.auth.admin.signOut).toHaveBeenCalledWith(
      'verified-token',
    );
  });
});
