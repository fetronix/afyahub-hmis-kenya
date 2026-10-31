/** Synthetic PostgreSQL/HTTP verification. No real patient or provider is used. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { createSession } from '../../auth/session.service.ts';
import { chargeForService } from '../../billing/billing.service.ts';
import {
  approveMasterTariff,
  createImagingService,
  editMasterTariffs,
} from '../../billing/master-catalogue.service.ts';
import {
  attributeInvoicePayment,
  finalizeInvoice,
  getFinalizedInvoice,
} from '../../billing/finalized-invoice.service.ts';
import {
  cancelPendingPaymentRequest,
  checkPaymentRequestStatus,
  recordSettledPayment,
} from '../../billing/payments.service.ts';
import { previewClaimEvidence } from '../../insurance/claims/claim-evidence.service.ts';
import { recordManualRefund } from '../../billing/refunds.service.ts';
import { db, pool } from '../../db/index.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Finalized invoices and explicit receipt allocation', () => {
  const suffix = randomUUID().slice(0, 8);
  const basis = 'Synthetic responsibility allocation; not insurer approval';
  let tenant: number, facility: number, otherFacility: number, patient: number, encounter: number;
  let tariff: number, actor: number, token: string, billingOnlyToken: string, foreignToken: string;
  let ctx: AuthorizationContext, base: string, close: () => Promise<void>;
  let sequence = 0;
  const allocation = { insurerResponsibility: '60.00', copayment: '10.00', allocationBasis: basis };

  async function makeInvoice(options: { encounterId?: number | null; coded?: boolean } = {}) {
    const id = (
      await pool.query(
        `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,encounter_id,invoice_number,
       total_amount,paid_amount,balance_amount,credit_balance,status,payer_type,payer_name,member_number)
       VALUES($1,$2,$3,$4,$5,'100.00','0.00','100.00','0.00','Pending','Insurance','Synthetic payer','SYN-MEMBER') RETURNING id`,
        [
          tenant,
          facility,
          patient,
          options.encounterId === undefined ? encounter : options.encounterId,
          `SYN-FIN-${suffix}-${++sequence}`,
        ],
      )
    ).rows[0].id as number;
    await pool.query(
      `INSERT INTO billing_items(invoice_id,tariff_id,tariff_code,item_type,description,quantity,unit_price,total_amount)
       VALUES($1,$2,$3,'Consultation','Synthetic consultation',2,'50.00','100.00')`,
      [
        id,
        options.coded === false ? null : tariff,
        options.coded === false ? null : `SYN-${suffix}`,
      ],
    );
    return id;
  }
  const pay = (invoiceId: number, amount: string, party?: 'PATIENT' | 'INSURER', key?: string) =>
    recordSettledPayment(
      ctx,
      {
        facilityId: facility,
        invoiceId,
        amount,
        paymentMethod: 'Cash',
        payerParty: party,
        idempotencyKey: key,
      },
      'Synthetic cashier',
    );

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Synthetic test database required.');
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic ${suffix}`,
        `fin-${suffix}`,
      ])
    ).rows[0].id;
    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,mfl_code,address,county,phone,enabled_modules)
       VALUES($1,$2,'Synthetic Hospital',$3,'Synthetic Road','Nyeri','0000000000','["finance","opd","insurance"]'),
             ($1,$4,'Other Synthetic Hospital',$5,'Other Road','Nyeri','0000000001','["finance","opd","insurance"]') RETURNING id`,
      [tenant, `A-${suffix}`, `MFL-A-${suffix}`, `B-${suffix}`, `MFL-B-${suffix}`],
    );
    [facility, otherFacility] = facilities.rows.map((r) => r.id);
    patient = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,middle_name,last_name,date_of_birth,gender)
       VALUES($1,$2,$3,'Synthetic','Test','Patient','2000-01-01','Other') RETURNING id`,
        [tenant, facility, `MRN-${suffix}`],
      )
    ).rows[0].id;
    for (const code of [
      'billing.read',
      'billing.update',
      'billing.payments.record',
      'billing.refunds.record',
      'clinical.read',
      'insurance.sha.claims.prepare',
      'insurance.private.claims.prepare',
      'laboratory.read',
      'pharmacy.read',
      'inpatient.read',
    ])
      await pool.query(
        `INSERT INTO permissions(code,name,module) VALUES($1,$1,'test') ON CONFLICT(code) DO NOTHING`,
        [code],
      );
    async function makeActor(tag: string, facilityId: number, grants: string[]) {
      const id = (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,'Synthetic user','test-only','ACTIVE',$3,$4) RETURNING id`,
          [`fin-${tag}-${suffix}`, `fin-${tag}-${suffix}@example.test`, tenant, facilityId],
        )
      ).rows[0].id as number;
      const role = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenant, `FIN_${tag}_${suffix}`],
        )
      ).rows[0].id;
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
      for (const code of grants)
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
          [role, code],
        );
      return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
    }
    const manager = await makeActor('manager', facility, [
      'billing.read',
      'billing.update',
      'billing.payments.record',
      'billing.refunds.record',
      'clinical.read',
      'insurance.sha.claims.prepare',
      'insurance.private.claims.prepare',
      'laboratory.read',
      'pharmacy.read',
      'inpatient.read',
    ]);
    const billingOnly = await makeActor('billing', facility, ['billing.read']);
    const foreign = await makeActor('foreign', otherFacility, [
      'billing.read',
      'billing.update',
      'billing.payments.record',
      'clinical.read',
    ]);
    actor = manager.id;
    token = manager.token;
    billingOnlyToken = billingOnly.token;
    foreignToken = foreign.token;
    ctx = {
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
        'insurance.sha.claims.prepare',
        'insurance.private.claims.prepare',
        'laboratory.read',
        'pharmacy.read',
        'inpatient.read',
      ],
      isSuperAdmin: false,
    };
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
        'INSERT INTO encounters(tenant_id,facility_id,patient_id,practitioner_id,department_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [tenant, facility, patient, practitioner, department],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description) VALUES($1,$2,'ICD-10','Z00.0','Synthetic test diagnosis')`,
      [encounter, patient],
    );
    tariff = (
      await pool.query(
        `INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee)
       VALUES($1,$2,$3,'Synthetic consultation','OPD','Visit','50.00') RETURNING id`,
        [tenant, facility, `SYN-${suffix}`],
      )
    ).rows[0].id;
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
  });
  afterAll(async () => {
    if (close) await close();
  });

  it('refuses missing encounter or tariff evidence without inventing details', async () => {
    const id = await makeInvoice({ encounterId: null, coded: false });
    await expect(finalizeInvoice(ctx, id, allocation)).rejects.toMatchObject({
      code: 'FINALIZATION_INCOMPLETE',
      issues: expect.arrayContaining([
        expect.stringContaining('encounter'),
        expect.stringContaining('tariff'),
      ]),
    });
    expect(
      (await pool.query('SELECT finalized_at FROM billing_invoices WHERE id=$1', [id])).rows[0]
        .finalized_at,
    ).toBeNull();
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM billing_invoice_finalizations WHERE invoice_id=$1',
          [id],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('serializes finalization, preserves authoritative snapshots, and freezes lines', async () => {
    const id = await makeInvoice();
    const attempts = await Promise.all(
      Array.from({ length: 4 }, () => finalizeInvoice(ctx, id, allocation)),
    );
    expect(attempts.filter((a) => !a.idempotentReplay)).toHaveLength(1);
    const first = await getFinalizedInvoice(ctx, id);
    expect(first.finalized).toBe(true);
    if (!first.finalized) throw new Error('Expected finalization');
    expect(first.snapshot).toMatchObject({
      facility: { name: 'Synthetic Hospital', registryCode: `MFL-A-${suffix}`, county: 'Nyeri' },
      patient: { mrn: `MRN-${suffix}`, name: 'Synthetic Test Patient' },
      encounter: {
        id: encounter,
        department: 'Synthetic OPD',
        attendingClinician: 'Synthetic clinician',
        diagnoses: [{ system: 'ICD-10', code: 'Z00.0' }],
      },
      amounts: {
        itemizedTotal: '100.00',
        discounts: null,
        adjustments: null,
        patientResponsibility: '40.00',
        insurerResponsibility: '60.00',
        copayment: '10.00',
      },
    });
    await pool.query("UPDATE facilities SET name='Changed synthetic name' WHERE id=$1", [facility]);
    const after = await getFinalizedInvoice(ctx, id);
    expect(after.finalized && after.snapshot.facility.name).toBe('Synthetic Hospital');
    await pool.query("UPDATE facilities SET name='Synthetic Hospital' WHERE id=$1", [facility]);
    await expect(
      pool.query("UPDATE billing_invoices SET total_amount='1.00' WHERE id=$1", [id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('DELETE FROM billing_items WHERE invoice_id=$1', [id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query("UPDATE billing_invoice_finalizations SET snapshot='{}' WHERE invoice_id=$1", [
        id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      finalizeInvoice(ctx, id, { ...allocation, insurerResponsibility: '50.00' }),
    ).rejects.toMatchObject({ code: 'ALREADY_FINALIZED' });
    // A different, completed service must create a separate open invoice, not
    // mutate the finalized one or duplicate its historical consultation line.
    const target = { id: facility, tenantId: tenant, enabledModules: ['finance', 'radiology'] };
    const imaging = await createImagingService(target, actor, {
      description: 'Synthetic reported examination',
    });
    const [edited] = await editMasterTariffs(target, actor, [
      {
        tariffId: imaging.tariff.id,
        revision: imaging.tariff.revision,
        fee: '50.00',
        unit: 'Study',
        isActive: true,
        autoBill: true,
        effectiveFrom: null,
        effectiveTo: null,
      },
    ]);
    await approveMasterTariff(target, actor, edited.id, edited.revision, 'synthetic review');
    const [order] = (
      await pool.query(
        "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,encounter_id,modality,master_service_id,procedure_name,status,reported_at) VALUES($1,$2,$3,$4,'X-Ray',$5,'Synthetic reported examination','Reported',now()) RETURNING id",
        [tenant, facility, patient, encounter, imaging.master.id],
      )
    ).rows;
    const charge = await chargeForService(db, {
      tenantId: tenant,
      facilityId: facility,
      patientId: patient,
      encounterId: encounter,
      codes: [imaging.master.code],
      sourceType: 'RADIOLOGY',
      sourceId: order.id,
      itemType: 'Radiology',
    });
    expect(charge.charged).toBe(true);
    expect(charge.invoiceId).not.toBe(id);
    expect((await getFinalizedInvoice(ctx, id)).finalized).toBe(true);
  });

  it('records idempotent partial payments by party and carries refunds back to the original party', async () => {
    const id = await makeInvoice();
    await finalizeInvoice(ctx, id, allocation);
    const key = randomUUID();
    const retries = await Promise.all(
      Array.from({ length: 4 }, () => pay(id, '30.00', 'PATIENT', key)),
    );
    expect(retries.filter((r) => !r.idempotentReplay)).toHaveLength(1);
    expect(new Set(retries.map((r) => r.payment.id)).size).toBe(1);
    await expect(pay(id, '31.00', 'PATIENT', key)).rejects.toMatchObject({
      code: 'PAYMENT_IDEMPOTENCY_CONFLICT',
    });
    await expect(pay(id, '11.00', 'PATIENT', randomUUID())).rejects.toMatchObject({
      code: 'PAYMENT_EXCEEDS_PARTY_BALANCE',
    });
    const insurer = await pay(id, '50.00', 'INSURER', randomUUID());
    let view = await getFinalizedInvoice(ctx, id);
    if (!view.finalized) throw new Error('Expected finalization');
    expect(view.financial).toMatchObject({
      patientBalance: '10.00',
      insurerBalance: '10.00',
      netReceipts: '80.00',
      unattributedNetReceipts: '0.00',
    });
    await expect(
      recordManualRefund(ctx, {
        facilityId: facility,
        invoiceId: id,
        paymentId: insurer.payment.id,
        amount: '1.00',
        refundMethod: 'CASH',
        reason: 'Synthetic payer refund',
        manualConfirmation: true,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'PAYER_REFUND_REVIEW_REQUIRED' });
    await recordManualRefund(ctx, {
      facilityId: facility,
      invoiceId: id,
      paymentId: retries[0].payment.id,
      amount: '5.00',
      refundMethod: 'CASH',
      reason: 'Synthetic patient refund',
      manualConfirmation: true,
      idempotencyKey: randomUUID(),
    });
    view = await getFinalizedInvoice(ctx, id);
    if (!view.finalized) throw new Error('Expected finalization');
    expect(view.financial).toMatchObject({
      patientNetReceipts: '25.00',
      patientBalance: '15.00',
      insurerBalance: '10.00',
      netReceipts: '75.00',
    });
    expect(view.refunds).toHaveLength(1);
  });

  it('does not guess historical receipt attribution and provides immutable audited attribution', async () => {
    const id = await makeInvoice();
    const existing = await pay(id, '20.00');
    await finalizeInvoice(ctx, id, allocation);
    let view = await getFinalizedInvoice(ctx, id);
    if (!view.finalized) throw new Error('Expected finalization');
    expect(view.financial).toMatchObject({
      unattributedNetReceipts: '20.00',
      patientBalance: null,
      insurerBalance: null,
    });
    await expect(pay(id, '1.00', 'PATIENT', randomUUID())).rejects.toMatchObject({
      code: 'PAYMENT_ATTRIBUTION_REQUIRED',
    });
    const attributed = await attributeInvoicePayment(
      ctx,
      id,
      existing.payment.id,
      'PATIENT',
      'Reviewed synthetic receipt',
    );
    expect(attributed.idempotentReplay).toBe(false);
    expect(
      (
        await attributeInvoicePayment(
          ctx,
          id,
          existing.payment.id,
          'PATIENT',
          'Reviewed synthetic receipt',
        )
      ).idempotentReplay,
    ).toBe(true);
    await expect(
      attributeInvoicePayment(
        ctx,
        id,
        existing.payment.id,
        'INSURER',
        'Different synthetic attribution',
      ),
    ).rejects.toMatchObject({ code: 'ATTRIBUTION_EXISTS' });
    await expect(
      pool.query("UPDATE billing_payment_attributions SET party='INSURER' WHERE id=$1", [
        attributed.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    view = await getFinalizedInvoice(ctx, id);
    if (!view.finalized) throw new Error('Expected finalization');
    expect(view.financial).toMatchObject({
      patientBalance: '20.00',
      insurerBalance: '60.00',
      unattributedNetReceipts: '0.00',
    });
  });

  it('limits clinical statement reads, isolates facilities and audits access', async () => {
    const id = await makeInvoice();
    await finalizeInvoice(ctx, id, allocation);
    expect(
      (await httpJson(base, 'GET', `/api/invoices/${id}/finalization`, { token: billingOnlyToken }))
        .status,
    ).toBe(403);
    expect(
      (await httpJson(base, 'GET', `/api/invoices/${id}/finalization`, { token: foreignToken }))
        .status,
    ).toBe(403);
    const normalDetail = await httpJson(base, 'GET', `/api/invoices/${id}`, {
      token: billingOnlyToken,
    });
    expect(normalDetail.status).toBe(200);
    expect(JSON.stringify(normalDetail.body)).not.toContain('Synthetic test diagnosis');
    const statement = await httpJson(base, 'GET', `/api/invoices/${id}/finalization`, { token });
    expect(statement.status).toBe(200);
    expect(statement.body.snapshot.encounter.diagnoses[0].code).toBe('Z00.0');
    const logs = await pool.query(
      `SELECT count(*)::int AS n FROM patient_record_access_logs WHERE patient_id=$1 AND user_id=$2 AND record_id=$3 AND record_type='FinalizedInvoice' AND action='VIEW'`,
      [patient, actor, id],
    );
    expect(logs.rows[0].n).toBeGreaterThan(0);
    const denied = { ...ctx, permissions: ['billing.read'], isSuperAdmin: false };
    await expect(getFinalizedInvoice(denied, id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('atomically cancels an unrecorded receipt request or returns an already committed receipt', async () => {
    const id = await makeInvoice();
    await finalizeInvoice(ctx, id, allocation);
    const key = randomUUID();
    const cancelled = await cancelPendingPaymentRequest(ctx, {
      facilityId: facility,
      invoiceId: id,
      idempotencyKey: key,
      reason: 'Reviewed pending receipt',
    });
    expect(cancelled.status).toBe('CANCELLED');
    expect(
      await checkPaymentRequestStatus(ctx, { facilityId: facility, idempotencyKey: key }),
    ).toMatchObject({ status: 'CANCELLED', invoiceId: id });
    await expect(pay(id, '5.00', 'PATIENT', key)).rejects.toMatchObject({
      code: 'PAYMENT_REQUEST_CANCELLED',
    });
    const second = randomUUID();
    const posted = await pay(id, '5.00', 'PATIENT', second);
    expect(
      await cancelPendingPaymentRequest(ctx, {
        facilityId: facility,
        invoiceId: id,
        idempotencyKey: second,
        reason: 'Reviewed pending receipt',
      }),
    ).toMatchObject({ status: 'RECORDED', paymentId: posted.payment.id });
    for (let i = 0; i < 5; i++) {
      const raceKey = randomUUID();
      const [receipt, cancellation] = await Promise.allSettled([
        pay(id, '1.00', 'PATIENT', raceKey),
        cancelPendingPaymentRequest(ctx, {
          facilityId: facility,
          invoiceId: id,
          idempotencyKey: raceKey,
          reason: 'Reviewed simultaneous request',
        }),
      ]);
      expect(cancellation.status).toBe('fulfilled');
      if (cancellation.status !== 'fulfilled') throw cancellation.reason;
      if (cancellation.value.status === 'CANCELLED') {
        expect(receipt.status).toBe('rejected');
        await expect(pay(id, '1.00', 'PATIENT', raceKey)).rejects.toMatchObject({
          code: 'PAYMENT_REQUEST_CANCELLED',
        });
      } else {
        expect(receipt.status).toBe('fulfilled');
        expect(
          await checkPaymentRequestStatus(ctx, { facilityId: facility, idempotencyKey: raceKey }),
        ).toMatchObject({ status: 'RECORDED' });
      }
    }
  });

  it('previews only authorized, selected clinical records for this patient and encounter', async () => {
    const id = await makeInvoice();
    await finalizeInvoice(ctx, id, allocation);
    const otherPatient = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
      VALUES($1,$2,$3,'Other','Synthetic','2001-01-01','Other') RETURNING id`,
        [tenant, facility, `OTHER-${suffix}`],
      )
    ).rows[0].id;
    const order = (
      await pool.query(
        `INSERT INTO lab_orders(tenant_id,facility_id,patient_id,encounter_id,test_name,status)
      VALUES($1,$2,$3,$4,'Synthetic relevant test','Completed') RETURNING id`,
        [tenant, facility, patient, encounter],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO lab_orders(tenant_id,facility_id,patient_id,encounter_id,test_name,status)
      VALUES($1,$2,$3,$4,'Other patient secret','Completed')`,
      [tenant, facility, otherPatient, encounter],
    );
    await pool.query(
      `INSERT INTO lab_results(order_id,patient_id,parameter_name,measured_value,status)
      VALUES($1,$2,'Synthetic verified','12','Verified'),($1,$2,'Synthetic pending','13','Pending Verification'),($1,$3,'Other patient result','999','Verified')`,
      [order, patient, otherPatient],
    );
    const input = {
      invoiceId: id,
      payerKind: 'SHA',
      payerCode: 'SHA',
      categories: ['summary', 'diagnoses', 'laboratory'],
    };
    const preview = await previewClaimEvidence(ctx, input);
    const text = JSON.stringify(preview);
    expect(text).toContain('Synthetic verified');
    expect(text).not.toContain('Synthetic pending');
    expect(text).not.toContain('Other patient secret');
    expect(text).not.toContain('Other patient result');
    expect(preview.notice).toContain('does not attach');
    await expect(
      previewClaimEvidence(
        { ...ctx, permissions: ctx.permissions.filter((p) => p !== 'laboratory.read') },
        input,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      previewClaimEvidence({ ...ctx, facilityId: otherFacility }, input),
    ).rejects.toMatchObject({ code: 'FACILITY_ACCESS_DENIED' });
    const before = (
      await pool.query(
        `SELECT count(*)::int AS n FROM patient_record_access_logs WHERE patient_id=$1 AND record_id=$2 AND record_type='ClaimEvidencePreview'`,
        [patient, id],
      )
    ).rows[0].n;
    expect(before).toBeGreaterThan(0);
    await expect(
      previewClaimEvidence(ctx, { ...input, referralId: 999999, referralRelevanceConfirmed: true }),
    ).rejects.toMatchObject({ code: 'REFERRAL_NOT_AVAILABLE' });
    await expect(
      previewClaimEvidence(ctx, { ...input, preauthorizationId: 999999 }),
    ).rejects.toMatchObject({ code: 'PREAUTH_NOT_AVAILABLE' });
    const result = await httpJson(base, 'POST', '/api/insurance/evidence/preview', {
      token,
      body: input,
    });
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).not.toContain('Other patient secret');
    expect(
      (
        await httpJson(base, 'POST', '/api/insurance/evidence/preview', {
          token: billingOnlyToken,
          body: input,
        })
      ).status,
    ).toBe(403);
  });

  it('requires explicit referral relevance and a payer-, patient- and encounter-matched authorization', async () => {
    const id = await makeInvoice();
    await finalizeInvoice(ctx, id, allocation);
    const referral = (
      await pool.query(
        `INSERT INTO referrals(referral_number,patient_id,source_tenant_id,source_facility_id,reason)
       VALUES($1,$2,$3,$4,'Synthetic referral') RETURNING id`,
        [`REF-${suffix}`, patient, tenant, facility],
      )
    ).rows[0].id;
    const makePreauth = async (payerCode: string, invoiceLink: number) =>
      (
        await pool.query(
          `INSERT INTO insurance_preauthorizations
      (tenant_id,facility_id,patient_id,encounter_id,invoice_id,payer_code,preauth_number,external_bundle_id,clinical_indication,primary_diagnosis_code,primary_diagnosis_display,requested_service_code,requested_service_name,estimated_amount)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'Synthetic','Z00','Synthetic','TEST','Synthetic','100') RETURNING id`,
          [
            tenant,
            facility,
            patient,
            encounter,
            invoiceLink,
            payerCode,
            `PA-${payerCode}-${suffix}`,
            `BUNDLE-${payerCode}-${suffix}`,
          ],
        )
      ).rows[0].id;
    const sha = await makePreauth('SHA', id);
    const other = await makePreauth('SYNPRIVATE', id);
    const input = {
      invoiceId: id,
      payerKind: 'SHA',
      payerCode: 'SHA',
      categories: [],
      referralId: referral,
      preauthorizationId: sha,
    };
    await expect(previewClaimEvidence(ctx, input)).rejects.toMatchObject({
      code: 'REFERRAL_REVIEW_REQUIRED',
    });
    await expect(
      previewClaimEvidence(ctx, {
        ...input,
        referralRelevanceConfirmed: true,
        preauthorizationId: other,
      }),
    ).rejects.toMatchObject({ code: 'PREAUTH_NOT_AVAILABLE' });
    const preview = await previewClaimEvidence(ctx, { ...input, referralRelevanceConfirmed: true });
    expect(preview.referral?.id).toBe(referral);
    expect(preview.authorization?.id).toBe(sha);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM referral_access_logs WHERE referral_id=$1 AND patient_id=$2 AND action='VIEW'`,
          [referral, patient],
        )
      ).rows[0].n,
    ).toBe(1);
    await pool.query(
      `INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,encounter_id,modality,procedure_name,status,radiologist_findings,impression,reported_at)
      VALUES($1,$2,$3,$4,'CT','Synthetic unreported','Requested','Unreported secret','Unreported impression',NULL),
            ($1,$2,$3,$4,'CT','Synthetic reported','Reported','Synthetic finding','Synthetic impression',now())`,
      [tenant, facility, patient, encounter],
    );
    const radiology = await previewClaimEvidence(ctx, {
      invoiceId: id,
      payerKind: 'SHA',
      payerCode: 'SHA',
      categories: ['radiology'],
    });
    expect(JSON.stringify(radiology)).toContain('Synthetic finding');
    expect(JSON.stringify(radiology)).not.toContain('Unreported secret');
    expect(JSON.stringify(radiology)).not.toContain('Unreported impression');
  });

  it('does not return evidence if its access audit cannot be written', async () => {
    const id = await makeInvoice();
    await finalizeInvoice(ctx, id, allocation);
    const name = `evidence_audit_${suffix.replaceAll('-', '')}`;
    const client = await pool.connect();
    try {
      await client.query(
        `CREATE FUNCTION ${name}() RETURNS trigger AS $$ BEGIN IF NEW.record_type='ClaimEvidencePreview' AND NEW.user_id=${actor} THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
      );
      await client.query(
        `CREATE TRIGGER ${name} BEFORE INSERT ON patient_record_access_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      );
      const response = await httpJson(base, 'POST', '/api/insurance/evidence/preview', {
        token,
        body: { invoiceId: id, payerKind: 'SHA', payerCode: 'SHA', categories: ['summary'] },
      });
      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body)).not.toContain('Synthetic test diagnosis');
    } finally {
      await client.query(`DROP TRIGGER IF EXISTS ${name} ON patient_record_access_logs`);
      await client.query(`DROP FUNCTION IF EXISTS ${name}()`);
      client.release();
    }
  });

  it('prevents a snapshot from committing without its matching finalized invoice', async () => {
    const id = await makeInvoice();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO billing_invoice_finalizations(invoice_id,tenant_id,facility_id,finalized_by_user_id,patient_responsibility,insurer_responsibility,copayment,allocation_basis,snapshot)
       VALUES($1,$2,$3,$4,40,60,10,'Synthetic basis','{}')`,
        [id, tenant, facility, actor],
      );
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM billing_invoice_finalizations WHERE invoice_id=$1',
          [id],
        )
      ).rows[0].n,
    ).toBe(0);
  });
});
