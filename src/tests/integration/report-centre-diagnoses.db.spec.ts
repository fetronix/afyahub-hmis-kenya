/** Authenticated HTTP against explicitly isolated synthetic PostgreSQL; no real clinical data. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import {
  assertSyntheticDatabaseIdentity,
  assertSyntheticTarget,
} from '../vitest/support/synthetic-db-identity.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

// Unlike the shared loopback check, these fixtures require an independently
// attested PostgreSQL cluster identifier even when the server is on loopback.
function assertAttestedCluster(expected: string | undefined, actual: unknown): void {
  if (!expected || !/^[0-9]{1,20}$/.test(expected) || expected !== actual) {
    throw new Error('The synthetic PostgreSQL cluster identifier is not independently attested.');
  }
}

describeDb('Outpatient diagnosis register (synthetic PostgreSQL and HTTP)', () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const grants = ['reports.read', 'clinical.read', 'patients.read', 'reports.export'];
  const modules = ['analytics', 'opd'];
  let tenant: number,
    foreignTenant: number,
    facility: number,
    sibling: number,
    foreignFacility: number;
  let patient: number, transferredPatient: number, foreignPatient: number, department: number;
  let actor: number,
    activeEncounter: number,
    completedEncounter: number,
    cancelledEncounter: number;
  let unknownEncounter: number, badPatientEncounter: number, outsideEncounter: number;
  let token: string, reportsOnly: string, noClinical: string, noPatients: string, noExport: string;
  let clusterIdentifier: string;
  let base: string, close: () => Promise<void>;

  async function user(label: string, permissions: string[]) {
    const id = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,'Synthetic report actor','test-only','ACTIVE',$3,$4) RETURNING id`,
        [`dx-${label}-${suffix}`, `dx-${label}-${suffix}@example.test`, tenant, facility],
      )
    ).rows[0].id as number;
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenant, `DX_${label}_${suffix}`],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
    for (const code of permissions) {
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'reports') ON CONFLICT(code) DO NOTHING",
        [code],
      );
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, code],
      );
    }
    return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
  }
  const post = (
    action: 'generate' | 'export' | 'options',
    data: Record<string, unknown> = {},
    auth = token,
  ) =>
    httpJson(base, 'POST', `/api/reporting/centre/outpatient-diagnoses/${action}`, {
      token: auth,
      body: { facilityId: facility, ...data },
    });
  const april = { from: '2026-04-01', to: '2026-04-30' };

  beforeAll(async () => {
    const target = {
      host: process.env.SQL_HOST ?? '',
      name: process.env.SQL_DB_NAME ?? '',
      containerClusterIdentifier: process.env.JALICARE_TEST_PG_SYSTEM_IDENTIFIER,
    };
    assertSyntheticTarget(target);
    const identity = await pool.query(
      'SELECT current_database() AS name, inet_server_addr()::text AS address, system_identifier::text AS "clusterIdentifier" FROM pg_control_system()',
    );
    assertSyntheticDatabaseIdentity(target, identity.rows[0]);
    clusterIdentifier = identity.rows[0].clusterIdentifier;
    assertAttestedCluster(target.containerClusterIdentifier, clusterIdentifier);
    [tenant, foreignTenant] = (
      await pool.query(
        "INSERT INTO tenants(name,slug,currency) VALUES($1,$2,'KES'),($3,$4,'KES') RETURNING id",
        [
          `Synthetic diagnosis ${suffix}`,
          `dx-${suffix}`,
          `Synthetic foreign ${suffix}`,
          `dx-other-${suffix}`,
        ],
      )
    ).rows.map((row) => row.id);
    [facility, sibling, foreignFacility] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES
         ($1,$3,'Synthetic diagnosis facility',$6::jsonb),
         ($1,$4,'Synthetic sibling facility',$6::jsonb),
         ($2,$5,'Synthetic foreign facility',$6::jsonb) RETURNING id`,
        [
          tenant,
          foreignTenant,
          `DXA-${suffix}`,
          `DXB-${suffix}`,
          `DXC-${suffix}`,
          JSON.stringify(modules),
        ],
      )
    ).rows.map((row) => row.id);
    [patient, transferredPatient, foreignPatient] = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES
         ($1,$3,$6,'Synthetic','DxPrimary','2000-01-01','Other'),
         ($1,$4,$7,'Synthetic','DxTransferred','2000-01-01','Other'),
         ($2,$5,$8,'Synthetic','DxForeignSecret','2000-01-01','Other') RETURNING id`,
        [
          tenant,
          foreignTenant,
          facility,
          sibling,
          foreignFacility,
          `DXP-${suffix}`,
          `DXT-${suffix}`,
          `DXF-${suffix}`,
        ],
      )
    ).rows.map((row) => row.id);
    department = (
      await pool.query(
        "INSERT INTO departments(facility_id,name,code) VALUES($1,'Synthetic OPD',$2) RETURNING id",
        [facility, `DXD-${suffix}`],
      )
    ).rows[0].id;
    const full = await user('full', grants);
    actor = full.id;
    token = full.token;
    reportsOnly = (await user('reports', ['reports.read'])).token;
    noClinical = (
      await user(
        'noclinical',
        grants.filter((p) => p !== 'clinical.read'),
      )
    ).token;
    noPatients = (
      await user(
        'nopatients',
        grants.filter((p) => p !== 'patients.read'),
      )
    ).token;
    noExport = (
      await user(
        'noexport',
        grants.filter((p) => p !== 'reports.export'),
      )
    ).token;
    const encounters = await pool.query(
      `INSERT INTO encounters(tenant_id,facility_id,patient_id,department_id,encounter_type,status,started_at) VALUES
       ($1,$3,$6,$9,'OUTPATIENT','ACTIVE','2026-04-01 00:00:00'),
       ($1,$3,$6,$9,'OUTPATIENT','COMPLETED','2026-04-30 23:59:59'),
       ($1,$3,$6,$9,'OUTPATIENT','CANCELLED','2026-04-30 08:00:00'),
       ($1,$3,$7,$9,'OUTPATIENT','UNRECOGNISED','2026-04-15 10:00:00'),
       ($1,$3,$8,$9,'OUTPATIENT','UNKNOWN_STORED','2026-04-02 10:00:00'),
       ($1,$3,$6,$9,'OUTPATIENT','COMPLETED','2026-05-01 00:00:00'),
       ($1,$3,$6,$9,'OUTPATIENT','PLANNED','2026-04-12 10:00:00'),
       ($1,$3,$6,$9,'OUTPATIENT','ON_HOLD','2026-04-13 10:00:00'),
       ($1,$4,$7,NULL,'OUTPATIENT','COMPLETED','2026-04-03 10:00:00'),
       ($2,$5,$8,NULL,'OUTPATIENT','COMPLETED','2026-04-03 10:00:00'),
       ($1,$3,$6,$9,'INPATIENT','COMPLETED','2026-04-04 10:00:00') RETURNING id`,
      [
        tenant,
        foreignTenant,
        facility,
        sibling,
        foreignFacility,
        patient,
        transferredPatient,
        foreignPatient,
        department,
      ],
    );
    [
      activeEncounter,
      completedEncounter,
      cancelledEncounter,
      unknownEncounter,
      badPatientEncounter,
      outsideEncounter,
    ] = encounters.rows.map((row) => row.id);
    await pool.query(
      `INSERT INTO diagnoses(encounter_id,patient_id,coding_system,diagnosis_code,diagnosis_display,icd10_code,icd10_description,icd11_code,icd11_title,icd11_release,diagnosis_type,status) VALUES
       ($1,$7,'ICD-10',NULL,NULL,'J00','Synthetic legacy diagnosis',NULL,NULL,NULL,'Primary','Confirmed'),
       ($1,$7,'ICD-10',NULL,NULL,'J00','Synthetic legacy diagnosis',NULL,NULL,NULL,'Primary','Confirmed'),
       ($1,$7,'ICD-11','1A00','Synthetic coded diagnosis',NULL,NULL,'1A00','Synthetic coded diagnosis','2025-01','Secondary','Provisional'),
       ($1,$9,'ICD-10',NULL,NULL,'X99','Synthetic foreign diagnosis secret',NULL,NULL,NULL,'Primary','Confirmed'),
       ($2,$7,'ICD-11','1A01','=SUM(1,2)',NULL,NULL,'1A01','=SUM(1,2)',NULL,'Primary',NULL),
       ($3,$8,'ICD-10',NULL,NULL,'J01','Synthetic transfer diagnosis',NULL,NULL,NULL,'Primary','Confirmed'),
       ($4,$9,'ICD-10',NULL,NULL,'X98','Synthetic mismatched patient secret',NULL,NULL,NULL,'Primary','Confirmed'),
       ($5,$7,'ICD-10',NULL,NULL,'J02','Synthetic next month diagnosis',NULL,NULL,NULL,'Primary','Confirmed'),
       ($6,$9,'ICD-10',NULL,NULL,'X97','Synthetic foreign facility secret',NULL,NULL,NULL,'Primary','Confirmed')`,
      [
        activeEncounter,
        cancelledEncounter,
        unknownEncounter,
        badPatientEncounter,
        outsideEncounter,
        encounters.rows[9].id,
        patient,
        transferredPatient,
        foreignPatient,
      ],
    );
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('requires an independently attested cluster identifier before creating fixtures', () => {
    const expected = process.env.JALICARE_TEST_PG_SYSTEM_IDENTIFIER;
    expect(() => assertAttestedCluster(expected, clusterIdentifier)).not.toThrow();
    expect(() => assertAttestedCluster(undefined, clusterIdentifier)).toThrow();
    expect(() => assertAttestedCluster('not-a-cluster-id', clusterIdentifier)).toThrow();
    const wrong = clusterIdentifier === '1' ? '2' : '1';
    expect(() => assertAttestedCluster(wrong, clusterIdentifier)).toThrow();
  });

  it('reconciles diagnosis rows to source encounters without inferring cases or recoding history', async () => {
    const response = await post('generate', april);
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(10);
    const rows = response.body.rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(10);
    const source = await pool.query(
      `SELECT count(*)::int AS n FROM encounters e LEFT JOIN diagnoses d ON d.encounter_id=e.id
       WHERE e.tenant_id=$1 AND e.facility_id=$2 AND e.encounter_type='OUTPATIENT'
       AND e.started_at::date >= $3 AND e.started_at::date <= $4`,
      [tenant, facility, april.from, april.to],
    );
    expect(response.body.total).toBe(source.rows[0].n);
    const legacy = rows.filter(
      (row) => row.encounterId === activeEncounter && row.legacyIcd10Code === 'J00',
    );
    expect(legacy).toHaveLength(2);
    expect(new Set(legacy.map((row) => row.diagnosisId)).size).toBe(2);
    expect(legacy.every((row) => row.icd11Code === null && row.icd11Release === null)).toBe(true);
    const icd11 = rows.find(
      (row) => row.encounterId === activeEncounter && row.icd11Code === '1A00',
    );
    expect(icd11).toMatchObject({
      codingSystem: 'ICD-11',
      icd11Release: '2025-01',
      diagnosisStatus: 'Provisional',
    });
    const noDiagnosis = rows.find((row) => row.encounterId === completedEncounter);
    expect(noDiagnosis).toMatchObject({
      diagnosisId: null,
      diagnosisQuality: 'No diagnosis recorded',
      encounterProgress: 'Completed',
    });
    expect(response.body.notes.join(' ')).toContain('not a count of patients or cases');
    const stored = (
      await pool.query(
        'SELECT icd10_code,icd11_code FROM diagnoses WHERE encounter_id=$1 AND icd10_code=$2',
        [activeEncounter, 'J00'],
      )
    ).rows;
    expect(stored).toHaveLength(2);
    expect(stored.every((row) => row.icd11_code === null)).toBe(true);
  });

  it('withholds inconsistent cross-patient and cross-tenant diagnosis details and flags missing coding evidence', async () => {
    const response = await post('generate', april);
    expect(response.status).toBe(200);
    const rows = response.body.rows as Array<Record<string, unknown>>;
    const withheld = rows.filter(
      (row) => row.diagnosisQuality === 'Inconsistent patient link; details withheld',
    );
    expect(withheld).toHaveLength(2);
    for (const row of withheld) {
      expect(row.diagnosisId).toBeNull();
      expect(row.legacyIcd10Code).toBeNull();
      expect(row.icd11Code).toBeNull();
      expect(row.diagnosisDisplay).toBeNull();
    }
    expect(rows.find((row) => row.encounterId === badPatientEncounter)?.patient).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('DxForeignSecret');
    expect(JSON.stringify(response.body)).not.toContain('foreign diagnosis secret');
    expect(JSON.stringify(response.body)).not.toContain('mismatched patient secret');
    expect(rows.find((row) => row.encounterId === cancelledEncounter)).toMatchObject({
      icd11Release: null,
      diagnosisStatus: null,
      diagnosisQuality: 'Incomplete coding or diagnosis status',
    });
    expect(response.body.notes.join(' ')).toContain('need review');
    expect(
      (await post('generate', { ...april, search: 'foreign diagnosis secret' })).body.total,
    ).toBe(0);
  });

  it('uses inclusive recorded encounter dates and explicit progress buckets without claiming care completion', async () => {
    for (const [status, expected] of [
      ['PENDING', 6],
      ['COMPLETED', 1],
      ['CANCELLED', 1],
      ['UNKNOWN', 2],
    ] as const) {
      const response = await post('generate', { ...april, status });
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(expected);
      expect(
        response.body.rows.every(
          (row: { encounterProgress: string }) => row.encounterProgress.toUpperCase() === status,
        ),
      ).toBe(true);
    }
    expect((await post('generate', { from: '2026-04-01', to: '2026-04-01' })).body.total).toBe(4);
    expect((await post('generate', { from: '2026-04-30', to: '2026-04-30' })).body.total).toBe(2);
    expect(
      (await post('generate', { from: '2026-05-01', to: '2026-05-01' })).body.rows[0].encounterId,
    ).toBe(outsideEncounter);
    const unknown = await post('generate', { ...april, status: 'UNKNOWN' });
    expect(
      unknown.body.rows.find((row: { encounterId: number }) => row.encounterId === unknownEncounter)
        .encounterStatus,
    ).toBe('UNRECOGNISED');
    expect(unknown.body.notes.join(' ')).toContain('not proof of clinical completion');
    expect((await post('generate', { from: '2026-03-01', to: '2026-03-01' })).body.total).toBe(0);
  });

  it('flags absent, conflicting and unsupported coding details without treating them as validated', async () => {
    const id = (
      await pool.query(
        "INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status,started_at) VALUES($1,$2,$3,'OUTPATIENT','ACTIVE','2026-08-01 10:00:00') RETURNING id",
        [tenant, facility, patient],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO diagnoses(encounter_id,patient_id,coding_system,diagnosis_code,icd10_code,icd11_code,icd11_release,status) VALUES
       ($1,$2,'ICD-10',NULL,NULL,NULL,NULL,'Confirmed'),
       ($1,$2,'ICD-11','1A00',NULL,'1A00',NULL,'Confirmed'),
       ($1,$2,'ICD-10','J01','J00',NULL,NULL,'Confirmed'),
       ($1,$2,'UNKNOWN-SYSTEM','SYN',NULL,NULL,NULL,'Confirmed'),
       ($1,$2,'ICD-10','J02','J02',NULL,NULL,NULL)`,
      [id, patient],
    );
    const result = await post('generate', { from: '2026-08-01', to: '2026-08-01' });
    expect(result.status).toBe(200);
    expect(result.body.total).toBe(5);
    expect(
      result.body.rows.every(
        (row: { diagnosisQuality: string }) =>
          row.diagnosisQuality === 'Incomplete coding or diagnosis status',
      ),
    ).toBe(true);
    expect(result.body.notes.join(' ')).toContain('5 row(s) need review');
  });

  it('scopes and audits the searchable patient selector, including an established encounter from another registration facility', async () => {
    const options = await post('options', { kind: 'patient', search: 'DxTransferred', limit: 1 });
    expect(options.status).toBe(200);
    expect(options.body.options.map((option: { id: number }) => option.id)).toEqual([
      transferredPatient,
    ]);
    expect(options.body.hasMore).toBe(false);
    const selected = await post('generate', {
      ...april,
      patientId: transferredPatient,
      departmentId: department,
    });
    expect(selected.status).toBe(200);
    expect(selected.body.rows).toHaveLength(1);
    expect(selected.body.rows[0].encounterId).toBe(unknownEncounter);
    expect((await post('generate', { ...april, patientId: foreignPatient })).status).toBe(400);
    const patientAudit = await pool.query(
      `SELECT action FROM patient_record_access_logs WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 AND user_id=$4 AND record_type IN ('REPORT_CENTRE','REPORT_SELECTION')`,
      [tenant, facility, transferredPatient, actor],
    );
    expect(patientAudit.rows.length).toBeGreaterThan(0);
    expect(
      (await post('options', { kind: 'patient', search: 'DxForeignSecret' })).body.options,
    ).toEqual([]);
  });

  it('paginates real encounter-linked patient options and excludes registration alone', async () => {
    const people = await pool.query(
      `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
       SELECT $1,$2,$3 || n::text,'Synthetic','DxPaged' || n::text,'2000-01-01','Other'
       FROM generate_series(1,23) n RETURNING id`,
      [tenant, facility, `DXPAGED-${suffix}-`],
    );
    await pool.query(
      `INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status,started_at)
       SELECT $1,$2,id,'OUTPATIENT','ACTIVE','2026-07-01 09:00:00' FROM unnest($3::integer[]) id`,
      [tenant, facility, people.rows.map((row) => row.id)],
    );
    const registrationOnly = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
       VALUES($1,$2,$3,'Synthetic','DxRegistrationOnly','2000-01-01','Other') RETURNING id`,
        [tenant, facility, `DXONLY-${suffix}`],
      )
    ).rows[0].id;
    const first = await post('options', {
      kind: 'patient',
      search: 'DxPaged',
      offset: 0,
      limit: 20,
    });
    const second = await post('options', {
      kind: 'patient',
      search: 'DxPaged',
      offset: 20,
      limit: 20,
    });
    expect(first.status).toBe(200);
    expect(first.body.options).toHaveLength(20);
    expect(first.body.hasMore).toBe(true);
    expect(second.body.options).toHaveLength(3);
    expect(second.body.hasMore).toBe(false);
    expect(
      new Set([...first.body.options, ...second.body.options].map((row: { id: number }) => row.id))
        .size,
    ).toBe(23);
    expect(
      (await post('options', { kind: 'patient', search: 'DxRegistrationOnly' })).body.options,
    ).toEqual([]);
    expect((await post('generate', { ...april, patientId: registrationOnly })).status).toBe(400);
    expect((await post('options', { kind: 'patient', limit: 26 })).status).toBe(400);
  });

  it('requires authentication, report and both source permissions, export permission, modules and exact facility scope', async () => {
    expect((await post('generate', april, '')).status).toBe(401);
    for (const auth of [reportsOnly, noClinical, noPatients])
      expect((await post('generate', april, auth)).status).toBe(403);
    expect((await post('export', { ...april, format: 'csv' }, noExport)).status).toBe(403);
    expect((await post('generate', { ...april, intent: 'print' }, noExport)).status).toBe(403);
    expect((await post('generate', { ...april, facilityId: sibling })).status).toBe(403);
    expect((await post('generate', { ...april, facilityId: foreignFacility })).status).toBe(403);
    await pool.query('UPDATE facilities SET hidden_modules=\'["opd"]\'::jsonb WHERE id=$1', [
      facility,
    ]);
    try {
      expect((await post('generate', april)).body.error).toBe('FACILITY_MODULE_DISABLED');
    } finally {
      await pool.query("UPDATE facilities SET hidden_modules='[]'::jsonb WHERE id=$1", [facility]);
    }
  });

  it('rejects invalid dates, unsupported filters, status, injection-shaped IDs and excessive pages', async () => {
    expect((await post('generate')).status).toBe(400);
    expect((await post('generate', { from: april.from })).status).toBe(400);
    for (const filters of [
      { from: '2026-04-30', to: '2026-04-01' },
      { from: '2026-02-30', to: '2026-04-01' },
      { from: '2025-01-01', to: '2026-12-31' },
      { status: 'Confirmed' },
      { patientId: '1 OR 1=1' },
      { staffId: actor },
      { limit: 101 },
      { offset: -1 },
      { unsupported: true },
    ])
      expect((await post('generate', { ...april, ...filters })).status).toBe(400);
    expect((await post('generate', { ...april, search: '%' })).body.total).toBe(0);
  });

  it('exports formula-safe CSV with source filters and records view, print and export requests without search terms', async () => {
    const filters = { ...april, status: 'CANCELLED', search: '=SUM(1,2)' };
    expect((await post('generate', filters)).status).toBe(200);
    expect((await post('generate', { ...filters, intent: 'print' })).status).toBe(200);
    const exported = await post('export', { ...filters, format: 'csv' });
    expect(exported.status).toBe(200);
    const csv = Buffer.from(exported.body.base64, 'base64').toString('utf8');
    expect(csv).toContain('"\'=SUM(1,2)"');
    expect(csv).toContain('2026-04-01 to 2026-04-30 (inclusive)');
    expect(csv).toContain('Status: CANCELLED');
    const audit = await pool.query(
      "SELECT action,details FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND user_id=$3 AND resource='report_centre' AND resource_id='outpatient-diagnoses'",
      [tenant, facility, String(actor)],
    );
    for (const action of ['VIEW', 'PRINT_REQUEST', 'EXPORT_REQUEST'])
      expect(audit.rows.some((row) => row.action === action)).toBe(true);
    expect(JSON.stringify(audit.rows)).not.toContain('=SUM(1,2)');
    const patientAudit = await pool.query(
      "SELECT action FROM patient_record_access_logs WHERE tenant_id=$1 AND facility_id=$2 AND patient_id=$3 AND user_id=$4 AND record_type='REPORT_CENTRE'",
      [tenant, facility, patient, actor],
    );
    for (const action of ['VIEW', 'PRINT', 'EXPORT'])
      expect(patientAudit.rows.some((row) => row.action === action)).toBe(true);
  });

  it('fails closed and returns no report data when either audit write fails', async () => {
    const fn = `synthetic_dx_audit_${suffix}`;
    for (const [table, condition] of [
      [
        'audit_logs',
        `NEW.resource = 'report_centre' AND NEW.resource_id = 'outpatient-diagnoses' AND NEW.user_id = '${actor}'`,
      ],
      [
        'patient_record_access_logs',
        `NEW.record_type = 'REPORT_CENTRE' AND NEW.user_id = ${actor}`,
      ],
    ]) {
      await pool.query(
        `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
      );
      await pool.query(
        `CREATE TRIGGER ${fn} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
      );
      try {
        const before = (
          await pool.query(
            "SELECT count(*)::int AS n FROM audit_logs WHERE user_id=$1 AND resource='report_centre' AND resource_id='outpatient-diagnoses'",
            [String(actor)],
          )
        ).rows[0].n;
        for (const [action, extra] of [
          ['generate', {}],
          ['generate', { intent: 'print' }],
          ['export', { format: 'csv' }],
        ] as const) {
          const response = await post(action, { ...april, patientId: patient, ...extra });
          expect(response.status).toBe(500);
          expect(JSON.stringify(response.body)).not.toContain('DxPrimary');
          expect(response.body.base64).toBeUndefined();
        }
        const after = (
          await pool.query(
            "SELECT count(*)::int AS n FROM audit_logs WHERE user_id=$1 AND resource='report_centre' AND resource_id='outpatient-diagnoses'",
            [String(actor)],
          )
        ).rows[0].n;
        expect(after).toBe(before);
      } finally {
        await pool.query(`DROP TRIGGER ${fn} ON ${table}`);
        await pool.query(`DROP FUNCTION ${fn}()`);
      }
    }
  });

  it('returns no patient options if their privacy audit fails', async () => {
    const fn = `synthetic_dx_selection_${suffix}`;
    await pool.query(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.record_type='REPORT_SELECTION' AND NEW.user_id=${actor} THEN RAISE EXCEPTION 'synthetic selection audit failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${fn} BEFORE INSERT ON patient_record_access_logs FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
    try {
      const response = await post('options', { kind: 'patient', search: 'DxPrimary' });
      expect(response.status).toBe(500);
      expect(response.body.options).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain('DxPrimary');
    } finally {
      await pool.query(`DROP TRIGGER ${fn} ON patient_record_access_logs`);
      await pool.query(`DROP FUNCTION ${fn}()`);
    }
  });

  it('bounds pages and refuses oversized exports rather than truncating them', async () => {
    const bulkPatient = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
       VALUES($1,$2,$3,'Synthetic','DxBulk','2000-01-01','Other') RETURNING id`,
        [tenant, facility, `DXBULK-${suffix}`],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status,started_at)
       SELECT $1,$2,$3,'OUTPATIENT','ACTIVE','2026-06-01 09:00:00' FROM generate_series(1,1000)`,
      [tenant, facility, bulkPatient],
    );
    const filters = { search: 'DxBulk', from: '2026-06-01', to: '2026-06-01', limit: 100 };
    const atLimit = await post('export', { ...filters, format: 'csv' });
    expect(atLimit.status).toBe(200);
    expect(Buffer.from(atLimit.body.base64, 'base64').toString('utf8')).toContain('Records: 1000');
    await pool.query(
      "INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status,started_at) VALUES($1,$2,$3,'OUTPATIENT','ACTIVE','2026-06-01 09:00:00')",
      [tenant, facility, bulkPatient],
    );
    const first = await post('generate', filters);
    const second = await post('generate', { ...filters, offset: 100 });
    expect(first.body.total).toBe(1001);
    expect(first.body.rows).toHaveLength(100);
    expect(second.body.rows).toHaveLength(100);
    const ids = [...first.body.rows, ...second.body.rows].map(
      (row: { encounterId: number }) => row.encounterId,
    );
    expect(new Set(ids).size).toBe(200);
    const tooLarge = await post('export', { ...filters, format: 'csv' });
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error).toBe('REPORT_EXPORT_TOO_LARGE');
  });
});
