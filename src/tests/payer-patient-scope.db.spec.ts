import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { findFacilityPatient } from '../insurance/hub/patient-scope.ts';
import { describeDb, testPool } from './vitest/support/db.ts';

/** Only synthetic records on the disposable test database; no payer calls. */
describeDb('payer patient scope across tenant and facility boundaries', () => {
  const pool = testPool();
  const suffix = randomUUID().slice(0, 8);
  let tenant: number;
  let otherTenant: number;
  let home: number;
  let activeFacility: number;
  let inactiveFacility: number;
  let encounterFacility: number;
  let unrelatedFacility: number;
  let otherTenantFacility: number;
  let patientId: number;

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test')) {
      throw new Error('A disposable synthetic test database is required.');
    }
    const tenants = await pool.query(
      'INSERT INTO tenants(name,slug) VALUES ($1,$2),($3,$4) RETURNING id',
      ['Synthetic tenant A', `patient-a-${suffix}`, 'Synthetic tenant B', `patient-b-${suffix}`],
    );
    [tenant, otherTenant] = tenants.rows.map((row) => row.id);
    const makeFacility = async (tenantId: number, name: string) =>
      (
        await pool.query(
          'INSERT INTO facilities(tenant_id,code,name) VALUES($1,$2,$3) RETURNING id',
          [tenantId, `${name}-${suffix}`, `Synthetic ${name}`],
        )
      ).rows[0].id as number;
    home = await makeFacility(tenant, 'HOME');
    activeFacility = await makeFacility(tenant, 'ACTIVE');
    inactiveFacility = await makeFacility(tenant, 'INACTIVE');
    encounterFacility = await makeFacility(tenant, 'ENCOUNTER');
    unrelatedFacility = await makeFacility(tenant, 'OTHER');
    otherTenantFacility = await makeFacility(otherTenant, 'OTHER-TENANT');
    patientId = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
         VALUES($1,$2,$3,'Synthetic','Patient','2000-01-01','Unknown') RETURNING id`,
        [tenant, home, `SCOPE-${suffix}`],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO patient_facilities(patient_id,tenant_id,facility_id,status)
       VALUES ($1,$2,$3,'ACTIVE'),($1,$2,$4,'INACTIVE')`,
      [patientId, tenant, activeFacility, inactiveFacility],
    );
    await pool.query(
      `INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status)
       VALUES($1,$2,$3,'OUTPATIENT','COMPLETED')`,
      [tenant, encounterFacility, patientId],
    );
  });

  it('permits registration, active association, or an encounter at the requested facility', async () => {
    for (const facility of [home, activeFacility, encounterFacility]) {
      expect(await findFacilityPatient(tenant, facility, patientId)).toMatchObject({
        id: patientId,
      });
    }
  });

  it('rejects an inactive association, unrelated facility, wrong tenant and unknown patient', async () => {
    expect(await findFacilityPatient(tenant, inactiveFacility, patientId)).toBeNull();
    expect(await findFacilityPatient(tenant, unrelatedFacility, patientId)).toBeNull();
    expect(await findFacilityPatient(otherTenant, otherTenantFacility, patientId)).toBeNull();
    expect(await findFacilityPatient(tenant, home, 2_147_483_647)).toBeNull();
  });
});
