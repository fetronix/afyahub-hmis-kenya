import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import { finalizeInvoice } from '../../billing/finalized-invoice.service.ts';
import { recordSettledPayment } from '../../billing/payments.service.ts';
import { recordManualRefund } from '../../billing/refunds.service.ts';
import { postBillingSourceScoped } from '../../accounting/billing-posting.service.ts';
import {
  createAccountScoped,
  createFinancialPeriodScoped,
  getAccountingOverviewScoped,
  type AccountingScope,
} from '../../accounting/accounting.service.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

// Synthetic PostgreSQL and manually reviewed account choices only. This does
// not assert external payment, provider acceptance, or automatic posting.
describeDb('Phase 3 clinical-to-reviewed-ledger journeys (synthetic PostgreSQL)', () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  let tenant: number, facility: number, actor: number, department: number, practitioner: number;
  let ar: number, cash: number, credit: number, revenue: number, date: string;
  let context: AuthorizationContext,
    scope: AccountingScope,
    token: string,
    base: string,
    close: () => Promise<void>;
  let opdInvoice: number, opdPayment: number, opdReceipt: string;
  const call = (method: string, path: string, body?: Record<string, unknown>) =>
    httpJson(base, method, path, { token, body });

  beforeAll(async () => {
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic journey tenant',
        `p3-journey-${suffix}`,
      ])
    ).rows[0].id;
    facility = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,mfl_code,address,county,phone,timezone,enabled_modules)
      VALUES($1,$2,'Synthetic journey facility',$3,'Synthetic address','Nairobi','0000000000','Africa/Nairobi',$4::jsonb) RETURNING id`,
        [
          tenant,
          `P3J-${suffix}`,
          `MFL-${suffix}`,
          JSON.stringify(['registration', 'finance', 'accounting', 'opd', 'laboratory']),
        ],
      )
    ).rows[0].id;
    actor = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic staff','test-only','ACTIVE',$3,$4) RETURNING id",
        [`p3j-${suffix}`, `p3j-${suffix}@example.test`, tenant, facility],
      )
    ).rows[0].id;
    const role = (
      await pool.query(
        "INSERT INTO roles(tenant_id,name,is_active) VALUES($1,'FACILITY_ADMIN',true) RETURNING id",
        [tenant],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [actor, role]);
    const permissions = [
      'patients.read',
      'clinical.read',
      'clinical.create',
      'clinical.update',
      'laboratory.read',
      'laboratory.orders.create',
      'laboratory.results.enter',
      'laboratory.results.verify',
      'billing.read',
      'billing.create',
      'billing.update',
      'billing.payments.record',
      'billing.refunds.record',
      'tariffs.read',
      'tariffs.manage',
      'accounting.read',
      'accounting.journals.post',
    ];
    for (const permission of permissions) {
      await pool.query(
        "INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING",
        [permission],
      );
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, permission],
      );
    }
    token = (await createSession({ userId: actor, securityVersion: 1 })).sessionToken;
    context = {
      userId: actor,
      tenantId: tenant,
      facilityId: facility,
      roles: ['FACILITY_ADMIN'],
      permissions,
      isSuperAdmin: false,
    };
    scope = { tenantId: tenant, facilityId: facility, actorUserId: actor };
    department = (
      await pool.query(
        "INSERT INTO departments(facility_id,name,code) VALUES($1,'Synthetic OPD',$2) RETURNING id",
        [facility, `OPD-${suffix}`],
      )
    ).rows[0].id;
    practitioner = (
      await pool.query(
        "INSERT INTO practitioners(tenant_id,facility_id,full_name) VALUES($1,$2,'Synthetic clinician') RETURNING id",
        [tenant, facility],
      )
    ).rows[0].id;
    async function account(code: string, type: 'ASSET' | 'LIABILITY' | 'REVENUE') {
      return (
        await createAccountScoped(scope, {
          accountCode: code,
          accountName: `Synthetic ${code}`,
          accountType: type,
          subType: code,
          normalBalance: type === 'ASSET' ? 'DEBIT' : 'CREDIT',
        })
      ).id;
    }
    ar = await account('PATIENT_AR', 'ASSET');
    cash = await account('CASH', 'ASSET');
    credit = await account('CREDIT', 'LIABILITY');
    revenue = await account('REVENUE', 'REVENUE');
    await createFinancialPeriodScoped(scope, {
      periodCode: 'SYN',
      name: 'Synthetic period',
      startDate: '2000-01-01',
      endDate: '2099-12-31',
    });
    date = (await pool.query('SELECT current_date::text AS date')).rows[0].date;
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  async function newPatient(label: string) {
    return (
      await pool.query(
        "INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Journey','2000-01-01','Other') RETURNING id",
        [tenant, facility, `P3-${label}-${suffix}`],
      )
    ).rows[0].id as number;
  }
  async function service(
    code: string,
    category: string,
    departmentName: string,
    unit: string,
    price: string,
  ) {
    const created = await call('POST', '/api/facility-services', {
      facilityId: facility,
      code,
      name: `Synthetic ${code}`,
      description: `Synthetic ${code}`,
      department: departmentName,
      category,
      unit,
      initialPrice: price,
      isActive: true,
      autoBill: true,
    });
    expect(created.status).toBe(201);
    return created.body;
  }
  async function encounter(patientId: number, serviceId?: number) {
    const created = await call('POST', '/api/encounters', {
      facilityId: facility,
      patientId,
      encounterType: 'Outpatient',
      status: 'Active',
      departmentId: department,
      practitionerId: practitioner,
      ...(serviceId ? { consultationFacilityServiceId: serviceId } : {}),
    });
    expect(created.status).toBe(201);
    await pool.query(
      "INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description) VALUES($1,$2,'ICD-10','Z00.0','Synthetic examination')",
      [created.body.id, patientId],
    );
    return created.body.id as number;
  }
  async function finalizePayAndPost(invoiceId: number, amount: string) {
    const allocation = {
      insurerResponsibility: '0.00',
      copayment: '0.00',
      allocationBasis: 'Synthetic self-pay review',
    };
    expect((await finalizeInvoice(context, invoiceId, allocation)).idempotentReplay).toBe(false);
    expect((await finalizeInvoice(context, invoiceId, allocation)).idempotentReplay).toBe(true);
    const invoicePosting = {
      entryDate: date,
      description: 'Synthetic reviewed invoice',
      idempotencyKey: randomUUID(),
      patientReceivableAccountId: ar,
      revenueAccountId: revenue,
    };
    const posted = await postBillingSourceScoped(
      scope,
      'BILLING_INVOICE',
      invoiceId,
      invoicePosting,
    );
    expect(
      (await postBillingSourceScoped(scope, 'BILLING_INVOICE', invoiceId, invoicePosting))
        .idempotentReplay,
    ).toBe(true);
    const paymentInput = {
      facilityId: facility,
      invoiceId,
      amount,
      paymentMethod: 'Cash',
      payerParty: 'PATIENT' as const,
      idempotencyKey: randomUUID(),
    };
    const [a, b] = await Promise.all([
      recordSettledPayment(context, paymentInput, 'Synthetic cashier'),
      recordSettledPayment(context, paymentInput, 'Synthetic cashier'),
    ]);
    expect(a.payment.id).toBe(b.payment.id);
    expect([a.idempotentReplay, b.idempotentReplay].filter(Boolean)).toHaveLength(1);
    expect(a.payment.receiptNumber).toBeTruthy();
    expect(a.invoice).toMatchObject({
      totalAmount: amount,
      paidAmount: amount,
      balanceAmount: '0.00',
    });
    const paymentPosting = {
      entryDate: date,
      description: 'Synthetic reviewed cash receipt',
      idempotencyKey: randomUUID(),
      settlementAccountId: cash,
      liabilityAccountId: credit,
    };
    const received = await postBillingSourceScoped(
      scope,
      'BILLING_PAYMENT',
      a.payment.id,
      paymentPosting,
    );
    expect(
      (await postBillingSourceScoped(scope, 'BILLING_PAYMENT', a.payment.id, paymentPosting))
        .idempotentReplay,
    ).toBe(true);
    expect(posted.journal.id).not.toBe(received.journal.id);
    const totals = (
      await pool.query(
        `SELECT j.id, COALESCE(sum(l.debit_cents),0)::text debit, COALESCE(sum(l.credit_cents),0)::text credit
      FROM journal_entries j JOIN journal_lines l ON l.journal_entry_id=j.id WHERE j.tenant_id=$1 AND j.facility_id=$2 AND j.id=ANY($3::int[]) AND j.status='POSTED' GROUP BY j.id`,
        [tenant, facility, [posted.journal.id, received.journal.id]],
      )
    ).rows;
    expect(totals).toHaveLength(2);
    const cents = String(Math.round(Number(amount) * 100));
    expect(totals.every((row) => row.debit === cents && row.credit === cents)).toBe(true);
    return a.payment;
  }

  it('A: records one OPD charge, finalized invoice, manual cash receipt and reviewed balanced journals', async () => {
    const patient = await newPatient('OPD');
    const consultation = await service('P3-OPD', 'CONSULTATION', 'opd', 'Visit', '150.00');
    const visit = await encounter(patient, consultation.service.id);
    const completed = await call('PUT', `/api/encounters/${visit}`, { status: 'Completed' });
    expect(completed.body.billing).toMatchObject({ charged: true, totalAmount: '150.00' });
    opdInvoice = completed.body.billing.invoiceId;
    expect(
      (await call('PUT', `/api/encounters/${visit}`, { status: 'Completed' })).body.billing.reason,
    ).toBe('DUPLICATE');
    const lines = (
      await pool.query(
        "SELECT unit_price::text,total_amount::text FROM billing_items WHERE source_type='CONSULTATION' AND source_id=$1",
        [visit],
      )
    ).rows;
    expect(lines).toEqual([{ unit_price: '150.00', total_amount: '150.00' }]);
    const receipt = await finalizePayAndPost(opdInvoice, '150.00');
    opdPayment = receipt.id;
    opdReceipt = receipt.receiptNumber;
  });

  it('B: bills a verified, completed laboratory service once, then records cash and reviewed journals', async () => {
    const patient = await newPatient('LAB');
    const lab = await service('P3-LAB', 'LABORATORY', 'laboratory', 'Test', '456.00');
    const visit = await encounter(patient);
    const order = await call('POST', '/api/lab-orders/batch', {
      patientId: patient,
      encounterId: visit,
      facilityServiceId: lab.service.id,
      specimenType: 'Synthetic blood',
      clinicalIndication: 'Synthetic',
      priority: 'Routine',
      idempotencyKey: randomUUID(),
    });
    expect(order.status).toBe(201);
    const id = order.body.orders[0].id;
    expect(
      (
        await pool.query(
          "SELECT id FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [id],
        )
      ).rows,
    ).toHaveLength(0);
    await call('PUT', `/api/lab-orders/${id}/status`, { status: 'Sample Collected' });
    const result = await call('POST', '/api/lab-results', {
      orderId: id,
      patientId: patient,
      parameterName: 'Synthetic',
      measuredValue: '1',
    });
    expect((await call('POST', `/api/lab-orders/${id}/complete`, {})).status).toBe(409);
    await call('POST', `/api/lab-results/${result.body.id}/verify`, {});
    const completed = await call('POST', `/api/lab-orders/${id}/complete`, {});
    expect(completed.body.billing).toMatchObject({ charged: true, totalAmount: '456.00' });
    expect((await call('POST', `/api/lab-orders/${id}/complete`, {})).body.billing.reason).toBe(
      'DUPLICATE',
    );
    expect(
      (
        await pool.query(
          "SELECT unit_price::text,total_amount::text FROM billing_items WHERE source_type='LAB_ORDER' AND source_id=$1",
          [id],
        )
      ).rows,
    ).toEqual([{ unit_price: '456.00', total_amount: '456.00' }]);
    await finalizePayAndPost(completed.body.billing.invoiceId, '456.00');
  });

  it('E/G: retains the original manual receipt, records a partial refund once, and reconciles posted statements', async () => {
    const input = {
      facilityId: facility,
      invoiceId: opdInvoice,
      paymentId: opdPayment,
      amount: '25.00',
      refundMethod: 'CASH',
      reason: 'Synthetic partial refund review',
      manualConfirmation: true,
      idempotencyKey: randomUUID(),
    };
    const [a, b] = await Promise.all([
      recordManualRefund(context, input),
      recordManualRefund(context, input),
    ]);
    expect(a.refund.id).toBe(b.refund.id);
    const posting = {
      entryDate: date,
      description: 'Synthetic reviewed manual refund',
      idempotencyKey: randomUUID(),
      settlementAccountId: cash,
      liabilityAccountId: credit,
      receivableRefundKes: '25.00',
    };
    const journal = await postBillingSourceScoped(scope, 'BILLING_REFUND', a.refund.id, posting);
    expect(
      (await postBillingSourceScoped(scope, 'BILLING_REFUND', a.refund.id, posting))
        .idempotentReplay,
    ).toBe(true);
    expect(journal.journal.id).toBeTruthy();
    const receipt = (
      await pool.query(
        'SELECT receipt_number,amount::text FROM billing_payments WHERE id=$1 AND invoice_id=$2',
        [opdPayment, opdInvoice],
      )
    ).rows[0];
    expect(receipt).toEqual({ receipt_number: opdReceipt, amount: '150.00' });
    expect(
      (
        await pool.query('SELECT count(*)::int n FROM billing_refunds WHERE payment_id=$1', [
          opdPayment,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT paid_amount::text,balance_amount::text FROM billing_invoices WHERE id=$1',
          [opdInvoice],
        )
      ).rows[0],
    ).toEqual({ paid_amount: '125.00', balance_amount: '25.00' });
    const report = await getAccountingOverviewScoped(scope, date, date);
    expect(report.trialBalance).toMatchObject({
      debitKes: '1237.00',
      creditKes: '1237.00',
      balanced: true,
    });
    expect(report.profitAndLoss).toMatchObject({
      postedRevenueKes: '606.00',
      postedExpensesKes: '0.00',
      ledgerResultKes: '606.00',
    });
    expect(report.balanceSheet).toMatchObject({
      assetsKes: '606.00',
      liabilitiesKes: '0.00',
      equityIncludingAccumulatedResultKes: '606.00',
      balanced: true,
    });
    expect(report.limitations.billingReconciliation).toBe('NOT_IMPLEMENTED');
  });
});
