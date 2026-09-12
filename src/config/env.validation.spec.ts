import { validateEnv } from './env.validation';

describe('environment validation', () => {
  it('fails fast when production Supabase configuration is missing', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'production', CORS_ORIGINS: 'https://app.test' }),
    ).toThrow('SUPABASE_URL');
  });

  it('rejects wildcard production CORS', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        CORS_ORIGINS: '*',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_ANON_KEY: 'anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
        DATABASE_URL: 'postgresql://user:password@db.example.test:5432/app',
      }),
    ).toThrow('CORS_ORIGINS');
  });

  it('accepts an explicit production allowlist and required credentials', () => {
    expect(
      validateEnv({
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.safenet.test',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_ANON_KEY: 'anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-key',
        DATABASE_URL: 'postgresql://user:password@db.example.test:5432/app',
      }).NODE_ENV,
    ).toBe('production');
  });
});
