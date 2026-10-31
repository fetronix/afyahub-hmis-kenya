/**
 * JaliCare HMIS
 * Charge attempts — the queue of money that was not billed
 *
 * When the engine cannot price a charge it skips it. The visit, the lab
 * order or the admission is still recorded, which is right: a missing
 * tariff must never stop clinical care. But the skip used to be returned
 * to the caller, shown once, and forgotten. Nobody could answer "what
 * have we done today that we did not bill?" and nothing could be billed
 * after the price list was fixed.
 *
 * This module keeps that record. One row per unpriceable charge, holding
 * the original request, and a retry that runs through the *ordinary*
 * charge path so the ordinary idempotency key still applies. Retrying
 * twice cannot produce two invoice lines.
 *
 * Migration 0020 creates the table. A database one migration behind
 * still bills; it just cannot remember what it failed to bill, and the
 * app says so rather than failing.
 */

import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';

import * as schema from '../db/schema.ts';
import { isCatalogueServiceType } from './tariff-resolver.ts';
import {
  buildIdempotencyKey,
  chargeForService,
  type ChargeRequest,
  type ChargeResult,
} from './billing.service.ts';

/** Anything that can run a query: the pool, a transaction, a test double. */
type Executor = any;

function postgresCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const value = current as { code?: unknown; cause?: unknown };
    if (typeof value.code === 'string') return value.code;
    current = value.cause;
  }
  return undefined;
}

let warnedMissingAttemptsTable = false;

/**
 * Does this database have migration 0022, which stores the bed-night
 * identity (date, bed category)? Starts true and is turned off the first
 * time the database says the column is missing, so a facility that ran
 * 0020 and 0021 but not yet 0022 still records its skipped charges —
 * degraded to one row per stay, never silently dropped.
 */
let supportsBedNightIdentity = true;

/** True when the database predates migration 0020. */
export function isMissingAttemptsTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const code = postgresCode(error);

  return code === '42P01' || code === '42703';
}

/**
 * Persist a skipped charge so it can be replayed later.
 *
 * A repeat skip on the same clinical source does not add a second row to
 * chase — it bumps the existing one, so the screen shows "this encounter
 * tried to bill twice and still cannot" rather than two identical lines.
 *
 * Returns the row id, or null when the table does not exist yet or the
 * write failed. Recording is never allowed to break the clinical action
 * that already succeeded.
 */
export async function recordChargeAttempt(
  executor: Executor,
  request: ChargeRequest,
  result: ChargeResult,
): Promise<number | null> {
  if (result.charged) return null;

  /*
   * A duplicate is not money owed: the line exists. A closed invoice is
   * an operator problem, not a missing tariff. Only the "we could not
   * price this" case belongs in the queue.
   */
  if (result.reason !== 'TARIFF_NOT_CONFIGURED') return null;

  /*
   * Without a numbered clinical source there is no stable identity for
   * the charge: replaying it could not tell "the same unpaid visit" from
   * "a second identical one". Manual charges keep their own path.
   */
  if (typeof request.sourceId !== 'number' || !Number.isSafeInteger(request.sourceId)) {
    return null;
  }

  const quantity =
    Number.isSafeInteger(request.quantity) && (request.quantity ?? 0) > 0
      ? Number(request.quantity)
      : 1;

  const baseValues = {
    tenantId: request.tenantId,
    facilityId: request.facilityId,
    patientId: request.patientId,
    encounterId: typeof request.encounterId === 'number' ? request.encounterId : null,
    sourceType: request.sourceType,
    sourceId: request.sourceId,
    itemType: request.itemType,
    description: request.description ?? request.fallbackDescription ?? null,
    codes: [...(request.codes ?? [])],
    serviceKeys: [...(request.serviceKeys ?? [])],
    family: request.family ?? null,
    serviceName: request.serviceName ?? null,
    encounterType: request.encounterType ?? null,
    aliases: [...(request.aliases ?? [])],
    serviceRefType: request.serviceRef?.type ?? null,
    serviceRefId: request.serviceRef?.id ?? null,
    serviceRefCode: request.serviceRef?.code ?? null,
    serviceDate:
      request.serviceDate ??
      (request.sourceType === 'BED_DAY' ? (request.idempotencySuffix ?? null) : null),
    quantity,
    fallbackUnitPrice: request.fallbackUnitPrice == null ? null : String(request.fallbackUnitPrice),
    reason: result.reason,
    detail: result.message ?? null,
    codesTried: [...(result.codesTried ?? request.codes ?? [])],
    status: 'PENDING' as const,
    attempts: 1,
    lastAttemptAt: new Date(),
    updatedAt: new Date(),
  };

  /*
   * The occurrence of the source: a bed-night date, and the bed category
   * it was accrued in. Part of the row's identity, and replayed into the
   * ordinary idempotency key — a retry bills the same night, at the same
   * kind of bed, or not at all.
   */
  const suffix =
    supportsBedNightIdentity && request.idempotencySuffix ? request.idempotencySuffix : null;

  const nightIdentity = supportsBedNightIdentity
    ? {
        idempotencySuffix: suffix,
        wardType: request.wardType ?? null,
        wardName: request.wardName ?? null,
      }
    : {};

  const values = { ...baseValues, ...nightIdentity };

  const existingWhere = and(
    eq(schema.billingChargeAttempts.facilityId, values.facilityId),
    eq(schema.billingChargeAttempts.sourceType, values.sourceType),
    eq(schema.billingChargeAttempts.sourceId, values.sourceId),
    eq(schema.billingChargeAttempts.itemType, values.itemType),
    ...(supportsBedNightIdentity
      ? [
          suffix === null
            ? isNull(schema.billingChargeAttempts.idempotencySuffix)
            : eq(schema.billingChargeAttempts.idempotencySuffix, suffix),
        ]
      : []),
    eq(schema.billingChargeAttempts.status, 'PENDING'),
  );

  /*
   * Read, then write.
   *
   * The partial unique index guarantees at most one open attempt per
   * clinical source, but relying on `ON CONFLICT` inference against a
   * partial index is a subtlety a deployed database can reject — and a
   * silently unrecorded skip is the failure this table exists to stop.
   * An explicit lookup is two statements and no inference.
   */
  const bumpExisting = async (id: number): Promise<number> => {
    await executor
      .update(schema.billingChargeAttempts)
      .set({
        attempts: sql`${schema.billingChargeAttempts.attempts} + 1`,
        lastAttemptAt: new Date(),
        updatedAt: new Date(),
        reason: values.reason,
        detail: values.detail,
        codesTried: values.codesTried,
        quantity: values.quantity,
        ...(supportsBedNightIdentity
          ? {
              wardType: request.wardType ?? null,
              wardName: request.wardName ?? null,
            }
          : {}),
      })
      .where(eq(schema.billingChargeAttempts.id, id));

    return id;
  };

  try {
    const [existing] = await executor
      .select({ id: schema.billingChargeAttempts.id })
      .from(schema.billingChargeAttempts)
      .where(existingWhere)
      .limit(1);

    if (existing) return await bumpExisting(existing.id);

    try {
      const rows = await executor
        .insert(schema.billingChargeAttempts)
        .values(values)
        .returning({ id: schema.billingChargeAttempts.id });

      return rows[0]?.id ?? null;
    } catch (insertError: unknown) {
      /*
       * Two attempts on the same encounter at the same moment: one wins
       * the insert, the other becomes the bump.
       */
      if (postgresCode(insertError) === '23505') {
        const [winner] = await executor
          .select({ id: schema.billingChargeAttempts.id })
          .from(schema.billingChargeAttempts)
          .where(existingWhere)
          .limit(1);

        if (winner) return await bumpExisting(winner.id);
      }

      throw insertError;
    }
  } catch (error: unknown) {
    /*
     * The table exists but migration 0022 has not run: retry once
     * without the bed-night columns, so the queue keeps working while
     * the administrator applies the migration.
     */
    if (postgresCode(error) === '42703' && supportsBedNightIdentity) {
      supportsBedNightIdentity = false;

      console.warn(
        'Billing: billing_charge_attempts has no bed-night identity columns. Run `npm run db:migrate` (migration 0022) so each unbilled night can be reprocessed separately. Recording the skip without it for now.',
      );

      return recordChargeAttempt(executor, request, result);
    }

    if (isMissingAttemptsTable(error)) {
      if (!warnedMissingAttemptsTable) {
        warnedMissingAttemptsTable = true;

        console.warn(
          'Billing: billing_charge_attempts is missing. Run `npm run db:migrate` (migration 0020) to record charges that could not be priced. The charge was still skipped safely.',
        );
      }

      return null;
    }

    console.error('Billing: could not record a skipped charge; manual reconciliation is required.');

    return null;
  }
}

/**
 * Price a charge, and remember it if it could not be priced.
 *
 * Every clinical screen goes through here rather than calling
 * `chargeForService` directly, so "the visit was recorded but not
 * billed" always leaves a row behind that somebody can act on.
 *
 * Billing still never breaks clinical care: a fault in the engine is
 * reported in the result, not thrown at the route.
 */
/**
 * All ordinary charges, queue retries and write-offs acquire this lock before
 * locking queue rows or invoice/patient rows. It also covers the no-row-yet
 * case: a pending attempt cannot be inserted between a direct replay's check
 * and its charge. The key is the SAME identity used by billing_items.
 */
export async function lockChargeIdentity(
  executor: Executor,
  facilityId: number,
  sourceType: ChargeRequest['sourceType'],
  sourceId: number | string,
  idempotencySuffix?: string | null,
): Promise<void> {
  const key = buildIdempotencyKey({
    sourceType,
    sourceId,
    idempotencySuffix: idempotencySuffix || undefined,
  });
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-charge:${facilityId}:${key}`}, 0))`,
  );
}

function attemptIdentityWhere(request: ChargeRequest) {
  const suffix = request.idempotencySuffix || null;
  return and(
    eq(schema.billingChargeAttempts.tenantId, request.tenantId),
    eq(schema.billingChargeAttempts.facilityId, request.facilityId),
    eq(schema.billingChargeAttempts.sourceType, request.sourceType),
    eq(schema.billingChargeAttempts.sourceId, request.sourceId as number),
    suffix === null
      ? or(
          isNull(schema.billingChargeAttempts.idempotencySuffix),
          eq(schema.billingChargeAttempts.idempotencySuffix, ''),
        )
      : eq(schema.billingChargeAttempts.idempotencySuffix, suffix),
  );
}

const chargeReviewRequired = (): ChargeResult => ({
  charged: false,
  reason: 'INVALID_INPUT',
  message: 'The service was recorded but billing needs manual reconciliation.',
});

export async function chargeAndRecord(
  executor: Executor,
  request: ChargeRequest,
): Promise<ChargeResult> {
  try {
    return await executor.transaction(async (tx: Executor) => {
      await lockChargeIdentity(
        tx,
        request.facilityId,
        request.sourceType,
        request.sourceId,
        request.idempotencySuffix,
      );

      // The queue only accepts numeric clinical source identities. String
      // identities still use the normal billing-item uniqueness guard.
      const attempts: ChargeAttemptRow[] =
        typeof request.sourceId === 'number' && Number.isSafeInteger(request.sourceId)
          ? await tx
              .select()
              .from(schema.billingChargeAttempts)
              .where(attemptIdentityWhere(request))
              .for('update')
          : [];
      if (
        attempts.some(
          (row) => row.patientId !== request.patientId || row.itemType !== request.itemType,
        )
      ) {
        return chargeReviewRequired();
      }
      if (attempts.some((row) => row.status === 'VOID')) {
        return {
          charged: false,
          reason: 'ATTEMPT_VOIDED',
          message: 'This unpriced charge was written off and cannot be billed by replay.',
        };
      }

      const resolved = attempts.filter((row) => ['BILLED', 'DUPLICATE'].includes(row.status));
      if (resolved.length) {
        // Historic queue status by itself does not prove a line exists.
        const [line] = await tx
          .select({
            itemId: schema.billingItems.id,
            invoiceId: schema.billingInvoices.id,
            invoiceNumber: schema.billingInvoices.invoiceNumber,
            tenantId: schema.billingInvoices.tenantId,
            facilityId: schema.billingInvoices.facilityId,
            patientId: schema.billingInvoices.patientId,
          })
          .from(schema.billingItems)
          .innerJoin(
            schema.billingInvoices,
            eq(schema.billingItems.invoiceId, schema.billingInvoices.id),
          )
          .where(eq(schema.billingItems.idempotencyKey, buildIdempotencyKey(request)))
          .limit(1);
        if (
          !line ||
          line.tenantId !== request.tenantId ||
          line.facilityId !== request.facilityId ||
          line.patientId !== request.patientId ||
          resolved.some(
            (row) =>
              (row.resolvedItemId != null && row.resolvedItemId !== line.itemId) ||
              (row.resolvedInvoiceId != null && row.resolvedInvoiceId !== line.invoiceId),
          )
        ) {
          return chargeReviewRequired();
        }
        return {
          charged: false,
          reason: 'DUPLICATE',
          itemId: line.itemId,
          invoiceId: line.invoiceId,
          invoiceNumber: line.invoiceNumber,
          message:
            'This service already has a charge record; review its invoice before any correction.',
        };
      }
      const pending = attempts.filter((row) => row.status === 'PENDING');
      if (pending.length > 1 || attempts.length !== pending.length) return chargeReviewRequired();
      if (
        pending[0] &&
        request.sourceType === 'BED_DAY' &&
        (pending[0].serviceRefId !== (request.serviceRef?.id ?? null) ||
          pending[0].serviceDate !== (request.serviceDate ?? request.idempotencySuffix ?? null))
      ) {
        return {
          charged: false,
          reason: 'INVALID_INPUT',
          message:
            'The recorded bed-day identity differs from the replay. Review the occupancy and pending attempt before billing.',
        };
      }

      let result: ChargeResult = await chargeForService(tx, request);
      const verifiedDuplicate =
        result.reason === 'DUPLICATE' && result.itemId != null && result.invoiceId != null;
      if (result.reason === 'DUPLICATE' && !verifiedDuplicate) result = chargeReviewRequired();

      if (pending[0] && (result.charged || verifiedDuplicate)) {
        await tx
          .update(schema.billingChargeAttempts)
          .set({
            status: result.charged ? 'BILLED' : 'DUPLICATE',
            attempts: sql`${schema.billingChargeAttempts.attempts} + 1`,
            lastAttemptAt: new Date(),
            updatedAt: new Date(),
            resolvedAt: new Date(),
            resolvedItemId: result.itemId ?? null,
            resolvedInvoiceId: result.invoiceId ?? null,
            resolvedTariffCode: result.tariffCode ?? null,
            resolvedUnitPrice: result.unitPrice ?? null,
            detail: result.charged
              ? 'Billed during a replay of the clinical event.'
              : result.message,
          })
          .where(eq(schema.billingChargeAttempts.id, pending[0].id));
        await tx.insert(schema.auditLogs).values({
          tenantId: request.tenantId,
          facilityId: request.facilityId,
          userId: 'SYSTEM',
          action: 'UPDATE',
          resource: 'BillingChargeAttempt',
          resourceId: String(pending[0].id),
          details: 'Charge attempt resolved by replay of the clinical event.',
        });
      } else if (!result.charged && result.reason === 'TARIFF_NOT_CONFIGURED') {
        const attemptId = await recordChargeAttempt(tx, request, result);
        if (attemptId === null) {
          result = {
            ...result,
            message:
              'The service was recorded but not billed. The unpriced charge could not be recorded in the retry queue; manual reconciliation is required.',
          };
        }
      }
      return result;
    });
  } catch {
    console.error('Billing charge failed; manual reconciliation is required.');
    return chargeReviewRequired();
  }
}

export interface ChargeAttemptRow {
  id: number;
  patientId: number;
  facilityId: number;
  encounterId: number | null;
  sourceType: string;
  sourceId: number | null;
  itemType: string;
  description: string | null;
  codes: string[];
  serviceKeys: string[];
  family: string | null;
  serviceName: string | null;
  encounterType: string | null;
  aliases: string[];
  /** The occurrence of the source (a bed-night date), when it has one. */
  idempotencySuffix: string | null;
  /** Bed category and ward at accrual time, for a bed-night. */
  wardType: string | null;
  wardName: string | null;
  serviceRefType?: string | null;
  serviceRefId?: number | null;
  serviceRefCode?: string | null;
  serviceDate?: string | null;
  quantity: number;
  fallbackUnitPrice: string | null;
  reason: string;
  detail: string | null;
  codesTried: string[];
  status: string;
  attempts: number;
  lastAttemptAt: Date;
  resolvedItemId: number | null;
  resolvedInvoiceId: number | null;
  resolvedTariffCode: string | null;
  resolvedUnitPrice: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

/**
 * The queue for one facility.
 *
 * Pending first (most recent first), then resolved, so the screen opens
 * on the work that still needs doing.
 */
export async function listChargeAttempts(
  executor: Executor,
  input: {
    tenantId: number;
    facilityId: number;
    status?: string | null;
    limit?: number;
  },
): Promise<ChargeAttemptRow[]> {
  const limit =
    Number.isSafeInteger(input.limit) && (input.limit ?? 0) > 0
      ? Math.min(Number(input.limit), 200)
      : 50;

  try {
    const where = input.status
      ? and(
          eq(schema.billingChargeAttempts.tenantId, input.tenantId),
          eq(schema.billingChargeAttempts.facilityId, input.facilityId),
          eq(schema.billingChargeAttempts.status, input.status),
        )
      : and(
          eq(schema.billingChargeAttempts.tenantId, input.tenantId),
          eq(schema.billingChargeAttempts.facilityId, input.facilityId),
        );

    return await executor
      .select()
      .from(schema.billingChargeAttempts)
      .where(where)
      .orderBy(
        asc(sql`case when ${schema.billingChargeAttempts.status} = 'PENDING' then 0 else 1 end`),
        desc(schema.billingChargeAttempts.lastAttemptAt),
      )
      .limit(limit);
  } catch (error: unknown) {
    if (isMissingAttemptsTable(error)) {
      if (!warnedMissingAttemptsTable) {
        warnedMissingAttemptsTable = true;

        console.warn(
          'Billing: billing_charge_attempts is missing. Run `npm run db:migrate` (migration 0020).',
        );
      }

      // An unavailable queue is not evidence that nothing is waiting.
      throw error;
    }

    throw error;
  }
}

/** How much is waiting, for the configuration screen. */
export async function countPendingChargeAttempts(
  executor: Executor,
  input: { tenantId: number; facilityId: number },
): Promise<number> {
  const rows = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.billingChargeAttempts)
    .where(
      and(
        eq(schema.billingChargeAttempts.tenantId, input.tenantId),
        eq(schema.billingChargeAttempts.facilityId, input.facilityId),
        eq(schema.billingChargeAttempts.status, 'PENDING'),
      ),
    );
  if (!rows[0] || typeof rows[0].count !== 'number') {
    throw new Error('CHARGE_ATTEMPT_COUNT_UNAVAILABLE');
  }
  return rows[0].count;
}

/**
 * Rebuild the charge from a stored attempt.
 *
 * Everything the engine needs is on the row, including the identity of
 * the clinical event, so the retry produces the same idempotency key as
 * the original attempt.
 */
export function toChargeRequest(row: ChargeAttemptRow, tenantId: number): ChargeRequest {
  return {
    tenantId,
    facilityId: row.facilityId,
    patientId: row.patientId,
    ...(row.encounterId === null ? {} : { encounterId: row.encounterId }),
    codes: row.codes,
    ...(row.serviceKeys.length > 0 ? { serviceKeys: row.serviceKeys } : {}),
    ...(row.family ? { family: row.family as ChargeRequest['family'] } : {}),
    serviceName: row.serviceName,
    encounterType: row.encounterType,
    ...(row.aliases.length > 0 ? { aliases: row.aliases } : {}),
    sourceType: row.sourceType as ChargeRequest['sourceType'],
    sourceId: row.sourceId as number,
    ...(row.idempotencySuffix ? { idempotencySuffix: row.idempotencySuffix } : {}),
    ...(row.wardType ? { wardType: row.wardType } : {}),
    ...(row.wardName ? { wardName: row.wardName } : {}),
    ...(isCatalogueServiceType(row.serviceRefType)
      ? {
          serviceRef: {
            type: row.serviceRefType,
            id: row.serviceRefId ?? null,
            code: row.serviceRefCode ?? null,
          },
        }
      : {}),
    ...(row.serviceDate ? { serviceDate: row.serviceDate } : {}),
    itemType: row.itemType,
    description: row.description ?? undefined,
    quantity: row.quantity,
    ...(row.fallbackUnitPrice === null ? {} : { fallbackUnitPrice: row.fallbackUnitPrice }),
  };
}

export interface RetryOutcome {
  attemptId: number;
  status: 'BILLED' | 'DUPLICATE' | 'PENDING' | 'VOID';
  result: ChargeResult;
}

/**
 * Re-read the clinical source at retry time.
 *
 * A stored attempt knows *which* laboratory order was billed, not which
 * catalogue row it pointed at — and the catalogue link is the whole
 * point of the retry. Reading it live means:
 *
 *   - a fix to the mapping applies immediately, without rewriting the
 *     queue row;
 *   - the order, its id and its audit trail are untouched: the retry
 *     reads, it never re-creates the clinical record;
 *   - a deleted catalogue row surfaces as "no catalogue row" instead of
 *     a charge against a stale id.
 */
async function enrichFromSource(
  executor: Executor,
  request: ChargeRequest,
): Promise<ChargeRequest> {
  if (request.sourceType === 'PHARMACY') {
    if (typeof request.sourceId !== 'number') throw new Error('CHARGE_SOURCE_REVIEW_REQUIRED');
    const [dispense] = await executor
      .select()
      .from(schema.pharmacyDispensations)
      .where(eq(schema.pharmacyDispensations.id, request.sourceId))
      .limit(1);
    if (
      !dispense ||
      dispense.tenantId !== request.tenantId ||
      dispense.facilityId !== request.facilityId ||
      dispense.patientId !== request.patientId ||
      dispense.quantityDispensed !== request.quantity ||
      !dispense.itemId
    ) {
      throw new Error('CHARGE_SOURCE_REVIEW_REQUIRED');
    }
    const [item] = await executor
      .select({ name: schema.inventoryItems.name })
      .from(schema.inventoryItems)
      .where(
        and(
          eq(schema.inventoryItems.id, dispense.itemId),
          eq(schema.inventoryItems.facilityId, request.facilityId),
        ),
      )
      .limit(1);
    if (!item) throw new Error('CHARGE_SOURCE_REVIEW_REQUIRED');
    let serviceName = item.name;
    let encounterId: number | null = null;
    if (dispense.prescriptionId !== null) {
      const [prescription] = await executor
        .select({
          drugName: schema.medications.drugName,
          encounterId: schema.medications.encounterId,
        })
        .from(schema.medications)
        .innerJoin(schema.encounters, eq(schema.medications.encounterId, schema.encounters.id))
        .where(
          and(
            eq(schema.medications.id, dispense.prescriptionId),
            eq(schema.medications.patientId, request.patientId),
            eq(schema.encounters.patientId, request.patientId),
            eq(schema.encounters.tenantId, request.tenantId),
            eq(schema.encounters.facilityId, request.facilityId),
          ),
        )
        .limit(1);
      if (!prescription) throw new Error('CHARGE_SOURCE_REVIEW_REQUIRED');
      serviceName = prescription.drugName;
      encounterId = prescription.encounterId;
    }
    if (serviceName !== request.serviceName || encounterId !== (request.encounterId ?? null)) {
      // Do not reprice an old source under a changed drug label or encounter.
      throw new Error('CHARGE_SOURCE_REVIEW_REQUIRED');
    }
    return request;
  }
  if (request.sourceType !== 'LAB_ORDER') return request;

  if (typeof request.sourceId !== 'number') throw new Error('CHARGE_SOURCE_REVIEW_REQUIRED');

  try {
    const [order] = await executor
      .select({
        testId: schema.labOrders.testId,
        testName: schema.labOrders.testName,
        facilityId: schema.labOrders.facilityId,
        tenantId: schema.labOrders.tenantId,
        patientId: schema.labOrders.patientId,
      })
      .from(schema.labOrders)
      .where(eq(schema.labOrders.id, request.sourceId))
      .limit(1);

    if (
      !order ||
      order.facilityId !== request.facilityId ||
      order.tenantId !== request.tenantId ||
      order.patientId !== request.patientId
    ) {
      throw new Error('CHARGE_SOURCE_REVIEW_REQUIRED');
    }

    let testCode: string | null = null;

    if (typeof order.testId === 'number' && order.testId > 0) {
      const [test] = await executor
        .select({ code: schema.labTests.code })
        .from(schema.labTests)
        .where(
          and(
            eq(schema.labTests.id, order.testId),
            eq(schema.labTests.facilityId, order.facilityId),
          ),
        )
        .limit(1);

      testCode = test?.code ?? null;
    }

    return {
      ...request,
      serviceName: order.testName,
      ...(testCode ? { aliases: [testCode] } : {}),
      serviceRef: {
        type: 'LAB_TEST',
        id: typeof order.testId === 'number' ? order.testId : null,
        code: testCode,
      },
    };
  } catch (error) {
    // A failed or out-of-scope source read must not fall back to guessed pricing.
    console.error('Billing: could not re-read the laboratory order; retry requires review.');
    throw error;
  }
}

/**
 * Retry one attempt.

 *
 *
 * Runs the ordinary charge path: the link, the code and the description
 * rules all apply, and the idempotency key is the one the original
 * attempt would have used. A second retry of an already-billed attempt
 * therefore reports DUPLICATE and writes no line.
 */
async function lockAttemptIdentity(
  tx: Executor,
  input: { tenantId: number; facilityId: number; attemptId: number },
): Promise<ChargeAttemptRow | null> {
  const [identity] = await tx
    .select({
      sourceType: schema.billingChargeAttempts.sourceType,
      sourceId: schema.billingChargeAttempts.sourceId,
      idempotencySuffix: schema.billingChargeAttempts.idempotencySuffix,
    })
    .from(schema.billingChargeAttempts)
    .where(
      and(
        eq(schema.billingChargeAttempts.id, input.attemptId),
        eq(schema.billingChargeAttempts.tenantId, input.tenantId),
        eq(schema.billingChargeAttempts.facilityId, input.facilityId),
      ),
    )
    .limit(1);
  if (!identity) return null;
  if (identity.sourceId == null) {
    // Legacy null-source rows cannot be generated by the ordinary queue.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`legacy-billing-attempt:${input.facilityId}:${input.attemptId}`}, 0))`,
    );
  } else {
    await lockChargeIdentity(
      tx,
      input.facilityId,
      identity.sourceType as ChargeRequest['sourceType'],
      identity.sourceId,
      identity.idempotencySuffix,
    );
  }
  const [locked] = await tx
    .select()
    .from(schema.billingChargeAttempts)
    .where(
      and(
        eq(schema.billingChargeAttempts.id, input.attemptId),
        eq(schema.billingChargeAttempts.tenantId, input.tenantId),
        eq(schema.billingChargeAttempts.facilityId, input.facilityId),
      ),
    )
    .limit(1)
    .for('update');
  if (!locked) return null;
  if (
    locked.sourceType !== identity.sourceType ||
    locked.sourceId !== identity.sourceId ||
    (locked.idempotencySuffix || null) !== (identity.idempotencySuffix || null)
  ) {
    throw new Error('CHARGE_ATTEMPT_IDENTITY_CHANGED');
  }
  return locked as ChargeAttemptRow;
}

export async function retryChargeAttempt(
  executor: Executor,
  input: { tenantId: number; facilityId: number; attemptId: number; actorUserId?: number },
): Promise<RetryOutcome | null> {
  return executor.transaction(async (tx: Executor) => {
    const row = await lockAttemptIdentity(tx, input);
    if (!row) return null;

    if (row.status !== 'PENDING') {
      return {
        attemptId: row.id,
        status: row.status === 'BILLED' ? 'BILLED' : row.status === 'VOID' ? 'VOID' : 'DUPLICATE',
        result: {
          charged: false,
          reason: row.status === 'VOID' ? 'ATTEMPT_VOIDED' : 'DUPLICATE',
          message:
            row.status === 'BILLED'
              ? `This charge was already billed${row.resolvedInvoiceId ? ` on invoice ${row.resolvedInvoiceId}` : ''}.`
              : `This charge is ${row.status.toLowerCase()} and will not be retried.`,
        },
      };
    }

    if (row.sourceId == null) {
      return { attemptId: row.id, status: 'PENDING', result: chargeReviewRequired() };
    }
    const request = toChargeRequest(row, input.tenantId);
    const related: ChargeAttemptRow[] = await tx
      .select()
      .from(schema.billingChargeAttempts)
      .where(attemptIdentityWhere(request))
      .for('update');
    if (
      related.some(
        (other) =>
          other.id !== row.id &&
          (other.status !== 'PENDING' ||
            other.patientId !== row.patientId ||
            other.itemType !== row.itemType),
      ) ||
      related.filter((other) => other.status === 'PENDING').length !== 1
    ) {
      return { attemptId: row.id, status: 'PENDING', result: chargeReviewRequired() };
    }

    let result: ChargeResult;

    try {
      result = await chargeForService(tx, await enrichFromSource(tx, request));
    } catch {
      /*
       * A fault in the engine leaves the row exactly as it is: still
       * PENDING, still owed, still retryable. It must not become a 500
       * that the operator reads as "billed".
       */
      console.error('Billing: retry failed; manual review is required.');

      return {
        attemptId: row.id,
        status: 'PENDING',
        result: {
          charged: false,
          reason: 'INVALID_INPUT',
          message: 'The retry could not run. Nothing was billed; try again.',
        },
      };
    }

    const verifiedDuplicate =
      result.reason === 'DUPLICATE' && result.itemId != null && result.invoiceId != null;
    if (result.reason === 'DUPLICATE' && !verifiedDuplicate) result = chargeReviewRequired();
    const status: RetryOutcome['status'] = result.charged
      ? 'BILLED'
      : verifiedDuplicate
        ? 'DUPLICATE'
        : 'PENDING';

    await tx
      .update(schema.billingChargeAttempts)
      .set({
        status,
        attempts: sql`${schema.billingChargeAttempts.attempts} + 1`,
        lastAttemptAt: new Date(),
        updatedAt: new Date(),
        /*
         * `reason` is NOT NULL. A successful retry keeps the original
         * reason — that is why the charge was queued — and the status
         * carries the outcome. A failed retry replaces it with the new one.
         */
        reason: result.charged ? row.reason : (result.reason ?? row.reason),
        detail: result.charged
          ? `Billed as ${result.tariffCode ?? 'a tariff'} (${result.matchExplanation ?? 'matched'}).`
          : (result.message ?? row.detail),
        codesTried: [...(result.codesTried ?? row.codesTried)],
        ...(result.charged || result.reason === 'DUPLICATE'
          ? {
              resolvedItemId: result.itemId ?? null,
              resolvedInvoiceId: result.invoiceId ?? null,
              resolvedTariffCode: result.tariffCode ?? null,
              resolvedUnitPrice: result.unitPrice === undefined ? null : String(result.unitPrice),
              resolvedAt: new Date(),
            }
          : {}),
      })
      .where(eq(schema.billingChargeAttempts.id, row.id));

    await tx.insert(schema.auditLogs).values({
      tenantId: input.tenantId,
      facilityId: input.facilityId,
      userId: input.actorUserId === undefined ? 'SYSTEM' : String(input.actorUserId),
      action: 'UPDATE',
      resource: 'BillingChargeAttempt',
      resourceId: String(row.id),
      details: `Charge attempt retry outcome: ${status}.`,
    });
    return { attemptId: row.id, status, result };
  });
}

/**
 * Retry everything waiting for one facility.
 *
 * Bounded on purpose: a price list that is still wrong would otherwise
 * turn one click into an unbounded burst of invoice writes. Idempotency
 * makes a second pass safe, so stopping at the cap costs nothing.
 */
export async function retryPendingChargeAttempts(
  executor: Executor,
  input: { tenantId: number; facilityId: number; limit?: number; actorUserId?: number },
): Promise<{
  tried: number;
  billed: number;
  duplicates: number;
  stillPending: number;
  skipped: number;
}> {
  const limit =
    Number.isSafeInteger(input.limit) && (input.limit ?? 0) > 0
      ? Math.min(Number(input.limit), 200)
      : 100;

  const pending = await listChargeAttempts(executor, {
    tenantId: input.tenantId,
    facilityId: input.facilityId,
    status: 'PENDING',
    limit,
  });

  let billed = 0;
  let duplicates = 0;
  let stillPending = 0;
  let skipped = 0;

  for (const row of pending) {
    try {
      const outcome = await retryChargeAttempt(executor, {
        tenantId: input.tenantId,
        facilityId: input.facilityId,
        attemptId: row.id,
        actorUserId: input.actorUserId,
      });

      if (outcome?.result.charged) {
        billed += 1;
      } else if (
        outcome?.status === 'DUPLICATE' &&
        outcome.result.itemId != null &&
        outcome.result.invoiceId != null
      ) {
        duplicates += 1;
      } else if (!outcome || outcome.status === 'VOID' || outcome.status === 'BILLED') {
        skipped += 1;
      } else {
        stillPending += 1;
      }
    } catch {
      console.error('Billing: retry failed; manual review is required.');
      stillPending += 1;
    }
  }

  return { tried: pending.length, billed, duplicates, stillPending, skipped };
}

/** Write an attempt off. Kept so nothing is ever deleted from the record. */
export async function voidChargeAttempt(
  executor: Executor,
  input: {
    tenantId: number;
    facilityId: number;
    attemptId: number;
    reason?: string;
    actorUserId?: number;
  },
): Promise<boolean> {
  const reason = input.reason?.trim();
  if (!reason || reason.length > 1000) throw new Error('CHARGE_ATTEMPT_REASON_REQUIRED');
  return executor.transaction(async (tx: Executor) => {
    const attempt = await lockAttemptIdentity(tx, input);
    if (!attempt || attempt.status !== 'PENDING') return false;
    if (attempt.sourceId !== null) {
      const [existingLine] = await tx
        .select({ id: schema.billingItems.id })
        .from(schema.billingItems)
        .where(
          eq(
            schema.billingItems.idempotencyKey,
            buildIdempotencyKey({
              sourceType: attempt.sourceType as ChargeRequest['sourceType'],
              sourceId: attempt.sourceId,
              idempotencySuffix: attempt.idempotencySuffix || undefined,
            }),
          ),
        )
        .limit(1);
      // Older versions could leave a pending attempt next to a billed line.
      // Do not call it written off; an operator must reconcile the records.
      if (existingLine) return false;
    }
    const rows = await tx
      .update(schema.billingChargeAttempts)
      .set({
        status: 'VOID',
        detail: reason,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.billingChargeAttempts.id, input.attemptId),
          eq(schema.billingChargeAttempts.tenantId, input.tenantId),
          eq(schema.billingChargeAttempts.facilityId, input.facilityId),
          eq(schema.billingChargeAttempts.status, 'PENDING'),
        ),
      )
      .returning({ id: schema.billingChargeAttempts.id });

    if (rows.length > 0) {
      await tx.insert(schema.auditLogs).values({
        tenantId: input.tenantId,
        facilityId: input.facilityId,
        userId: input.actorUserId === undefined ? 'SYSTEM' : String(input.actorUserId),
        action: 'UPDATE',
        resource: 'BillingChargeAttempt',
        resourceId: String(input.attemptId),
        details: 'Unpriced charge written off; reason retained on the attempt.',
      });
    }
    return rows.length > 0;
  });
}
