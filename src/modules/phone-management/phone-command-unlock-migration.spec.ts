import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20261125090000_phone_command_unlock/migration.sql',
  ),
  'utf8',
);

describe('Phone command unlock migration', () => {
  it('replaces the command type check with one that allows unlock', () => {
    expect(sql).toContain('DROP CONSTRAINT "phone_commands_type_check"');
    expect(sql).toContain(
      `CHECK ("command_type" IN ('lock', 'unlock', 'ring', 'warning'))`,
    );
  });
});
