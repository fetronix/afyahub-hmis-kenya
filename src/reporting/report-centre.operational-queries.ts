import type { ReportEngineId } from './report-catalogue.ts';
import type { ReportFilters } from './report-centre.types.ts';
import type { QueryPlan } from './report-centre.service.ts';

const textPattern = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
const finite = (expression: string) =>
  `${expression} IS NOT NULL AND ${expression}::text NOT IN ('NaN','Infinity','-Infinity')`;
const positiveMoney = (expression: string) => `(${finite(expression)} AND ${expression} > 0)`;
const nonnegativeMoney = (expression: string) => `(${finite(expression)} AND ${expression} >= 0)`;
const patientName = "concat_ws(' ',p.first_name,p.middle_name,p.last_name)";
// PostgreSQL 16 is the application's configured database. Legacy text dates must not be blindly cast.
const isoDate = (expression: string) =>
  `(CASE WHEN left(${expression},10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND pg_input_is_valid(left(${expression},10),'date') THEN left(${expression},10)::date ELSE NULL END)`;

/** Static SQL plans only: all user input enters as PostgreSQL parameters. */
export function operationalQueryPlan(
  id: ReportEngineId,
  tenantId: number,
  filters: ReportFilters,
): QueryPlan | null {
  const params: unknown[] = [tenantId, filters.facilityId];
  const p = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where: string[] = [];
  let undatedWhere: string[] | undefined;
  let undatedParams: unknown[] | undefined;
  let undatedLabel: string | undefined;
  const dateRange = (expression: string, label?: string) => {
    if (!filters.from || !filters.to) return;
    if (label) {
      undatedWhere = [...where, `${expression} IS NULL`];
      undatedParams = [...params];
      undatedLabel = label;
    }
    where.push(
      `${expression} >= ${p(filters.from)}::date`,
      `${expression} <= ${p(filters.to)}::date`,
    );
  };
  const patientFilters = (source: string) => {
    if (filters.search) {
      const q = p(textPattern(filters.search));
      where.push(`(p.mrn ILIKE ${q} OR ${patientName} ILIKE ${q}${source})`);
    }
    if (filters.patientId) where.push(`p.id=${p(filters.patientId)}`);
  };
  const finish = (plan: Omit<QueryPlan, 'where' | 'params'>): QueryPlan => ({
    ...plan,
    where,
    params,
    undatedWhere,
    undatedParams,
    undatedLabel,
  });

  if (id === 'patient-registrations') {
    where.push('p.tenant_id=$1', 'p.registration_facility_id=$2');
    patientFilters('');
    dateRange('p.created_at::date');
    return finish({
      from: 'patients p',
      select: `p.id AS "_patientId", p.mrn, ${patientName} AS patient,
        p.date_of_birth::text AS "birthDate", p.gender, p.created_at::text AS "createdAt"`,
      order: 'p.created_at DESC, p.id DESC',
    });
  }
  if (id === 'inventory-expiry') {
    where.push('f.tenant_id=$1', 'i.facility_id=$2');
    if (filters.search) {
      const q = p(textPattern(filters.search));
      where.push(`(i.item_code ILIKE ${q} OR i.name ILIKE ${q} OR b.batch_number ILIKE ${q})`);
    }
    const expiry = isoDate('b.expiry_date');
    dateRange(expiry, 'batch(es) with missing or invalid recorded expiry dates');
    return finish({
      from: 'inventory_batches b JOIN inventory_items i ON i.id=b.item_id JOIN facilities f ON f.id=i.facility_id',
      select:
        'i.item_code AS code, i.name AS item, b.batch_number AS batch, b.expiry_date AS expiry, b.quantity_remaining AS quantity, i.unit',
      order: `${expiry} ASC NULLS LAST, b.id ASC`,
      missingExpression: `${expiry} IS NULL`,
      missingLabel: 'batch(es) have missing or invalid recorded expiry dates',
    });
  }
  if (id === 'outpatient-encounters') {
    where.push('e.tenant_id=$1', 'e.facility_id=$2', "e.encounter_type='OUTPATIENT'");
    patientFilters('');
    if (filters.status) where.push(`e.status=${p(filters.status)}`);
    if (filters.departmentId) where.push(`d.id=${p(filters.departmentId)}`);
    if (filters.staffId) where.push(`pr.user_id=${p(filters.staffId)}`);
    dateRange('e.started_at::date');
    return finish({
      from: `encounters e
        LEFT JOIN patients p ON p.id=e.patient_id AND p.tenant_id=e.tenant_id
        LEFT JOIN departments d ON d.id=e.department_id AND d.facility_id=e.facility_id
        LEFT JOIN practitioners pr ON pr.id=e.practitioner_id AND pr.tenant_id=e.tenant_id AND pr.facility_id=e.facility_id`,
      select: `e.id AS "encounterId", p.id AS "_patientId", p.mrn, CASE WHEN p.id IS NULL THEN NULL ELSE ${patientName} END AS patient,
        e.started_at::text AS "startedAt", e.status, d.name AS department, pr.full_name AS practitioner`,
      order: 'e.started_at DESC, e.id DESC',
      missingExpression:
        'p.id IS NULL OR (e.department_id IS NOT NULL AND d.id IS NULL) OR (e.practitioner_id IS NOT NULL AND pr.id IS NULL)',
    });
  }
  if (id === 'inpatient-admissions' || id === 'inpatient-discharges') {
    where.push('a.tenant_id=$1', 'a.facility_id=$2');
    if (id === 'inpatient-discharges') where.push('a.discharge_date IS NOT NULL');
    patientFilters('');
    if (filters.wardId) where.push(`w.id=${p(filters.wardId)}`);
    const date = isoDate(id === 'inpatient-admissions' ? 'a.admission_date' : 'a.discharge_date');
    dateRange(date, 'admission(s) with missing or invalid recorded dates');
    return finish({
      from: `admissions a
        LEFT JOIN patients p ON p.id=a.patient_id AND p.tenant_id=a.tenant_id
        LEFT JOIN wards w ON w.id=a.ward_id AND w.facility_id=a.facility_id
        LEFT JOIN beds b ON b.id=a.bed_id AND b.ward_id=w.id`,
      select: `a.id AS "admissionId", p.id AS "_patientId", p.mrn, CASE WHEN p.id IS NULL THEN NULL ELSE ${patientName} END AS patient,
        a.admission_date AS "admissionDate", a.discharge_date AS "dischargeDate", a.status, a.discharge_type AS "dischargeType", w.name AS ward, b.bed_number AS bed`,
      order: `${date} DESC NULLS LAST, a.id DESC`,
      missingExpression: `p.id IS NULL OR w.id IS NULL OR b.id IS NULL OR ${date} IS NULL`,
    });
  }
  if (id === 'laboratory-orders') {
    where.push('o.tenant_id=$1', 'o.facility_id=$2');
    patientFilters(` OR o.test_name ILIKE $${params.length + 1}`);
    if (filters.status) where.push(`o.status=${p(filters.status)}`);
    dateRange('o.ordered_at::date');
    return finish({
      from: 'lab_orders o LEFT JOIN patients p ON p.id=o.patient_id AND p.tenant_id=o.tenant_id',
      select: `o.id AS "orderId", p.id AS "_patientId", p.mrn, CASE WHEN p.id IS NULL THEN NULL ELSE ${patientName} END AS patient,
        o.test_name AS test, o.specimen_type AS specimen, o.status, o.ordered_at::text AS "orderedAt", o.completed_at::text AS "completedAt"`,
      order: 'o.ordered_at DESC, o.id DESC',
      missingExpression: 'p.id IS NULL',
    });
  }
  if (id === 'radiology-requests') {
    where.push('r.tenant_id=$1', 'r.facility_id=$2');
    const next = params.length + 1;
    patientFilters(` OR r.procedure_name ILIKE $${next} OR r.modality ILIKE $${next}`);
    if (filters.status) where.push(`r.status=${p(filters.status)}`);
    dateRange('r.created_at::date');
    return finish({
      from: 'radiology_orders r LEFT JOIN patients p ON p.id=r.patient_id AND p.tenant_id=r.tenant_id',
      select: `r.id AS "requestId", p.id AS "_patientId", p.mrn, CASE WHEN p.id IS NULL THEN NULL ELSE ${patientName} END AS patient,
        r.procedure_name AS procedure, r.modality, r.status, r.created_at::text AS "requestedAt", r.reported_at::text AS "reportedAt"`,
      order: 'r.created_at DESC, r.id DESC',
      missingExpression: 'p.id IS NULL',
    });
  }
  if (id === 'pharmacy-dispensations') {
    where.push('d.tenant_id=$1', 'd.facility_id=$2');
    const next = params.length + 1;
    patientFilters(
      ` OR d.item_name_snapshot ILIKE $${next} OR d.item_code_snapshot ILIKE $${next} OR d.batch_number ILIKE $${next}`,
    );
    dateRange('d.dispensed_at::date');
    return finish({
      from: 'pharmacy_dispensations d LEFT JOIN patients p ON p.id=d.patient_id AND p.tenant_id=d.tenant_id',
      select: `d.id AS "dispensationId", p.id AS "_patientId", p.mrn, CASE WHEN p.id IS NULL THEN NULL ELSE ${patientName} END AS patient,
        d.item_code_snapshot AS "itemCode", d.item_name_snapshot AS item, d.quantity_dispensed AS quantity, d.item_unit_snapshot AS unit,
        d.batch_number AS batch, d.dispensed_at::text AS "dispensedAt"`,
      order: 'd.dispensed_at DESC, d.id DESC',
      missingExpression:
        'p.id IS NULL OR d.item_name_snapshot IS NULL OR d.item_code_snapshot IS NULL OR d.item_unit_snapshot IS NULL',
      missingLabel: 'dispensation(s) have missing/out-of-scope patient or item snapshots',
    });
  }
  if (id === 'cashier-receipts') {
    where.push('d.tenant_id=$1', 'd.facility_id=$2');
    if (filters.search) {
      const q = p(textPattern(filters.search));
      where.push(`(d.cashier_name ILIKE ${q} OR d.payment_method ILIKE ${q})`);
    }
    dateRange('d.recorded_date');
    return finish({
      from: `(SELECT i.tenant_id, i.facility_id, bp.payment_date::date AS recorded_date,
        bp.cashier_name, bp.payment_method, count(*)::integer AS receipt_count,
        sum(bp.amount) FILTER (WHERE ${positiveMoney('bp.amount')}) AS known_amount,
        count(*) FILTER (WHERE NOT ${positiveMoney('bp.amount')})::integer AS invalid_count
        FROM billing_payments bp JOIN billing_invoices i ON i.id=bp.invoice_id
        WHERE i.tenant_id=$1 AND i.facility_id=$2
        GROUP BY i.tenant_id, i.facility_id, bp.payment_date::date, bp.cashier_name, bp.payment_method) d`,
      select: `d.recorded_date::text AS "recordedDate", d.cashier_name AS cashier, d.payment_method AS method,
        d.receipt_count AS "receiptCount", d.known_amount::text AS amount, d.invalid_count AS "unknownAmounts"`,
      order: 'd.recorded_date DESC, d.cashier_name ASC, d.payment_method ASC NULLS LAST',
      missingExpression: 'd.invalid_count > 0',
      missingLabel: 'cashier/date group(s) contain invalid or unknown payment amounts',
      summaryExpression: 'sum(d.known_amount)',
      summaryLabel: 'Known recorded receipts (refunds not deducted)',
    });
  }
  if (id === 'recorded-refunds') {
    where.push('r.tenant_id=$1', 'r.facility_id=$2');
    if (filters.search) {
      const q = p(textPattern(filters.search));
      where.push(
        `(r.refund_number ILIKE ${q} OR i.invoice_number ILIKE ${q} OR r.refund_method ILIKE ${q})`,
      );
    }
    if (filters.staffId) where.push(`r.actor_user_id=${p(filters.staffId)}`);
    dateRange('r.created_at::date');
    return finish({
      from: 'billing_refunds r JOIN billing_invoices i ON i.id=r.invoice_id AND i.tenant_id=r.tenant_id AND i.facility_id=r.facility_id',
      select: `r.refund_number AS number, i.invoice_number AS invoice, r.refund_method AS method,
        CASE WHEN ${positiveMoney('r.amount')} THEN r.amount::text ELSE NULL END AS amount, r.actor_user_id AS "actorId", r.created_at::text AS "createdAt"`,
      order: 'r.created_at DESC, r.id DESC',
      missingExpression: `NOT ${positiveMoney('r.amount')}`,
      missingLabel: 'refund(s) have invalid or unknown recorded amounts',
      summaryExpression: `sum(r.amount) FILTER (WHERE ${positiveMoney('r.amount')})`,
      summaryLabel: 'Known recorded manual refund amount',
    });
  }
  if (id === 'invoice-balances') {
    where.push(
      'i.tenant_id=$1',
      'i.facility_id=$2',
      'i.voided_at IS NULL',
      `(i.balance_amount <> 0 OR NOT (${finite('i.balance_amount')}))`,
    );
    const next = params.length + 1;
    patientFilters(` OR i.invoice_number ILIKE $${next}`);
    dateRange('i.created_at::date');
    return finish({
      from: 'billing_invoices i LEFT JOIN patients p ON p.id=i.patient_id AND p.tenant_id=i.tenant_id',
      select: `i.invoice_number AS invoice, p.id AS "_patientId", p.mrn, CASE WHEN p.id IS NULL THEN NULL ELSE ${patientName} END AS patient,
        i.status, CASE WHEN ${nonnegativeMoney('i.balance_amount')} THEN i.balance_amount::text ELSE NULL END AS balance, i.created_at::text AS "createdAt"`,
      order: 'i.created_at DESC, i.id DESC',
      missingExpression: `p.id IS NULL OR NOT ${nonnegativeMoney('i.balance_amount')}`,
      missingLabel: 'invoice(s) have a missing/out-of-scope patient or invalid/unknown balance',
      summaryExpression: `sum(i.balance_amount) FILTER (WHERE ${nonnegativeMoney('i.balance_amount')})`,
      summaryLabel: 'Known recorded invoice balances',
    });
  }
  return null;
}
