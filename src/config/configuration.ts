export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  appName: process.env.APP_NAME || 'SafeNet-Backend',
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  database: {
    url: process.env.DATABASE_URL || '',
  },
  corsOrigins: (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    jwtSecret: process.env.SUPABASE_JWT_SECRET || '',
    authTimeoutMs: parseInt(
      process.env.SUPABASE_AUTH_TIMEOUT_MS || '10000',
      10,
    ),
  },
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    privateKey: process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : '',
  },
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL || '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
  },
  maxBodySize: process.env.MAX_BODY_SIZE || '1mb',
  calls: {
    ringTimeoutSeconds: parseInt(
      process.env.CALL_RING_TIMEOUT_SECONDS || '45',
      10,
    ),
  },
  signalLoss: {
    enabled: (process.env.SIGNAL_LOSS_ALERTS_ENABLED || 'true') !== 'false',
  },
  dailyStatus: {
    defaultTimezone: process.env.DAILY_STATUS_DEFAULT_TIMEZONE || 'UTC',
    generationGraceMinutes: parseInt(
      process.env.DAILY_STATUS_GENERATION_GRACE_MINUTES || '60',
      10,
    ),
  },
});
