import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  createClient,
  type AdminUserAttributes,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { AuthService } from '../src/modules/auth/auth.service';
import {
  registerSchema,
  loginSchema,
  type RegisterDto,
} from '../src/modules/auth/dto/auth.dto';
import { ProfilesRepository } from '../src/modules/profiles/profiles.repository';
import { ProfilesService } from '../src/modules/profiles/profiles.service';
import { ErrorCode } from '../src/common/constants/error-codes';

const required = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
] as const;
const enabled =
  process.env.RUN_LIVE_SUPABASE_REGISTRATION === 'true' &&
  required.every((name) => Boolean(process.env[name]));
const liveDescribe = enabled ? describe : describe.skip;

// Explicit opt-in: only temporary test accounts. Mail is stubbed and phones
// remain unconfirmed. The login fixture confirms only its synthetic email.
liveDescribe('Supabase registration and profile transaction', () => {
  jest.setTimeout(60000);
  let module: TestingModule | undefined;
  let admin: SupabaseClient;
  let auth: SupabaseClient;
  let prisma: PrismaService;
  let service: AuthService;
  let profiles: ProfilesService;
  let dto: RegisterDto;
  let userId: string;
  const createdIds = new Set<string>();
  const attemptedEmails = new Set<string>();
  let phoneSuffix = randomInt(0, 100);
  const nextPhone = () => {
    phoneSuffix = (phoneSuffix + 1) % 100;
    return `+120255501${String(phoneSuffix).padStart(2, '0')}`;
  };
  const email = () => `safenet-registration-${randomUUID()}@example.com`;
  const password = () => `${randomBytes(24).toString('base64url')}Aa9!`;

  async function createTracked(attributes: AdminUserAttributes) {
    if (attributes.email) attemptedEmails.add(attributes.email);
    const result = await admin.auth.admin.createUser(attributes);
    if (result.data.user) createdIds.add(result.data.user.id);
    return result;
  }

  async function readAuthUser(id: string) {
    for (let attempt = 0; ; attempt++) {
      const result = await admin.auth.admin.getUserById(id);
      const transient =
        result.error &&
        (result.error.name === 'AuthRetryableFetchError' ||
          [0, 502, 503, 504].includes(result.error.status ?? -1));
      if (!transient || attempt === 2) return result;
    }
  }

  function expectNoAuthError(
    error: { name: string; status?: number; code?: string } | null,
  ) {
    expect(
      error
        ? { name: error.name, status: error.status, code: error.code }
        : null,
    ).toBeNull();
  }

  beforeAll(async () => {
    admin = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (input, init) =>
            fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
        },
      },
    );
    auth = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (input, init) =>
            fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
        },
      },
    );
    module = await Test.createTestingModule({
      providers: [
        AuthService,
        ProfilesRepository,
        ProfilesService,
        PrismaService,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            database: { url: process.env.DATABASE_URL },
          }),
        },
        {
          provide: SupabaseService,
          useValue: {
            getAdminAuthClient: () => ({
              auth: {
                admin: {
                  createUser: createTracked,
                  getUserById: admin.auth.admin.getUserById.bind(
                    admin.auth.admin,
                  ),
                },
              },
            }),
            getAuthClient: () => ({
              auth: {
                signInWithPassword: auth.auth.signInWithPassword.bind(
                  auth.auth,
                ),
              },
            }),
          },
        },
      ],
    }).compile();
    await module.init();
    prisma = module.get(PrismaService);
    service = module.get(AuthService);
    profiles = module.get(ProfilesService);
    dto = registerSchema.parse({
      email: email(),
      phoneNumber: nextPhone(),
      password: password(),
      fullName: 'SafeNet Registration Integration',
      gender: 'female',
      dateOfBirth: '2000-02-29',
    });
    const result = await service.register(dto);
    userId = result.user.id;
  });

  afterAll(async () => {
    const cleanupErrors: string[] = [];
    if (prisma && attemptedEmails.size > 0) {
      // Recover a committed fixture when an Auth response timed out after the
      // transaction committed. Every email here was generated by this suite.
      const committed = await prisma.profile.findMany({
        where: { email: { in: [...attemptedEmails] } },
        select: { id: true },
        take: attemptedEmails.size,
      });
      for (const profile of committed) createdIds.add(profile.id);
    }
    for (const id of createdIds) {
      const result = await admin.auth.admin.deleteUser(id);
      if (result.error)
        cleanupErrors.push(result.error.code ?? 'CLEANUP_FAILED');
    }
    await module?.close();
    if (cleanupErrors.length)
      throw new Error(
        `Temporary registration-account cleanup failed: ${cleanupErrors.join(', ')}`,
      );
  });

  it('uses the same UID and contacts in Auth/profile and saves the complete profile', async () => {
    const auth = await readAuthUser(userId);
    expectNoAuthError(auth.error);
    expect(auth.data.user?.email).toBe(dto.email);
    expect(auth.data.user?.phone?.replace(/^\+/, '')).toBe(
      dto.phoneNumber.slice(1),
    );
    expect(auth.data.user?.email_confirmed_at).toBeTruthy();
    expect(auth.data.user?.phone_confirmed_at).toBeTruthy();

    const profile = await prisma.profile.findUnique({ where: { id: userId } });
    expect(profile).toMatchObject({
      id: userId,
      email: dto.email,
      phoneNumber: dto.phoneNumber,
      fullName: dto.fullName,
      gender: dto.gender,
      uiMode: 'adult',
      dateOfBirth: new Date('2000-02-29T00:00:00.000Z'),
    });
    expect(await prisma.userSetting.count({ where: { userId } })).toBe(1);
    expect(await prisma.biometricSetting.count({ where: { userId } })).toBe(1);
  });

  it('rejects an existing email without creating another profile', async () => {
    await expect(
      service.register({ ...dto, phoneNumber: nextPhone() }),
    ).rejects.toMatchObject({ code: ErrorCode.USER_ALREADY_EXISTS });
    expect(await prisma.profile.count({ where: { email: dto.email } })).toBe(1);
  });

  it('rejects an existing phone without creating another account', async () => {
    const otherEmail = email();
    await expect(
      service.register({ ...dto, email: otherEmail }),
    ).rejects.toMatchObject({ code: ErrorCode.USER_ALREADY_EXISTS });
    expect(await prisma.profile.count({ where: { email: otherEmail } })).toBe(
      0,
    );
  });

  it('uses the Auth phone even if metadata contains a different phone', async () => {
    const authPhone = nextPhone();
    const result = await createTracked({
      email: email(),
      phone: authPhone,
      password: password(),
      email_confirm: false,
      phone_confirm: false,
      user_metadata: {
        full_name: dto.fullName,
        phone_number: nextPhone(),
        gender: dto.gender,
        date_of_birth: dto.dateOfBirth,
      },
    });
    expectNoAuthError(result.error);
    expect(result.data.user).not.toBeNull();
    const profile = await prisma.profile.findUnique({
      where: { id: result.data.user!.id },
    });
    expect(profile?.phoneNumber).toBe(authPhone);
  });

  it('rolls back the Auth identity if the profile trigger rejects the birthday', async () => {
    const id = randomUUID();
    const result = await createTracked({
      id,
      email: email(),
      phone: nextPhone(),
      password: password(),
      email_confirm: false,
      phone_confirm: false,
      user_metadata: { full_name: dto.fullName, date_of_birth: 'invalid-date' },
    });
    expect(result.error).not.toBeNull();
    expect(result.data.user).toBeNull();
    const auth = await readAuthUser(id);
    expect(auth.data.user).toBeNull();
    expect(await prisma.profile.findUnique({ where: { id } })).toBeNull();
    expect(
      await prisma.userSetting.findUnique({ where: { userId: id } }),
    ).toBeNull();
    expect(
      await prisma.biometricSetting.findUnique({ where: { userId: id } }),
    ).toBeNull();
  });

  it('persists a profile birthday update and supports clearing it', async () => {
    const updated = await profiles.updateProfile(userId, {
      dateOfBirth: '1992-02-29',
    });
    expect(updated.dateOfBirth).toBe('1992-02-29');
    expect(
      (await prisma.profile.findUnique({ where: { id: userId } }))?.dateOfBirth,
    ).toEqual(new Date('1992-02-29T00:00:00.000Z'));
    const cleared = await profiles.updateProfile(userId, { dateOfBirth: null });
    expect(cleared.dateOfBirth).toBeNull();
  });

  it('logs into the same account by email and unverified phone without sending SMS', async () => {
    const loginEmail = email();
    const loginPhone = nextPhone();
    const loginPassword = password();
    const created = await createTracked({
      email: loginEmail,
      phone: loginPhone,
      password: loginPassword,
      email_confirm: true,
      phone_confirm: false,
      user_metadata: {
        full_name: 'Login Integration User',
        gender: 'female',
        date_of_birth: '2000-01-15',
      },
    });
    expectNoAuthError(created.error);
    expect(created.data.user).not.toBeNull();
    const emailLogin = await service.login(
      loginSchema.parse({ email: loginEmail, password: loginPassword }),
    );
    const phoneLogin = await service.login(
      loginSchema.parse({
        phoneNumber: loginPhone.slice(1),
        password: loginPassword,
      }),
    );
    expect(emailLogin.user.id).toBe(created.data.user!.id);
    expect(phoneLogin.user.id).toBe(emailLogin.user.id);
    expect(emailLogin.session.tokenType).toBe('bearer');
    expect(phoneLogin.session.tokenType).toBe('bearer');
    const current = await readAuthUser(created.data.user!.id);
    expectNoAuthError(current.error);
    expect(current.data.user?.phone_confirmed_at).toBeFalsy();

    await expect(
      service.login({
        phoneNumber: loginPhone,
        password: 'incorrect-password',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
  });

  it('allows immediate phone/password login for a newly registered account', async () => {
    const login = await service.login({
      phoneNumber: dto.phoneNumber,
      password: dto.password,
    });
    expect(login.user.id).toBe(userId);
    expect(login.session.tokenType).toBe('bearer');
  });

  it.each(['adult', 'assisted'] as const)(
    'registers with uiMode %s, stores it in public.profiles.ui_mode, and logs in immediately by email and phone',
    async (uiMode) => {
      const uiModeDto = registerSchema.parse({
        email: email(),
        phoneNumber: nextPhone(),
        password: password(),
        fullName: `SafeNet UiMode ${uiMode}`,
        gender: 'male',
        dateOfBirth: '1995-05-20',
        uiMode,
      });
      const registered = await service.register(uiModeDto);
      expect(registered.user.uiMode).toBe(uiMode);
      expect(registered.session).toBeNull();

      const rows = await prisma.$queryRaw<Array<{ ui_mode: string }>>`
        SELECT ui_mode FROM public.profiles WHERE email = ${uiModeDto.email}
      `;
      expect(rows).toEqual([{ ui_mode: uiMode }]);

      const emailLogin = await service.login({
        email: uiModeDto.email,
        password: uiModeDto.password,
      });
      const phoneLogin = await service.login({
        phoneNumber: uiModeDto.phoneNumber,
        password: uiModeDto.password,
      });
      expect(emailLogin.user.id).toBe(registered.user.id);
      expect(phoneLogin.user.id).toBe(registered.user.id);
    },
  );
});
