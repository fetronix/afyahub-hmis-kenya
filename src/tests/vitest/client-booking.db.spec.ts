import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { pool } from '../../db/index.ts';
import { describeDb } from './support/db.ts';
import {
  authenticateBookingClient,
  confirmBookingScoped,
  createBookingClientScoped,
  createBookingSlotScoped,
  createWebsiteBooking,
  getBookingAvailability,
  getWebsiteBooking,
  mutateWebsiteBooking,
  sendBookingReminderScoped,
  type BookingAdminScope,
  type BookingClient,
} from '../../booking/website-booking.service.ts';

describeDb('website booking API services against PostgreSQL', () => {
  let a: BookingAdminScope,
    b: BookingAdminScope,
    client: BookingClient,
    foreignClient: BookingClient,
    patientId: number,
    slot1: number,
    slot2: number,
    slot3: number,
    bookingId: number,
    reference: string,
    token: string,
    appointmentId: number;
  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? 'jalicare_test').includes('test'))
      throw new Error('Test database required.');
    const x = randomUUID().slice(0, 8);
    const t = await pool.query(
      'INSERT INTO tenants (name,slug) VALUES ($1,$2),($3,$4) RETURNING id',
      [`Booking A ${x}`, `book-a-${x}`, `Booking B ${x}`, `book-b-${x}`],
    );
    const f = await pool.query(
      'INSERT INTO facilities (tenant_id,code,name,enabled_modules) VALUES ($1,$2,$3,$4::jsonb),($5,$6,$7,$8::jsonb) RETURNING id',
      [
        t.rows[0].id,
        `BA-${x}`,
        'Synthetic A',
        JSON.stringify(['website_booking']),
        t.rows[1].id,
        `BB-${x}`,
        'Synthetic B',
        JSON.stringify(['website_booking']),
      ],
    );
    const u = await pool.query(
      'INSERT INTO users (uid,username,email,password_hash,full_name,tenant_id,facility_id) VALUES ($1,$2,$3,$4,$5,$6,$7),($8,$9,$10,$11,$12,$13,$14) RETURNING id',
      [
        `ba-${x}`,
        `ba-${x}`,
        `ba-${x}@example.test`,
        'test-only',
        'Synthetic staff',
        t.rows[0].id,
        f.rows[0].id,
        `bb-${x}`,
        `bb-${x}`,
        `bb-${x}@example.test`,
        'test-only',
        'Synthetic staff',
        t.rows[1].id,
        f.rows[1].id,
      ],
    );
    a = { tenantId: t.rows[0].id, facilityId: f.rows[0].id, actorUserId: u.rows[0].id };
    b = { tenantId: t.rows[1].id, facilityId: f.rows[1].id, actorUserId: u.rows[1].id };
    const p = await pool.query(
      "INSERT INTO patients (tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES ($1,$2,$3,'Synthetic','Patient','2000-01-01','Other') RETURNING id",
      [a.tenantId, a.facilityId, `P-${x}`],
    );
    patientId = p.rows[0].id;
    const first = await createBookingClientScoped(a, {
      clientName: 'Synthetic site',
      allowedServices: ['TEST_REVIEW'],
      allowedOrigins: ['https://example.test'],
      rateLimitPerMinute: 100,
    });
    const second = await createBookingClientScoped(b, {
      clientName: 'Other synthetic site',
      allowedServices: ['TEST_REVIEW'],
    });
    client = await authenticateBookingClient(first.apiKey);
    foreignClient = await authenticateBookingClient(second.apiKey);
    await expect(
      authenticateBookingClient(first.apiKey, 'https://unapproved.example'),
    ).rejects.toMatchObject({ code: 'BOOKING_ORIGIN_DENIED' });
    expect(JSON.stringify(first.client)).not.toContain(first.apiKey);
    slot1 = (
      await createBookingSlotScoped(a, {
        serviceCode: 'TEST_REVIEW',
        date: '2026-12-01',
        startTime: '08:00',
        endTime: '08:30',
        capacity: 2,
      })
    ).id;
    slot2 = (
      await createBookingSlotScoped(a, {
        serviceCode: 'TEST_REVIEW',
        date: '2026-12-01',
        startTime: '09:00',
        endTime: '09:30',
        capacity: 2,
      })
    ).id;
    slot3 = (
      await createBookingSlotScoped(a, {
        serviceCode: 'TEST_REVIEW',
        date: '2026-12-01',
        startTime: '10:00',
        endTime: '10:30',
        capacity: 1,
      })
    ).id;
  });
  it('creates pending, encrypted, idempotent requests without claiming a confirmed appointment', async () => {
    const request = {
      slotId: slot1,
      patientName: 'Synthetic Patient',
      phone: '0712345678',
      email: 'synthetic@example.test',
      idempotencyKey: 'request-1',
    };
    const results = await Promise.all([
      createWebsiteBooking(client, request),
      createWebsiteBooking(client, request),
    ]);
    expect(results[0].booking.reference).toBe(results[1].booking.reference);
    expect(results[0].booking.manageToken).toBe(results[1].booking.manageToken);
    expect(results.filter((r) => r.idempotentReplay)).toHaveLength(1);
    reference = String(results[0].booking.reference);
    token = results[0].booking.manageToken;
    expect(results[0].booking.status).toBe('PENDING');
    await expect(
      createWebsiteBooking(client, { ...request, patientName: 'Different' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      createWebsiteBooking(client, { ...request, idempotencyKey: 'different-key' }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_BOOKING' });
    const row = await pool.query(
      'SELECT id,patient_full_name,patient_phone_encrypted,patient_email,linked_appointment_id FROM external_bookings WHERE booking_reference=$1',
      [reference],
    );
    bookingId = row.rows[0].id;
    expect(row.rows[0].patient_full_name).toMatch(/^v1:/);
    expect(row.rows[0].patient_phone_encrypted).toMatch(/^v1:/);
    expect(row.rows[0].patient_email).toMatch(/^v1:/);
    expect(row.rows[0].linked_appointment_id).toBeNull();
    expect(
      (await getBookingAvailability(client, { serviceCode: 'TEST_REVIEW', date: '2026-12-01' }))
        .availabilityScope,
    ).toBe('ONLINE_REQUESTS_ONLY');
    await expect(getWebsiteBooking(foreignClient, reference, token)).rejects.toMatchObject({
      code: 'BOOKING_NOT_FOUND',
    });
    await expect(getWebsiteBooking(client, reference, 'bad-token')).rejects.toMatchObject({
      code: 'BOOKING_NOT_FOUND',
    });
  });
  it('serializes capacity under concurrent requests', async () => {
    const outcomes = await Promise.allSettled([
      createWebsiteBooking(client, {
        slotId: slot3,
        patientName: 'Synthetic A',
        phone: '0712345678',
        idempotencyKey: 'cap-1',
      }),
      createWebsiteBooking(client, {
        slotId: slot3,
        patientName: 'Synthetic B',
        phone: '0722345678',
        idempotencyKey: 'cap-2',
      }),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);
  });
  it('requires staff review before linking an appointment and records honest reminder status', async () => {
    await expect(confirmBookingScoped(a, bookingId, patientId, {})).rejects.toMatchObject({
      code: 'STAFF_REVIEW_REQUIRED',
    });
    await expect(
      confirmBookingScoped(b, bookingId, patientId, {
        identityVerified: true,
        availabilityReviewed: true,
      }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    const result = await confirmBookingScoped(a, bookingId, patientId, {
      identityVerified: true,
      availabilityReviewed: true,
    });
    appointmentId = result.appointmentId;
    const appointment = await pool.query('SELECT status FROM appointments WHERE id=$1', [
      appointmentId,
    ]);
    expect(appointment.rows[0].status).toBe('Scheduled');
    const reminder = await sendBookingReminderScoped(a, bookingId, 'reminder-1');
    expect(reminder.delivery?.map((d) => d.status)).toContain('NOT_CONFIGURED');
    expect((await sendBookingReminderScoped(a, bookingId, 'reminder-1')).idempotentReplay).toBe(
      true,
    );
  });
  it('reschedules into pending review and cancels without pretending treatment occurred', async () => {
    const result = await mutateWebsiteBooking(client, reference, token, {
      action: 'RESCHEDULE',
      slotId: slot2,
      idempotencyKey: 'reschedule-1',
    });
    expect(result.booking.status).toBe('PENDING');
    expect(
      (
        await mutateWebsiteBooking(client, reference, token, {
          action: 'RESCHEDULE',
          slotId: slot2,
          idempotencyKey: 'reschedule-1',
        })
      ).idempotentReplay,
    ).toBe(true);
    const old = await pool.query('SELECT status FROM appointments WHERE id=$1', [appointmentId]);
    expect(old.rows[0].status).toBe('Cancelled');
    const events = await pool.query(
      "SELECT previous_slot_id,new_slot_id FROM website_booking_events WHERE booking_id=$1 AND action='RESCHEDULE'",
      [bookingId],
    );
    expect(events.rows[0]).toEqual({ previous_slot_id: slot1, new_slot_id: slot2 });
    const cancelled = await mutateWebsiteBooking(client, reference, token, {
      action: 'CANCEL',
      idempotencyKey: 'cancel-1',
    });
    expect(cancelled.booking.status).toBe('CANCELLED');
    expect(
      (
        await mutateWebsiteBooking(client, reference, token, {
          action: 'CANCEL',
          idempotencyKey: 'cancel-1',
        })
      ).idempotentReplay,
    ).toBe(true);
  });
});
