import { STAFF_ROLE_CATALOGUE } from '../auth/staff-role-catalogue.ts';
import { platformRoutesSource } from './support/schema-source.ts';

import { describe, expect, it } from 'vitest';

describe('The catalogue is what the provisioning screen offers, so a role with', () => {
  it('Staff Role Catalogue', async () => {
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

    expect(
      actualRoles.length === expectedRoles.length,
      'Catalogue contains exactly eight standard staff roles',
    ).toBe(true);

    expect(new Set(actualRoles).size === actualRoles.length, 'Role names are unique').toBe(true);

    expect(
      [...actualRoles].sort().join('|') === [...expectedRoles].sort().join('|'),
      'Catalogue contains every expected staff role',
    ).toBe(true);

    expect(
      STAFF_ROLE_CATALOGUE.every((role) => role.description.trim().length > 0),
      'Every role has a description',
    ).toBe(true);

    expect(
      STAFF_ROLE_CATALOGUE.every(
        (role) =>
          role.permissions.length > 0 && new Set(role.permissions).size === role.permissions.length,
      ),
      'Every role has unique, non-empty permissions',
    ).toBe(true);

    expect(
      STAFF_ROLE_CATALOGUE.every(
        (role) =>
          !/(SUPER[_ ]?ADMIN|PLATFORM[_ ]?ADMIN|FACILITY[_ ]?ADMIN|TENANT[_ ]?ADMIN)/i.test(
            role.name,
          ),
      ),
      'Privileged administrator roles are not in the staff catalogue',
    ).toBe(true);

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

    expect(
      malformed.length === 0,
      `Every permission code is well formed${malformed.length ? ` (bad: ${malformed.join('; ')})` : ''}`,
    ).toBe(true);

    /*
     * Provisioning is the one place the application writes roles outside a
     * tenant-creation transaction. It has to stay additive: a screen that
     * can delete a role can also delete the role someone is holding.
     */
    const routes = platformRoutesSource();
    const provisionMatch = /router\.post\(\s*'\/rbac\/catalogue\/apply'/.exec(routes);

    expect(Boolean(provisionMatch), 'The catalogue provisioning route is registered').toBe(true);

    const provisionStart = provisionMatch?.index ?? -1;
    const provisionEnd = routes.indexOf('PUT /api/platform/rbac/roles/:id/permissions');
    const provisionBody = routes.slice(provisionStart, provisionEnd);

    expect(
      provisionStart > -1 && provisionEnd > provisionStart,
      'The provisioning route body can be isolated for inspection',
    ).toBe(true);

    expect(
      !/\.delete\(/.test(provisionBody),
      'Provisioning never deletes a role or a permission link',
    ).toBe(true);

    expect(!/\.update\(/.test(provisionBody), 'Provisioning never rewrites an existing role').toBe(
      true,
    );

    expect(
      provisionBody.includes('topUpExisting'),
      'Existing roles are topped up only when the caller asks for it',
    ).toBe(true);

    expect(
      !/db\.execute\(/.test(provisionBody),
      'Provisioning uses the query builder rather than raw SQL',
    ).toBe(true);
  });
});
