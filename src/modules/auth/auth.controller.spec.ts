import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UnauthorizedError } from '../../common/errors/app.error';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = {
    register: jest.fn(),
    login: jest.fn(),
    refreshSession: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    logout: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();
    controller = module.get(AuthController);
  });

  it('returns only the safe current auth-user projection', () => {
    expect(
      controller.getMe({
        id: 'usr-1',
        email: 'alice@safenet.vn',
        role: 'authenticated',
        app_metadata: { provider: 'email' },
      }),
    ).toEqual({
      id: 'usr-1',
      email: 'alice@safenet.vn',
      phone: undefined,
    });
  });

  it('rejects logout when the verified token context is absent', async () => {
    await expect(controller.logout(undefined)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});
