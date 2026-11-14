import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { importTariffs } from '../../billing/tariff-import.service.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Phase 3 facility catalogue import and export (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const modules = ['registration', 'finance', 'opd', 'laboratory'];
  let tenant: number, facility: number, other: number, foreign: number, actor: number;
  let patient: number, department: number, practitioner: number;
  let token: string,
    otherToken: string,
    foreignToken: string,
    clerkToken: string,
    platformToken: string;
  let base: string, close: () => Promise<void>;
  const call = (method: string, path: string, body?: Record<string, unknown>, session = token) =>
    httpJson(base, method, path, { token: session, body });
  const row = (code: string, overrides: Record<string, unknown> = {}) => ({
    code,
    name: 'Synthetic service',
    description: 'Synthetic, "quoted" service',
    department: 'opd',
    category: 'CONSULTATION',
    unit: 'Visit',
    isActive: true,
    autoBill: true,
    ...overrides,
  });
  const code = (label: string) => `P3X-${label}-${suffix}`;
  const rows = [
    row(code('PRICED').toLowerCase(), {
      name: '=Synthetic formula-looking name',
      initialTariffCode: code('PRICE'),
      initialPrice: '125.5',
      effectiveFrom: '2000-01-01',
      effectiveTo: '2099-12-31',
    }),
    row(code('ZERO')),
    row(code('FUTURE'), { initialPrice: '90.00', effectiveFrom: '2999-01-01' }),
    row(code('EXPIRED'), {
      initialPrice: '80.00',
      effectiveFrom: '2000-01-01',
      effectiveTo: '2001-01-01',
    }),
  ];
  const importBody = (batchRows: unknown, idempotencyKey = randomUUID(), target = facility) => ({
    facilityId: target,
    rows: batchRows,
    idempotencyKey,
    confirmed: true,
    approvalReference: 'Synthetic facility review',
  });
  let batch: ReturnType<typeof importBody>,
    created: Array<{
      serviceId: number;
      tariffId: number;
      serviceCode: string;
      tariffCode: string;
    }>;

  beforeAll(async () => {
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic catalogue tenant',
        `catalogue-${suffix}`,
      ])
    ).rows[0].id;
    [facility, other] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules)
         VALUES($1,$2,'Synthetic catalogue A','Africa/Nairobi',$4::jsonb),
               ($1,$3,'Synthetic catalogue B','Africa/Nairobi',$4::jsonb) RETURNING id`,
        [tenant, `CA-${suffix}`, `CB-${suffix}`, JSON.stringify(modules)],
      )
    ).rows.map((r) => r.id);
    const foreignTenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic foreign catalogue tenant',
        `catalogue-foreign-${suffix}`,
      ])
    ).rows[0].id;
    foreign = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic foreign catalogue',$3::jsonb) RETURNING id",
        [foreignTenant, `CF-${suffix}`, JSON.stringify(modules)],
      )
    ).rows[0].id;
    async function user(label: string, tenantId: number | null, facilityId: number | null) {
      return (
        await pool.query(
          "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic user','test-only','ACTIVE',$3,$4) RETURNING id",
          [
            `catalogue-${label}-${suffix}`,
            `catalogue-${label}-${suffix}@example.test`,
            tenantId,
            facilityId,
          ],
        )
      ).rows[0].id as number;
    }
    actor = await user('a', tenant, facility);
    const otherActor = await user('b', tenant, other);
    const foreignActor = await user('foreign', foreignTenant, foreign);
    const clerk = await user('clerk', tenant, facility);
    const platformActor = await user('platform', null, null);
    async function role(
      tenantId: number | null,
      name: string,
      users: number[],
      permissions: string[],
    ) {
      let id: number;
      if (tenantId === null) {
        const existing = await pool.query(
          "SELECT id FROM roles WHERE tenant_id IS NULL AND name='SUPER_ADMIN' AND is_active=true LIMIT 1",
        );
        id =
          existing.rows[0]?.id ??
          (
            await pool.query(
              "INSERT INTO roles(tenant_id,name,is_active) VALUES(NULL,'SUPER_ADMIN',true) RETURNING id",
            )
          ).rows[0].id;
      } else {
        id = (
          await pool.query(
            'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
            [tenantId, name],
          )
        ).rows[0].id;
      }
      for (const userId of users)
        await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [userId, id]);
      for (const permission of permissions) {
        await pool.query(
          "INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING",
          [permission],
        );
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2 ON CONFLICT DO NOTHING',
          [id, permission],
        );
      }
    }
    const adminPermissions = [
      'tariffs.read',
      'tariffs.manage',
      'patients.read',
      'clinical.create',
      'clinical.read',
      'clinical.update',
      'billing.read',
      'billing.create',
    ];
    await role(tenant, 'FACILITY_ADMIN', [actor, otherActor], adminPermissions);
    await role(foreignTenant, 'FACILITY_ADMIN', [foreignActor], ['tariffs.read']);
    await role(tenant, `CLERK-${suffix}`, [clerk], ['tariffs.read', 'tariffs.manage']);
    await role(null, 'SUPER_ADMIN', [platformActor], []);
    [token, otherToken, foreignToken, clerkToken, platformToken] = await Promise.all(
      [actor, otherActor, foreignActor, clerk, platformActor].map(
        async (userId) => (await createSession({ userId, securityVersion: 1 })).sessionToken,
      ),
    );
    patient = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Catalogue','2000-01-01','Other') RETURNING id",
        [tenant, facility, code('MRN')],
      )
    ).rows[0].id;
    department = (
      await pool.query(
        "INSERT INTO departments(facility_id,name,code) VALUES($1,'Synthetic OPD',$2) RETURNING id",
        [facility, code('DEPT')],
      )
    ).rows[0].id;
    practitioner = (
      await pool.query(
        "INSERT INTO practitioners(tenant_id,facility_id,full_name) VALUES($1,$2,'Synthetic clinician') RETURNING id",
        [tenant, facility],
      )
    ).rows[0].id;
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('requires a facility administrator, permission and exact facility and tenant scope', async () => {
    const body = importBody(rows);
    for (const [method, path] of [
      ['POST', '/api/facility-services/import/validate'],
      ['POST', '/api/facility-services/import'],
      ['POST', '/api/facility-services/import/status'],
      ['GET', `/api/facility-services/export?facilityId=${facility}`],
    ]) {
      expect((await call(method, path, method === 'POST' ? body : undefined, '')).status).toBe(401);
      expect(
        (await call(method, path, method === 'POST' ? body : undefined, clerkToken)).status,
      ).toBe(403);
      expect(
        (await call(method, path, method === 'POST' ? body : undefined, platformToken)).status,
      ).toBe(403);
      expect(
        (await call(method, path, method === 'POST' ? body : undefined, otherToken)).status,
      ).toBe(403);
      expect(
        (await call(method, path, method === 'POST' ? body : undefined, foreignToken)).status,
      ).toBe(403);
    }
    expect(
      (
        await call(
          'GET',
          `/api/facility-services/export?facilityId=${foreign}`,
          undefined,
          foreignToken,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          'POST',
          '/api/facility-services/import/validate',
          { facilityId: foreign, rows },
          foreignToken,
        )
      ).status,
    ).toBe(403);
  });

  it('previews normalized rows without writing and rejects invalid values and conflicts', async () => {
    const before = (
      await pool.query('SELECT count(*)::int n FROM facility_services WHERE facility_id=$1', [
        facility,
      ])
    ).rows[0].n;
    const preview = await call('POST', '/api/facility-services/import/validate', {
      facilityId: facility,
      rows,
    });
    expect(preview.status).toBe(200);
    expect(preview.headers.get('cache-control')).toBe('no-store');
    expect(preview.body).toMatchObject({ valid: true, rowCount: 4, issues: [] });
    expect(preview.body.rows[0]).toMatchObject({
      code: code('PRICED'),
      initialTariffCode: code('PRICE'),
      initialPrice: '125.50',
      effectiveFrom: '2000-01-01',
    });
    expect(preview.body.rows[1]).toMatchObject({
      initialPrice: '0.00',
      initialTariffCode: code('ZERO'),
      effectiveFrom: null,
    });
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM facility_services WHERE facility_id=$1', [
          facility,
        ])
      ).rows[0].n,
    ).toBe(before);
    const invalidRows = [
      row(code('INVALID1'), { initialPrice: '-1' }),
      row(code('INVALID2'), { initialPrice: '' }),
      row(code('INVALID3'), { effectiveFrom: '2026-02-30' }),
      row(code('INVALID4'), { effectiveFrom: '2027-01-01', effectiveTo: '2026-01-01' }),
      row(code('INVALID5'), { unexpected: 'not accepted' }),
      row(code('INVALID6'), { department: 'laboratory', category: 'CONSULTATION' }),
      row(code('INVALID7'), { department: 'pharmacy', category: 'PHARMACY' }),
      row(code('DUPE')),
      row(code('DUPE').toLowerCase()),
      row(code('DIFFERENT'), { initialTariffCode: code('DUPE') }),
    ];
    const invalid = await call('POST', '/api/facility-services/import/validate', {
      facilityId: facility,
      rows: invalidRows,
    });
    expect(invalid.status).toBe(200);
    expect(invalid.body.valid).toBe(false);
    expect(invalid.body.rows).toEqual([]);
    expect(invalid.body.issues).toEqual(
      expect.arrayContaining([
        { row: 6, reasons: ['CATEGORY_DEPARTMENT_MISMATCH'] },
        { row: 7, reasons: ['DEPARTMENT_UNAVAILABLE'] },
        expect.objectContaining({
          row: 8,
          reasons: expect.arrayContaining([
            'DUPLICATE_SERVICE_CODE_IN_BATCH',
            'DUPLICATE_TARIFF_CODE_IN_BATCH',
          ]),
        }),
        expect.objectContaining({
          row: 10,
          reasons: expect.arrayContaining(['DUPLICATE_TARIFF_CODE_IN_BATCH']),
        }),
      ]),
    );
    expect(
      (await call('POST', '/api/facility-services/import', importBody(invalidRows))).status,
    ).toBe(400);
    expect(
      (
        await call('POST', '/api/facility-services/import', {
          ...importBody(rows),
          confirmed: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('POST', '/api/facility-services/import', {
          ...importBody(rows),
          approvalReference: '',
        })
      ).status,
    ).toBe(400);
  });

  it('imports linked services and tariffs once under concurrent identical retries and records immutable audit', async () => {
    batch = importBody(rows);
    const attempts = await Promise.all(
      Array.from({ length: 4 }, () => call('POST', '/api/facility-services/import', batch)),
    );
    expect(attempts.map((a) => a.status).sort()).toEqual([200, 200, 200, 201]);
    expect(new Set(attempts.map((a) => a.body.batchId)).size).toBe(1);
    expect(attempts.filter((a) => a.body.idempotentReplay === false)).toHaveLength(1);
    created = attempts[0].body.services;
    expect(created).toHaveLength(4);
    const persisted = (
      await pool.query(
        `SELECT s.code AS service_code,t.code AS tariff_code,t.facility_service_id,t.fee::text,
              t.effective_from::text,t.effective_to::text
       FROM facility_services s JOIN facility_service_tariffs t ON t.facility_service_id=s.id
       WHERE s.tenant_id=$1 AND s.facility_id=$2 AND s.id=ANY($3::int[]) ORDER BY s.code`,
        [tenant, facility, created.map((r) => r.serviceId)],
      )
    ).rows;
    expect(persisted).toHaveLength(4);
    expect(persisted.find((r) => r.service_code === code('PRICED'))).toMatchObject({
      tariff_code: code('PRICE'),
      fee: '125.50',
      effective_from: '2000-01-01',
      effective_to: '2099-12-31',
    });
    expect(persisted.find((r) => r.service_code === code('ZERO')).fee).toBe('0.00');
    const audit = (
      await pool.query(
        `SELECT resource,action,details FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND
       ((resource='FACILITY_SERVICE' AND resource_id=ANY($3::text[])) OR
        (resource='FACILITY_SERVICE_TARIFF' AND resource_id=ANY($4::text[])) OR
        (resource='FACILITY_SERVICE_IMPORT' AND resource_id=$5))`,
        [
          tenant,
          facility,
          created.map((r) => String(r.serviceId)),
          created.map((r) => String(r.tariffId)),
          String(attempts[0].body.batchId),
        ],
      )
    ).rows;
    expect(
      audit.filter((r) => r.resource === 'FACILITY_SERVICE' && r.action === 'CREATE'),
    ).toHaveLength(4);
    expect(
      audit.filter((r) => r.resource === 'FACILITY_SERVICE_TARIFF' && r.action === 'CREATE'),
    ).toHaveLength(4);
    expect(
      audit.filter((r) => r.resource === 'FACILITY_SERVICE_IMPORT' && r.action === 'IMPORT'),
    ).toHaveLength(1);
    const price = created.find((r) => r.serviceCode === code('PRICED'))!;
    const history = await call(
      'GET',
      `/api/facility-tariffs/${price.tariffId}/history?facilityId=${facility}`,
    );
    expect(history.body.events[0]).toMatchObject({
      action: 'CREATE',
      after: {
        fee: '125.50',
        effectiveFrom: '2000-01-01',
        effectiveTo: '2099-12-31',
        isActive: true,
      },
    });
    await expect(
      pool.query('UPDATE facility_tariff_import_batches SET row_count=row_count WHERE id=$1', [
        attempts[0].body.batchId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    expect(
      (
        await call('POST', '/api/facility-services/import', {
          ...batch,
          approvalReference: 'Different review',
        })
      ).body.error,
    ).toBe('IDEMPOTENCY_CONFLICT');
    const status = await call('POST', '/api/facility-services/import/status', {
      facilityId: facility,
      idempotencyKey: batch.idempotencyKey,
    });
    expect(status.body).toMatchObject({
      status: 'RECORDED',
      rowCount: 4,
      batchId: attempts[0].body.batchId,
      requestMatched: false,
    });
    const matched = await call('POST', '/api/facility-services/import/status', {
      facilityId: facility,
      idempotencyKey: batch.idempotencyKey,
      rows: batch.rows,
      approvalReference: batch.approvalReference,
    });
    expect(matched.body).toMatchObject({ status: 'RECORDED', requestMatched: true });
    const mismatch = await call('POST', '/api/facility-services/import/status', {
      facilityId: facility,
      idempotencyKey: batch.idempotencyKey,
      rows: batch.rows,
      approvalReference: 'Different synthetic approval',
    });
    expect(mismatch.body.status).toBe('KEY_IN_USE');
    expect(
      (
        await call(
          'POST',
          '/api/facility-services/import/status',
          { facilityId: other, idempotencyKey: batch.idempotencyKey },
          otherToken,
        )
      ).body.status,
    ).toBe('NOT_FOUND');
    const conflict = await call('POST', '/api/facility-services/import/validate', {
      facilityId: facility,
      rows,
    });
    expect(conflict.body.valid).toBe(false);
    expect(conflict.body.issues[0].reasons).toContain('SERVICE_CODE_ALREADY_EXISTS');
  });

  it('does not mistake an older standalone-tariff batch for a linked service import', async () => {
    const identity = randomUUID();
    await importTariffs({ id: facility, tenantId: tenant, enabledModules: modules }, actor, {
      facilityId: facility,
      idempotencyKey: identity,
      confirmed: true,
      approvalReference: 'Synthetic legacy review',
      rows: [
        {
          code: code('LEGACY'),
          description: 'Synthetic legacy tariff',
          department: 'finance',
          unit: 'Service',
          fee: '10.00',
          autoBill: false,
        },
      ],
    });
    const status = await call('POST', '/api/facility-services/import/status', {
      facilityId: facility,
      idempotencyKey: identity,
    });
    expect(status.body.status).toBe('KEY_IN_USE');
    const attempted = await call(
      'POST',
      '/api/facility-services/import',
      importBody([row(code('LEGACYNEW'))], identity),
    );
    expect(attempted.status).toBe(409);
    expect(attempted.body.error).toBe('IDEMPOTENCY_CONFLICT');
    const legacy = (
      await pool.query(
        'SELECT facility_service_id,fee::text FROM facility_service_tariffs WHERE tenant_id=$1 AND facility_id=$2 AND code=$3',
        [tenant, facility, code('LEGACY')],
      )
    ).rows[0];
    expect(legacy).toEqual({ facility_service_id: null, fee: '10.00' });
    expect(
      (await call('POST', '/api/service-tariffs/import', importBody([row(code('LEGACYNEW'))])))
        .status,
    ).toBe(404);
  });

  it('replays a recorded batch even if a clinical module is later disabled; new writes fail closed', async () => {
    await pool.query('UPDATE facilities SET enabled_modules=$2::jsonb WHERE id=$1', [
      facility,
      JSON.stringify(['finance']),
    ]);
    try {
      const replay = await call('POST', '/api/facility-services/import', batch);
      expect(replay.status).toBe(200);
      expect(replay.body.idempotentReplay).toBe(true);
      const newImport = await call(
        'POST',
        '/api/facility-services/import',
        importBody([row(code('DISABLED'))]),
      );
      expect(newImport.status).toBe(409);
      expect(newImport.body.error).toBe('BATCH_CONFLICT');
    } finally {
      await pool.query('UPDATE facilities SET enabled_modules=$2::jsonb WHERE id=$1', [
        facility,
        JSON.stringify(modules),
      ]);
    }
  });

  it('honours zero, future and expired rates and charges an imported current rate once with a price snapshot', async () => {
    const lookup = async (label: string) =>
      (
        await call(
          'GET',
          `/api/facility-tariffs/by-service-code/${code(label)}?facilityId=${facility}`,
        )
      ).body;
    expect((await lookup('PRICED')).priceStatus).toBe('AVAILABLE');
    for (const label of ['ZERO', 'FUTURE', 'EXPIRED'])
      expect((await lookup(label)).priceStatus).toBe('UNAVAILABLE');
    const price = created.find((r) => r.serviceCode === code('PRICED'))!;
    const visit = await call('POST', '/api/encounters', {
      facilityId: facility,
      patientId: patient,
      encounterType: 'Outpatient',
      status: 'Active',
      departmentId: department,
      practitionerId: practitioner,
      consultationFacilityServiceId: price.serviceId,
    });
    expect(visit.status).toBe(201);
    await pool.query(
      "INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description) VALUES($1,$2,'ICD-10','Z00.0','Synthetic examination')",
      [visit.body.id, patient],
    );
    const complete = await call('PUT', `/api/encounters/${visit.body.id}`, { status: 'Completed' });
    expect(complete.body.billing).toMatchObject({ charged: true, totalAmount: '125.50' });
    expect(
      (await call('PUT', `/api/encounters/${visit.body.id}`, { status: 'Completed' })).body.billing
        .reason,
    ).toBe('DUPLICATE');
    const items = async () =>
      (
        await pool.query(
          "SELECT facility_service_id,tariff_id,unit_price::text,total_amount::text FROM billing_items WHERE source_type='CONSULTATION' AND source_id=$1",
          [visit.body.id],
        )
      ).rows;
    expect(await items()).toEqual([
      {
        facility_service_id: price.serviceId,
        tariff_id: price.tariffId,
        unit_price: '125.50',
        total_amount: '125.50',
      },
    ]);
    const edit = await call('PUT', `/api/facility-tariffs/${price.tariffId}`, {
      facilityId: facility,
      serviceId: price.serviceId,
      expectedRevision: 1,
      code: price.tariffCode,
      description: 'Synthetic changed price',
      department: 'opd',
      unit: 'Visit',
      fee: '225.00',
      effectiveFrom: '2000-01-01',
      effectiveTo: '2099-12-31',
      isActive: true,
      autoBill: true,
    });
    expect(edit.status).toBe(200);
    expect(await items()).toEqual([
      {
        facility_service_id: price.serviceId,
        tariff_id: price.tariffId,
        unit_price: '125.50',
        total_amount: '125.50',
      },
    ]);
    expect((await call('POST', '/api/facility-services/import', batch)).body.idempotentReplay).toBe(
      true,
    );
    expect(await items()).toEqual([
      {
        facility_service_id: price.serviceId,
        tariff_id: price.tariffId,
        unit_price: '125.50',
        total_amount: '125.50',
      },
    ]);
    for (const label of ['ZERO', 'FUTURE', 'EXPIRED']) {
      const serviceId = created.find((r) => r.serviceCode === code(label))!.serviceId;
      const blockedVisit = await call('POST', '/api/encounters', {
        facilityId: facility,
        patientId: patient,
        encounterType: 'Outpatient',
        status: 'Active',
        departmentId: department,
        practitionerId: practitioner,
        consultationFacilityServiceId: serviceId,
      });
      expect(blockedVisit.status).toBe(201);
      await pool.query(
        "INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description) VALUES($1,$2,'ICD-10','Z00.0','Synthetic examination')",
        [blockedVisit.body.id, patient],
      );
      const blocked = await call('PUT', `/api/encounters/${blockedVisit.body.id}`, {
        status: 'Completed',
      });
      expect(blocked.body.billing).toMatchObject({
        charged: false,
        reason: 'TARIFF_NOT_CONFIGURED',
      });
      const lineCount = (
        await pool.query(
          "SELECT count(*)::int n FROM billing_items WHERE source_type='CONSULTATION' AND source_id=$1",
          [blockedVisit.body.id],
        )
      ).rows[0].n;
      expect(lineCount).toBe(0);
    }
  });

  it('serializes competing batch identities without partial rows', async () => {
    const competing = [row(code('RACE'), { initialPrice: '15.00' })];
    const attempts = await Promise.all([
      call('POST', '/api/facility-services/import', importBody(competing)),
      call('POST', '/api/facility-services/import', importBody(competing)),
    ]);
    expect(attempts.map((a) => a.status).sort()).toEqual([201, 409]);
    const counts = (
      await pool.query(
        `SELECT (SELECT count(*)::int FROM facility_services WHERE facility_id=$1 AND code=$2) services,
              (SELECT count(*)::int FROM facility_service_tariffs WHERE facility_id=$1 AND code=$2) tariffs`,
        [facility, code('RACE')],
      )
    ).rows[0];
    expect(counts).toEqual({ services: 1, tariffs: 1 });
    const otherImport = await call(
      'POST',
      '/api/facility-services/import',
      importBody(competing, randomUUID(), other),
      otherToken,
    );
    expect(otherImport.status).toBe(201);
    expect(otherImport.body.services[0].serviceId).not.toBe(
      attempts.find((r) => r.status === 201)!.body.services[0].serviceId,
    );
  });

  it('rolls back every service, tariff and batch if the final audit fails', async () => {
    const fn = `p3_import_failure_${suffix.toLowerCase()}`;
    const trigger = `p3_import_trigger_${suffix.toLowerCase()}`;
    await pool.query(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.facility_id=${facility} AND NEW.resource='FACILITY_SERVICE_IMPORT' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
    const input = importBody([row(code('ROLLBACK1')), row(code('ROLLBACK2'))]);
    try {
      const result = await call('POST', '/api/facility-services/import', input);
      expect(result.status).toBe(500);
      const counts = (
        await pool.query(
          `SELECT (SELECT count(*)::int FROM facility_services WHERE facility_id=$1 AND code=ANY($2::text[])) services,
                (SELECT count(*)::int FROM facility_service_tariffs WHERE facility_id=$1 AND code=ANY($2::text[])) tariffs,
                (SELECT count(*)::int FROM facility_tariff_import_batches WHERE facility_id=$1 AND idempotency_key=$3) batches`,
          [facility, [code('ROLLBACK1'), code('ROLLBACK2')], input.idempotencyKey],
        )
      ).rows[0];
      expect(counts).toEqual({ services: 0, tariffs: 0, batches: 0 });
      expect(
        (
          await call('POST', '/api/facility-services/import/status', {
            facilityId: facility,
            idempotencyKey: input.idempotencyKey,
          })
        ).body.status,
      ).toBe('NOT_FOUND');
    } finally {
      await pool.query(`DROP TRIGGER ${trigger} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${fn}()`);
    }
    expect((await call('POST', '/api/facility-services/import', input)).status).toBe(201);
  });

  it('exports scoped linked records as audited, formula-safe CSV without unlinked legacy or foreign rows', async () => {
    await pool.query(
      "INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee,is_active,auto_bill) VALUES($1,$2,$3,'Synthetic unlinked legacy','finance','Service',77,false,false)",
      [tenant, facility, code('UNLINKED')],
    );
    const future = created.find((r) => r.serviceCode === code('FUTURE'))!;
    expect(
      (await call('DELETE', `/api/facility-tariffs/${future.tariffId}?facilityId=${facility}`))
        .status,
    ).toBe(200);
    const foreignOnly = await call(
      'POST',
      '/api/facility-services/import',
      importBody([row(code('OTHERONLY'))], randomUUID(), other),
      otherToken,
    );
    expect(foreignOnly.status).toBe(201);
    const response = await call('GET', `/api/facility-services/export?facilityId=${facility}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.body).toMatchObject({
      contentType: 'text/csv; charset=utf-8',
      coverage: 'FACILITY_SERVICES_AND_LINKED_TARIFFS',
    });
    const csv = Buffer.from(response.body.base64, 'base64').toString('utf8');
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv).toContain('"\'=Synthetic formula-looking name"');
    expect(csv).toContain('"Synthetic, ""quoted"" service"');
    expect(csv).toContain(code('PRICED'));
    expect(csv).toContain(code('FUTURE'));
    expect(csv).not.toContain(code('UNLINKED'));
    expect(csv).not.toContain(code('OTHERONLY'));
    const futureLine = csv.split('\r\n').find((line) => line.includes(code('FUTURE')))!;
    expect(futureLine).toMatch(/"true","[0-9]+"$/);
    const audit = (
      await pool.query(
        "SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND resource='FACILITY_SERVICE_CATALOGUE' AND action='EXPORT' AND user_id=$3",
        [tenant, facility, String(actor)],
      )
    ).rows[0].n;
    expect(audit).toBe(1);
  });

  it('refuses to silently truncate a catalogue exceeding the export limit', async () => {
    await pool.query(
      `INSERT INTO facility_services(tenant_id,facility_id,code,name,description,department,category,unit,is_active,auto_bill)
       SELECT $1,$2,$3::text || '-' || n::text,'Synthetic bulk service','Synthetic bulk description','finance','OTHER','Service',true,false
       FROM generate_series(1,5001) n`,
      [tenant, other, `BIG-${suffix}`],
    );
    const before = (
      await pool.query(
        "SELECT count(*)::int n FROM audit_logs WHERE facility_id=$1 AND resource='FACILITY_SERVICE_CATALOGUE' AND action='EXPORT'",
        [other],
      )
    ).rows[0].n;
    const response = await call(
      'GET',
      `/api/facility-services/export?facilityId=${other}`,
      undefined,
      otherToken,
    );
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('CATALOGUE_EXPORT_TOO_LARGE');
    expect(response.body.base64).toBeUndefined();
    const after = (
      await pool.query(
        "SELECT count(*)::int n FROM audit_logs WHERE facility_id=$1 AND resource='FACILITY_SERVICE_CATALOGUE' AND action='EXPORT'",
        [other],
      )
    ).rows[0].n;
    expect(after).toBe(before);
  });

  it('does not return an export if the required access audit fails', async () => {
    const fn = `p3_export_failure_${suffix.toLowerCase()}`;
    const trigger = `p3_export_trigger_${suffix.toLowerCase()}`;
    await pool.query(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.facility_id=${facility} AND NEW.resource='FACILITY_SERVICE_CATALOGUE' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
    try {
      const response = await call('GET', `/api/facility-services/export?facilityId=${facility}`);
      expect(response.status).toBe(500);
      expect(response.body.base64).toBeUndefined();
    } finally {
      await pool.query(`DROP TRIGGER ${trigger} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${fn}()`);
    }
  });
});
