/**
 * JaliCare HMIS
 * Billing Engine
 *
 * Converts clinical activity into invoice line items using the
 * facility's own service tariffs (`facility_service_tariffs`).
 *
 * DESIGN RULES
 * ------------
 * 1. The facility tariff is the ONLY source of price. This module never
 *    invents a price and never hardcodes one.
 * 2. If no tariff matches, the charge is skipped and reported back as
 *    `TARIFF_NOT_CONFIGURED`. The clinical action still succeeds.
 *    A missing price must never block patient care.
 * 3. Every engine charge carries an idempotency key backed by a UNIQUE
 *    partial index, so replaying a clinical event cannot double-bill.
 * 4. Money is computed in integer cents to avoid floating-point drift.
 * 5. Charges for the same encounter accumulate on one open invoice, so
 *    a patient leaves with a single bill rather than one per service.
 */

import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import type { db as database } from '../db/index.ts';
import * as schema from '../db/schema.ts';

/* ============================================================
   TYPES
   ============================================================ */

/**
 * Transaction handle. Queries are executed either on the pool or inside
 * a `db.transaction()` callback, so the type covers both.
 */
type Executor =
  | typeof database
  | Parameters<Parameters<typeof database.transaction>[0]>[0];

export type BillingSourceType =
  | 'CONSULTATION'
  | 'LAB_ORDER'
  | 'PROCEDURE'
  | 'RADIOLOGY'
  | 'PHARMACY'
  | 'ADMISSION'
  | 'BED_DAY'
  | 'MANUAL';

export type ChargeSkipReason =
  | 'TARIFF_NOT_CONFIGURED'
  | 'DUPLICATE'
  | 'INVOICE_CLOSED'
  | 'INVALID_INPUT';

export interface ChargeRequest {
  tenantId: number;
  facilityId: number;
  patientId: number;
  encounterId?: number | null;

  /**
   * Ordered list of tariff codes to try for this service.
   *
   * The first code with an active tariff in this facility wins. Callers
   * pass facility-agnostic candidates so the engine stays policy-free:
   *   ['LAB-CBC', 'CBC']  or  ['OPD-CONSULT', 'CONSULTATION', 'CONSULT']
   */
  codes: readonly string[];

  quantity?: number;

  sourceType: BillingSourceType;
  sourceId: number | string;

  /** Line-item category shown on the bill: Laboratory, Consultation… */
  itemType: string;

  /** Optional display override; the tariff description is used otherwise */
  description?: string;

  /**
   * Used only when NO tariff matches, for services whose price already
   * lives on the source record (e.g. a dispensed medication's unit
   * price). Tariffs still take precedence.
   */
  fallbackUnitPrice?: string | number | null;
  fallbackDescription?: string;

  /**
   * Extra discriminator folded into the idempotency key when one source
   * produces several charges (a medication line, a specific bed-night).
   */
  idempotencySuffix?: string;
}

export interface ChargeResult {
  charged: boolean;
  reason?: ChargeSkipReason;

  invoiceId?: number;
  invoiceNumber?: string;
  itemId?: number;

  tariffCode?: string;
  description?: string;
  quantity?: number;
  unitPrice?: string;
  totalAmount?: string;

  /** Present when the charge was skipped, for UI messaging. */
  message?: string;
}

/* ============================================================
   MONEY HELPERS
   ============================================================ */

/** Parse a numeric(10,2) / string / number into integer cents. */
export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return 0;

  return Math.round(parsed * 100);
}

/** Format integer cents as a numeric(10,2)-safe decimal string. */
export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(Math.round(cents));

  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/* ============================================================
   IDEMPOTENCY
   ============================================================ */

/**
 * Stable key for one billable event.
 *
 * Example: BED_DAY:42:2026-10-21 — re-running the nightly accrual on the
 * same day produces the same key and is rejected by the unique index.
 */
export function buildIdempotencyKey(
  request: Pick<ChargeRequest, 'sourceType' | 'sourceId' | 'idempotencySuffix'>,
): string {
  const base = `${request.sourceType}:${String(request.sourceId)}`;

  if (!request.idempotencySuffix) return base;

  return `${base}:${request.idempotencySuffix}`;
}

/* ============================================================
   TARIFF RESOLUTION
   ============================================================ */

export interface ResolvedTariff {
  id: number;
  code: string;
  description: string;
  fee: string;
  unit: string;
}

/**
 * Find the first active tariff in this facility matching one of the
 * candidate codes. Returns null when the facility has configured none,
 * which is a normal, non-error outcome.
 */
export async function resolveTariff(
  executor: Executor,
  facilityId: number,
  codes: readonly string[],
): Promise<ResolvedTariff | null> {
  const candidates = codes
    .map((code) => code?.trim())
    .filter((code): code is string => Boolean(code));

  if (candidates.length === 0) return null;

  const rows = await executor
    .select({
      id: schema.facilityServiceTariffs.id,
      code: schema.facilityServiceTariffs.code,
      description: schema.facilityServiceTariffs.description,
      fee: schema.facilityServiceTariffs.fee,
      unit: schema.facilityServiceTariffs.unit,
    })
    .from(schema.facilityServiceTariffs)
    .where(
      and(
        eq(schema.facilityServiceTariffs.facilityId, facilityId),
        eq(schema.facilityServiceTariffs.isActive, true),
        inArray(schema.facilityServiceTariffs.code, candidates),
      ),
    );

  if (rows.length === 0) return null;

  /* Preserve the caller's priority order. */
  for (const candidate of candidates) {
    const match = rows.find((row) => row.code === candidate);

    if (match) return match;
  }

  return null;
}

/* ============================================================
   INVOICE LIFECYCLE
   ============================================================ */

const OPEN_INVOICE_STATUSES = ['Pending', 'Unpaid', 'Partially Paid'];

/** Statuses that accept new charges. */
const CHARGEABLE_STATUSES = new Set<string>([
  'Pending',
  'Unpaid',
  'Partially Paid',
]);

/**
 * Read the next value of the invoice-number sequence.
 * The sequence is created by migration 0009.
 */
async function nextInvoiceNumber(executor: Executor): Promise<string> {
  const result = await executor.execute(
    sql`SELECT nextval('billing_invoice_number_seq') AS value`,
  );

  const rows = (result as unknown as { rows?: Array<{ value: string }> }).rows;

  const value = rows?.[0]?.value;

  if (value === undefined || value === null) {
    throw new Error('Unable to allocate an invoice number.');
  }

  return `INV-${String(value).padStart(6, '0')}`;
}

/**
 * Find the invoice that new charges for this encounter/patient should
 * land on, creating one if necessary.
 *
 * Encounter-scoped invoices are preferred: an OPD visit produces one
 * bill, and an admission produces its own.
 */
async function findOrCreateOpenInvoice(
  executor: Executor,
  request: ChargeRequest,
) {
  const scope = and(
    eq(schema.billingInvoices.facilityId, request.facilityId),
    eq(schema.billingInvoices.patientId, request.patientId),
    isNull(schema.billingInvoices.voidedAt),
    inArray(schema.billingInvoices.status, OPEN_INVOICE_STATUSES),
    request.encounterId
      ? eq(schema.billingInvoices.encounterId, request.encounterId)
      : or(
          isNull(schema.billingInvoices.encounterId),
          eq(schema.billingInvoices.status, 'Pending'),
        ),
  );

  const [existing] = await executor
    .select()
    .from(schema.billingInvoices)
    .where(scope)
    .orderBy(desc(schema.billingInvoices.createdAt))
    .limit(1);

  if (existing) return existing;

  const invoiceNumber = await nextInvoiceNumber(executor);

  const [created] = await executor
    .insert(schema.billingInvoices)
    .values({
      tenantId: request.tenantId,
      facilityId: request.facilityId,
      patientId: request.patientId,
      encounterId: request.encounterId ?? null,
      invoiceNumber,
      totalAmount: '0.00',
      paidAmount: '0.00',
      balanceAmount: '0.00',
      status: 'Pending',
      payerType: 'Self-Pay',
    })
    .returning();

  if (!created) {
    throw new Error('Failed to open an invoice for this patient.');
  }

  return created;
}

/**
 * Recalculate an invoice from its line items.
 *
 * Totals are derived, never incremented, so they cannot drift out of
 * sync with the lines the patient can actually see.
 */
export async function recalculateInvoiceTotals(
  executor: Executor,
  invoiceId: number,
) {
  const [summed] = await executor
    .select({
      total: sql<string>`COALESCE(SUM(${schema.billingItems.totalAmount}), 0)`,
    })
    .from(schema.billingItems)
    .where(eq(schema.billingItems.invoiceId, invoiceId));

  const totalCents = toCents(summed?.total);

  const [invoice] = await executor
    .select({
      paidAmount: schema.billingInvoices.paidAmount,
      status: schema.billingInvoices.status,
    })
    .from(schema.billingInvoices)
    .where(eq(schema.billingInvoices.id, invoiceId))
    .limit(1);

  if (!invoice) return null;

  const paidCents = toCents(invoice.paidAmount);
  const balanceCents = Math.max(0, totalCents - paidCents);

  /* A voided invoice keeps its status and must not be resurrected. */
  const status =
    invoice.status === 'Void'
      ? 'Void'
      : balanceCents === 0 && totalCents > 0
        ? 'Paid'
        : paidCents > 0
          ? 'Partially Paid'
          : 'Pending';

  const [updated] = await executor
    .update(schema.billingInvoices)
    .set({
      totalAmount: fromCents(totalCents),
      balanceAmount: fromCents(balanceCents),
      status,
      updatedAt: new Date(),
    })
    .where(eq(schema.billingInvoices.id, invoiceId))
    .returning();

  return updated ?? null;
}

/* ============================================================
   THE CHARGE
   ============================================================ */

/**
 * Post one billable event.
 *
 * Never throws for a missing tariff or a duplicate: those are reported
 * as `charged: false` with a reason. Throws only for genuine faults
 * (database errors), so the caller can decide whether to surface them.
 */
export async function chargeForService(
  executor: Executor,
  request: ChargeRequest,
): Promise<ChargeResult> {
  if (
    !Number.isSafeInteger(request.facilityId) ||
    !Number.isSafeInteger(request.patientId)
  ) {
    return {
      charged: false,
      reason: 'INVALID_INPUT',
      message: 'A valid facility and patient are required to raise a charge.',
    };
  }

  const quantity =
    Number.isSafeInteger(request.quantity) && (request.quantity ?? 0) > 0
      ? Number(request.quantity)
      : 1;

  const quantityLabel =
    quantity === 1 ? '' : ` × ${quantity}`;

  /* ---- 1. Price it from the facility tariff ---------------------- */

  const tariff = await resolveTariff(
    executor,
    request.facilityId,
    request.codes,
  );

  const unitPriceCents = tariff
    ? toCents(tariff.fee)
    : toCents(request.fallbackUnitPrice);

  if (unitPriceCents <= 0) {
    return {
      charged: false,
      reason: 'TARIFF_NOT_CONFIGURED',
      message: tariff
        ? `Tariff ${tariff.code} is priced at zero.`
        : `No active tariff is configured for ${request.codes[0] ?? request.sourceType}. The service was recorded but not billed.`,
    };
  }

  const description = tariff
    ? `${tariff.description}${quantityLabel}`
    : `${request.description ?? request.fallbackDescription ?? request.itemType}${quantityLabel}`;

  const idempotencyKey = buildIdempotencyKey(request);

  /* ---- 2. Attach to an open invoice ----------------------------- */

  const invoice = await findOrCreateOpenInvoice(executor, request);

  const invoiceStatus = invoice.status ?? 'Pending';

  if (!CHARGEABLE_STATUSES.has(invoiceStatus) && invoiceStatus !== 'Paid') {
    return {
      charged: false,
      reason: 'INVOICE_CLOSED',
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      message: `Invoice ${invoice.invoiceNumber} is ${invoice.status} and cannot accept new charges.`,
    };
  }

  /* ---- 3. Insert the line, deduplicated ------------------------- */

  const totalCents = unitPriceCents * quantity;

  const inserted = await executor
    .insert(schema.billingItems)
    .values({
      invoiceId: invoice.id,
      tariffId: tariff?.id ?? null,
      tariffCode: tariff?.code ?? request.codes[0] ?? null,
      sourceType: request.sourceType,
      sourceId:
        typeof request.sourceId === 'number'
          ? request.sourceId
          : null,
      idempotencyKey,
      itemType: request.itemType,
      description,
      quantity,
      unitPrice: fromCents(unitPriceCents),
      totalAmount: fromCents(totalCents),
    })
    .onConflictDoNothing({
      target: schema.billingItems.idempotencyKey,
    })
    .returning();

  if (!inserted[0]) {
    return {
      charged: false,
      reason: 'DUPLICATE',
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      message: 'This service has already been billed.',
    };
  }

  /* ---- 4. Re-derive invoice totals ----------------------------- */

  const updatedInvoice = await recalculateInvoiceTotals(
    executor,
    invoice.id,
  );

  return {
    charged: true,
    invoiceId: invoice.id,
    invoiceNumber: updatedInvoice?.invoiceNumber ?? invoice.invoiceNumber,
    itemId: inserted[0].id,
    tariffCode: tariff?.code ?? request.codes[0],
    description,
    quantity,
    unitPrice: fromCents(unitPriceCents),
    totalAmount: fromCents(totalCents),
  };
}

/**
 * Ordered tariff-code candidates for one bed-night.
 *
 * Facility admins can price a specific ward (BED-ICU), with a generic
 * inpatient day rate beneath it. The first configured code wins.
 */
export function bedDayTariffCodes(wardCode?: string | null): string[] {
  const codes: string[] = [];

  const cleaned = typeof wardCode === 'string'
    ? wardCode.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')
    : '';

  if (cleaned) {
    codes.push(`BED-${cleaned}`, `WARD-${cleaned}`);
  }

  codes.push('BED-DAY', 'INPATIENT-BED-DAY', 'WARD-DAY', 'BED');

  return [...new Set(codes)];
}

/* ============================================================
   BED-DAY ACCRUAL
   ============================================================ */

/**
 * Inclusive list of calendar dates (YYYY-MM-DD) between two instants.
 *
 * Admissions store dates as text in several formats; parse defensively
 * and fall back to a single day rather than throwing.
 */
export function bedDayDates(
  admissionDate: string,
  dischargeDate: string | null | undefined,
): string[] {
  const start = parseLooseDate(admissionDate);
  const end = dischargeDate ? parseLooseDate(dischargeDate) : new Date();

  if (!start) return [];

  const dates: string[] = [];

  const cursor = new Date(start.getTime());
  const limit = new Date((end ?? new Date()).getTime());

  /* Guard against runaway loops on corrupted dates. */
  let guard = 0;

  while (cursor.getTime() <= limit.getTime() && guard < 400) {
    dates.push(formatDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  /*
   * A same-day discharge still occupies a bed for one night, so always
   * bill at least one day. Without this, a short stay is free.
   */
  if (dates.length === 0) {
    dates.push(formatDateKey(start));
  }

  return dates;
}

function parseLooseDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  /* 'YYYY-MM-DD HH:mm' is not consistently parsed across engines. */
  const normalised = value.trim().replace(' ', 'T').replace(/\//g, '-');

  const parsed = new Date(normalised);

  if (!Number.isNaN(parsed.getTime())) return parsed;

  const dateOnly = new Date(normalised.slice(0, 10));

  if (!Number.isNaN(dateOnly.getTime())) return dateOnly;

  return null;
}

function formatDateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-');
}

/* ============================================================
   REPORTING HELPERS
   ============================================================ */

export interface RevenueSummaryRow {
  itemType: string;
  sourceType: string | null;
  lineCount: number;
  revenue: string;
}

/**
 * Revenue grouped by service category for one facility.
 * Used by the analytics dashboard and the revenue report.
 */
export async function getRevenueByServiceType(
  executor: Executor,
  facilityId: number,
): Promise<RevenueSummaryRow[]> {
  const rows = await executor
    .select({
      itemType: schema.billingItems.itemType,
      sourceType: schema.billingItems.sourceType,
      lineCount: sql<number>`COUNT(*)::int`,
      revenue: sql<string>`COALESCE(SUM(${schema.billingItems.totalAmount}), 0)`,
    })
    .from(schema.billingItems)
    .innerJoin(
      schema.billingInvoices,
      eq(schema.billingItems.invoiceId, schema.billingInvoices.id),
    )
    .where(
      and(
        eq(schema.billingInvoices.facilityId, facilityId),
        isNull(schema.billingInvoices.voidedAt),
      ),
    )
    .groupBy(schema.billingItems.itemType, schema.billingItems.sourceType);

  return rows as RevenueSummaryRow[];
}
