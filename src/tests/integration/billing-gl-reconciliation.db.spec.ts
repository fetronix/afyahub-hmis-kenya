/**
 * Billing subledger ↔ general-ledger tie-out, exercised over HTTP and verified
 * directly against PostgreSQL. Synthetic data only.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { pool } from '../../db/index.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { createSession } from '../../auth/session.service.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';
import { finalizeInvoice } from '../../billing/finalized-invoice.service.ts';
import { recordSettledPayment } from '../../billing/payments.service.ts';
import { postBillingSourceScoped } from '../../accounting/billing-posting.service.ts';
import {
  createAccountScoped,
  createFinancialPeriodScoped,
  type AccountingScope,
} from '../../accounting/accounting.service.ts';
import { describeDb } from '../vitest/support/db.ts';

const URL = '/api/accounting/billing-gl-reconciliation';

type Control = {
  control: string;
  accounts: Array<{ accountId: number; accountCode: string | null; balanceKes: string }>;
  ledgerKes: string;
  bridgeKes: string;
  subledgerKes: string;
  bridgeDifferenceKes: string;
  subledgerDifferenceKes: string;
  status: string;
};

type Report = {
  asOf: string;
  tieOut: Control[];
  bridge: { postings: number; reversedAsOf: number; mismatchCount: number };
  subledger: Record<string, string | number>;
  exceptions: {
    unpostedInvoices: Array<{ invoiceId: number; totalKes: string }>;
    unpostedReceipts: Array<{ paymentId: number; amountKes: string; party: string | null }>;
    unexplainedJournals: Array<{ journalId: number; netKes: string; accountIds: number[] }>;
    unexplainedJournalCount: number;
  };
  summary: { controlsTied: number; controlsWithBacklog: number; reconciled: boolean };
  limitations: Record<string, string>;
};

const control = (report: Report, name: string) => {
  const row = report.tieOut.find((entry) => entry.control === name);
  if (!row) throw new Error(`Missing control ${name}`);
  return row;
};

describeDb('Billing subledger to general-ledger reconciliation', () => {
  const suffix = randomUUID().slice(0, 8);
  let tenant: number;
  let date: string;
  const facilityIds: number[] = [];
  let base: string;
  let close: () => Promise<void>;
  let accountingOnlyToken: string;
  let sharedRole: number;
  let seq = 0;

  type Ledger = {
    facility: number;
    scope: AccountingScope;
    context: AuthorizationContext;
    token: string;
    patientAr: number;
    insurerAr: number;
    cash: number;
    liability: number;
    revenue: number;
    patientId: number;
    encounterId: number;
    tariffId: number;
  };
  // One facility per scenario keeps every assertion an exact number.
  let invoiceScenario: Ledger;
  let backlogScenario: Ledger;
  let manualScenario: Ledger;
  let reversalScenario: Ledger;
  let emptyScenario: Ledger;

  async function makeLedger(code: string): Promise<Ledger> {
    const facility = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,mfl_code,address,county,phone,enabled_modules)
         VALUES($1,$2,'Synthetic Reconciliation Hospital',$3,'Ledger Road','Nyeri','0000000000','["finance","accounting","opd"]')
         RETURNING id`,
        [tenant, `${code}-${suffix}`, `MFL-${code}-${suffix}`],
      )
    ).rows[0].id as number;
    facilityIds.push(facility);
    // Facility scoping is enforced per user, so each scenario needs its own session.
    const facilityUser = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,'Synthetic facility accountant','test-only','ACTIVE',$3,$4) RETURNING id`,
        [`recon-${code}-${suffix}`, `recon-${code}-${suffix}@example.test`, tenant, facility],
      )
    ).rows[0].id as number;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
      facilityUser,
      sharedRole,
    ]);
    const token = (await createSession({ userId: facilityUser, securityVersion: 1 })).sessionToken;
    const scoped: AccountingScope = {
      tenantId: tenant,
      facilityId: facility,
      actorUserId: facilityUser,
    };
    const ledgerContext: AuthorizationContext = {
      userId: facilityUser,
      tenantId: tenant,
      facilityId: facility,
      roles: [],
      permissions: [
        'billing.read',
        'billing.update',
        'billing.payments.record',
        'billing.refunds.record',
        'clinical.read',
        'accounting.read',
        'accounting.journals.post',
      ],
      isSuperAdmin: false,
    };
    const account = async (accountCode: string, type: 'ASSET' | 'LIABILITY' | 'REVENUE') =>
      (
        await createAccountScoped(scoped, {
          accountCode,
          accountName: `Synthetic ${accountCode}`,
          accountType: type,
          subType: accountCode,
          normalBalance: type === 'ASSET' ? 'DEBIT' : 'CREDIT',
        })
      ).id as number;
    // A finalized invoice needs the tariff, patient and encounter of its own facility.
    const tariffId = (
      await pool.query(
        `INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee)
         VALUES($1,$2,$3,'Synthetic reconciliation service','OPD','Visit','100.00') RETURNING id`,
        [tenant, facility, `SYN-${code}-${suffix}`],
      )
    ).rows[0].id as number;
    const patientId = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
         VALUES($1,$2,$3,'Synthetic','Reconciler','2000-01-01','Other') RETURNING id`,
        [tenant, facility, `RECON-${code}-${suffix}`],
      )
    ).rows[0].id as number;
    const department = (
      await pool.query(
        'INSERT INTO departments(facility_id,name,code) VALUES($1,$2,$3) RETURNING id',
        [facility, 'Synthetic OPD', `OPD-${code}-${suffix}`],
      )
    ).rows[0].id;
    const practitioner = (
      await pool.query(
        'INSERT INTO practitioners(tenant_id,facility_id,full_name) VALUES($1,$2,$3) RETURNING id',
        [tenant, facility, 'Synthetic clinician'],
      )
    ).rows[0].id;
    const encounterId = (
      await pool.query(
        `INSERT INTO encounters(tenant_id,facility_id,patient_id,practitioner_id,department_id)
         VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [tenant, facility, patientId, practitioner, department],
      )
    ).rows[0].id as number;
    await pool.query(
      `INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description)
       VALUES($1,$2,'ICD-10','Z00.0','Synthetic test')`,
      [encounterId, patientId],
    );
    const ledger: Ledger = {
      facility,
      scope: scoped,
      context: ledgerContext,
      token,
      patientAr: await account('PATIENT_AR', 'ASSET'),
      insurerAr: await account('INSURER_AR', 'ASSET'),
      cash: await account('CASH', 'ASSET'),
      liability: await account('CREDIT', 'LIABILITY'),
      revenue: await account('REVENUE', 'REVENUE'),
      patientId,
      encounterId,
      tariffId,
    };
    await createFinancialPeriodScoped(scoped, {
      periodCode: `SYN-${code}`,
      name: 'Synthetic open period',
      startDate: '2000-01-01',
      endDate: '2099-12-31',
    });
    return ledger;
  }

  async function makeInvoice(ledger: Ledger, total: string, insurer: string, copayment: string) {
    const invoiceId = (
      await pool.query(
        `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,encounter_id,invoice_number,
           total_amount,paid_amount,balance_amount,credit_balance,status,payer_type,payer_name,member_number)
         VALUES($1,$2,$3,$4,$5,$6,'0.00',$6,'0.00','Pending','Insurance','Synthetic payer','SYN')
         RETURNING id`,
        [
          tenant,
          ledger.facility,
          ledger.patientId,
          ledger.encounterId,
          `RECON-${suffix}-${++seq}`,
          total,
        ],
      )
    ).rows[0].id as number;
    await pool.query(
      `INSERT INTO billing_items(invoice_id,tariff_id,tariff_code,item_type,description,quantity,unit_price,total_amount)
       VALUES($1,$2,$3,'Consultation','Synthetic reconciliation line',1,$4,$4)`,
      [invoiceId, ledger.tariffId, `SYN-${suffix}`, total],
    );
    await finalizeInvoice(ledger.context, invoiceId, {
      insurerResponsibility: insurer,
      copayment,
      allocationBasis: 'Synthetic reviewed split',
    });
    return invoiceId;
  }

  const invoiceInput = (ledger: Ledger, key = randomUUID()) => ({
    entryDate: date,
    description: 'Synthetic reviewed invoice',
    idempotencyKey: key,
    patientReceivableAccountId: ledger.patientAr,
    insurerReceivableAccountId: ledger.insurerAr,
    revenueAccountId: ledger.revenue,
  });

  const paymentInput = (ledger: Ledger, key = randomUUID()) => ({
    entryDate: date,
    description: 'Synthetic reviewed receipt',
    idempotencyKey: key,
    settlementAccountId: ledger.cash,
    liabilityAccountId: ledger.liability,
  });

  const pay = (ledger: Ledger, invoiceId: number, amount: string, party: 'PATIENT' | 'INSURER') =>
    recordSettledPayment(
      ledger.context,
      {
        facilityId: ledger.facility,
        invoiceId,
        amount,
        payerParty: party,
        paymentMethod: 'Cash',
        allowPartyOverpayment: true,
        allowOverpayment: true,
        idempotencyKey: randomUUID(),
      },
      'Synthetic cashier',
    );

  const reconcile = async (ledger: Ledger, endDate = date) => {
    const response = await httpJson<{ success: boolean } & Report>(
      base,
      'GET',
      `${URL}?facilityId=${ledger.facility}&endDate=${endDate}`,
      { token: ledger.token },
    );
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    return response.body;
  };

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Synthetic test database required.');
    date = (await pool.query('SELECT current_date::text AS date')).rows[0].date;
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Recon ${suffix}`,
        `recon-${suffix}`,
      ])
    ).rows[0].id;
    const permissions = [
      'billing.read',
      'billing.update',
      'billing.payments.record',
      'billing.refunds.record',
      'clinical.read',
      'accounting.read',
      'accounting.journals.post',
    ];
    for (const code of permissions)
      await pool.query(
        `INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING`,
        [code],
      );
    sharedRole = (
      await pool.query(
        "INSERT INTO roles(tenant_id,name,is_active) VALUES($1,'FACILITY_ADMIN',true) RETURNING id",
        [tenant],
      )
    ).rows[0].id;
    for (const code of permissions)
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [sharedRole, code],
      );

    invoiceScenario = await makeLedger('INV');
    backlogScenario = await makeLedger('BKL');
    manualScenario = await makeLedger('MAN');
    reversalScenario = await makeLedger('REV');
    emptyScenario = await makeLedger('EMP');

    const restricted = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,'Synthetic accounting only','test-only','ACTIVE',$3,$4) RETURNING id`,
        [
          `recon-limited-${suffix}`,
          `recon-limited-${suffix}@example.test`,
          tenant,
          invoiceScenario.facility,
        ],
      )
    ).rows[0].id;
    const limitedRole = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenant, `RECON-LIMITED-${suffix}`],
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

    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });

  afterAll(async () => {
    if (close) await close();
  });

  it('ties revenue, receivables, cash and credit to the billing subledger after posting an invoice and two receipts', async () => {
    const ledger = invoiceScenario;
    const invoice = await makeInvoice(ledger, '100.00', '60.00', '10.00');
    await postBillingSourceScoped(ledger.scope, 'BILLING_INVOICE', invoice, invoiceInput(ledger));
    // 5.00 more than the patient owes: it is a credit the facility holds, not a
    // negative receivable, and it must still tie to the ledger.
    const patientReceipt = await pay(ledger, invoice, '45.00', 'PATIENT');
    const insurerReceipt = await pay(ledger, invoice, '60.00', 'INSURER');
    await postBillingSourceScoped(
      ledger.scope,
      'BILLING_PAYMENT',
      patientReceipt.payment.id,
      paymentInput(ledger),
    );
    await postBillingSourceScoped(
      ledger.scope,
      'BILLING_PAYMENT',
      insurerReceipt.payment.id,
      paymentInput(ledger),
    );

    const report = await reconcile(ledger);
    expect(report.asOf).toBe(date);
    expect(report.bridge.postings).toBe(3);
    expect(report.bridge.mismatchCount).toBe(0);

    const patientAr = control(report, 'PATIENT_RECEIVABLE');
    expect(patientAr.status).toBe('TIED');
    expect(patientAr.ledgerKes).toBe('0.00');
    expect(patientAr.subledgerKes).toBe('0.00');
    expect(patientAr.accounts.map((account) => account.accountId)).toEqual([ledger.patientAr]);

    const insurerAr = control(report, 'INSURER_RECEIVABLE');
    expect(insurerAr.status).toBe('TIED');
    expect(insurerAr.ledgerKes).toBe('0.00');

    // Revenue is credit-normal, so a debit-positive ledger balance is negative.
    expect(control(report, 'REVENUE').ledgerKes).toBe('-100.00');
    expect(control(report, 'REVENUE').subledgerKes).toBe('-100.00');
    expect(control(report, 'SETTLEMENT').ledgerKes).toBe('105.00');
    expect(control(report, 'SETTLEMENT').subledgerKes).toBe('105.00');
    const liability = control(report, 'CREDIT_LIABILITY');
    expect(liability.status).toBe('TIED');
    expect(liability.ledgerKes).toBe('-5.00');
    expect(liability.subledgerKes).toBe('-5.00');

    expect(report.subledger).toMatchObject({
      finalizedInvoices: 1,
      patientResponsibilityKes: '40.00',
      insurerResponsibilityKes: '60.00',
      patientOutstandingKes: '0.00',
      insurerOutstandingKes: '0.00',
      receiptsKes: '105.00',
      refundsKes: '0.00',
      unattributedReceiptsKes: '0.00',
      creditLiabilityKes: '5.00',
    });
    expect(report.summary.controlsTied).toBe(5);
    expect(report.summary.reconciled).toBe(true);
    expect(report.exceptions.unpostedInvoices).toEqual([]);
  });

  it('separates a finalized but unposted invoice into explained backlog instead of a false tie', async () => {
    const ledger = backlogScenario;
    const posted = await makeInvoice(ledger, '100.00', '60.00', '10.00');
    await postBillingSourceScoped(ledger.scope, 'BILLING_INVOICE', posted, invoiceInput(ledger));
    const pending = await makeInvoice(ledger, '50.00', '30.00', '5.00');

    const report = await reconcile(ledger);
    // Revenue: ledger -100.00 against subledger -150.00, fully explained by the
    // 50.00 invoice the ledger has never seen.
    const revenue = control(report, 'REVENUE');
    expect(revenue.ledgerKes).toBe('-100.00');
    expect(revenue.subledgerKes).toBe('-150.00');
    expect(revenue.subledgerDifferenceKes).toBe('50.00');
    expect(revenue.status).toBe('POSTING_BACKLOG');

    const patientAr = control(report, 'PATIENT_RECEIVABLE');
    expect(patientAr.subledgerDifferenceKes).toBe('-20.00');
    expect(patientAr.status).toBe('POSTING_BACKLOG');
    expect(control(report, 'INSURER_RECEIVABLE').status).toBe('POSTING_BACKLOG');
    expect(control(report, 'SETTLEMENT').status).toBe('NOT_CONFIGURED');
    expect(control(report, 'CREDIT_LIABILITY').status).toBe('NOT_CONFIGURED');

    expect(report.exceptions.unpostedInvoices).toEqual([
      expect.objectContaining({ invoiceId: pending, totalKes: '50.00' }),
    ]);
    expect(report.summary.controlsWithBacklog).toBe(3);
    expect(report.summary.reconciled).toBe(true);
    expect(report.limitations.lineLevelPostings).toBe('NOT_RECONCILED');
  });

  it('flags a receivable and revenue journal posted outside the reviewed bridge, then clears it after a controlled reversal', async () => {
    const ledger = manualScenario;
    const invoice = await makeInvoice(ledger, '100.00', '50.00', '0.00');
    await postBillingSourceScoped(ledger.scope, 'BILLING_INVOICE', invoice, invoiceInput(ledger));

    const journal = await httpJson<{ journal: { id: number; journalNumber: string } }>(
      base,
      'POST',
      '/api/accounting/journals',
      {
        token: ledger.token,
        body: {
          facilityId: ledger.facility,
          entryDate: date,
          description: 'Synthetic duplicate revenue outside billing',
          idempotencyKey: randomUUID(),
          lines: [
            { accountId: ledger.patientAr, debitKes: '25.00', creditKes: '0.00' },
            { accountId: ledger.revenue, debitKes: '0.00', creditKes: '25.00' },
          ],
        },
      },
    );
    expect(journal.status).toBe(201);
    const journalId = journal.body.journal.id;

    const leaked = await reconcile(ledger);
    const patientAr = control(leaked, 'PATIENT_RECEIVABLE');
    expect(patientAr.status).toBe('UNEXPLAINED');
    expect(patientAr.ledgerKes).toBe('75.00');
    expect(patientAr.subledgerKes).toBe('50.00');
    expect(patientAr.subledgerDifferenceKes).toBe('25.00');
    const revenue = control(leaked, 'REVENUE');
    expect(revenue.status).toBe('UNEXPLAINED');
    expect(revenue.subledgerDifferenceKes).toBe('-25.00');
    expect(leaked.summary.reconciled).toBe(false);
    expect(leaked.exceptions.unexplainedJournalCount).toBe(1);
    expect(leaked.exceptions.unexplainedJournals[0]).toMatchObject({
      journalId,
      netKes: '0.00',
      debitKes: '25.00',
      accountIds: expect.arrayContaining([ledger.patientAr, ledger.revenue]),
    });

    const reversal = await httpJson(base, 'POST', `/api/accounting/journals/${journalId}/reverse`, {
      token: ledger.token,
      body: {
        facilityId: ledger.facility,
        entryDate: date,
        reason: 'Synthetic controlled correction of an unbridged journal',
        idempotencyKey: randomUUID(),
      },
    });
    expect(reversal.status).toBe(201);

    const cleared = await reconcile(ledger);
    expect(control(cleared, 'PATIENT_RECEIVABLE').status).toBe('TIED');
    expect(control(cleared, 'REVENUE').status).toBe('TIED');
    expect(cleared.exceptions.unexplainedJournalCount).toBe(0);
    expect(cleared.bridge.reversedAsOf).toBe(0);
    expect(cleared.summary.reconciled).toBe(true);
  });

  it('reports an invoice reversed but left active as a revenue leak, and ties once the invoice is voided', async () => {
    const ledger = reversalScenario;
    const invoice = await makeInvoice(ledger, '30.00', '20.00', '0.00');
    const posted = await postBillingSourceScoped(
      ledger.scope,
      'BILLING_INVOICE',
      invoice,
      invoiceInput(ledger),
    );
    const reversal = await httpJson(
      base,
      'POST',
      `/api/accounting/journals/${posted.journal.id}/reverse`,
      {
        token: ledger.token,
        body: {
          facilityId: ledger.facility,
          entryDate: date,
          reason: 'Synthetic reversal of an invoice posting',
          idempotencyKey: randomUUID(),
        },
      },
    );
    expect(reversal.status).toBe(201);

    const reversed = await reconcile(ledger);
    const revenue = control(reversed, 'REVENUE');
    expect(revenue.ledgerKes).toBe('0.00');
    expect(revenue.subledgerKes).toBe('-30.00');
    expect(revenue.subledgerDifferenceKes).toBe('30.00');
    expect(revenue.status).toBe('UNEXPLAINED');
    expect(control(reversed, 'PATIENT_RECEIVABLE').subledgerDifferenceKes).toBe('-10.00');
    expect(control(reversed, 'INSURER_RECEIVABLE').subledgerDifferenceKes).toBe('-20.00');
    expect(reversed.bridge.reversedAsOf).toBe(1);
    expect(reversed.summary.reconciled).toBe(false);

    const voided = await httpJson(base, 'POST', `/api/invoices/${invoice}/void`, {
      token: ledger.token,
      body: { reason: 'Synthetic invoice withdrawn after reversal' },
    });
    expect(voided.status).toBe(200);

    const settled = await reconcile(ledger);
    expect(control(settled, 'REVENUE').status).toBe('TIED');
    expect(control(settled, 'PATIENT_RECEIVABLE').status).toBe('TIED');
    expect(control(settled, 'INSURER_RECEIVABLE').status).toBe('TIED');
    expect(settled.subledger.finalizedInvoices).toBe(0);
    expect(settled.summary.reconciled).toBe(true);
    expect(settled.bridge.reversedAsOf).toBe(1);
  });

  it('reports an unconfigured facility honestly instead of inventing a tie', async () => {
    const report = await reconcile(emptyScenario);
    expect(report.bridge.postings).toBe(0);
    expect(report.tieOut.map((row) => row.status)).toEqual(Array(5).fill('NOT_CONFIGURED'));
    expect(report.summary.controlsTied).toBe(0);
    expect(report.summary.reconciled).toBe(true);
    expect(report.subledger.finalizedInvoices).toBe(0);
    expect(report.exceptions.unexplainedJournalCount).toBe(0);
  });

  it('requires billing read alongside accounting read and validates the as-of date', async () => {
    const ledger = invoiceScenario;
    const forbidden = await httpJson<{ error?: string }>(
      base,
      'GET',
      `${URL}?facilityId=${ledger.facility}&endDate=${date}`,
      { token: accountingOnlyToken },
    );
    expect(forbidden.status).toBe(403);

    const missing = await httpJson<{ error?: string }>(
      base,
      'GET',
      `${URL}?facilityId=${ledger.facility}`,
      { token: ledger.token },
    );
    expect(missing.status).toBe(400);

    const malformed = await httpJson<{ error?: string }>(
      base,
      'GET',
      `${URL}?facilityId=${ledger.facility}&endDate=not-a-date`,
      { token: ledger.token },
    );
    expect(malformed.status).toBe(400);

    const inverted = await httpJson<{ error?: string }>(
      base,
      'GET',
      `${URL}?facilityId=${ledger.facility}&startDate=${date}&endDate=2000-01-01`,
      { token: ledger.token },
    );
    expect(inverted.status).toBe(400);
    expect(inverted.body.error).toBe('INVALID_RANGE');
  });

  it('never counts another facility’s postings in this facility’s tie-out', async () => {
    const report = await reconcile(invoiceScenario);
    const other = await reconcile(backlogScenario);
    expect(report.bridge.postings).toBe(3);
    expect(other.bridge.postings).toBe(1);
    expect(report.subledger.finalizedInvoices).toBe(1);
    expect(other.subledger.finalizedInvoices).toBe(2);
    // No account from another facility may appear in a role's account list.
    const invoiceAccounts = report.tieOut.flatMap((row) => row.accounts.map((a) => a.accountId));
    const otherAccounts = other.tieOut.flatMap((row) => row.accounts.map((a) => a.accountId));
    expect(invoiceAccounts.filter((id) => otherAccounts.includes(id))).toEqual([]);
    expect(report.bridge.postings).not.toBe(other.bridge.postings);
  });
});
