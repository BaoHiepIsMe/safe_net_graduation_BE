import { registerSchema } from './auth.dto';

describe('auth request schemas', () => {
  it('normalizes email and full name', () => {
    const result = registerSchema.parse({
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
        email: 'user@example.com',
        password: 'short',
        fullName: 'Safe User',
        ownerId: 'attacker-controlled',
      }),
    ).toThrow();
  });
});
