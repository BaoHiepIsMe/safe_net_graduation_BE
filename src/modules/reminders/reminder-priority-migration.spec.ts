import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20261124090000_reminder_priority_completion/migration.sql',
  ),
  'utf8',
);

describe('Reminder priority and completion migration', () => {
  it('adds a constrained priority with a normal default', () => {
    expect(sql).toContain('"priority" VARCHAR(20) NOT NULL DEFAULT \'normal\'');
    expect(sql).toContain("('low', 'normal', 'high', 'urgent')");
  });

  it('allows completed logs and stamps completion consistently', () => {
    expect(sql).toContain("('due', 'completed', 'missed')");
    expect(sql).toContain('"reminder_logs_completed_at_check"');
  });

  it('contains no destructive data or schema operations', () => {
    expect(sql).not.toMatch(/DROP\s+(TABLE|SCHEMA|COLUMN)/i);
    expect(sql).not.toMatch(/TRUNCATE|DELETE\s+FROM|DISABLE\s+ROW\s+LEVEL/i);
  });
});
