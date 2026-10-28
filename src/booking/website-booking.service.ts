/** Server-to-server website booking requests; no WordPress credentials are assumed. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/index.ts';
import { blindIndex, decryptField, encryptField } from '../security/field-crypto.ts';
import { getNotificationProvider } from '../notifications/notification-provider.ts';
import { requireIsoDate } from '../accounting/accounting.service.ts';

export class BookingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'BookingError';
  }
}
export interface BookingClient {
  id: number;
  tenantId: number;
  facilityId: number;
  allowedServices: string[];
  allowedOrigins: string[];
  rateLimit: number;
  facilityName: string;
}
export interface BookingAdminScope {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
}
function text(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new BookingError(
      'INVALID_INPUT',
      `${name} is required and must be at most ${max} characters.`,
    );
  return value.trim();
}
function positive(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new BookingError('INVALID_INPUT', `${name} must be a positive integer.`);
  return n;
}
function keyMaterial(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY?.trim();
  const key = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
  if (key.length !== 32)
    throw new BookingError(
      'BOOKING_ENCRYPTION_NOT_CONFIGURED',
      'A valid FIELD_ENCRYPTION_KEY is required for booking data.',
      503,
    );
  return key;
}
function keyed(value: string, purpose: string): string {
  return createHmac('sha256', keyMaterial()).update(`${purpose}\0${value}`).digest('hex');
}
function manageToken(clientId: number, reference: string): string {
  return createHmac('sha256', keyMaterial())
    .update(`booking-manage-v1\0${clientId}\0${reference}`)
    .digest('base64url');
}
function constantTimeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function apiHash(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
function seal(value: string): string {
  keyMaterial();
  const result = encryptField(value);
  if (!result || !result.startsWith('v1:'))
    throw new BookingError(
      'BOOKING_ENCRYPTION_NOT_CONFIGURED',
      'Booking encryption is unavailable.',
      503,
    );
  return result;
}
function unseal(value: string | null): string | null {
  if (!value) return null;
  keyMaterial();
  if (!value.startsWith('v1:'))
    throw new BookingError(
      'BOOKING_DATA_UNENCRYPTED',
      'Booking data requires operator review.',
      503,
    );
  return decryptField(value);
}
export function normalizeBookingPhone(value: unknown): string {
  const raw = text(value, 'Phone', 30).replace(/[\s().-]/g, '');
  if (/^0[17]\d{8}$/.test(raw)) return `+254${raw.slice(1)}`;
  if (/^254[17]\d{8}$/.test(raw)) return `+${raw}`;
  if (/^\+[1-9]\d{7,14}$/.test(raw)) return raw;
  throw new BookingError(
    'INVALID_PHONE',
    'Phone must be in international format or a Kenyan mobile number.',
  );
}
function minutes(time: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new BookingError('INVALID_TIME', 'Time must be HH:MM.');
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}
function serviceCode(value: unknown): string {
  const code = text(value, 'Service code', 64).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/.test(code))
    throw new BookingError('INVALID_SERVICE', 'Service code must be an uppercase identifier.');
  return code;
}
function date(value: unknown): string {
  try {
    return requireIsoDate(value);
  } catch {
    throw new BookingError('INVALID_DATE', 'Date must be a real date in YYYY-MM-DD format.');
  }
}
async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
async function audit(
  c: PoolClient,
  tenant: number,
  facility: number,
  actor: string,
  action: string,
  id: number,
) {
  await c.query(
    'INSERT INTO audit_logs (tenant_id,facility_id,user_id,action,resource,resource_id,details) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [tenant, facility, actor, action, 'website_booking', String(id), '{}'],
  );
}

// Per-process limiter. Deployments with multiple instances need a shared gateway limiter.
const buckets = new Map<number, number[]>();
export function resetBookingRateLimits(): void {
  buckets.clear();
}
export function checkBookingRateLimit(clientId: number, limit: number, now = Date.now()): boolean {
  const bucket = (buckets.get(clientId) ?? []).filter((t) => t > now - 60_000);
  if (bucket.length >= Math.max(1, limit)) {
    buckets.set(clientId, bucket);
    return false;
  }
  bucket.push(now);
  buckets.set(clientId, bucket);
  return true;
}

export async function authenticateBookingClient(
  raw: unknown,
  origin?: string,
): Promise<BookingClient> {
  if (typeof raw !== 'string' || !/^jcbk_[A-Za-z0-9_-]{43}$/.test(raw))
    throw new BookingError('BOOKING_AUTH_REQUIRED', 'Invalid booking client credentials.', 401);
  const result = await pool.query(
    `SELECT c.id,c.tenant_id,c.facility_id,c.allowed_services,c.allowed_origins,c.rate_limit_per_minute,f.name,f.enabled_modules,f.is_active
    FROM website_booking_clients c JOIN facilities f ON f.id=c.facility_id AND f.tenant_id=c.tenant_id
    WHERE c.api_key_hash=$1 AND c.is_active=true`,
    [apiHash(raw)],
  );
  const row = result.rows[0];
  if (!row || !row.is_active)
    throw new BookingError('BOOKING_AUTH_REQUIRED', 'Invalid booking client credentials.', 401);
  if (!Array.isArray(row.enabled_modules) || !row.enabled_modules.includes('website_booking'))
    throw new BookingError('FACILITY_MODULE_DISABLED', 'Website booking is disabled.', 403);
  const origins = Array.isArray(row.allowed_origins) ? row.allowed_origins : [];
  if (origin && !origins.includes(origin))
    throw new BookingError('BOOKING_ORIGIN_DENIED', 'Origin is not approved.', 403);
  if (!checkBookingRateLimit(row.id, row.rate_limit_per_minute))
    throw new BookingError(
      'BOOKING_RATE_LIMITED',
      'Too many booking requests. Try again later.',
      429,
    );
  keyMaterial();
  return {
    id: row.id,
    tenantId: row.tenant_id,
    facilityId: row.facility_id,
    allowedServices: Array.isArray(row.allowed_services) ? row.allowed_services : [],
    allowedOrigins: origins,
    rateLimit: row.rate_limit_per_minute,
    facilityName: row.name,
  };
}

export async function createBookingClientScoped(
  scope: BookingAdminScope,
  input: Record<string, unknown>,
) {
  const name = text(input.clientName, 'Client name', 160);
  if (
    !Array.isArray(input.allowedServices) ||
    input.allowedServices.length < 1 ||
    input.allowedServices.length > 30
  )
    throw new BookingError('INVALID_SERVICES', 'Explicit allowed services are required.');
  const services = [...new Set(input.allowedServices.map(serviceCode))];
  const origins = Array.isArray(input.allowedOrigins) ? input.allowedOrigins : [];
  if (
    origins.length > 20 ||
    !origins.every((v) => {
      try {
        const u = new URL(v);
        return typeof v === 'string' && ['https:', 'http:'].includes(u.protocol) && u.origin === v;
      } catch {
        return false;
      }
    })
  )
    throw new BookingError('INVALID_ORIGINS', 'Origins must be exact HTTP(S) origins.');
  const rate =
    input.rateLimitPerMinute === undefined ? 30 : positive(input.rateLimitPerMinute, 'Rate limit');
  if (rate > 600)
    throw new BookingError('INVALID_RATE_LIMIT', 'Rate limit must not exceed 600 per minute.');
  const rawKey = `jcbk_${randomBytes(32).toString('base64url')}`;
  const result = await tx(async (c) => {
    const row = await c.query(
      `INSERT INTO website_booking_clients (tenant_id,facility_id,client_name,api_key_prefix,api_key_hash,allowed_origins,allowed_services,rate_limit_per_minute,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9) RETURNING id,client_name AS "clientName",api_key_prefix AS "apiKeyPrefix"`,
      [
        scope.tenantId,
        scope.facilityId,
        name,
        rawKey.slice(0, 11),
        apiHash(rawKey),
        JSON.stringify(origins),
        JSON.stringify(services),
        rate,
        scope.actorUserId,
      ],
    );
    await audit(
      c,
      scope.tenantId,
      scope.facilityId,
      String(scope.actorUserId),
      'CREATE_CLIENT',
      row.rows[0].id,
    );
    return row.rows[0];
  });
  return { client: result, apiKey: rawKey }; // Returned once, only to an authorized staff administrator.
}

export async function createBookingSlotScoped(
  scope: BookingAdminScope,
  input: Record<string, unknown>,
) {
  const code = serviceCode(input.serviceCode),
    slotDate = date(input.date),
    start = text(input.startTime, 'Start time', 5),
    end = text(input.endTime, 'End time', 5),
    capacity = positive(input.capacity, 'Capacity');
  if (minutes(end) <= minutes(start) || capacity > 100)
    throw new BookingError(
      'INVALID_SLOT',
      'End time must follow start time and capacity must not exceed 100.',
    );
  try {
    return await tx(async (c) => {
      const row = await c.query(
        `INSERT INTO website_booking_slots (tenant_id,facility_id,service_code,slot_date,start_time,end_time,capacity,created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,service_code AS "serviceCode",slot_date::text AS date,start_time AS "startTime",end_time AS "endTime",capacity,status`,
        [scope.tenantId, scope.facilityId, code, slotDate, start, end, capacity, scope.actorUserId],
      );
      await audit(
        c,
        scope.tenantId,
        scope.facilityId,
        String(scope.actorUserId),
        'CREATE_SLOT',
        row.rows[0].id,
      );
      return row.rows[0];
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      throw new BookingError('SLOT_EXISTS', 'This service slot already exists.', 409);
    throw e;
  }
}

export async function getBookingAvailability(
  client: BookingClient,
  input: Record<string, unknown>,
) {
  const code = serviceCode(input.serviceCode),
    slotDate = date(input.date);
  if (!client.allowedServices.includes(code))
    throw new BookingError('SERVICE_NOT_ALLOWED', 'Service is not enabled for this client.', 403);
  const result = await pool.query(
    `SELECT s.id,s.service_code AS "serviceCode",s.slot_date::text AS date,s.start_time AS "startTime",s.end_time AS "endTime",s.capacity,
    GREATEST(0,s.capacity-COUNT(b.id)::int) AS available
    FROM website_booking_slots s LEFT JOIN external_bookings b ON b.slot_id=s.id AND b.status <> 'CANCELLED'
    WHERE s.tenant_id=$1 AND s.facility_id=$2 AND s.service_code=$3 AND s.slot_date=$4 AND s.status='OPEN'
    GROUP BY s.id ORDER BY s.start_time`,
    [client.tenantId, client.facilityId, code, slotDate],
  );
  return {
    slots: result.rows,
    availabilityScope: 'ONLINE_REQUESTS_ONLY',
    notice:
      'A slot request is not a confirmed appointment. Staff must verify the shared diary and approve it.',
  };
}

function bookingResponse(row: Record<string, unknown>, clientId: number) {
  return {
    reference: row.booking_reference,
    status: row.status,
    serviceCode: row.service_code,
    date: row.requested_date,
    startTime: row.slot_start_time,
    endTime: row.slot_end_time,
    manageToken: manageToken(clientId, String(row.booking_reference)),
    notificationLog: row.notification_log ?? [],
    notice: 'Pending requests are not confirmed appointments.',
  };
}
async function notifyBooking(
  id: number,
  phone: string,
  email: string | null,
  event: string,
  reference: string,
  dateStr: string,
  time: string,
) {
  const message = `JaliCare booking ${event}: ${reference}, ${dateStr} ${time}. Check status with the facility.`;
  const channels: Array<{ channel: 'SMS' | 'EMAIL'; to: string }> = [{ channel: 'SMS', to: phone }];
  if (email) channels.push({ channel: 'EMAIL', to: email });
  const entries = [];
  for (const item of channels) {
    let status: 'SENT' | 'FAILED' | 'NOT_CONFIGURED' | 'UNKNOWN' = 'UNKNOWN';
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Notification timeout')), 10000);
      });
      const outcome = await Promise.race([
        getNotificationProvider().send({
          channel: item.channel,
          to: item.to,
          subject: item.channel === 'EMAIL' ? 'JaliCare booking' : undefined,
          body: message,
        }),
        timeout,
      ]);
      status = outcome.status;
    } catch {
      status = 'UNKNOWN';
    } finally {
      if (timer) clearTimeout(timer);
    }
    entries.push({ event, channel: item.channel, status, at: new Date().toISOString() });
  }
  // No destination, message text, provider response or secret is logged here.
  await pool
    .query(
      'UPDATE external_bookings SET notification_log=notification_log || $1::jsonb,updated_at=now() WHERE id=$2',
      [JSON.stringify(entries), id],
    )
    .catch(() => undefined);
  return entries.map(({ channel, status }) => ({ channel, status }));
}

export async function createWebsiteBooking(client: BookingClient, input: Record<string, unknown>) {
  const slotId = positive(input.slotId, 'Slot id'),
    idempotencyKey = text(input.idempotencyKey, 'Idempotency key', 128);
  const name = text(input.patientName, 'Patient name', 160),
    phone = normalizeBookingPhone(input.phone);
  const email =
    input.email == null || input.email === ''
      ? null
      : text(input.email, 'Email', 254).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new BookingError('INVALID_EMAIL', 'Email is invalid.');
  const reason =
    input.reason == null || input.reason === '' ? null : text(input.reason, 'Reason', 2000);
  const requestHash = keyed(
    JSON.stringify({ slotId, name, phone, email, reason }),
    'booking-request',
  );
  const duplicateHash = keyed(`${name.toLowerCase()}\0${phone}`, 'booking-duplicate');
  const phoneHash = blindIndex(phone, 'external_bookings.patient_phone');
  if (!phoneHash)
    throw new BookingError(
      'BOOKING_ENCRYPTION_NOT_CONFIGURED',
      'Booking encryption is unavailable.',
      503,
    );
  let result: { row: Record<string, unknown>; replay: boolean };
  try {
    result = await tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,$2))', [
        `booking-create:${client.id}:${idempotencyKey}`,
        client.facilityId,
      ]);
      const prior = await c.query(
        'SELECT * FROM external_bookings WHERE booking_client_id=$1 AND idempotency_key=$2',
        [client.id, idempotencyKey],
      );
      if (prior.rows.length) {
        if (prior.rows[0].request_hash !== requestHash)
          throw new BookingError(
            'IDEMPOTENCY_CONFLICT',
            'Idempotency key was used for a different request.',
            409,
          );
        return { row: prior.rows[0], replay: true };
      }
      const slot = await c.query(
        'SELECT *, slot_date::text AS slot_date_string FROM website_booking_slots WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
        [slotId, client.tenantId, client.facilityId],
      );
      const s = slot.rows[0];
      if (!s || s.status !== 'OPEN' || !client.allowedServices.includes(s.service_code))
        throw new BookingError('SLOT_UNAVAILABLE', 'Slot is unavailable.', 409);
      const reference = `JCB-${randomBytes(16).toString('base64url')}`;
      const created = await c.query(
        `INSERT INTO external_bookings (tenant_id,facility_id,booking_reference,booking_client_id,slot_id,idempotency_key,request_hash,duplicate_hash,service_code,requested_date,slot_start_time,slot_end_time,status,patient_full_name,patient_phone_encrypted,patient_phone_hash,patient_email,visit_reason,notification_log)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date::text,$11,$12,'PENDING',$13,$14,$15,$16,$17,'[]'::jsonb) RETURNING *`,
        [
          client.tenantId,
          client.facilityId,
          reference,
          client.id,
          slotId,
          idempotencyKey,
          requestHash,
          duplicateHash,
          s.service_code,
          s.slot_date_string,
          s.start_time,
          s.end_time,
          seal(name),
          seal(phone),
          phoneHash,
          email ? seal(email) : null,
          reason ? seal(reason) : null,
        ],
      );
      await c.query(
        "INSERT INTO website_booking_events (booking_id,client_id,action,new_slot_id) VALUES ($1,$2,'REQUESTED',$3)",
        [created.rows[0].id, client.id, slotId],
      );
      await audit(
        c,
        client.tenantId,
        client.facilityId,
        `booking-client:${client.id}`,
        'REQUEST',
        created.rows[0].id,
      );
      return { row: created.rows[0], replay: false };
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '23505')
      throw new BookingError(
        'DUPLICATE_BOOKING',
        'An active request already exists for this patient and slot.',
        409,
      );
    if (code === '23514')
      throw new BookingError('SLOT_UNAVAILABLE', 'Slot is unavailable or full.', 409);
    throw e;
  }
  let notificationStatus: Array<{ channel: string; status: string }> | null = null;
  if (!result.replay)
    notificationStatus = await notifyBooking(
      Number(result.row.id),
      phone,
      email,
      'REQUESTED',
      String(result.row.booking_reference),
      String(result.row.requested_date),
      String(result.row.slot_start_time),
    );
  return {
    idempotentReplay: result.replay,
    booking: bookingResponse(result.row, client.id),
    notificationStatus,
  };
}

async function lookup(
  client: BookingClient,
  reference: string,
  token: string,
  c: PoolClient | typeof pool = pool,
  lock = false,
) {
  const result = await c.query(
    `SELECT * FROM external_bookings WHERE booking_reference=$1 AND booking_client_id=$2 AND facility_id=$3 AND tenant_id=$4${lock ? ' FOR UPDATE' : ''}`,
    [reference, client.id, client.facilityId, client.tenantId],
  );
  if (!result.rows.length || !constantTimeEqual(manageToken(client.id, reference), token))
    throw new BookingError(
      'BOOKING_NOT_FOUND',
      'Booking not found or management token invalid.',
      404,
    );
  return result.rows[0];
}
export async function getWebsiteBooking(client: BookingClient, reference: string, token: string) {
  const row = await lookup(
    client,
    text(reference, 'Reference', 80),
    text(token, 'Management token', 100),
  );
  const response = bookingResponse(row, client.id);
  const { manageToken: _secret, ...safe } = response;
  return safe;
}

export async function mutateWebsiteBooking(
  client: BookingClient,
  reference: string,
  token: string,
  input: Record<string, unknown>,
) {
  reference = text(reference, 'Reference', 80);
  token = text(token, 'Management token', 100);
  const key = text(input.idempotencyKey, 'Idempotency key', 128),
    action = text(input.action, 'Action', 20).toUpperCase();
  if (!['CANCEL', 'RESCHEDULE'].includes(action))
    throw new BookingError('INVALID_ACTION', 'Action must be CANCEL or RESCHEDULE.');
  const newSlotId = action === 'RESCHEDULE' ? positive(input.slotId, 'Slot id') : null;
  const requestHash = keyed(JSON.stringify({ reference, action, newSlotId }), 'booking-mutation');
  let result: { row: Record<string, unknown>; replay: boolean };
  try {
    result = await tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,$2))', [
        `booking-mutation:${client.id}:${key}`,
        client.facilityId,
      ]);
      const prior = await c.query(
        'SELECT booking_id,request_hash FROM website_booking_mutations WHERE client_id=$1 AND idempotency_key=$2',
        [client.id, key],
      );
      const row = await lookup(client, reference, token, c, true);
      if (prior.rows.length) {
        if (prior.rows[0].booking_id !== row.id || prior.rows[0].request_hash !== requestHash)
          throw new BookingError(
            'IDEMPOTENCY_CONFLICT',
            'Idempotency key was used for a different request.',
            409,
          );
        return { row, replay: true };
      }
      if (row.status === 'CANCELLED')
        throw new BookingError('BOOKING_CANCELLED', 'Cancelled bookings cannot be changed.', 409);
      const previousSlotId = row.slot_id;
      let slot = row.slot_id;
      if (action === 'RESCHEDULE') {
        const target = await c.query(
          'SELECT *, slot_date::text AS slot_date_string FROM website_booking_slots WHERE id=$1 AND facility_id=$2 AND tenant_id=$3 FOR UPDATE',
          [newSlotId, client.facilityId, client.tenantId],
        );
        const s = target.rows[0];
        if (
          !s ||
          s.status !== 'OPEN' ||
          s.service_code !== row.service_code ||
          !client.allowedServices.includes(s.service_code)
        )
          throw new BookingError('SLOT_UNAVAILABLE', 'Slot is unavailable.', 409);
        slot = s.id;
        if (row.linked_appointment_id)
          await c.query(
            "UPDATE appointments SET status='Cancelled',updated_at=now() WHERE id=$1 AND facility_id=$2",
            [row.linked_appointment_id, client.facilityId],
          );
        const updated = await c.query(
          "UPDATE external_bookings SET slot_id=$1,requested_date=$2::date::text,slot_start_time=$3,slot_end_time=$4,status='PENDING',linked_appointment_id=NULL,reschedule_count=reschedule_count+1,updated_at=now() WHERE id=$5 RETURNING *",
          [s.id, s.slot_date_string, s.start_time, s.end_time, row.id],
        );
        Object.assign(row, updated.rows[0]);
      } else {
        if (row.linked_appointment_id)
          await c.query(
            "UPDATE appointments SET status='Cancelled',updated_at=now() WHERE id=$1 AND facility_id=$2",
            [row.linked_appointment_id, client.facilityId],
          );
        const updated = await c.query(
          "UPDATE external_bookings SET status='CANCELLED',updated_at=now() WHERE id=$1 RETURNING *",
          [row.id],
        );
        Object.assign(row, updated.rows[0]);
      }
      await c.query(
        'INSERT INTO website_booking_mutations (client_id,booking_id,idempotency_key,request_hash,action) VALUES ($1,$2,$3,$4,$5)',
        [client.id, row.id, key, requestHash, action],
      );
      await c.query(
        'INSERT INTO website_booking_events (booking_id,client_id,action,previous_slot_id,new_slot_id) VALUES ($1,$2,$3,$4,$5)',
        [row.id, client.id, action, previousSlotId, slot],
      );
      await audit(
        c,
        client.tenantId,
        client.facilityId,
        `booking-client:${client.id}`,
        action,
        row.id,
      );
      return { row, replay: false };
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '23505')
      throw new BookingError(
        'DUPLICATE_BOOKING',
        'An active request already exists for this patient and slot.',
        409,
      );
    if (code === '23514')
      throw new BookingError('SLOT_UNAVAILABLE', 'Slot is unavailable or full.', 409);
    throw e;
  }
  if (!result.replay) {
    const phone = unseal(String(result.row.patient_phone_encrypted));
    const email = unseal(
      typeof result.row.patient_email === 'string' ? result.row.patient_email : null,
    );
    if (phone)
      await notifyBooking(
        Number(result.row.id),
        phone,
        email,
        action,
        reference,
        String(result.row.requested_date),
        String(result.row.slot_start_time),
      );
  }
  const response = bookingResponse(result.row, client.id);
  const { manageToken: _secret, ...safe } = response;
  return { idempotentReplay: result.replay, booking: safe };
}

export async function confirmBookingScoped(
  scope: BookingAdminScope,
  bookingId: number,
  patientId: number,
  review: { identityVerified?: unknown; availabilityReviewed?: unknown },
) {
  positive(bookingId, 'Booking id');
  positive(patientId, 'Patient id');
  if (review.identityVerified !== true || review.availabilityReviewed !== true) {
    throw new BookingError(
      'STAFF_REVIEW_REQUIRED',
      'Staff must verify patient identity and review the shared appointment diary before confirming.',
    );
  }
  const result = await tx(async (c) => {
    const booking = await c.query(
      'SELECT * FROM external_bookings WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
      [bookingId, scope.tenantId, scope.facilityId],
    );
    const b = booking.rows[0];
    if (!b) throw new BookingError('BOOKING_NOT_FOUND', 'Booking not found.', 404);
    if (b.status !== 'PENDING')
      throw new BookingError(
        'BOOKING_NOT_PENDING',
        'Only a pending request can be confirmed.',
        409,
      );
    const patient = await c.query(
      `SELECT id FROM patients p WHERE p.id=$1 AND p.tenant_id=$2 AND (p.registration_facility_id=$3 OR EXISTS(SELECT 1 FROM patient_facilities f WHERE f.patient_id=p.id AND f.tenant_id=$2 AND f.facility_id=$3 AND f.status='ACTIVE'))`,
      [patientId, scope.tenantId, scope.facilityId],
    );
    if (!patient.rows.length)
      throw new BookingError('PATIENT_NOT_FOUND', 'Patient not found in this facility.', 404);
    const duration = minutes(b.slot_end_time) - minutes(b.slot_start_time);
    const appointment = await c.query(
      `INSERT INTO appointments (tenant_id,facility_id,patient_id,scheduled_time,duration_minutes,appointment_type,status,reason) VALUES ($1,$2,$3,$4,$5,$6,'Scheduled','Website booking confirmed by staff') RETURNING id`,
      [
        scope.tenantId,
        scope.facilityId,
        patientId,
        `${b.requested_date}T${b.slot_start_time}:00`,
        duration,
        b.service_code,
      ],
    );
    await c.query(
      "UPDATE external_bookings SET status='CONFIRMED',patient_id=$1,linked_appointment_id=$2,updated_at=now() WHERE id=$3",
      [patientId, appointment.rows[0].id, b.id],
    );
    await c.query(
      "INSERT INTO website_booking_events (booking_id,actor_user_id,action,new_slot_id) VALUES ($1,$2,'CONFIRMED',$3)",
      [b.id, scope.actorUserId, b.slot_id],
    );
    await audit(c, scope.tenantId, scope.facilityId, String(scope.actorUserId), 'CONFIRM', b.id);
    return {
      bookingId: b.id,
      status: 'CONFIRMED',
      appointmentId: appointment.rows[0].id,
      phone: unseal(b.patient_phone_encrypted),
      email: unseal(b.patient_email),
      reference: b.booking_reference,
      date: b.requested_date,
      time: b.slot_start_time,
    };
  });
  const notificationStatus = result.phone
    ? await notifyBooking(
        result.bookingId,
        result.phone,
        result.email,
        'CONFIRMED',
        result.reference,
        result.date,
        result.time,
      )
    : null;
  return {
    bookingId: result.bookingId,
    status: result.status,
    appointmentId: result.appointmentId,
    notificationStatus,
  };
}

export async function getBookingAdminWorkspace(scope: BookingAdminScope) {
  const [clients, slots, bookings] = await Promise.all([
    pool.query(
      'SELECT id,client_name AS "clientName",api_key_prefix AS "apiKeyPrefix",allowed_services AS "allowedServices",allowed_origins AS "allowedOrigins",is_active AS "isActive",last_used_at AS "lastUsedAt" FROM website_booking_clients WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id DESC',
      [scope.tenantId, scope.facilityId],
    ),
    pool.query(
      'SELECT id,service_code AS "serviceCode",slot_date::text AS date,start_time AS "startTime",end_time AS "endTime",capacity,status FROM website_booking_slots WHERE tenant_id=$1 AND facility_id=$2 ORDER BY slot_date DESC,start_time LIMIT 100',
      [scope.tenantId, scope.facilityId],
    ),
    pool.query(
      'SELECT id,booking_reference,service_code,requested_date,slot_start_time,slot_end_time,status,patient_full_name,patient_phone_encrypted,patient_email,linked_appointment_id,notification_log FROM external_bookings WHERE tenant_id=$1 AND facility_id=$2 ORDER BY created_at DESC LIMIT 100',
      [scope.tenantId, scope.facilityId],
    ),
  ]);
  await pool.query(
    'INSERT INTO audit_logs (tenant_id,facility_id,user_id,action,resource,details) VALUES ($1,$2,$3,$4,$5,$6)',
    [
      scope.tenantId,
      scope.facilityId,
      String(scope.actorUserId),
      'READ',
      'website_booking_workspace',
      JSON.stringify({ count: bookings.rows.length }),
    ],
  );
  return {
    clients: clients.rows,
    slots: slots.rows,
    bookings: bookings.rows.map((b) => ({
      id: b.id,
      reference: b.booking_reference,
      serviceCode: b.service_code,
      date: b.requested_date,
      startTime: b.slot_start_time,
      endTime: b.slot_end_time,
      status: b.status,
      patientName: unseal(b.patient_full_name),
      phone: unseal(b.patient_phone_encrypted),
      email: unseal(b.patient_email),
      appointmentId: b.linked_appointment_id,
      notificationLog: b.notification_log,
    })),
    notice:
      'Online availability counts website requests only; review the shared diary before confirmation.',
  };
}

export async function revokeBookingClientScoped(scope: BookingAdminScope, clientId: number) {
  positive(clientId, 'Client id');
  return tx(async (c) => {
    const row = await c.query(
      'UPDATE website_booking_clients SET is_active=false WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 AND is_active=true RETURNING id',
      [clientId, scope.tenantId, scope.facilityId],
    );
    if (!row.rows.length)
      throw new BookingError('CLIENT_NOT_FOUND', 'Active client not found.', 404);
    await audit(
      c,
      scope.tenantId,
      scope.facilityId,
      String(scope.actorUserId),
      'REVOKE_CLIENT',
      clientId,
    );
    return { id: clientId, isActive: false };
  });
}

export async function sendBookingReminderScoped(
  scope: BookingAdminScope,
  bookingId: number,
  idempotencyKey: unknown,
) {
  positive(bookingId, 'Booking id');
  const key = text(idempotencyKey, 'Idempotency key', 128);
  const result = await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,$2))', [
      `booking-reminder:${key}`,
      scope.facilityId,
    ]);
    const existing = await c.query(
      'SELECT id,booking_id,status FROM website_booking_reminders WHERE facility_id=$1 AND idempotency_key=$2',
      [scope.facilityId, key],
    );
    if (existing.rows.length) {
      if (existing.rows[0].booking_id !== bookingId)
        throw new BookingError(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency key was used for a different reminder.',
          409,
        );
      return { id: existing.rows[0].id, status: existing.rows[0].status, replay: true, row: null };
    }
    const booking = await c.query(
      "SELECT * FROM external_bookings WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 AND status='CONFIRMED' FOR UPDATE",
      [bookingId, scope.tenantId, scope.facilityId],
    );
    if (!booking.rows.length)
      throw new BookingError(
        'BOOKING_NOT_CONFIRMED',
        'A confirmed booking is required for a reminder.',
        409,
      );
    const inserted = await c.query(
      "INSERT INTO website_booking_reminders (booking_id,facility_id,idempotency_key,requested_by_user_id,status) VALUES ($1,$2,$3,$4,'PENDING') RETURNING id",
      [bookingId, scope.facilityId, key, scope.actorUserId],
    );
    await audit(
      c,
      scope.tenantId,
      scope.facilityId,
      String(scope.actorUserId),
      'REQUEST_REMINDER',
      bookingId,
    );
    return { id: inserted.rows[0].id, status: 'PENDING', replay: false, row: booking.rows[0] };
  });
  if (result.replay) return { id: result.id, status: result.status, idempotentReplay: true };
  const b = result.row!;
  const phone = unseal(b.patient_phone_encrypted);
  const email = unseal(b.patient_email);
  if (!phone) return { id: result.id, status: 'UNKNOWN', idempotentReplay: false };
  const delivery = await notifyBooking(
    bookingId,
    phone,
    email,
    'REMINDER',
    b.booking_reference,
    b.requested_date,
    b.slot_start_time,
  );
  const status = delivery.some((d) => d.status === 'UNKNOWN') ? 'UNKNOWN' : 'COMPLETED';
  await pool.query('UPDATE website_booking_reminders SET status=$1,updated_at=now() WHERE id=$2', [
    status,
    result.id,
  ]);
  return { id: result.id, status, delivery, idempotentReplay: false };
}
