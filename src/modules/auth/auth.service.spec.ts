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
  let service: AuthService;
  let authClient: any;
  let adminClient: any;

  beforeEach(async () => {
    authClient = {
      auth: {
        signUp: jest.fn(),
        signInWithPassword: jest.fn(),
        refreshSession: jest.fn(),
        resetPasswordForEmail: jest.fn(),
      },
    };
    adminClient = {
      auth: {
        admin: {
          updateUserById: jest.fn(),
          signOut: jest.fn(),
        },
      },
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
          useValue: {
            findProfileById: jest.fn().mockResolvedValue({
              fullName: 'Test User',
              avatarUrl: null,
              accountStatus: 'active',
            }),
          },
        },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('registers through Supabase Auth and relies on the database trigger', async () => {
    authClient.auth.signUp.mockResolvedValue({
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
      email: 'test@safenet.vn',
      password: 'password123',
      fullName: 'Test User',
    });

    expect(result.user.id).toBe('usr-1');
  });

  it('maps duplicate registration to a stable conflict', async () => {
    authClient.auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'user_already_exists', message: 'provider text' },
    });

    await expect(
      service.register({
        email: 'test@safenet.vn',
        password: 'password123',
        fullName: 'Test User',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('maps a provider registration error without exposing provider text', async () => {
    authClient.auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'provider_failure', message: 'private provider text' },
    });

    const registration = service.register({
      email: 'test@safenet.vn',
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
    authClient.auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    });

    await expect(
      service.register({
        email: 'test@safenet.vn',
        password: 'password123',
        fullName: 'Test User',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      customMessage: 'Không thể đăng ký tài khoản lúc này',
    });
  });

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
