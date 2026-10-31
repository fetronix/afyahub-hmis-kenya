import { pool } from '../db/index.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { getFacilityByIdScoped } from '../db/queries.ts';
import { resolveFacilityScope, ScopeAccessError } from '../auth/scope.service.ts';
import { moduleLogger } from '../logging/logger.ts';
import {
  makeBuckets,
  parseCalendarDate,
  previousRange,
  type DashboardRange,
} from './date-range.ts';
import { centsToMoney, moneyToCents } from './money.ts';
import type {
  DashboardOverview,
  DashboardPanel,
  DashboardSearchResult,
} from './dashboard.types.ts';

const log = moduleLogger('dashboard');

type Facility = NonNullable<Awaited<ReturnType<typeof getFacilityByIdScoped>>>;
type Counts = { current: number; previous: number };

export async function resolveDashboardFacility(
  context: AuthorizationContext,
  requested: number,
): Promise<Facility> {
  // A global platform administrator does not inherit clinical or financial facility authority.
  if (context.isSuperAdmin)
    throw new ScopeAccessError('A facility account is required.', 'FACILITY_ACCOUNT_REQUIRED');
  const id = resolveFacilityScope(context, requested);
  const facility = await getFacilityByIdScoped(context, id);
  if (!facility) throw new ScopeAccessError('The facility is not available.', 'FACILITY_NOT_FOUND');
  return facility;
}

function enabled(facility: Facility, ...modules: string[]): boolean {
  const active = Array.isArray(facility.enabledModules) ? facility.enabledModules : [];
  const hidden = Array.isArray(facility.hiddenModules) ? facility.hiddenModules : [];
  return modules.every((item) => active.includes(item) && !hidden.includes(item));
}

function permitted(context: AuthorizationContext, ...permissions: string[]): boolean {
  return (
    !context.isSuperAdmin &&
    permissions.every((permission) => context.permissions.includes(permission))
  );
}

function unavailable<T>(
  context: AuthorizationContext,
  facility: Facility,
  permissions: string[],
  modules: string[],
): DashboardPanel<T> | null {
  if (!permitted(context, ...permissions))
    return {
      status: 'restricted',
      message: 'Your account does not have permission to view this information.',
    };
  if (!enabled(facility, ...modules))
    return { status: 'disabled', message: 'The required facility module is not enabled.' };
  return null;
}

async function panel<T>(
  context: AuthorizationContext,
  facility: Facility,
  permissions: string[],
  modules: string[],
  section: string,
  load: () => Promise<T>,
): Promise<DashboardPanel<T>> {
  const blocked = unavailable<T>(context, facility, permissions, modules);
  if (blocked) return blocked;
  try {
    return { status: 'ok', data: await load() };
  } catch (error) {
    // Never log SQL parameters or patient identity. The response distinguishes failure from zero.
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : undefined;
    log.error({ section, code }, 'dashboard.section_failed');
    return {
      status: 'error',
      message: 'This information could not be loaded. Retry or contact support.',
    };
  }
}

function bucketIndex(day: string, buckets: DashboardRange[]): number {
  return buckets.findIndex((bucket) => day >= bucket.start && day <= bucket.end);
}

async function registrations(facility: Facility, range: DashboardRange, previous: DashboardRange) {
  const args = [
    facility.tenantId,
    facility.id,
    range.start,
    range.end,
    previous.start,
    previous.end,
  ];
  const [summary, daily] = await Promise.all([
    pool.query<{ current: number; previous: number; total: number }>(
      `SELECT count(*) FILTER (WHERE created_at >= $3::date AND created_at < $4::date + 1)::int AS current,
              count(*) FILTER (WHERE created_at >= $5::date AND created_at < $6::date + 1)::int AS previous,
              count(*) FILTER (WHERE created_at < $4::date + 1)::int AS total
       FROM patients WHERE tenant_id=$1 AND registration_facility_id=$2`,
      args,
    ),
    pool.query<{ day: string; count: number }>(
      `SELECT to_char(created_at,'YYYY-MM-DD') AS day, count(*)::int AS count FROM patients
       WHERE tenant_id=$1 AND registration_facility_id=$2 AND created_at >= $3::date AND created_at < $4::date + 1
       GROUP BY 1 ORDER BY 1`,
      args.slice(0, 4),
    ),
  ]);
  const trend = makeBuckets(range).map((bucket) => ({ ...bucket, value: 0 }));
  for (const row of daily.rows) {
    const index = bucketIndex(row.day, trend);
    if (index >= 0) trend[index].value += row.count;
  }
  return {
    current: summary.rows[0].current,
    previous: summary.rows[0].previous,
    totalThroughEnd: summary.rows[0].total,
    trend,
  };
}

async function receipts(facility: Facility, range: DashboardRange, previous: DashboardRange) {
  const args = [facility.tenantId, facility.id, previous.start, range.end];
  const [payments, refunds] = await Promise.all([
    pool.query<{ day: string; amount: string; invalid: number }>(
      `SELECT to_char(p.payment_date,'YYYY-MM-DD') AS day, sum(p.amount)::text AS amount,
              count(*) FILTER (WHERE p.amount <= 0 OR p.amount::text IN ('NaN','Infinity','-Infinity'))::int AS invalid
       FROM billing_payments p JOIN billing_invoices i ON i.id=p.invoice_id
       WHERE i.tenant_id=$1 AND i.facility_id=$2 AND p.payment_date >= $3::date AND p.payment_date < $4::date + 1
       GROUP BY 1 ORDER BY 1`,
      args,
    ),
    pool.query<{ day: string; amount: string; invalid: number }>(
      `SELECT to_char(r.created_at,'YYYY-MM-DD') AS day, sum(r.amount)::text AS amount,
              count(*) FILTER (WHERE r.amount <= 0 OR r.amount::text IN ('NaN','Infinity','-Infinity')
                OR NOT r.manual_confirmation OR p.id IS NULL OR i.id IS NULL)::int AS invalid
       FROM billing_refunds r
       LEFT JOIN billing_payments p ON p.id=r.payment_id AND p.invoice_id=r.invoice_id
       LEFT JOIN billing_invoices i ON i.id=r.invoice_id AND i.tenant_id=r.tenant_id AND i.facility_id=r.facility_id
       WHERE r.tenant_id=$1 AND r.facility_id=$2 AND r.created_at >= $3::date AND r.created_at < $4::date + 1
       GROUP BY 1 ORDER BY 1`,
      args,
    ),
  ]);
  let gross = 0n,
    returned = 0n,
    previousNet = 0n;
  const buckets = makeBuckets(range).map((bucket) => ({ ...bucket, cents: 0n }));
  for (const [rows, sign] of [
    [payments.rows, 1n],
    [refunds.rows, -1n],
  ] as const) {
    for (const row of rows) {
      if (row.invalid) throw new Error('Recorded receipts require review');
      const amount = moneyToCents(row.amount);
      if (amount < 0n) throw new Error('Recorded receipts require review');
      if (row.day >= range.start && row.day <= range.end) {
        if (sign === 1n) gross += amount;
        else returned += amount;
        const index = bucketIndex(row.day, buckets);
        if (index >= 0) buckets[index].cents += amount * sign;
      } else if (row.day >= previous.start && row.day <= previous.end) {
        previousNet += amount * sign;
      }
    }
  }
  return {
    gross: centsToMoney(gross),
    refunds: centsToMoney(returned),
    net: centsToMoney(gross - returned),
    previousNet: centsToMoney(previousNet),
    trend: buckets.map(({ start, end, cents }) => ({ start, end, net: centsToMoney(cents) })),
  };
}

async function invoices(facility: Facility, range: DashboardRange, previous: DashboardRange) {
  const args = [
    facility.tenantId,
    facility.id,
    range.start,
    range.end,
    previous.start,
    previous.end,
  ];
  const [summary, categories] = await Promise.all([
    pool.query<Counts & { billed: string; balance: string; finalized: number; invalid: number }>(
      `SELECT count(*) FILTER (WHERE created_at >= $3::date AND created_at < $4::date + 1)::int AS current,
              count(*) FILTER (WHERE created_at >= $5::date AND created_at < $6::date + 1)::int AS previous,
              coalesce(sum(total_amount) FILTER (WHERE created_at >= $3::date AND created_at < $4::date + 1),0)::text AS billed,
              coalesce(sum(balance_amount) FILTER (WHERE created_at >= $3::date AND created_at < $4::date + 1),0)::text AS balance,
              count(*) FILTER (WHERE created_at >= $3::date AND created_at < $4::date + 1 AND finalized_at IS NOT NULL)::int AS finalized,
              count(*) FILTER (WHERE created_at >= $3::date AND created_at < $4::date + 1 AND
                 (total_amount IS NULL OR balance_amount IS NULL OR total_amount::text IN ('NaN','Infinity','-Infinity') OR balance_amount::text IN ('NaN','Infinity','-Infinity') OR total_amount < 0 OR balance_amount < 0))::int AS invalid
       FROM billing_invoices WHERE tenant_id=$1 AND facility_id=$2 AND voided_at IS NULL AND lower(coalesce(status,'')) <> 'void'`,
      args,
    ),
    pool.query<{ label: string; amount: string; invalid: number }>(
      `SELECT coalesce(nullif(trim(b.item_type),''),'Other') AS label, sum(b.total_amount)::text AS amount,
              count(*) FILTER (WHERE b.total_amount IS NULL OR b.total_amount::text IN ('NaN','Infinity','-Infinity'))::int AS invalid
       FROM billing_items b JOIN billing_invoices i ON i.id=b.invoice_id
       WHERE i.tenant_id=$1 AND i.facility_id=$2 AND i.voided_at IS NULL AND lower(coalesce(i.status,'')) <> 'void'
         AND b.created_at >= $3::date AND b.created_at < $4::date + 1
       GROUP BY 1 ORDER BY sum(b.total_amount) DESC, 1`,
      args.slice(0, 4),
    ),
  ]);
  const row = summary.rows[0];
  if (row.invalid || categories.rows.some((entry) => entry.invalid))
    throw new Error('Invoice amounts require review');
  moneyToCents(row.billed);
  moneyToCents(row.balance);
  for (const entry of categories.rows) moneyToCents(entry.amount);
  return {
    current: row.current,
    previous: row.previous,
    billed: row.billed,
    recordedBalance: row.balance,
    finalized: row.finalized,
    categories: categories.rows.map(({ label, amount }) => ({ label, amount })),
  };
}

async function admissions(
  facility: Facility,
  range: DashboardRange,
  previous: DashboardRange,
): Promise<Counts> {
  const result = await pool.query<Counts>(
    `SELECT count(*) FILTER (WHERE created_at >= $3::date AND created_at < $4::date + 1)::int AS current,
            count(*) FILTER (WHERE created_at >= $5::date AND created_at < $6::date + 1)::int AS previous
     FROM admissions WHERE tenant_id=$1 AND facility_id=$2`,
    [facility.tenantId, facility.id, range.start, range.end, previous.start, previous.end],
  );
  return result.rows[0];
}

async function flow(facility: Facility, range: DashboardRange) {
  const buckets = makeBuckets(range);
  const output = [];
  for (const bucket of buckets) {
    const result = await pool.query<{ registered: number; returning: number }>(
      `SELECT
         (SELECT count(*)::int FROM patients p WHERE p.tenant_id=$1 AND p.registration_facility_id=$2
           AND p.created_at >= $3::date AND p.created_at < $4::date + 1) AS registered,
         (SELECT count(DISTINCT e.patient_id)::int FROM encounters e
           JOIN patients p ON p.id=e.patient_id AND p.tenant_id=e.tenant_id
           WHERE e.tenant_id=$1 AND e.facility_id=$2 AND e.started_at >= $3::date AND e.started_at < $4::date + 1
             AND upper(e.status) <> 'CANCELLED' AND p.created_at <= e.started_at
             AND NOT (p.registration_facility_id=$2 AND p.created_at >= $3::date AND p.created_at < $4::date + 1)) AS returning`,
      [facility.tenantId, facility.id, bucket.start, bucket.end],
    );
    output.push({ ...bucket, ...result.rows[0] });
  }
  return output;
}

async function activity(facility: Facility, range: DashboardRange) {
  const result = await pool.query<{ id: number; action: string; resource: string; at: string }>(
    `SELECT id, action, resource, to_char(timestamp,'YYYY-MM-DD"T"HH24:MI:SS') AS at FROM audit_logs
     WHERE tenant_id=$1 AND facility_id=$2 AND timestamp >= $3::date AND timestamp < $4::date + 1
       AND action ~ '^[A-Za-z0-9_.:-]{1,80}$' AND resource ~ '^[A-Za-z0-9_.:-]{1,80}$'
     ORDER BY timestamp DESC, id DESC LIMIT 4`,
    [facility.tenantId, facility.id, range.start, range.end],
  );
  // Timestamps in this schema are zone-less; return the stored wall time without inventing an offset.
  return result.rows;
}

async function appointments(facility: Facility, range: DashboardRange) {
  const result = await pool.query<{
    id: number;
    patientName: string;
    scheduledTime: string;
    appointmentType: string | null;
    practitionerName: string | null;
    status: string | null;
  }>(
    `SELECT a.id, CASE WHEN p.registration_facility_id=$2 THEN concat_ws(' ',p.first_name,p.middle_name,p.last_name) ELSE 'Patient details restricted' END AS "patientName",
            a.scheduled_time AS "scheduledTime", a.appointment_type AS "appointmentType",
            practitioner.full_name AS "practitionerName", a.status
     FROM appointments a JOIN patients p ON p.id=a.patient_id AND p.tenant_id=a.tenant_id
     LEFT JOIN practitioners practitioner ON practitioner.id=a.practitioner_id AND practitioner.tenant_id=a.tenant_id AND practitioner.facility_id=a.facility_id
     WHERE a.tenant_id=$1 AND a.facility_id=$2
       AND a.scheduled_time ~ '^\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}(:\\d{2})?$'
       AND left(a.scheduled_time,10) >= $3 AND left(a.scheduled_time,10) <= $4
       AND replace(a.scheduled_time,'T',' ') >= to_char(now() AT TIME ZONE 'Africa/Nairobi','YYYY-MM-DD HH24:MI')
       AND lower(coalesce(a.status,'')) IN ('scheduled','confirmed','booked')
     ORDER BY replace(a.scheduled_time,'T',' '), a.id LIMIT 5`,
    [facility.tenantId, facility.id, range.start, range.end],
  );
  for (const row of result.rows) {
    const [date, time] = row.scheduledTime.replace('T', ' ').split(' ');
    const [hour, minute, second = 0] = time.split(':').map(Number);
    if (!parseCalendarDate(date) || hour > 23 || minute > 59 || second > 59) {
      throw new Error('A displayed appointment time requires review');
    }
  }
  return result.rows;
}

export async function getDashboardOverview(
  context: AuthorizationContext,
  facility: Facility,
  range: DashboardRange,
): Promise<DashboardOverview> {
  const previous = previousRange(range);
  const [
    registrationPanel,
    receiptPanel,
    invoicePanel,
    admissionPanel,
    flowPanel,
    activityPanel,
    appointmentPanel,
  ] = await Promise.all([
    panel(context, facility, ['patients.read'], ['registration'], 'registrations', () =>
      registrations(facility, range, previous),
    ),
    panel(context, facility, ['billing.read'], ['finance'], 'receipts', () =>
      receipts(facility, range, previous),
    ),
    panel(context, facility, ['billing.read'], ['finance'], 'invoices', () =>
      invoices(facility, range, previous),
    ),
    panel(context, facility, ['inpatient.read'], ['inpatient'], 'admissions', () =>
      admissions(facility, range, previous),
    ),
    panel(
      context,
      facility,
      ['patients.read', 'clinical.read'],
      ['registration', 'opd'],
      'flow',
      () => flow(facility, range),
    ),
    panel(context, facility, ['audit.read'], ['audit'], 'activity', () =>
      activity(facility, range),
    ),
    panel(
      context,
      facility,
      ['appointments.read', 'patients.read'],
      ['reception', 'registration'],
      'appointments',
      () => appointments(facility, range),
    ),
  ]);
  return {
    facilityId: facility.id,
    range,
    previousRange: previous,
    registrations: registrationPanel,
    receipts: receiptPanel,
    invoices: invoicePanel,
    admissions: admissionPanel,
    flow: flowPanel,
    activity: activityPanel,
    appointments: appointmentPanel,
  };
}

export async function searchDashboard(
  context: AuthorizationContext,
  facility: Facility,
  term: string,
): Promise<DashboardSearchResult> {
  const available = {
    patients: permitted(context, 'patients.read') && enabled(facility, 'registration'),
    invoices: permitted(context, 'billing.read') && enabled(facility, 'finance'),
    services: permitted(context, 'tariffs.read') && enabled(facility, 'finance'),
  };
  // Escape SQL wildcard characters, not just SQL syntax: searching '%' must not enumerate everyone.
  const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
  const args = [facility.tenantId, facility.id, pattern];
  const [patientRows, invoiceRows, serviceRows] = await Promise.all([
    available.patients
      ? pool.query<{ id: number; name: string; mrn: string }>(
          `SELECT p.id, concat_ws(' ',p.first_name,p.middle_name,p.last_name) AS name, p.mrn FROM patients p
       WHERE p.tenant_id=$1 AND p.registration_facility_id=$2
       AND (concat_ws(' ',p.first_name,p.middle_name,p.last_name) ILIKE $3 OR p.mrn ILIKE $3)
       ORDER BY p.last_name, p.first_name, p.id LIMIT 5`,
          args,
        )
      : Promise.resolve({ rows: [] }),
    available.invoices
      ? pool.query<{ id: number; number: string; status: string | null }>(
          `SELECT id, invoice_number AS number, status FROM billing_invoices WHERE tenant_id=$1 AND facility_id=$2 AND invoice_number ILIKE $3 ORDER BY created_at DESC LIMIT 5`,
          args,
        )
      : Promise.resolve({ rows: [] }),
    available.services
      ? pool.query<{ id: number; code: string; description: string }>(
          `SELECT id, code, description FROM facility_service_tariffs WHERE tenant_id=$1 AND facility_id=$2 AND is_active AND (code ILIKE $3 OR description ILIKE $3) ORDER BY description LIMIT 5`,
          args,
        )
      : Promise.resolve({ rows: [] }),
  ]);
  if (patientRows.rows.length) {
    await pool.query(
      `INSERT INTO patient_record_access_logs(patient_id,user_id,facility_id,tenant_id,action,access_channel,record_type)
       SELECT p.id,$3,$2,$1,'VIEW','STAFF_PORTAL','DIRECTORY_SEARCH' FROM patients p WHERE p.tenant_id=$1 AND p.id=ANY($4::int[])`,
      [facility.tenantId, facility.id, context.userId, patientRows.rows.map((row) => row.id)],
    );
  }
  return {
    patients: patientRows.rows,
    invoices: invoiceRows.rows,
    services: serviceRows.rows,
    available,
  };
}
