import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  findTrackedDatabaseBackups,
  isDatabaseBackupPath,
} from '../../scripts/check-tracked-database-backups.mjs';

describe('tracked database backup guard', () => {
  it('detects common database archive extensions and backup directories case-insensitively', () => {
    const blocked = [
      'data.dump',
      'archive.DUMP.gz',
      'archive.dump.gz.gpg',
      'data.pgdump',
      'legacy.psql',
      'patients.sqlite3',
      'patients.db',
      'patients.db.gz.gpg',
      'data.sql.gz',
      'data.sql.zst',
      'data.sql.lz4',
      'data.sql.zip.gpg',
      'backups/data.bin',
      'nested/local-backups/archive.bin',
      'nested\\dumps\\archive.bin',
    ];
    expect(blocked.every(isDatabaseBackupPath)).toBe(true);
    expect(findTrackedDatabaseBackups(blocked.join('\0') + '\0')).toEqual(blocked);
  });

  it('does not flag SQL migrations, database test source or unrelated backup words', () => {
    for (const safe of [
      'drizzle/0064_staff_appointment_lifecycle.sql',
      'src/tests/integration/appointment-booking.db.spec.ts',
      'scripts/check-tracked-database-backups.mjs',
      'docs/security/DATA-EXPOSURE.md',
      'src/ui/backup-button.tsx',
    ])
      expect(isDatabaseBackupPath(safe), safe).toBe(false);
  });

  it('runs against the checked-in index without claiming the history is clean', () => {
    const output = execFileSync(process.execPath, ['scripts/check-tracked-database-backups.mjs'], {
      encoding: 'utf8',
    });
    expect(output).toContain('Git history and external copies are NOT checked');
  });
});
