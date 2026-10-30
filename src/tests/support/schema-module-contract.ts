import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Relations } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as publicSchema from '../../db/schema.ts';
import { relationContract, tableContract } from './schema-contract.ts';

const baseline = JSON.parse(
  readFileSync(
    new URL('../fixtures/schema-contract-before-extraction.json', import.meta.url),
    'utf8',
  ),
) as { tables: Record<string, unknown>; relations: Record<string, unknown> };
const barrel = publicSchema as Record<string, unknown>;

/** Check every extracted declaration against the original, and against the public barrel. */
export function schemaModuleContract(
  name: string,
  module: Record<string, unknown>,
  names: readonly string[],
  kind: 'tables' | 'relations' = 'tables',
): void {
  describe(`${name} schema module`, () => {
    it('exports the complete domain and the same objects as the public barrel', () => {
      expect(Object.keys(module).sort()).toEqual([...names].sort());
      for (const key of names) expect(module[key]).toBe(barrel[key]);
    });

    it.each(names)('%s retains its pre-extraction metadata', (key) => {
      expect(baseline[kind][key]).toBeDefined();
      const actual =
        kind === 'tables'
          ? tableContract(module[key] as PgTable)
          : relationContract(module[key] as Relations);
      expect(actual).toEqual(baseline[kind][key]);
    });
  });
}
