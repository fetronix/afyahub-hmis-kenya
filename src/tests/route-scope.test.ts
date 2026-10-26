/**
 * JaliCare HMIS
 * Route scope and claim integrity — regression tests
 *
 * These assertions exist because of specific defects found during the
 * DHA audit on 2026-10-21, each of which a domain test could not see:
 *
 *   1. Six operational routes had no permission check. With no
 *      `facilityId` they returned every facility's rows — across
 *      tenants — to any authenticated account.
 *   2. Their write counterparts inserted `req.body` and trusted the
 *      facility and tenant ids inside it.
 *   3. Six screens sent `facilityId: currentFacility?.id || 1`, filing
 *      clinical and financial records against facility 1 when no
 *      facility was selected.
 *   4. The public-health screen claimed a DHA surveillance connection,
 *      a DHIS2 push and a KHIS queue, none of which exist, and labelled
 *      every row "Normal Trend" from no data.
 *
 * Run with: npx tsx src/tests/route-scope.test.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

/**
 * Source with comments removed.
 *
 * A comment that records a defect ("this used to POST facilityId || 1")
 * is documentation, not behaviour. These assertions are about what the
 * code does.
 */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const app = source('src/app.ts');

function routeBlock(startMarker: string, length = 2200): string {
  const index = app.indexOf(startMarker);

  if (index === -1) return '';

  return app.slice(index, index + length);
}

/* ============================================================
   1. Every route that had no guard now has one
   ============================================================ */

function testGuards(): void {
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

    assert(block.length > 0, `Route ${marker.split('\n')[1]} is present`);
    assert(block.includes(permission), `Route ${marker.split('\n')[1]} requires ${permission}`);
  }
}

/* ============================================================
   2. Facility and tenant identity come from the session
   ============================================================ */

function testScoping(): void {
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

    assert(
      block.includes('requireScopedFacility'),
      `${marker.split('\n')[1]} resolves its facility from the authenticated scope`,
    );
  }

  assert(app.includes('const requireScopedFacility = async'), 'The scope helper exists');
  assert(
    app.includes('queries.getFacilityByIdScoped(') && app.includes('resolveFacilityScope('),
    'The helper re-reads the facility through the scoped query',
  );

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

    assert(
      /facilityId:\s*facility\.id/.test(block) && /tenantId:\s*facility\.tenantId/.test(block),
      `${marker.split('\n')[1]} overwrites facility and tenant from the session`,
    );
  }

  /*
   * Object-level ownership: updating a case or reporting a study first
   * proves the row belongs to the facility.
   */
  assert(
    app.includes('getTheatreCaseScoped') && app.includes('THEATRE_CASE_NOT_FOUND'),
    'A theatre update checks ownership before writing',
  );
  assert(
    app.includes('getRadiologyOrderScoped') && app.includes('RADIOLOGY_ORDER_NOT_FOUND'),
    'A radiology report checks ownership before writing',
  );

  const suppliers = routeBlock("app.get(\n    '/api/suppliers'", 1800);

  assert(
    suppliers.includes('process.env') === false &&
      suppliers.includes('context.tenantId') &&
      suppliers.includes('TENANT_ACCESS_DENIED'),
    'Suppliers are filtered by the session tenant, not the query string',
  );
}

/* ============================================================
   3. No screen invents a facility
   ============================================================ */

function testNoFacilityFallback(): void {
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

    assert(
      !/facilityId:\s*currentFacility\?\.id\s*\|\|\s*1/.test(text),
      `${name} does not file records against facility 1`,
    );
    assert(
      !/tenantId:\s*current(?:Facility|Tenant)\?\.\w+\s*\|\|\s*1/.test(text),
      `${name} does not file records against tenant 1`,
    );
    assert(text.includes('currentFacility.id'), `${name} uses the selected facility explicitly`);
  }
}

/* ============================================================
   4. The public-health screen claims nothing it cannot do
   ============================================================ */

function testPublicHealthHonesty(): void {
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
    assert(!text.includes(phrase), `The screen no longer says "${phrase}"`);
  }

  assert(
    text.includes('not a national submission') || text.includes('Local record only'),
    'The screen states that a report is not a national submission',
  );

  assert(
    text.includes('transmitted to KHIS or DHIS2'),
    'Recording a case does not claim a transmission',
  );

  assert(
    text.includes('This report is not produced by this build'),
    'The MOH 705 section shows the server refusal instead of an empty table',
  );

  assert(text.includes('currentEpiWeek'), 'The reporting period is computed, not hard-coded');

  assert(
    text.includes('Promise.allSettled'),
    'A 501 from one endpoint does not blank the other section',
  );

  assert(
    text.includes('setReportsError') && text.includes('role="alert"'),
    'A failed read is surfaced on the screen',
  );

  /*
   * The export button must be disabled when there is nothing real to
   * export — the old one downloaded JSON `null` and reported success.
   */
  assert(
    text.includes('disabled={mohSummary === null}'),
    'Export is unavailable without a real payload',
  );
}

/* ============================================================
   RUN
   ============================================================ */

function run(): void {
  console.log('');
  console.log('==============================================');
  console.log('ROUTE SCOPE — REGRESSION TESTS');
  console.log('==============================================');

  testGuards();
  console.log('  1. The nine unguarded operational routes now require a permission');
  testScoping();
  console.log('  2. Facility, tenant and object ownership come from the session');
  testNoFacilityFallback();
  console.log('  3. No screen files a record against facility 1');
  testPublicHealthHonesty();
  console.log('  4. The surveillance screen claims only what it can do');

  console.log('');
  console.log('==============================================');
  console.log(`ROUTE SCOPE TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('ROUTE SCOPE TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
