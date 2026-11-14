import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const sql = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn() }));
vi.mock('../db/index.ts', () => ({ pool: { connect: sql.connect, query: sql.query }, db: {} }));
import { inspectBatch } from '../budget-planning/planning.service.ts';
beforeEach(() => {
  vi.resetAllMocks();
  sql.connect.mockResolvedValue({ query: sql.query, release: sql.release });
});
describe.skipIf(!process.env.SYRONA_SOURCE_DIR)(
  'read-only inspection of the exact supplied source',
  () => {
    it('scopes the existing batch and returns verified mappings without preview, audit or plan writes', async () => {
      const source_bytes = await readFile(
        path.join(process.env.SYRONA_SOURCE_DIR!, 'Syrona_Stationery.csv'),
      );
      sql.query.mockImplementation(async (query: string, args?: unknown[]) => {
        if (query.startsWith('SELECT * FROM planning_import_batches')) {
          expect(args).toEqual([7, 11, 13]);
          expect(query).toContain('tenant_id=$2 AND facility_id=$3');
          return {
            rows: [
              {
                id: 7,
                status: 'UPLOADED',
                source_bytes,
                filename: 'source.csv',
                mime: 'text/csv',
                sha256: 'do-not-trust-a-stale-stored-hash',
              },
            ],
          };
        }
        if (['BEGIN', 'COMMIT'].includes(query)) return { rows: [] };
        throw Error('Unexpected write or unrelated query: ' + query);
      });
      const result = await inspectBatch({ tenantId: 11, facilityId: 13, actorId: 17 }, 7);
      expect(result.sheets[0].rows).toBe(296);
      expect(result.sheets[0].preview).toHaveLength(40);
      expect(result.verifiedMapping?.mappings.map((m) => [m.startRow, m.endRow])).toEqual([
        [9, 141],
        [145, 184],
        [186, 244],
      ]);
      expect(sql.query.mock.calls).toHaveLength(3);
      expect(sql.release).toHaveBeenCalledOnce();
    });
  },
);
