import { randomUUID, randomBytes } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { describeDb } from './support/db.ts';
import {
  assertSyntheticDatabaseIdentity,
  assertSyntheticTarget,
} from './support/synthetic-db-identity.ts';
import { db, pool } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import {
  createRefundRequest,
  listRefundRequests,
  decideRefundRequest,
} from '../../billing/refund-requests.service.ts';
import { recordManualRefund } from '../../billing/refunds.service.ts';
import { finalizeInvoice } from '../../billing/finalized-invoice.service.ts';
import { recordSettledPayment, settleVerifiedBankPayment } from '../../billing/payments.service.ts';
import {
  createAccountScoped,
  createFinancialPeriodScoped,
} from '../../accounting/accounting.service.ts';
import { postBillingSourceScoped } from '../../accounting/billing-posting.service.ts';
import {
  importStatementScoped,
  matchBankTransactionScoped,
  previewBankReconciliationScoped,
  saveBankReconciliationScoped,
  approveBankReconciliationScoped,
  unmatchBankTransactionScoped,
  previewStatementImportScoped,
} from '../../accounting/bank-integration.service.ts';
import {
  saveBankAccount,
  enableBankOnly,
  listBankPayments,
  submitBankPayment,
  verifyBankPayment,
  rejectBankPayment,
  bankPolicy,
} from '../../bank-payments/service.ts';

describeDb('controlled bank payments: real synthetic PostgreSQL, no provider network', () => {
  let maker: AuthorizationContext,
    verifier: AuthorizationContext,
    approver: AuthorizationContext,
    other: AuthorizationContext,
    sameTenantOther: AuthorizationContext;
  let bankId: number,
    invoiceId: number,
    patientId: number,
    encounterId: number,
    tariffId: number,
    ar: number,
    revenue: number,
    bankGl: number,
    otherGl: number,
    recordId: number,
    creditId: number,
    importId: number,
    receiptId: number,
    date: string;
  const suffix = randomUUID().slice(0, 8),
    reference = `BANK-${suffix}`;
  const scope = () => ({
    tenantId: maker.tenantId!,
    facilityId: maker.facilityId!,
    actorUserId: maker.userId,
  });
  const input = () => ({
    facilityId: maker.facilityId!,
    bankAccountId: bankId,
    invoiceId,
    amountKes: '60.00',
    currency: 'KES' as const,
    bankReference: reference,
    paymentDate: date,
    payerParty: 'PATIENT' as const,
    idempotencyKey: `bank-test:${suffix}`,
  });
  beforeAll(async () => {
    const target = {
      host: process.env.SQL_HOST!,
      name: process.env.SQL_DB_NAME!,
      containerClusterIdentifier: process.env.JALICARE_TEST_PG_SYSTEM_IDENTIFIER,
    };
    assertSyntheticTarget(target);
    const identity = await pool.query(
      'SELECT current_database() AS name,inet_server_addr()::text AS address,(pg_control_system()).system_identifier::text AS "clusterIdentifier"',
    );
    assertSyntheticDatabaseIdentity(target, identity.rows[0]);
    process.env.PAYMENT_HUB_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const [t] = await db
      .insert(schema.tenants)
      .values({ name: `Synthetic bank ${suffix}`, slug: `bank-${suffix}` })
      .returning();
    const [tb] = await db
      .insert(schema.tenants)
      .values({ name: `Synthetic outsider ${suffix}`, slug: `bank-out-${suffix}` })
      .returning();
    const fs = await db
      .insert(schema.facilities)
      .values([
        {
          tenantId: t.id,
          code: `BA-${suffix}`,
          name: 'Synthetic Bank A',
          mflCode: `TEST-${suffix}`,
          address: 'Synthetic Road',
          county: 'Synthetic',
          phone: '000',
          enabledModules: ['finance', 'accounting'],
        },
        {
          tenantId: t.id,
          code: `BA2-${suffix}`,
          name: 'Synthetic Bank A2',
          enabledModules: ['finance'],
        },
        {
          tenantId: tb.id,
          code: `BB-${suffix}`,
          name: 'Synthetic Bank B',
          enabledModules: ['finance'],
        },
      ])
      .returning();
    const actors = await db
      .insert(schema.users)
      .values(
        ['maker', 'verifier', 'approver', 'same', 'other'].map((name, i) => ({
          uid: `${name}-${suffix}`,
          username: `${name}-${suffix}`,
          email: `${name}-${suffix}@example.test`,
          passwordHash: 'unused',
          accountStatus: 'ACTIVE',
          fullName: 'Synthetic finance',
          tenantId: i === 4 ? tb.id : t.id,
          facilityId: i === 4 ? fs[2].id : i === 3 ? fs[1].id : fs[0].id,
        })),
      )
      .returning();
    const permissions = [
      'billing.read',
      'billing.update',
      'clinical.read',
      'billing.payments.record',
      'bank_payments.read',
      'bank_payments.submit',
      'bank_payments.verify',
      'bank_payments.settle',
      'bank_payments.configure',
      'billing.refunds.record',
      'billing.refunds.approve',
    ];
    [maker, verifier, approver, sameTenantOther, other] = actors.map((u) => ({
      userId: u.id,
      tenantId: u.tenantId,
      facilityId: u.facilityId,
      roles: ['FACILITY_ADMIN'],
      permissions: [...permissions],
      isSuperAdmin: false,
    }));
    const asset = async (code: string) =>
      (
        await createAccountScoped(scope(), {
          accountCode: code,
          accountName: code,
          accountType: 'ASSET',
          subType: 'GENERAL',
          normalBalance: 'DEBIT',
        })
      ).id;
    bankGl = await asset('BANK');
    otherGl = await asset('OTHER_BANK');
    ar = await asset('PATIENT_AR');
    revenue = (
      await createAccountScoped(scope(), {
        accountCode: 'REVENUE',
        accountName: 'Revenue',
        accountType: 'REVENUE',
        subType: 'GENERAL',
        normalBalance: 'CREDIT',
      })
    ).id;
    await createFinancialPeriodScoped(scope(), {
      periodCode: 'SYN-BANK',
      name: 'Synthetic bank period',
      startDate: '2000-01-01',
      endDate: '2099-12-31',
    });
    date = (await pool.query('SELECT current_date::text AS d')).rows[0].d;
    const [p] = await db
      .insert(schema.patients)
      .values({
        tenantId: t.id,
        registrationFacilityId: fs[0].id,
        mrn: `BANK-${suffix}`,
        firstName: 'Synthetic',
        lastName: 'Test',
        gender: 'Other',
        dateOfBirth: '1990-01-01',
      })
      .returning();
    patientId = p.id;
    const [dept] = await db
      .insert(schema.departments)
      .values({ facilityId: fs[0].id, name: 'Synthetic clinic', code: `CL-${suffix}` })
      .returning();
    const [practitioner] = await db
      .insert(schema.practitioners)
      .values({ tenantId: t.id, facilityId: fs[0].id, fullName: 'Synthetic clinician' })
      .returning();
    const [enc] = await db
      .insert(schema.encounters)
      .values({
        tenantId: t.id,
        facilityId: fs[0].id,
        patientId,
        departmentId: dept.id,
        practitionerId: practitioner.id,
        encounterType: 'OUTPATIENT',
        status: 'COMPLETED',
      })
      .returning();
    encounterId = enc.id;
    await db.insert(schema.diagnoses).values({
      encounterId,
      patientId,
      codingSystem: 'ICD-10',
      icd10Code: 'Z00.0',
      icd10Description: 'Synthetic examination',
    });
    const [tariff] = await db
      .insert(schema.facilityServiceTariffs)
      .values({
        tenantId: t.id,
        facilityId: fs[0].id,
        code: `BANK-T-${suffix}`,
        description: 'Synthetic consultation',
        department: 'OPD',
        fee: '100.00',
      })
      .returning();
    tariffId = tariff.id;
    const [invoice] = await db
      .insert(schema.billingInvoices)
      .values({
        tenantId: t.id,
        facilityId: fs[0].id,
        patientId,
        encounterId,
        invoiceNumber: `BANK-INV-${suffix}`,
        totalAmount: '100.00',
        paidAmount: '0.00',
        balanceAmount: '100.00',
        status: 'Unpaid',
        payerType: 'Cash',
      })
      .returning();
    invoiceId = invoice.id;
    await db.insert(schema.billingItems).values({
      invoiceId,
      tariffId,
      tariffCode: tariff.code,
      sourceType: 'OPD',
      itemType: 'Consultation',
      description: 'Synthetic consultation',
      quantity: 1,
      unitPrice: '100.00',
      totalAmount: '100.00',
    });
    await finalizeInvoice(maker, invoiceId, {
      insurerResponsibility: '0.00',
      copayment: '0.00',
      allocationBasis: 'Synthetic patient allocation',
    });
  });
  it('denies configuration by a delegated task user, platform admin and wrong facility', async () => {
    const body = {
      facilityId: maker.facilityId!,
      accountName: 'Synthetic bank',
      bankName: 'Synthetic bank',
      bankCode: 'TEST',
      branchName: 'Synthetic',
      currency: 'KES',
      glAccountId: bankGl,
      accountIdentifier: '000012349876',
      isActive: true,
      provider: 'NCBA',
      environment: 'MANUAL',
    };
    await expect(saveBankAccount({ ...maker, roles: ['CASHIER'] }, body)).rejects.toMatchObject({
      status: 403,
    });
    await expect(saveBankAccount({ ...maker, isSuperAdmin: true }, body)).rejects.toMatchObject({
      status: 403,
    });
    await expect(saveBankAccount(other, body)).rejects.toThrow();
    bankId = (await saveBankAccount(maker, body)).id;
    await enableBankOnly(maker, maker.facilityId!);
    expect(await bankPolicy(maker, maker.facilityId!)).toMatchObject({
      bankOnly: true,
      apiInitiationAvailable: false,
    });
    const workspace = await listBankPayments(maker, maker.facilityId!);
    expect(workspace.accounts[0].accountNumberMasked).toBe('****9876');
    expect(JSON.stringify(workspace)).not.toContain('000012349876');
    expect(JSON.stringify(workspace)).not.toContain('encrypted_identifier');
    const vault = await pool.query(
      'SELECT encrypted_identifier FROM bank_account_identifiers WHERE bank_account_id=$1',
      [bankId],
    );
    expect(vault.rows[0].encrypted_identifier).not.toContain('000012349876');
  });
  it('lists a finalized scoped invoice and records pending without a receipt or balance change', async () => {
    const workspace = await listBankPayments(maker, maker.facilityId!);
    expect(workspace.invoices.find((i) => i.id === invoiceId).balanceAmount).toBe('100.00');
    recordId = (await submitBankPayment(maker, input())).id;
    expect(await submitBankPayment(maker, input())).toMatchObject({
      id: recordId,
      idempotentReplay: true,
    });
    await expect(
      submitBankPayment(maker, { ...input(), amountKes: '59.00' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const counts = await pool.query(
      'SELECT (SELECT count(*) FROM billing_payments WHERE invoice_id=$1)::int AS receipts,(SELECT balance_amount::text FROM billing_invoices WHERE id=$1) AS balance',
      [invoiceId],
    );
    expect(counts.rows[0]).toEqual({ receipts: 0, balance: '100.00' });
  });
  it('blocks generic methods, aliases and direct SQL receipt bypasses', async () => {
    for (const method of ['Cash', 'BANK_TRANSFER', 'bank', 'EFT', 'RTGS', 'M-Pesa']) {
      await expect(
        recordSettledPayment(
          maker,
          {
            facilityId: maker.facilityId!,
            invoiceId,
            amount: '1.00',
            paymentMethod: method,
            transactionCode: 'QGH4XYZ123',
            payerParty: 'PATIENT',
            idempotencyKey: randomUUID(),
          },
          'Synthetic',
        ),
      ).rejects.toMatchObject({ code: 'BANK_VERIFICATION_REQUIRED' });
    }
    await expect(
      pool.query(
        "INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,cashier_name) VALUES($1,$2,'Cash',1,'Synthetic')",
        [invoiceId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      settleVerifiedBankPayment(approver, maker.facilityId!, recordId, 'Synthetic'),
    ).rejects.toMatchObject({ code: 'BANK_PAYMENT_UNAVAILABLE' });
  });
  it('requires exact imported credit and different verifier; unmatched evidence never settles automatically', async () => {
    const r = await importStatementScoped(scope(), bankId, {
      startDate: date,
      endDate: date,
      closingBalanceKes: '60.00',
      csvText: `date,reference,description,direction,amount\n${date},${reference},Synthetic transfer,INFLOW,60.00`,
    });
    importId = r.statementImportId;
    creditId = (
      await pool.query('SELECT id FROM bank_transactions WHERE statement_import_id=$1', [importId])
    ).rows[0].id;
    const body = {
      facilityId: maker.facilityId!,
      statementTransactionId: creditId,
      notes: 'Independently obtained statement compared with receiving account.',
      attested: true,
    };
    await expect(verifyBankPayment(maker, recordId, body)).rejects.toMatchObject({
      code: 'INDEPENDENT_REVIEW_REQUIRED',
    });
    await expect(
      verifyBankPayment(verifier, recordId, { ...body, statementTransactionId: 99999999 }),
    ).rejects.toMatchObject({ code: 'BANK_EVIDENCE_MISMATCH' });
    await verifyBankPayment(verifier, recordId, body);
    expect(await verifyBankPayment(verifier, recordId, body)).toMatchObject({
      idempotentReplay: true,
    });
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM billing_payments WHERE invoice_id=$1', [
          invoiceId,
        ])
      ).rows[0].n,
    ).toBe(0);
    await expect(
      settleVerifiedBankPayment(verifier, maker.facilityId!, recordId, 'Synthetic'),
    ).rejects.toMatchObject({ code: 'INDEPENDENT_REVIEW_REQUIRED' });
  });
  it('settles once under concurrent retries and rechecks invoice/party balance; evidence and receipt immutable', async () => {
    const constraint = `bank_audit_failure_${suffix}`;
    await pool.query(
      `ALTER TABLE audit_logs ADD CONSTRAINT ${constraint} CHECK (facility_id<>${maker.facilityId} OR action<>'CREATE') NOT VALID`,
    );
    try {
      await expect(
        settleVerifiedBankPayment(approver, maker.facilityId!, recordId, 'Synthetic'),
      ).rejects.toThrow();
      const state = await pool.query(
        'SELECT status,approved_by_user_id,billing_payment_id FROM bank_payment_records WHERE id=$1',
        [recordId],
      );
      expect(state.rows[0]).toEqual({
        status: 'VERIFIED',
        approved_by_user_id: null,
        billing_payment_id: null,
      });
      expect(
        (
          await pool.query('SELECT count(*)::int AS n FROM billing_payments WHERE invoice_id=$1', [
            invoiceId,
          ])
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await pool.query(`ALTER TABLE audit_logs DROP CONSTRAINT ${constraint}`);
    }

    const results = await Promise.all([
      settleVerifiedBankPayment(approver, maker.facilityId!, recordId, 'Synthetic'),
      settleVerifiedBankPayment(approver, maker.facilityId!, recordId, 'Synthetic'),
    ]);
    receiptId = results[0].payment.id;
    expect(results[1].payment.id).toBe(receiptId);
    expect(results.some((r) => r.idempotentReplay)).toBe(true);
    expect(results[0].invoice.balanceAmount).toBe('40.00');
    expect(results[0].payment.referenceCode).toBe(reference.toUpperCase());
    expect(results[0].payment.bankPaymentRecordId).toBe(recordId);
    await expect(
      pool.query('UPDATE bank_payment_records SET amount_kes=59 WHERE id=$1', [recordId]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('UPDATE bank_transactions SET amount_kes=59 WHERE id=$1', [creditId]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM bank_payment_events WHERE bank_payment_id=$1', [recordId]),
    ).rejects.toMatchObject({ code: '23514' });
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM billing_payments WHERE invoice_id=$1', [
          invoiceId,
        ])
      ).rows[0].n,
    ).toBe(1);
  });
  it('enforces the receiving bank GL and posts a balanced source-linked journal without duplicating revenue', async () => {
    await postBillingSourceScoped(scope(), 'BILLING_INVOICE', invoiceId, {
      entryDate: date,
      description: 'Synthetic finalized invoice posting',
      idempotencyKey: randomUUID(),
      patientReceivableAccountId: ar,
      revenueAccountId: revenue,
    });
    await expect(
      postBillingSourceScoped(scope(), 'BILLING_PAYMENT', receiptId, {
        entryDate: date,
        description: 'Wrong bank attempt',
        idempotencyKey: randomUUID(),
        settlementAccountId: otherGl,
      }),
    ).rejects.toMatchObject({ code: 'BANK_SETTLEMENT_ACCOUNT_MISMATCH' });
    const posted = await postBillingSourceScoped(scope(), 'BILLING_PAYMENT', receiptId, {
      entryDate: date,
      description: 'Synthetic bank receipt',
      idempotencyKey: randomUUID(),
      settlementAccountId: bankGl,
    });
    const lines = await pool.query(
      'SELECT account_id,debit_cents::text,credit_cents::text FROM journal_lines WHERE journal_entry_id=$1 ORDER BY account_id',
      [posted.journal.id],
    );
    expect(lines.rows).toContainEqual({
      account_id: bankGl,
      debit_cents: '6000',
      credit_cents: '0',
    });
    expect(lines.rows).toContainEqual({ account_id: ar, debit_cents: '0', credit_cents: '6000' });
    expect(lines.rows.some((l) => l.account_id === revenue)).toBe(false);
    const bankLine = lines.rows.find((l) => l.account_id === bankGl)!;
    expect(bankLine).toBeTruthy();
    const line = (
      await pool.query('SELECT id FROM journal_lines WHERE journal_entry_id=$1 AND account_id=$2', [
        posted.journal.id,
        bankGl,
      ])
    ).rows[0].id;
    await matchBankTransactionScoped(scope(), creditId, line);
    const worksheet = await previewBankReconciliationScoped(scope(), bankId, importId);
    expect(worksheet).toMatchObject({
      differenceKes: '0.00',
      worksheetBalanced: true,
      unmatchedStatementCount: 0,
      bankConfirmed: false,
    });
  });
  it('denies other tenant and same-tenant other facility; account isolation holds for every operation', async () => {
    for (const outsider of [other, sameTenantOther]) {
      await expect(listBankPayments(outsider, maker.facilityId!)).rejects.toThrow();
      await expect(
        submitBankPayment(outsider, {
          ...input(),
          facilityId: outsider.facilityId,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'BANK_POLICY_REQUIRED' });
      await expect(
        verifyBankPayment(outsider, recordId, {
          facilityId: outsider.facilityId,
          statementTransactionId: creditId,
          notes: 'Synthetic unauthorized attempt',
          attested: true,
        }),
      ).rejects.toMatchObject({ code: 'BANK_PAYMENT_NOT_FOUND' });
      await expect(
        settleVerifiedBankPayment(outsider, outsider.facilityId!, recordId, 'Synthetic'),
      ).rejects.toMatchObject({ code: 'BANK_PAYMENT_NOT_FOUND' });
    }
  });
  it('rejects non-KES, overpayment and unauthorized mutation; rejected intent never receipts', async () => {
    await expect(
      submitBankPayment(maker, { ...input(), currency: 'USD', idempotencyKey: randomUUID() }),
    ).rejects.toThrow();
    await expect(
      submitBankPayment(maker, { ...input(), amountKes: '100.00', idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'PAYMENT_EXCEEDS_BALANCE' });
    const r = await submitBankPayment(maker, {
      ...input(),
      amountKes: '10.00',
      idempotencyKey: randomUUID(),
    });
    await rejectBankPayment(verifier, r.id, {
      facilityId: maker.facilityId!,
      reason: 'No corresponding independent statement credit.',
    });
    await expect(
      settleVerifiedBankPayment(approver, maker.facilityId!, r.id, 'Synthetic'),
    ).rejects.toMatchObject({ code: 'BANK_PAYMENT_UNAVAILABLE' });
    const workspace = await listBankPayments(maker, maker.facilityId!);
    expect(workspace.payments.find((p) => p.id === r.id)).toMatchObject({
      status: 'REJECTED',
      billingPaymentId: null,
    });
  });
  it('rejects duplicate imports and consumed statement evidence; unsupported providers remain manual', async () => {
    const preview = await previewStatementImportScoped(scope(), bankId, {
      startDate: date,
      endDate: date,
      closingBalanceKes: '60.00',
      csvText: `date,reference,description,direction,amount\n${date},${reference},Synthetic transfer,INFLOW,60.00`,
    });
    expect(preview).toMatchObject({ overlappingLines: 1, canImport: false });
    const replay = await importStatementScoped(scope(), bankId, {
      startDate: date,
      endDate: date,
      closingBalanceKes: '60.00',
      csvText: `date,reference,description,direction,amount\n${date},${reference},Synthetic transfer,INFLOW,60.00`,
    });
    expect(replay.idempotentReplay).toBe(true);
    const response = await listBankPayments(maker, maker.facilityId!);
    expect(response.apiInitiationAvailable).toBe(false);
    expect(response.accounts[0].provider).toBe('NCBA');
    await expect(
      saveBankAccount(
        maker,
        {
          facilityId: maker.facilityId!,
          accountName: 'Changed identity',
          bankName: 'Synthetic bank',
          bankCode: 'TEST',
          branchName: 'Synthetic',
          currency: 'KES',
          glAccountId: bankGl,
          accountIdentifier: '00009999',
          isActive: true,
          provider: 'NCBA',
          environment: 'MANUAL',
        },
        bankId,
      ),
    ).rejects.toMatchObject({ code: 'BANK_IDENTITY_IMMUTABLE' });
  });
  it('does not refund bank money on a reference or manual confirmation alone', async () => {
    await expect(
      createRefundRequest(maker, {
        facilityId: maker.facilityId!,
        invoiceId,
        paymentId: receiptId,
        amount: '20.00',
        refundMethod: 'CASH',
        reason: 'Synthetic bank refund',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'BANK_VERIFICATION_REQUIRED' });
    await expect(
      recordManualRefund(maker, {
        facilityId: maker.facilityId!,
        invoiceId,
        paymentId: receiptId,
        amount: '20.00',
        refundMethod: 'BANK_TRANSFER',
        externalReference: 'NO-EVIDENCE',
        reason: 'Synthetic bank refund',
        manualConfirmation: true,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'BANK_VERIFICATION_REQUIRED' });
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM billing_refunds WHERE payment_id=$1', [
          receiptId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });
  let refundImport: number, refundLine: number;
  it('records one authorized evidenced partial bank refund, corrects balances and posts compensating GL', async () => {
    const r = await importStatementScoped({ ...scope(), actorUserId: verifier.userId }, bankId, {
      startDate: date,
      endDate: date,
      closingBalanceKes: '40.00',
      csvText: `date,reference,description,direction,amount\n${date},REFUND-${suffix},Synthetic refund,OUTFLOW,20.00`,
    });
    refundImport = r.statementImportId;
    const debit = (
      await pool.query('SELECT id FROM bank_transactions WHERE statement_import_id=$1', [
        refundImport,
      ])
    ).rows[0].id;
    const key = randomUUID(),
      reason = 'Synthetic independently approved bank refund';
    const requested = await createRefundRequest(maker, {
      facilityId: maker.facilityId!,
      invoiceId,
      paymentId: receiptId,
      amount: '20.00',
      refundMethod: 'BANK_TRANSFER',
      reason,
      idempotencyKey: key,
    });
    const page = await listRefundRequests(verifier, { facilityId: maker.facilityId!, invoiceId });
    const q = page.requests.find((q) => q.id === requested.request.id)!;
    await expect(
      decideRefundRequest(maker, q.id, {
        facilityId: maker.facilityId!,
        decision: 'APPROVE',
        reviewHash: q.reviewHash,
        notes: 'Cannot approve own refund',
      }),
    ).rejects.toMatchObject({ code: 'SELF_REFUND_APPROVAL_FORBIDDEN' });
    await decideRefundRequest(verifier, q.id, {
      facilityId: maker.facilityId!,
      decision: 'APPROVE',
      reviewHash: q.reviewHash,
      notes: 'Independent synthetic review complete',
    });
    const body = {
      facilityId: maker.facilityId!,
      invoiceId,
      paymentId: receiptId,
      amount: '20.00',
      refundMethod: 'BANK_TRANSFER',
      externalReference: `REFUND-${suffix}`,
      bankStatementTransactionId: debit,
      reason,
      manualConfirmation: true,
      idempotencyKey: key,
    };
    // The evidence importer cannot also attest recording the executed refund.
    await expect(recordManualRefund(verifier, body)).rejects.toMatchObject({
      code: 'BANK_VERIFICATION_REQUIRED',
    });
    const result = await recordManualRefund(maker, body);
    expect((await recordManualRefund(maker, body)).replayed).toBe(true);
    expect(
      (
        await pool.query(
          'SELECT balance_amount::text,paid_amount::text FROM billing_invoices WHERE id=$1',
          [invoiceId],
        )
      ).rows[0],
    ).toEqual({ balance_amount: '60.00', paid_amount: '40.00' });
    const posted = await postBillingSourceScoped(scope(), 'BILLING_REFUND', result.refund.id, {
      entryDate: date,
      description: 'Verified synthetic bank refund',
      idempotencyKey: randomUUID(),
      settlementAccountId: bankGl,
      receivableRefundKes: '20.00',
    });
    const lines = await pool.query(
      'SELECT id,account_id,debit_cents::text,credit_cents::text FROM journal_lines WHERE journal_entry_id=$1',
      [posted.journal.id],
    );
    expect(lines.rows).toContainEqual(
      expect.objectContaining({ account_id: bankGl, debit_cents: '0', credit_cents: '2000' }),
    );
    expect(lines.rows).toContainEqual(
      expect.objectContaining({ account_id: ar, debit_cents: '2000', credit_cents: '0' }),
    );
    refundLine = debit;
    await matchBankTransactionScoped(
      scope(),
      debit,
      lines.rows.find((l) => l.account_id === bankGl).id,
    );
    expect(
      (await listBankPayments(maker, maker.facilityId!)).payments.find((p) => p.id === recordId),
    ).toMatchObject({ refundedKes: '20.00', status: 'SETTLED' });
  });
  it('independently approves balanced reconciliation and freezes covered matches, imports and journals', async () => {
    expect(await previewBankReconciliationScoped(scope(), bankId, refundImport)).toMatchObject({
      differenceKes: '0.00',
      worksheetBalanced: true,
      unmatchedStatementCount: 0,
      bankConfirmed: false,
    });
    const prepared = await saveBankReconciliationScoped(scope(), bankId, refundImport, {
      periodCode: 'SYN-BANK',
      reviewNotes: 'Synthetic exact receipt and refund reviewed',
      idempotencyKey: randomUUID(),
    });
    await expect(
      approveBankReconciliationScoped(scope(), prepared.reconciliationId, {
        approvalNotes: 'Cannot approve own preparation',
      }),
    ).rejects.toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN' });
    await approveBankReconciliationScoped(
      { ...scope(), actorUserId: verifier.userId },
      prepared.reconciliationId,
      { approvalNotes: 'Independent synthetic statement approval' },
    );
    for (const id of [creditId, refundLine])
      await expect(
        unmatchBankTransactionScoped(scope(), id, 'Cannot change signed evidence'),
      ).rejects.toMatchObject({ code: 'RECONCILIATION_APPROVED' });
    await expect(
      importStatementScoped(scope(), bankId, {
        startDate: date,
        endDate: date,
        closingBalanceKes: '41.00',
        csvText: `date,reference,description,direction,amount\n${date},LATE-${suffix},Late entry,INFLOW,1.00`,
      }),
    ).rejects.toMatchObject({ code: 'RECONCILIATION_APPROVED' });
  });
  it('enforces mounted HTTP authentication, scoped access, configuration secrecy and safe settlement retry', async () => {
    const { createSession } = await import('../../auth/session.service.ts');
    const { createApp } = await import('../../app.ts');
    const permissions = [
      'bank_payments.read',
      'bank_payments.submit',
      'bank_payments.verify',
      'bank_payments.settle',
      'bank_payments.configure',
      'billing.payments.record',
      'billing.read',
    ];
    // Grant a real persisted facility role: the middleware builds its own auth context.
    const role = await pool.query(
      `INSERT INTO roles(tenant_id,name,is_active) VALUES($1,'FACILITY_ADMIN',true) ON CONFLICT(tenant_id,name) DO UPDATE SET is_active=true RETURNING id`,
      [maker.tenantId],
    );
    for (const code of permissions) {
      await pool.query(
        `INSERT INTO permissions(code,name,module) VALUES($1,$1,'bank_payments') ON CONFLICT(code) DO NOTHING`,
        [code],
      );
      await pool.query(
        `INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2 ON CONFLICT DO NOTHING`,
        [role.rows[0].id, code],
      );
    }
    for (const actor of [maker, approver, sameTenantOther])
      await pool.query(
        'INSERT INTO user_roles(user_id,role_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [actor.userId, role.rows[0].id],
      );
    const session = await createSession({ userId: maker.userId, securityVersion: 1 });
    const approval = await createSession({ userId: approver.userId, securityVersion: 1 });
    const outsider = await createSession({ userId: sameTenantOther.userId, securityVersion: 1 });
    const app = await createApp();
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api/bank-payments`;
    const request = async (path: string, token?: string, body?: unknown) =>
      fetch(`${base}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    try {
      expect((await request(`?facilityId=${maker.facilityId}`)).status).toBe(401);
      const list = await request(`?facilityId=${maker.facilityId}`, session.sessionToken);
      expect(list.status).toBe(200);
      expect(list.headers.get('cache-control')).toBe('no-store');
      const workspace = await list.json();
      expect(workspace.payments.some((p: { id: number }) => p.id === recordId)).toBe(true);
      expect(JSON.stringify(workspace)).not.toMatch(
        /ciphertext|identifierHash|encryptionKey|synthetic-account-number/i,
      );
      expect(workspace.configurationHistory.length).toBeGreaterThan(0);
      expect((await request('?facilityId=invalid', session.sessionToken)).status).toBe(400);
      expect((await request(`?facilityId=${maker.facilityId}`, outsider.sessionToken)).status).toBe(
        403,
      );
      const replay = await request(`/${recordId}/approve-and-settle`, approval.sessionToken, {
        facilityId: maker.facilityId,
      });
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ success: true, idempotentReplay: true });
      const readOnlyRole = await pool.query(
        `INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id`,
        [other.tenantId, `BANK_READ_ONLY_${suffix}`],
      );
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
        other.userId,
        readOnlyRole.rows[0].id,
      ]);
      const readOnly = await createSession({ userId: other.userId, securityVersion: 1 });
      expect(
        (await request('/policy/enable', readOnly.sessionToken, { facilityId: other.facilityId }))
          .status,
      ).toBe(403);
      expect(
        (await request('/accounts', readOnly.sessionToken, { facilityId: other.facilityId }))
          .status,
      ).toBe(403);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
