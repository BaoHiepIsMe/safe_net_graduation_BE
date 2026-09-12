import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Foundation Phase 1 RLS migration', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/20260819010000_secure_foundation_phase1.sql',
    ),
    'utf8',
  ).toLowerCase();

  it('enables and forces RLS while revoking normal-client table access', () => {
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('force row level security');
    expect(sql).toContain('revoke all privileges on table');
    expect(sql).toContain('from anon, authenticated');
  });

  it('limits Phase 1 policies to the authenticated caller row', () => {
    expect(sql).toContain('(select auth.uid()) = id');
    expect(sql).toContain('(select auth.uid()) = user_id');
    expect(sql).not.toMatch(/using\s*\(\s*true\s*\)/);
  });

  it('does not grant normal clients access to Phase 2 tables', () => {
    expect(sql).not.toMatch(
      /grant\s+.*on\s+public\.families\s+to\s+authenticated/,
    );
    expect(sql).not.toMatch(
      /grant\s+.*on\s+public\.messages\s+to\s+authenticated/,
    );
  });

  it('keeps signup row creation atomic and does not ignore required-row failures', () => {
    const functionBody = sql.match(
      /create or replace function public\.handle_new_user\(\)[\s\S]*?\$\$;/,
    )?.[0];
    expect(functionBody).toContain('insert into public.profiles');
    expect(functionBody).toContain('insert into public.user_settings');
    expect(functionBody).toContain('insert into public.biometric_settings');
    expect(functionBody).not.toContain('on conflict');
    expect(functionBody).not.toContain('exception when');
  });
});

describe('Foundation migration ordering and server-maintained timestamps', () => {
  it('keeps forward migrations after the initial schema in dependency order', () => {
    expect(20260819000000).toBeLessThan(20260819010000);
    expect(20260819010000).toBeLessThan(20260819020000);
  });

  it('removes direct updated_at control and installs update triggers', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260819020000_server_managed_phase1_timestamps.sql',
      ),
      'utf8',
    ).toLowerCase();
    expect(sql.match(/revoke update \(updated_at\)/g)).toHaveLength(3);
    expect(sql.match(/before update on public\./g)).toHaveLength(3);
  });
});
