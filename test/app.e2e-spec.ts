import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FOREIGN_ID = '22222222-2222-4222-8222-222222222222';

describe('Foundation and Phase 1 security (e2e)', () => {
  let app: INestApplication<App>;
  const registration = {
    email: 'user@example.com',
    password: 'password123',
    phoneNumber: '+84912345678',
    fullName: 'Safe User',
    gender: 'female',
    dateOfBirth: '2000-02-29',
    role: 'parent',
  };
  const createUser = jest.fn().mockResolvedValue({
    data: { user: { id: USER_ID, email: registration.email } },
    error: null,
  });
  const updateProfile = jest.fn();
  const signInWithPassword = jest.fn(
    ({ email, password }: { email: string; password: string }) =>
      Promise.resolve(
        email === registration.email && password === registration.password
          ? {
              data: {
                user: {
                  id: USER_ID,
                  email: registration.email,
                  phone: '84912345678',
                },
                session: {
                  access_token: 'test-access',
                  refresh_token: 'test-refresh',
                  expires_in: 3600,
                  token_type: 'bearer',
                },
              },
              error: null,
            }
          : {
              data: { user: null, session: null },
              error: { code: 'invalid_credentials' },
            },
      ),
  );
  const getUserById = jest.fn().mockResolvedValue({
    data: {
      user: { id: USER_ID, email: registration.email, phone: '84912345678' },
    },
    error: null,
  });

  beforeAll(async () => {
    const profile = {
      id: USER_ID,
      fullName: 'Safe User',
      avatarUrl: null,
      dateOfBirth: null,
      gender: null,
      role: 'parent',
      phoneNumber: registration.phoneNumber,
      accountStatus: 'active',
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z',
    };
    updateProfile.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...profile,
          ...Object.fromEntries(
            Object.entries(data).filter(([, value]) => value !== undefined),
          ),
        }),
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SupabaseService)
      .useValue({
        getAdminAuthClient: () => ({
          auth: { admin: { createUser, getUserById } },
        }),
        getAuthClient: () => ({ auth: { signInWithPassword } }),
        verifyToken: jest.fn((token: string) =>
          Promise.resolve(
            token === 'valid-token'
              ? { id: USER_ID, email: 'safe@example.com' }
              : null,
          ),
        ),
      })
      .overrideProvider(PrismaService)
      .useValue({
        profile: {
          findUnique: jest.fn(
            ({ where }: { where: { id?: string; phoneNumber?: string } }) =>
              Promise.resolve(
                where.id === USER_ID ||
                  where.phoneNumber === registration.phoneNumber
                  ? profile
                  : null,
              ),
          ),
          findFirst: jest.fn().mockResolvedValue(null),
          update: updateProfile,
        },
        userSetting: {
          findUnique: jest.fn().mockResolvedValue({
            userId: USER_ID,
            language: 'vi',
            theme: null,
            quietHoursStart: new Date('1970-01-01T22:00:00Z'),
            quietHoursEnd: null,
          }),
        },
        familyMember: { findFirst: jest.fn().mockResolvedValue(null) },
        conversationMember: { findFirst: jest.fn().mockResolvedValue(null) },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  it('GET /health/live returns liveness', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200);
    expect(response.body.data.status).toBe('ok');
  });

  it('rejects a missing token on private profile', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/profiles/me')
      .expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an invalid token on private profile', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/profiles/me')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
    expect(response.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('returns only the authenticated user private profile', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/profiles/me')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);
    expect(response.body.data.id).toBe(USER_ID);
    expect(response.body.data.fullName).toBe('Safe User');
    expect(response.body.data.role).toBe('parent');
  });

  it('does not expose arbitrary or malformed profile lookup routes', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/profiles/${FOREIGN_ID}`)
      .set('Authorization', 'Bearer valid-token')
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/profiles/not-a-uuid')
      .set('Authorization', 'Bearer valid-token')
      .expect(404);
  });

  it('accepts a birthday as YYYY-MM-DD and returns the same calendar date', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/v1/profiles/me')
      .set('Authorization', 'Bearer valid-token')
      .send({ dateOfBirth: '2000-02-29' })
      .expect(200);
    expect(response.body.data.dateOfBirth).toBe('2000-02-29');
    expect(updateProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: USER_ID },
        data: expect.objectContaining({
          dateOfBirth: new Date('2000-02-29T00:00:00.000Z'),
        }),
      }),
    );
  });

  it('allows clearing the birthday with null', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/v1/profiles/me')
      .set('Authorization', 'Bearer valid-token')
      .send({ dateOfBirth: null })
      .expect(200);
    expect(response.body.data.dateOfBirth).toBeNull();
  });

  it('rejects phoneNumber on profile update (read-only identity)', async () => {
    updateProfile.mockClear();
    const response = await request(app.getHttpServer())
      .patch('/api/v1/profiles/me')
      .set('Authorization', 'Bearer valid-token')
      .send({ phoneNumber: '+84900000000' })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('returns theme and HH:mm quiet hours in settings', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/profiles/settings')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);
    expect(response.body.data).toMatchObject({
      theme: 'system',
      darkMode: false,
      quietHoursStart: '22:00',
      quietHoursEnd: null,
    });
  });

  it('rejects an impossible birthday before attempting a write', async () => {
    updateProfile.mockClear();
    const response = await request(app.getHttpServer())
      .patch('/api/v1/profiles/me')
      .set('Authorization', 'Bearer valid-token')
      .send({ dateOfBirth: '2001-02-29' })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('rejects unknown registration fields before calling auth', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        ...registration,
        ownerId: FOREIGN_ID,
      })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it.each(['phoneNumber', 'gender', 'dateOfBirth', 'role'])(
    'rejects registration without %s before creating an Auth account',
    async (key) => {
      createUser.mockClear();
      const input: Record<string, unknown> = { ...registration };
      delete input[key];
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(input)
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(createUser).not.toHaveBeenCalled();
    },
  );

  it('registers complete details without email confirmation or returning tokens', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registration)
      .expect(201);
    const { password: _password, ...user } = registration;
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({
      user: { id: USER_ID, ...user },
      session: null,
    });
    expect(response.body.data.user).not.toHaveProperty('password');
  });

  it('returns a stable conflict for an existing Auth phone number', async () => {
    createUser.mockResolvedValueOnce({
      data: { user: null },
      error: { code: 'phone_exists' },
    });
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registration)
      .expect(409);
    expect(response.body.error.code).toBe('USER_ALREADY_EXISTS');
  });

  it('does not expose a confirmation resend route', async () => {
    const removedPath = ['/api/v1/auth/resend', 'confirmation'].join('-');
    await request(app.getHttpServer())
      .post(removedPath)
      .send({ email: registration.email })
      .expect(404);
  });

  it.each([
    { email: ' USER@EXAMPLE.COM ' },
    { phoneNumber: '+84912345678' },
    { phoneNumber: '84912345678' },
  ])('logs in with either supported identifier %#', async (identifier) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ ...identifier, password: registration.password })
      .expect(200);
    expect(response.body.data.user.id).toBe(USER_ID);
    expect(response.body.data.session.tokenType).toBe('bearer');
  });

  it.each([
    { password: registration.password },
    {
      email: registration.email,
      phoneNumber: registration.phoneNumber,
      password: registration.password,
    },
    { phoneNumber: '0912345678', password: registration.password },
  ])('rejects an invalid or ambiguous login body %#', async (body) => {
    signInWithPassword.mockClear();
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(body)
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it.each([
    { email: 'unknown@example.com', password: registration.password },
    { phoneNumber: '+84987654321', password: registration.password },
    { phoneNumber: registration.phoneNumber, password: 'incorrect' },
  ])(
    'returns the same safe error for wrong login credentials %#',
    async (body) => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(body)
        .expect(401);
      expect(response.body.error).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        details: null,
      });
    },
  );

  afterAll(async () => {
    await app.close();
  });
});
