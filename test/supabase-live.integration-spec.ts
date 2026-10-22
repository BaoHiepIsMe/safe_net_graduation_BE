import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const requiredNames = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_TEST_USER_A_EMAIL',
  'SUPABASE_TEST_USER_A_PASSWORD',
  'SUPABASE_TEST_USER_B_EMAIL',
  'SUPABASE_TEST_USER_B_PASSWORD',
  'SUPABASE_TEST_SIGNUP_EMAIL_DOMAIN',
  'SUPABASE_TEST_SIGNUP_PASSWORD',
] as const;

const liveConfigured =
  process.env.RUN_LIVE_SUPABASE_INTEGRATION === 'true' &&
  requiredNames.every((name) => Boolean(process.env[name]));

if (!liveConfigured) {
  console.warn('SKIPPED - LIVE SUPABASE ENVIRONMENT NOT CONFIGURED');
}

const liveDescribe = liveConfigured ? describe : describe.skip;

function env(name: (typeof requiredNames)[number]): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing live integration variable: ${name}`);
  return value;
}

function client(key: string): SupabaseClient {
  return createClient(env('SUPABASE_URL'), key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

liveDescribe('live Supabase Foundation and Phase 1 security', () => {
  let anonymous: SupabaseClient;
  let admin: SupabaseClient;
  let userA: SupabaseClient;
  let userB: SupabaseClient;
  let userAId: string;
  let userBId: string;
  let signupUserId: string | undefined;
  let registrationUserId: string | undefined;

  beforeAll(async () => {
    anonymous = client(env('SUPABASE_ANON_KEY'));
    admin = client(env('SUPABASE_SERVICE_ROLE_KEY'));
    userA = client(env('SUPABASE_ANON_KEY'));
    userB = client(env('SUPABASE_ANON_KEY'));

    const [sessionA, sessionB] = await Promise.all([
      userA.auth.signInWithPassword({
        email: env('SUPABASE_TEST_USER_A_EMAIL'),
        password: env('SUPABASE_TEST_USER_A_PASSWORD'),
      }),
      userB.auth.signInWithPassword({
        email: env('SUPABASE_TEST_USER_B_EMAIL'),
        password: env('SUPABASE_TEST_USER_B_PASSWORD'),
      }),
    ]);

    if (sessionA.error || !sessionA.data.user) {
      throw new Error('Live integration User A authentication failed');
    }
    if (sessionB.error || !sessionB.data.user) {
      throw new Error('Live integration User B authentication failed');
    }
    userAId = sessionA.data.user.id;
    userBId = sessionB.data.user.id;
  });

  afterAll(async () => {
    await Promise.allSettled([userA?.auth.signOut(), userB?.auth.signOut()]);
    if (signupUserId) {
      const cleanup = await admin.auth.admin.deleteUser(signupUserId);
      if (cleanup.error) {
        throw new Error('Live integration signup-user cleanup failed');
      }
    }
    if (registrationUserId) {
      const cleanup = await admin.auth.admin.deleteUser(registrationUserId);
      if (cleanup.error)
        throw new Error('Live registration-user cleanup failed');
    }
  });

  it.each(['profiles', 'user_settings', 'biometric_settings', 'families'])(
    'denies anonymous reads from %s',
    async (table) => {
      const { data, error } = await anonymous.from(table).select('*').limit(1);
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    },
  );

  it.each([
    ['profiles', 'id'],
    ['user_settings', 'user_id'],
    ['biometric_settings', 'user_id'],
  ])('allows User A own row and hides User B row in %s', async (table, key) => {
    const own = await userA.from(table).select(key).eq(key, userAId).single();
    expect(own.error).toBeNull();
    expect((own.data as Record<string, unknown> | null)?.[key]).toBe(userAId);

    const foreign = await userA.from(table).select(key).eq(key, userBId);
    expect(foreign.error).toBeNull();
    expect(foreign.data).toEqual([]);
  });

  it('prevents User B from reading User A Phase 1 rows', async () => {
    const { data, error } = await userB
      .from('profiles')
      .select('id')
      .eq('id', userAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('denies authenticated clients access to backend-only Phase 2 tables', async () => {
    const { data, error } = await userA.from('families').select('id').limit(1);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it('allows the backend client to perform an explicitly privileged read', async () => {
    const { data, error } = await admin
      .from('profiles')
      .select('id')
      .in('id', [userAId, userBId]);
    expect(error).toBeNull();
    expect(data).toEqual(
      expect.arrayContaining([{ id: userAId }, { id: userBId }]),
    );
  });

  it('creates all required Phase 1 rows through the deployed signup trigger', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const email = `safenet-integration+${suffix}@${env('SUPABASE_TEST_SIGNUP_EMAIL_DOMAIN')}`;
    const signupClient = client(env('SUPABASE_ANON_KEY'));
    const signup = await signupClient.auth.signUp({
      email,
      password: env('SUPABASE_TEST_SIGNUP_PASSWORD'),
      options: {
        data: {
          full_name: 'SafeNet Integration User',
          gender: 'female',
          date_of_birth: '2000-02-29',
        },
      },
    });

    let createdUser = signup.data.user;
    let creationError = signup.error;
    if (creationError?.message.toLowerCase().includes('rate limit')) {
      const adminCreation = await admin.auth.admin.createUser({
        email,
        password: env('SUPABASE_TEST_SIGNUP_PASSWORD'),
        email_confirm: true,
        user_metadata: {
          full_name: 'SafeNet Integration User',
          gender: 'female',
          date_of_birth: '2000-02-29',
        },
      });
      createdUser = adminCreation.data.user;
      creationError = adminCreation.error;
    }

    signupUserId = createdUser?.id;
    expect(creationError).toBeNull();
    expect(createdUser).not.toBeNull();
    expect(signupUserId).toBeDefined();

    for (const [table, key] of [
      ['profiles', 'id'],
      ['user_settings', 'user_id'],
      ['biometric_settings', 'user_id'],
    ] as const) {
      const row = await admin
        .from(table)
        .select(key)
        .eq(key, signupUserId as string)
        .single();
      expect(row.error).toBeNull();
      expect((row.data as Record<string, unknown> | null)?.[key]).toBe(
        signupUserId,
      );
    }
    const profile = await admin
      .from('profiles')
      .select('full_name,gender,date_of_birth')
      .eq('id', signupUserId as string)
      .single();
    expect(profile.error).toBeNull();
    expect(profile.data).toMatchObject({
      full_name: 'SafeNet Integration User',
      gender: 'female',
      date_of_birth: '2000-02-29',
    });
  });

  it('stores both Auth contacts and profile details while rejecting unconfirmed email login', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const email = `safenet-registration+${suffix}@${env('SUPABASE_TEST_SIGNUP_EMAIL_DOMAIN')}`;
    const phone = `+1${Date.now()}`;
    const created = await admin.auth.admin.createUser({
      email,
      phone,
      password: env('SUPABASE_TEST_SIGNUP_PASSWORD'),
      email_confirm: false,
      phone_confirm: false,
      user_metadata: {
        full_name: 'SafeNet Registration User',
        phone_number: phone,
        gender: 'male',
        date_of_birth: '1990-01-15',
      },
    });
    registrationUserId = created.data.user?.id;
    expect(created.error).toBeNull();
    expect(registrationUserId).toBeDefined();
    expect(created.data.user?.phone?.replace(/^\+/, '')).toBe(phone.slice(1));
    expect(created.data.user?.email_confirmed_at).toBeFalsy();
    expect(created.data.user?.phone_confirmed_at).toBeFalsy();

    const profile = await admin
      .from('profiles')
      .select('full_name,phone,gender,date_of_birth')
      .eq('id', registrationUserId as string)
      .single();
    expect(profile.error).toBeNull();
    expect(profile.data).toEqual({
      full_name: 'SafeNet Registration User',
      phone,
      gender: 'male',
      date_of_birth: '1990-01-15',
    });
    const login = await client(
      env('SUPABASE_ANON_KEY'),
    ).auth.signInWithPassword({
      email,
      password: env('SUPABASE_TEST_SIGNUP_PASSWORD'),
    });
    expect(login.data.session).toBeNull();
    expect(login.error?.code).toBe('email_not_confirmed');
  });
});
