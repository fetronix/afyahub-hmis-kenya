import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createPayerServiceMapping,
  isEffectiveOnDate,
  listPayerServiceMappings,
  updatePayerServiceMapping,
} from '../insurance/mappings/mappings.service.ts';
import { describeDb, testPool } from './vitest/support/db.ts';

describe('mapping date windows', () => {
  it('uses inclusive start and end dates and permits open bounds', () => {
    expect(isEffectiveOnDate(null, null, '2026-06-01')).toBe(true);
    expect(isEffectiveOnDate('2026-06-01', '2026-06-30', '2026-06-01')).toBe(true);
    expect(isEffectiveOnDate('2026-06-01', '2026-06-30', '2026-06-30')).toBe(true);
    expect(isEffectiveOnDate('2026-06-01', null, '2026-05-31')).toBe(false);
    expect(isEffectiveOnDate(null, '2026-06-30', '2026-07-01')).toBe(false);
  });
});

/** All payer/service codes and amounts here are synthetic and not insurer guidance. */
describeDb('private payer service mappings in an isolated database', () => {
  const pool = testPool();
  const suffix = randomUUID().slice(0, 8);
  const payerCode = `TEST${suffix.toUpperCase()}`;
  let tenantId: number;
  let facilityId: number;
  let otherFacilityId: number;
  let userId: number;
  let userUid: string;
  let tariffId: number;
  let otherTariffId: number;
  let existingMappingId: number;

  const scope = () => ({ tenantId, facilityId, actorUserId: userId, actorUserUid: userUid });
  const validInput = () => ({
    payerCode,
    localCode: `LOCAL-${suffix}`,
    localDescription: 'Synthetic local service',
    payerServiceCode: `SYNTHETIC-${suffix}`,
  });

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    tenantId = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic mapping',
        `mapping-${suffix}`,
      ])
    ).rows[0].id;
    const facilities = await pool.query(
      'INSERT INTO facilities(tenant_id,code,name) VALUES($1,$2,$4),($1,$3,$5) RETURNING id',
      [tenantId, `MAP-A-${suffix}`, `MAP-B-${suffix}`, 'Synthetic A', 'Synthetic B'],
    );
    [facilityId, otherFacilityId] = facilities.rows.map((row) => row.id);
    userUid = `mapping-user-${suffix}`;
    userId = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,tenant_id,facility_id)
       VALUES($1,$1,$2,'Synthetic test user','not-for-login',$3,$4) RETURNING id`,
        [userUid, `${userUid}@example.test`, tenantId, facilityId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO insurance_payer_configs(tenant_id,facility_id,payer_code,payer_name,payer_type)
       VALUES($1,$2,$3,'Synthetic payer','PRIVATE'),($1,$4,$3,'Synthetic payer','PRIVATE')`,
      [tenantId, facilityId, payerCode, otherFacilityId],
    );
    const tariffs = await pool.query(
      `INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,fee)
       VALUES($1,$2,$4,'Synthetic service A','LABORATORY','10.00'),($1,$3,$5,'Synthetic service B','LABORATORY','20.00') RETURNING id`,
      [tenantId, facilityId, otherFacilityId, `TA-${suffix}`, `TB-${suffix}`],
    );
    [tariffId, otherTariffId] = tariffs.rows.map((row) => row.id);
    existingMappingId = (
      await pool.query(
        `INSERT INTO payer_service_code_mappings(tenant_id,facility_id,payer_code,local_code,local_description,service_area,payer_service_code,payer_service_name)
       VALUES($1,$2,$3,$4,'Synthetic existing','LABORATORY',$5,'Synthetic existing') RETURNING id`,
        [tenantId, facilityId, payerCode, `EXISTING-${suffix}`, `TEST-EXISTING-${suffix}`],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO payer_service_code_mappings(tenant_id,facility_id,payer_code,local_code,local_description,service_area,payer_service_code,payer_service_name)
       VALUES($1,$2,'SHA',$3,'Synthetic SHA','LABORATORY',$4,'Synthetic SHA')`,
      [tenantId, facilityId, `LOCAL-SHA-${suffix}`, `TEST-SHA-${suffix}`],
    );
  });

  it('rejects missing or foreign configuration and invalid required fields before insertion', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{}, 'PAYER_CODE_REQUIRED'],
      [{ ...validInput(), payerCode: 'UNKNOWN_TEST' }, 'PAYER_NOT_FOUND'],
      [{ ...validInput(), tariffId: otherTariffId }, 'TARIFF_NOT_FOUND'],
      [{ ...validInput(), localCode: ' ' }, 'LOCAL_SERVICE_REQUIRED'],
      [{ ...validInput(), payerServiceCode: ' ' }, 'PAYER_SERVICE_CODE_REQUIRED'],
      [
        { ...validInput(), effectiveFrom: '2026-08-01', effectiveTo: '2026-07-01' },
        'INVALID_EFFECTIVE_DATES',
      ],
    ];
    for (const [input, code] of cases) {
      await expect(createPayerServiceMapping({ ...scope(), input })).rejects.toMatchObject({
        code,
      });
    }
    const count = await pool.query(
      'SELECT count(*)::int AS count FROM payer_service_code_mappings WHERE tenant_id=$1',
      [tenantId],
    );
    expect(count.rows[0].count).toBe(2);
  });

  it('uses only the scoped tariff and records a synthetic mapping with its audit', async () => {
    const created = await createPayerServiceMapping({
      ...scope(),
      input: {
        payerCode: payerCode.toLowerCase(),
        tariffId,
        payerServiceCode: `PAYER-${suffix}`,
        reimbursementTariff: '12.50',
        requiresPreauth: true,
        requiresReferral: true,
        requiresClinicalNotes: false,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
      },
    });
    expect(created).toMatchObject({
      tenantId,
      facilityId,
      payerCode,
      tariffId,
      localCode: `TA-${suffix}`,
      localDescription: 'Synthetic service A',
      serviceArea: 'LABORATORY',
      reimbursementTariff: '12.50',
      requiresPreauth: true,
      requiresReferral: true,
      requiresClinicalNotes: false,
    });
    const audit = await pool.query(
      'SELECT action FROM audit_logs WHERE tenant_id=$1 AND resource_id=$2',
      [tenantId, String(created.id)],
    );
    expect(audit.rows.map((row) => row.action)).toContain('PRIVATE_INSURANCE_MAPPING_CREATED');
  });

  it('filters lists and updates by facility, preserving SHA separation and audit history', async () => {
    const list = await listPayerServiceMappings({ tenantId, facilityId });
    expect(list.every((row) => row.payerCode !== 'SHA')).toBe(true);
    expect(list.some((row) => row.id === existingMappingId)).toBe(true);
    expect(
      await listPayerServiceMappings({ tenantId, facilityId: otherFacilityId, payerCode }),
    ).toEqual([]);
    expect(
      (await listPayerServiceMappings({ tenantId, facilityId, payerCode: 'sha' })).map(
        (row) => row.payerCode,
      ),
    ).toEqual(['SHA']);
    await expect(
      updatePayerServiceMapping({
        ...scope(),
        facilityId: otherFacilityId,
        mappingId: existingMappingId,
        input: {},
      }),
    ).rejects.toMatchObject({ code: 'MAPPING_NOT_FOUND' });

    const updated = await updatePayerServiceMapping({
      ...scope(),
      mappingId: existingMappingId,
      input: {
        payerServiceCode: '  synthetic-update  ',
        payerServiceName: ' Updated ',
        serviceArea: ' imaging ',
        reimbursementTariff: '2.50',
        requiresPreauth: true,
        requiresReferral: true,
        requiresClinicalNotes: false,
        effectiveFrom: '2026-03-01',
        effectiveTo: '2026-04-01',
        isActive: false,
        notes: 'synthetic only',
      },
    });
    expect(updated).toMatchObject({
      payerServiceCode: 'synthetic-update',
      payerServiceName: 'Updated',
      serviceArea: 'IMAGING',
      reimbursementTariff: '2.50',
      requiresPreauth: true,
      requiresReferral: true,
      requiresClinicalNotes: false,
      isActive: false,
    });
    expect(
      (
        await listPayerServiceMappings({
          tenantId,
          facilityId,
          payerCode,
          serviceArea: 'IMAGING',
          activeOnly: true,
        })
      ).some((row) => row.id === existingMappingId),
    ).toBe(false);
    const audit = await pool.query(
      'SELECT action FROM audit_logs WHERE tenant_id=$1 AND resource_id=$2',
      [tenantId, String(existingMappingId)],
    );
    expect(audit.rows.map((row) => row.action)).toContain('PRIVATE_INSURANCE_MAPPING_UPDATED');
    const cleared = await updatePayerServiceMapping({
      ...scope(),
      mappingId: existingMappingId,
      input: { reimbursementTariff: null, effectiveFrom: '', effectiveTo: null, notes: null },
    });
    expect(cleared).toMatchObject({
      reimbursementTariff: null,
      effectiveFrom: null,
      effectiveTo: null,
      notes: null,
    });
  });
});
