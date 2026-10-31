import type { PoolClient } from 'pg';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { resolveDashboardFacility } from '../dashboard/dashboard.service.ts';
import { calendarDateInZone, validTimezone } from '../dashboard/timezone.ts';
import { expiryCandidates } from './inventory-alerts.ts';
import { pool } from '../db/index.ts';
import type {
  AlertGroup,
  InboxItem,
  InboxResponse,
  NotificationDestination,
  NotificationSeverity,
} from './inbox.types.ts';

const EVENT_WINDOW_DAYS = 7;
const severityOrder: Record<NotificationSeverity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
  SUCCESS: 3,
};
type Facility = NonNullable<Awaited<ReturnType<typeof resolveDashboardFacility>>>;
type Candidate = Omit<InboxItem, 'key' | 'at' | 'timeKind' | 'read'> & {
  sourceKey: string;
  fingerprint: string;
};
type StoredEvent = { id: number; at: string };

export class InboxError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

function can(
  context: AuthorizationContext,
  facility: Facility,
  permission: string,
  module: string,
): boolean {
  return (
    !context.isSuperAdmin &&
    context.permissions.includes(permission) &&
    Array.isArray(facility.enabledModules) &&
    facility.enabledModules.includes(module) &&
    !(facility.hiddenModules ?? []).includes(module)
  );
}

/** No fallback to server/browser timezone: invalid configuration is an explicit error. */
async function getTimezone(client: PoolClient, facility: Facility): Promise<string> {
  const result = await client.query<{ timezone: string | null }>(
    'SELECT coalesce(f.timezone,t.timezone) AS timezone FROM facilities f JOIN tenants t ON t.id=f.tenant_id WHERE f.id=$1 AND t.id=$2',
    [facility.id, facility.tenantId],
  );
  const timezone = result.rows[0]?.timezone;
  if (!validTimezone(timezone))
    throw new InboxError(
      'TIMEZONE_NOT_CONFIGURED',
      'The facility or tenant timezone is missing or invalid. Configure it before checking notifications.',
      503,
    );
  return timezone;
}

function inventoryCandidates(
  rows: Array<{
    id: number;
    name: string;
    unit: string | null;
    current_stock: number | null;
    reorder_level: number | null;
  }>,
  facilityName: string,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const item of rows) {
    let group: AlertGroup | null = null;
    let title = '',
      details = '';
    let severity: NotificationSeverity = 'WARNING';
    const unit = item.unit || 'units';
    if (item.current_stock === null || item.current_stock < 0) {
      group = 'inventoryReview';
      title = 'Stock count requires review';
      details = `${item.name}: recorded stock is ${item.current_stock === null ? 'missing' : item.current_stock}. Review the inventory record.`;
    } else if (item.current_stock === 0) {
      group = 'stockout';
      severity = 'CRITICAL';
      title = 'Stock-out';
      details = `${item.name}: 0 ${unit} recorded. Check inventory and replenishment.`;
    } else if (item.reorder_level === null || item.reorder_level < 0) {
      group = 'inventoryReview';
      title = 'Reorder level requires review';
      details = `${item.name}: ${item.current_stock} ${unit} recorded; reorder level is missing or invalid.`;
    } else if (item.current_stock <= item.reorder_level) {
      group = 'lowStock';
      title = 'Low stock';
      details = `${item.name}: ${item.current_stock} ${unit} recorded; reorder level ${item.reorder_level}.`;
    }
    if (group)
      candidates.push({
        sourceKey: `inventory.stock:${item.id}`,
        fingerprint: group,
        group,
        severity,
        title,
        source: 'Inventory',
        destination: 'inventory',
        isAlert: true,
        details: `${details} Facility: ${facilityName}.`,
      });
  }
  return candidates;
}

/** Serialize scans per facility. A source has one active episode, not a new record per page load.
 * Escalation, correction to the expiry date, or recurrence after an observed resolution makes a new revision. */
async function syncAlerts(
  client: PoolClient,
  facility: Facility,
  actor: number,
  prefix: string,
  candidates: Candidate[],
): Promise<InboxItem[]> {
  const records = candidates.map(({ sourceKey, fingerprint }) => ({
    source_key: sourceKey,
    fingerprint,
  }));
  const changed = await client.query(
    `INSERT INTO notification_alert_states(tenant_id,facility_id,source_key,fingerprint)
     SELECT $1,$2,r.source_key,r.fingerprint FROM jsonb_to_recordset($3::jsonb) AS r(source_key text,fingerprint text)
     ON CONFLICT (tenant_id,facility_id,source_key) DO UPDATE SET
       fingerprint=excluded.fingerprint, active=true, revision=notification_alert_states.revision+1,
       first_seen_at=now(), changed_at=now()
     WHERE NOT notification_alert_states.active OR notification_alert_states.fingerprint IS DISTINCT FROM excluded.fingerprint
     RETURNING id`,
    [facility.tenantId, facility.id, JSON.stringify(records)],
  );
  const resolved = await client.query(
    `UPDATE notification_alert_states SET active=false, changed_at=now()
     WHERE tenant_id=$1 AND facility_id=$2 AND active AND source_key LIKE $3
       AND NOT (source_key = ANY($4::text[])) RETURNING id`,
    [facility.tenantId, facility.id, `${prefix}:%`, candidates.map((item) => item.sourceKey)],
  );
  if (changed.rowCount || resolved.rowCount) {
    await client.query(
      `INSERT INTO audit_logs(tenant_id,facility_id,user_id,action,resource,details)
       VALUES($1,$2,$3,'SYNC','NotificationAlerts',$4)`,
      [
        facility.tenantId,
        facility.id,
        String(actor),
        JSON.stringify({ source: prefix, changed: changed.rowCount, resolved: resolved.rowCount }),
      ],
    );
  }
  if (!candidates.length) return [];
  const states = await client.query<{
    id: number;
    source_key: string;
    revision: number;
    first_seen_at: Date;
  }>(
    `SELECT id,source_key,revision,first_seen_at FROM notification_alert_states
     WHERE tenant_id=$1 AND facility_id=$2 AND active AND source_key=ANY($3::text[])`,
    [facility.tenantId, facility.id, candidates.map((item) => item.sourceKey)],
  );
  const bySource = new Map(states.rows.map((state) => [state.source_key, state]));
  return candidates.map((candidate) => {
    const state = bySource.get(candidate.sourceKey);
    if (!state) throw new Error('Alert state synchronization failed');
    const { sourceKey: _source, fingerprint: _fingerprint, ...item } = candidate;
    return {
      ...item,
      key: `alert:${state.id}:${state.revision}`,
      at: state.first_seen_at.toISOString(),
      timeKind: 'detected',
      read: false,
    };
  });
}

/** Each feed entry reflects a persisted source record; no provider outcome is inferred. */
function eventItems(
  rows: StoredEvent[],
  event: {
    key: string;
    severity: NotificationSeverity;
    title: string;
    source: string;
    destination: NotificationDestination;
    detail: string;
  },
): InboxItem[] {
  return rows.map((row) => ({
    key: `event:${event.key}:${row.id}`,
    severity: event.severity,
    title: event.title,
    details: `${event.detail} #${row.id}.`,
    source: event.source,
    destination: event.destination,
    at: row.at,
    timeKind: 'recorded',
    isAlert: false,
    read: false,
  }));
}

async function collect(
  client: PoolClient,
  context: AuthorizationContext,
  facility: Facility,
  timezone: string,
): Promise<{ items: InboxItem[]; availableSources: string[] }> {
  const t = facility.tenantId,
    f = facility.id;
  const today = calendarDateInZone(timezone);
  const args = [t, f, today];
  const availableSources: string[] = [];
  const items: InboxItem[] = [];
  if (can(context, facility, 'inventory.read', 'inventory')) {
    availableSources.push('Inventory stock and batches');
    const stocks = await client.query(
      'SELECT id,name,unit,current_stock,reorder_level FROM inventory_items WHERE facility_id=$1 AND is_active IS TRUE',
      [f],
    );
    const batches = await client.query(
      `SELECT b.id,i.name,i.unit,b.batch_number,b.expiry_date,b.quantity_remaining
      FROM inventory_batches b JOIN inventory_items i ON i.id=b.item_id
      WHERE i.facility_id=$1 AND i.is_active IS TRUE AND b.quantity_remaining>0`,
      [f],
    );
    items.push(
      ...(await syncAlerts(
        client,
        facility,
        context.userId,
        'inventory.stock',
        inventoryCandidates(stocks.rows, facility.name),
      )),
    );
    items.push(
      ...(await syncAlerts(
        client,
        facility,
        context.userId,
        'inventory.expiry',
        expiryCandidates(batches.rows, today, facility.name),
      )),
    );
  }
  if (can(context, facility, 'laboratory.read', 'laboratory')) {
    availableSources.push('Laboratory');
    const critical = await client.query<{ id: number }>(
      `SELECT r.id FROM lab_results r JOIN lab_orders o ON o.id=r.order_id AND o.patient_id=r.patient_id
      WHERE o.tenant_id=$1 AND o.facility_id=$2 AND lower(coalesce(r.flag,''))='critical' AND r.status='Pending Verification'`,
      [t, f],
    );
    const candidates: Candidate[] = critical.rows.map(({ id }) => ({
      sourceKey: `laboratory.critical:${id}`,
      fingerprint: 'critical-pending-verification',
      group: 'criticalLab',
      severity: 'CRITICAL',
      title: 'Critical laboratory flag awaiting verification',
      details: `Laboratory result #${id} is flagged critical and pending verification. Follow the facility escalation workflow.`,
      source: 'Laboratory',
      destination: 'laboratory',
      isAlert: true,
    }));
    items.push(
      ...(await syncAlerts(client, facility, context.userId, 'laboratory.critical', candidates)),
    );
    const orders = await client.query<StoredEvent>(
      `SELECT id,to_char(ordered_at,'YYYY-MM-DD"T"HH24:MI:SS') AS at FROM lab_orders
      WHERE tenant_id=$1 AND facility_id=$2 AND ordered_at >= $3::date - 6 AND ordered_at < $3::date + 1`,
      args,
    );
    items.push(
      ...eventItems(orders.rows, {
        key: 'lab-order',
        severity: 'INFO',
        title: 'Laboratory order recorded',
        source: 'Laboratory',
        destination: 'laboratory',
        detail: 'Order',
      }),
    );
    const verified = await client.query<StoredEvent>(
      `SELECT r.id,to_char(r.verified_at,'YYYY-MM-DD"T"HH24:MI:SS') AS at FROM lab_results r
      JOIN lab_orders o ON o.id=r.order_id AND o.patient_id=r.patient_id WHERE o.tenant_id=$1 AND o.facility_id=$2
      AND r.status='Verified' AND r.verified_at >= $3::date - 6 AND r.verified_at < $3::date + 1`,
      args,
    );
    items.push(
      ...eventItems(verified.rows, {
        key: 'lab-verified',
        severity: 'SUCCESS',
        title: 'Laboratory result verified',
        source: 'Laboratory',
        destination: 'laboratory',
        detail: 'Result',
      }),
    );
  }
  const specs = [
    {
      permission: 'patients.read',
      module: 'registration',
      source: 'Registration',
      key: 'patient',
      severity: 'INFO' as const,
      title: 'Patient registered',
      detail: 'Patient record',
      query: `SELECT id,to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS') AS at FROM patients WHERE tenant_id=$1 AND registration_facility_id=$2 AND created_at >= $3::date - 6 AND created_at < $3::date + 1`,
    },
    {
      permission: 'appointments.read',
      module: 'reception',
      source: 'Reception',
      key: 'appointment',
      severity: 'INFO' as const,
      title: 'Appointment recorded',
      detail: 'Appointment',
      query: `SELECT id,to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS') AS at FROM appointments WHERE tenant_id=$1 AND facility_id=$2 AND created_at >= $3::date - 6 AND created_at < $3::date + 1`,
    },
    {
      permission: 'inpatient.read',
      module: 'inpatient',
      source: 'Inpatient',
      key: 'admission',
      severity: 'INFO' as const,
      title: 'Admission record created',
      detail: 'Admission',
      query: `SELECT id,to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS') AS at FROM admissions WHERE tenant_id=$1 AND facility_id=$2 AND created_at >= $3::date - 6 AND created_at < $3::date + 1`,
    },
    {
      permission: 'theatre.read',
      module: 'theatre',
      source: 'Theatre',
      key: 'theatre',
      severity: 'INFO' as const,
      title: 'Theatre case scheduled',
      detail: 'Scheduled theatre case',
      query: `SELECT id,to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS') AS at FROM theatre_cases WHERE tenant_id=$1 AND facility_id=$2 AND lower(coalesce(status,''))='scheduled' AND created_at >= $3::date - 6 AND created_at < $3::date + 1`,
    },
    {
      permission: 'billing.read',
      module: 'finance',
      source: 'Billing',
      key: 'invoice',
      severity: 'INFO' as const,
      title: 'Invoice created',
      detail: 'Invoice',
      query: `SELECT id,to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS') AS at FROM billing_invoices WHERE tenant_id=$1 AND facility_id=$2 AND created_at >= $3::date - 6 AND created_at < $3::date + 1`,
    },
    {
      permission: 'billing.read',
      module: 'finance',
      source: 'Billing',
      key: 'receipt',
      severity: 'SUCCESS' as const,
      title: 'Receipt recorded',
      detail: 'Recorded receipt (not verified settlement)',
      query: `SELECT p.id,to_char(p.payment_date,'YYYY-MM-DD"T"HH24:MI:SS') AS at FROM billing_payments p JOIN billing_invoices i ON i.id=p.invoice_id WHERE i.tenant_id=$1 AND i.facility_id=$2 AND p.payment_date >= $3::date - 6 AND p.payment_date < $3::date + 1`,
    },
  ];
  for (const spec of specs) {
    if (!can(context, facility, spec.permission, spec.module)) continue;
    if (!availableSources.includes(spec.source)) availableSources.push(spec.source);
    const rows = await client.query<StoredEvent>(spec.query, args);
    items.push(
      ...eventItems(rows.rows, { ...spec, destination: spec.module as NotificationDestination }),
    );
  }
  if (items.length) {
    const reads = await client.query<{ notification_key: string }>(
      `SELECT notification_key FROM notification_read_receipts
      WHERE tenant_id=$1 AND facility_id=$2 AND user_id=$3 AND notification_key=ANY($4::text[])`,
      [t, f, context.userId, items.map((item) => item.key)],
    );
    const keys = new Set(reads.rows.map((row) => row.notification_key));
    for (const item of items) item.read = keys.has(item.key);
  }
  items.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      b.at.localeCompare(a.at) ||
      a.key.localeCompare(b.key),
  );
  return { items, availableSources };
}

export async function inboxRequest(
  context: AuthorizationContext,
  facilityId: number,
  options: {
    offset?: number;
    limit?: number;
    severity?: NotificationSeverity;
    mark?: string | 'all';
  } = {},
): Promise<InboxResponse> {
  const facility = await resolveDashboardFacility(context, facilityId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('jalicare-notification-scan'), $1)", [
      facility.id,
    ]);
    const timezone = await getTimezone(client, facility);
    const { items, availableSources } = await collect(client, context, facility, timezone);
    if (options.mark) {
      const target =
        options.mark === 'all'
          ? items.filter((item) => !item.read)
          : items.filter((item) => item.key === options.mark && !item.read);
      if (options.mark !== 'all' && !items.some((item) => item.key === options.mark))
        throw new InboxError(
          'NOTIFICATION_NOT_AVAILABLE',
          'This notification is no longer available in your facility or permissions.',
          404,
        );
      if (target.length) {
        const inserted = await client.query(
          `INSERT INTO notification_read_receipts(tenant_id,facility_id,user_id,notification_key)
          SELECT $1,$2,$3,key FROM unnest($4::text[]) AS key ON CONFLICT DO NOTHING RETURNING notification_key`,
          [facility.tenantId, facility.id, context.userId, target.map((item) => item.key)],
        );
        const marked = new Set(inserted.rows.map((row) => row.notification_key));
        for (const item of target) item.read = true;
        if (marked.size)
          await client.query(
            `INSERT INTO audit_logs(tenant_id,facility_id,user_id,action,resource,details)
          VALUES($1,$2,$3,'MARK_READ','NotificationInbox',$4)`,
            [
              facility.tenantId,
              facility.id,
              String(context.userId),
              JSON.stringify({ count: marked.size, all: options.mark === 'all' }),
            ],
          );
      }
    }
    const alertGroups = new Map<AlertGroup, InboxResponse['alertGroups'][number]>();
    for (const item of items)
      if (item.isAlert && item.group) {
        const existing = alertGroups.get(item.group);
        if (existing) existing.count++;
        else
          alertGroups.set(item.group, {
            group: item.group,
            severity: item.severity,
            count: 1,
            destination: item.destination,
          });
      }
    const filtered = options.severity
      ? items.filter((item) => item.severity === options.severity)
      : items;
    const offset = options.offset ?? 0,
      limit = options.limit ?? 50;
    const response: InboxResponse = {
      facilityId: facility.id,
      timezone,
      checkedAt: new Date().toISOString(),
      eventWindowDays: EVENT_WINDOW_DAYS,
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      unreadCount: items.filter((item) => !item.read).length,
      unreadCritical: items.filter((item) => !item.read && item.severity === 'CRITICAL').length,
      offset,
      limit,
      alertGroups: [...alertGroups.values()],
      availableSources,
    };
    await client.query('COMMIT');
    return response;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
