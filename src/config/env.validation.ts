import { z } from 'zod';

const optionalNonEmptyString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);

export const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    APP_NAME: z.string().default('SafeNet-Backend'),
    API_PREFIX: z.string().default('api/v1'),
    CORS_ORIGIN: z.string().optional(),
    CORS_ORIGINS: z.string().optional(),
    DATABASE_URL: optionalUrl,
    SUPABASE_URL: optionalUrl,
    SUPABASE_ANON_KEY: optionalNonEmptyString,
    SUPABASE_SERVICE_ROLE_KEY: optionalNonEmptyString,
    SUPABASE_JWT_SECRET: optionalNonEmptyString,
    SUPABASE_AUTH_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(60000)
      .default(10000),
    FIREBASE_PROJECT_ID: optionalNonEmptyString,
    FIREBASE_CLIENT_EMAIL: optionalNonEmptyString,
    FIREBASE_PRIVATE_KEY: optionalNonEmptyString,
    SIGNAL_LOSS_ALERTS_ENABLED: z.enum(['true', 'false']).default('true'),
    THROTTLE_TTL: z.coerce.number().int().positive().default(60000),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
    MAX_BODY_SIZE: z
      .string()
      .regex(/^\d+(?:kb|mb)$/i)
      .default('1mb'),
    CALL_RING_TIMEOUT_SECONDS: z.coerce
      .number()
      .int()
      .min(15)
      .max(300)
      .default(45),
    DAILY_STATUS_DEFAULT_TIMEZONE: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .default('UTC')
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
          return true;
        } catch {
          return false;
        }
      }, 'Invalid IANA timezone'),
    DAILY_STATUS_GENERATION_GRACE_MINUTES: z.coerce
      .number()
      .int()
      .min(0)
      .max(720)
      .default(60),
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV !== 'production') return;

    const requiredProductionFields = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'DATABASE_URL',
    ] as const;

    for (const field of requiredProductionFields) {
      if (!config[field]) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is required in production`,
        });
      }
    }

    const origins = config.CORS_ORIGINS || config.CORS_ORIGIN;
    if (
      !origins ||
      origins.split(',').some((origin) => origin.trim() === '*')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'A non-wildcard CORS allowlist is required in production',
      });
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw new Error(`Environment validation failed: ${errorDetails}`);
  }
  return result.data;
}
