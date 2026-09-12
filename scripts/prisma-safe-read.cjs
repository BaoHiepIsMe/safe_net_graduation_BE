require('dotenv/config');

const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../dist/src/generated/prisma/client.js');

const expectedApplicationTables = [
  'biometric_settings',
  'call_logs',
  'call_active_participants',
  'cameras',
  'conversation_members',
  'conversations',
  'current_locations',
  'daily_status_reports',
  'devices',
  'fall_events',
  'families',
  'family_members',
  'geofence_events',
  'geofence_members',
  'geofences',
  'geofence_states',
  'locations',
  'messages',
  'notifications',
  'notification_deliveries',
  'phone_commands',
  'phone_rules',
  'phone_usage_logs',
  'profiles',
  'reminder_logs',
  'reminder_targets',
  'reminders',
  'sos_contacts',
  'sos_events',
  'sos_recipients',
  'user_settings',
];

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    await prisma.profile.findFirst({ select: { id: true } });
    const [state] = await prisma.$queryRawUnsafe(`
      SELECT
        (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public') AS policies,
        (SELECT count(*)::int FROM information_schema.triggers WHERE trigger_schema = 'public') AS triggers,
        (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public' AND rowsecurity) AS rls_tables,
        (SELECT count(*)::int FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = '_prisma_migrations') AS prisma_history
    `);
    const rlsState = await prisma.$queryRawUnsafe(`
      SELECT tables.tablename, tables.rowsecurity, classes.relforcerowsecurity AS forcerowsecurity
      FROM pg_tables AS tables
      JOIN pg_class AS classes ON classes.relname = tables.tablename
      JOIN pg_namespace AS namespaces ON namespaces.oid = classes.relnamespace
        AND namespaces.nspname = tables.schemaname
      WHERE tables.schemaname = 'public'
        AND tables.tablename = ANY($1::text[])
      ORDER BY tables.tablename
    `, expectedApplicationTables);
    const directTableGrants = await prisma.$queryRawUnsafe(`
      SELECT table_name, grantee, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
        AND grantee IN ('anon', 'authenticated')
      ORDER BY table_name, grantee, privilege_type
    `, expectedApplicationTables);
    const present = new Set(rlsState.map((row) => row.tablename));
    const missingTables = expectedApplicationTables.filter(
      (table) => !present.has(table),
    );
    const missingForcedRls = rlsState
      .filter((row) => !row.rowsecurity || !row.forcerowsecurity)
      .map((row) => row.tablename);

    console.log(
      JSON.stringify({
        database: 'available',
        ...state,
        expected_application_tables: expectedApplicationTables.length,
        missing_tables: missingTables,
        missing_forced_rls: missingForcedRls,
        direct_client_table_grants: directTableGrants,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Database read failed');
  process.exitCode = 1;
});
