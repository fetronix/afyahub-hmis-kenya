/** End-to-end accounting checks against isolated synthetic PostgreSQL data. */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { pool } from '../../db/index.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { createSession } from '../../auth/session.service.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';
import { finalizeInvoice } from '../../billing/finalized-invoice.service.ts';
import { recordSettledPayment } from '../../billing/payments.service.ts';
import { approvedSyntheticManualRefund } from './support/refund-approval.ts';
import { inspectBillingLedgerScoped } from '../../accounting/billing-ledger-diagnostics.service.ts';
import { inspectBillingJournalExceptionsScoped } from '../../accounting/billing-journal-exceptions.service.ts';
import { postBillingSourceScoped } from '../../accounting/billing-posting.service.ts';
import {
  createBankAccountScoped,
  importStatementScoped,
  matchBankTransactionScoped,
  previewBankReconciliationScoped,
  saveBankReconciliationScoped,
} from '../../accounting/bank-integration.service.ts';
import { inspectTariffConfiguration } from '../../billing/tariff-validation.service.ts';
import {
  importTariffs,
  previewTariffImport,
  tariffImportStatus,
} from '../../billing/tariff-import.service.ts';
import {
  createAccountScoped,
  createFinancialPeriodScoped,
  closeFinancialPeriodScoped,
  getAccountingOverviewScoped,
  postInsideTransaction,
  transaction,
  reverseJournalScoped,
  type AccountingScope,
} from '../../accounting/accounting.service.ts';
import { describeDb } from '../vitest/support/db.ts';
import {
  addFacilityAccount,
  configureIntegration,
  initiateCollection,
  listCollectionInvoices,
  saveCredentials,
  setIntegrationEnabled,
  testConnection,
} from '../../payment-hub/service.ts';

describeDb('Reviewed billing-to-ledger bridge', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number, facility: number, foreignFacility: number, actor: number, patient: number;
  let encounter: number, tariff: number, date: string, period: number;
  let scope: AccountingScope, foreignScope: AccountingScope, context: AuthorizationContext;
  let patientAr: number,
    insurerAr: number,
    cash: number,
    liability: number,
    revenue: number,
    foreignAccount: number;
  let seq = 0;
  let base: string,
    close: () => Promise<void>,
    managerToken: string,
    accountingOnlyToken: string,
    foreignToken: string;

  async function makeInvoice(finalized = true) {
    const invoiceId = (
      await pool.query(
        `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,encounter_id,invoice_number,
      total_amount,paid_amount,balance_amount,credit_balance,status,payer_type,payer_name,member_number)
      VALUES($1,$2,$3,$4,$5,'100.00','0.00','100.00','0.00','Pending','Insurance','Synthetic payer','SYN') RETURNING id`,
        [tenant, facility, patient, encounter, `LEDGER-INV-${suffix}-${++seq}`],
      )
    ).rows[0].id as number;
    await pool.query(
      `INSERT INTO billing_items(invoice_id,tariff_id,tariff_code,item_type,description,quantity,unit_price,total_amount)
      VALUES($1,$2,$3,'Consultation','Synthetic consultation',2,'50.00','100.00')`,
      [invoiceId, tariff, `SYN-${suffix}`],
    );
    if (finalized)
      await finalizeInvoice(context, invoiceId, {
        insurerResponsibility: '60.00',
        copayment: '10.00',
        allocationBasis: 'Synthetic reviewed split',
      });
    return invoiceId;
  }
  const invoiceInput = (key = randomUUID()) => ({
    entryDate: date,
    description: 'Synthetic reviewed invoice',
    idempotencyKey: key,
    patientReceivableAccountId: patientAr,
    insurerReceivableAccountId: insurerAr,
    revenueAccountId: revenue,
  });
  const paymentInput = (key: string = randomUUID()) => ({
    entryDate: date,
    description: 'Synthetic reviewed receipt',
    idempotencyKey: key,
    settlementAccountId: cash,
    liabilityAccountId: liability,
  });
  const pay = (invoiceId: number, amount: string, party: 'PATIENT' | 'INSURER') =>
    recordSettledPayment(
      context,
      {
        facilityId: facility,
        invoiceId,
        amount,
        payerParty: party,
        paymentMethod: 'Cash',
        allowPartyOverpayment: true,
        idempotencyKey: randomUUID(),
      },
      'Synthetic cashier',
    );
  const reverse = (id: number, key = randomUUID()) =>
    reverseJournalScoped(scope, id, {
      entryDate: date,
      reason: 'Synthetic controlled correction',
      idempotencyKey: key,
      billingSourceAuthorized: true,
    });

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Synthetic test database required.');
    date = (await pool.query('SELECT current_date::text AS date')).rows[0].date;
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Ledger ${suffix}`,
        `led-${suffix}`,
      ])
    ).rows[0].id;
    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,mfl_code,address,county,phone,enabled_modules)
      VALUES($1,$2,'Synthetic Hospital',$3,'Test Road','Nyeri','0000000000','["finance","accounting","opd","laboratory"]'),
            ($1,$4,'Other Synthetic',$5,'Other Road','Nyeri','0000000001','["finance","accounting","opd","laboratory"]') RETURNING id`,
      [tenant, `A-${suffix}`, `MFL-A-${suffix}`, `B-${suffix}`, `MFL-B-${suffix}`],
    );
    [facility, foreignFacility] = facilities.rows.map((row) => row.id);
    actor = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
      VALUES($1,$1,$2,'Synthetic Accountant','test-only','ACTIVE',$3,$4) RETURNING id`,
        [`ledger-${suffix}`, `ledger-${suffix}@example.test`, tenant, facility],
      )
    ).rows[0].id;
    patient = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
      VALUES($1,$2,$3,'Synthetic','Patient','2000-01-01','Other') RETURNING id`,
        [tenant, facility, `LEDGER-${suffix}`],
      )
    ).rows[0].id;
    const department = (
      await pool.query(
        'INSERT INTO departments(facility_id,name,code) VALUES($1,$2,$3) RETURNING id',
        [facility, 'Synthetic OPD', `OPD-${suffix}`],
      )
    ).rows[0].id;
    const practitioner = (
      await pool.query(
        'INSERT INTO practitioners(tenant_id,facility_id,full_name) VALUES($1,$2,$3) RETURNING id',
        [tenant, facility, 'Synthetic clinician'],
      )
    ).rows[0].id;
    encounter = (
      await pool.query(
        `INSERT INTO encounters(tenant_id,facility_id,patient_id,practitioner_id,department_id)
      VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [tenant, facility, patient, practitioner, department],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description)
      VALUES($1,$2,'ICD-10','Z00.0','Synthetic test')`,
      [encounter, patient],
    );
    tariff = (
      await pool.query(
        `INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee)
      VALUES($1,$2,$3,'Synthetic consultation','OPD','Visit','50.00') RETURNING id`,
        [tenant, facility, `SYN-${suffix}`],
      )
    ).rows[0].id;
    context = {
      userId: actor,
      tenantId: tenant,
      facilityId: facility,
      roles: [],
      permissions: [
        'billing.read',
        'billing.update',
        'billing.payments.record',
        'billing.refunds.record',
        'clinical.read',
      ],
      isSuperAdmin: false,
    };
    const permissions = [
      'billing.read',
      'accounting.read',
      'accounting.journals.post',
      'tariffs.read',
      'tariffs.manage',
    ];
    for (const code of permissions)
      await pool.query(
        `INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING`,
        [code],
      );
    const role = (
      await pool.query(
        "INSERT INTO roles(tenant_id,name,is_active) VALUES($1,'FACILITY_ADMIN',true) RETURNING id",
        [tenant],
      )
    ).rows[0].id;
    for (const code of permissions)
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, code],
      );
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [actor, role]);
    managerToken = (await createSession({ userId: actor, securityVersion: 1 })).sessionToken;
    const restricted = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
      VALUES($1,$1,$2,'Synthetic restricted','test-only','ACTIVE',$3,$4) RETURNING id`,
        [`restricted-${suffix}`, `restricted-${suffix}@example.test`, tenant, facility],
      )
    ).rows[0].id;
    const limitedRole = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenant, `LIMITED-${suffix}`],
      )
    ).rows[0].id;
    for (const code of ['accounting.read', 'accounting.journals.post'])
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [limitedRole, code],
      );
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
      restricted,
      limitedRole,
    ]);
    accountingOnlyToken = (await createSession({ userId: restricted, securityVersion: 1 }))
      .sessionToken;
    const foreignActor = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
      VALUES($1,$1,$2,'Synthetic foreign','test-only','ACTIVE',$3,$4) RETURNING id`,
        [`foreign-${suffix}`, `foreign-${suffix}@example.test`, tenant, foreignFacility],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [foreignActor, role]);
    foreignToken = (await createSession({ userId: foreignActor, securityVersion: 1 })).sessionToken;
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
    scope = { tenantId: tenant, facilityId: facility, actorUserId: actor };
    foreignScope = { tenantId: tenant, facilityId: foreignFacility, actorUserId: actor };
    async function account(
      s: AccountingScope,
      code: string,
      type: 'ASSET' | 'LIABILITY' | 'REVENUE',
    ) {
      return (
        await createAccountScoped(s, {
          accountCode: code,
          accountName: `Synthetic ${code}`,
          accountType: type,
          subType: code,
          normalBalance: type === 'ASSET' ? 'DEBIT' : 'CREDIT',
        })
      ).id as number;
    }
    patientAr = await account(scope, 'PATIENT_AR', 'ASSET');
    insurerAr = await account(scope, 'INSURER_AR', 'ASSET');
    cash = await account(scope, 'CASH', 'ASSET');
    liability = await account(scope, 'CREDIT', 'LIABILITY');
    revenue = await account(scope, 'REVENUE', 'REVENUE');
    foreignAccount = await account(foreignScope, 'OTHER', 'ASSET');
    period = (
      await createFinancialPeriodScoped(scope, {
        periodCode: 'SYN',
        name: 'Synthetic open',
        startDate: '2000-01-01',
        endDate: '2099-12-31',
      })
    ).id;
  });

  afterAll(async () => {
    if (close) await close();
  });

  it('connects a synthetic invoice and manual receipt to reviewed GL posting and an imported bank worksheet', async () => {
    // All data is synthetic. This is not a live bank feed or evidence of an external transfer.
    const bankGl = await createAccountScoped(scope, {
      accountCode: `TEST_BANK_${suffix}`,
      accountName: 'Synthetic statement bank',
      accountType: 'ASSET',
      subType: 'BANK',
      normalBalance: 'DEBIT',
    });
    const bankAccount = await createBankAccountScoped(scope, {
      accountName: 'Synthetic statement account',
      bankCode: 'TEST',
      bankName: 'Synthetic bank',
      accountLastFour: '1234',
      glAccountId: bankGl.id,
    });
    const invoice = await makeInvoice();
    await postBillingSourceScoped(scope, 'BILLING_INVOICE', invoice, invoiceInput());
    const receipt = await pay(invoice, '35.00', 'PATIENT');
    const postingInput = { ...paymentInput(), settlementAccountId: bankGl.id };
    const posting = await postBillingSourceScoped(
      scope,
      'BILLING_PAYMENT',
      receipt.payment.id,
      postingInput,
    );
    expect(
      (await postBillingSourceScoped(scope, 'BILLING_PAYMENT', receipt.payment.id, postingInput))
        .idempotentReplay,
    ).toBe(true);
    expect(posting.allocation).toMatchObject({
      party: 'PATIENT',
      amountKes: '35.00',
      receivableKes: '35.00',
      liabilityKes: '0.00',
    });
    const invoiceBalance = await pool.query(
      'SELECT balance_amount FROM billing_invoices WHERE id=$1',
      [invoice],
    );
    expect(invoiceBalance.rows[0].balance_amount).toBe('65.00');
    const line = await pool.query(
      'SELECT id FROM journal_lines WHERE journal_entry_id=$1 AND account_id=$2',
      [posting.journal.id, bankGl.id],
    );
    expect(line.rows).toHaveLength(1);
    const statementInput = {
      startDate: date,
      endDate: date,
      closingBalanceKes: '35.00',
      csvText: `date,reference,description,direction,amount\n${date},SYNTHETIC-1,Manual receipt,INFLOW,35.00`,
    };
    const imported = await importStatementScoped(scope, bankAccount.id, statementInput);
    expect(
      (await importStatementScoped(scope, bankAccount.id, statementInput)).idempotentReplay,
    ).toBe(true);
    await expect(
      importStatementScoped(foreignScope, bankAccount.id, statementInput),
    ).rejects.toMatchObject({ code: 'BANK_ACCOUNT_NOT_FOUND' });
    const bankTransaction = await pool.query(
      'SELECT id,origin_classification FROM bank_transactions WHERE statement_import_id=$1',
      [imported.statementImportId],
    );
    expect(bankTransaction.rows).toHaveLength(1);
    expect(bankTransaction.rows[0].origin_classification).toBe('IMPORTED_STATEMENT');
    expect(
      (await matchBankTransactionScoped(scope, bankTransaction.rows[0].id, line.rows[0].id))
        .idempotentReplay,
    ).toBe(false);
    expect(
      (await matchBankTransactionScoped(scope, bankTransaction.rows[0].id, line.rows[0].id))
        .idempotentReplay,
    ).toBe(true);
    const worksheet = await previewBankReconciliationScoped(
      scope,
      bankAccount.id,
      imported.statementImportId,
    );
    expect(worksheet).toMatchObject({
      worksheetBalanced: true,
      differenceKes: '0.00',
      bankConfirmed: false,
    });
    const reviewInput = {
      idempotencyKey: 'synthetic-reviewed-import',
      periodCode: 'SYN',
      reviewNotes: 'Synthetic imported worksheet only',
    };
    const reviewed = await saveBankReconciliationScoped(
      scope,
      bankAccount.id,
      imported.statementImportId,
      reviewInput,
    );
    expect(
      (
        await saveBankReconciliationScoped(
          scope,
          bankAccount.id,
          imported.statementImportId,
          reviewInput,
        )
      ).idempotentReplay,
    ).toBe(true);
    const saved = await pool.query('SELECT status FROM bank_reconciliations WHERE id=$1', [
      reviewed.reconciliationId,
    ]);
    expect(saved.rows[0].status).toBe('REVIEWED_IMPORT');
    const overview = await getAccountingOverviewScoped(scope, date, date);
    expect(overview.trialBalance.balanced).toBe(true);
    expect(overview.balanceSheet.balanced).toBe(true);
  });

  it('posts split invoice, patient/insurer partial receipts, credit and reviewed manual refund once; reversals are ordered', async () => {
    const invoice = await makeInvoice();
    const input = invoiceInput();
    const retries = await Promise.all(
      Array.from({ length: 6 }, () =>
        postBillingSourceScoped(scope, 'BILLING_INVOICE', invoice, input),
      ),
    );
    expect(retries.filter((row) => !row.idempotentReplay)).toHaveLength(1);
    expect(new Set(retries.map((row) => row.journal.id)).size).toBe(1);
    await expect(
      postBillingSourceScoped(scope, 'BILLING_INVOICE', invoice, {
        ...input,
        description: 'Changed review',
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_ALREADY_POSTED' });
    await expect(
      postBillingSourceScoped(scope, 'BILLING_INVOICE', invoice, invoiceInput()),
    ).rejects.toMatchObject({ code: 'SOURCE_ALREADY_POSTED' });
    const patientPayment = await pay(invoice, '50.00', 'PATIENT');
    const patientPost = await postBillingSourceScoped(
      scope,
      'BILLING_PAYMENT',
      patientPayment.payment.id,
      paymentInput(),
    );
    expect(patientPost.allocation).toEqual({
      party: 'PATIENT',
      amountKes: '50.00',
      receivableKes: '40.00',
      liabilityKes: '10.00',
    });
    const insurerPayment = await pay(invoice, '30.00', 'INSURER');
    const insurerPost = await postBillingSourceScoped(
      scope,
      'BILLING_PAYMENT',
      insurerPayment.payment.id,
      paymentInput(),
    );
    expect(insurerPost.allocation).toEqual({
      party: 'INSURER',
      amountKes: '30.00',
      receivableKes: '30.00',
      liabilityKes: '0.00',
    });
    const refund = await approvedSyntheticManualRefund(context, {
      facilityId: facility,
      invoiceId: invoice,
      paymentId: patientPayment.payment.id,
      amount: '15.00',
      refundMethod: 'CASH',
      reason: 'Synthetic returned funds',
      manualConfirmation: true,
      idempotencyKey: randomUUID(),
    });
    await expect(
      postBillingSourceScoped(scope, 'BILLING_REFUND', refund.refund.id, {
        ...paymentInput(),
        receivableRefundKes: '15.00',
      }),
    ).resolves.toBeDefined();
    // This independent invoice tests a mixed refund allocation and its reversal chain.
    const otherInvoice = await makeInvoice();
    const otherPost = await postBillingSourceScoped(
      scope,
      'BILLING_INVOICE',
      otherInvoice,
      invoiceInput(),
    );
    const otherReceipt = await pay(otherInvoice, '50.00', 'PATIENT');
    const receiptPost = await postBillingSourceScoped(
      scope,
      'BILLING_PAYMENT',
      otherReceipt.payment.id,
      paymentInput(),
    );
    const otherRefund = await approvedSyntheticManualRefund(context, {
      facilityId: facility,
      invoiceId: otherInvoice,
      paymentId: otherReceipt.payment.id,
      amount: '15.00',
      refundMethod: 'CASH',
      reason: 'Synthetic mixed return',
      manualConfirmation: true,
      idempotencyKey: randomUUID(),
    });
    await expect(
      postBillingSourceScoped(scope, 'BILLING_REFUND', otherRefund.refund.id, {
        ...paymentInput(),
        receivableRefundKes: '4.00',
      }),
    ).rejects.toMatchObject({ code: 'REFUND_ALLOCATION_INVALID' });
    const refundPost = await postBillingSourceScoped(
      scope,
      'BILLING_REFUND',
      otherRefund.refund.id,
      { ...paymentInput(), receivableRefundKes: '5.00' },
    );
    expect(refundPost.allocation).toEqual({
      party: 'PATIENT',
      amountKes: '15.00',
      receivableKes: '5.00',
      liabilityKes: '10.00',
    });
    await expect(reverse(otherPost.journal.id)).rejects.toMatchObject({
      code: 'ACTIVE_DEPENDENT_POSTING',
    });
    await expect(reverse(receiptPost.journal.id)).rejects.toMatchObject({
      code: 'ACTIVE_DEPENDENT_POSTING',
    });
    await reverse(refundPost.journal.id);
    await reverse(receiptPost.journal.id);
    await reverse(otherPost.journal.id);
    expect(
      (await postBillingSourceScoped(scope, 'BILLING_INVOICE', invoice, input)).idempotentReplay,
    ).toBe(true);
    const overview = await getAccountingOverviewScoped(scope, date, date);
    expect(overview.trialBalance.balanced).toBe(true);
    expect(overview.balanceSheet.balanced).toBe(true);
    await expect(
      pool.query('UPDATE billing_payments SET amount=amount WHERE id=$1', [
        patientPayment.payment.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('UPDATE accounting_billing_postings SET party=party WHERE journal_id=$1', [
        patientPost.journal.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    expect(insurerPost.journal.id).toBeGreaterThan(0);
  });

  it('serializes source ordering and a race between receipt posting and parent reversal', async () => {
    const invoice = await makeInvoice();
    const invoicePost = await postBillingSourceScoped(
      scope,
      'BILLING_INVOICE',
      invoice,
      invoiceInput(),
    );
    const first = await pay(invoice, '20.00', 'PATIENT');
    const second = await pay(invoice, '20.00', 'INSURER');
    await expect(
      postBillingSourceScoped(scope, 'BILLING_PAYMENT', second.payment.id, paymentInput()),
    ).rejects.toMatchObject({ code: 'PREVIOUS_SOURCE_POSTING_REQUIRED' });
    const race = await Promise.allSettled([
      postBillingSourceScoped(scope, 'BILLING_PAYMENT', first.payment.id, paymentInput()),
      reverse(invoicePost.journal.id),
    ]);
    expect(race.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(race.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejected = race.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(['ACTIVE_DEPENDENT_POSTING', 'ACTIVE_INVOICE_POSTING_REQUIRED']).toContain(
      rejected.reason.code,
    );
    const active = await pool.query(
      `SELECT p.source_type, EXISTS(SELECT 1 FROM journal_entries r
      WHERE r.reversal_of_journal_id=p.journal_id AND r.status='POSTED') AS reversed
      FROM accounting_billing_postings p WHERE p.invoice_id=$1`,
      [invoice],
    );
    expect(
      active.rows.some((r) => r.source_type === 'BILLING_PAYMENT' && !r.reversed) &&
        active.rows.some((r) => r.source_type === 'BILLING_INVOICE' && r.reversed),
    ).toBe(false);
  });

  it('rolls back journal, source link and audit when the audit write fails', async () => {
    const invoice = await makeInvoice();
    const functionName = `synthetic_audit_fail_${suffix.replace(/-/g, '')}`;
    const triggerName = `synthetic_audit_trigger_${suffix.replace(/-/g, '')}`;
    await pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.user_id='${actor}' AND NEW.resource='journal_entries' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF;
      RETURN NEW; END $$`);
    await pool.query(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
    );
    try {
      await expect(
        postBillingSourceScoped(scope, 'BILLING_INVOICE', invoice, invoiceInput()),
      ).rejects.toBeDefined();
      const result = await pool.query(
        `SELECT count(*)::int AS n FROM journal_entries
        WHERE facility_id=$1 AND source_type='BILLING_INVOICE' AND source_id=$2`,
        [facility, String(invoice)],
      );
      expect(result.rows[0].n).toBe(0);
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM accounting_billing_postings WHERE invoice_id=$1',
            [invoice],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await pool.query(`DROP TRIGGER ${triggerName} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${functionName}()`);
    }
  });

  it('reports unposted invoice sources and journal-side orphan links without assuming reconciliation', async () => {
    const invoice = await makeInvoice();
    const initial = await inspectBillingLedgerScoped(scope, {
      startDate: date,
      endDate: date,
      limit: 200,
    });
    expect(
      initial.sourceEvents.find(
        (row) => row.sourceType === 'BILLING_INVOICE' && row.sourceId === invoice,
      )?.issues,
    ).toContain('UNPOSTED');
    await postBillingSourceScoped(scope, 'BILLING_INVOICE', invoice, invoiceInput());
    const after = await inspectBillingLedgerScoped(scope, {
      startDate: date,
      endDate: date,
      limit: 200,
    });
    const source = after.sourceEvents.find(
      (row) => row.sourceType === 'BILLING_INVOICE' && row.sourceId === invoice,
    );
    expect(source?.assessment).toBe('AMOUNT_MATCH_ONLY');
    expect(
      after.sourceEvents.some(
        (row) => row.sourceType === 'BILLING_ITEM' && row.invoiceId === invoice,
      ),
    ).toBe(false);
    const orphan = await transaction((client) =>
      postInsideTransaction(client, scope, {
        entryDate: date,
        description: 'Synthetic orphan for diagnostics',
        idempotencyKey: randomUUID(),
        sourceType: 'BILLING_PAYMENT',
        sourceId: '2147483647',
        totalCents: 100n,
        lines: [
          {
            accountId: cash,
            debitCents: 100n,
            creditCents: 0n,
            description: null,
            serviceLine: null,
          },
          {
            accountId: patientAr,
            debitCents: 0n,
            creditCents: 100n,
            description: null,
            serviceLine: null,
          },
        ],
      }),
    );
    const report = await inspectBillingJournalExceptionsScoped(scope, {
      startDate: date,
      endDate: date,
      limit: 200,
    });
    expect(report.journals.find((row) => row.id === orphan.journal.id)?.issues).toEqual(
      expect.arrayContaining(['SOURCE_MISSING_OR_OUT_OF_SCOPE', 'UNTRACKED_SOURCE_LINK']),
    );
    const foreign = await inspectBillingJournalExceptionsScoped(foreignScope, {
      startDate: date,
      endDate: date,
      limit: 200,
    });
    expect(foreign.journals.some((row) => row.id === orphan.journal.id)).toBe(false);
  });

  it('enforces authenticated permission and facility boundaries for posting, recovery and reversal', async () => {
    const invoice = await makeInvoice();
    const path = `/api/accounting/billing-postings/BILLING_INVOICE/${invoice}`;
    const input = { ...invoiceInput(), facilityId: facility };
    expect(
      (await httpJson(base, 'POST', path, { token: accountingOnlyToken, body: input })).status,
    ).toBe(403);
    expect(
      (
        await httpJson(base, 'POST', path, {
          token: managerToken,
          body: { ...input, facilityId: foreignFacility },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await httpJson(base, 'POST', path, {
          token: foreignToken,
          body: { ...input, facilityId: foreignFacility },
        })
      ).status,
    ).toBe(404);
    const posted = await httpJson(base, 'POST', path, { token: managerToken, body: input });
    expect(posted.status).toBe(201);
    expect((await httpJson(base, 'POST', path, { token: managerToken, body: input })).status).toBe(
      200,
    );
    const status = await httpJson(base, 'GET', `${path}?facilityId=${facility}`, {
      token: managerToken,
    });
    expect(status.body).toMatchObject({
      status: 'RECORDED',
      journalId: posted.body.journal.id,
      reversed: false,
    });
    expect(
      (
        await httpJson(base, 'GET', `${path}?facilityId=${facility}`, {
          token: accountingOnlyToken,
        })
      ).status,
    ).toBe(403);
    const reverseBody = {
      facilityId: facility,
      entryDate: date,
      reason: 'Synthetic HTTP correction',
      idempotencyKey: randomUUID(),
      billingSourceAuthorized: true,
    };
    const reversePath = `/api/accounting/journals/${posted.body.journal.id}/reverse`;
    expect(
      (await httpJson(base, 'POST', reversePath, { token: accountingOnlyToken, body: reverseBody }))
        .status,
    ).toBe(403);
    expect(
      (await httpJson(base, 'POST', reversePath, { token: managerToken, body: reverseBody }))
        .status,
    ).toBe(201);
    expect(
      (await httpJson(base, 'GET', `${path}?facilityId=${facility}`, { token: managerToken })).body
        .reversed,
    ).toBe(true);
  });

  it('keeps historical billed-code diagnostics private and rolls current service changes back on audit failure', async () => {
    const invoice = await makeInvoice(false);
    await pool.query('UPDATE billing_items SET tariff_id=NULL,tariff_code=$2 WHERE invoice_id=$1', [
      invoice,
      `MISSING-${suffix}`,
    ]);
    // The old review endpoint is deliberately retired; exercise the retained
    // historical evaluator directly without re-exposing its report in the UI.
    expect(
      (
        await httpJson(base, 'GET', `/api/billing/tariff-validation?facilityId=${facility}`, {
          token: managerToken,
        })
      ).status,
    ).toBe(404);
    const report = await inspectTariffConfiguration(tenant, facility, 0, 200);
    const billed = report.checks.find((row) => row.code === `MISSING-${suffix}`);
    expect(billed).toMatchObject({
      kind: 'BILLED_SERVICE',
      reasons: expect.arrayContaining([
        'BILLED_WITHOUT_TARIFF_REFERENCE',
        'BILLED_CODE_NOT_IN_CURRENT_TARIFF_CATALOGUE',
      ]),
    });
    expect(JSON.stringify(billed)).not.toContain('Patient');
    expect(
      (
        await httpJson(base, 'GET', `/api/facility-tariffs?facilityId=${facility}`, {
          token: foreignToken,
        })
      ).status,
    ).toBe(403);

    const serviceBody = {
      facilityId: facility,
      code: `ATOMIC-${suffix}`,
      name: 'Synthetic service',
      description: 'Synthetic service',
      category: 'CONSULTATION',
      department: 'opd',
      unit: 'Visit',
      initialPrice: '50.00',
      isActive: true,
      autoBill: true,
    };
    const created = await httpJson(base, 'POST', '/api/facility-services', {
      token: managerToken,
      body: serviceBody,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const service = created.body.service;
    const currentTariff = created.body.tariff;
    const functionName = `synthetic_tariff_fail_${suffix.replace(/-/g, '')}`;
    const triggerName = `synthetic_tariff_trigger_${suffix.replace(/-/g, '')}`;
    await pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.user_id='${actor}' AND NEW.resource='FACILITY_SERVICE_TARIFF' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF;
      RETURN NEW; END $$`);
    await pool.query(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
    );
    try {
      const failingCode = `FAIL-${serviceBody.code}`;
      expect(
        (
          await httpJson(base, 'POST', '/api/facility-services', {
            token: managerToken,
            body: { ...serviceBody, code: failingCode },
          })
        ).status,
      ).toBe(500);
      for (const table of ['facility_services', 'facility_service_tariffs'])
        expect(
          (
            await pool.query(
              `SELECT count(*)::int n FROM ${table} WHERE facility_id=$1 AND code=$2`,
              [facility, failingCode.toUpperCase()],
            )
          ).rows[0].n,
        ).toBe(0);
      expect(
        (
          await httpJson(base, 'PUT', `/api/facility-tariffs/${currentTariff.id}`, {
            token: managerToken,
            body: {
              facilityId: facility,
              serviceId: service.id,
              expectedRevision: currentTariff.revision,
              code: serviceBody.code,
              description: 'Synthetic revised',
              department: 'opd',
              unit: 'Visit',
              fee: '99.00',
              effectiveFrom: null,
              effectiveTo: null,
              isActive: true,
              autoBill: true,
            },
          })
        ).status,
      ).toBe(500);
      expect(
        (
          await pool.query('SELECT fee::text FROM facility_service_tariffs WHERE id=$1', [
            currentTariff.id,
          ])
        ).rows[0].fee,
      ).toBe('50.00');
      expect(
        (
          await httpJson(base, 'PATCH', `/api/facility-tariffs/${currentTariff.id}/status`, {
            token: managerToken,
            body: { facilityId: facility, isActive: false },
          })
        ).status,
      ).toBe(500);
      expect(
        (
          await pool.query('SELECT is_active FROM facility_service_tariffs WHERE id=$1', [
            currentTariff.id,
          ])
        ).rows[0].is_active,
      ).toBe(true);
    } finally {
      await pool.query(`DROP TRIGGER ${triggerName} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${functionName}()`);
    }
  });

  it('retains atomic legacy import validation and retries without restoring the retired HTTP importer', async () => {
    const rows = [
      {
        code: `IMPORT-A-${suffix}`,
        description: 'Synthetic service A',
        department: 'opd',
        unit: 'Visit',
        fee: '10.00',
        autoBill: false,
      },
      {
        code: `IMPORT-B-${suffix}`,
        description: 'Synthetic service B',
        department: 'laboratory',
        unit: 'Test',
        fee: '20.00',
        autoBill: false,
      },
    ];
    const facilityRow = {
      id: facility,
      tenantId: tenant,
      enabledModules: ['finance', 'accounting', 'opd', 'laboratory'],
    };
    // All actors see the removed endpoint as unavailable. Authorization on the
    // current service catalogue remains tested separately; these core legacy
    // functions are called only with explicitly scoped synthetic input.
    const path = '/api/service-tariffs/import';
    for (const session of [managerToken, accountingOnlyToken, foreignToken])
      expect(
        (
          await httpJson(base, 'POST', path, {
            token: session,
            body: { facilityId: facility, rows },
          })
        ).status,
      ).toBe(404);
    expect(
      (
        await httpJson(base, 'POST', '/api/facility-services', {
          token: accountingOnlyToken,
          body: { facilityId: facility },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await httpJson(base, 'GET', `/api/facility-services?facilityId=${facility}`, {
          token: foreignToken,
        })
      ).status,
    ).toBe(403);
    const preview = await previewTariffImport(facilityRow, rows);
    expect(preview).toMatchObject({ valid: true, rowCount: 2, issues: [] });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM facility_service_tariffs WHERE facility_id=$1 AND code=ANY($2::text[])',
          [facility, rows.map((r) => r.code.toUpperCase())],
        )
      ).rows[0].n,
    ).toBe(0);
    const { fee: _omittedFee, ...missingPrice } = rows[0];
    const invalid = await previewTariffImport(facilityRow, [missingPrice]);
    expect(invalid.valid).toBe(false);
    expect(invalid.issues[0].reasons).toContain('MISSING_PRICE');
    const duplicate = await previewTariffImport(facilityRow, [
      rows[0],
      { ...rows[0], code: rows[0].code.toLowerCase() },
    ]);
    expect(duplicate.issues[0].reasons).toContain('DUPLICATE_CODE_IN_BATCH');
    const key = randomUUID();
    const body = {
      facilityId: facility,
      rows,
      idempotencyKey: key,
      confirmed: true,
      approvalReference: 'Synthetic facility review',
    };
    await expect(
      importTariffs(facilityRow, actor, { ...body, confirmed: false }),
    ).rejects.toMatchObject({ code: 'APPROVAL_REFERENCE_REQUIRED' });
    const attempts = await Promise.all(
      Array.from({ length: 4 }, () => importTariffs(facilityRow, actor, body)),
    );
    expect(attempts.filter((result) => !result.idempotentReplay)).toHaveLength(1);
    expect(attempts.filter((result) => result.idempotentReplay)).toHaveLength(3);
    expect(new Set(attempts.map((result) => result.batchId)).size).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM facility_service_tariffs WHERE facility_id=$1 AND code=ANY($2::text[])',
          [facility, rows.map((r) => r.code.toUpperCase())],
        )
      ).rows[0].n,
    ).toBe(2);
    await expect(
      importTariffs(facilityRow, actor, { ...body, approvalReference: 'Different review' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const status = await tariffImportStatus(facilityRow, key);
    expect(status).toMatchObject({ status: 'RECORDED', rowCount: 2, batchId: attempts[0].batchId });
    await expect(
      pool.query('UPDATE facility_tariff_import_batches SET row_count=row_count WHERE id=$1', [
        attempts[0].batchId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    const conflict = await previewTariffImport(facilityRow, rows);
    expect(conflict.issues[0].reasons).toContain('CODE_ALREADY_EXISTS');

    const functionName = `synthetic_import_fail_${suffix.replace(/-/g, '')}`;
    const triggerName = `synthetic_import_trigger_${suffix.replace(/-/g, '')}`;
    await pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.user_id='${actor}' AND NEW.resource='FACILITY_TARIFF_IMPORT' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF;
      RETURN NEW; END $$`);
    await pool.query(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
    );
    try {
      const failingRows = rows.map((row) => ({ ...row, code: `FAIL-${row.code}` }));
      await expect(
        importTariffs(facilityRow, actor, {
          ...body,
          rows: failingRows,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toThrow('Synthetic audit failure');
      expect(
        (
          await pool.query(
            'SELECT count(*)::int n FROM facility_service_tariffs WHERE facility_id=$1 AND code=ANY($2::text[])',
            [facility, failingRows.map((row) => row.code.toUpperCase())],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await pool.query(`DROP TRIGGER ${triggerName} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${functionName}()`);
    }
  });

  it('simulates a verified sandbox delivery across real billing and ledger primitives without enabling the callback', async () => {
    // TEST ONLY: the verification decision, callback data, transport, KES value and
    // posting policy are synthetic. This is not a Safaricom authentication
    // protocol or a production callback handler. In particular, billing and
    // journal posting commit separately; the injected crash below makes that
    // gap visible. The live callback must continue to reject deliveries.
    const priorKey = process.env.PAYMENT_HUB_ENCRYPTION_KEY;
    const priorActiveKey = process.env.PAYMENT_HUB_ACTIVE_VAULT_KEY_ID;
    const priorCallback = process.env.PAYMENT_HUB_CALLBACK_BASE_URL;
    const provider = await pool.query(
      `SELECT p.id FROM payment_provider_definitions p
       JOIN payment_provider_environments e ON e.provider_id=p.id AND e.environment='SANDBOX'
       WHERE p.code='MPESA_DARAJA' AND p.status='ACTIVE' AND e.is_available`,
    );
    expect(provider.rowCount).toBe(1);
    const providerId = Number(provider.rows[0].id);
    process.env.PAYMENT_HUB_ENCRYPTION_KEY = createHash('sha256')
      .update(`synthetic-payment-simulation-${suffix}`)
      .digest('base64');
    delete process.env.PAYMENT_HUB_ACTIVE_VAULT_KEY_ID;
    process.env.PAYMENT_HUB_CALLBACK_BASE_URL = 'https://example.test';
    const checkout = `synthetic-checkout-${suffix}`;
    const merchant = `synthetic-merchant-${suffix}`;
    const receiptCode = `SY${suffix.toUpperCase()}`;
    const paymentKey = `synthetic-callback-payment-${suffix}`;
    const postingKey = `synthetic-callback-journal-${suffix}`;
    const transport = vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request);
      if (url.includes('/oauth/'))
        return Response.json({ access_token: 'synthetic-only-token', expires_in: '3600' });
      if (url.includes('/mpesa/stkpush/v1/processrequest'))
        return Response.json({
          ResponseCode: '0',
          MerchantRequestID: merchant,
          CheckoutRequestID: checkout,
          ResponseDescription: 'synthetic request accepted',
        });
      throw new Error(`Unexpected synthetic transport request: ${url}`);
    });
    vi.stubGlobal('fetch', transport);

    type SimulatedDelivery = {
      mockAuthenticated: boolean;
      event: {
        checkoutId: string;
        facilityId: number;
        invoiceId: number;
        amountCents: number;
        currency: string;
        resultCode: number;
        receiptCode: string;
      };
    };
    // This fake merely supplies a pre-decided test outcome. No real signature,
    // shared secret or provider-origin evidence is implemented or claimed.
    const mockVerification = vi.fn((delivery: SimulatedDelivery) => {
      if (!delivery.mockAuthenticated) throw new Error('mock verification rejected');
      return delivery.event;
    });

    try {
      // Never modify global provider policies: other synthetic suites can
      // exercise platform policy changes concurrently in the same database.
      await pool.query(
        `INSERT INTO payment_provider_assignments(tenant_id,facility_id,provider_id,is_allowed,updated_by_user_id)
         VALUES($1,$2,$3,true,$4) ON CONFLICT(facility_id,provider_id)
         DO UPDATE SET is_allowed=true`,
        [tenant, facility, providerId, actor],
      );
      const integration = await configureIntegration(scope, providerId, {
        environment: 'SANDBOX',
        capabilities: ['PAYMENT_COLLECTION', 'HEALTH'],
      });
      const integrationId = Number(integration.id);
      await saveCredentials(scope, integrationId, {
        facilityId: facility,
        source: 'VAULT',
        credentials: {
          consumerKey: `synthetic-key-${suffix}`,
          consumerSecret: `synthetic-secret-${suffix}`,
          shortcode: '174379',
          passkey: `synthetic-passkey-${suffix}`,
          transactionType: 'CustomerPayBillOnline',
        },
      });
      await addFacilityAccount(scope, integrationId, {
        alias: 'Synthetic payment account',
        accountType: 'MOBILE_MONEY',
        lastFour: '4379',
      });
      await testConnection(scope, integrationId);
      await setIntegrationEnabled(scope, integrationId, true);

      const invoice = await makeInvoice();
      const invoicePosting = await postBillingSourceScoped(
        scope,
        'BILLING_INVOICE',
        invoice,
        invoiceInput(),
      );
      const invoiceBalance = await pool.query(
        `SELECT sum(debit_cents)::int AS debit,sum(credit_cents)::int AS credit
         FROM journal_lines WHERE journal_entry_id=$1`,
        [invoicePosting.journal.id],
      );
      expect(invoiceBalance.rows[0]).toMatchObject({ debit: 10000, credit: 10000 });
      const outstanding = await listCollectionInvoices(
        scope,
        undefined,
        `LEDGER-INV-${suffix}-${seq}`,
      );
      expect(outstanding.invoices.some((item) => Number(item.id) === invoice)).toBe(true);
      const initiated = await initiateCollection(scope, {
        integrationId,
        invoiceId: invoice,
        phone: '254700000001',
        amountKes: '20.00',
        idempotencyKey: `synthetic-stk-${suffix}`,
      });
      expect(initiated).toMatchObject({ status: 'PENDING', idempotentReplay: false });
      expect(transport).toHaveBeenCalledTimes(3); // mocked health OAuth, STK OAuth and STK request
      expect(
        (
          await pool.query('SELECT count(*)::int n FROM billing_payments WHERE invoice_id=$1', [
            invoice,
          ])
        ).rows[0].n,
      ).toBe(0); // provider acceptance is not a payment

      const delivery: SimulatedDelivery = {
        mockAuthenticated: true,
        event: {
          checkoutId: checkout,
          facilityId: facility,
          invoiceId: invoice,
          amountCents: 2000,
          currency: 'KES',
          resultCode: 0,
          receiptCode,
        },
      };
      // A fresh test-only processor uses persisted identifiers and retry keys,
      // not in-memory state. It deliberately does not update the hub status.
      const simulatedProcessor = async (input: SimulatedDelivery, crashAfterReceipt = false) => {
        const event = mockVerification(input);
        const selected = await pool.query(
          `SELECT t.invoice_id,t.amount_cents,t.status,i.environment
           FROM payment_hub_transactions t
           JOIN facility_payment_integrations i ON i.id=t.integration_id
           JOIN billing_invoices b ON b.id=t.invoice_id AND b.facility_id=t.facility_id AND b.tenant_id=t.tenant_id
           WHERE t.provider_request_id=$1 AND t.tenant_id=$2 AND t.facility_id=$3`,
          [event.checkoutId, tenant, facility],
        );
        const row = selected.rows[0];
        if (
          !row ||
          row.environment !== 'SANDBOX' ||
          row.status !== 'PENDING' ||
          event.facilityId !== facility ||
          event.invoiceId !== Number(row.invoice_id) ||
          event.amountCents !== Number(row.amount_cents) ||
          event.currency !== 'KES' ||
          event.resultCode !== 0 ||
          !/^([A-Z]{2})([A-Z0-9]{8})$/.test(event.receiptCode)
        )
          throw new Error('synthetic callback validation rejected');
        const payment = await recordSettledPayment(
          context,
          {
            facilityId: facility,
            invoiceId: invoice,
            paymentMethod: 'M-Pesa',
            amount: '20.00',
            transactionCode: event.receiptCode,
            payerParty: 'PATIENT',
            idempotencyKey: paymentKey,
          },
          'Synthetic simulation',
        );
        if (crashAfterReceipt) throw new Error('simulated crash between receipt and journal');
        const journal = await postBillingSourceScoped(
          scope,
          'BILLING_PAYMENT',
          payment.payment.id,
          paymentInput(postingKey),
        );
        return { payment, journal };
      };

      const altered = (event: Partial<SimulatedDelivery['event']>): SimulatedDelivery => ({
        ...delivery,
        event: { ...delivery.event, ...event },
      });
      await expect(simulatedProcessor({ ...delivery, mockAuthenticated: false })).rejects.toThrow(
        'mock verification rejected',
      );
      for (const invalid of [
        altered({ checkoutId: 'unknown-checkout' }),
        altered({ facilityId: foreignFacility }),
        altered({ invoiceId: invoice + 1 }),
        altered({ amountCents: 2001 }),
        altered({ currency: 'USD' }),
        altered({ resultCode: 1 }),
        altered({ receiptCode: 'invalid' }),
      ])
        await expect(simulatedProcessor(invalid)).rejects.toThrow(
          'synthetic callback validation rejected',
        );
      expect(
        (
          await pool.query('SELECT count(*)::int n FROM billing_payments WHERE invoice_id=$1', [
            invoice,
          ])
        ).rows[0].n,
      ).toBe(0);

      // Make the non-atomic boundary observable, then demonstrate recovery by
      // replaying the same synthetic event with the same durable request keys.
      await expect(simulatedProcessor(delivery, true)).rejects.toThrow(
        'simulated crash between receipt and journal',
      );
      const beforeRecovery = await pool.query(
        `SELECT p.id,p.receipt_number,b.paid_amount,b.balance_amount,
         (SELECT count(*)::int FROM accounting_billing_postings s WHERE s.source_type='BILLING_PAYMENT' AND s.source_id=p.id) AS journals
         FROM billing_payments p JOIN billing_invoices b ON b.id=p.invoice_id WHERE b.id=$1`,
        [invoice],
      );
      expect(beforeRecovery.rows).toHaveLength(1);
      expect(beforeRecovery.rows[0]).toMatchObject({
        paid_amount: '20.00',
        balance_amount: '80.00',
        journals: 0,
      });
      expect(beforeRecovery.rows[0].receipt_number).toBeTruthy();
      const recovered = await Promise.all([
        simulatedProcessor(delivery),
        simulatedProcessor(delivery),
      ]);
      expect(recovered.every((result) => result.payment.idempotentReplay)).toBe(true);
      expect(recovered.filter((result) => result.journal.idempotentReplay)).toHaveLength(1);
      expect(recovered.filter((result) => !result.journal.idempotentReplay)).toHaveLength(1);
      expect(new Set(recovered.map((result) => result.payment.payment.id)).size).toBe(1);
      expect(new Set(recovered.map((result) => result.journal.journal.id)).size).toBe(1);
      const journalId = recovered[0].journal.journal.id;
      const balanced = await pool.query(
        `SELECT count(*)::int AS lines,sum(debit_cents)::int AS debit,sum(credit_cents)::int AS credit
         FROM journal_lines WHERE journal_entry_id=$1`,
        [journalId],
      );
      expect(balanced.rows[0]).toMatchObject({ lines: 2, debit: 2000, credit: 2000 });
      const conflictingReceipt = `SY${suffix[0] === '0' ? '1' : '0'}${suffix.slice(1).toUpperCase()}`;
      await expect(
        simulatedProcessor(altered({ receiptCode: conflictingReceipt })),
      ).rejects.toMatchObject({ code: 'PAYMENT_IDEMPOTENCY_CONFLICT' });
      expect(
        (
          await pool.query('SELECT count(*)::int n FROM billing_payments WHERE invoice_id=$1', [
            invoice,
          ])
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await pool.query(
            `SELECT count(*)::int n FROM accounting_billing_postings WHERE source_type='BILLING_PAYMENT' AND source_id=$1`,
            [beforeRecovery.rows[0].id],
          )
        ).rows[0].n,
      ).toBe(1);

      // The application's actual unauthenticated webhook remains fail-closed;
      // the test-only processor above is not reachable by a production route.
      vi.unstubAllGlobals(); // only the local test server is contacted from here
      const callback = await httpJson(base, 'POST', '/api/payment-hub/webhooks/mpesa', {
        body: delivery.event,
      });
      expect(callback.status).toBe(503);
    } finally {
      vi.unstubAllGlobals();
      for (const [name, value] of [
        ['PAYMENT_HUB_ENCRYPTION_KEY', priorKey],
        ['PAYMENT_HUB_ACTIVE_VAULT_KEY_ID', priorActiveKey],
        ['PAYMENT_HUB_CALLBACK_BASE_URL', priorCallback],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it('recovers an interrupted receipt posting through durable source status, scoped HTTP retries and balanced journals', async () => {
    const invoice = await makeInvoice();
    const receipt = await pay(invoice, '20.00', 'PATIENT');
    const id = receipt.payment.id;
    const readStatus = async () =>
      (
        await pool.query(
          `SELECT status,review_code,journal_id FROM accounting_payment_settlement_status
       WHERE tenant_id=$1 AND facility_id=$2 AND source_type='BILLING_PAYMENT' AND source_id=$3`,
          [tenant, facility, id],
        )
      ).rows[0];
    // The receipt and invoice have committed; no separate enqueue is necessary.
    expect(await readStatus()).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      review_code: 'ACTIVE_INVOICE_POSTING_REQUIRED',
      journal_id: null,
    });
    await postBillingSourceScoped(scope, 'BILLING_INVOICE', invoice, invoiceInput());
    expect(await readStatus()).toMatchObject({
      status: 'SUCCESS_AWAITING_SETTLEMENT',
      journal_id: null,
    });
    const list = `/api/accounting/payment-settlements?facilityId=${facility}&state=UNRESOLVED&afterType=BILLING_PAYMENT&afterId=${id - 1}&limit=1`;
    const visible = await httpJson(base, 'GET', list, { token: managerToken });
    expect(visible.status).toBe(200);
    expect(visible.body.sources[0]).toMatchObject({
      sourceType: 'BILLING_PAYMENT',
      sourceId: id,
      status: 'SUCCESS_AWAITING_SETTLEMENT',
    });
    expect((await httpJson(base, 'GET', list, { token: accountingOnlyToken })).status).toBe(403);
    expect((await httpJson(base, 'GET', list, { token: foreignToken })).status).toBe(403);
    const other = await httpJson(
      base,
      'GET',
      `/api/accounting/payment-settlements?facilityId=${foreignFacility}&state=ALL`,
      { token: foreignToken },
    );
    expect(other.status).toBe(200);
    expect(other.body.sources.some((s: { sourceId: number }) => s.sourceId === id)).toBe(false);
    const accountPage = await httpJson(
      base,
      'GET',
      `/api/accounting/payment-settlement-accounts?facilityId=${facility}&limit=2`,
      { token: managerToken },
    );
    expect(accountPage.status).toBe(200);
    expect(accountPage.body.accounts).toHaveLength(2);
    expect(accountPage.body.nextAfterId).toBeTruthy();
    expect(accountPage.body.accounts.some((a: { id: number }) => a.id === foreignAccount)).toBe(
      false,
    );

    const path = `/api/accounting/payment-settlements/BILLING_PAYMENT/${id}/retry`;
    const body = {
      facilityId: facility,
      entryDate: date,
      description: 'Synthetic recovered receipt',
      settlementAccountId: cash,
      liabilityAccountId: liability,
    };
    expect((await httpJson(base, 'POST', path, { token: accountingOnlyToken, body })).status).toBe(
      403,
    );
    expect(
      (
        await httpJson(base, 'POST', path, {
          token: managerToken,
          body: { ...body, facilityId: foreignFacility },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await httpJson(base, 'POST', path, {
          token: foreignToken,
          body: { ...body, facilityId: foreignFacility },
        })
      ).status,
    ).toBe(404);

    // Fail after the journal lines have been written but before their audit and
    // transaction commit. The source survives and is still visible for retry.
    const functionName = `synthetic_settlement_failure_${suffix.replace(/-/g, '')}`;
    const triggerName = `synthetic_settlement_trigger_${suffix.replace(/-/g, '')}`;
    await pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.user_id='${actor}' AND NEW.resource='journal_entries' THEN RAISE EXCEPTION 'Synthetic interruption'; END IF;
      RETURN NEW; END $$`);
    await pool.query(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
    );
    try {
      const failed = await httpJson(base, 'POST', path, { token: managerToken, body });
      expect(failed.status).toBe(500);
      expect(JSON.stringify(failed.body)).not.toContain('Synthetic interruption');
      expect(await readStatus()).toMatchObject({
        status: 'SUCCESS_AWAITING_SETTLEMENT',
        journal_id: null,
      });
      expect(
        (
          await pool.query(
            `SELECT id FROM journal_entries WHERE facility_id=$1 AND source_type='BILLING_PAYMENT' AND source_id=$2`,
            [facility, String(id)],
          )
        ).rows,
      ).toHaveLength(0);
      const attempts = await pool.query(
        `SELECT action,details FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND resource='accounting_payment_settlement' AND resource_id=$3 ORDER BY id`,
        [tenant, facility, String(id)],
      );
      expect(attempts.rows.map((r) => r.action)).toEqual(['ATTEMPT', 'FAILED']);
      expect(JSON.parse(attempts.rows[1].details)).toMatchObject({
        sourceType: 'BILLING_PAYMENT',
        code: 'POSTING_OPERATION_FAILED',
      });
      expect(JSON.stringify(attempts.rows)).not.toContain('Synthetic recovered receipt');
    } finally {
      await pool.query(`DROP TRIGGER ${triggerName} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${functionName}()`);
    }

    const results = await Promise.all(
      Array.from({ length: 6 }, () => httpJson(base, 'POST', path, { token: managerToken, body })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(5);
    expect(new Set(results.map((r) => r.body.journal.id)).size).toBe(1);
    const journalId = results[0].body.journal.id;
    expect(await readStatus()).toMatchObject({ status: 'SETTLED', journal_id: journalId });
    const journal = (
      await pool.query(
        `SELECT count(*)::int AS lines,sum(debit_cents)::text AS debit,sum(credit_cents)::text AS credit FROM journal_lines WHERE journal_entry_id=$1`,
        [journalId],
      )
    ).rows[0];
    expect(journal).toEqual({ lines: 2, debit: '2000', credit: '2000' });
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM billing_payments WHERE invoice_id=$1', [
          invoice,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await httpJson(base, 'POST', path, {
          token: managerToken,
          body: { ...body, description: 'Changed after posting' },
        })
      ).status,
    ).toBe(409);
    await reverse(journalId);
    expect(await readStatus()).toMatchObject({
      status: 'REVERSED',
      review_code: 'JOURNAL_REVERSED',
      journal_id: journalId,
    });
    const replay = await httpJson(base, 'POST', path, { token: managerToken, body });
    expect(replay.status).toBe(200);
    expect(replay.body.reversed).toBe(true);
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM billing_payments WHERE invoice_id=$1', [
          invoice,
        ])
      ).rows[0].n,
    ).toBe(1);
  });

  it('tracks manual refund posting, partial/full refunds and reversals without altering history', async () => {
    const invoice = await makeInvoice();
    await postBillingSourceScoped(scope, 'BILLING_INVOICE', invoice, invoiceInput());
    const receipt = await pay(invoice, '40.00', 'PATIENT');
    const paymentId = receipt.payment.id;
    const paymentBody = {
      entryDate: date,
      description: 'Synthetic receipt posting',
      settlementAccountId: cash,
      liabilityAccountId: liability,
    };
    const paymentPath = `/api/accounting/payment-settlements/BILLING_PAYMENT/${paymentId}/retry`;
    expect(
      (
        await httpJson(base, 'POST', paymentPath, {
          token: managerToken,
          body: { ...paymentBody, facilityId: facility },
        })
      ).status,
    ).toBe(201);
    const status = async (type: string, id: number) =>
      (
        await pool.query(
          `SELECT status,review_code,journal_id,reversal_journal_id FROM accounting_payment_settlement_status WHERE tenant_id=$1 AND facility_id=$2 AND source_type=$3 AND source_id=$4`,
          [tenant, facility, type, id],
        )
      ).rows[0];
    const refund = async (amount: string) =>
      approvedSyntheticManualRefund(context, {
        facilityId: facility,
        invoiceId: invoice,
        paymentId,
        amount,
        refundMethod: 'CASH',
        reason: 'Synthetic manual refund',
        manualConfirmation: true,
        idempotencyKey: randomUUID(),
      });
    const first = await refund('15.00');
    expect(await status('BILLING_PAYMENT', paymentId)).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      review_code: 'REFUND_POSTING_REVIEW_REQUIRED',
    });
    expect(await status('BILLING_REFUND', first.refund.id)).toMatchObject({
      status: 'SUCCESS_AWAITING_SETTLEMENT',
    });
    const firstPath = `/api/accounting/payment-settlements/BILLING_REFUND/${first.refund.id}/retry`;
    const firstBody = {
      facilityId: facility,
      entryDate: date,
      description: 'Synthetic first refund',
      settlementAccountId: cash,
      receivableRefundKes: '15.00',
    };
    expect(
      (await httpJson(base, 'POST', firstPath, { token: managerToken, body: firstBody })).status,
    ).toBe(201);
    expect(await status('BILLING_PAYMENT', paymentId)).toMatchObject({
      status: 'PARTIALLY_REFUNDED',
    });
    const second = await refund('25.00');
    const secondPath = `/api/accounting/payment-settlements/BILLING_REFUND/${second.refund.id}/retry`;
    const secondBody = {
      facilityId: facility,
      entryDate: date,
      description: 'Synthetic final refund',
      settlementAccountId: cash,
      receivableRefundKes: '25.00',
    };
    const posted = await httpJson(base, 'POST', secondPath, {
      token: managerToken,
      body: secondBody,
    });
    expect(posted.status).toBe(201);
    expect(await status('BILLING_PAYMENT', paymentId)).toMatchObject({ status: 'REFUNDED' });
    await reverse(posted.body.journal.id);
    expect(await status('BILLING_REFUND', second.refund.id)).toMatchObject({
      status: 'REVERSED',
      journal_id: posted.body.journal.id,
    });
    expect(await status('BILLING_PAYMENT', paymentId)).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      review_code: 'REFUND_POSTING_REVIEW_REQUIRED',
    });
    const replay = await httpJson(base, 'POST', secondPath, {
      token: managerToken,
      body: secondBody,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.reversed).toBe(true);
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM billing_refunds WHERE payment_id=$1', [
          paymentId,
        ])
      ).rows[0].n,
    ).toBe(2);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM billing_payments WHERE id=$1', [paymentId]))
        .rows[0].n,
    ).toBe(1);
    expect(
      (await pool.query('SELECT paid_amount FROM billing_invoices WHERE id=$1', [invoice])).rows[0]
        .paid_amount,
    ).toBe('0.00');
  });

  it('refuses a recovery attempt when its audit cannot be written and keeps the source discoverable', async () => {
    const invoice = await makeInvoice();
    await postBillingSourceScoped(scope, 'BILLING_INVOICE', invoice, invoiceInput());
    const receipt = await pay(invoice, '10.00', 'PATIENT');
    const id = receipt.payment.id;
    const functionName = `synthetic_attempt_failure_${suffix.replace(/-/g, '')}`;
    const triggerName = `synthetic_attempt_trigger_${suffix.replace(/-/g, '')}`;
    await pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.user_id='${actor}' AND NEW.resource='accounting_payment_settlement' AND NEW.action='ATTEMPT' THEN RAISE EXCEPTION 'Synthetic audit interruption'; END IF;
      RETURN NEW; END $$`);
    await pool.query(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
    );
    const path = `/api/accounting/payment-settlements/BILLING_PAYMENT/${id}/retry`;
    const body = {
      facilityId: facility,
      entryDate: date,
      description: 'Synthetic audited recovery',
      settlementAccountId: cash,
    };
    try {
      expect((await httpJson(base, 'POST', path, { token: managerToken, body })).status).toBe(500);
      const source = (
        await pool.query(
          `SELECT status,journal_id FROM accounting_payment_settlement_status WHERE tenant_id=$1 AND facility_id=$2 AND source_type='BILLING_PAYMENT' AND source_id=$3`,
          [tenant, facility, id],
        )
      ).rows[0];
      expect(source).toMatchObject({ status: 'SUCCESS_AWAITING_SETTLEMENT', journal_id: null });
      expect(
        (
          await pool.query(
            `SELECT id FROM journal_entries WHERE facility_id=$1 AND source_type='BILLING_PAYMENT' AND source_id=$2`,
            [facility, String(id)],
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await pool.query(`DROP TRIGGER ${triggerName} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${functionName}()`);
    }
    expect((await httpJson(base, 'POST', path, { token: managerToken, body })).status).toBe(201);
  });

  it('serializes concurrent receipt creation by one durable request identity', async () => {
    const invoice = await makeInvoice();
    await postBillingSourceScoped(scope, 'BILLING_INVOICE', invoice, invoiceInput());
    const code = `ST${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const input = {
      facilityId: facility,
      invoiceId: invoice,
      amount: '20.00',
      payerParty: 'PATIENT' as const,
      paymentMethod: 'M-Pesa',
      transactionCode: code,
      idempotencyKey: randomUUID(),
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => recordSettledPayment(context, input, 'Synthetic cashier')),
    );
    expect(results.filter((r) => !r.idempotentReplay)).toHaveLength(1);
    expect(new Set(results.map((r) => r.payment.id)).size).toBe(1);
    await expect(
      recordSettledPayment(context, { ...input, amount: '21.00' }, 'Synthetic cashier'),
    ).rejects.toMatchObject({ code: 'PAYMENT_IDEMPOTENCY_CONFLICT' });
    const id = results[0].payment.id;
    const source = (
      await pool.query(
        `SELECT status,journal_id FROM accounting_payment_settlement_status WHERE tenant_id=$1 AND facility_id=$2 AND source_type='BILLING_PAYMENT' AND source_id=$3`,
        [tenant, facility, id],
      )
    ).rows[0];
    expect(source).toMatchObject({ status: 'SUCCESS_AWAITING_SETTLEMENT', journal_id: null });
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM billing_payments WHERE invoice_id=$1', [
          invoice,
        ])
      ).rows[0].n,
    ).toBe(1);
  });

  it('prevents simultaneous duplicate mobile-money references without leaking another receipt', async () => {
    const invoices = await Promise.all([makeInvoice(), makeInvoice()]);
    const code = `ST${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const inputs = invoices.map((invoiceId) => ({
      facilityId: facility,
      invoiceId,
      amount: '20.00',
      payerParty: 'PATIENT' as const,
      paymentMethod: 'M-Pesa',
      transactionCode: code,
      idempotencyKey: randomUUID(),
    }));
    const results = await Promise.allSettled(
      inputs.map((input) => recordSettledPayment(context, input, 'Synthetic cashier')),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'DUPLICATE_TRANSACTION_CODE', detail: {} });
    expect(rejected.reason.message).not.toContain(code);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM billing_payments WHERE lower(transaction_code)=lower($1)',
          [code],
        )
      ).rows[0].n,
    ).toBe(1);
    const amounts = (
      await pool.query(
        'SELECT paid_amount FROM billing_invoices WHERE id=ANY($1::int[]) ORDER BY paid_amount',
        [invoices],
      )
    ).rows.map((r) => r.paid_amount);
    expect(amounts).toEqual(['0.00', '20.00']);
  });

  it('fails closed on incomplete inputs, account scope/classification, missing parent, transaction failure and period closure', async () => {
    const draft = await makeInvoice(false);
    await expect(
      postBillingSourceScoped(scope, 'BILLING_INVOICE', draft, invoiceInput()),
    ).rejects.toMatchObject({ code: 'FINALIZED_INVOICE_REQUIRED' });
    const invoice = await makeInvoice();
    await expect(
      postBillingSourceScoped(foreignScope, 'BILLING_INVOICE', invoice, invoiceInput()),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    await expect(
      postBillingSourceScoped(scope, 'BILLING_INVOICE', invoice, {
        ...invoiceInput(),
        patientReceivableAccountId: foreignAccount,
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_OUT_OF_SCOPE' });
    await expect(
      postBillingSourceScoped(scope, 'BILLING_INVOICE', invoice, {
        ...invoiceInput(),
        patientReceivableAccountId: revenue,
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_CLASSIFICATION_INVALID' });
    await expect(
      postBillingSourceScoped(scope, 'BILLING_INVOICE', invoice, {
        ...invoiceInput(),
        revenueAccountId: undefined,
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_REQUIRED' });
    const receipt = await pay(invoice, '20.00', 'PATIENT');
    await expect(
      postBillingSourceScoped(scope, 'BILLING_PAYMENT', receipt.payment.id, paymentInput()),
    ).rejects.toMatchObject({ code: 'ACTIVE_INVOICE_POSTING_REQUIRED' });
    // A nonexistent posting actor causes a FK failure after journal creation begins;
    // no journal or source link can survive that transaction.
    const before = (
      await pool.query('SELECT count(*)::int AS n FROM journal_entries WHERE facility_id=$1', [
        facility,
      ])
    ).rows[0].n;
    await expect(
      postBillingSourceScoped(
        { ...scope, actorUserId: 2147483647 },
        'BILLING_INVOICE',
        invoice,
        invoiceInput(),
      ),
    ).rejects.toBeDefined();
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM journal_entries WHERE facility_id=$1', [
          facility,
        ])
      ).rows[0].n,
    ).toBe(before);
    // A separately approved refund remains a source event if its journal
    // cannot be posted in a closed period; neither the receipt nor history is edited.
    await postBillingSourceScoped(scope, 'BILLING_INVOICE', invoice, invoiceInput());
    await postBillingSourceScoped(scope, 'BILLING_PAYMENT', receipt.payment.id, paymentInput());
    const refund = await approvedSyntheticManualRefund(context, {
      facilityId: facility,
      invoiceId: invoice,
      paymentId: receipt.payment.id,
      amount: '5.00',
      refundMethod: 'CASH',
      reason: 'Synthetic period-closure refund',
      manualConfirmation: true,
      idempotencyKey: randomUUID(),
    });
    const unopenedInvoice = await makeInvoice();
    const journalsBeforeClose = (
      await pool.query('SELECT count(*)::int n FROM journal_entries WHERE facility_id=$1', [
        facility,
      ])
    ).rows[0].n;
    await closeFinancialPeriodScoped(scope, period, 'Synthetic close');
    await expect(
      postBillingSourceScoped(scope, 'BILLING_INVOICE', unopenedInvoice, invoiceInput()),
    ).rejects.toMatchObject({ code: 'OPEN_PERIOD_REQUIRED' });
    await expect(
      postBillingSourceScoped(scope, 'BILLING_REFUND', refund.refund.id, {
        ...paymentInput(),
        receivableRefundKes: '5.00',
      }),
    ).rejects.toMatchObject({ code: 'OPEN_PERIOD_REQUIRED' });
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM journal_entries WHERE facility_id=$1', [
          facility,
        ])
      ).rows[0].n,
    ).toBe(journalsBeforeClose);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM accounting_billing_postings WHERE source_type='BILLING_REFUND' AND source_id=$1",
          [refund.refund.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query('SELECT paid_amount::text paid FROM billing_invoices WHERE id=$1', [
          invoice,
        ])
      ).rows[0].paid,
    ).toBe('15.00');
  });
});
