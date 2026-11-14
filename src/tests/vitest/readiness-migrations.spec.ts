import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJournal } from '../../../scripts/migration-journal.ts';
import { expectedMigrationCount } from '../../routes/system.routes.ts';

describe('readiness migration metadata', () => {
  it('reports the journal count rather than a stale hardcoded count', () => {
    expect(expectedMigrationCount()).toBe(readJournal().length);
  });
  it('reports an unavailable journal as unknown rather than zero', () => {
    const dir = mkdtempSync(join(tmpdir(), 'readiness-journal-'));
    try {
      expect(expectedMigrationCount(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
