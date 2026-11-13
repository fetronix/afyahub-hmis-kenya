/** Synthetic PostgreSQL acceptance for scoped inpatient occupancy and concurrency. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { pool } from '../../db/index.ts';
import {
  createAdmissionScoped,
  dischargeAdmissionScoped,
  transferAdmissionScoped,
} from '../../db/queries/inpatient.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

// Wait until the test transaction really blocks another connection, not a guessed delay.
async function waitForBlockedBy(pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      'SELECT count(*)::int AS count FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
      [pid],
    );
    if (result.rows[0].count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Expected database lock was not observed.');
}

describeDb('Inpatient admission, transfer and discharge (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number, facility: number, otherTenant: number, otherFacility: number, ward: number;
  let actorId: number, token: string, readerToken: string, otherToken: string;
  let ctx: AuthorizationContext;
  let base: string, close: () => Promise<void>;
  let patientCounter = 0,
    bedCounter = 0;
  const call = (method: string, path: string, auth?: string, body?: Record<string, unknown>) =>
    httpJson(base, method, path, { token: auth, body });
  const patient = async (tenantId = tenant, facilityId = facility) =>
    (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Test','2000-01-01','Other') RETURNING id",
        [tenantId, facilityId, `IP-${suffix}-${++patientCounter}`],
      )
    ).rows[0].id as number;
  const bed = async (status = 'Available') =>
    (
      await pool.query(
        'INSERT INTO beds(ward_id,bed_number,status) VALUES($1,$2,$3) RETURNING id',
        [ward, `IP-${suffix}-${++bedCounter}`, status],
      )
    ).rows[0].id as number;
  const admit = (patientId: number, bedId: number) =>
    createAdmissionScoped(ctx, {
      patientId,
      wardId: ward,
      bedId,
      admissionDate: '2026-10-29T08:00:00Z',
    });

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    [tenant, otherTenant] = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id', [
        `Synthetic inpatient ${suffix}`,
        `ip-a-${suffix}`,
        `Synthetic other ${suffix}`,
        `ip-b-${suffix}`,
      ])
    ).rows.map((r) => r.id);
    [facility, otherFacility] = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic A',$5::jsonb),($3,$4,'Synthetic B',$5::jsonb) RETURNING id",
        [
          tenant,
          `IPA-${suffix}`,
          otherTenant,
          `IPB-${suffix}`,
          JSON.stringify(['inpatient', 'finance']),
        ],
      )
    ).rows.map((r) => r.id);
    ward = (
      await pool.query('INSERT INTO wards(facility_id,name,code) VALUES($1,$2,$3) RETURNING id', [
        facility,
        'Synthetic ward',
        `W-${suffix}`,
      ])
    ).rows[0].id;
    for (const code of ['inpatient.read', 'inpatient.admit', 'inpatient.discharge'])
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'inpatient') ON CONFLICT(code) DO NOTHING",
        [code],
      );
    const user = async (tag: string, t: number, f: number, grants: string[]) => {
      const id = (
        await pool.query(
          "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,$3,'test-only','ACTIVE',$4,$5) RETURNING id",
          [`ip-${tag}-${suffix}`, `ip-${tag}-${suffix}@example.test`, `Synthetic ${tag}`, t, f],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [t, `IP_${tag}_${suffix}`],
        )
      ).rows[0].id;
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
      for (const code of grants)
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
          [role, code],
        );
      return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
    };
    const manager = await user('manager', tenant, facility, [
      'inpatient.read',
      'inpatient.admit',
      'inpatient.discharge',
    ]);
    const reader = await user('reader', tenant, facility, ['inpatient.read']);
    const other = await user('other', otherTenant, otherFacility, [
      'inpatient.read',
      'inpatient.admit',
      'inpatient.discharge',
    ]);
    actorId = manager.id;
    token = manager.token;
    readerToken = reader.token;
    otherToken = other.token;
    ctx = {
      userId: actorId,
      tenantId: tenant,
      facilityId: facility,
      roles: [],
      permissions: [],
      isSuperAdmin: false,
    };
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('enforces authentication, admission permission, and tenant/facility isolation', async () => {
    const p = await patient(),
      b = await bed();
    const body = { patientId: p, wardId: ward, bedId: b, facilityId: facility };
    expect((await call('POST', '/api/admissions', undefined, body)).status).toBe(401);
    expect((await call('POST', '/api/admissions', readerToken, body)).status).toBe(403);
    expect((await call('POST', '/api/admissions', otherToken, body)).status).toBe(403);
    expect((await call('GET', `/api/admissions?facilityId=${facility}`, otherToken)).status).toBe(
      403,
    );
    const foreignPatient = await patient(otherTenant, otherFacility);
    expect(
      (await call('POST', '/api/admissions', token, { ...body, patientId: foreignPatient })).status,
    ).toBe(403);
  });

  it('admits, transfers, preserves history, discharges the recorded bed and releases only after cleaning', async () => {
    const p = await patient(),
      first = await bed(),
      destination = await bed(),
      occupied = await bed();
    const created = await call('POST', '/api/admissions', token, {
      patientId: p,
      wardId: ward,
      bedId: first,
      facilityId: facility,
      admissionDate: '2026-10-29T08:00:00Z',
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const secondPatient = await patient();
    const second = await admit(secondPatient, occupied);
    const moved = await call('POST', `/api/admissions/${id}/transfer`, token, {
      toWardId: ward,
      toBedId: destination,
      reason: 'Synthetic move',
    });
    expect(moved.status).toBe(200);
    expect(moved.body.transfer).toMatchObject({ fromBedId: first, toBedId: destination });
    const history = await call('GET', `/api/admissions/${id}/transfers`, token);
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(1);
    const firstState = (
      await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [first])
    ).rows[0];
    expect(firstState).toEqual({ status: 'Cleaning', current_patient_id: null });
    const closed = await call('POST', `/api/admissions/${id}/discharge`, token, {
      bedId: occupied,
      dischargeDate: '2026-10-30T08:00:00Z',
      dischargeType: 'Synthetic',
      dischargeSummary: 'Synthetic summary',
    });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('Discharged');
    const states = (
      await pool.query(
        'SELECT id,status,current_patient_id FROM beds WHERE id=ANY($1::int[]) ORDER BY id',
        [[destination, occupied]],
      )
    ).rows;
    expect(states.find((r) => r.id === destination)).toMatchObject({
      status: 'Cleaning',
      current_patient_id: null,
    });
    expect(states.find((r) => r.id === occupied)).toMatchObject({
      status: 'Occupied',
      current_patient_id: secondPatient,
    });
    expect(
      (
        await call('POST', `/api/admissions/${id}/discharge`, token, {
          dischargeSummary: 'Overwrite attempt',
        })
      ).status,
    ).toBe(409);
    expect((await call('PUT', `/api/beds/${destination}/release`, token)).status).toBe(200);
    expect(
      (await pool.query('SELECT status FROM beds WHERE id=$1', [destination])).rows[0].status,
    ).toBe('Available');
    expect(
      (await pool.query('SELECT status FROM admissions WHERE id=$1', [second.id])).rows[0].status,
    ).toBe('Admitted');
    const audits = await pool.query(
      "SELECT action,details FROM audit_logs WHERE resource='Admission' AND resource_id=$1 ORDER BY id",
      [String(id)],
    );
    expect(audits.rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE', 'UPDATE']);
    expect(audits.rows.every((r) => !String(r.details).includes('Synthetic summary'))).toBe(true);
  });

  it('refuses an uncleaned or inconsistently occupied bed until it is explicitly released', async () => {
    const cleaning = await bed('Cleaning'),
      p = await patient();
    await expect(admit(p, cleaning)).rejects.toMatchObject({ code: 'BED_NOT_AVAILABLE' });
    expect((await call('PUT', `/api/beds/${cleaning}/release`, token)).status).toBe(200);
    expect((await admit(p, cleaning)).status).toBe('Admitted');
  });

  it('allows only one concurrent admission for a bed and for a patient', async () => {
    const a = await patient(),
      b = await patient(),
      shared = await bed();
    const sameBed = await Promise.allSettled([admit(a, shared), admit(b, shared)]);
    expect(sameBed.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(sameBed.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const onBed = await pool.query(
      "SELECT patient_id FROM admissions WHERE bed_id=$1 AND status='Admitted'",
      [shared],
    );
    expect(onBed.rows).toHaveLength(1);
    const p = await patient(),
      first = await bed(),
      second = await bed();
    const samePatient = await Promise.allSettled([admit(p, first), admit(p, second)]);
    expect(samePatient.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(samePatient.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(
      (
        await pool.query(
          "SELECT id FROM admissions WHERE facility_id=$1 AND patient_id=$2 AND status='Admitted'",
          [facility, p],
        )
      ).rows,
    ).toHaveLength(1);
  });

  it('enforces active-admission uniqueness even for direct SQL writers', async () => {
    const p = await patient(),
      first = await bed(),
      second = await bed();
    await admit(p, first);
    await expect(
      pool.query(
        "INSERT INTO admissions(tenant_id,facility_id,patient_id,ward_id,bed_id,admission_date,status) VALUES($1,$2,$3,$4,$5,'2026-10-29','Admitted')",
        [tenant, facility, p, ward, second],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    const q = await patient();
    await expect(
      pool.query(
        "INSERT INTO admissions(tenant_id,facility_id,patient_id,ward_id,bed_id,admission_date,status) VALUES($1,$2,$3,$4,$5,'2026-10-29','Admitted')",
        [tenant, facility, q, ward, first],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('does not transfer an admission that was discharged while the transfer was waiting', async () => {
    const p = await patient(),
      first = await bed(),
      destination = await bed();
    const record = await admit(p, first);
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      const pid = (await holder.query('SELECT pg_backend_pid() AS id')).rows[0].id;
      await holder.query('SELECT id FROM admissions WHERE id=$1 FOR UPDATE', [record.id]);
      const pending = transferAdmissionScoped(ctx, record.id, {
        toWardId: ward,
        toBedId: destination,
        reason: 'Synthetic race',
        transferredBy: 'Synthetic',
      }).then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error }),
      );
      await waitForBlockedBy(pid);
      // Synthetic competing discharge while holding the lock, including bed release.
      await holder.query(
        "UPDATE admissions SET status='Discharged',discharge_date='2026-10-30T08:00:00Z' WHERE id=$1",
        [record.id],
      );
      await holder.query("UPDATE beds SET status='Cleaning',current_patient_id=NULL WHERE id=$1", [
        first,
      ]);
      await holder.query('COMMIT');
      const result = await pending;
      expect(result.error).toMatchObject({ code: 'ADMISSION_ALREADY_CLOSED' });
      expect(
        (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [destination]))
          .rows[0],
      ).toEqual({ status: 'Available', current_patient_id: null });
      expect(
        (await pool.query('SELECT id FROM admission_transfers WHERE admission_id=$1', [record.id]))
          .rows,
      ).toHaveLength(0);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
  });

  it('rolls back a new admission and bed occupancy if its audit write fails', async () => {
    const p = await patient(),
      b = await bed();
    const fn = `test_admission_audit_${suffix.replaceAll('-', '')}`;
    const trigger = `test_admission_audit_trigger_${suffix.replaceAll('-', '')}`;
    await pool.query(
      `CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`,
    );
    try {
      await pool.query(
        `CREATE TRIGGER "${trigger}" BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.facility_id = ${facility} AND NEW.resource = 'Admission') EXECUTE FUNCTION "${fn}"()`,
      );
      await expect(admit(p, b)).rejects.toThrow();
      expect(
        (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [b])).rows[0],
      ).toEqual({ status: 'Available', current_patient_id: null });
      expect(
        (
          await pool.query('SELECT id FROM admissions WHERE patient_id=$1 AND facility_id=$2', [
            p,
            facility,
          ])
        ).rows,
      ).toHaveLength(0);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${trigger}" ON audit_logs`);
      await pool.query(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }
  });

  it('refuses transfer, discharge and housekeeping for inconsistent current-bed occupancy', async () => {
    const p = await patient(),
      current = await bed(),
      destination = await bed();
    const record = await admit(p, current);
    // Corruption exists only in the disposable fixture; the service must not repair it silently.
    await pool.query("UPDATE beds SET status='Cleaning',current_patient_id=NULL WHERE id=$1", [
      current,
    ]);
    await expect(dischargeAdmissionScoped(ctx, record.id, {})).rejects.toMatchObject({
      code: 'BED_STATUS_CONFLICT',
    });
    await expect(
      transferAdmissionScoped(ctx, record.id, {
        toWardId: ward,
        toBedId: destination,
        transferredBy: 'Synthetic',
      }),
    ).rejects.toMatchObject({ code: 'BED_STATUS_CONFLICT' });
    expect((await call('PUT', `/api/beds/${current}/release`, token)).status).toBe(409);
    expect(
      (await pool.query('SELECT status,bed_id FROM admissions WHERE id=$1', [record.id])).rows[0],
    ).toEqual({ status: 'Admitted', bed_id: current });
    expect(
      (await pool.query('SELECT status,current_patient_id FROM beds WHERE id=$1', [destination]))
        .rows[0],
    ).toEqual({ status: 'Available', current_patient_id: null });
    expect(
      (await pool.query('SELECT id FROM admission_transfers WHERE admission_id=$1', [record.id]))
        .rows,
    ).toHaveLength(0);
  });

  it('allows exactly one concurrent discharge and preserves the first summary', async () => {
    const p = await patient(),
      b = await bed();
    const record = await admit(p, b);
    const results = await Promise.allSettled([
      dischargeAdmissionScoped(ctx, record.id, { dischargeSummary: 'First synthetic summary' }),
      dischargeAdmissionScoped(ctx, record.id, { dischargeSummary: 'Second synthetic summary' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const stored = (
      await pool.query('SELECT status,discharge_summary FROM admissions WHERE id=$1', [record.id])
    ).rows[0];
    expect(stored.status).toBe('Discharged');
    expect(['First synthetic summary', 'Second synthetic summary']).toContain(
      stored.discharge_summary,
    );
    const audit = await pool.query(
      "SELECT action FROM audit_logs WHERE resource='Admission' AND resource_id=$1",
      [String(record.id)],
    );
    expect(audit.rows.filter((r) => r.action === 'UPDATE')).toHaveLength(1);
  });
});
