import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { STAFF_ROLE_CATALOGUE } from '../auth/staff-role-catalogue.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }

  console.log(`PASS: ${message}`);
}

function runStaffRoleCatalogueTests(): void {
  const expectedRoles = [
    'BILLING_CLERK',
    'CLINICAL_OFFICER',
    'DOCTOR',
    'INVENTORY_OFFICER',
    'LABORATORY_TECHNICIAN',
    'NURSE',
    'PHARMACIST',
    'RECEPTIONIST',
  ];

  const actualRoles = STAFF_ROLE_CATALOGUE.map((role) => role.name);

  assert(
    actualRoles.length === expectedRoles.length,
    'Catalogue contains exactly eight standard staff roles',
  );

  assert(new Set(actualRoles).size === actualRoles.length, 'Role names are unique');

  assert(
    [...actualRoles].sort().join('|') === [...expectedRoles].sort().join('|'),
    'Catalogue contains every expected staff role',
  );

  assert(
    STAFF_ROLE_CATALOGUE.every((role) => role.description.trim().length > 0),
    'Every role has a description',
  );

  assert(
    STAFF_ROLE_CATALOGUE.every(
      (role) =>
        role.permissions.length > 0 && new Set(role.permissions).size === role.permissions.length,
    ),
    'Every role has unique, non-empty permissions',
  );

  assert(
    STAFF_ROLE_CATALOGUE.every(
      (role) =>
        !/(SUPER[_ ]?ADMIN|PLATFORM[_ ]?ADMIN|FACILITY[_ ]?ADMIN|TENANT[_ ]?ADMIN)/i.test(
          role.name,
        ),
    ),
    'Privileged administrator roles are not in the staff catalogue',
  );

  /*
   * The catalogue is what the provisioning screen offers, so a role with
   * a typo'd permission code would be created holding nothing and fail
   * silently at the first request. Every code must look like the rest:
   * module.action, lowercase, dot-separated.
   */
  const malformed = STAFF_ROLE_CATALOGUE.flatMap((role) =>
    role.permissions
      .filter((code) => !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$/.test(code))
      .map((code) => `${role.name}: ${code}`),
  );

  assert(
    malformed.length === 0,
    `Every permission code is well formed${malformed.length ? ` (bad: ${malformed.join('; ')})` : ''}`,
  );

  /*
   * Provisioning is the one place the application writes roles outside a
   * tenant-creation transaction. It has to stay additive: a screen that
   * can delete a role can also delete the role someone is holding.
   */
  const routes = readFileSync(resolve(process.cwd(), 'src/routes/platform.routes.ts'), 'utf8');

  assert(
    routes.includes("router.post('/rbac/catalogue/apply'"),
    'The catalogue provisioning route is registered',
  );

  const provisionStart = routes.indexOf("router.post('/rbac/catalogue/apply'");
  const provisionEnd = routes.indexOf('PUT /api/platform/rbac/roles/:id/permissions');
  const provisionBody = routes.slice(provisionStart, provisionEnd);

  assert(
    provisionStart > -1 && provisionEnd > provisionStart,
    'The provisioning route body can be isolated for inspection',
  );

  assert(
    !/\.delete\(/.test(provisionBody),
    'Provisioning never deletes a role or a permission link',
  );

  assert(!/\.update\(/.test(provisionBody), 'Provisioning never rewrites an existing role');

  assert(
    provisionBody.includes('topUpExisting'),
    'Existing roles are topped up only when the caller asks for it',
  );

  assert(
    !/db\.execute\(/.test(provisionBody),
    'Provisioning uses the query builder rather than raw SQL',
  );

  console.log('\nStaff role catalogue tests passed.');
}

try {
  runStaffRoleCatalogueTests();
} catch (error) {
  console.error('\nStaff role catalogue tests failed.');
  console.error(error);
  process.exit(1);
}
