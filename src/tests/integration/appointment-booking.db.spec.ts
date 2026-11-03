import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import {
  authenticateBookingClient,
  confirmBookingScoped,
  createBookingClientScoped,
  createBookingSlotScoped,
  createWebsiteBooking,
} from '../../booking/website-booking.service.ts';
import { pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Staff appointments (synthetic PostgreSQL and authenticated HTTP)', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number,
    facility: number,
    siblingFacility: number,
    otherTenant: number,
    otherFacility: number;
  let patient: number, siblingPatient: number, otherPatient: number, actor: number;
  let department: number, foreignDepartment: number, inactiveDepartment: number;
  let practitioner: number, foreignPractitioner: number, inactivePractitioner: number;
  let service: number, foreignService: number, category: number;
  let token: string,
    tenantToken: string,
    limitedToken: string,
    otherToken: string,
    base: string,
    close: () => Promise<void>;
  const grants = [
    'appointments.read',
    'appointments.create',
    'appointments.update',
    'appointments.cancel',
    'appointments.categories.manage',
    'dialysis.read',
    'dialysis.schedule.manage',
    'dialysis.sessions.record',
  ];
  const call = (
    method: string,
    path: string,
    body?: Record<string, unknown>,
    auth = token,
    key?: string,
  ) =>
    httpJson(base, method, path, {
      token: auth,
      body,
      ...(key ? { headers: { 'Idempotency-Key': key } } : {}),
    });
  const appointment = async (time: string, extra: Record<string, unknown> = {}) => {
    const result = await call('POST', '/api/appointments', {
      facilityId: facility,
      patientId: patient,
      scheduledTime: time,
      ...extra,
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body;
  };
  async function makeUser(t: number, f: number | null, label: string, permissions: string[]) {
    const id = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic booking user','test-only','ACTIVE',$3,$4) RETURNING id",
        [`appt-${label}-${suffix}`, `appt-${label}-${suffix}@example.test`, t, f],
      )
    ).rows[0].id as number;
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [t, `APPT_${label}_${suffix}`],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
    for (const permission of permissions) {
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'appointments') ON CONFLICT(code) DO NOTHING",
        [permission],
      );
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, permission],
      );
    }
    return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
  }
  beforeAll(async () => {
    const name = process.env.SQL_DB_NAME ?? '';
    if (name !== 'jalicare_test' && !(name.includes('synthetic') && name.includes('test')))
      throw new Error('A disposable synthetic test database is required.');
    const identity = await pool.query(
      'SELECT current_database() AS name, inet_server_addr()::text AS address',
    );
    if (
      identity.rows[0].name !== name ||
      !['127.0.0.1/32', '127.0.0.1', '::1/128', '::1'].includes(identity.rows[0].address)
    ) {
      throw new Error('Appointment fixtures require the selected local test database.');
    }
    [tenant, otherTenant] = (
      await pool.query(
        "INSERT INTO tenants(name,slug,timezone) VALUES($1,$2,'Africa/Nairobi'),($3,$4,'Africa/Nairobi') RETURNING id",
        [
          `Synthetic booking ${suffix}`,
          `appt-a-${suffix}`,
          `Synthetic booking other ${suffix}`,
          `appt-b-${suffix}`,
        ],
      )
    ).rows.map((r) => r.id);
    [facility, siblingFacility, otherFacility] = (
      await pool.query(
        "INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules) VALUES($1,$2,'Synthetic facility A','Africa/Nairobi',$6::jsonb),($1,$3,'Synthetic facility sibling','Africa/Nairobi',$6::jsonb),($4,$5,'Synthetic facility other','Africa/Nairobi',$6::jsonb) RETURNING id",
        [
          tenant,
          `APTA-${suffix}`,
          `APTS-${suffix}`,
          otherTenant,
          `APTB-${suffix}`,
          JSON.stringify(['reception', 'registration', 'dialysis', 'finance', 'website_booking']),
        ],
      )
    ).rows.map((r) => r.id);
    [patient, siblingPatient, otherPatient] = (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','A','2000-01-01','Other'),($1,$4,$5,'Synthetic','Sibling','2000-01-01','Other'),($6,$7,$8,'Synthetic','B','2000-01-01','Other') RETURNING id",
        [
          tenant,
          facility,
          `APTA-${suffix}`,
          siblingFacility,
          `APTS-${suffix}`,
          otherTenant,
          otherFacility,
          `APTB-${suffix}`,
        ],
      )
    ).rows.map((r) => r.id);
    const staff = await makeUser(tenant, facility, 'staff', grants);
    actor = staff.id;
    token = staff.token;
    tenantToken = (await makeUser(tenant, null, 'tenant', grants)).token;
    limitedToken = (await makeUser(tenant, facility, 'limited', ['appointments.read'])).token;
    otherToken = (await makeUser(otherTenant, otherFacility, 'foreign', grants)).token;
    [department, foreignDepartment, inactiveDepartment] = (
      await pool.query(
        "INSERT INTO departments(facility_id,name,code,is_active) VALUES($1,'Synthetic A',$2,true),($3,'Synthetic B',$4,true),($1,'Synthetic inactive',$5,false) RETURNING id",
        [facility, `DA-${suffix}`, otherFacility, `DB-${suffix}`, `DI-${suffix}`],
      )
    ).rows.map((r) => r.id);
    [practitioner, foreignPractitioner, inactivePractitioner] = (
      await pool.query(
        "INSERT INTO practitioners(tenant_id,facility_id,full_name,is_active) VALUES($1,$2,'Synthetic practitioner',true),($3,$4,'Synthetic foreign practitioner',true),($1,$2,'Synthetic inactive practitioner',false) RETURNING id",
        [tenant, facility, otherTenant, otherFacility],
      )
    ).rows.map((r) => r.id);
    [service, foreignService] = (
      await pool.query(
        "INSERT INTO facility_services(tenant_id,facility_id,code,name,description,department,category,unit) VALUES($1,$2,$3,'Synthetic service','Synthetic','Test','OTHER','Service'),($4,$5,$6,'Synthetic foreign service','Synthetic','Test','OTHER','Service') RETURNING id",
        [
          tenant,
          facility,
          `SVA-${suffix.toUpperCase()}`,
          otherTenant,
          otherFacility,
          `SVB-${suffix.toUpperCase()}`,
        ],
      )
    ).rows.map((r) => r.id);
    await pool.query(
      "INSERT INTO appointments(tenant_id,facility_id,patient_id,scheduled_time,appointment_type,status) VALUES($1,$2,$3,'2031-01-01T09:00','Synthetic','Scheduled'),($4,$5,$6,'2031-01-01T09:00','Synthetic','Scheduled')",
      [tenant, facility, patient, otherTenant, otherFacility, otherPatient],
    );
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('refuses generic lifecycle actions on a confirmed website-linked appointment', async () => {
    const scope = { tenantId: tenant, facilityId: facility, actorUserId: actor };
    const createdClient = await createBookingClientScoped(scope, {
      clientName: 'Synthetic site',
      allowedServices: ['TEST_REVIEW'],
    });
    const client = await authenticateBookingClient(createdClient.apiKey);
    const slot = await createBookingSlotScoped(scope, {
      serviceCode: 'TEST_REVIEW',
      date: '2034-12-01',
      startTime: '08:00',
      endTime: '08:30',
      capacity: 1,
    });
    const request = await createWebsiteBooking(client, {
      slotId: slot.id,
      patientName: 'Synthetic A',
      phone: '0712345678',
      idempotencyKey: `web-${suffix}`,
    });
    const booking = await pool.query(
      'SELECT id FROM external_bookings WHERE booking_reference=$1',
      [request.booking.reference],
    );
    const linked = await confirmBookingScoped(scope, booking.rows[0].id, patient, {
      identityVerified: true,
      availabilityReviewed: true,
    });
    const path = `/api/appointments/${linked.appointmentId}`;
    expect((await call('POST', `${path}/cancel`, { reason: 'Synthetic reason' })).status).toBe(409);
    expect(
      (
        await call(
          'POST',
          `${path}/reschedule`,
          { scheduledTime: '2034-12-02T09:00', reason: 'Synthetic reason' },
          token,
          `web-reschedule-${suffix}`,
        )
      ).status,
    ).toBe(409);
    expect((await call('POST', `${path}/check-in`, { queueType: 'Triage' })).status).toBe(409);
    expect(
      (await pool.query('SELECT status FROM appointments WHERE id=$1', [linked.appointmentId]))
        .rows[0].status,
    ).toBe('Scheduled');
    expect(
      (
        await pool.query('SELECT status,linked_appointment_id FROM external_bookings WHERE id=$1', [
          booking.rows[0].id,
        ])
      ).rows[0],
    ).toEqual({ status: 'CONFIRMED', linked_appointment_id: linked.appointmentId });
    expect(
      (
        await pool.query('SELECT id FROM appointment_events WHERE appointment_id=$1', [
          linked.appointmentId,
        ])
      ).rows,
    ).toHaveLength(0);
  });

  it('never lists another tenant or facility when a facility-bound caller omits the hint', async () => {
    const result = await call('GET', '/api/appointments');
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.some((row: { patientId: number }) => row.patientId === patient)).toBe(true);
    expect(
      result.body.every(
        (row: { tenantId: number; facilityId: number }) =>
          row.tenantId === tenant && row.facilityId === facility,
      ),
    ).toBe(true);
    expect((await call('GET', `/api/appointments?facilityId=${otherFacility}`)).status).toBe(403);
    expect((await call('GET', '/api/appointments', undefined, tenantToken)).status).toBe(403);
    const sibling = await call(
      'GET',
      `/api/appointments?facilityId=${siblingFacility}`,
      undefined,
      tenantToken,
    );
    expect(sibling.status).toBe(200);
    expect(
      sibling.body.every((row: { facilityId: number }) => row.facilityId === siblingFacility),
    ).toBe(true);
  });

  it('does not create appointments for another facility patient or a forged tenant', async () => {
    const input = {
      tenantId: tenant,
      facilityId: facility,
      patientId: otherPatient,
      scheduledTime: '2031-01-02T09:00',
      durationMinutes: 30,
    };
    const foreign = await call('POST', '/api/appointments', input);
    expect([403, 404]).toContain(foreign.status);
    const sibling = await call('POST', '/api/appointments', {
      ...input,
      patientId: siblingPatient,
    });
    expect([403, 404]).toContain(sibling.status);
    const forged = await call('POST', '/api/appointments', {
      ...input,
      tenantId: otherTenant,
      patientId: patient,
    });
    expect(forged.status).toBe(403);
    expect(
      (
        await pool.query(
          "SELECT id FROM appointments WHERE facility_id=$1 AND patient_id IN ($2,$3) AND scheduled_time='2031-01-02T09:00'",
          [facility, otherPatient, siblingPatient],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (await call('POST', '/api/appointments', { ...input, patientId: patient }, limitedToken))
        .status,
    ).toBe(403);
  });

  it('requires authentication and validates time, initial status, and facility-owned clinicians', async () => {
    expect((await httpJson(base, 'GET', '/api/appointments')).status).toBe(401);
    const baseInput = {
      facilityId: facility,
      patientId: patient,
      scheduledTime: '2031-03-01T09:00',
    };
    for (const bad of [
      '2031-02-29T09:00',
      '2031-01-01T25:00',
      '2031-01-01T09:60',
      'tomorrow',
      '2031-01-01T09:00Z',
    ]) {
      expect(
        (await call('POST', '/api/appointments', { ...baseInput, scheduledTime: bad })).status,
      ).toBe(400);
    }
    expect(
      (await call('POST', '/api/appointments', { ...baseInput, status: 'Completed' })).status,
    ).toBe(400);
    for (const value of [foreignDepartment, inactiveDepartment]) {
      expect(
        (await call('POST', '/api/appointments', { ...baseInput, departmentId: value })).status,
      ).toBe(404);
    }
    for (const value of [foreignPractitioner, inactivePractitioner]) {
      expect(
        (await call('POST', '/api/appointments', { ...baseInput, practitionerId: value })).status,
      ).toBe(404);
    }
    expect(
      (await call('POST', `/api/appointments?facilityId=${siblingFacility}`, baseInput)).status,
    ).toBe(403);
    expect((await call('GET', '/api/appointments?from=2031-02-30&to=2031-03-01')).status).toBe(400);
    expect((await call('GET', '/api/appointments?from=2031-01-01')).status).toBe(400);
    expect((await call('GET', '/api/appointments?limit=201')).status).toBe(400);
  });

  it('lists only active resources from the authorized facility', async () => {
    const result = await call('GET', '/api/appointments/resources');
    expect(result.status).toBe(200);
    expect(result.body.departments.map((d: any) => d.id)).toContain(department);
    expect(result.body.departments.map((d: any) => d.id)).not.toContain(foreignDepartment);
    expect(result.body.departments.map((d: any) => d.id)).not.toContain(inactiveDepartment);
    expect(result.body.practitioners.map((p: any) => p.id)).toContain(practitioner);
    expect(result.body.practitioners.map((p: any) => p.id)).not.toContain(foreignPractitioner);
    expect(result.body.practitioners.map((p: any) => p.id)).not.toContain(inactivePractitioner);
    expect(
      (await call('GET', `/api/appointments/resources?facilityId=${otherFacility}`)).status,
    ).toBe(403);
  });

  it('allows a documented active patient-facility relationship without opening a sibling facility', async () => {
    await pool.query(
      "INSERT INTO patient_facilities(patient_id,tenant_id,facility_id,status,relationship_type) VALUES($1,$2,$3,'ACTIVE','REFERRAL')",
      [siblingPatient, tenant, facility],
    );
    const result = await call('POST', '/api/appointments', {
      facilityId: facility,
      patientId: siblingPatient,
      scheduledTime: '2031-03-02T09:00',
    });
    expect(result.status).toBe(201);
    expect(result.body.patientId).toBe(siblingPatient);
  });

  it('configures facility-owned categories separately from billing and snapshots a service reference', async () => {
    const payload = {
      facilityId: facility,
      code: 'follow_up',
      name: 'Synthetic follow-up',
      facilityServiceId: service,
    };
    expect((await call('POST', '/api/appointments/categories', payload, limitedToken)).status).toBe(
      403,
    );
    expect(
      (
        await call('POST', '/api/appointments/categories', {
          ...payload,
          facilityServiceId: foreignService,
        })
      ).status,
    ).toBe(404);
    const created = await call('POST', '/api/appointments/categories', payload);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({
      code: 'FOLLOW_UP',
      facilityServiceId: service,
      createdByUserId: actor,
    });
    category = created.body.id;
    expect((await call('POST', '/api/appointments/categories', payload)).status).toBe(409);
    expect((await call('GET', '/api/appointments/categories', undefined, otherToken)).body).toEqual(
      [],
    );
    const booked = await appointment('2031-04-01 09:00', {
      categoryId: category,
      departmentId: department,
      practitionerId: practitioner,
      createdByUserId: 999999,
    });
    expect(booked).toMatchObject({
      categoryId: category,
      facilityServiceId: service,
      appointmentType: 'Synthetic follow-up',
      createdByUserId: actor,
      scheduledTime: '2031-04-01T09:00',
    });
    const changed = await call('PATCH', `/api/appointments/categories/${category}`, {
      name: 'Renamed category',
      facilityServiceId: null,
      isActive: false,
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(
      (
        await pool.query(
          'SELECT facility_service_id,appointment_type FROM appointments WHERE id=$1',
          [booked.id],
        )
      ).rows[0],
    ).toEqual({ facility_service_id: service, appointment_type: 'Synthetic follow-up' });
    expect(
      (
        await call('POST', '/api/appointments', {
          facilityId: facility,
          patientId: patient,
          categoryId: category,
          scheduledTime: '2031-04-02T09:00',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call('PATCH', `/api/appointments/categories/${category}`, {
          isActive: true,
          facilityServiceId: service,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE resource='AppointmentCategory' AND resource_id=$1 AND user_id=$2",
          [String(category), String(actor)],
        )
      ).rows[0].n,
    ).toBe(3);
  });

  it('serializes keyed booking retries and records one attributed event and audit, without charging', async () => {
    const input = {
      facilityId: facility,
      patientId: patient,
      categoryId: category,
      practitionerId: practitioner,
      departmentId: department,
      scheduledTime: '2031-05-01T09:00',
      priority: 'Priority',
      reason: 'Synthetic reason',
      createdByUserId: 999999,
      actorType: 'PATIENT',
    };
    const key = `create-${suffix}`;
    const before = (
      await pool.query(
        'SELECT count(*)::int n FROM billing_invoices WHERE tenant_id=$1 AND facility_id=$2',
        [tenant, facility],
      )
    ).rows[0].n;
    const attempts = await Promise.all(
      Array.from({ length: 5 }, () => call('POST', '/api/appointments', input, token, key)),
    );
    expect(attempts.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(attempts.map((r) => r.body.id)).size).toBe(1);
    expect(attempts.find((r) => r.status === 200)?.headers.get('idempotent-replay')).toBe('true');
    const booked = attempts[0].body;
    expect(booked.bookingReference).toMatch(/^APT-[0-9A-F-]{36}$/);
    expect(booked.createdByUserId).toBe(actor);
    expect(
      (await call('POST', '/api/appointments', { ...input, reason: 'Different' }, token, key))
        .status,
    ).toBe(409);
    const history = await call('GET', `/api/appointments/${booked.id}/history`);
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({
      eventType: 'CREATED',
      actorType: 'STAFF',
      actorUserId: actor,
      paymentState: 'NOT_ASSESSED',
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE resource='Appointment' AND action='CREATE' AND resource_id=$1",
          [String(booked.id)],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM billing_invoices WHERE tenant_id=$1 AND facility_id=$2',
          [tenant, facility],
        )
      ).rows[0].n,
    ).toBe(before);
    expect(
      (await call('GET', `/api/appointments/${booked.id}/history`, undefined, otherToken)).status,
    ).toBe(404);
  });

  it('reschedules with a retained original, attributed reasons, one replacement and idempotent concurrent retries', async () => {
    const old = await appointment('2031-06-01T09:00', { categoryId: category });
    const key = `resched-${suffix}`;
    const payload = {
      facilityId: facility,
      scheduledTime: '2031-06-02T10:00',
      reason: 'Synthetic patient request',
      actorUserId: 999999,
      actorType: 'PATIENT',
    };
    expect((await call('POST', `/api/appointments/${old.id}/reschedule`, payload)).status).toBe(
      400,
    );
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        call('POST', `/api/appointments/${old.id}/reschedule`, payload, token, key),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    const replacement = results[0].body;
    expect(replacement).toMatchObject({
      status: 'Scheduled',
      replacementOfId: old.id,
      createdByUserId: actor,
      scheduledTime: '2031-06-02T10:00',
      facilityServiceId: service,
    });
    expect(
      (await pool.query('SELECT status,scheduled_time FROM appointments WHERE id=$1', [old.id]))
        .rows[0],
    ).toEqual({ status: 'Rescheduled', scheduled_time: '2031-06-01T09:00' });
    const originalHistory = (await call('GET', `/api/appointments/${old.id}/history`)).body;
    const replacementHistory = (await call('GET', `/api/appointments/${replacement.id}/history`))
      .body;
    expect(originalHistory.map((e: any) => e.eventType)).toEqual(['CREATED', 'RESCHEDULED_FROM']);
    expect(originalHistory[1]).toMatchObject({
      actorType: 'STAFF',
      actorUserId: actor,
      reason: payload.reason,
      fromStatus: 'Scheduled',
      toStatus: 'Rescheduled',
      relatedAppointmentId: replacement.id,
      paymentState: 'NOT_ASSESSED',
    });
    expect(replacementHistory[0]).toMatchObject({
      eventType: 'RESCHEDULED_TO',
      relatedAppointmentId: old.id,
    });
    expect(
      (
        await call(
          'POST',
          `/api/appointments/${old.id}/reschedule`,
          { ...payload, reason: 'Different reason' },
          token,
          key,
        )
      ).status,
    ).toBe(409);
    expect(
      (await call('POST', `/api/appointments/${old.id}/cancel`, { reason: 'Repeated request' }))
        .status,
    ).toBe(409);
    await expect(
      pool.query('DELETE FROM appointment_events WHERE id=$1', [originalHistory[0].id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query("UPDATE appointment_events SET reason='changed' WHERE id=$1", [
        originalHistory[0].id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('cancels once with reason and actor, excludes cancelled records from active views and does not refund', async () => {
    const booked = await appointment('2031-07-01T09:00');
    const countRefunds = async () =>
      (
        await pool.query(
          'SELECT count(*)::int n FROM billing_refunds WHERE tenant_id=$1 AND facility_id=$2',
          [tenant, facility],
        )
      ).rows[0].n;
    const before = await countRefunds();
    expect(
      (await call('POST', `/api/appointments/${booked.id}/cancel`, { reason: ' ' })).status,
    ).toBe(400);
    expect(
      (
        await call(
          'POST',
          `/api/appointments/${booked.id}/cancel`,
          { reason: 'Synthetic cancellation' },
          limitedToken,
        )
      ).status,
    ).toBe(403);
    const results = await Promise.all(
      Array.from({ length: 2 }, () =>
        call('POST', `/api/appointments/${booked.id}/cancel`, {
          reason: 'Synthetic cancellation',
          actorType: 'PATIENT',
          actorUserId: 999999,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const history = (await call('GET', `/api/appointments/${booked.id}/history`)).body;
    expect(history[1]).toMatchObject({
      eventType: 'CANCELLED',
      actorType: 'STAFF',
      actorUserId: actor,
      reason: 'Synthetic cancellation',
      fromStatus: 'Scheduled',
      toStatus: 'Cancelled',
      paymentState: 'NOT_ASSESSED',
    });
    const active = await call('GET', '/api/appointments?from=2031-07-01&to=2031-07-01&active=true');
    expect(active.status).toBe(200);
    expect(active.body.some((r: any) => r.id === booked.id)).toBe(false);
    const all = await call('GET', '/api/appointments?from=2031-07-01&to=2031-07-01');
    expect(all.body.some((r: any) => r.id === booked.id && r.status === 'Cancelled')).toBe(true);
    expect(await countRefunds()).toBe(before);
  });

  it('rolls back a cancellation and its history if the audit write fails', async () => {
    const booked = await appointment('2031-07-02T09:00');
    const fn = `booking_fail_audit_${suffix.replaceAll('-', '')}`;
    const trigger = `booking_fail_audit_trigger_${suffix.replaceAll('-', '')}`;
    await pool.query(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource='Appointment' AND NEW.action='CANCEL' AND NEW.user_id='${actor}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
    try {
      const result = await call('POST', `/api/appointments/${booked.id}/cancel`, {
        reason: 'Synthetic cancellation',
      });
      expect(result.status).toBe(500);
      expect(result.body).not.toHaveProperty('stack');
      expect(
        (await pool.query('SELECT status FROM appointments WHERE id=$1', [booked.id])).rows[0]
          .status,
      ).toBe('Scheduled');
      expect(
        (
          await pool.query(
            'SELECT event_type FROM appointment_events WHERE appointment_id=$1 ORDER BY id',
            [booked.id],
          )
        ).rows,
      ).toEqual([{ event_type: 'CREATED' }]);
    } finally {
      await pool.query(`DROP TRIGGER ${trigger} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${fn}()`);
    }
  });

  it('atomically checks in once and creates one queue token, without claiming treatment', async () => {
    const booked = await appointment('2031-08-01T09:00');
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        call('POST', `/api/appointments/${booked.id}/check-in`, { queueType: 'Doctor' }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
    const success = results.find((r) => r.status === 200)!.body;
    expect(success.appointment).toMatchObject({
      status: 'Checked-in',
      checkinQueueId: success.queue.id,
    });
    expect(success.queue).toMatchObject({
      patientId: patient,
      queueType: 'Doctor',
      status: 'Waiting',
      tokenNumber: `BK-${booked.id}`,
    });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM queues WHERE facility_id=$1 AND token_number=$2',
          [facility, `BK-${booked.id}`],
        )
      ).rows[0].n,
    ).toBe(1);
    const history = (await call('GET', `/api/appointments/${booked.id}/history`)).body;
    expect(history[1]).toMatchObject({
      eventType: 'CHECKED_IN',
      actorUserId: actor,
      queueId: success.queue.id,
    });
    expect(
      (
        await call('POST', `/api/appointments/${booked.id}/cancel`, {
          reason: 'Synthetic cancellation',
        })
      ).status,
    ).toBe(409);
    const next = await appointment('2031-08-02T09:00');
    expect(
      (await call('POST', `/api/appointments/${next.id}/check-in`, { queueType: 'Doctor' })).body
        .error,
    ).toBe('ACTIVE_QUEUE_EXISTS');
    const firstSibling = await appointment('2031-08-03T09:00', { patientId: siblingPatient });
    const secondSibling = await appointment('2031-08-03T10:00', { patientId: siblingPatient });
    const competing = await Promise.all(
      [firstSibling, secondSibling].map((item) =>
        call('POST', `/api/appointments/${item.id}/check-in`, { queueType: 'Triage' }),
      ),
    );
    expect(competing.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM queues WHERE patient_id=$1 AND facility_id=$2 AND queue_type='Triage' AND status='Waiting'",
          [siblingPatient, facility],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('refuses standalone transitions for linked dialysis schedules until coordinated lifecycle support exists', async () => {
    const booked = await appointment('2031-09-01T09:00', { appointmentType: 'Synthetic dialysis' });
    const linked = await pool.query(
      "INSERT INTO dialysis_schedules(tenant_id,facility_id,patient_id,appointment_id,scheduled_date,shift_code,start_time,end_time,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'2031-09-01','test','09:00','10:00',$5,'synthetic') RETURNING id",
      [tenant, facility, patient, booked.id, `linked-${suffix}`],
    );
    const scheduleId = linked.rows[0].id;
    const cancel = await call('POST', `/api/appointments/${booked.id}/cancel`, {
      reason: 'Synthetic request',
    });
    expect(cancel.status).toBe(409);
    expect(cancel.body.error).toBe('SOURCE_WORKFLOW_REQUIRED');
    expect(
      (await call('POST', `/api/appointments/${booked.id}/check-in`, { queueType: 'Triage' })).body
        .error,
    ).toBe('SOURCE_WORKFLOW_REQUIRED');
    expect(
      (
        await call(
          'POST',
          `/api/appointments/${booked.id}/reschedule`,
          { scheduledTime: '2031-09-02T09:00', reason: 'Synthetic request' },
          token,
          `linked-resched-${suffix}`,
        )
      ).body.error,
    ).toBe('SOURCE_WORKFLOW_REQUIRED');
    expect(
      (await pool.query('SELECT status FROM appointments WHERE id=$1', [booked.id])).rows[0].status,
    ).toBe('Scheduled');
    expect(
      (
        await call('POST', `/api/dialysis/schedules/${scheduleId}/cancel`, {
          facilityId: facility,
          reason: 'no',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          'POST',
          `/api/dialysis/schedules/${scheduleId}/cancel`,
          { reason: 'Synthetic cancellation' },
          limitedToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          'POST',
          `/api/dialysis/schedules/${scheduleId}/cancel`,
          { reason: 'Synthetic cancellation' },
          otherToken,
        )
      ).status,
    ).toBe(404);
    const fn = `dialysis_fail_audit_${suffix.replaceAll('-', '')}`;
    const trigger = `dialysis_fail_audit_trigger_${suffix.replaceAll('-', '')}`;
    await pool.query(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource='dialysis_schedule' AND NEW.action='CANCEL' AND NEW.user_id='${actor}' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
    );
    try {
      expect(
        (
          await call('POST', `/api/dialysis/schedules/${scheduleId}/cancel`, {
            reason: 'Synthetic cancellation',
          })
        ).status,
      ).toBe(500);
      expect(
        (
          await pool.query(
            'SELECT status,cancellation_reason FROM dialysis_schedules WHERE id=$1',
            [scheduleId],
          )
        ).rows[0],
      ).toEqual({ status: 'SCHEDULED', cancellation_reason: null });
      expect(
        (await pool.query('SELECT status FROM appointments WHERE id=$1', [booked.id])).rows[0]
          .status,
      ).toBe('Scheduled');
      expect(
        (
          await pool.query(
            'SELECT event_type FROM appointment_events WHERE appointment_id=$1 ORDER BY id',
            [booked.id],
          )
        ).rows,
      ).toEqual([{ event_type: 'CREATED' }]);
    } finally {
      await pool.query(`DROP TRIGGER ${trigger} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${fn}()`);
    }
    const outcomes = await Promise.all(
      Array.from({ length: 3 }, () =>
        call('POST', `/api/dialysis/schedules/${scheduleId}/cancel`, {
          reason: 'Synthetic cancellation',
          actorType: 'PATIENT',
          actorUserId: 999999,
        }),
      ),
    );
    expect(outcomes.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(
      (
        await pool.query('SELECT status,cancellation_reason FROM dialysis_schedules WHERE id=$1', [
          scheduleId,
        ])
      ).rows[0],
    ).toEqual({ status: 'CANCELLED', cancellation_reason: 'Synthetic cancellation' });
    expect(
      (await pool.query('SELECT status FROM appointments WHERE id=$1', [booked.id])).rows[0].status,
    ).toBe('Cancelled');
    const history = (await call('GET', `/api/appointments/${booked.id}/history`)).body;
    expect(history.at(-1)).toMatchObject({
      eventType: 'CANCELLED',
      actorType: 'STAFF',
      actorUserId: actor,
      reason: 'Synthetic cancellation',
      fromStatus: 'Scheduled',
      toStatus: 'Cancelled',
      paymentState: 'NOT_ASSESSED',
    });
    expect(
      (await call('POST', `/api/dialysis/schedules/${scheduleId}/start`, { facilityId: facility }))
        .status,
    ).toBe(409);
    expect(
      (await pool.query('SELECT id FROM dialysis_sessions WHERE schedule_id=$1', [scheduleId]))
        .rows,
    ).toHaveLength(0);
  });
});
