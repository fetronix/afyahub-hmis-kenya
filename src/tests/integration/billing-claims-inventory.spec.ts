import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { createMockDbState } from './support/drizzle-mock.ts';

const mockDb = vi.hoisted(() => ({ state: null as ReturnType<typeof createMockDbState> | null }));
const queriesMocks = vi.hoisted(() => ({
  getFacilityByIdScoped: vi.fn(),
  requirePatientInTenant: vi.fn(),
}));

vi.mock('../../db/index.ts', async () => {
  const { createMockDbState: make } = await import('./support/drizzle-mock.ts');
  mockDb.state = make();
  return {
    db: mockDb.state.executor,
    pool: { query: vi.fn() },
  };
});

vi.mock('../../db/index', async () => {
  const { createMockDbState: make } = await import('./support/drizzle-mock.ts');
  if (!mockDb.state) mockDb.state = make();
  return {
    db: mockDb.state.executor,
    pool: { query: vi.fn() },
  };
});

vi.mock('../../db/queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/queries.ts')>();
  return {
    ...actual,
    getFacilityByIdScoped: queriesMocks.getFacilityByIdScoped,
    requirePatientInTenant: queriesMocks.requirePatientInTenant,
  };
});

const billing = await import('../../billing/billing.service.ts');
const attempts = await import('../../billing/charge-attempts.ts');
const claims = await import('../../insurance/claims.service.ts');
const inventory = await import('../../inventory/inventory.service.ts');

const ctx: AuthorizationContext = {
  userId: 10,
  tenantId: 1,
  facilityId: 10,
  roles: ['FACILITY_ADMIN'],
  permissions: ['billing.read', 'billing.write', 'pharmacy.write', 'inventory.write'],
  isSuperAdmin: false,
};

describe('Billing, Charge Attempts, Insurance Claims & FEFO Inventory Domain Services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.state?.reset();
    queriesMocks.getFacilityByIdScoped.mockImplementation(
      async (_context: AuthorizationContext, facilityId: number) =>
        facilityId === 10
          ? {
              id: 10,
              tenantId: 1,
              enabledModules: ['finance', 'insurance', 'pharmacy', 'inventory'],
            }
          : null,
    );
    queriesMocks.requirePatientInTenant.mockImplementation(
      async (_context: AuthorizationContext, patientId: number) =>
        patientId === 42 ? { id: 42, tenantId: 1 } : null,
    );
  });

  it('exercises billing tariff pricing, invoice recalculation, idempotency, bed-day segments, and revenue analytics', async () => {
    expect(billing.toCents('1250.50')).toBe(125_050);
    expect(billing.fromCents(125_050)).toBe('1250.50');
    expect(billing.isMissingBillingKeyColumn({ code: '42703' })).toBe(true);
    expect(billing.isMissingBillingKeyColumn({ code: '23505' })).toBe(false);

    expect(
      billing.buildIdempotencyKey({
        sourceType: 'CONSULTATION',
        sourceId: 88,
      }),
    ).toContain('CONSULTATION:88');

    expect(billing.bedDayTariffCodes('MAT')).toEqual([
      'BED-MAT',
      'WARD-MAT',
      'BED-DAY',
      'INPATIENT-BED-DAY',
      'WARD-DAY',
      'BED',
    ]);
    expect(billing.bedDayDates('2026-10-01T10:00:00Z', '2026-10-03T09:00:00Z')).toEqual([
      '2026-10-01',
      '2026-10-02',
    ]);

    const segments = billing.bedDaySegments({
      admissionDate: '2026-10-01T10:00:00Z',
      dischargeDate: '2026-10-04T09:00:00Z',
      homeWard: { id: 2, code: 'HDU', name: 'High Dependency Unit', wardType: 'HDU' },
      transfers: [
        {
          toWardId: 2,
          fromWardId: 1,
          transferredAt: '2026-10-02T14:00:00Z',
          fromWard: { id: 1, code: 'GEN', name: 'General Ward', wardType: 'General' },
          ward: { id: 2, code: 'HDU', name: 'High Dependency Unit', wardType: 'HDU' },
        },
      ],
    });
    expect(segments.length).toBeGreaterThanOrEqual(2);

    // chargeForService: missing tariff -> TARIFF_NOT_CONFIGURED
    mockDb.state!.queueSelect([{ id: 42 }], [{ id: 10 }], [], [], []); // scope, prior charge, tariffs and diagnostics
    const unpriced = await billing.chargeForService(mockDb.state!.executor as any, {
      tenantId: 1,
      facilityId: 10,
      patientId: 42,
      sourceType: 'CONSULTATION',
      sourceId: 88,
      itemType: 'Consultation',
      codes: ['CONS-OPD'],
    });
    expect(unpriced.charged).toBe(false);
    expect(unpriced.reason).toBe('TARIFF_NOT_CONFIGURED');

    // chargeForService: matched active tariff -> inserts item + recalculates invoice
    mockDb.state!.reset();
    mockDb.state!.queueSelect(
      [{ id: 42 }], // locked patient
      [{ id: 10 }], // authorized facility
      [], // no prior source charge
      [
        {
          id: 5,
          facilityId: 10,
          code: 'CONS-OPD',
          serviceKey: 'consultation.opd',
          description: 'OPD Consultation',
          category: 'Consultation',
          fee: '1500.00',
          unit: 'visit',
          isActive: true,
          autoBillable: true,
          effectiveFrom: null,
          effectiveTo: null,
        },
      ], // loadActiveFacilityTariffs
      [], // no tariff links
      [
        {
          id: 900,
          invoiceNumber: 'INV-900',
          status: 'Pending',
          totalAmount: '0.00',
          paidAmount: '0.00',
          balanceAmount: '0.00',
          creditBalance: '0.00',
          voidedAt: null,
        },
      ], // locked existing open invoice
      [{ total: '0.00', invalid: 0 }], // line total before charging
      [], // no existing payments
      [{ total: '1500.00', invalid: 0 }], // totals after insert
      [{ id: 900, paidAmount: '0.00', status: 'Pending' }], // locked header
    );
    mockDb.state!.queueInsert([{ id: 701, invoiceId: 900, totalAmount: '1500.00' }]);
    mockDb.state!.queueUpdate([
      {
        id: 900,
        totalAmount: '1500.00',
        paidAmount: '0.00',
        balanceAmount: '1500.00',
        status: 'Pending',
      },
    ]);

    const charged = await billing.chargeForService(mockDb.state!.executor as any, {
      tenantId: 1,
      facilityId: 10,
      patientId: 42,
      sourceType: 'CONSULTATION',
      sourceId: 89,
      itemType: 'Consultation',
      codes: ['CONS-OPD'],
    });
    expect(charged.charged).toBe(true);
    expect(charged.unitPrice).toBe('1500.00');

    // Revenue analytics helpers
    mockDb.state!.reset();
    mockDb.state!.queueSelect([
      { itemType: 'Consultation', lineCount: 4, grossAmount: '6000.00' },
      { itemType: 'Lab', lineCount: 2, grossAmount: '1800.00' },
    ]);
    const byService = await billing.getRevenueByServiceType(mockDb.state!.executor as any, 10);
    expect(byService).toHaveLength(2);

    mockDb.state!.queueSelect([
      { method: 'M-Pesa', paymentCount: 3, amount: '4500.00' },
      { method: 'Cash', paymentCount: 1, amount: '500.00' },
    ]);
    const byChannel = await billing.getRevenueByPaymentChannel(mockDb.state!.executor as any, 10);
    expect(byChannel.totalCents).toBe(500_000);

    mockDb.state!.queueSelect([
      {
        invoiceCount: 4,
        voidedCount: 0,
        invoiced: '7800.00',
        collected: '5000.00',
        outstanding: '2800.00',
      },
    ]);
    const totals = await billing.getRevenueTotals(mockDb.state!.executor as any, 10);
    expect(totals.invoiced).toBe('7800.00');
  });

  it('records, lists, retries, and voids unpriced billing charge attempts', async () => {
    expect(attempts.isMissingAttemptsTable({ code: '42P01' })).toBe(true);
    expect(attempts.isMissingAttemptsTable(null)).toBe(false);

    mockDb.state!.queueInsert([{ id: 31 }]);
    const recordedId = await attempts.recordChargeAttempt(
      mockDb.state!.executor as any,
      {
        tenantId: 1,
        facilityId: 10,
        patientId: 42,
        sourceType: 'CONSULTATION',
        sourceId: 88,
        itemType: 'Consultation',
        codes: ['CONS-OPD'],
      },
      {
        charged: false,
        reason: 'TARIFF_NOT_CONFIGURED',
        message: 'No active tariff matched CONS-OPD',
        codesTried: ['CONS-OPD'],
      },
    );
    expect(recordedId).toBe(31);

    mockDb.state!.queueSelect([{ count: 1 }]);
    expect(
      await attempts.countPendingChargeAttempts(mockDb.state!.executor as any, {
        tenantId: 1,
        facilityId: 10,
      }),
    ).toBe(1);

    mockDb.state!.queueSelect(
      [{ sourceType: 'CONSULTATION', sourceId: 88, idempotencySuffix: null }],
      [
        {
          id: 31,
          tenantId: 1,
          facilityId: 10,
          patientId: 42,
          encounterId: null,
          sourceType: 'CONSULTATION',
          sourceId: 88,
          idempotencySuffix: null,
          wardType: null,
          wardName: null,
          itemType: 'Consultation',
          description: 'OPD Visit',
          codes: ['CONS-OPD'],
          serviceKeys: [],
          family: null,
          serviceName: null,
          encounterType: null,
          aliases: [],
          quantity: 1,
          fallbackUnitPrice: null,
          reason: 'TARIFF_NOT_CONFIGURED',
          detail: 'Missing tariff',
          codesTried: ['CONS-OPD'],
          status: 'BILLED',
          attempts: 1,
          resolvedInvoiceId: 900,
        },
      ],
    );
    const alreadyBilled = await attempts.retryChargeAttempt(mockDb.state!.executor as any, {
      tenantId: 1,
      facilityId: 10,
      attemptId: 31,
    });
    expect(alreadyBilled?.status).toBe('BILLED');

    mockDb.state!.queueSelect(
      [{ sourceType: 'CONSULTATION', sourceId: 88, idempotencySuffix: null }],
      [
        {
          id: 31,
          sourceType: 'CONSULTATION',
          sourceId: 88,
          idempotencySuffix: null,
          status: 'PENDING',
        },
      ],
    );
    mockDb.state!.queueUpdate([{ id: 31 }]);
    const voided = await attempts.voidChargeAttempt(mockDb.state!.executor as any, {
      tenantId: 1,
      facilityId: 10,
      attemptId: 31,
      reason: 'Waived by clinical director',
    });
    expect(voided).toBe(true);
  });

  it('reports an unavailable charge queue instead of treating a database error as zero', async () => {
    const missing = Object.assign(new Error('synthetic missing queue'), { code: '42P01' });
    mockDb.state!.queueSelect(missing);
    await expect(
      attempts.listChargeAttempts(mockDb.state!.executor as any, { tenantId: 1, facilityId: 10 }),
    ).rejects.toBe(missing);
    mockDb.state!.queueSelect(missing);
    await expect(
      attempts.countPendingChargeAttempts(mockDb.state!.executor as any, {
        tenantId: 1,
        facilityId: 10,
      }),
    ).rejects.toBe(missing);
  });

  it('drives the full insurance claim lifecycle: claimable lines -> draft -> submit -> adjudicate -> settle', async () => {
    // Module disabled check -> 403 FACILITY_MODULE_DISABLED
    queriesMocks.getFacilityByIdScoped.mockResolvedValueOnce({
      id: 10,
      tenantId: 1,
      enabledModules: ['finance'],
    });
    await expect(claims.getClaimableLinesScoped(ctx, 900)).rejects.toMatchObject({
      code: 'FACILITY_MODULE_DISABLED',
      status: 403,
    });

    // Claimable lines
    mockDb.state!.queueSelect(
      [
        {
          id: 900,
          facilityId: 10,
          tenantId: 1,
          invoiceNumber: 'INV-900',
          patientId: 42,
          totalAmount: '3000.00',
          paidAmount: '500.00',
          balanceAmount: '2500.00',
          status: 'Partially Paid',
          payerType: 'SHA',
        },
      ],
      [
        {
          id: 701,
          description: 'OPD Consultation',
          itemType: 'Consultation',
          quantity: 1,
          unitPrice: '3000.00',
          totalAmount: '3000.00',
        },
      ],
      [],
    );
    const claimable = await claims.getClaimableLinesScoped(ctx, 900);
    expect(claimable.lines).toHaveLength(1);

    // Draft claim caps claimAmount at invoice balanceAmount (2500.00 < 3000.00)
    mockDb.state!.queueSelect(
      [
        {
          id: 900,
          facilityId: 10,
          tenantId: 1,
          invoiceNumber: 'INV-900',
          patientId: 42,
          totalAmount: '3000.00',
          paidAmount: '500.00',
          balanceAmount: '2500.00',
          status: 'Partially Paid',
          payerName: 'Social Health Authority (SHA)',
          memberNumber: 'SHA-888',
          voidedAt: null,
        },
      ],
      [], // no existing open claim
      [{ id: 701, description: 'OPD Consultation', totalAmount: '3000.00' }],
    );
    mockDb.state!.queueInsert(
      [{ id: 801, claimNumber: 'CLM-801', claimAmount: '2500.00', status: 'Draft' }],
      [],
    );
    const drafted = await claims.draftClaimScoped(ctx, { invoiceId: 900 }, 10);
    expect(drafted.cappedAtBalance).toBe(true);
    expect(drafted.claim.claimAmount).toBe('2500.00');

    // Submit claim
    mockDb.state!.queueSelect([
      { id: 801, facilityId: 10, tenantId: 1, status: 'Draft', claimAmount: '2500.00' },
    ]);
    mockDb.state!.queueUpdate([{ id: 801, status: 'Submitted' }]);
    const submitted = await claims.submitClaimScoped(ctx, 801);
    expect(submitted.status).toBe('Submitted');

    // Adjudicate: approvedAmount > claimAmount -> 400 APPROVED_EXCEEDS_CLAIM
    mockDb.state!.queueSelect([
      { id: 801, facilityId: 10, tenantId: 1, status: 'Submitted', claimAmount: '2500.00' },
    ]);
    await expect(
      claims.adjudicateClaimScoped(ctx, 801, { approvedAmount: '3000.00' }),
    ).rejects.toMatchObject({ code: 'APPROVED_EXCEEDS_CLAIM', status: 400 });

    // Valid adjudication -> Approved
    mockDb.state!.queueSelect([
      { id: 801, facilityId: 10, tenantId: 1, status: 'Submitted', claimAmount: '2500.00' },
    ]);
    mockDb.state!.queueUpdate([{ id: 801, status: 'Approved', approvedAmount: '2500.00' }]);
    const adjudicated = await claims.adjudicateClaimScoped(ctx, 801, {
      approvedAmount: '2500.00',
      notes: 'Approved per SHA tariff',
    });
    expect(adjudicated.status).toBe('Approved');

    // Settlement requires an independently recorded receipt and remittance reference.
    mockDb.state!.queueSelect([
      {
        id: 801,
        facilityId: 10,
        tenantId: 1,
        invoiceId: 900,
        claimNumber: 'CLM-801',
        status: 'Approved',
        approvedAmount: '2500.00',
        payerCode: 'SHA',
      },
    ]);
    await expect(claims.settleClaimScoped(ctx, 801, 'Cashier Mary')).rejects.toThrow(
      /remittance reference/i,
    );

    // List claims & claim items
    mockDb.state!.queueSelect([{ id: 801, claimNumber: 'CLM-801', status: 'Settled' }]);
    expect(await claims.getClaimsScoped(ctx)).toHaveLength(1);
    mockDb.state!.queueSelect(
      [{ id: 801, facilityId: 10, tenantId: 1 }],
      [{ id: 1, claimId: 801, description: 'OPD Consultation', amount: '3000.00' }],
    );
    expect(await claims.getClaimItemsScoped(ctx, 801)).toHaveLength(1);
  });

  it('enforces FEFO pharmacy batch receipt, expiry refusal, multi-lot allocation, and stock summaries', async () => {
    // Reject already-expired batch
    await expect(
      inventory.receiveBatchScoped(ctx, 50, {
        batchNumber: 'AMOX-OLD',
        expiryDate: '2020-01-01',
        quantity: 100,
        costPerUnit: 5.5,
      }),
    ).rejects.toMatchObject({ code: 'EXPIRED_BATCH', status: 400 });

    // Receive valid batch
    mockDb.state!.queueSelect([{ id: 50, facilityId: 10, name: 'Amoxicillin 500mg' }]);
    mockDb.state!.queueInsert([
      {
        id: 601,
        itemId: 50,
        batchNumber: 'AMOX-2028',
        expiryDate: '2028-06-30',
        quantityRemaining: 100,
        costPerUnit: '5.50',
      },
    ]);
    mockDb.state!.queueUpdate([{ id: 50, currentStock: 100 }]);

    const received = await inventory.receiveBatchScoped(ctx, 50, {
      batchNumber: 'AMOX-2028',
      expiryDate: '2028-06-30',
      quantity: 100,
      costPerUnit: 5.5,
    });
    expect(received.received).toBe(100);

    // FEFO dispense spans two unexpired lots earliest-expiry-first
    mockDb.state!.queueSelect(
      [], // no prior request with this idempotency key
      [
        {
          id: 99,
          patientId: 42,
          encounterId: 55,
          drugName: 'Amoxicillin 500mg',
          status: 'Prescribed',
          quantity: 30,
        },
      ],
      [{ id: 55 }],
      [],
      [
        {
          id: 50,
          facilityId: 10,
          itemCode: 'DRG-AMOX',
          name: 'Amoxicillin 500mg',
          currentStock: 70,
        },
      ],
      [
        { id: 601, batchNumber: 'LOT-LATER', expiryDate: '2028-12-31', quantityRemaining: 50 },
        { id: 602, batchNumber: 'LOT-SOONER', expiryDate: '2027-03-31', quantityRemaining: 20 },
      ],
    );
    mockDb.state!.queueUpdate([], [], [{ id: 50, currentStock: 40 }], []);
    mockDb.state!.queueInsert([{ id: 701, batchNumber: 'LOT-SOONER, LOT-LATER' }]);

    const dispensed = await inventory.dispenseFefoScoped(ctx, {
      patientId: 42,
      itemId: 50,
      prescriptionId: 99,
      quantityDispensed: 30,
      dispensedBy: 'Pharm. Otieno',
      idempotencyKey: 'synthetic-test-dispense',
    });
    expect(dispensed.stockTracking).toBe('FEFO');
    expect(dispensed.allocations).toEqual([
      { batchId: 602, batchNumber: 'LOT-SOONER', expiryDate: '2027-03-31', quantity: 20 },
      { batchId: 601, batchNumber: 'LOT-LATER', expiryDate: '2028-12-31', quantity: 10 },
    ]);

    // Batches, expiry summary & stock-on-hand picker
    mockDb.state!.queueSelect([
      {
        id: 601,
        itemId: 50,
        itemCode: 'DRG-AMOX',
        itemName: 'Amoxicillin 500mg',
        unit: 'Capsules',
        batchNumber: 'LOT-LATER',
        expiryDate: '2028-12-31',
        quantityRemaining: 40,
        costPerUnit: '5.50',
      },
    ]);
    expect(await inventory.getBatchesScoped(ctx, { itemId: 50 })).toHaveLength(1);

    mockDb.state!.queueSelect([
      {
        id: 601,
        itemId: 50,
        itemCode: 'DRG-AMOX',
        itemName: 'Amoxicillin 500mg',
        batchNumber: 'LOT-EXPIRING',
        expiryDate: '2026-11-10',
        quantityRemaining: 40,
        costPerUnit: '5.50',
      },
    ]);
    const summary = await inventory.getExpirySummaryScoped(ctx);
    expect(summary.expiringUnits).toBe(40);
    expect(summary.affectedItems).toBe(1);

    mockDb.state!.queueSelect([
      {
        itemId: 50,
        batchId: 601,
        batchNumber: 'LOT-LATER',
        expiryDate: '2028-12-31',
        quantityRemaining: 40,
      },
    ]);
    const picker = await inventory.getItemBatchStockScoped(ctx, [50]);
    expect(picker[0]).toMatchObject({ itemId: 50, usable: 40 });
  });
});
