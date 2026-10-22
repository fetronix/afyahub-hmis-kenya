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

import { and, asc, desc, eq, sql } from 'drizzle-orm';

import * as schema from '../db/schema.ts';
import {
  chargeForService,
  type ChargeRequest,
  type ChargeResult,
} from './billing.service.ts';

/** Anything that can run a query: the pool, a transaction, a test double. */
type Executor = any;

let warnedMissingAttemptsTable = false;

/** True when the database predates migration 0020. */
export function isMissingAttemptsTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const code = (error as { code?: unknown }).code;

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

  const values = {
    tenantId: request.tenantId,
    facilityId: request.facilityId,
    patientId: request.patientId,
    encounterId:
      typeof request.encounterId === 'number' ? request.encounterId : null,
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
    quantity,
    fallbackUnitPrice:
      request.fallbackUnitPrice === undefined
        ? null
        : String(request.fallbackUnitPrice),
    reason: result.reason,
    detail: result.message ?? null,
    codesTried: [...(result.codesTried ?? request.codes ?? [])],
    status: 'PENDING' as const,
    attempts: 1,
    lastAttemptAt: new Date(),
    updatedAt: new Date(),
  };

  const existingWhere = and(
    eq(schema.billingChargeAttempts.facilityId, values.facilityId),
    eq(schema.billingChargeAttempts.sourceType, values.sourceType),
    eq(schema.billingChargeAttempts.sourceId, values.sourceId),
    eq(schema.billingChargeAttempts.itemType, values.itemType),
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
      if ((insertError as { code?: unknown })?.code === '23505') {
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
    if (isMissingAttemptsTable(error)) {
      if (!warnedMissingAttemptsTable) {
        warnedMissingAttemptsTable = true;

        console.warn(
          'Billing: billing_charge_attempts is missing. Run `npm run db:migrate` (migration 0020) to record charges that could not be priced. The charge was still skipped safely.',
        );
      }

      return null;
    }

    console.error('Billing: could not record skipped charge:', error);

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
export async function chargeAndRecord(
  executor: Executor,
  request: ChargeRequest,
): Promise<ChargeResult> {
  let result: ChargeResult;

  try {
    result = await chargeForService(executor, request);
  } catch (error: unknown) {
    console.error('Billing charge failed:', error);

    result = {
      charged: false,
      reason: 'INVALID_INPUT',
      message: 'The service was recorded but could not be billed.',
    };
  }

  if (!result.charged) {
    await recordChargeAttempt(executor, request, result);
  }

  return result;
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

      return [];
    }

    throw error;
  }
}

/** How much is waiting, for the configuration screen. */
export async function countPendingChargeAttempts(
  executor: Executor,
  input: { tenantId: number; facilityId: number },
): Promise<number> {
  try {
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

    return rows[0]?.count ?? 0;
  } catch (error: unknown) {
    if (isMissingAttemptsTable(error)) return 0;

    throw error;
  }
}

/**
 * Rebuild the charge from a stored attempt.
 *
 * Everything the engine needs is on the row, including the identity of
 * the clinical event, so the retry produces the same idempotency key as
 * the original attempt.
 */
export function toChargeRequest(
  row: ChargeAttemptRow,
  tenantId: number,
): ChargeRequest {
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
    itemType: row.itemType,
    description: row.description ?? undefined,
    quantity: row.quantity,
    ...(row.fallbackUnitPrice === null
      ? {}
      : { fallbackUnitPrice: row.fallbackUnitPrice }),
  };
}

export interface RetryOutcome {
  attemptId: number;
  status: 'BILLED' | 'DUPLICATE' | 'PENDING';
  result: ChargeResult;
}

/**
 * Retry one attempt.
 *
 * Runs the ordinary charge path: the link, the code and the description
 * rules all apply, and the idempotency key is the one the original
 * attempt would have used. A second retry of an already-billed attempt
 * therefore reports DUPLICATE and writes no line.
 */
export async function retryChargeAttempt(
  executor: Executor,
  input: { tenantId: number; facilityId: number; attemptId: number },
): Promise<RetryOutcome | null> {
  const rows = await executor
    .select()
    .from(schema.billingChargeAttempts)
    .where(
      and(
        eq(schema.billingChargeAttempts.id, input.attemptId),
        eq(schema.billingChargeAttempts.tenantId, input.tenantId),
        eq(schema.billingChargeAttempts.facilityId, input.facilityId),
      ),
    )
    .limit(1);

  const row = rows[0] as ChargeAttemptRow | undefined;

  if (!row) return null;

  if (row.status !== 'PENDING') {
    return {
      attemptId: row.id,
      status: row.status === 'BILLED' ? 'BILLED' : 'DUPLICATE',
      result: {
        charged: false,
        reason: 'DUPLICATE',
        message:
          row.status === 'BILLED'
            ? `This charge was already billed${row.resolvedInvoiceId ? ` on invoice ${row.resolvedInvoiceId}` : ''}.`
            : `This charge is ${row.status.toLowerCase()} and will not be retried.`,
      },
    };
  }

  let result: ChargeResult;

  try {
    result = await chargeForService(
      executor,
      toChargeRequest(row, input.tenantId),
    );
  } catch (error: unknown) {
    /*
     * A fault in the engine leaves the row exactly as it is: still
     * PENDING, still owed, still retryable. It must not become a 500
     * that the operator reads as "billed".
     */
    console.error('Billing: retry failed:', error);

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

  const status: RetryOutcome['status'] = result.charged
    ? 'BILLED'
    : result.reason === 'DUPLICATE'
      ? 'DUPLICATE'
      : 'PENDING';

  await executor
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
      ...(result.charged
        ? {
            resolvedItemId: result.itemId ?? null,
            resolvedInvoiceId: result.invoiceId ?? null,
            resolvedTariffCode: result.tariffCode ?? null,
            resolvedUnitPrice:
              result.unitPrice === undefined ? null : String(result.unitPrice),
            resolvedAt: new Date(),
          }
        : {}),
    })
    .where(eq(schema.billingChargeAttempts.id, row.id));

  return { attemptId: row.id, status, result };
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
  input: { tenantId: number; facilityId: number; limit?: number },
): Promise<{ tried: number; billed: number; stillPending: number }> {
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
  let stillPending = 0;

  for (const row of pending) {
    try {
      const outcome = await retryChargeAttempt(executor, {
        tenantId: input.tenantId,
        facilityId: input.facilityId,
        attemptId: row.id,
      });

      if (outcome?.status === 'BILLED' || outcome?.status === 'DUPLICATE') {
        billed += 1;
      } else {
        stillPending += 1;
      }
    } catch (error: unknown) {
      console.error('Billing: retry failed:', error);
      stillPending += 1;
    }
  }

  return { tried: pending.length, billed, stillPending };
}

/** Write an attempt off. Kept so nothing is ever deleted from the record. */
export async function voidChargeAttempt(
  executor: Executor,
  input: { tenantId: number; facilityId: number; attemptId: number; reason?: string },
): Promise<boolean> {
  const rows = await executor
    .update(schema.billingChargeAttempts)
    .set({
      status: 'VOID',
      detail: input.reason ?? 'Written off by the facility.',
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

  return rows.length > 0;
}
