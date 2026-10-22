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

import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import type { db as database } from '../db/index.ts';
import * as schema from '../db/schema.ts';

import { formatDateKey, parseLooseDate } from '../utils/dates.ts';
import {
  codesForFamily,
  describeMatch,
  explainMatch,
  familyLabel,
  matchTariff,
  phrasesForCharge,
  type MatchOutcome,
} from './tariff-matching.ts';
import {
  PAYMENT_CHANNEL_LABELS,
  PAYMENT_CHANNELS,
  paymentChannel,
  type PaymentChannel,
} from './settlement.ts';
import type { BillingFamily } from './tariff-codes.ts';
import {
  failureLabel,
  resolveServiceTariff,
  type CatalogueServiceType,
} from './tariff-resolver.ts';

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
  | 'MATERNITY'
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

  /**
   * Explicit links the facility made on the tariff screen, most specific
   * first: `['LABORATORY:LAB-CBC', 'LABORATORY']`, `['CONSULTATION']`.
   *
   * Tried *before* `codes`. A facility that says "OPD-001 is the
   * consultation" has answered the question the engine would otherwise
   * have to guess at, and a guess between a 150 tariff and a 300 one is
   * not a guess worth making.
   */
  serviceKeys?: readonly string[];

  /**
   * Which automatic charge this is. Enables the catalogue rule: the
   * facility's own description, inside the department this service
   * belongs to, matched only when exactly one tariff claims it.
   */
  family?: BillingFamily;

  /** The test, study, procedure or drug being priced. */
  serviceName?: string | null;

  /** Visit type, for a consultation (`OUTPATIENT`, `FOLLOW_UP`, …). */
  encounterType?: string | null;

  /**
   * Bed category and ward name, for an inpatient bed-night.
   *
   * The category gates which descriptions may price the night: a
   * general ward rate must never be selected for an ICU bed.
   */
  wardType?: string | null;
  wardName?: string | null;

  /** Extra phrases to look for, most specific first. */
  aliases?: readonly string[];

  /**
   * The catalogue record this charge is for.
   *
   * `id` is the stable database id of the thing that was ordered —
   * `lab_tests.id` for a laboratory test — and is what an explicit
   * service-to-tariff link is keyed on. Not a code: a facility may
   * rename `LAB-006` to `FBC` tomorrow without breaking the price.
   */
  serviceRef?: {
    type: CatalogueServiceType;
    id: number | null;
    code?: string | null;
  };

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

  /** The tariff's own billing unit: `Visit`, `Per day`, `Test`. */
  unit?: string | null;

  /** How the tariff was found, when one was. */
  matchRule?: 'LINK' | 'FAMILY_LINK' | 'ALIAS' | 'CODE' | 'CATALOGUE';

  /** Why the charge could not be priced, when it could not. */
  diagnosis?: { code: string; label: string; candidates?: string[] };
  matchExplanation?: string;
  /** Codes the engine tried, shown when nothing matched. */
  codesTried?: string[];

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

/**
 * List the first few codes a charge tried, and say how many others were
 * tried too.
 *
 * A laboratory order now offers up to six codes; printing all six turns
 * a useful message into a wall of text, and printing one hides the code
 * the facility actually needs to add.
 */
function summariseCodes(codes: readonly string[]): string {
  const shown = codes.slice(0, 3).join(', ');
  const rest = codes.length - 3;

  return rest > 0 ? `${shown} (+${rest} more)` : shown;
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
 * True when the database predates migration 0019.
 *
 * A development database can be a migration behind, and a missing
 * `billing_key` column must not turn every charge into a 500. The
 * lookup degrades to code matching and says so once in the log; the
 * tariff write path refuses to pretend a link was saved.
 */
export function isMissingBillingKeyColumn(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;

  return code === '42703' || code === '42P01';
}

let warnedMissingBillingKey = false;

/**
 * Find the tariff the facility linked to this automatic charge.
 *
 * The keys are matched case-insensitively and in the caller's priority
 * order, so `LABORATORY:LAB-CBC` beats the generic `LABORATORY` even if
 * both rows come back together. Only active tariffs count.
 */
export async function resolveLinkedTariff(
  executor: Executor,
  facilityId: number,
  serviceKeys: readonly string[] | undefined,
): Promise<ResolvedTariff | null> {
  /*
   * One implementation of the rule, in `resolveTariffForCharge`. This
   * wrapper keeps the older call shape working for anything outside
   * this module without keeping a second copy of the matching order.
   */
  const match = await resolveTariffForCharge(executor, {
    facilityId,
    codes: [],
    serviceKeys: serviceKeys ?? [],
  });

  return match.tariff;
}

/**
 * Every active tariff this facility has, in one query.
 *
 * One read rather than three: the link rule, the code rule and the
 * catalogue rule all need the same rows, and loading them together is
 * also what makes "why did OPD-001 not match?" answerable in one place.
 *
 * `billing_key` arrived in migration 0019. A database one migration
 * behind still bills by code; the column is simply absent from the row.
 */
export async function loadActiveFacilityTariffs(
  executor: Executor,
  facilityId: number,
): Promise<Array<ResolvedTariff & { department: string | null; billingKey: string | null }>> {
  const base = {
    id: schema.facilityServiceTariffs.id,
    code: schema.facilityServiceTariffs.code,
    description: schema.facilityServiceTariffs.description,
    fee: schema.facilityServiceTariffs.fee,
    unit: schema.facilityServiceTariffs.unit,
    department: schema.facilityServiceTariffs.department,
  };

  try {
    return await executor
      .select({ ...base, billingKey: schema.facilityServiceTariffs.billingKey })
      .from(schema.facilityServiceTariffs)
      .where(
        and(
          eq(schema.facilityServiceTariffs.facilityId, facilityId),
          eq(schema.facilityServiceTariffs.isActive, true),
        ),
      );
  } catch (error) {
    if (!isMissingBillingKeyColumn(error)) throw error;

    if (!warnedMissingBillingKey) {
      warnedMissingBillingKey = true;

      console.warn(
        'Billing: facility_service_tariffs.billing_key is missing. Run `npm run db:migrate` (migration 0019) to enable linked automatic billing. Falling back to code and description matching.',
      );
    }

    const rows = await executor
      .select(base)
      .from(schema.facilityServiceTariffs)
      .where(
        and(
          eq(schema.facilityServiceTariffs.facilityId, facilityId),
          eq(schema.facilityServiceTariffs.isActive, true),
        ),
      );

    return rows.map((row) => ({ ...row, billingKey: null }));
  }
}

export interface ChargeMatch {
  tariff: ResolvedTariff | null;
  rule: 'LINK' | 'FAMILY_LINK' | 'ALIAS' | 'CODE' | 'CATALOGUE' | null;
  explanation: string;
  ambiguity?: { phrase: string; codes: string[] };
  codesTried: string[];
  phrasesTried: string[];
  /** Rows that were available to match against. */
  candidateCount: number;
  /** Why nothing was resolved, when nothing was. */
  failure: {
    code: string;
    label: string;
    message: string;
    candidates?: string[];
  } | null;
  linkId: number | null;
}

/** Map a billing family onto the catalogue type the resolver expects. */
export function serviceTypeForCharge(request: {
  family?: BillingFamily;
  sourceType?: string;
}): CatalogueServiceType {
  switch (request.family) {
    case 'LABORATORY':
      return 'LAB_TEST';
    case 'CONSULTATION':
      return 'CONSULTATION';
    case 'RADIOLOGY':
      return 'RADIOLOGY';
    case 'PROCEDURE':
      return 'PROCEDURE';
    case 'PHARMACY':
      return 'PHARMACY';
    case 'ADMISSION':
      return 'ADMISSION';
    case 'BED_DAY':
      return 'BED_DAY';
    case 'DELIVERY':
      return 'DELIVERY';
    default:
      break;
  }

  switch (request.sourceType) {
    case 'LAB_ORDER':
      return 'LAB_TEST';
    case 'RADIOLOGY':
      return 'RADIOLOGY';
    case 'PROCEDURE':
      return 'PROCEDURE';
    case 'PHARMACY':
      return 'PHARMACY';
    case 'ADMISSION':
      return 'ADMISSION';
    case 'BED_DAY':
      return 'BED_DAY';
    case 'MATERNITY':
      return 'DELIVERY';
    default:
      return 'CONSULTATION';
  }
}

/**
 * Resolve a charge to one of this facility's tariffs.
 *
 * The ladder — LINK → FAMILY_LINK → ALIAS → CODE → CATALOGUE — lives in
 * `tariff-resolver.ts`, which also validates activity, effective dates,
 * facility ownership and the unit of charge. This function only adapts
 * the charge request to it, so there is one resolver, not two.
 */
export async function resolveTariffForCharge(
  executor: Executor,
  request: {
    facilityId: number;
    codes: readonly string[];
    serviceKeys?: readonly string[];
    family?: BillingFamily;
    serviceName?: string | null;
    encounterType?: string | null;
    aliases?: readonly string[];
    wardType?: string | null;
    wardName?: string | null;
    /** The catalogue record being billed, when there is one. */
    serviceType?: CatalogueServiceType;
    serviceId?: number | null;
  },
): Promise<ChargeMatch> {
  const serviceType =
    request.serviceType ??
    serviceTypeForCharge({ family: request.family });

  const phrases = request.family
    ? phrasesForCharge({
        family: request.family,
        serviceName: request.serviceName ?? null,
        encounterType: request.encounterType ?? null,
        aliases: request.aliases ?? [],
        wardType: request.wardType ?? null,
        wardName: request.wardName ?? null,
      })
    : [];

  const resolution = await resolveServiceTariff(executor, {
    facilityId: request.facilityId,
    serviceType,
    serviceId: request.serviceId ?? null,
    serviceName: request.serviceName ?? null,
    codes: request.codes,
    serviceKeys: request.serviceKeys ?? [],
    family: request.family,
    phrases,
    wardType: request.wardType ?? null,
  });

  const tariff = resolution.tariff;

  return {
    tariff: tariff
      ? {
          id: tariff.id,
          code: tariff.code,
          description: tariff.description,
          fee: tariff.fee,
          unit: tariff.unit,
        }
      : null,
    rule: resolution.rule,
    explanation: tariff
      ? resolution.rule === 'LINK'
        ? `linked to this service (${tariff.code})`
        : resolution.rule === 'FAMILY_LINK'
          ? `linked to all ${serviceType.toLowerCase()} charges (${tariff.code})`
          : resolution.rule === 'ALIAS'
            ? `approved alias for this charge (${tariff.code})`
            : resolution.rule === 'CODE'
              ? `matched by code ${tariff.code}`
              : `matched on the description “${tariff.description}”`
      : (resolution.failure?.message ?? 'no tariff matched'),
    ...(resolution.failure?.code === 'AMBIGUOUS' && resolution.failure.candidates
      ? {
          ambiguity: {
            phrase: phrases[0] ?? '',
            codes: resolution.failure.candidates,
          },
        }
      : {}),
    codesTried: resolution.codesTried,
    phrasesTried: resolution.phrasesTried,
    candidateCount: resolution.rows.length,
    failure: resolution.failure
      ? {
          code: resolution.failure.code,
          label: failureLabel(resolution.failure.code),
          message: resolution.failure.message,
          ...(resolution.failure.candidates
            ? { candidates: resolution.failure.candidates }
            : {}),
        }
      : null,
    linkId: resolution.linkId,
  };
}

/**
 * Every tariff in the facility, active or not, with a verdict.
 *
 * Used by the configuration screen to answer "why was this visit not
 * billed?": the rows are the facility's own, so the answer names their
 * codes and their descriptions rather than codes the engine invented.
 */
export async function explainFacilityTariffMatch(
  executor: Executor,
  input: {
    facilityId: number;
    family: BillingFamily;
    code?: string | null;
    name?: string | null;
    wardCode?: string | null;
    encounterType?: string | null;
    serviceKeys?: readonly string[];
    codes?: readonly string[];
  },
): Promise<{
  codes: string[];
  phrases: string[];
  linkedKeys: string[];
  outcome: MatchOutcome<{
    id: number;
    code: string;
    description: string;
    fee: string;
    unit: string;
    department: string | null;
    billingKey: string | null;
    isActive: boolean;
  }>;
  rows: Array<{
    id: number;
    code: string;
    description: string;
    fee: string;
    unit: string;
    department: string | null;
    billingKey: string | null;
    isActive: boolean;
    verdict: string;
    note: string;
  }>;
}> {
  const base = {
    id: schema.facilityServiceTariffs.id,
    code: schema.facilityServiceTariffs.code,
    description: schema.facilityServiceTariffs.description,
    fee: schema.facilityServiceTariffs.fee,
    unit: schema.facilityServiceTariffs.unit,
    department: schema.facilityServiceTariffs.department,
    isActive: schema.facilityServiceTariffs.isActive,
  };

  interface ExplainedTariffRow {
    id: number;
    code: string;
    description: string;
    fee: string;
    unit: string;
    department: string | null;
    billingKey: string | null;
    isActive: boolean;
  }

  let rows: ExplainedTariffRow[];

  try {
    rows = await executor
      .select({ ...base, billingKey: schema.facilityServiceTariffs.billingKey })
      .from(schema.facilityServiceTariffs)
      .where(eq(schema.facilityServiceTariffs.facilityId, input.facilityId));
  } catch (error) {
    if (!isMissingBillingKeyColumn(error)) throw error;

    const fallback = await executor
      .select(base)
      .from(schema.facilityServiceTariffs)
      .where(eq(schema.facilityServiceTariffs.facilityId, input.facilityId));

    rows = fallback.map((row) => ({ ...row, billingKey: null }));
  }

  const codes =
    input.codes && input.codes.length > 0
      ? [...input.codes]
      : codesForFamily({
          family: input.family,
          code: input.code ?? null,
          name: input.name ?? null,
          wardCode: input.wardCode ?? null,
          encounterType: input.encounterType ?? null,
        });

  const linkedKeys =
    input.serviceKeys && input.serviceKeys.length > 0
      ? [...input.serviceKeys]
      : [input.family];

  const phrases = phrasesForCharge({
    family: input.family,
    serviceName: input.name ?? null,
    encounterType: input.encounterType ?? null,
    aliases: input.code ? [input.code] : [],
  });

  const explanation = explainMatch({
    rows,
    codes,
    serviceKeys: linkedKeys,
    family: input.family,
    phrases,
  });

  return {
    codes,
    phrases,
    linkedKeys,
    outcome: explanation.outcome,
    rows: explanation.rows.map((entry) => ({
      ...entry.tariff,
      verdict: entry.verdict,
      note: entry.note,
    })),
  };
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
  const match = await resolveTariffForCharge(executor, { facilityId, codes });

  return match.tariff;
}

/**
 * Choose a tariff from already-fetched rows.
 *
 * Split out of `resolveTariff` so the rule can be tested without a
 * database — the ordering is the part that bites: `OPD-CONSULT` must be
 * preferred over `CONSULT` even when the rows arrive in another order,
 * and a row typed `opd-consult` must not be invisible.
 *
 * Exact case wins within one priority; otherwise case is ignored.
 */
export function pickTariffForCodes<T extends { code: string }>(
  rows: readonly T[],
  codes: readonly string[],
): T | null {
  const candidates = codes
    .map((code) => code?.trim())
    .filter((code): code is string => Boolean(code));

  if (candidates.length === 0 || rows.length === 0) return null;

  for (const candidate of candidates) {
    const exact = rows.find((row) => row.code.trim() === candidate);

    if (exact) return exact;
  }

  for (const candidate of candidates) {
    const upper = candidate.toUpperCase();
    const match = rows.find(
      (row) => row.code.trim().toUpperCase() === upper,
    );

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

  /*
   * Money beyond the total is patient credit, not a negative balance.
   * balanceAmount stays at zero so the facility-wide outstanding figure
   * cannot be quietly reduced by one patient's overpayment.
   */
  const creditCents = Math.max(0, paidCents - totalCents);

  /* A voided invoice keeps its status and must not be resurrected. */
  const status =
    invoice.status === 'Void'
      ? 'Void'
      : totalCents > 0 && paidCents > totalCents
        ? 'Overpaid'
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
      creditBalance: fromCents(creditCents),
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

  /*
   * LINK → CODE → CATALOGUE.
   *
   * The link is the facility's own statement and wins outright. Code
   * matching is unchanged, so anything that billed before still bills.
   * The catalogue rule only runs when the caller says which service
   * this is (`family`), and only accepts a tariff whose own description
   * names that service inside the right department — and only when
   * exactly one does. Two candidates is an ambiguity to report, not a
   * coin to flip.
   */
  const match = await resolveTariffForCharge(executor, {
    facilityId: request.facilityId,
    codes: request.codes,
    serviceKeys: request.serviceKeys,
    family: request.family,
    serviceName: request.serviceName,
    encounterType: request.encounterType,
    aliases: request.aliases,
    wardType: request.wardType,
    wardName: request.wardName,
    ...(request.serviceRef
      ? { serviceType: request.serviceRef.type, serviceId: request.serviceRef.id }
      : {}),
  });

  const tariff = match.tariff;

  const unitPriceCents = tariff
    ? toCents(tariff.fee)
    : toCents(request.fallbackUnitPrice);

  if (unitPriceCents <= 0) {
    return {
      charged: false,
      reason: 'TARIFF_NOT_CONFIGURED',
      codesTried: match.codesTried,
      matchExplanation: match.explanation,
      ...(match.failure
        ? {
            diagnosis: {
              code: match.failure.code,
              label: match.failure.label,
              ...(match.failure.candidates
                ? { candidates: match.failure.candidates }
                : {}),
            },
          }
        : {}),
      /*
       * The resolver's own sentence. It names the row that was found and
       * why it was refused — inactive, expired, another facility's,
       * excluded from automatic billing, wrong unit, ambiguous — instead
       * of the single "no active tariff matched" that made all six
       * indistinguishable.
       */
      message: `${
        match.failure?.message ??
        `No active tariff matched ${summariseCodes(request.codes)} for this facility.`
      } The service was recorded but not billed, and it is listed under Configuration → Services & Tariffs → “Charges that could not be priced” so it can be billed once the price is set.`,
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
    unit: tariff?.unit ?? null,
    unitPrice: fromCents(unitPriceCents),
    totalAmount: fromCents(totalCents),
    matchRule: match.rule ?? undefined,
    matchExplanation: match.explanation,
    codesTried: match.codesTried,
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

/** A ward as the bed-day engine needs to see it. */
export interface BedDayWard {
  id: number;
  code?: string | null;
  name?: string | null;
  wardType?: string | null;
}

/** One move between wards, as recorded on the transfer. */
export interface BedDayTransfer {
  toWardId: number;
  /** Departure ward. The earliest transfer names the admission ward. */
  fromWardId?: number | null;
  /** Arrival time; any timestamp `parseLooseDate` understands. */
  transferredAt: Date | string;
  /** The ward moved to, when the caller loaded it. */
  ward?: BedDayWard | null;
  /** The ward moved from, when the caller loaded it. */
  fromWard?: BedDayWard | null;
}

export interface BedDaySegment {
  ward: BedDayWard | null;
  dates: string[];
}

/**
 * Split a stay into one segment per occupied ward.
 *
 * A patient who moves from General to ICU occupies the General bed for
 * the nights before the move and the ICU bed from the night of the
 * move. Pricing the whole stay at whichever ward they happen to be in
 * today is how a general rate ends up paying for ICU nights, and how two
 * wards end up competing for the same date.
 *
 * The rules:
 *
 *   - Every date between admission and discharge (inclusive, the
 *     existing rule — a same-day stay is one day) belongs to exactly
 *     one segment. Transfers neither overlap nor leave a gap, so the
 *     total number of bed-days is unchanged by this split.
 *   - A transfer takes effect on its local calendar date: that date's
 *     bed is the one the patient moved into.
 *   - A segment whose start and end are the same date has no nights of
 *     its own; two transfers on one day leave the last ward holding it.
 *   - Transfers are ignored outside the billed period, so a nightly job
 *     running to yesterday is unaffected by this morning's transfer.
 *   - The opening ward is the earliest transfer's `fromWard`, falling
 *     back to the admission's current ward when there is no transfer
 *     history to say otherwise.
 *
 * Pure: no database, no clock except the one `bedDayDates` already uses.
 */
export function bedDaySegments(input: {
  admissionDate: string;
  dischargeDate?: string | null;
  /** Stop at this date instead of discharge/today, for a partial run. */
  untilDate?: string | null;
  homeWard?: BedDayWard | null;
  transfers?: readonly BedDayTransfer[];
}): BedDaySegment[] {
  const admitted = parseLooseDate(input.admissionDate);

  if (!admitted) return [];

  /*
   * Never bill past the discharge, even when a nightly job is asked to
   * run to a later date: the stay ended.
   */
  const candidates = [input.dischargeDate, input.untilDate]
    .map((value) => (value ? parseLooseDate(value) : null))
    .filter((value): value is Date => value !== null);

  const end =
    candidates.length > 0
      ? new Date(Math.min(...candidates.map((value) => value.getTime())))
      : null;

  const dates = bedDayDates(
    input.admissionDate,
    end ? formatDateKey(end) : null,
  );

  const transfers = (input.transfers ?? [])
    .map((transfer) => {
      const at =
        transfer.transferredAt instanceof Date
          ? transfer.transferredAt
          : parseLooseDate(transfer.transferredAt);

      return at ? { date: formatDateKey(at), transfer } : null;
    })
    .filter((entry): entry is { date: string; transfer: BedDayTransfer } => entry !== null)
    /* Stable order: two transfers on one day must keep their record order. */
    .sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));

  const segments: BedDaySegment[] = [];
  /*
   * `admissions.ward_id` is the ward the patient is in *now*, not the one
   * they were admitted to. The earliest transfer records where they came
   * from, so that is the opening ward. Without this the first nights of a
   * transferred stay would be re-priced at the destination — the very
   * bug this split exists to remove.
   */
  let ward = transfers[0]?.transfer.fromWard ?? input.homeWard ?? null;
  let bucket: string[] = [];
  let index = 0;

  for (const entry of transfers) {
    while (index < dates.length && dates[index] < entry.date) {
      bucket.push(dates[index]);
      index += 1;
    }

    if (bucket.length > 0) {
      segments.push({ ward, dates: bucket });
      bucket = [];
    }

    ward = entry.transfer.ward ?? ward;
  }

  while (index < dates.length) {
    bucket.push(dates[index]);
    index += 1;
  }

  if (bucket.length > 0) segments.push({ ward, dates: bucket });

  return segments;
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
 * Optional reporting window, applied to the invoice's creation date.
 *
 * Both bounds are inclusive at day resolution: `to` is widened to the
 * last millisecond of that day, so a report for "1st to 31st" does not
 * silently drop everything invoiced after midnight on the 31st.
 */
export interface RevenueRange {
  from?: Date | null;
  to?: Date | null;
}

function invoiceRangeConditions(range?: RevenueRange) {
  const conditions = [];

  if (range?.from) {
    conditions.push(gte(schema.billingInvoices.createdAt, range.from));
  }

  if (range?.to) {
    const end = new Date(range.to.getTime());
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(schema.billingInvoices.createdAt, end));
  }

  return conditions;
}

/**
 * Revenue grouped by service category for one facility.
 * Used by the analytics dashboard and the revenue report.
 *
 * Voided invoices are excluded so the figures reconcile to cash.
 */
export async function getRevenueByServiceType(
  executor: Executor,
  facilityId: number,
  range?: RevenueRange,
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
        ...invoiceRangeConditions(range),
      ),
    )
    .groupBy(schema.billingItems.itemType, schema.billingItems.sourceType);

  return rows as RevenueSummaryRow[];
}

export interface RevenueTotals {
  invoiceCount: number;
  voidedCount: number;
  invoiced: string;
  collected: string;
  outstanding: string;
}

export interface RevenueChannelRow {
  channel: PaymentChannel;
  label: string;
  paymentCount: number;
  /** Money posted through this channel, as a numeric(10,2) string. */
  amount: string;
}

export interface RevenueChannelSplit {
  channels: RevenueChannelRow[];
  /** Stored method names that did not map to a known channel. */
  unmappedMethods: string[];
  /** Total across every channel, integer cents. */
  totalCents: number;
}

/**
 * Money received, split by payment channel.
 *
 * The window is the invoice's creation date — the same window
 * `getRevenueTotals` uses — so the channel lines add up to `collected`
 * for the same period instead of describing a different set of
 * invoices. Payments are attached through the invoice, never read
 * unscoped: a payment row has no facility column of its own.
 *
 * A voided invoice is excluded exactly as it is in the totals.
 */
export async function getRevenueByPaymentChannel(
  executor: Executor,
  facilityId: number,
  range?: RevenueRange,
): Promise<RevenueChannelSplit> {
  const rows = await executor
    .select({
      method: schema.billingPayments.paymentMethod,
      paymentCount: sql<number>`COUNT(*)::int`,
      amount: sql<string>`COALESCE(SUM(${schema.billingPayments.amount}), 0)`,
    })
    .from(schema.billingPayments)
    .innerJoin(
      schema.billingInvoices,
      eq(schema.billingPayments.invoiceId, schema.billingInvoices.id),
    )
    .where(
      and(
        eq(schema.billingInvoices.facilityId, facilityId),
        isNull(schema.billingInvoices.voidedAt),
        ...invoiceRangeConditions(range),
      ),
    )
    .groupBy(schema.billingPayments.paymentMethod);

  const totals = new Map<PaymentChannel, { paymentCount: number; cents: number }>();
  const unmapped = new Set<string>();

  for (const channel of PAYMENT_CHANNELS) {
    totals.set(channel, { paymentCount: 0, cents: 0 });
  }

  for (const row of rows) {
    const channel = paymentChannel(row.method);
    const bucket = totals.get(channel);

    if (!bucket) continue;

    bucket.paymentCount += Number(row.paymentCount ?? 0);
    bucket.cents += toCents(row.amount);

    if (channel === 'OTHER' && row.method) {
      unmapped.add(row.method);
    }
  }

  const channels: RevenueChannelRow[] = PAYMENT_CHANNELS.map((channel) => {
    const bucket = totals.get(channel) ?? { paymentCount: 0, cents: 0 };

    return {
      channel,
      label: PAYMENT_CHANNEL_LABELS[channel],
      paymentCount: bucket.paymentCount,
      amount: fromCents(bucket.cents),
    };
  });

  return {
    channels,
    unmappedMethods: Array.from(unmapped).sort(),
    totalCents: channels.reduce(
      (sum, channel) => sum + toCents(channel.amount),
      0,
    ),
  };
}

/**
 * Cash position for one facility over the same window.
 *
 * `invoiced` is what was billed, `collected` is paid_amount on those
 * invoices and `outstanding` is balance_amount. Voided invoices are
 * counted separately and left out of all three figures.
 */
export async function getRevenueTotals(
  executor: Executor,
  facilityId: number,
  range?: RevenueRange,
): Promise<RevenueTotals> {
  const rows = await executor
    .select({
      invoiceCount: sql<number>`COUNT(*) FILTER (WHERE ${schema.billingInvoices.voidedAt} IS NULL)::int`,
      voidedCount: sql<number>`COUNT(*) FILTER (WHERE ${schema.billingInvoices.voidedAt} IS NOT NULL)::int`,
      invoiced: sql<string>`COALESCE(SUM(${schema.billingInvoices.totalAmount}) FILTER (WHERE ${schema.billingInvoices.voidedAt} IS NULL), 0)`,
      collected: sql<string>`COALESCE(SUM(${schema.billingInvoices.paidAmount}) FILTER (WHERE ${schema.billingInvoices.voidedAt} IS NULL), 0)`,
      outstanding: sql<string>`COALESCE(SUM(${schema.billingInvoices.balanceAmount}) FILTER (WHERE ${schema.billingInvoices.voidedAt} IS NULL), 0)`,
    })
    .from(schema.billingInvoices)
    .where(
      and(
        eq(schema.billingInvoices.facilityId, facilityId),
        ...invoiceRangeConditions(range),
      ),
    );

  const row = rows[0];

  return {
    invoiceCount: Number(row?.invoiceCount ?? 0),
    voidedCount: Number(row?.voidedCount ?? 0),
    invoiced: String(row?.invoiced ?? '0'),
    collected: String(row?.collected ?? '0'),
    outstanding: String(row?.outstanding ?? '0'),
  };
}
