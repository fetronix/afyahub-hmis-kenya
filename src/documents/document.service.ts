/**
 * Documents, built from persisted rows.
 *
 * Every printable document starts here: one function per document type reads
 * the authoritative tables, checks the caller's permission and scope against
 * the row it found, and returns a `DocumentModel` plus the letterhead resolved
 * for that facility. The renderer (`./render.ts`) knows nothing about invoices
 * or discharge summaries, and this module knows nothing about PDF syntax.
 *
 * THE THREE RULES THIS MODULE EXISTS TO KEEP
 * ------------------------------------------
 * 1. Nothing is invented. Every field comes from a column. Where a value is
 *    missing the document says so ("Not recorded", "Not reported") or the
 *    request is refused — a printed document is never filled in with a
 *    plausible guess.
 * 2. A finalized financial document prints from its snapshot. Once
 *    `finalizeInvoice` has run, the invoice, its line items and its allocation
 *    are frozen in `billing_invoice_finalizations.snapshot`. A reprint reads
 *    that snapshot, not the live tables, so a later correction to a tariff or
 *    a description cannot change a document that was already handed to a
 *    patient or a payer. The same snapshot records which letterhead the
 *    document was issued under, and the reprint resolves exactly that version.
 * 3. Authorization is per document type and per row. A user with
 *    `inpatient.read` cannot print an invoice; a user of one facility cannot
 *    print another facility's receipt by guessing its id.
 */

import { and, desc, eq } from 'drizzle-orm';

import { hasAllPermissions } from '../auth/authorization.service.ts';
import { ScopeAccessError } from '../auth/scope.service.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import type { InvoiceSnapshot } from '../billing/finalized-invoice.types.ts';
import {
  activeLetterheadIdFor,
  resolveLetterheadAt,
  resolveLetterheadVersion,
} from '../branding/letterhead.service.ts';
import type { DocumentFacility, DocumentModel, DocumentTable } from './document-model.ts';
import type { LetterheadForRender } from './render.ts';

export type DocumentErrorCode =
  | 'DOCUMENT_FORBIDDEN'
  | 'DOCUMENT_NOT_FOUND'
  | 'DOCUMENT_ID_INVALID'
  | 'DOCUMENT_NOT_PRINTABLE'
  | 'DOCUMENT_INCOMPLETE'
  | 'DOCUMENT_TYPE_UNKNOWN';

export class DocumentError extends Error {
  readonly code: DocumentErrorCode;
  readonly status: number;

  constructor(code: DocumentErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'DocumentError';
    this.code = code;
    this.status = status;
  }
}

/* ------------------------------------------------------------------ helpers */

function forbidden(permission: string): never {
  throw new DocumentError(
    'DOCUMENT_FORBIDDEN',
    `Printing this document requires the ${permission} permission.`,
    403,
  );
}

function requirePermission(context: AuthorizationContext, ...codes: string[]): void {
  if (!hasAllPermissions(context, codes)) forbidden(codes[0]);
}

function notFound(what: string): never {
  throw new DocumentError('DOCUMENT_NOT_FOUND', `${what} was not found.`, 404);
}

function validId(value: unknown, what: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new DocumentError('DOCUMENT_ID_INVALID', `A valid ${what} id is required.`, 400);
  }
  return id;
}

const NOT_RECORDED = 'Not recorded';

function money(amount: string | number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || amount === '') return `${currency} 0.00`;
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value)) return `${currency} ${amount}`;
  return `${currency} ${value.toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function quantity(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '0';
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return String(value);
  return Number.isInteger(parsed) ? String(parsed) : String(parsed);
}

function dateOnly(value: Date | string | null | undefined, timezone: string): string {
  if (!value) return NOT_RECORDED;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return NOT_RECORDED;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function instant(value: Date | string | null | undefined, timezone: string): string {
  if (!value) return NOT_RECORDED;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return NOT_RECORDED;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function personName(patient: {
  firstName: string;
  middleName: string | null;
  lastName: string;
}): string {
  return [patient.firstName, patient.middleName, patient.lastName]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ');
}

function facilityOf(row: {
  name: string;
  code: string;
  mflCode: string | null;
  address: string | null;
  county: string | null;
  phone: string | null;
  email: string | null;
}): DocumentFacility {
  return {
    name: row.name,
    code: row.code,
    registryCode: row.mflCode,
    address: row.address,
    county: row.county,
    phone: row.phone,
    email: row.email,
  };
}

/** The tenant's currency and the facility's clock, from the rows themselves. */
async function presentation(tenantId: number, facilityTimezone: string | null) {
  const [tenant] = await db
    .select({ currency: schema.tenants.currency, name: schema.tenants.name })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId));
  return {
    currency: tenant?.currency?.trim() || 'KES',
    timezone: facilityTimezone?.trim() || 'Africa/Nairobi',
  };
}

function letterheadForRender(
  resolved: Awaited<ReturnType<typeof resolveLetterheadAt>>,
): LetterheadForRender | null {
  if (!resolved) return null;
  return {
    bytes: resolved.bytes,
    bodyTopPt: resolved.bodyTopPt,
    bodyBottomPt: resolved.bodyBottomPt,
    bodyLeftPt: resolved.bodyLeftPt,
    bodyRightPt: resolved.bodyRightPt,
    pageWidthPt: resolved.pageWidthPt,
    pageHeightPt: resolved.pageHeightPt,
    label: resolved.label,
  };
}

export interface BuiltDocument {
  model: DocumentModel;
  letterhead: LetterheadForRender | null;
  /** Suggested filename. Numbers only; nothing about a patient. */
  filename: string;
}

/* ------------------------------------------------------------------ invoice */

/**
 * A finalized invoice prints from its snapshot; an unfinalized one cannot be
 * printed as a financial document at all.
 *
 * That is not an arbitrary restriction: the snapshot is what makes the printed
 * document reconcile with the ledger months later, and the letterhead recorded
 * on the finalization is what makes a reprint look like the original. Allowing
 * a draft to print would produce a document with neither.
 */
export async function buildInvoiceDocument(
  context: AuthorizationContext,
  rawInvoiceId: number,
): Promise<BuiltDocument> {
  requirePermission(context, 'billing.read');
  const invoiceId = validId(rawInvoiceId, 'invoice');

  const [invoice] = await db
    .select()
    .from(schema.billingInvoices)
    .where(eq(schema.billingInvoices.id, invoiceId));
  if (!invoice) notFound('The invoice');
  assertScope(context, invoice.tenantId, invoice.facilityId);
  if (invoice.voidedAt) {
    throw new DocumentError(
      'DOCUMENT_NOT_PRINTABLE',
      'This invoice has been voided and cannot be printed as a valid document.',
      409,
    );
  }

  const [facility] = await db
    .select()
    .from(schema.facilities)
    .where(eq(schema.facilities.id, invoice.facilityId));
  if (!facility) notFound('The facility');

  const [finalization] = await db
    .select()
    .from(schema.billingInvoiceFinalizations)
    .where(eq(schema.billingInvoiceFinalizations.invoiceId, invoiceId));
  if (!finalization) {
    throw new DocumentError(
      'DOCUMENT_NOT_PRINTABLE',
      'Only a finalized invoice can be printed. Finalize the invoice first, so its figures and branding are fixed.',
      409,
    );
  }

  const snapshot = finalization.snapshot as InvoiceSnapshot;
  const { currency, timezone } = await presentation(invoice.tenantId, facility.timezone);

  const letterhead = await resolveLetterheadVersion(
    invoice.tenantId,
    invoice.facilityId,
    finalization.letterheadId ?? -1,
  );

  const table: DocumentTable = {
    columns: [
      { label: 'Description', width: 0.5 },
      { label: 'Qty', width: 0.1, align: 'right' },
      { label: 'Unit price', width: 0.2, align: 'right' },
      { label: 'Amount', width: 0.2, align: 'right' },
    ],
    rows: snapshot.items.map((item) => [
      item.description,
      quantity(item.quantity),
      money(item.unitPrice, currency),
      money(item.total, currency),
    ]),
    repeatHeader: true,
  };

  const model: DocumentModel = {
    kind: 'INVOICE',
    title: 'Invoice',
    subtitle: snapshot.invoice.payerType ? `${snapshot.invoice.payerType} billing` : undefined,
    documentNumber: snapshot.invoice.number,
    issuedAt: snapshot.invoice.createdAt,
    facility: facilityOf({
      name: snapshot.facility.name,
      code: snapshot.facility.internalCode,
      mflCode: snapshot.facility.registryCode,
      address: snapshot.facility.address,
      county: snapshot.facility.county,
      phone: snapshot.facility.phone,
      email: snapshot.facility.email,
    }),
    leftFields: [
      { label: 'Patient', value: snapshot.patient.name },
      { label: 'MRN', value: snapshot.patient.mrn },
      { label: 'Invoice date', value: dateOnly(snapshot.invoice.createdAt, timezone) },
      { label: 'Finalized', value: instant(finalization.finalizedAt, timezone) },
    ],
    rightFields: [
      { label: 'Payer', value: snapshot.invoice.payerName ?? snapshot.invoice.payerType ?? 'Self' },
      { label: 'Member number', value: snapshot.invoice.memberNumber ?? NOT_RECORDED },
      { label: 'Department', value: snapshot.encounter.department || NOT_RECORDED },
      { label: 'Clinician', value: snapshot.encounter.attendingClinician || NOT_RECORDED },
    ],
    table,
    totals: [
      { label: 'Itemized total', value: money(snapshot.amounts.itemizedTotal, currency) },
      {
        label: 'Patient responsibility',
        value: money(snapshot.amounts.patientResponsibility, currency),
      },
      {
        label: 'Insurer responsibility',
        value: money(snapshot.amounts.insurerResponsibility, currency),
      },
      { label: 'Copayment', value: money(snapshot.amounts.copayment, currency) },
      {
        label: 'Invoice total',
        value: money(snapshot.amounts.itemizedTotal, currency),
        emphasis: true,
      },
    ],
    notes: [
      `Allocation basis: ${snapshot.amounts.allocationBasis}`,
      'Figures are the amounts recorded when this invoice was finalized and do not change.',
    ],
    brandingNote: letterhead?.label ?? null,
  };

  return {
    model,
    letterhead: letterheadForRender(letterhead),
    filename: `invoice-${snapshot.invoice.number}.pdf`,
  };
}

/* ------------------------------------------------------------------ receipt */

/**
 * A receipt always prints from the payment row and the invoice it settled.
 * `thermal` selects the till-roll layout; a letterhead is never applied to it,
 * and the render result reports that rather than pretending otherwise.
 */
export async function buildReceiptDocument(
  context: AuthorizationContext,
  rawPaymentId: number,
  options: { thermal?: boolean } = {},
): Promise<BuiltDocument> {
  requirePermission(context, 'billing.read');
  const paymentId = validId(rawPaymentId, 'payment');

  const [payment] = await db
    .select()
    .from(schema.billingPayments)
    .where(eq(schema.billingPayments.id, paymentId));
  if (!payment) notFound('The receipt');

  const [invoice] = await db
    .select()
    .from(schema.billingInvoices)
    .where(eq(schema.billingInvoices.id, payment.invoiceId));
  if (!invoice) notFound('The invoice this receipt settles');
  assertScope(context, invoice.tenantId, invoice.facilityId);

  const [facility] = await db
    .select()
    .from(schema.facilities)
    .where(eq(schema.facilities.id, invoice.facilityId));
  if (!facility) notFound('The facility');

  const [patient] = await db
    .select()
    .from(schema.patients)
    .where(eq(schema.patients.id, invoice.patientId));

  const { currency, timezone } = await presentation(invoice.tenantId, facility.timezone);
  const thermal = options.thermal === true;
  /*
   * A receipt is branded with the stationery in effect when the money was
   * received; a till roll never carries a letterhead at all.
   */
  const letterhead = thermal
    ? null
    : letterheadForRender(
        await resolveLetterheadAt(
          invoice.tenantId,
          invoice.facilityId,
          payment.paymentDate ?? payment.createdAt,
        ),
      );

  const model: DocumentModel = {
    kind: 'RECEIPT',
    title: thermal ? 'Receipt' : 'Official Receipt',
    documentNumber: payment.receiptNumber,
    issuedAt: (payment.paymentDate ?? payment.createdAt).toISOString(),
    facility: facilityOf(facility),
    thermal,
    leftFields: [
      { label: 'Received from', value: patient ? personName(patient) : NOT_RECORDED },
      { label: 'MRN', value: patient?.mrn ?? NOT_RECORDED },
      { label: 'Invoice', value: invoice.invoiceNumber },
      { label: 'Date', value: instant(payment.paymentDate ?? payment.createdAt, timezone) },
    ],
    rightFields: [
      { label: 'Method', value: payment.paymentMethod ?? NOT_RECORDED },
      { label: 'Reference', value: payment.referenceCode ?? NOT_RECORDED },
      { label: 'Cashier', value: payment.cashierName ?? NOT_RECORDED },
      { label: 'Settlement', value: payment.settlementStatus ?? NOT_RECORDED },
    ],
    totals: [{ label: 'Amount received', value: money(payment.amount, currency), emphasis: true }],
    notes: [
      'This receipt acknowledges payment against the invoice named above.',
      'Retain this receipt for your records.',
    ],
    brandingNote: letterhead?.label ?? (thermal ? null : null),
  };

  return {
    model,
    letterhead,
    filename: `receipt-${payment.receiptNumber}.pdf`,
  };
}

/* -------------------------------------------------------------- credit note */

export async function buildCreditNoteDocument(
  context: AuthorizationContext,
  rawRefundId: number,
): Promise<BuiltDocument> {
  requirePermission(context, 'billing.read');
  const refundId = validId(rawRefundId, 'credit note');

  const [refund] = await db
    .select()
    .from(schema.billingRefunds)
    .where(eq(schema.billingRefunds.id, refundId));
  if (!refund) notFound('The credit note');
  assertScope(context, refund.tenantId, refund.facilityId);

  const [facility] = await db
    .select()
    .from(schema.facilities)
    .where(eq(schema.facilities.id, refund.facilityId));
  if (!facility) notFound('The facility');

  const [invoice] = await db
    .select()
    .from(schema.billingInvoices)
    .where(eq(schema.billingInvoices.id, refund.invoiceId));
  const [patient] = invoice
    ? await db.select().from(schema.patients).where(eq(schema.patients.id, invoice.patientId))
    : [];

  const { currency, timezone } = await presentation(refund.tenantId, facility.timezone);
  const letterhead = letterheadForRender(
    await resolveLetterheadAt(refund.tenantId, refund.facilityId, refund.createdAt),
  );

  const model: DocumentModel = {
    kind: 'CREDIT_NOTE',
    title: 'Credit Note',
    documentNumber: refund.refundNumber,
    issuedAt: refund.createdAt.toISOString(),
    facility: facilityOf(facility),
    leftFields: [
      { label: 'Patient', value: patient ? personName(patient) : NOT_RECORDED },
      { label: 'MRN', value: patient?.mrn ?? NOT_RECORDED },
      { label: 'Invoice', value: invoice?.invoiceNumber ?? NOT_RECORDED },
      { label: 'Issued', value: instant(refund.createdAt, timezone) },
    ],
    rightFields: [
      { label: 'Method', value: refund.refundMethod ?? NOT_RECORDED },
      { label: 'External reference', value: refund.externalReference ?? NOT_RECORDED },
      {
        label: 'Original payment',
        value: refund.paymentId ? `#${refund.paymentId}` : NOT_RECORDED,
      },
      {
        label: 'Confirmation',
        value: refund.manualConfirmation ? 'Manually confirmed' : 'Recorded by the system',
      },
    ],
    totals: [{ label: 'Amount credited', value: money(refund.amount, currency), emphasis: true }],
    sections: [{ heading: 'Reason for credit', body: refund.reason ?? NOT_RECORDED }],
    notes: ['This credit note records a refund against the invoice named above.'],
    brandingNote: letterhead?.label ?? null,
  };

  return { model, letterhead, filename: `credit-note-${refund.refundNumber}.pdf` };
}

/* ---------------------------------------------------------------------- LPO */

export async function buildPurchaseOrderDocument(
  context: AuthorizationContext,
  rawPurchaseOrderId: number,
): Promise<BuiltDocument> {
  requirePermission(context, 'procurement.read');
  const purchaseOrderId = validId(rawPurchaseOrderId, 'purchase order');

  const [order] = await db
    .select()
    .from(schema.purchaseOrders)
    .where(eq(schema.purchaseOrders.id, purchaseOrderId));
  if (!order) notFound('The purchase order');
  assertScope(context, order.tenantId, order.facilityId);

  const [facility] = await db
    .select()
    .from(schema.facilities)
    .where(eq(schema.facilities.id, order.facilityId));
  if (!facility) notFound('The facility');

  const [supplier] = await db
    .select()
    .from(schema.suppliers)
    .where(eq(schema.suppliers.id, order.supplierId));

  const items = await db
    .select()
    .from(schema.purchaseOrderItems)
    .where(eq(schema.purchaseOrderItems.purchaseOrderId, purchaseOrderId))
    .orderBy(schema.purchaseOrderItems.lineNumber);

  const { currency, timezone } = await presentation(order.tenantId, facility.timezone);
  const letterhead = letterheadForRender(
    await resolveLetterheadAt(order.tenantId, order.facilityId, order.createdAt),
  );

  const lines = items.filter((item) => item.isActive !== false);

  const model: DocumentModel = {
    kind: 'PURCHASE_ORDER',
    title: 'Local Purchase Order',
    subtitle: order.status ?? undefined,
    documentNumber: order.poNumber,
    issuedAt: order.createdAt.toISOString(),
    facility: facilityOf(facility),
    leftFields: [
      { label: 'Supplier', value: supplier?.name ?? `Supplier #${order.supplierId}` },
      { label: 'Supplier contact', value: supplier?.phone ?? supplier?.email ?? NOT_RECORDED },
      { label: 'Ordered', value: dateOnly(order.createdAt, timezone) },
      { label: 'Expected delivery', value: dateOnly(order.expectedDeliveryDate, timezone) },
    ],
    rightFields: [
      { label: 'Payment terms', value: order.paymentTerms ?? NOT_RECORDED },
      {
        label: 'Delivery address',
        value: order.deliveryAddress ?? facility.address ?? NOT_RECORDED,
      },
      { label: 'Revision', value: String(order.revision ?? 1) },
      { label: 'Status', value: order.status ?? NOT_RECORDED },
    ],
    table: {
      columns: [
        { label: 'Line', width: 0.08 },
        { label: 'Description', width: 0.46 },
        { label: 'Qty', width: 0.1, align: 'right' },
        { label: 'Unit', width: 0.1 },
        { label: 'Unit price', width: 0.13, align: 'right' },
        { label: 'Amount', width: 0.13, align: 'right' },
      ],
      rows: lines.map((item) => [
        String(item.lineNumber),
        item.description,
        quantity(item.quantity),
        item.unit ?? '',
        money(item.unitPrice, currency),
        money(item.lineTotal, currency),
      ]),
      repeatHeader: true,
    },
    totals: [
      { label: 'Subtotal', value: money(order.subtotalAmount, currency) },
      { label: 'Tax', value: money(order.taxAmount, currency) },
      { label: 'Shipping', value: money(order.shippingAmount, currency) },
      { label: 'Discount', value: money(order.discountAmount, currency) },
      { label: 'Order total', value: money(order.totalAmount, currency), emphasis: true },
    ],
    notes: [
      'This order is issued subject to the supplier terms recorded against it.',
      ...(order.notes ? [order.notes] : []),
      ...(order.description ? [order.description] : []),
    ],
    brandingNote: letterhead?.label ?? null,
  };

  return { model, letterhead, filename: `lpo-${order.poNumber}.pdf` };
}

/* ---------------------------------------------------------------------- GRN */

export async function buildGoodsReceivedNoteDocument(
  context: AuthorizationContext,
  rawGrnId: number,
): Promise<BuiltDocument> {
  requirePermission(context, 'procurement.read');
  const grnId = validId(rawGrnId, 'goods received note');

  const [grn] = await db
    .select()
    .from(schema.goodsReceivedNotes)
    .where(eq(schema.goodsReceivedNotes.id, grnId));
  if (!grn) notFound('The goods received note');
  assertScope(context, grn.tenantId, grn.facilityId);

  const [facility] = await db
    .select()
    .from(schema.facilities)
    .where(eq(schema.facilities.id, grn.facilityId));
  if (!facility) notFound('The facility');

  const [supplier] = grn.supplierId
    ? await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, grn.supplierId))
    : [];

  const [order] = grn.purchaseOrderId
    ? await db
        .select()
        .from(schema.purchaseOrders)
        .where(eq(schema.purchaseOrders.id, grn.purchaseOrderId))
    : [];

  const items = await db
    .select()
    .from(schema.goodsReceivedNoteItems)
    .where(eq(schema.goodsReceivedNoteItems.goodsReceivedNoteId, grnId))
    .orderBy(schema.goodsReceivedNoteItems.id);

  const { currency, timezone } = await presentation(grn.tenantId, facility.timezone);
  /*
   * `received_date` is a calendar date, so it cannot place a note within a
   * day's stationery history. The note is issued when it is recorded.
   */
  const letterhead = letterheadForRender(
    await resolveLetterheadAt(grn.tenantId, grn.facilityId, grn.createdAt),
  );

  const model: DocumentModel = {
    kind: 'GOODS_RECEIVED_NOTE',
    title: 'Goods Received Note',
    subtitle: grn.status ?? undefined,
    documentNumber: grn.grnNumber,
    issuedAt: grn.receivedDate
      ? new Date(grn.receivedDate).toISOString()
      : grn.createdAt.toISOString(),
    facility: facilityOf(facility),
    leftFields: [
      { label: 'Supplier', value: supplier?.name ?? NOT_RECORDED },
      { label: 'Purchase order', value: order?.poNumber ?? NOT_RECORDED },
      { label: 'Received', value: dateOnly(grn.receivedDate ?? grn.createdAt, timezone) },
      { label: 'Received by', value: grn.receivedByName ?? NOT_RECORDED },
    ],
    rightFields: [
      { label: 'Status', value: grn.status ?? NOT_RECORDED },
      { label: 'Recorded', value: instant(grn.createdAt, timezone) },
      { label: 'Lines', value: String(items.length) },
      { label: 'Inventory value', value: money(grn.inventoryValueKes, currency) },
    ],
    /*
     * Batch number and expiry are part of what was physically received — the
     * storekeeper checks them at the door — so they belong on the note rather
     * than only in the stock ledger.
     */
    table: {
      columns: [
        { label: 'Description', width: 0.4 },
        { label: 'Qty received', width: 0.13, align: 'right' },
        { label: 'Batch', width: 0.15 },
        { label: 'Expiry', width: 0.13 },
        { label: 'Unit cost', width: 0.1, align: 'right' },
        { label: 'Line total', width: 0.09, align: 'right' },
      ],
      rows: items.map((item) => [
        item.description,
        quantity(item.quantityReceived),
        item.batchNumber ?? '',
        dateOnly(item.expiryDate, timezone),
        money(item.unitCost, currency),
        money(item.lineTotal, currency),
      ]),
      repeatHeader: true,
    },
    notes: [
      'Quantities and costs are those recorded on receipt; batches and expiry dates are held against the stock ledger.',
      ...(grn.notes ? [grn.notes] : []),
    ],
    brandingNote: letterhead?.label ?? null,
  };

  return { model, letterhead, filename: `grn-${grn.grnNumber}.pdf` };
}

/* ---------------------------------------------------------------- laboratory */

export async function buildLaboratoryReportDocument(
  context: AuthorizationContext,
  rawOrderId: number,
): Promise<BuiltDocument> {
  requirePermission(context, 'laboratory.read');
  const orderId = validId(rawOrderId, 'laboratory order');

  const [order] = await db.select().from(schema.labOrders).where(eq(schema.labOrders.id, orderId));
  if (!order) notFound('The laboratory order');
  assertScope(context, order.tenantId, order.facilityId);

  const [facility] = await db
    .select()
    .from(schema.facilities)
    .where(eq(schema.facilities.id, order.facilityId));
  if (!facility) notFound('The facility');

  const [patient] = await db
    .select()
    .from(schema.patients)
    .where(eq(schema.patients.id, order.patientId));

  const results = await db
    .select()
    .from(schema.labResults)
    .where(eq(schema.labResults.orderId, orderId))
    .orderBy(schema.labResults.id);

  if (results.length === 0) {
    throw new DocumentError(
      'DOCUMENT_INCOMPLETE',
      'This laboratory order has no results recorded yet, so there is no report to print.',
      409,
    );
  }

  const { timezone } = await presentation(order.tenantId, facility.timezone);
  const letterhead = letterheadForRender(
    await resolveLetterheadAt(
      order.tenantId,
      order.facilityId,
      order.completedAt ?? order.orderedAt,
    ),
  );

  const verified = results.filter((result) => result.verifiedAt !== null).length;

  const model: DocumentModel = {
    kind: 'LABORATORY_REPORT',
    title: 'Laboratory Report',
    subtitle: order.testName,
    documentNumber: order.sampleAccessionNumber ?? `LAB-${order.id}`,
    issuedAt: (order.completedAt ?? order.orderedAt).toISOString(),
    facility: facilityOf(facility),
    leftFields: [
      { label: 'Patient', value: patient ? personName(patient) : NOT_RECORDED },
      { label: 'MRN', value: patient?.mrn ?? NOT_RECORDED },
      { label: 'Specimen', value: order.specimenType ?? NOT_RECORDED },
      { label: 'Collected', value: instant(order.sampleCollectedAt, timezone) },
    ],
    rightFields: [
      { label: 'Ordered', value: instant(order.orderedAt, timezone) },
      { label: 'Reported', value: instant(order.completedAt, timezone) },
      { label: 'Priority', value: order.priority ?? 'Routine' },
      { label: 'Verified results', value: `${verified} of ${results.length}` },
    ],
    table: {
      columns: [
        { label: 'Parameter', width: 0.32 },
        { label: 'Result', width: 0.18 },
        { label: 'Unit', width: 0.14 },
        { label: 'Reference range', width: 0.24 },
        { label: 'Flag', width: 0.12 },
      ],
      rows: results.map((result) => [
        result.parameterName,
        result.measuredValue ?? '',
        result.unit ?? '',
        result.referenceRange ?? '',
        result.flag ?? '',
      ]),
      repeatHeader: true,
    },
    sections: [
      ...(order.clinicalIndication
        ? [{ heading: 'Clinical indication', body: order.clinicalIndication }]
        : []),
      ...(order.clinicalNotes ? [{ heading: 'Laboratory notes', body: order.clinicalNotes }] : []),
    ],
    notes: [
      verified === results.length
        ? 'All results on this report have been verified.'
        : 'Some results on this report are not yet verified. Verified results count is shown above.',
    ],
    brandingNote: letterhead?.label ?? null,
  };

  return {
    model,
    letterhead,
    filename: `lab-report-${order.sampleAccessionNumber ?? order.id}.pdf`,
  };
}

/* ----------------------------------------------------------------- radiology */

export async function buildRadiologyReportDocument(
  context: AuthorizationContext,
  rawOrderId: number,
): Promise<BuiltDocument> {
  requirePermission(context, 'radiology.read');
  const orderId = validId(rawOrderId, 'radiology order');

  const [order] = await db
    .select()
    .from(schema.radiologyOrders)
    .where(eq(schema.radiologyOrders.id, orderId));
  if (!order) notFound('The radiology order');
  assertScope(context, order.tenantId, order.facilityId);

  if (!order.reportedAt && !order.radiologistFindings) {
    throw new DocumentError(
      'DOCUMENT_INCOMPLETE',
      'This imaging request has not been reported yet, so there is no report to print.',
      409,
    );
  }

  const [facility] = await db
    .select()
    .from(schema.facilities)
    .where(eq(schema.facilities.id, order.facilityId));
  if (!facility) notFound('The facility');

  const [patient] = await db
    .select()
    .from(schema.patients)
    .where(eq(schema.patients.id, order.patientId));

  /*
   * `reported_by` is free text on this table (some sites record a name, some a
   * staff reference), so it is printed verbatim rather than resolved through a
   * join that could silently print nothing.
   */

  const { timezone } = await presentation(order.tenantId, facility.timezone);
  const letterhead = letterheadForRender(
    await resolveLetterheadAt(
      order.tenantId,
      order.facilityId,
      order.reportedAt ?? order.createdAt,
    ),
  );

  const model: DocumentModel = {
    kind: 'RADIOLOGY_REPORT',
    title: 'Imaging Report',
    subtitle: `${order.modality} — ${order.procedureName}`,
    documentNumber: `RAD-${order.id}`,
    issuedAt: (order.reportedAt ?? order.createdAt).toISOString(),
    facility: facilityOf(facility),
    leftFields: [
      { label: 'Patient', value: patient ? personName(patient) : NOT_RECORDED },
      { label: 'MRN', value: patient?.mrn ?? NOT_RECORDED },
      { label: 'Modality', value: order.modality },
      { label: 'Requested', value: instant(order.createdAt, timezone) },
    ],
    rightFields: [
      { label: 'Reported', value: instant(order.reportedAt, timezone) },
      { label: 'Radiologist', value: order.reportedBy ?? NOT_RECORDED },
      { label: 'Status', value: order.status ?? NOT_RECORDED },
      { label: 'Impression recorded', value: order.impression ? 'Yes' : 'No' },
    ],
    sections: [
      ...(order.clinicalIndication
        ? [{ heading: 'Clinical indication', body: order.clinicalIndication }]
        : []),
      { heading: 'Findings', body: order.radiologistFindings ?? NOT_RECORDED },
      { heading: 'Impression', body: order.impression ?? NOT_RECORDED },
    ],
    notes: ['Reported findings are reproduced exactly as recorded by the reporting clinician.'],
    brandingNote: letterhead?.label ?? null,
  };

  return { model, letterhead, filename: `imaging-report-RAD-${order.id}.pdf` };
}

/* ------------------------------------------------------------------ discharge */

export async function buildDischargeSummaryDocument(
  context: AuthorizationContext,
  rawAdmissionId: number,
): Promise<BuiltDocument> {
  requirePermission(context, 'inpatient.read');
  const admissionId = validId(rawAdmissionId, 'admission');

  const [admission] = await db
    .select()
    .from(schema.admissions)
    .where(eq(schema.admissions.id, admissionId));
  if (!admission) notFound('The admission');
  assertScope(context, admission.tenantId, admission.facilityId);

  const summary = (admission.dischargeSummary ?? '').trim();
  if (!summary) {
    throw new DocumentError(
      'DOCUMENT_INCOMPLETE',
      'No discharge summary has been written for this admission, so there is nothing to print.',
      409,
    );
  }

  const [facility] = await db
    .select()
    .from(schema.facilities)
    .where(eq(schema.facilities.id, admission.facilityId));
  if (!facility) notFound('The facility');

  const [patient] = await db
    .select()
    .from(schema.patients)
    .where(eq(schema.patients.id, admission.patientId));

  const [ward] = await db.select().from(schema.wards).where(eq(schema.wards.id, admission.wardId));

  const { timezone } = await presentation(admission.tenantId, facility.timezone);
  const letterhead = letterheadForRender(
    await resolveLetterheadAt(
      admission.tenantId,
      admission.facilityId,
      admission.dischargeDate ?? admission.createdAt,
    ),
  );

  const model: DocumentModel = {
    kind: 'DISCHARGE_SUMMARY',
    title: 'Discharge Summary',
    subtitle: admission.dischargeType ?? undefined,
    documentNumber: `ADM-${admission.id}`,
    issuedAt: new Date(admission.dischargeDate ?? admission.admissionDate).toISOString(),
    facility: facilityOf(facility),
    leftFields: [
      { label: 'Patient', value: patient ? personName(patient) : NOT_RECORDED },
      { label: 'MRN', value: patient?.mrn ?? NOT_RECORDED },
      { label: 'Admitted', value: instant(admission.admissionDate, timezone) },
      { label: 'Discharged', value: instant(admission.dischargeDate, timezone) },
    ],
    rightFields: [
      { label: 'Ward', value: ward?.name ?? NOT_RECORDED },
      { label: 'Admitting doctor', value: admission.admittingDoctor ?? NOT_RECORDED },
      { label: 'Discharge type', value: admission.dischargeType ?? NOT_RECORDED },
      { label: 'Disposition', value: admission.dischargeDisposition ?? NOT_RECORDED },
    ],
    sections: [
      ...(admission.provisionalDiagnosis
        ? [{ heading: 'Provisional diagnosis', body: admission.provisionalDiagnosis }]
        : []),
      { heading: 'Discharge summary', body: summary },
      ...(admission.nursingNotes
        ? [{ heading: 'Nursing notes', body: admission.nursingNotes }]
        : []),
    ],
    notes: ['This summary reproduces the clinical record as written by the treating team.'],
    brandingNote: letterhead?.label ?? null,
  };

  return { model, letterhead, filename: `discharge-summary-ADM-${admission.id}.pdf` };
}

/* ------------------------------------------------------------------- scope */

/**
 * The one place a document decides whether the caller may see the facility it
 * belongs to. Every builder calls it after loading the row and before reading
 * anything else, so a cross-tenant id fails before a patient name is loaded.
 */
function assertScope(context: AuthorizationContext, tenantId: number, facilityId: number): void {
  try {
    if (context.isSuperAdmin) {
      /* A super administrator still has to name a tenant explicitly; the
       * context carries none, so the row's tenant is accepted as named. */
      return;
    }
    if (context.tenantId !== tenantId) throw new ScopeAccessError();
    if (context.facilityId !== null && context.facilityId !== facilityId) {
      throw new ScopeAccessError();
    }
  } catch {
    /* Answered as "not found" so an unauthorized caller cannot confirm that a
     * document with that id exists in another facility. */
    throw new DocumentError('DOCUMENT_NOT_FOUND', 'The document was not found.', 404);
  }
}

/** The active letterhead id to stamp on a finalization, or null. */
export async function letterheadIdForFinalization(
  tenantId: number,
  facilityId: number,
): Promise<number | null> {
  return activeLetterheadIdFor(tenantId, facilityId);
}

/** Latest finalized invoice id for a facility, used by tests and reprints. */
export async function latestFinalizedInvoiceId(
  tenantId: number,
  facilityId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ id: schema.billingInvoiceFinalizations.invoiceId })
    .from(schema.billingInvoiceFinalizations)
    .where(
      and(
        eq(schema.billingInvoiceFinalizations.tenantId, tenantId),
        eq(schema.billingInvoiceFinalizations.facilityId, facilityId),
      ),
    )
    .orderBy(desc(schema.billingInvoiceFinalizations.finalizedAt))
    .limit(1);
  return row?.id ?? null;
}
