import { loginSchema, registerSchema } from './auth.dto';

describe('auth request schemas', () => {
  const registration = {
    email: 'user@example.com',
    password: 'password123',
    phoneNumber: '+84912345678',
    fullName: 'Safe User',
    gender: 'female',
    dateOfBirth: '2000-02-29',
    role: 'parent',
  };

  it('normalizes email and full name', () => {
    const result = registerSchema.parse({
      ...registration,
      email: '  USER@Example.COM ',
      password: 'password123',
      fullName: '  Safe User  ',
    });
    expect(result.email).toBe('user@example.com');
    expect(result.fullName).toBe('Safe User');
  });

  it('rejects unsupported fields and weak input', () => {
    expect(() =>
      registerSchema.parse({
        ...registration,
        email: 'user@example.com',
        password: 'short',
        fullName: 'Safe User',
        ownerId: 'attacker-controlled',
      }),
    ).toThrow();
  });

  it.each(Object.keys(registration))(
    'requires registration field %s',
    (key) => {
      const input: Record<string, unknown> = { ...registration };
      delete input[key];
      expect(registerSchema.safeParse(input).success).toBe(false);
    },
  );

  it.each([
    { phoneNumber: '0912345678' },
    { phoneNumber: '+84123' },
    { gender: 'manager' },
    { role: 'manager' },
    { dateOfBirth: '2001-02-29' },
    { dateOfBirth: '2000-04-31' },
    { dateOfBirth: '15/01/2000' },
    { dateOfBirth: '9999-01-01' },
    { dateOfBirth: '0000-01-01' },
    { email: `${'a'.repeat(140)}@example.com` },
  ])('rejects invalid registration details %j', (fields) => {
    expect(
      registerSchema.safeParse({ ...registration, ...fields }).success,
    ).toBe(false);
  });

  it('normalizes the optional international plus prefix consistently', () => {
    expect(
      registerSchema.parse({ ...registration, phoneNumber: '84912345678' })
        .phoneNumber,
    ).toBe('+84912345678');
  });

  it('accepts and normalizes an email login without changing the password', () => {
    expect(
      loginSchema.parse({
        email: ' USER@Example.COM ',
        password: ' password ',
      }),
    ).toEqual({ email: 'user@example.com', password: ' password ' });
  });

  it.each(['+84912345678', '84912345678'])(
    'normalizes phone login %s to the registration format',
    (phoneNumber) => {
      expect(
        loginSchema.parse({ phoneNumber, password: 'password123' }),
      ).toEqual({ phoneNumber: '+84912345678', password: 'password123' });
    },
  );

  it.each([
    { password: 'password123' },
    {
      email: 'user@example.com',
      phoneNumber: '+84912345678',
      password: 'password123',
    },
    { email: 'invalid-email', password: 'password123' },
    { phoneNumber: '0912345678', password: 'password123' },
    { phoneNumber: '+84123', password: 'password123' },
    { phoneNumber: '+84912345678', password: '' },
    { email: 'user@example.com', password: 'a'.repeat(129) },
    { email: 'user@example.com', password: 'password123', userId: 'injected' },
  ])('rejects invalid or ambiguous login input %#', (input) => {
    expect(loginSchema.safeParse(input).success).toBe(false);
  });
});
