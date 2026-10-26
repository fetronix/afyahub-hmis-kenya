import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

const root = resolve(here, '../..');

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function routeFiles(): string[] {
  const dir = resolve(root, 'src/routes');

  const walk = (path: string): string[] =>
    readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
      const full = resolve(path, entry.name);

      if (entry.isDirectory()) return walk(full);

      return entry.name.endsWith('.ts') ? [full] : [];
    });

  return [resolve(root, 'src/app.ts'), ...walk(dir)];
}

const routeSource = routeFiles()
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

function routeBlock(startMarker: string, length = 2200): string {
  const parsed = /^app\.(get|post|put|patch|delete)\(\s*'([^']+)'/.exec(
    startMarker.replace(/\s+/g, ' '),
  );

  if (!parsed) return '';

  const pattern = new RegExp(
    `(?:app|router)\\.${parsed[1]}\\(\\s*'${parsed[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`,
  );

  for (const file of routeFiles()) {
    const text = readFileSync(file, 'utf8');
    const match = pattern.exec(text);

    if (match) return text.slice(match.index, match.index + length);
  }

  return '';
}

describe('Route scope and claim integrity — regression tests', () => {
  it('1. Every route that had no guard now has one', async () => {
    const guarded: Array<[string, string]> = [
      ["app.get(\n    '/api/theatre-cases'", 'clinical.read'],
      ["app.post(\n    '/api/theatre-cases'", 'clinical.create'],
      ["app.put(\n    '/api/theatre-cases/:id'", 'clinical.update'],
      ["app.get(\n    '/api/radiology-orders'", 'clinical.read'],
      ["app.post(\n    '/api/radiology-orders'", 'clinical.create'],
      ["app.put(\n    '/api/radiology-orders/:id/report'", 'clinical.update'],
      ["app.get(\n    '/api/suppliers'", 'procurement.read'],
      ["app.get(\n    '/api/purchase-orders'", 'procurement.read'],
      ["app.post(\n    '/api/purchase-orders'", 'procurement.create'],
    ];

    for (const [marker, permission] of guarded) {
      const block = routeBlock(marker, 400);

      expect(block.length > 0, `Route ${marker.split('\n')[1]} is present`).toBe(true);
      expect(
        block.includes(permission),
        `Route ${marker.split('\n')[1]} requires ${permission}`,
      ).toBe(true);
    }
  });

  it('2. Facility and tenant identity come from the session', async () => {
    for (const marker of [
      "app.get(\n    '/api/theatre-cases'",
      "app.post(\n    '/api/theatre-cases'",
      "app.put(\n    '/api/theatre-cases/:id'",
      "app.get(\n    '/api/radiology-orders'",
      "app.post(\n    '/api/radiology-orders'",
      "app.put(\n    '/api/radiology-orders/:id/report'",
      "app.get(\n    '/api/purchase-orders'",
      "app.post(\n    '/api/purchase-orders'",
    ]) {
      const block = routeBlock(marker, 1600);

      expect(
        block.includes('requireScopedFacility'),
        `${marker.split('\n')[1]} resolves its facility from the authenticated scope`,
      ).toBe(true);
    }

    /* The helper moved to src/routes/shared/scoping.ts; check it there. */
    const scoping = source('src/routes/shared/scoping.ts');

    expect(scoping.includes('const requireScopedFacility = async'), 'The scope helper exists').toBe(
      true,
    );
    expect(
      scoping.includes('queries.getFacilityByIdScoped(') &&
        scoping.includes('resolveFacilityScope('),
      'The helper re-reads the facility through the scoped query',
    ).toBe(true);

    /*
     * A body-supplied id must never win. Both write routes spread the
     * body first and then override the identifiers.
     */
    for (const marker of [
      "app.post(\n    '/api/theatre-cases'",
      "app.post(\n    '/api/radiology-orders'",
      "app.post(\n    '/api/purchase-orders'",
    ]) {
      const block = routeBlock(marker, 1800);

      expect(
        /facilityId:\s*facility\.id/.test(block) && /tenantId:\s*facility\.tenantId/.test(block),
        `${marker.split('\n')[1]} overwrites facility and tenant from the session`,
      ).toBe(true);
    }

    /*
     * Object-level ownership: updating a case or reporting a study first
     * proves the row belongs to the facility.
     */
    expect(
      routeSource.includes('getTheatreCaseScoped') &&
        routeSource.includes('THEATRE_CASE_NOT_FOUND'),
      'A theatre update checks ownership before writing',
    ).toBe(true);
    expect(
      routeSource.includes('getRadiologyOrderScoped') &&
        routeSource.includes('RADIOLOGY_ORDER_NOT_FOUND'),
      'A radiology report checks ownership before writing',
    ).toBe(true);

    const suppliers = routeBlock("app.get(\n    '/api/suppliers'", 1800);

    expect(
      suppliers.includes('process.env') === false &&
        suppliers.includes('context.tenantId') &&
        suppliers.includes('TENANT_ACCESS_DENIED'),
      'Suppliers are filtered by the session tenant, not the query string',
    ).toBe(true);
  });

  it('3. No screen invents a facility', async () => {
    const modules = [
      'InventoryModule',
      'ProcurementModule',
      'RadiologyModule',
      'ReceptionQueueModule',
      'TheatreModule',
      'PublicHealthModule',
    ];

    for (const name of modules) {
      const text = code(`src/components/modules/${name}.tsx`);

      expect(
        !/facilityId:\s*currentFacility\?\.id\s*\|\|\s*1/.test(text),
        `${name} does not file records against facility 1`,
      ).toBe(true);
      expect(
        !/tenantId:\s*current(?:Facility|Tenant)\?\.\w+\s*\|\|\s*1/.test(text),
        `${name} does not file records against tenant 1`,
      ).toBe(true);
      expect(
        text.includes('currentFacility.id'),
        `${name} uses the selected facility explicitly`,
      ).toBe(true);
    }
  });

  it('4. The public-health screen claims nothing it cannot do', async () => {
    const text = code('src/components/modules/PublicHealthModule.tsx');

    const forbidden = [
      'Integrated with Kenya Digital Health Agency',
      'DHIS2 Auto-Push',
      'queued for KHIS submission',
      'Normal Trend',
      '2026-W40',
      'October 2026',
      'Epi-Week Surveillance Active',
    ];

    for (const phrase of forbidden) {
      expect(!text.includes(phrase), `The screen no longer says "${phrase}"`).toBe(true);
    }

    expect(
      text.includes('not a national submission') || text.includes('Local record only'),
      'The screen states that a report is not a national submission',
    ).toBe(true);

    expect(
      text.includes('transmitted to KHIS or DHIS2'),
      'Recording a case does not claim a transmission',
    ).toBe(true);

    expect(
      text.includes('This report is not produced by this build'),
      'The MOH 705 section shows the server refusal instead of an empty table',
    ).toBe(true);

    expect(
      text.includes('currentEpiWeek'),
      'The reporting period is computed, not hard-coded',
    ).toBe(true);

    expect(
      text.includes('Promise.allSettled'),
      'A 501 from one endpoint does not blank the other section',
    ).toBe(true);

    expect(
      text.includes('setReportsError') && text.includes('role="alert"'),
      'A failed read is surfaced on the screen',
    ).toBe(true);

    /*
     * The export button must be disabled when there is nothing real to
     * export — the old one downloaded JSON `null` and reported success.
     */
    expect(
      text.includes('disabled={mohSummary === null}'),
      'Export is unavailable without a real payload',
    ).toBe(true);
  });
});
