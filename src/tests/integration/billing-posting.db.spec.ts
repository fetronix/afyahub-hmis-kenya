/** End-to-end accounting checks against isolated synthetic PostgreSQL data. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { pool } from '../../db/index.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { createSession } from '../../auth/session.service.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';
import { finalizeInvoice } from '../../billing/finalized-invoice.service.ts';
import { recordSettledPayment } from '../../billing/payments.service.ts';
import { recordManualRefund } from '../../billing/refunds.service.ts';
import { inspectBillingLedgerScoped } from '../../accounting/billing-ledger-diagnostics.service.ts';
import { inspectBillingJournalExceptionsScoped } from '../../accounting/billing-journal-exceptions.service.ts';
import { postBillingSourceScoped } from '../../accounting/billing-posting.service.ts';
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
  const paymentInput = (key = randomUUID()) => ({
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
    const refund = await recordManualRefund(context, {
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
    const otherRefund = await recordManualRefund(context, {
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

  it('reports billed codes absent from the current catalogue without patient details and rolls tariff changes back on audit failure', async () => {
    const invoice = await makeInvoice(false);
    await pool.query('UPDATE billing_items SET tariff_id=NULL,tariff_code=$2 WHERE invoice_id=$1', [
      invoice,
      `MISSING-${suffix}`,
    ]);
    const report = await httpJson(
      base,
      'GET',
      `/api/billing/tariff-validation?facilityId=${facility}&limit=200`,
      { token: managerToken },
    );
    expect(report.status).toBe(200);
    const billed = report.body.checks.find(
      (row: { code: string | null }) => row.code === `MISSING-${suffix}`,
    );
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
        await httpJson(
          base,
          'GET',
          `/api/billing/tariff-validation?facilityId=${facility}&limit=200`,
          { token: foreignToken },
        )
      ).status,
    ).toBe(403);
    const input = {
      facilityId: facility,
      code: `ATOMIC-${suffix}`,
      description: 'Synthetic service',
      department: 'opd',
      unit: 'Visit',
      fee: '42.00',
    };
    const path = '/api/service-tariffs';
    const functionName = `synthetic_tariff_fail_${suffix.replace(/-/g, '')}`;
    const triggerName = `synthetic_tariff_trigger_${suffix.replace(/-/g, '')}`;
    await pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.user_id='${actor}' AND NEW.resource='FACILITY_SERVICE_TARIFF' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF;
      RETURN NEW; END $$`);
    await pool.query(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
    );
    try {
      expect(
        (await httpJson(base, 'POST', path, { token: managerToken, body: input })).status,
      ).toBe(500);
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM facility_service_tariffs WHERE facility_id=$1 AND code=$2',
            [facility, input.code.toUpperCase()],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await httpJson(base, 'PUT', `${path}/${tariff}`, {
            token: managerToken,
            body: { ...input, code: `SYN-${suffix}`, fee: '99.00', department: 'laboratory' },
          })
        ).status,
      ).toBe(500);
      expect(
        (await pool.query('SELECT fee::text FROM facility_service_tariffs WHERE id=$1', [tariff]))
          .rows[0].fee,
      ).toBe('50.00');
      expect(
        (
          await httpJson(base, 'PATCH', `${path}/${tariff}/deactivate`, {
            token: managerToken,
            body: { facilityId: facility },
          })
        ).status,
      ).toBe(500);
      expect(
        (await pool.query('SELECT is_active FROM facility_service_tariffs WHERE id=$1', [tariff]))
          .rows[0].is_active,
      ).toBe(true);
    } finally {
      await pool.query(`DROP TRIGGER ${triggerName} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${functionName}()`);
    }
  });

  it('validates and atomically imports only explicitly approved tariffs with safe retries', async () => {
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
    const path = '/api/service-tariffs/import';
    const preview = await httpJson(base, 'POST', `${path}/validate`, {
      token: managerToken,
      body: { facilityId: facility, rows },
    });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ valid: true, rowCount: 2, issues: [] });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM facility_service_tariffs WHERE facility_id=$1 AND code=ANY($2::text[])',
          [facility, rows.map((r) => r.code.toUpperCase())],
        )
      ).rows[0].n,
    ).toBe(0);
    const invalid = await httpJson(base, 'POST', `${path}/validate`, {
      token: managerToken,
      body: { facilityId: facility, rows: [{ ...rows[0], fee: undefined }] },
    });
    expect(invalid.body.valid).toBe(false);
    expect(invalid.body.issues[0].reasons).toContain('MISSING_PRICE');
    const duplicate = await httpJson(base, 'POST', `${path}/validate`, {
      token: managerToken,
      body: {
        facilityId: facility,
        rows: [rows[0], { ...rows[0], code: rows[0].code.toLowerCase() }],
      },
    });
    expect(duplicate.body.issues[0].reasons).toContain('DUPLICATE_CODE_IN_BATCH');
    const key = randomUUID();
    const body = {
      facilityId: facility,
      rows,
      idempotencyKey: key,
      confirmed: true,
      approvalReference: 'Synthetic facility review',
    };
    expect((await httpJson(base, 'POST', path, { token: accountingOnlyToken, body })).status).toBe(
      403,
    );
    expect((await httpJson(base, 'POST', path, { token: foreignToken, body })).status).toBe(403);
    expect(
      (
        await httpJson(base, 'POST', path, {
          token: managerToken,
          body: { ...body, confirmed: false },
        })
      ).status,
    ).toBe(400);
    const attempts = await Promise.all(
      Array.from({ length: 4 }, () => httpJson(base, 'POST', path, { token: managerToken, body })),
    );
    expect(attempts.filter((response) => response.status === 201)).toHaveLength(1);
    expect(attempts.filter((response) => response.status === 200)).toHaveLength(3);
    expect(new Set(attempts.map((response) => response.body.batchId)).size).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM facility_service_tariffs WHERE facility_id=$1 AND code=ANY($2::text[])',
          [facility, rows.map((r) => r.code.toUpperCase())],
        )
      ).rows[0].n,
    ).toBe(2);
    expect(
      (
        await httpJson(base, 'POST', path, {
          token: managerToken,
          body: { ...body, approvalReference: 'Different review' },
        })
      ).body.error,
    ).toBe('IDEMPOTENCY_CONFLICT');
    const status = await httpJson(base, 'POST', `${path}/status`, {
      token: managerToken,
      body: { facilityId: facility, idempotencyKey: key },
    });
    expect(status.body).toMatchObject({
      status: 'RECORDED',
      rowCount: 2,
      batchId: attempts[0].body.batchId,
    });
    await expect(
      pool.query('UPDATE facility_tariff_import_batches SET row_count=row_count WHERE id=$1', [
        status.body.batchId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    const conflict = await httpJson(base, 'POST', `${path}/validate`, {
      token: managerToken,
      body: { facilityId: facility, rows },
    });
    expect(conflict.body.issues[0].reasons).toContain('CODE_ALREADY_EXISTS');

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
      const failure = await httpJson(base, 'POST', path, {
        token: managerToken,
        body: { ...body, rows: failingRows, idempotencyKey: randomUUID() },
      });
      expect(failure.status).toBe(500);
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
    await closeFinancialPeriodScoped(scope, period, 'Synthetic close');
    await expect(
      postBillingSourceScoped(scope, 'BILLING_INVOICE', invoice, invoiceInput()),
    ).rejects.toMatchObject({ code: 'OPEN_PERIOD_REQUIRED' });
  });
});
