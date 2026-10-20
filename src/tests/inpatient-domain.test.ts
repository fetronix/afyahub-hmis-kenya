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
  assert(
    actual === expected,
    `${label} (expected ${String(expected)}, got ${String(actual)})`,
  );
}

/* ============================================================
   1. BED STATUS CONTRACT
   ============================================================ */

function testBedStatusContract(): void {
  const expected = [
    'Available',
    'Occupied',
    'Cleaning',
    'Maintenance',
    'Reserved',
  ];

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
    assert(
      BED_STATUS_SETTABLE.has(settable),
      `'${settable}' remains directly settable`,
    );
  }

  console.log('  ✓ Bed status contract passed');
}

/* ============================================================
   2. ADMISSION STATUS CONTRACT
   ============================================================ */

function testAdmissionStatusContract(): void {
  assertEqual(
    ADMISSION_STATUSES.join(','),
    'Admitted,Discharged',
    'admission status vocabulary',
  );

  console.log('  ✓ Admission status contract passed');
}

/* ============================================================
   3. DOMAIN ERROR STATUS MAPPING
   ============================================================ */

function testDomainErrors(): void {
  const invalid = new InpatientDomainError(
    'INVALID_INPUT',
    'bad input',
    400,
  );

  assertEqual(invalid.status, 400, 'invalid input maps to HTTP 400');
  assertEqual(invalid.code, 'INVALID_INPUT', 'invalid input keeps its code');
  assert(
    invalid instanceof Error,
    'InpatientDomainError is an Error subclass',
  );
  assertEqual(invalid.name, 'InpatientDomainError', 'error name is stable');

  assertEqual(
    new InpatientDomainError('BED_OCCUPIED', 'occupied', 409).status,
    409,
    'bed conflict maps to HTTP 409',
  );

  assertEqual(
    new InpatientDomainError(
      'ADMISSION_ALREADY_CLOSED',
      'closed',
      409,
    ).status,
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
  assert(
    doctor.includes('inpatient.discharge'),
    'DOCTOR can discharge patients',
  );

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
function routeIsGuarded(
  source: string,
  routePath: string,
  permission: string,
): boolean {
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

function routeAcceptsAuthRequest(
  source: string,
  routePath: string,
  permission: string,
): boolean {
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
  const appSource = readFileSync(
    resolve(import.meta.dirname, '../app.ts'),
    'utf8',
  );

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
    assert(
      appSource.includes(expectation.route),
      `route ${expectation.route} exists`,
    );

    assert(
      routeIsGuarded(appSource, expectation.route, expectation.permission),
      `route ${expectation.route} enforces ${expectation.permission}`,
    );

    assert(
      routeAcceptsAuthRequest(
        appSource,
        expectation.route,
        expectation.permission,
      ),
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
    assert(
      !appSource.includes(legacy),
      `legacy unscoped call ${legacy} is gone`,
    );
  }

  // Tenancy must never be read from the request body.
  assert(
    !appSource.includes('req.body.tenantId'),
    'inpatient routes never read tenantId from the body',
  );

  console.log('  ✓ Route wiring passed');
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
