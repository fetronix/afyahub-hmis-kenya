/**
 * JaliCare HMIS
 * Inpatient & Ward — contract and wiring tests
 *
 * These tests do not need a database. They pin down the contracts that
 * the 1A hardening work established, so that a later change cannot
 * silently re-open the defects:
 *
 *   1. 'Occupied' can never be set through the bed-status endpoint.
 *   2. The status vocabulary the UI renders matches the server.
 *   3. InpatientDomainError carries the intended HTTP status.
 *   4. Doctors may admit and discharge; nurses may admit but not discharge.
 *   5. Every inpatient route enforces a permission and an auth context.
 *
 * Run with: npx tsx src/tests/inpatient-domain.test.ts
 */

import {
  ADMISSION_STATUSES,
  BED_STATUSES,
  BED_STATUS_SETTABLE,
  InpatientDomainError,
} from '../db/inpatient-contracts.ts';

import { STAFF_ROLE_CATALOGUE } from '../auth/staff-role-catalogue.ts';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(actual === expected, `${label} (expected ${String(expected)}, got ${String(actual)})`);
}

/* ============================================================
   1. BED STATUS CONTRACT
   ============================================================ */

function testBedStatusContract(): void {
  const expected = ['Available', 'Occupied', 'Cleaning', 'Maintenance', 'Reserved'];

  assertEqual(
    BED_STATUSES.join(','),
    expected.join(','),
    'bed status vocabulary matches the UI contract',
  );

  // Occupancy must only ever be created by admitting a patient.
  assert(
    !BED_STATUS_SETTABLE.has('Occupied'),
    "'Occupied' is not directly settable through the bed-status endpoint",
  );

  for (const settable of ['Available', 'Cleaning', 'Maintenance', 'Reserved']) {
    assert(BED_STATUS_SETTABLE.has(settable), `'${settable}' remains directly settable`);
  }

  console.log('  ✓ Bed status contract passed');
}

/* ============================================================
   2. ADMISSION STATUS CONTRACT
   ============================================================ */

function testAdmissionStatusContract(): void {
  assertEqual(ADMISSION_STATUSES.join(','), 'Admitted,Discharged', 'admission status vocabulary');

  console.log('  ✓ Admission status contract passed');
}

/* ============================================================
   3. DOMAIN ERROR STATUS MAPPING
   ============================================================ */

function testDomainErrors(): void {
  const invalid = new InpatientDomainError('INVALID_INPUT', 'bad input', 400);

  assertEqual(invalid.status, 400, 'invalid input maps to HTTP 400');
  assertEqual(invalid.code, 'INVALID_INPUT', 'invalid input keeps its code');
  assert(invalid instanceof Error, 'InpatientDomainError is an Error subclass');
  assertEqual(invalid.name, 'InpatientDomainError', 'error name is stable');

  assertEqual(
    new InpatientDomainError('BED_OCCUPIED', 'occupied', 409).status,
    409,
    'bed conflict maps to HTTP 409',
  );

  assertEqual(
    new InpatientDomainError('ADMISSION_ALREADY_CLOSED', 'closed', 409).status,
    409,
    'closed admission maps to HTTP 409',
  );

  assertEqual(
    new InpatientDomainError('BED_NOT_FOUND', 'missing', 404).status,
    404,
    'missing bed maps to HTTP 404',
  );

  console.log('  ✓ Domain error status mapping passed');
}

/* ============================================================
   4. ROLE PERMISSION CONTRACT
   ============================================================ */

function permissionsFor(roleName: string): readonly string[] {
  const role = STAFF_ROLE_CATALOGUE.find((entry) => entry.name === roleName);

  if (!role) {
    throw new Error(`FAILED: role ${roleName} is missing from the catalogue`);
  }

  return role.permissions;
}

function testRolePermissions(): void {
  const doctor = permissionsFor('DOCTOR');

  assert(doctor.includes('inpatient.read'), 'DOCTOR can read inpatient');
  assert(doctor.includes('inpatient.admit'), 'DOCTOR can admit patients');
  assert(doctor.includes('inpatient.discharge'), 'DOCTOR can discharge patients');

  const nurse = permissionsFor('NURSE');

  assert(nurse.includes('inpatient.read'), 'NURSE can read inpatient');
  assert(nurse.includes('inpatient.admit'), 'NURSE can admit patients');
  assert(
    !nurse.includes('inpatient.discharge'),
    'NURSE cannot discharge patients (doctor authorisation)',
  );

  console.log('  ✓ Role permission contract passed');
}

/* ============================================================
   5. ROUTE WIRING
   ============================================================ */

/**
 * True when at least one registration of `routePath` is followed by the
 * given permission guard. Scanning every occurrence is required because
 * `app.use('/api/wards', requireFacilityModule(...))` mentions the same
 * path earlier in the file without any permission check.
 */
/**
 * Remove all whitespace from a source string.
 *
 * The route-wiring assertions below used to match `app.post(\n    '/api/wards',`
 * including the newline and the exact indentation. That passes only while
 * `src/app.ts` keeps that formatting: reformat it, or extract the route into
 * a router, and a green test turns red with nothing about security having
 * changed.
 *
 * Stripping whitespace from both sides makes the assertion about *which
 * handler is registered with which permission*, independent of column
 * numbers and line breaks. The behavioural equivalent - does the server
 * actually refuse an unauthenticated caller - lives in
 * `src/tests/vitest/route-authorization.spec.ts`.
 */
function stripWhitespace(source: string): string {
  return source.replace(/\s+/g, '');
}

function routeIsGuarded(source: string, routePath: string, permission: string): boolean {
  let index = source.indexOf(routePath);

  while (index >= 0) {
    const block = source.slice(index, index + 200);

    if (block.includes(`requirePermission('${permission}')`)) {
      return true;
    }

    index = source.indexOf(routePath, index + 1);
  }

  return false;
}

function routeAcceptsAuthRequest(source: string, routePath: string, permission: string): boolean {
  let index = source.indexOf(routePath);

  while (index >= 0) {
    const block = source.slice(index, index + 300);

    if (
      block.includes(`requirePermission('${permission}')`) &&
      block.includes('req: AuthRequest')
    ) {
      return true;
    }

    index = source.indexOf(routePath, index + 1);
  }

  return false;
}

function testRouteWiring(): void {
  const appSource = readFileSync(resolve(import.meta.dirname, '../app.ts'), 'utf8');

  const expectations: Array<{ route: string; permission: string }> = [
    { route: "'/api/wards'", permission: 'inpatient.read' },
    { route: "'/api/beds'", permission: 'inpatient.read' },
    { route: "'/api/beds/:id/status'", permission: 'inpatient.admit' },
    { route: "'/api/beds/:id/release'", permission: 'inpatient.admit' },
    { route: "'/api/admissions'", permission: 'inpatient.read' },
    { route: "'/api/admissions'", permission: 'inpatient.admit' },
    {
      route: "'/api/admissions/:id/discharge'",
      permission: 'inpatient.discharge',
    },
  ];

  for (const expectation of expectations) {
    assert(appSource.includes(expectation.route), `route ${expectation.route} exists`);

    assert(
      routeIsGuarded(appSource, expectation.route, expectation.permission),
      `route ${expectation.route} enforces ${expectation.permission}`,
    );

    assert(
      routeAcceptsAuthRequest(appSource, expectation.route, expectation.permission),
      `route ${expectation.route} with ${expectation.permission} receives an AuthRequest`,
    );
  }

  // The old unscoped helpers must no longer be referenced by routes.
  for (const legacy of [
    'queries.getWards(',
    'queries.getBeds(',
    'queries.getAdmissions(',
    'queries.createAdmission(',
    'queries.dischargeAdmission(',
    'queries.updateBedStatus(',
  ]) {
    assert(!appSource.includes(legacy), `legacy unscoped call ${legacy} is gone`);
  }

  // Tenancy must never be read from the request body.
  assert(
    !appSource.includes('req.body.tenantId'),
    'inpatient routes never read tenantId from the body',
  );

  console.log('  ✓ Route wiring passed');
}

/* ============================================================
   6. WARD AND BED SET-UP
   ============================================================ */

/**
 * The board was read-only: a facility with no demo seed had an empty
 * ward dropdown and no way to fill it. These tests pin the write path
 * that fixes it, and the two properties that matter most:
 *
 *   - a rate nobody entered is stored as NULL, never as the schema's
 *     historical 1500.00;
 *   - a ward or bed that has held a patient cannot be deleted.
 */
function testWardBedSetup(): void {
  const appSource = readFileSync(resolve(import.meta.dirname, '../app.ts'), 'utf8');

  const service = readFileSync(
    resolve(import.meta.dirname, '../inpatient/ward-bed.service.ts'),
    'utf8',
  );

  const seed = readFileSync(resolve(import.meta.dirname, '../seeds/permissions.ts'), 'utf8');

  const screen = readFileSync(
    resolve(import.meta.dirname, '../components/modules/InpatientModule.tsx'),
    'utf8',
  );

  const client = readFileSync(resolve(import.meta.dirname, '../api/client.ts'), 'utf8');

  /* ---- permissions ---- */
  const requiredPermissions = [
    'inpatient.wards.create',
    'inpatient.wards.update',
    'inpatient.wards.delete',
    'inpatient.beds.create',
    'inpatient.beds.update',
    'inpatient.beds.delete',
  ];

  for (const permission of requiredPermissions) {
    assert(seed.includes(`'${permission}'`), `${permission} is in the permission seed`);
  }

  /*
   * Reading stays on `inpatient.read`. A second read code would give a
   * user the board but not the ward list.
   */
  assert(
    !seed.includes("'inpatient.wards.read'") && !seed.includes("'inpatient.beds.read'"),
    'reading wards and beds uses the existing inpatient.read',
  );

  /* ---- routes ---- */
  const routes: Array<{ route: string; method: string; permission: string }> = [
    { route: "'/api/wards'", method: 'app.post', permission: 'inpatient.wards.create' },
    { route: "'/api/wards/:id'", method: 'app.put', permission: 'inpatient.wards.update' },
    { route: "'/api/wards/:id'", method: 'app.delete', permission: 'inpatient.wards.delete' },
    { route: "'/api/beds'", method: 'app.post', permission: 'inpatient.beds.create' },
    { route: "'/api/beds/:id'", method: 'app.put', permission: 'inpatient.beds.update' },
    { route: "'/api/beds/:id'", method: 'app.delete', permission: 'inpatient.beds.delete' },
  ];

  const flatApp = stripWhitespace(appSource);

  for (const { route, method, permission } of routes) {
    const marker = stripWhitespace(`${method}(${route},`);

    assert(flatApp.includes(marker), `${method} ${route} is registered`);

    const index = flatApp.indexOf(marker);
    const block = flatApp.slice(index, index + 250);

    assert(
      block.includes(`requirePermission('${permission}')`),
      `${method} ${route} enforces ${permission}`,
    );
  }

  /* ---- no invented prices ---- */
  assert(
    !service.includes("?? '1500.00'") && !service.includes("?? '1800.00'"),
    'the service never invents a ward or bed price',
  );

  assert(service.includes('optionalMoney('), 'rates go through a validator that can return NULL');

  assert(
    service.includes('dailyRate,') && service.includes('dailyCharge,'),
    'the create paths pass the rate explicitly so the column default never applies',
  );

  assert(
    service.includes('totalBeds: 0,'),
    'a new ward starts with a counted capacity of zero, not the column default of 20',
  );

  assert(service.includes('syncWardCapacity('), "a ward's capacity is recounted from its beds");

  /* ---- duplicate and history handling ---- */
  assert(
    service.includes("pgErrorCode(error) === '23505'"),
    'a duplicate ward code or bed number is recognised from the unique index',
  );

  assert(
    service.includes("'WARD_CODE_EXISTS'") && service.includes("'BED_NUMBER_EXISTS'"),
    'duplicates are reported by name rather than as a 500',
  );

  assert(
    service.includes("'WARD_HAS_HISTORY'") && service.includes("'BED_HAS_HISTORY'"),
    'a ward or bed with admission history refuses deletion',
  );

  assert(
    service.includes('Retire it instead') || service.includes('Set it to Maintenance instead'),
    'the refusal tells the user what to do instead',
  );

  assert(
    service.includes('db.transaction('),
    'deleting a ward removes its beds in one transaction',
  );

  /* ---- scope ---- */
  assert(
    service.includes('resolveFacilityScope('),
    'the facility is resolved from the session scope',
  );

  assert(!service.includes('req.body'), 'the service reads no request object');

  assert(
    !appSource.includes('req.body.facilityId)'),
    'ward creation never trusts a facility from the body as the scope',
  );

  /* ---- the screen ---- */
  for (const call of [
    'api.createWard(',
    'api.updateWard(',
    'api.deleteWard(',
    'api.createBeds(',
    'api.updateBed(',
    'api.deleteBed(',
  ]) {
    assert(screen.includes(call), `the screen calls ${call}`);
  }

  assert(
    screen.includes("can('inpatient.wards.create')"),
    'the Add Ward button is gated on its permission',
  );

  assert(
    screen.includes('No wards have been set up for this facility yet'),
    'an empty facility is told why the dropdown is empty',
  );

  assert(screen.includes('Create the first ward'), 'and is given the way out of it');

  assert(
    screen.includes('activeWards') && screen.includes("b.status === 'Available'"),
    'the admit modal offers only active wards and available beds',
  );

  assert(
    !screen.includes('Severe community acquired pneumonia'),
    'the admission form ships no pre-filled diagnosis',
  );

  for (const method of [
    'createWard:',
    'updateWard:',
    'deleteWard:',
    'createBeds:',
    'updateBed:',
    'deleteBed:',
  ]) {
    assert(client.includes(method), `the API client exposes ${method}`);
  }

  console.log('  ✓ Ward and bed set-up passed');
}

/* ============================================================
   RUNNER
   ============================================================ */

function run(): void {
  console.log('');
  console.log('==============================================');
  console.log('INPATIENT DOMAIN CONTRACT TESTS');
  console.log('==============================================');
  console.log('');

  testBedStatusContract();
  testAdmissionStatusContract();
  testDomainErrors();
  testRolePermissions();
  testRouteWiring();
  testWardBedSetup();

  console.log('');
  console.log('==============================================');
  console.log(`INPATIENT TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('INPATIENT TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
