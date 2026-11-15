import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPORT_CATEGORIES } from '../../reporting/report-catalogue.ts';
import { REPORT_ENGINES } from '../../reporting/report-centre.types.ts';

type MatrixRow = {
  id: string;
  name: string;
  category: string;
  intendedUsers: string;
  priorityGroup: string;
  sourceModule: string;
  requiredDatabaseEntities: Array<{ entity: string; schema: string }>;
  existingQuerySources: string;
  existingApi: string;
  engine: string | null;
  workflow: string | null;
  availableFilters: string[];
  exports: string[];
  letterhead: string;
  functionalStatus: string;
  missingImplementation: string;
  dependenciesAndRisks: string;
};
const read = (name: string) =>
  JSON.parse(readFileSync(`docs/audits/REPORTING_PROGRAMME_${name}_MATRIX.json`, 'utf8'))
    .entries as MatrixRow[];
describe('Reporting programme requirements and completion claims', () => {
  it('keeps the 144-entry preimplementation baseline, not a reclassified menu count', () => {
    const rows = read('BASELINE');
    expect(rows).toHaveLength(144);
    expect(rows.filter((r) => r.engine || r.workflow)).toHaveLength(27);
    expect(rows.filter((r) => !r.engine && !r.workflow)).toHaveLength(117);
    expect(rows.some((r) => r.engine === 'inventory-movements')).toBe(false);
  });
  it('maps every current catalogue entry once and supplies each required audit field', () => {
    const rows = read('CURRENT'),
      entries = REPORT_CATEGORIES.flatMap((c) => c.reports);
    expect(rows.map((r) => r.id).sort()).toEqual(entries.map((e) => e.id).sort());
    expect(new Set(rows.map((r) => r.id)).size).toBe(144);
    expect(new Set(rows.map((r) => r.priorityGroup)).size).toBe(8);
    for (const row of rows) {
      for (const field of [
        'name',
        'category',
        'intendedUsers',
        'sourceModule',
        'existingApi',
        'letterhead',
        'functionalStatus',
        'missingImplementation',
        'dependenciesAndRisks',
      ] as const)
        expect(row[field].length, row.id + ':' + field).toBeGreaterThan(0);
      for (const entity of row.requiredDatabaseEntities)
        expect(existsSync(entity.schema), row.id + ':' + entity.entity).toBe(true);
    }
  });
  it('keeps unaccepted requirements unavailable and only the first new register partial', () => {
    const rows = read('CURRENT');
    expect(rows.filter((r) => r.engine || r.workflow)).toHaveLength(28);
    expect(rows.filter((r) => !r.engine && !r.workflow)).toHaveLength(116);
    expect(
      rows.every(
        (r) => r.functionalStatus.startsWith('PARTIAL') || r.functionalStatus === 'UNAVAILABLE',
      ),
    ).toBe(true);
    const report = rows.find((r) => r.engine === 'inventory-movements')!;
    expect(report.existingQuerySources).toBe('inventory_movements, inventory_items');
    expect(report.exports).toEqual(['PDF', 'XLSX', 'CSV']);
    expect(report.missingImplementation).toContain('historical opening/closing');
  });
  it('reuses strict shared filters, existing inventory permissions, static columns and common export paths', () => {
    const def = REPORT_ENGINES['inventory-movements'];
    expect(def.dateRangeRequired).toBe(true);
    expect(def.inventoryItemFilter).toBe(true);
    expect(def.departmentFilter).toBeUndefined();
    expect(def.permissions).toEqual(['reports.read', 'inventory.read']);
    expect(def.notes.join(' ')).toMatch(/Different items\/units are never totalled/);
    expect(def.columns.some((c) => c.key === 'itemNetQuantity')).toBe(true);
  });
});
