/** Authenticated HTTP acceptance of Theatre scheduling against disposable PostgreSQL only. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { cancelBooking } from '../../theatre/scheduling.service.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Theatre scheduling, isolation and safety (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().slice(0, 8);
  let base: string, close: () => Promise<void>;
  let tenantA: number,
    tenantB: number,
    facilityA: number,
    facilitySibling: number,
    facilityB: number,
    facilityDisabled: number;
  let patientA: number, patientB: number, patientC: number, foreignPatient: number;
  let clinicianA: number, clinicianB: number, clinicianC: number, foreignClinician: number;
  let roomA: number, roomB: number, firstCase: number;
  let manager: { id: number; token: string },
    reader: { id: number; token: string },
    foreign: { id: number; token: string },
    sibling: { id: number; token: string },
    disabled: { id: number; token: string };
  const call = (method: string, path: string, token?: string, body?: Record<string, unknown>) =>
    httpJson(base, method, path, { token, body });
  const booking = (overrides: Record<string, unknown> = {}) => ({
    facilityId: facilityA,
    patientId: patientA,
    procedureName: 'Synthetic procedure',
    leadPractitionerId: clinicianA,
    urgency: 'ELECTIVE',
    roomId: roomA,
    startsAt: '2030-01-01T08:00:00Z',
    endsAt: '2030-01-01T09:00:00Z',
    requestKey: randomUUID(),
    ...overrides,
  });
  const create = (body: Record<string, unknown>, token = manager.token) =>
    call('POST', '/api/theatre/cases', token, body);

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('A disposable test database is required.');
    [tenantA, tenantB] = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id', [
        `Synthetic A ${suffix}`,
        `theatre-a-${suffix}`,
        `Synthetic B ${suffix}`,
        `theatre-b-${suffix}`,
      ])
    ).rows.map((r) => r.id);
    [facilityA, facilitySibling, facilityB, facilityDisabled] = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES ($1,$2,'Synthetic A',$7::jsonb),($1,$3,'Sibling',$7::jsonb),($4,$5,'Synthetic B',$7::jsonb),($1,$6,'Disabled','[]'::jsonb) RETURNING id`,
        [
          tenantA,
          `TA-${suffix}`,
          `TS-${suffix}`,
          tenantB,
          `TB-${suffix}`,
          `TD-${suffix}`,
          JSON.stringify(['theatre', 'inpatient']),
        ],
      )
    ).rows.map((r) => r.id);
    const patient = async (tenant: number, facility: number, tag: string) =>
      (
        await pool.query(
          `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic',$4,'2000-01-01','Other') RETURNING id`,
          [tenant, facility, `TH-${tag}-${suffix}`, tag],
        )
      ).rows[0].id as number;
    patientA = await patient(tenantA, facilityA, 'A');
    patientB = await patient(tenantA, facilityA, 'B');
    patientC = await patient(tenantA, facilityA, 'C');
    foreignPatient = await patient(tenantB, facilityB, 'Foreign');
    const practitioner = async (tenant: number, facility: number, tag: string) =>
      (
        await pool.query(
          `INSERT INTO practitioners(tenant_id,facility_id,full_name,profession,credential_verification_status) VALUES($1,$2,$3,'Synthetic practitioner','PENDING') RETURNING id`,
          [tenant, facility, `Synthetic clinician ${tag} ${suffix}`],
        )
      ).rows[0].id as number;
    clinicianA = await practitioner(tenantA, facilityA, 'A');
    clinicianB = await practitioner(tenantA, facilityA, 'B');
    clinicianC = await practitioner(tenantA, facilityA, 'C');
    foreignClinician = await practitioner(tenantB, facilityB, 'foreign');
    for (const code of [
      'theatre.read',
      'theatre.reports.read',
      'theatre.rooms.manage',
      'theatre.schedule.create',
      'theatre.schedule.manage',
      'theatre.schedule.reconcile',
    ]) {
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'theatre') ON CONFLICT(code) DO NOTHING",
        [code],
      );
    }
    const actor = async (tag: string, tenant: number, facility: number, grants: string[]) => {
      const id = (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,$3,'test-only','ACTIVE',$4,$5) RETURNING id`,
          [
            `th-${tag}-${suffix}`,
            `th-${tag}-${suffix}@example.test`,
            `Synthetic ${tag}`,
            tenant,
            facility,
          ],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenant, `THEATRE_${tag}_${suffix}`],
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
    const all = [
      'theatre.read',
      'theatre.reports.read',
      'theatre.rooms.manage',
      'theatre.schedule.create',
      'theatre.schedule.manage',
      'theatre.schedule.reconcile',
    ];
    manager = await actor('manager', tenantA, facilityA, all);
    reader = await actor('reader', tenantA, facilityA, ['theatre.read']);
    foreign = await actor('foreign', tenantB, facilityB, all);
    sibling = await actor('sibling', tenantA, facilitySibling, all);
    disabled = await actor('disabled', tenantA, facilityDisabled, all);
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('enforces authentication, facility-module enablement, and separate permissions', async () => {
    expect((await call('GET', `/api/theatre/rooms?facilityId=${facilityA}`)).status).toBe(401);
    const forbidden = await call('POST', '/api/theatre/rooms', reader.token, {
      facilityId: facilityA,
      name: 'Not authorized',
    });
    expect(forbidden.status).toBe(403);
    const disabledResult = await call(
      'GET',
      `/api/theatre/rooms?facilityId=${facilityDisabled}`,
      disabled.token,
    );
    expect(disabledResult.status).toBe(403);
    expect(disabledResult.body.error).toBe('FACILITY_MODULE_DISABLED');
    expect(
      (await call('GET', `/api/theatre/rooms?facilityId=${facilityA}`, sibling.token)).status,
    ).toBe(403);
    expect(
      (await call('GET', `/api/theatre/cases?facilityId=${facilityA}`, foreign.token)).status,
    ).toBe(403);
  });

  it('creates real facility rooms, enforces unique names and audits operational state', async () => {
    const a = await call('POST', '/api/theatre/rooms', manager.token, {
      facilityId: facilityA,
      name: `Operating A ${suffix}`,
    });
    const b = await call('POST', '/api/theatre/rooms', manager.token, {
      facilityId: facilityA,
      name: `Operating B ${suffix}`,
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    roomA = a.body.id;
    roomB = b.body.id;
    const duplicate = await call('POST', '/api/theatre/rooms', manager.token, {
      facilityId: facilityA,
      name: `operating a ${suffix}`,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe('THEATRE_ROOM_EXISTS');
    const maintenance = await call('PATCH', `/api/theatre/rooms/${roomB}`, manager.token, {
      facilityId: facilityA,
      state: 'MAINTENANCE',
    });
    expect(maintenance.status).toBe(200);
    expect(maintenance.body.state).toBe('MAINTENANCE');
    const blocked = await create(booking({ roomId: roomB }));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('THEATRE_ROOM_NOT_OPEN');
    expect(
      (
        await call('PATCH', `/api/theatre/rooms/${roomB}`, manager.token, {
          facilityId: facilityA,
          state: 'OPEN',
        })
      ).status,
    ).toBe(200);
    const audits = await pool.query(
      "SELECT action FROM audit_logs WHERE facility_id=$1 AND resource='theatre_room' AND resource_id=$2 ORDER BY id",
      [facilityA, String(roomB)],
    );
    expect(audits.rows.map((r) => r.action)).toEqual([
      'THEATRE_ROOM_CREATED',
      'THEATRE_ROOM_STATE_CHANGED',
      'THEATRE_ROOM_STATE_CHANGED',
    ]);
  });

  it('rejects invalid dates, untrusted keys and cross-facility patient or practitioner references', async () => {
    for (const body of [
      booking({ startsAt: '2030-01-01 08:00' }),
      booking({ endsAt: '2030-01-01T07:00:00Z' }),
      booking({ requestKey: 'not-a-uuid' }),
      booking({ status: 'Completed' }),
    ]) {
      const result = await create(body);
      expect(result.status).toBe(400);
      expect(result.body.error).toBe('VALIDATION_ERROR');
    }
    const patient = await create(booking({ patientId: foreignPatient }));
    expect(patient.status).toBe(404);
    expect(patient.body.error).toBe('PATIENT_NOT_FOUND');
    const clinician = await create(booking({ leadPractitionerId: foreignClinician }));
    expect(clinician.status).toBe(404);
    expect(clinician.body.error).toBe('PRACTITIONER_NOT_FOUND');
    const room = await create(booking({ facilityId: facilityB }), foreign.token);
    expect(room.status).toBe(404);
    expect((await create(booking(), reader.token)).status).toBe(403);
    expect(
      (await call('GET', `/api/theatre-cases?facilityId=${facilityA}`, reader.token)).status,
    ).toBe(403);
  });

  it('creates exactly one elective case on concurrent identical retries and refuses changed-key reuse', async () => {
    const body = booking();
    const results = await Promise.all([create(body), create(body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results[0].body.record.id).toBe(results[1].body.record.id);
    expect(results.map((r) => r.body.replayed).sort()).toEqual([false, true]);
    firstCase = results[0].body.record.id;
    expect(results[0].body.record.status).toBe('Scheduled');
    expect(results[0].body.record.preOpChecklist).toBeUndefined();
    expect(
      (await pool.query('SELECT pre_op_checklist FROM theatre_cases WHERE id=$1', [firstCase]))
        .rows[0].pre_op_checklist,
    ).toEqual({});
    expect(results[0].body.booking.requestHash).toBeUndefined();
    expect(results[0].body.booking.requestKey).toBeUndefined();
    const changed = await create({ ...body, procedureName: 'A different procedure' });
    expect(changed.status).toBe(409);
    expect(changed.body.error).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(
      Number(
        (
          await pool.query('SELECT count(*) FROM theatre_schedule_events WHERE case_id=$1', [
            firstCase,
          ])
        ).rows[0].count,
      ),
    ).toBe(1);
  });

  it('prevents room, patient and lead-practitioner overlaps, while permitting adjacent slots', async () => {
    const room = await create(booking({ patientId: patientB, leadPractitionerId: clinicianB }));
    expect(room.status).toBe(409);
    expect(room.body.error).toBe('ROOM_SCHEDULE_CONFLICT');
    const patient = await create(booking({ roomId: roomB, leadPractitionerId: clinicianB }));
    expect(patient.status).toBe(409);
    expect(patient.body.error).toBe('PATIENT_SCHEDULE_CONFLICT');
    const clinician = await create(booking({ roomId: roomB, patientId: patientB }));
    expect(clinician.status).toBe(409);
    expect(clinician.body.error).toBe('PRACTITIONER_SCHEDULE_CONFLICT');
    const adjacent = await create(
      booking({ startsAt: '2030-01-01T09:00:00Z', endsAt: '2030-01-01T10:00:00Z' }),
    );
    expect(adjacent.status).toBe(201);
  });

  it('serializes competing simultaneous bookings and leaves no partial case on conflict', async () => {
    const one = booking({
      patientId: patientB,
      leadPractitionerId: clinicianB,
      startsAt: '2030-01-06T08:00:00Z',
      endsAt: '2030-01-06T09:00:00Z',
    });
    const two = booking({
      patientId: patientC,
      leadPractitionerId: clinicianC,
      startsAt: '2030-01-06T08:15:00Z',
      endsAt: '2030-01-06T09:15:00Z',
    });
    const results = await Promise.all([create(one), create(two)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.error).toBe('ROOM_SCHEDULE_CONFLICT');
    const rows = await pool.query(
      `SELECT count(*) FROM theatre_bookings WHERE facility_id=$1 AND starts_at >= '2030-01-06T08:00:00Z' AND starts_at < '2030-01-06T10:00:00Z'`,
      [facilityA],
    );
    expect(Number(rows.rows[0].count)).toBe(1);
    const cases = await pool.query(
      `SELECT count(*) FROM theatre_cases WHERE facility_id=$1 AND scheduled_start LIKE '2030-01-06%'`,
      [facilityA],
    );
    expect(Number(cases.rows[0].count)).toBe(1);
  });

  it('rolls back a cancellation when writing its history fails', async () => {
    const result = await create(
      booking({
        patientId: patientB,
        leadPractitionerId: clinicianB,
        startsAt: '2030-01-07T08:00:00Z',
        endsAt: '2030-01-07T09:00:00Z',
      }),
    );
    expect(result.status).toBe(201);
    const id = result.body.record.id;
    // An impossible actor causes the event foreign key to fail after the attempted updates.
    await expect(
      cancelBooking({ tenantId: tenantA, facilityId: facilityA, actorId: 2147483647 }, id, {
        expectedRevision: 1,
        reason: 'Synthetic failure',
      }),
    ).rejects.toThrow();
    const conflict = await call('POST', `/api/theatre/cases/${id}/reschedule`, manager.token, {
      facilityId: facilityA,
      expectedRevision: 1,
      roomId: roomA,
      startsAt: '2030-01-01T09:00:00Z',
      endsAt: '2030-01-01T10:00:00Z',
      reason: 'Synthetic conflicting move',
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('ROOM_SCHEDULE_CONFLICT');
    const state = await pool.query(
      'SELECT c.status,b.reserved,b.revision FROM theatre_cases c JOIN theatre_bookings b ON b.case_id=c.id WHERE c.id=$1',
      [id],
    );
    expect(state.rows[0]).toEqual({ status: 'Scheduled', reserved: true, revision: 1 });
    const events = await pool.query(
      'SELECT action FROM theatre_schedule_events WHERE case_id=$1 ORDER BY id',
      [id],
    );
    expect(events.rows.map((r) => r.action)).toEqual(['SCHEDULED']);
    const audits = await pool.query(
      "SELECT action FROM audit_logs WHERE resource='theatre_case' AND resource_id=$1",
      [String(id)],
    );
    expect(audits.rows.map((r) => r.action)).toEqual(['THEATRE_CASE_SCHEDULED']);
  });

  it('records urgent and emergency bookings without implying consent or readiness', async () => {
    for (const [urgency, day] of [
      ['URGENT', '02'],
      ['EMERGENCY', '03'],
    ]) {
      const result = await create(
        booking({
          urgency,
          startsAt: `2030-01-${day}T08:00:00Z`,
          endsAt: `2030-01-${day}T09:00:00Z`,
        }),
      );
      expect(result.status).toBe(201);
      expect(result.body.booking.urgency).toBe(urgency);
      expect(result.body.record.status).toBe('Scheduled');
      expect(result.body.record.preOpChecklist).toBeUndefined();
      expect(
        (
          await pool.query('SELECT pre_op_checklist FROM theatre_cases WHERE id=$1', [
            result.body.record.id,
          ])
        ).rows[0].pre_op_checklist,
      ).toEqual({});
    }
  });

  it('reschedules and cancels with revision checks, history and atomic audit', async () => {
    const moved = await call('POST', `/api/theatre/cases/${firstCase}/reschedule`, manager.token, {
      facilityId: facilityA,
      expectedRevision: 1,
      roomId: roomB,
      startsAt: '2030-01-01T11:00:00Z',
      endsAt: '2030-01-01T12:00:00Z',
      reason: 'Synthetic scheduling reason',
    });
    expect(moved.status).toBe(200);
    expect(moved.body.booking.revision).toBe(2);
    const stale = await call('POST', `/api/theatre/cases/${firstCase}/cancel`, manager.token, {
      facilityId: facilityA,
      expectedRevision: 1,
      reason: 'Synthetic cancellation',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('STALE_THEATRE_BOOKING');
    const canceled = await call('POST', `/api/theatre/cases/${firstCase}/cancel`, manager.token, {
      facilityId: facilityA,
      expectedRevision: 2,
      reason: 'Synthetic cancellation',
    });
    expect(canceled.status).toBe(200);
    expect(canceled.body.booking.reserved).toBe(false);
    expect(canceled.body.booking.revision).toBe(3);
    const retry = await call('POST', `/api/theatre/cases/${firstCase}/cancel`, manager.token, {
      facilityId: facilityA,
      expectedRevision: 2,
      reason: 'Synthetic cancellation',
    });
    expect(retry.status).toBe(409);
    const events = await call(
      'GET',
      `/api/theatre/cases/${firstCase}/history?facilityId=${facilityA}`,
      reader.token,
    );
    expect(events.status).toBe(200);
    expect(events.body.map((e: { action: string }) => e.action)).toEqual([
      'SCHEDULED',
      'RESCHEDULED',
      'CANCELLED',
    ]);
    expect(events.body[1].reason).toBe('Synthetic scheduling reason');
    expect(events.body[2].actorId).toBe(manager.id);
    const audits = await pool.query(
      "SELECT action,details FROM audit_logs WHERE facility_id=$1 AND resource='theatre_case' AND resource_id=$2 ORDER BY id",
      [facilityA, String(firstCase)],
    );
    expect(audits.rows.map((a) => a.action)).toEqual([
      'THEATRE_CASE_SCHEDULED',
      'THEATRE_CASE_RESCHEDULED',
      'THEATRE_CASE_CANCELLED',
    ]);
    expect(
      audits.rows.every((a) => !String(a.details).includes('Synthetic scheduling reason')),
    ).toBe(true);
    const reuse = await create(
      booking({ roomId: roomB, startsAt: '2030-01-01T11:00:00Z', endsAt: '2030-01-01T12:00:00Z' }),
    );
    expect(reuse.status).toBe(201);
    expect(
      (
        await call(
          'GET',
          `/api/theatre/cases/${firstCase}/history?facilityId=${facilityB}`,
          foreign.token,
        )
      ).status,
    ).toBe(404);
  });

  it('reports only persisted structured plans within the requested window, with separate authorization', async () => {
    const query = new URLSearchParams({
      facilityId: String(facilityA),
      from: '2030-01-01T00:00:00Z',
      to: '2030-01-02T00:00:00Z',
    });
    const path = `/api/theatre/reports/schedule?${query.toString()}`;
    expect((await call('GET', path, reader.token)).status).toBe(403);
    expect((await call('GET', path, foreign.token)).status).toBe(403);
    const result = await call('GET', path, manager.token);
    expect(result.status).toBe(200);
    expect(result.body.totals).toEqual({
      bookings: 3,
      reserved: 2,
      cancelled: 1,
      otherUnreserved: 0,
      reservedMinutes: 120,
    });
    expect(result.body.rows.every((row: Record<string, unknown>) => !('patientId' in row))).toBe(
      true,
    );
    const invalid = new URLSearchParams({
      facilityId: String(facilityA),
      from: '2030-01-02T00:00:00Z',
      to: '2030-01-01T00:00:00Z',
    });
    expect(
      (await call('GET', `/api/theatre/reports/schedule?${invalid.toString()}`, manager.token))
        .status,
    ).toBe(400);
  });

  it('does not allow legacy writes to bypass consent, safety checks or schedule auditing', async () => {
    const oldPost = await call('POST', '/api/theatre-cases', manager.token, {
      facilityId: facilityA,
      patientId: patientA,
      procedureName: 'Synthetic',
      leadSurgeon: 'Synthetic',
      scheduledStart: '2030-01-01',
    });
    expect(oldPost.status).toBe(409);
    expect(oldPost.body.error).toBe('LEGACY_THEATRE_WRITE_DISABLED');
    for (const patch of [
      { status: 'In-Theatre' },
      { status: 'Recovery' },
      { status: 'Completed' },
      { preOpChecklist: { patientIdentityConfirmed: true } },
    ]) {
      const oldPut = await call('PUT', `/api/theatre-cases/${firstCase}`, manager.token, {
        facilityId: facilityA,
        ...patch,
      });
      expect(oldPut.status).toBe(409);
      expect(oldPut.body.error).toBe('LEGACY_THEATRE_WRITE_DISABLED');
    }
    const row = await pool.query('SELECT status,pre_op_checklist FROM theatre_cases WHERE id=$1', [
      firstCase,
    ]);
    expect(row.rows[0].status).toBe('Cancelled');
    expect(row.rows[0].pre_op_checklist).toEqual({});
  });

  it('blocks scheduling until active legacy free-text bookings are reviewed', async () => {
    const legacy = (
      await pool.query(
        `INSERT INTO theatre_cases(tenant_id,facility_id,patient_id,procedure_name,lead_surgeon,scheduled_start,status) VALUES($1,$2,$3,'Synthetic legacy','Synthetic','unknown','Scheduled') RETURNING id`,
        [tenantA, facilityA, patientB],
      )
    ).rows[0].id;
    await pool.query(
      "UPDATE theatre_cases SET post_op_notes='Synthetic restricted note', pre_op_checklist='{}'::jsonb WHERE id=$1",
      [legacy],
    );
    const list = await call('GET', `/api/theatre/cases?facilityId=${facilityA}`, reader.token);
    expect(list.status).toBe(200);
    const legacyView = list.body.find((entry: { id: number }) => entry.id === legacy);
    expect(legacyView.postOpNotes).toBeUndefined();
    expect(legacyView.preOpChecklist).toBeUndefined();
    const result = await create(
      booking({
        patientId: patientB,
        leadPractitionerId: clinicianB,
        startsAt: '2030-01-04T08:00:00Z',
        endsAt: '2030-01-04T09:00:00Z',
      }),
    );
    expect(result.status).toBe(409);
    expect(result.body.error).toBe('LEGACY_SCHEDULE_REVIEW_REQUIRED');
    // A historical status is not by itself evidence that the reservation is gone.
    await pool.query("UPDATE theatre_cases SET status='Completed' WHERE id=$1", [legacy]);
    expect(
      (
        await create(
          booking({
            patientId: patientB,
            leadPractitionerId: clinicianB,
            startsAt: '2030-01-04T08:00:00Z',
            endsAt: '2030-01-04T09:00:00Z',
          }),
        )
      ).body.error,
    ).toBe('LEGACY_SCHEDULE_REVIEW_REQUIRED');
    const path = `/api/theatre/cases/${legacy}/legacy-review`;
    const review = {
      facilityId: facilityA,
      action: 'NO_ACTIVE_RESERVATION',
      reason: 'Synthetic manual review',
      acknowledged: true,
    };
    expect((await call('POST', path, reader.token, review)).status).toBe(403);
    expect(
      (await call('POST', path, manager.token, { ...review, acknowledged: false })).status,
    ).toBe(400);
    expect(
      (await call('POST', path, foreign.token, { ...review, facilityId: facilityB })).status,
    ).toBe(404);
    expect((await call('POST', path, manager.token, review)).status).toBe(201);
    expect((await call('POST', path, manager.token, review)).status).toBe(409);
    const accepted = await create(
      booking({
        patientId: patientB,
        leadPractitionerId: clinicianB,
        startsAt: '2030-01-04T08:00:00Z',
        endsAt: '2030-01-04T09:00:00Z',
      }),
    );
    expect(accepted.status).toBe(201);
    const revoked = await call('POST', path, manager.token, {
      facilityId: facilityA,
      action: 'REVOKED',
      reason: 'Synthetic correction',
    });
    expect(revoked.status).toBe(201);
    const blockedAgain = await create(
      booking({
        patientId: patientC,
        leadPractitionerId: clinicianC,
        startsAt: '2030-01-04T10:00:00Z',
        endsAt: '2030-01-04T11:00:00Z',
      }),
    );
    expect(blockedAgain.status).toBe(409);
    expect(blockedAgain.body.error).toBe('LEGACY_SCHEDULE_REVIEW_REQUIRED');
    const history = await call(
      'GET',
      `/api/theatre/cases/${legacy}/legacy-reviews?facilityId=${facilityA}`,
      reader.token,
    );
    expect(history.body.map((row: { action: string }) => row.action)).toEqual([
      'NO_ACTIVE_RESERVATION',
      'REVOKED',
    ]);
    const auditEvents = await pool.query(
      "SELECT action,details FROM audit_logs WHERE facility_id=$1 AND resource='theatre_case' AND resource_id=$2 ORDER BY id",
      [facilityA, String(legacy)],
    );
    expect(auditEvents.rows.map((row) => row.action)).toEqual([
      'THEATRE_LEGACY_RESERVATION_REVIEWED',
      'THEATRE_LEGACY_REVIEW_REVOKED',
    ]);
    expect(
      auditEvents.rows.every((row) => !String(row.details).includes('Synthetic manual review')),
    ).toBe(true);
    const updatedList = await call(
      'GET',
      `/api/theatre/cases?facilityId=${facilityA}`,
      reader.token,
    );
    expect(
      updatedList.body.find((entry: { id: number }) => entry.id === legacy).legacyReview.action,
    ).toBe('REVOKED');
    expect(
      (
        await call(
          'POST',
          `/api/theatre/cases/${accepted.body.record.id}/legacy-review`,
          manager.token,
          review,
        )
      ).body.error,
    ).toBe('NOT_A_LEGACY_CASE');
    expect(
      (await pool.query('SELECT status,post_op_notes FROM theatre_cases WHERE id=$1', [legacy]))
        .rows[0],
    ).toEqual({ status: 'Completed', post_op_notes: 'Synthetic restricted note' });
    // Reaffirm after the synthetic revoke so the next independent acceptance can proceed.
    expect((await call('POST', path, manager.token, review)).status).toBe(201);
  });

  it('links a same-patient encounter and active admission without discharging or charging the patient', async () => {
    const encounter = (
      await pool.query(
        "INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type) VALUES($1,$2,$3,'INPATIENT') RETURNING id",
        [tenantA, facilityA, patientC],
      )
    ).rows[0].id;
    const ward = (
      await pool.query('INSERT INTO wards(facility_id,name,code) VALUES($1,$2,$3) RETURNING id', [
        facilityA,
        'Synthetic ward',
        `TW-${suffix}`,
      ])
    ).rows[0].id;
    const bed = (
      await pool.query('INSERT INTO beds(ward_id,bed_number) VALUES($1,$2) RETURNING id', [
        ward,
        `T-${suffix}`,
      ])
    ).rows[0].id;
    const admission = (
      await pool.query(
        "INSERT INTO admissions(tenant_id,facility_id,patient_id,encounter_id,ward_id,bed_id,admission_date,status) VALUES($1,$2,$3,$4,$5,$6,'2030-01-01','Admitted') RETURNING id",
        [tenantA, facilityA, patientC, encounter, ward, bed],
      )
    ).rows[0].id;
    const bad = await create(
      booking({
        patientId: patientB,
        encounterId: encounter,
        leadPractitionerId: clinicianC,
        startsAt: '2030-01-05T08:00:00Z',
        endsAt: '2030-01-05T09:00:00Z',
      }),
    );
    expect(bad.status).toBe(404);
    expect(bad.body.error).toBe('ENCOUNTER_NOT_FOUND');
    const result = await create(
      booking({
        patientId: patientC,
        leadPractitionerId: clinicianC,
        encounterId: encounter,
        admissionId: admission,
        startsAt: '2030-01-05T08:00:00Z',
        endsAt: '2030-01-05T09:00:00Z',
      }),
    );
    expect(result.status).toBe(201);
    expect(result.body.booking).toMatchObject({ encounterId: encounter, admissionId: admission });
    const stillAdmitted = await pool.query(
      'SELECT status,discharge_date FROM admissions WHERE id=$1',
      [admission],
    );
    expect(stillAdmitted.rows[0]).toEqual({ status: 'Admitted', discharge_date: null });
    expect(
      Number(
        (await pool.query('SELECT count(*) FROM billing_invoices WHERE patient_id=$1', [patientC]))
          .rows[0].count,
      ),
    ).toBe(0);
  });
});
