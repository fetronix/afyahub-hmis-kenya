import { describe, expect, it } from 'vitest';
import { STAFF_ROLE_CATALOGUE } from '../../auth/staff-role-catalogue.ts';
import { FACILITY_ADMIN_PERMISSION_CODES } from '../../routes/platform/tenants.routes.ts';

describe('procurement default role boundaries', () => {
  it('allows new inventory officers to edit but not approve or cancel by default', () => {
    const officer = STAFF_ROLE_CATALOGUE.find((role) => role.name === 'INVENTORY_OFFICER');
    expect(officer?.permissions).toEqual(
      expect.arrayContaining(['procurement.read', 'procurement.create', 'procurement.update']),
    );
    for (const permission of [
      'procurement.approve',
      'procurement.reject',
      'procurement.complete',
      'procurement.delete',
    ])
      expect(officer?.permissions).not.toContain(permission);
  });
  it('allows newly provisioned facility admins to review orders without granting them creator or deletion powers by default', () => {
    expect(FACILITY_ADMIN_PERMISSION_CODES).toEqual(
      expect.arrayContaining([
        'procurement.read',
        'procurement.approve',
        'procurement.reject',
        'procurement.complete',
      ]),
    );
    expect(FACILITY_ADMIN_PERMISSION_CODES).not.toContain('procurement.create');
    expect(FACILITY_ADMIN_PERMISSION_CODES).not.toContain('procurement.update');
    expect(FACILITY_ADMIN_PERMISSION_CODES).not.toContain('procurement.delete');
  });
});
