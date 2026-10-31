import { and, asc, eq, sql } from 'drizzle-orm';
import { hasAllPermissions } from '../auth/authorization.service.ts';
import { requireFacilityScope, requireTenantScope } from '../auth/scope.service.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { readInvoicePaymentLedger } from './payment-ledger.ts';
import { formatCents, parseMoneyToCents } from './settlement.ts';
import type {
  FinalizedInvoiceView,
  InvoiceFinancialView,
  InvoiceSnapshot,
  PaymentParty,
} from './finalized-invoice.types.ts';

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type Invoice = typeof schema.billingInvoices.$inferSelect;
type Finalization = typeof schema.billingInvoiceFinalizations.$inferSelect;

export class InvoiceFinalizationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly issues: string[] = [],
  ) {
    super(message);
    this.name = 'InvoiceFinalizationError';
  }
}

function requirePermissions(context: AuthorizationContext, ...permissions: string[]) {
  if (!hasAllPermissions(context, permissions)) {
    throw new InvoiceFinalizationError('FORBIDDEN', 'Permission is required for this action.', 403);
  }
}

function validId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new InvoiceFinalizationError(
      'INVALID_INVOICE_ID',
      'A valid invoice ID is required.',
      400,
    );
  return id;
}

function present(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

async function scopedInvoice(executor: Executor, context: AuthorizationContext, id: number) {
  const [invoice] = await executor
    .select()
    .from(schema.billingInvoices)
    .where(eq(schema.billingInvoices.id, id))
    .limit(1);
  if (!invoice) throw new InvoiceFinalizationError('INVOICE_NOT_FOUND', 'Invoice not found.', 404);
  requireTenantScope(context, invoice.tenantId);
  requireFacilityScope(context, invoice.tenantId, invoice.facilityId);
  return invoice;
}

async function requireFinanceEnabled(executor: Executor, invoice: Invoice) {
  const [facility] = await executor
    .select({ enabledModules: schema.facilities.enabledModules })
    .from(schema.facilities)
    .where(
      and(
        eq(schema.facilities.id, invoice.facilityId),
        eq(schema.facilities.tenantId, invoice.tenantId),
      ),
    );
  if (
    !facility ||
    !Array.isArray(facility.enabledModules) ||
    !facility.enabledModules.includes('finance')
  )
    throw new InvoiceFinalizationError(
      'FACILITY_MODULE_DISABLED',
      'Finance is disabled for this facility.',
      403,
    );
}

const unknownFinancial = (): InvoiceFinancialView => ({
  reconciled: false,
  grossReceipts: null,
  refunds: null,
  netReceipts: null,
  invoiceBalance: null,
  invoiceCredit: null,
  patientNetReceipts: null,
  insurerNetReceipts: null,
  unattributedNetReceipts: null,
  patientBalance: null,
  insurerBalance: null,
  patientCredit: null,
  insurerCredit: null,
});

/**
 * Attribution is explicit evidence, not inferred from a payment method.
 * Refunds follow their original receipt; an unattributed net receipt makes
 * both party balances unknown, rather than assigning it to either party.
 */
export async function calculateInvoiceFinancialView(
  executor: Executor,
  invoice: Invoice,
  finalization: Finalization,
): Promise<InvoiceFinancialView> {
  const total = parseMoneyToCents(invoice.totalAmount);
  const paid = parseMoneyToCents(invoice.paidAmount);
  const balance = parseMoneyToCents(invoice.balanceAmount);
  const credit = parseMoneyToCents(invoice.creditBalance);
  const patientShare = parseMoneyToCents(finalization.patientResponsibility);
  const insurerShare = parseMoneyToCents(finalization.insurerResponsibility);
  const ledger = await readInvoicePaymentLedger(executor, invoice.id);
  if (
    total === null ||
    paid === null ||
    balance === null ||
    credit === null ||
    patientShare === null ||
    insurerShare === null ||
    !ledger ||
    total < 0 ||
    paid < 0 ||
    balance < 0 ||
    credit < 0 ||
    patientShare < 0 ||
    insurerShare < 0 ||
    patientShare + insurerShare !== total ||
    ledger.netCents !== paid ||
    balance !== Math.max(0, total - paid) ||
    credit !== Math.max(0, paid - total)
  )
    return unknownFinancial();

  const attributions = await executor
    .select({
      paymentId: schema.billingPaymentAttributions.paymentId,
      party: schema.billingPaymentAttributions.party,
    })
    .from(schema.billingPaymentAttributions)
    .where(
      and(
        eq(schema.billingPaymentAttributions.tenantId, invoice.tenantId),
        eq(schema.billingPaymentAttributions.facilityId, invoice.facilityId),
        eq(schema.billingPaymentAttributions.invoiceId, invoice.id),
      ),
    );
  const parties = new Map(attributions.map((a) => [a.paymentId, a.party]));
  let patientPaid = 0,
    insurerPaid = 0,
    unattributed = 0;
  for (const [paymentId, entry] of ledger.byPayment) {
    const net = entry.grossCents - entry.refundedCents;
    const party = parties.get(paymentId);
    if (party === 'PATIENT') patientPaid += net;
    else if (party === 'INSURER') insurerPaid += net;
    else unattributed += net;
  }
  if (![patientPaid, insurerPaid, unattributed].every(Number.isSafeInteger))
    return unknownFinancial();
  const partiesKnown = unattributed === 0;
  return {
    reconciled: true,
    grossReceipts: formatCents(ledger.grossCents),
    refunds: formatCents(ledger.refundedCents),
    netReceipts: formatCents(ledger.netCents),
    invoiceBalance: formatCents(balance),
    invoiceCredit: formatCents(credit),
    patientNetReceipts: formatCents(patientPaid),
    insurerNetReceipts: formatCents(insurerPaid),
    unattributedNetReceipts: formatCents(unattributed),
    patientBalance: partiesKnown ? formatCents(Math.max(0, patientShare - patientPaid)) : null,
    insurerBalance: partiesKnown ? formatCents(Math.max(0, insurerShare - insurerPaid)) : null,
    patientCredit: partiesKnown ? formatCents(Math.max(0, patientPaid - patientShare)) : null,
    insurerCredit: partiesKnown ? formatCents(Math.max(0, insurerPaid - insurerShare)) : null,
  };
}

export interface FinalizeInvoiceInput {
  insurerResponsibility: unknown;
  copayment: unknown;
  allocationBasis: unknown;
}

/**
 * Take an immutable snapshot of authoritative, scoped records. Nothing is
 * finalized when required data, tariffs or the existing financial ledger are
 * missing or inconsistent. An explicit split is a billing allocation, not
 * evidence of insurance coverage, approval, adjudication or payment.
 */
export async function finalizeInvoice(
  context: AuthorizationContext,
  rawInvoiceId: number,
  input: FinalizeInvoiceInput,
) {
  requirePermissions(context, 'billing.read', 'billing.update', 'clinical.read');
  const invoiceId = validId(rawInvoiceId);
  const insurer = parseMoneyToCents(input.insurerResponsibility as string | number);
  const copayment = parseMoneyToCents(input.copayment as string | number);
  const basis = typeof input.allocationBasis === 'string' ? input.allocationBasis.trim() : '';
  if (
    insurer === null ||
    insurer < 0 ||
    copayment === null ||
    copayment < 0 ||
    basis.length < 3 ||
    basis.length > 500
  )
    throw new InvoiceFinalizationError(
      'INVALID_ALLOCATION',
      'Enter non-negative insurer and copayment amounts and an allocation basis (3–500 characters).',
      400,
    );

  const initial = await scopedInvoice(db, context, invoiceId);
  return db.transaction(async (tx) => {
    // Matches the automatic charge engine's lock order: patient, then invoice.
    const [patient] = await tx
      .select()
      .from(schema.patients)
      .where(
        and(
          eq(schema.patients.id, initial.patientId),
          eq(schema.patients.tenantId, initial.tenantId),
        ),
      )
      .for('update');
    const [invoice] = await tx
      .select()
      .from(schema.billingInvoices)
      .where(eq(schema.billingInvoices.id, invoiceId))
      .for('update');
    if (!invoice || !patient || invoice.patientId !== patient.id)
      throw new InvoiceFinalizationError('INVOICE_NOT_FOUND', 'Invoice not found.', 404);
    requireTenantScope(context, invoice.tenantId);
    requireFacilityScope(context, invoice.tenantId, invoice.facilityId);
    if (invoice.status === 'Void' || invoice.voidedAt)
      throw new InvoiceFinalizationError(
        'INVOICE_VOIDED',
        'A voided invoice cannot be finalized.',
        409,
      );

    const [existing] = await tx
      .select()
      .from(schema.billingInvoiceFinalizations)
      .where(eq(schema.billingInvoiceFinalizations.invoiceId, invoice.id));
    if (invoice.finalizedAt || existing) {
      if (
        invoice.finalizedAt &&
        existing &&
        parseMoneyToCents(existing.insurerResponsibility) === insurer &&
        parseMoneyToCents(existing.copayment) === copayment &&
        existing.allocationBasis === basis
      ) {
        return {
          invoiceId,
          finalizedAt: existing.finalizedAt.toISOString(),
          idempotentReplay: true,
        };
      }
      throw new InvoiceFinalizationError(
        'ALREADY_FINALIZED',
        'This invoice is finalized. Corrections require an authorized, audit-preserving process.',
        409,
      );
    }

    const [facility] = await tx
      .select()
      .from(schema.facilities)
      .where(
        and(
          eq(schema.facilities.id, invoice.facilityId),
          eq(schema.facilities.tenantId, invoice.tenantId),
        ),
      )
      .limit(1);
    if (
      !facility ||
      !Array.isArray(facility.enabledModules) ||
      !facility.enabledModules.includes('finance')
    )
      throw new InvoiceFinalizationError(
        'FACILITY_MODULE_DISABLED',
        'The finance module is not available for this facility.',
        403,
      );

    const issues: string[] = [];
    if (!present(facility.name) || !present(facility.code) || !present(facility.mflCode))
      issues.push('Facility name, internal code and registered MFL code are required.');
    if (
      !present(facility.address) ||
      !present(facility.county) ||
      (!present(facility.phone) && !present(facility.email))
    )
      issues.push('Facility address, county and at least one contact are required.');
    if (!present(patient.firstName) || !present(patient.lastName) || !present(patient.mrn))
      issues.push('Patient name and MRN are required.');

    const [encounter] = invoice.encounterId
      ? await tx
          .select()
          .from(schema.encounters)
          .where(
            and(
              eq(schema.encounters.id, invoice.encounterId),
              eq(schema.encounters.tenantId, invoice.tenantId),
              eq(schema.encounters.facilityId, invoice.facilityId),
              eq(schema.encounters.patientId, invoice.patientId),
            ),
          )
          .limit(1)
      : [];
    if (!encounter) issues.push('A matching patient encounter in this facility is required.');
    const [department] = encounter?.departmentId
      ? await tx
          .select()
          .from(schema.departments)
          .where(
            and(
              eq(schema.departments.id, encounter.departmentId),
              eq(schema.departments.facilityId, invoice.facilityId),
            ),
          )
          .limit(1)
      : [];
    const [practitioner] = encounter?.practitionerId
      ? await tx
          .select()
          .from(schema.practitioners)
          .where(
            and(
              eq(schema.practitioners.id, encounter.practitionerId),
              eq(schema.practitioners.tenantId, invoice.tenantId),
              eq(schema.practitioners.facilityId, invoice.facilityId),
            ),
          )
          .limit(1)
      : [];
    if (!department || !present(department.name))
      issues.push('The encounter department is not recorded for this facility.');
    if (!practitioner || !present(practitioner.fullName))
      issues.push('The attending clinician is not recorded for this facility.');

    const recordedDiagnoses = encounter
      ? await tx
          .select()
          .from(schema.diagnoses)
          .where(
            and(
              eq(schema.diagnoses.encounterId, encounter.id),
              eq(schema.diagnoses.patientId, patient.id),
            ),
          )
          .orderBy(asc(schema.diagnoses.id))
      : [];
    const diagnoses = recordedDiagnoses.map((d) => {
      const system = d.codingSystem;
      const code =
        d.diagnosisCode ??
        (system === 'ICD-11' ? d.icd11Code : system === 'ICD-10' ? d.icd10Code : null);
      const description =
        d.diagnosisDisplay ??
        (system === 'ICD-11' ? d.icd11Title : system === 'ICD-10' ? d.icd10Description : null);
      return { system, code, description, type: d.diagnosisType };
    });
    if (
      !diagnoses.length ||
      diagnoses.some((d) => !present(d.system) || !present(d.code) || !present(d.description))
    )
      issues.push(
        'At least one diagnosis with its recorded coding system, code and description is required.',
      );

    const lines = await tx
      .select({ item: schema.billingItems, tariff: schema.facilityServiceTariffs })
      .from(schema.billingItems)
      .leftJoin(
        schema.facilityServiceTariffs,
        and(
          eq(schema.billingItems.tariffId, schema.facilityServiceTariffs.id),
          eq(schema.facilityServiceTariffs.tenantId, invoice.tenantId),
          eq(schema.facilityServiceTariffs.facilityId, invoice.facilityId),
        ),
      )
      .where(eq(schema.billingItems.invoiceId, invoice.id))
      .orderBy(asc(schema.billingItems.id));
    if (!lines.length) issues.push('At least one coded invoice item is required.');
    let sum = 0;
    for (const { item, tariff } of lines) {
      const unit = parseMoneyToCents(item.unitPrice),
        line = parseMoneyToCents(item.totalAmount);
      if (!tariff || !item.tariffId || !present(item.tariffCode) || !present(item.description))
        issues.push(`Item ${item.id} needs a recorded facility tariff and code.`);
      if (
        !item.quantity ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity <= 0 ||
        unit === null ||
        unit < 0 ||
        line === null ||
        line < 0 ||
        unit * item.quantity !== line ||
        !Number.isSafeInteger(sum + line)
      )
        issues.push(`Item ${item.id} has missing or inconsistent quantity or amounts.`);
      else sum += line;
    }
    const total = parseMoneyToCents(invoice.totalAmount);
    const paid = parseMoneyToCents(invoice.paidAmount);
    const balance = parseMoneyToCents(invoice.balanceAmount);
    const credit = parseMoneyToCents(invoice.creditBalance);
    const ledger = await readInvoicePaymentLedger(tx, invoice.id);
    if (total === null || total < 0 || total !== sum)
      issues.push('Invoice total must match its recorded line items.');
    if (
      total === null ||
      paid === null ||
      balance === null ||
      credit === null ||
      paid < 0 ||
      balance < 0 ||
      credit < 0 ||
      !ledger ||
      ledger.netCents !== paid ||
      balance !== Math.max(0, total - paid) ||
      credit !== Math.max(0, paid - total)
    )
      issues.push('Invoice totals, receipts and refunds need reconciliation.');
    if (total !== null && (insurer > total || copayment > total - insurer))
      issues.push('Insurer responsibility and copayment exceed the invoice allocation.');
    if (
      insurer > 0 &&
      (!present(invoice.payerName) ||
        !present(invoice.memberNumber) ||
        !present(invoice.payerType) ||
        invoice.payerType === 'Self-Pay')
    )
      issues.push(
        'An insurer allocation requires the recorded payer, payer type and member number.',
      );
    if (issues.length)
      throw new InvoiceFinalizationError(
        'FINALIZATION_INCOMPLETE',
        'Complete the recorded invoice details before finalization.',
        422,
        issues,
      );

    // All nullable data referenced below was checked above; no replacement or
    // inferred diagnosis, price, code or facility identity is introduced.
    const patientResponsibility = total! - insurer;
    const snapshot: InvoiceSnapshot = {
      version: 1,
      invoice: {
        id: invoice.id,
        number: invoice.invoiceNumber,
        createdAt: invoice.createdAt.toISOString(),
        payerType: invoice.payerType,
        payerName: invoice.payerName,
        memberNumber: invoice.memberNumber,
      },
      facility: {
        name: facility.name,
        internalCode: facility.code,
        registryCode: facility.mflCode!,
        address: facility.address!,
        county: facility.county!,
        phone: facility.phone,
        email: facility.email,
      },
      patient: {
        id: patient.id,
        name: [patient.firstName, patient.middleName, patient.lastName].filter(present).join(' '),
        mrn: patient.mrn,
      },
      encounter: {
        id: encounter!.id,
        department: department!.name,
        attendingClinician: practitioner!.fullName,
        diagnoses: diagnoses.map((d) => ({
          system: d.system,
          code: d.code!,
          description: d.description!,
          type: d.type,
        })),
      },
      items: lines.map(({ item }) => ({
        id: item.id,
        tariffId: item.tariffId!,
        code: item.tariffCode!,
        description: item.description,
        quantity: item.quantity!,
        unitPrice: formatCents(parseMoneyToCents(item.unitPrice)!),
        total: formatCents(parseMoneyToCents(item.totalAmount)!),
        sourceType: item.sourceType,
      })),
      amounts: {
        itemizedTotal: formatCents(total!),
        discounts: null,
        adjustments: null,
        patientResponsibility: formatCents(patientResponsibility),
        insurerResponsibility: formatCents(insurer),
        copayment: formatCents(copayment),
        allocationBasis: basis,
      },
    };
    const now = new Date();
    await tx.insert(schema.billingInvoiceFinalizations).values({
      invoiceId,
      tenantId: invoice.tenantId,
      facilityId: invoice.facilityId,
      finalizedByUserId: context.userId,
      finalizedAt: now,
      patientResponsibility: formatCents(patientResponsibility),
      insurerResponsibility: formatCents(insurer),
      copayment: formatCents(copayment),
      allocationBasis: basis,
      snapshot,
    });
    await tx
      .update(schema.billingInvoices)
      .set({ finalizedAt: now, updatedAt: now })
      .where(eq(schema.billingInvoices.id, invoiceId));
    await tx.insert(schema.auditLogs).values({
      tenantId: invoice.tenantId,
      facilityId: invoice.facilityId,
      userId: String(context.userId),
      action: 'FINALIZE',
      resource: 'Invoice',
      resourceId: String(invoiceId),
      details: 'Invoice finalized with explicit allocation.',
    });
    await tx.insert(schema.patientRecordAccessLogs).values({
      patientId: patient.id,
      userId: context.userId,
      tenantId: invoice.tenantId,
      facilityId: invoice.facilityId,
      action: 'CREATE',
      accessChannel: 'STAFF_PORTAL',
      recordType: 'FinalizedInvoice',
      recordId: invoiceId,
      purpose: 'BILLING',
    });
    return { invoiceId, finalizedAt: now.toISOString(), idempotentReplay: false };
  });
}

/** The caller must audit this clinical read before sending it to a browser. */
export async function getFinalizedInvoice(
  context: AuthorizationContext,
  rawInvoiceId: number,
): Promise<FinalizedInvoiceView | { finalized: false }> {
  requirePermissions(context, 'billing.read', 'clinical.read');
  return db.transaction(
    async (tx) => {
      const invoice = await scopedInvoice(tx, context, validId(rawInvoiceId));
      await requireFinanceEnabled(tx, invoice);
      const [finalization] = await tx
        .select()
        .from(schema.billingInvoiceFinalizations)
        .where(
          and(
            eq(schema.billingInvoiceFinalizations.invoiceId, invoice.id),
            eq(schema.billingInvoiceFinalizations.tenantId, invoice.tenantId),
            eq(schema.billingInvoiceFinalizations.facilityId, invoice.facilityId),
          ),
        );
      if (!invoice.finalizedAt && !finalization) return { finalized: false };
      if (
        !invoice.finalizedAt ||
        !finalization ||
        invoice.finalizedAt.getTime() !== finalization.finalizedAt.getTime()
      )
        throw new InvoiceFinalizationError(
          'FINALIZATION_REVIEW_REQUIRED',
          'Invoice finalization evidence is inconsistent.',
          409,
        );
      const financial = await calculateInvoiceFinancialView(tx, invoice, finalization);
      const payments = await tx
        .select({
          id: schema.billingPayments.id,
          receiptNumber: schema.billingPayments.receiptNumber,
          paymentMethod: schema.billingPayments.paymentMethod,
          amount: schema.billingPayments.amount,
          transactionCode: schema.billingPayments.transactionCode,
          paymentDate: schema.billingPayments.paymentDate,
          cashierName: schema.billingPayments.cashierName,
          party: schema.billingPaymentAttributions.party,
        })
        .from(schema.billingPayments)
        .leftJoin(
          schema.billingPaymentAttributions,
          and(
            eq(schema.billingPaymentAttributions.paymentId, schema.billingPayments.id),
            eq(schema.billingPaymentAttributions.invoiceId, invoice.id),
            eq(schema.billingPaymentAttributions.tenantId, invoice.tenantId),
            eq(schema.billingPaymentAttributions.facilityId, invoice.facilityId),
          ),
        )
        .where(eq(schema.billingPayments.invoiceId, invoice.id))
        .orderBy(asc(schema.billingPayments.id));
      const refunds = await tx
        .select({
          id: schema.billingRefunds.id,
          paymentId: schema.billingRefunds.paymentId,
          refundNumber: schema.billingRefunds.refundNumber,
          amount: schema.billingRefunds.amount,
          refundMethod: schema.billingRefunds.refundMethod,
          createdAt: schema.billingRefunds.createdAt,
        })
        .from(schema.billingRefunds)
        .where(
          and(
            eq(schema.billingRefunds.invoiceId, invoice.id),
            eq(schema.billingRefunds.tenantId, invoice.tenantId),
            eq(schema.billingRefunds.facilityId, invoice.facilityId),
          ),
        )
        .orderBy(asc(schema.billingRefunds.id));
      await tx.insert(schema.patientRecordAccessLogs).values({
        patientId: invoice.patientId,
        userId: context.userId,
        tenantId: invoice.tenantId,
        facilityId: invoice.facilityId,
        action: 'VIEW',
        accessChannel: 'STAFF_PORTAL',
        recordType: 'FinalizedInvoice',
        recordId: invoice.id,
        purpose: 'BILLING',
      });
      return {
        finalized: true,
        finalizedAt: finalization.finalizedAt.toISOString(),
        finalizedByUserId: finalization.finalizedByUserId,
        voided: Boolean(invoice.voidedAt || invoice.status === 'Void'),
        snapshot: finalization.snapshot,
        financial,
        payments: payments.map((p) => ({ ...p, paymentDate: p.paymentDate.toISOString() })),
        refunds: refunds.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      };
    },
    { isolationLevel: 'repeatable read' },
  );
}

/** Printing is a separate audited access, not an unaudited browser shortcut. */
export async function recordInvoicePrintAccess(
  context: AuthorizationContext,
  rawInvoiceId: number,
) {
  requirePermissions(context, 'billing.read', 'clinical.read');
  const invoice = await scopedInvoice(db, context, validId(rawInvoiceId));
  await requireFinanceEnabled(db, invoice);
  const [record] = await db
    .select({ invoiceId: schema.billingInvoiceFinalizations.invoiceId })
    .from(schema.billingInvoiceFinalizations)
    .where(
      and(
        eq(schema.billingInvoiceFinalizations.invoiceId, invoice.id),
        eq(schema.billingInvoiceFinalizations.tenantId, invoice.tenantId),
        eq(schema.billingInvoiceFinalizations.facilityId, invoice.facilityId),
      ),
    );
  if (!record || !invoice.finalizedAt)
    throw new InvoiceFinalizationError(
      'INVOICE_NOT_FINALIZED',
      'Only a finalized invoice can be printed.',
      409,
    );
  await db.insert(schema.patientRecordAccessLogs).values({
    patientId: invoice.patientId,
    userId: context.userId,
    tenantId: invoice.tenantId,
    facilityId: invoice.facilityId,
    action: 'PRINT',
    accessChannel: 'STAFF_PORTAL',
    recordType: 'FinalizedInvoice',
    recordId: invoice.id,
    purpose: 'BILLING',
  });
}

/** Attribute an existing receipt without modifying it. Evidence is immutable. */
export async function attributeInvoicePayment(
  context: AuthorizationContext,
  rawInvoiceId: number,
  rawPaymentId: number,
  party: unknown,
  rawReason: unknown,
) {
  requirePermissions(context, 'billing.read', 'billing.payments.record');
  const invoiceId = validId(rawInvoiceId),
    paymentId = validId(rawPaymentId);
  const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
  if ((party !== 'PATIENT' && party !== 'INSURER') || reason.length < 3 || reason.length > 500)
    throw new InvoiceFinalizationError(
      'INVALID_ATTRIBUTION',
      'Choose patient or insurer and provide a reason (3–500 characters).',
      400,
    );
  return db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(schema.billingInvoices)
      .where(eq(schema.billingInvoices.id, invoiceId))
      .for('update');
    if (!invoice)
      throw new InvoiceFinalizationError('INVOICE_NOT_FOUND', 'Invoice not found.', 404);
    requireTenantScope(context, invoice.tenantId);
    requireFacilityScope(context, invoice.tenantId, invoice.facilityId);
    await requireFinanceEnabled(tx, invoice);
    const [payment] = await tx
      .select({ id: schema.billingPayments.id })
      .from(schema.billingPayments)
      .where(
        and(
          eq(schema.billingPayments.id, paymentId),
          eq(schema.billingPayments.invoiceId, invoiceId),
        ),
      )
      .for('update');
    if (!payment)
      throw new InvoiceFinalizationError(
        'PAYMENT_NOT_FOUND',
        'Receipt not found for this invoice.',
        404,
      );
    if (party === 'PATIENT') {
      const linked = await tx.execute(sql`SELECT (
        EXISTS(SELECT 1 FROM insurance_claims WHERE settled_payment_id=${paymentId}) OR
        EXISTS(SELECT 1 FROM insurance_reconciliation_entries WHERE posted_payment_id=${paymentId}) OR
        EXISTS(SELECT 1 FROM private_insurance_remittance_allocations WHERE posted_payment_id=${paymentId}) OR
        EXISTS(SELECT 1 FROM sha_eclaims WHERE settled_payment_id=${paymentId}) OR
        EXISTS(SELECT 1 FROM private_insurance_claims WHERE settled_payment_id=${paymentId})
      ) AS linked`);
      if ((linked as unknown as { rows: Array<{ linked: boolean }> }).rows[0]?.linked)
        throw new InvoiceFinalizationError(
          'PAYER_PAYMENT_REVIEW_REQUIRED',
          'This receipt is linked to a payer claim and cannot be attributed to the patient.',
          409,
        );
    }
    if (party === 'INSURER') {
      const [refund] = await tx
        .select({ id: schema.billingRefunds.id })
        .from(schema.billingRefunds)
        .where(eq(schema.billingRefunds.paymentId, paymentId))
        .limit(1);
      if (refund)
        throw new InvoiceFinalizationError(
          'PAYER_REFUND_REVIEW_REQUIRED',
          'A refunded receipt requires payer reversal review before insurer attribution.',
          409,
        );
    }
    const [existing] = await tx
      .select()
      .from(schema.billingPaymentAttributions)
      .where(eq(schema.billingPaymentAttributions.paymentId, paymentId));
    if (existing) {
      if (existing.party === party && existing.reason === reason)
        return { id: existing.id, idempotentReplay: true };
      throw new InvoiceFinalizationError(
        'ATTRIBUTION_EXISTS',
        'This receipt already has immutable attribution. A controlled correction process is required.',
        409,
      );
    }
    const [created] = await tx
      .insert(schema.billingPaymentAttributions)
      .values({
        tenantId: invoice.tenantId,
        facilityId: invoice.facilityId,
        invoiceId,
        paymentId,
        party: party as PaymentParty,
        reason,
        actorUserId: context.userId,
      })
      .returning();
    await tx.insert(schema.auditLogs).values({
      tenantId: invoice.tenantId,
      facilityId: invoice.facilityId,
      userId: String(context.userId),
      action: 'ATTRIBUTE',
      resource: 'Payment',
      resourceId: String(paymentId),
      details: `Receipt attributed to ${party}.`,
    });
    return { id: created.id, idempotentReplay: false };
  });
}
