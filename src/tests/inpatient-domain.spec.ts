import {
  ADMISSION_STATUSES,
  BED_STATUSES,
  BED_STATUS_SETTABLE,
  InpatientDomainError,
} from '../db/inpatient-contracts.ts';
import { STAFF_ROLE_CATALOGUE } from '../auth/staff-role-catalogue.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function permissionsFor(roleName: string): readonly string[] {
  const role = STAFF_ROLE_CATALOGUE.find((entry) => entry.name === roleName);

  if (!role) {
    throw new Error(`FAILED: role ${roleName} is missing from the catalogue`);
  }

  return role.permissions;
}

function stripWhitespace(source: string): string {
  return source.replace(/\s+/g, '');
}

function asRouterPath(routePath: string): string {
  return routePath.replace(/^'\/api/, "'");
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

describe('Inpatient & Ward — contract and wiring tests', () => {
  it('1. BED STATUS CONTRACT', async () => {
    const expected = ['Available', 'Occupied', 'Cleaning', 'Maintenance', 'Reserved'];

    expect(BED_STATUSES.join(','), 'bed status vocabulary matches the UI contract').toBe(
      expected.join(','),
    );

    // Occupancy must only ever be created by admitting a patient.
    expect(
      !BED_STATUS_SETTABLE.has('Occupied'),
      "'Occupied' is not directly settable through the bed-status endpoint",
    ).toBe(true);

    for (const settable of ['Available', 'Cleaning', 'Maintenance', 'Reserved']) {
      expect(BED_STATUS_SETTABLE.has(settable), `'${settable}' remains directly settable`).toBe(
        true,
      );
    }
  });

  it('2. ADMISSION STATUS CONTRACT', async () => {
    expect(ADMISSION_STATUSES.join(','), 'admission status vocabulary').toBe('Admitted,Discharged');
  });

  it('3. DOMAIN ERROR STATUS MAPPING', async () => {
    const invalid = new InpatientDomainError('INVALID_INPUT', 'bad input', 400);

    expect(invalid.status, 'invalid input maps to HTTP 400').toBe(400);
    expect(invalid.code, 'invalid input keeps its code').toBe('INVALID_INPUT');
    expect(invalid instanceof Error, 'InpatientDomainError is an Error subclass').toBe(true);
    expect(invalid.name, 'error name is stable').toBe('InpatientDomainError');

    expect(
      new InpatientDomainError('BED_OCCUPIED', 'occupied', 409).status,
      'bed conflict maps to HTTP 409',
    ).toBe(409);

    expect(
      new InpatientDomainError('ADMISSION_ALREADY_CLOSED', 'closed', 409).status,
      'closed admission maps to HTTP 409',
    ).toBe(409);

    expect(
      new InpatientDomainError('BED_NOT_FOUND', 'missing', 404).status,
      'missing bed maps to HTTP 404',
    ).toBe(404);
  });

  it('Role Permissions', async () => {
    const doctor = permissionsFor('DOCTOR');

    expect(doctor.includes('inpatient.read'), 'DOCTOR can read inpatient').toBe(true);
    expect(doctor.includes('inpatient.admit'), 'DOCTOR can admit patients').toBe(true);
    expect(doctor.includes('inpatient.discharge'), 'DOCTOR can discharge patients').toBe(true);

    const nurse = permissionsFor('NURSE');

    expect(nurse.includes('inpatient.read'), 'NURSE can read inpatient').toBe(true);
    expect(nurse.includes('inpatient.admit'), 'NURSE can admit patients').toBe(true);
    expect(
      !nurse.includes('inpatient.discharge'),
      'NURSE cannot discharge patients (doctor authorisation)',
    ).toBe(true);
  });

  it('Route Wiring', async () => {
    /*
     * The inpatient routes moved out of app.ts into their own router. Read
     * the file that now owns them - reading app.ts here would make every
     * assertion below vacuous, since none of the routes are in it any more.
     */
    const appSource = readFileSync(
      resolve(import.meta.dirname, '../routes/inpatient.routes.ts'),
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
      const route = asRouterPath(expectation.route);

      expect(appSource.includes(route), `route ${expectation.route} exists`).toBe(true);

      expect(
        routeIsGuarded(appSource, route, expectation.permission),
        `route ${expectation.route} enforces ${expectation.permission}`,
      ).toBe(true);

      expect(
        routeAcceptsAuthRequest(appSource, route, expectation.permission),
        `route ${expectation.route} with ${expectation.permission} receives an AuthRequest`,
      ).toBe(true);
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
      expect(!appSource.includes(legacy), `legacy unscoped call ${legacy} is gone`).toBe(true);
    }

    // Tenancy must never be read from the request body.
    expect(
      !appSource.includes('req.body.tenantId'),
      'inpatient routes never read tenantId from the body',
    ).toBe(true);
  });

  it('Ward Bed Setup', async () => {
    const appSource = readFileSync(
      resolve(import.meta.dirname, '../routes/inpatient.routes.ts'),
      'utf8',
    );

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

    /*
     * A router that exists, holds correct handlers and is never mounted is
     * dead code that still passes every assertion in this file. The mount is
     * checked here for the same reason it is checked in the router specs.
     */
    expect(
      readFileSync(resolve(import.meta.dirname, '../routes/index.ts'), 'utf8').includes(
        'api.use(inpatientRoutes)',
      ),
      'the inpatient router is mounted on the API router',
    ).toBe(true);

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
      expect(seed.includes(`'${permission}'`), `${permission} is in the permission seed`).toBe(
        true,
      );
    }

    /*
     * Reading stays on `inpatient.read`. A second read code would give a
     * user the board but not the ward list.
     */
    expect(
      !seed.includes("'inpatient.wards.read'") && !seed.includes("'inpatient.beds.read'"),
      'reading wards and beds uses the existing inpatient.read',
    ).toBe(true);

    /* ---- routes ---- */
    const routes: Array<{ route: string; method: string; permission: string }> = [
      { route: "'/api/wards'", method: 'router.post', permission: 'inpatient.wards.create' },
      { route: "'/api/wards/:id'", method: 'router.put', permission: 'inpatient.wards.update' },
      { route: "'/api/wards/:id'", method: 'router.delete', permission: 'inpatient.wards.delete' },
      { route: "'/api/beds'", method: 'router.post', permission: 'inpatient.beds.create' },
      { route: "'/api/beds/:id'", method: 'router.put', permission: 'inpatient.beds.update' },
      { route: "'/api/beds/:id'", method: 'router.delete', permission: 'inpatient.beds.delete' },
    ];

    const flatApp = stripWhitespace(appSource);

    for (const { route, method, permission } of routes) {
      const marker = stripWhitespace(`${method}(${asRouterPath(route)},`);

      expect(flatApp.includes(marker), `${method} ${route} is registered`).toBe(true);

      const index = flatApp.indexOf(marker);
      const block = flatApp.slice(index, index + 250);

      expect(
        block.includes(`requirePermission('${permission}')`),
        `${method} ${route} enforces ${permission}`,
      ).toBe(true);
    }

    /* ---- no invented prices ---- */
    expect(
      !service.includes("?? '1500.00'") && !service.includes("?? '1800.00'"),
      'the service never invents a ward or bed price',
    ).toBe(true);

    expect(
      service.includes('optionalMoney('),
      'rates go through a validator that can return NULL',
    ).toBe(true);

    expect(
      service.includes('dailyRate,') && service.includes('dailyCharge,'),
      'the create paths pass the rate explicitly so the column default never applies',
    ).toBe(true);

    expect(
      service.includes('totalBeds: 0,'),
      'a new ward starts with a counted capacity of zero, not the column default of 20',
    ).toBe(true);

    expect(
      service.includes('syncWardCapacity('),
      "a ward's capacity is recounted from its beds",
    ).toBe(true);

    /* ---- duplicate and history handling ---- */
    expect(
      service.includes("pgErrorCode(error) === '23505'"),
      'a duplicate ward code or bed number is recognised from the unique index',
    ).toBe(true);

    expect(
      service.includes("'WARD_CODE_EXISTS'") && service.includes("'BED_NUMBER_EXISTS'"),
      'duplicates are reported by name rather than as a 500',
    ).toBe(true);

    expect(
      service.includes("'WARD_HAS_HISTORY'") && service.includes("'BED_HAS_HISTORY'"),
      'a ward or bed with admission history refuses deletion',
    ).toBe(true);

    expect(
      service.includes('Retire it instead') || service.includes('Set it to Maintenance instead'),
      'the refusal tells the user what to do instead',
    ).toBe(true);

    expect(
      service.includes('db.transaction('),
      'deleting a ward removes its beds in one transaction',
    ).toBe(true);

    /* ---- scope ---- */
    expect(
      service.includes('resolveFacilityScope('),
      'the facility is resolved from the session scope',
    ).toBe(true);

    expect(!service.includes('req.body'), 'the service reads no request object').toBe(true);

    expect(
      !appSource.includes('req.body.facilityId)'),
      'ward creation never trusts a facility from the body as the scope',
    ).toBe(true);

    /* ---- the screen ---- */
    for (const call of [
      'api.createWard(',
      'api.updateWard(',
      'api.deleteWard(',
      'api.createBeds(',
      'api.updateBed(',
      'api.deleteBed(',
    ]) {
      expect(screen.includes(call), `the screen calls ${call}`).toBe(true);
    }

    expect(
      screen.includes("can('inpatient.wards.create')"),
      'the Add Ward button is gated on its permission',
    ).toBe(true);

    expect(
      screen.includes('No wards have been set up for this facility yet'),
      'an empty facility is told why the dropdown is empty',
    ).toBe(true);

    expect(screen.includes('Create the first ward'), 'and is given the way out of it').toBe(true);

    expect(
      screen.includes('activeWards') && screen.includes("b.status === 'Available'"),
      'the admit modal offers only active wards and available beds',
    ).toBe(true);

    expect(
      !screen.includes('Severe community acquired pneumonia'),
      'the admission form ships no pre-filled diagnosis',
    ).toBe(true);

    for (const method of [
      'createWard:',
      'updateWard:',
      'deleteWard:',
      'createBeds:',
      'updateBed:',
      'deleteBed:',
    ]) {
      expect(client.includes(method), `the API client exposes ${method}`).toBe(true);
    }
  });
});
