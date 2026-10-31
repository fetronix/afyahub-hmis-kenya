import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { pool } from '../../db/index.ts';
import { createPatientScoped, nextPatientMrn } from '../../db/queries/patients.ts';
import { describeDb } from '../vitest/support/db.ts';

// Synthetic rows only; no existing patient identifier is modified.
describeDb('Patient number allocation with long existing identifiers', () => {
  it('allocates without 32-bit overflow or JavaScript integer precision loss', async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Test database required.');
    const suffix = randomUUID().slice(0, 8);
    const tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic MRN allocation',
        `mrn-allocation-${suffix}`,
      ])
    ).rows[0].id;
    const facility = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name) VALUES($1,$2,'Synthetic allocation facility') RETURNING id",
        [tenant, `MRN-${suffix}`],
      )
    ).rows[0].id;
    const large = 9007199254740993123n;
    await pool.query(
      "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Long Identifier','2000-01-01','Other')",
      [tenant, facility, `SYN-${suffix}-${large}`],
    );
    const next = await nextPatientMrn();
    expect(BigInt(next.match(/\d+$/)![0])).toBeGreaterThan(large);
    const created = await createPatientScoped(
      {
        userId: 1,
        tenantId: tenant,
        facilityId: facility,
        roles: [],
        permissions: [],
        isSuperAdmin: false,
      },
      {
        tenantId: tenant,
        registrationFacilityId: facility,
        firstName: 'Synthetic',
        lastName: 'Allocated',
        dateOfBirth: '2000-01-01',
        gender: 'Other',
      },
    );
    expect(BigInt(created.mrn.match(/\d+$/)![0])).toBeGreaterThan(large);
  });
});
