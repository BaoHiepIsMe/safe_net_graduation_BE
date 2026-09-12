import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FOREIGN_ID = '22222222-2222-4222-8222-222222222222';

describe('Foundation and Phase 1 security (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const profile = {
      id: USER_ID,
      fullName: 'Safe User',
      avatarUrl: null,
      dateOfBirth: null,
      gender: null,
      phoneNumber: '+84123456789',
      accountStatus: 'active',
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z',
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SupabaseService)
      .useValue({
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
          findUnique: jest.fn().mockResolvedValue(profile),
          findFirst: jest.fn().mockResolvedValue(null),
        },
        familyMember: { findFirst: jest.fn().mockResolvedValue(null) },
        conversationMember: { findFirst: jest.fn().mockResolvedValue(null) },
      })
      .overrideProvider(AuthService)
      .useValue({ register: jest.fn(), login: jest.fn() })
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

  it('rejects unknown registration fields before calling auth', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'user@example.com',
        password: 'password123',
        fullName: 'Safe User',
        ownerId: FOREIGN_ID,
      })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  afterAll(async () => {
    await app.close();
  });
});
