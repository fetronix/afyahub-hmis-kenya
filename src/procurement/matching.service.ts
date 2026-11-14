/**
 * Three-way matching: does the invoice agree with the order and the receipt?
 *
 * WHY THIS EXISTS
 * ---------------
 * Batch B made a receipt credit "received not invoiced" and an invoice clear
 * it. That fixed double counting, but it left the facility paying whatever the
 * supplier wrote down. Nothing compared the three documents a purchase actually
 * produces, so a price nobody agreed to, a duplicate invoice, or a bill dated
 * before the goods arrived could all be paid without anyone being told.
 *
 * WHAT A MATCH IS ALLOWED TO CLAIM
 * --------------------------------
 * It compares what this system genuinely holds:
 *
 *   * the purchase order line — quantity and price the facility committed to;
 *   * the goods received note line — quantity and the cost it was booked at;
 *   * the supplier invoice — the amount claimed, against the note it cites.
 *
 * It therefore reports price variance (booked cost differs from the ordered
 * price) and amount variance (the invoice does not equal the receipt it cites),
 * plus two controls that need no arithmetic: a duplicate invoice number from
 * the same supplier, and an invoice dated before the goods were received.
 *
 * It does NOT re-perform the supplier's arithmetic, and it cannot see units the
 * supplier shipped but this facility never recorded — absence of a finding is
 * not proof the invoice is correct, only that nothing in this system
 * contradicts it. The reconciliation report says the same thing in its own way.
 *
 * THE CONTROL, NOT THE REPORT
 * ---------------------------
 * A match that only writes a row is decoration. `assertPayable` refuses payment
 * on an invoice that did not match, unless a named user recorded why the
 * difference is acceptable. That is the point of the batch.
 */
import { and, eq } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';

export type MatchStatus = 'MATCHED' | 'VARIANCE' | 'OVERRIDDEN';

export interface MatchFinding {
  code:
    | 'PRICE_VARIANCE'
    | 'AMOUNT_VARIANCE'
    | 'DUPLICATE_INVOICE_NUMBER'
    | 'INVOICE_BEFORE_RECEIPT'
    | 'NO_RECEIPT_LINES'
    | 'OVER_RECEIPT';
  detail: string;
  amountCents?: string;
}

export interface MatchResult {
  status: MatchStatus;
  orderedCents: number;
  receivedCents: number;
  invoicedCents: number;
  priceVarianceCents: number;
  amountVarianceCents: number;
  toleranceCents: number;
  findings: MatchFinding[];
  matchId: number | null;
}

export class MatchingError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MatchingError';
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new MatchingError(statusCode, code, message);
}

const centsOf = (value: string | null | undefined): number => {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

export interface MatchInput {
  tenantId: number;
  facilityId: number;
  supplierInvoiceId: number;
  /** Absolute tolerance in cents; differences at or below it are accepted. */
  toleranceCents?: number;
  checkedByUserId?: number | null;
}

/**
 * Compare one invoice with its order and its receipt, and record the verdict.
 *
 * Runs inside the caller's transaction when given a client, so an invoice and
 * its verdict commit together — an invoice can never exist unmatchable, and a
 * match can never describe an invoice that was rolled back.
 */
export async function matchSupplierInvoice(
  input: MatchInput,
  client?: {
    query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  },
): Promise<MatchResult> {
  const run = async (query: NonNullable<typeof client>) => {
    const invoice = await query.query(
      `SELECT id, supplier_id, goods_received_note_id, purchase_order_id,
              invoice_number, invoice_date, subtotal_kes::text AS subtotal
         FROM supplier_invoices
        WHERE id=$1 AND tenant_id=$2 AND facility_id=$3`,
      [input.supplierInvoiceId, input.tenantId, input.facilityId],
    );
    if (!invoice.rows.length) {
      fail(404, 'SUPPLIER_INVOICE_NOT_FOUND', 'Supplier invoice not found.');
    }
    const row = invoice.rows[0];
    const grnId = row.goods_received_note_id === null ? null : Number(row.goods_received_note_id);
    if (grnId === null) {
      fail(
        409,
        'NOT_RECEIPT_BACKED',
        'This invoice is not linked to a goods received note, so there is nothing to match it against.',
      );
    }

    const findings: MatchFinding[] = [];
    const tolerance = Math.max(0, input.toleranceCents ?? 0);

    /* The receipt this invoice cites. */
    const receipt = await query.query(
      `SELECT i.inventory_item_id, i.quantity_received::text AS quantity,
              i.unit_cost::text AS unit_cost, i.line_total::text AS line_total,
              i.purchase_order_item_id, n.received_date, n.grn_number, n.status
         FROM goods_received_note_items i
         JOIN goods_received_notes n ON n.id = i.goods_received_note_id
        WHERE i.goods_received_note_id=$1
        ORDER BY i.id`,
      [grnId],
    );
    if (!receipt.rows.length) {
      findings.push({
        code: 'NO_RECEIPT_LINES',
        detail: `Goods received note for this invoice has no lines, so the invoice has nothing to evidence.`,
      });
    }

    /* The order lines the receipt draws on. */
    const orderLines = await query.query(
      `SELECT poi.id, poi.quantity::text AS quantity, poi.unit_price::text AS unit_price
         FROM purchase_order_items poi
        WHERE poi.purchase_order_id = (
          SELECT purchase_order_id FROM goods_received_notes WHERE id=$1
        )`,
      [grnId],
    );
    const orderedById = new Map(
      orderLines.rows.map((line) => [
        Number(line.id),
        { quantity: Number(line.quantity), unitPrice: centsOf(line.unit_price as string) },
      ]),
    );

    let receivedCents = 0;
    let orderedCents = 0;
    let priceVarianceCents = 0;

    for (const line of receipt.rows) {
      const quantity = Number(line.quantity ?? 0);
      const bookedUnit = centsOf(line.unit_cost as string);
      receivedCents += Math.round(quantity * bookedUnit);

      const ordered = orderedById.get(Number(line.purchase_order_item_id));
      if (!ordered) continue;
      orderedCents += Math.round(ordered.quantity * ordered.unitPrice);

      const variance = Math.round(quantity * (bookedUnit - ordered.unitPrice));
      if (variance !== 0) {
        priceVarianceCents += variance;
        findings.push({
          code: 'PRICE_VARIANCE',
          detail: `Order line ${line.purchase_order_item_id} was ordered at ${(ordered.unitPrice / 100).toFixed(2)} and received at ${(bookedUnit / 100).toFixed(2)}.`,
          amountCents: String(variance),
        });
      }

      /* A receipt can never exceed the order; if one does, it was recorded
         before that rule existed, and the invoice is relying on it. */
      if (quantity > ordered.quantity + 1e-9) {
        findings.push({
          code: 'OVER_RECEIPT',
          detail: `More was received against order line ${line.purchase_order_item_id} than was ordered.`,
        });
      }
    }

    const invoicedCents = centsOf(row.subtotal as string);
    const amountVarianceCents = invoicedCents - receivedCents;
    if (Math.abs(amountVarianceCents) > tolerance) {
      findings.push({
        code: 'AMOUNT_VARIANCE',
        detail: `The invoice claims ${(invoicedCents / 100).toFixed(2)} against a receipt worth ${(receivedCents / 100).toFixed(2)}.`,
        amountCents: String(amountVarianceCents),
      });
    }

    /* The same supplier billing the same number twice is a payment control,
       not an accounting one, and it needs no arithmetic to find. */
    const duplicate = await query.query(
      `SELECT id, invoice_number FROM supplier_invoices
        WHERE tenant_id=$1 AND facility_id=$2 AND supplier_id=$3
          AND invoice_number=$4 AND id <> $5
        LIMIT 1`,
      [
        input.tenantId,
        input.facilityId,
        Number(row.supplier_id),
        row.invoice_number,
        input.supplierInvoiceId,
      ],
    );
    if (duplicate.rows.length) {
      findings.push({
        code: 'DUPLICATE_INVOICE_NUMBER',
        detail: `This supplier already has an invoice numbered ${String(row.invoice_number)}.`,
      });
    }

    const receivedDate = await query.query(
      'SELECT received_date::text AS d FROM goods_received_notes WHERE id=$1',
      [grnId],
    );
    const receivedOn = receivedDate.rows[0]?.d ? String(receivedDate.rows[0].d) : null;
    if (receivedOn && String(row.invoice_date) < receivedOn) {
      findings.push({
        code: 'INVOICE_BEFORE_RECEIPT',
        detail: `The invoice is dated ${String(row.invoice_date)}, before the goods were received on ${receivedOn}.`,
      });
    }

    const material = findings.filter(
      (finding) =>
        finding.amountCents === undefined || Math.abs(Number(finding.amountCents)) > tolerance,
    );

    const result: MatchResult = {
      status: material.length === 0 ? 'MATCHED' : 'VARIANCE',
      orderedCents,
      receivedCents,
      invoicedCents,
      priceVarianceCents,
      amountVarianceCents,
      toleranceCents: tolerance,
      findings,
      matchId: null,
    };

    /*
     * The verdict is written once. A re-check could otherwise overwrite the
     * evidence a payment decision was based on, which is exactly the audit
     * trail an auditor would ask for and not get.
     */
    const stored = await query.query(
      `INSERT INTO supplier_invoice_matches(
         tenant_id, facility_id, supplier_invoice_id, goods_received_note_id, purchase_order_id,
         status, ordered_cents, received_cents, invoiced_cents, price_variance_cents,
         amount_variance_cents, tolerance_cents, findings, checked_by_user_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
       ON CONFLICT (supplier_invoice_id) DO NOTHING
       RETURNING id, status`,
      [
        input.tenantId,
        input.facilityId,
        input.supplierInvoiceId,
        grnId,
        row.purchase_order_id === null ? null : Number(row.purchase_order_id),
        result.status,
        result.orderedCents,
        result.receivedCents,
        result.invoicedCents,
        result.priceVarianceCents,
        result.amountVarianceCents,
        result.toleranceCents,
        JSON.stringify(result.findings),
        input.checkedByUserId ?? null,
      ],
    );

    if (stored.rows.length) {
      result.matchId = Number(stored.rows[0].id);
      return result;
    }

    /* Already matched: return the stored verdict rather than a fresh one. */
    const existing = await query.query(
      `SELECT id, status, ordered_cents, received_cents, invoiced_cents,
              price_variance_cents, amount_variance_cents, tolerance_cents, findings
         FROM supplier_invoice_matches WHERE supplier_invoice_id=$1`,
      [input.supplierInvoiceId],
    );
    const prior = existing.rows[0];
    if (!prior) {
      /* The insert lost the race to a row that has since been deleted. */
      fail(409, 'MATCH_STATE_CONFLICT', 'The match state changed while it was being recorded.');
    }
    return {
      status: prior.status as MatchStatus,
      orderedCents: Number(prior.ordered_cents),
      receivedCents: Number(prior.received_cents),
      invoicedCents: Number(prior.invoiced_cents),
      priceVarianceCents: Number(prior.price_variance_cents),
      amountVarianceCents: Number(prior.amount_variance_cents),
      toleranceCents: Number(prior.tolerance_cents),
      findings: (prior.findings as MatchFinding[]) ?? [],
      matchId: Number(prior.id),
    };
  };

  if (client) return run(client);

  /* Self-managed transaction so a caller without one still gets atomicity. */
  const pooled = await db.$client.connect();
  try {
    await pooled.query('BEGIN');
    const result = await run({
      query: (text, params) =>
        pooled.query(text, params) as Promise<{ rows: Record<string, unknown>[] }>,
    });
    await pooled.query('COMMIT');
    return result;
  } catch (error) {
    await pooled.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    pooled.release();
  }
}

/**
 * Refuse to pay an invoice whose three-way match did not succeed.
 *
 * Throws unless the stored verdict is MATCHED, or a named user overrode a
 * VARIANCE with a reason on the record. An invoice that was never matched is
 * treated as unmatched, not as acceptable — silence is not agreement.
 */
export async function assertPayable(
  client: {
    query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  },
  scope: { tenantId: number; facilityId: number },
  supplierInvoiceId: number,
): Promise<{ status: MatchStatus; matchId: number | null }> {
  const stored = await client.query(
    `SELECT id, status, override_reason
       FROM supplier_invoice_matches
      WHERE supplier_invoice_id=$1 AND tenant_id=$2 AND facility_id=$3`,
    [supplierInvoiceId, scope.tenantId, scope.facilityId],
  );

  if (!stored.rows.length) {
    fail(
      409,
      'THREE_WAY_MATCH_REQUIRED',
      'This invoice has not been matched against its order and receipt, so it cannot be paid.',
    );
  }

  const row = stored.rows[0];
  const status = row.status as MatchStatus;
  if (status === 'MATCHED' || status === 'OVERRIDDEN') {
    return { status, matchId: Number(row.id) };
  }

  fail(
    409,
    'THREE_WAY_MATCH_VARIANCE',
    'This invoice differs from its order or receipt and has not been accepted, so it cannot be paid.',
  );
}

/** Record a named user's decision to accept a difference, with the reason. */
export async function overrideMatch(
  scope: { tenantId: number; facilityId: number; actorId: number },
  supplierInvoiceId: number,
  body: { reason?: unknown },
): Promise<MatchResult> {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 10) {
    fail(
      400,
      'OVERRIDE_REASON_REQUIRED',
      'Accepting a matched difference needs a written reason of at least 10 characters.',
    );
  }

  return db.transaction(async (tx) => {
    const [stored] = await tx
      .select()
      .from(schema.supplierInvoiceMatches)
      .where(
        and(
          eq(schema.supplierInvoiceMatches.supplierInvoiceId, supplierInvoiceId),
          eq(schema.supplierInvoiceMatches.tenantId, scope.tenantId),
          eq(schema.supplierInvoiceMatches.facilityId, scope.facilityId),
        ),
      )
      .limit(1)
      .for('update');

    if (!stored) {
      fail(404, 'MATCH_NOT_FOUND', 'This invoice has not been matched yet.');
    }
    if (stored.status === 'MATCHED') {
      fail(409, 'MATCH_ALREADY_CLEAN', 'This invoice already matched; there is nothing to accept.');
    }

    const [updated] = await tx
      .update(schema.supplierInvoiceMatches)
      .set({
        status: 'OVERRIDDEN',
        overrideReason: reason.slice(0, 1000),
        overriddenByUserId: scope.actorId,
        overriddenAt: new Date(),
      })
      .where(eq(schema.supplierInvoiceMatches.id, stored.id))
      .returning();

    await tx.insert(schema.auditLogs).values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      userId: String(scope.actorId),
      resource: 'SupplierInvoiceMatch',
      resourceId: String(stored.id),
      action: 'OVERRIDE',
      details: `Three-way match difference accepted for invoice ${supplierInvoiceId}: ${reason.slice(0, 500)}`,
    });

    return {
      status: 'OVERRIDDEN' as MatchStatus,
      orderedCents: updated.orderedCents,
      receivedCents: updated.receivedCents,
      invoicedCents: updated.invoicedCents,
      priceVarianceCents: updated.priceVarianceCents,
      amountVarianceCents: updated.amountVarianceCents,
      toleranceCents: updated.toleranceCents,
      findings: (updated.findings as MatchFinding[]) ?? [],
      matchId: updated.id,
      /* Returned, not just stored: a caller that has to re-read to learn what
         it just recorded cannot show the accepting user the decision. */
      overrideReason: updated.overrideReason,
      overriddenAt: updated.overriddenAt,
    };
  });
}

/** The stored verdict for an invoice, or null when it has not been matched. */
export async function readMatch(tenantId: number, facilityId: number, invoiceId: number) {
  const [row] = await db
    .select()
    .from(schema.supplierInvoiceMatches)
    .where(
      and(
        eq(schema.supplierInvoiceMatches.supplierInvoiceId, invoiceId),
        eq(schema.supplierInvoiceMatches.tenantId, tenantId),
        eq(schema.supplierInvoiceMatches.facilityId, facilityId),
      ),
    )
    .limit(1);

  if (!row) return null;
  return {
    id: row.id,
    status: row.status as MatchStatus,
    orderedCents: row.orderedCents,
    receivedCents: row.receivedCents,
    invoicedCents: row.invoicedCents,
    priceVarianceCents: row.priceVarianceCents,
    amountVarianceCents: row.amountVarianceCents,
    toleranceCents: row.toleranceCents,
    findings: (row.findings as MatchFinding[]) ?? [],
    checkedAt: row.checkedAt,
    overrideReason: row.overrideReason,
    overriddenAt: row.overriddenAt,
  };
}
