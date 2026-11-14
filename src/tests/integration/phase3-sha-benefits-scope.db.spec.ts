import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSession } from '../../auth/session.service.ts';
import { assignPayer } from '../../insurance/hub/service.ts';
import {
  createBenefitRule,
  reviewBenefitRuleStatus,
  upsertFacilityPayerConfig,
  upsertServiceCodeMapping,
} from '../../insurance/eclaims/configuration.service.ts';
import type { InsuranceActorScope } from '../../insurance/eclaims/contracts.ts';
import { describeDb, testPool } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

// These are synthetic stored-evidence fixtures, not a provider response, payer
// contract, approved facility policy, external submission, or real coverage.
// HTTP requests still exercise the real session, module, payer and RBAC guards.
describeDb('Phase 3 SHA benefit evidence and scope (synthetic PostgreSQL)', () => {
  const pool = testPool();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  let tenant: number, foreignTenant: number, facility: number, otherFacility: number, actor: number;
  let patient: number, otherPatient: number, encounter: number, tariff: number, mapping: number;
  let ruleId: number;
  let shaManual: number, privateManual: number, foreignFacilityEligibility: number;
  let foreignTenantEligibility: number, simulated: number, unavailable: number, ineligible: number;
  let expired: number, future: number;
  let token: string, otherToken: string, deniedToken: string, base: string;
  let close: () => Promise<void>;

  const post = (body: Record<string, unknown>, bearer = token) =>
    httpJson(base, 'POST', '/api/insurance/sha/benefits/validate', { token: bearer, body });
  const input = (eligibilityVerificationId?: number) => ({
    patientId: patient,
    encounterId: encounter,
    tariffId: tariff,
    benefitPackage: 'SYNTHETIC',
    serviceDate: '2026-10-28',
    ...(eligibilityVerificationId === undefined ? {} : { eligibilityVerificationId }),
  });

  beforeAll(async () => {
    tenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic SHA scope tenant',
        `p3-sha-${suffix}`,
      ])
    ).rows[0].id;
    foreignTenant = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        'Synthetic SHA other tenant',
        `p3-sha-other-${suffix}`,
      ])
    ).rows[0].id;
    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,level,mfl_code,enabled_modules)
       VALUES($1,$2,'Synthetic SHA A','Level 4',$4,'["registration","insurance"]'::jsonb),
             ($1,$3,'Synthetic SHA B','Level 4',$5,'["registration","insurance"]'::jsonb) RETURNING id`,
      [tenant, `P3-SHA-A-${suffix}`, `P3-SHA-B-${suffix}`, `MFL-A-${suffix}`, `MFL-B-${suffix}`],
    );
    [facility, otherFacility] = facilities.rows.map((row) => row.id);
    async function user(label: string, facilityId: number) {
      return (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
           VALUES($1,$1,$2,'Synthetic staff','test-only','ACTIVE',$3,$4) RETURNING id`,
          [
            `p3-sha-${label}-${suffix}`,
            `p3-sha-${label}-${suffix}@example.test`,
            tenant,
            facilityId,
          ],
        )
      ).rows[0].id as number;
    }
    actor = await user('a', facility);
    const otherActor = await user('b', otherFacility);
    const deniedActor = await user('denied', facility);
    async function role(name: string, users: number[], permissions: string[]) {
      const roleId = (
        await pool.query(
          'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
          [tenant, `${name}-${suffix}`],
        )
      ).rows[0].id;
      for (const userId of users)
        await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [userId, roleId]);
      for (const permission of permissions) {
        await pool.query(
          "INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING",
          [permission],
        );
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2 ON CONFLICT DO NOTHING',
          [roleId, permission],
        );
      }
    }
    await role(
      'SHA-TEST',
      [actor, otherActor],
      [
        'patients.read',
        'patients.create',
        'insurance.sha.read',
        'insurance.sha.benefits.validate',
        'insurance.sha.reconciliation.manage',
      ],
    );
    await role('SHA-DENIED', [deniedActor], ['patients.read']);
    [token, otherToken, deniedToken] = await Promise.all(
      [actor, otherActor, deniedActor].map(
        async (userId) => (await createSession({ userId, securityVersion: 1 })).sessionToken,
      ),
    );
    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));
    const registered = await httpJson(base, 'POST', '/api/patients', {
      token,
      body: {
        registrationFacilityId: facility,
        firstName: 'Synthetic',
        lastName: 'Benefit patient',
        dateOfBirth: '2000-01-01',
        gender: 'Other',
      },
    });
    expect(registered.status).toBe(201);
    patient = registered.body.id;
    otherPatient = (
      await pool.query(
        `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
         VALUES($1,$2,$3,'Synthetic','Other','2000-01-01','Other') RETURNING id`,
        [tenant, otherFacility, `P3-SHA-OTHER-${suffix}`],
      )
    ).rows[0].id;
    encounter = (
      await pool.query(
        `INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status)
         VALUES($1,$2,$3,'OUTPATIENT','COMPLETED') RETURNING id`,
        [tenant, facility, patient],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description)
       VALUES($1,$2,'ICD-10','Z00.0','Synthetic examination')`,
      [encounter, patient],
    );
    tariff = (
      await pool.query(
        `INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,fee)
         VALUES($1,$2,$3,'Synthetic consultation','OPD','100.00') RETURNING id`,
        [tenant, facility, `P3-SHA-TARIFF-${suffix}`],
      )
    ).rows[0].id;
    const scope: InsuranceActorScope = {
      tenantId: tenant,
      facilityId: facility,
      userId: actor,
      userUid: `p3-sha-a-${suffix}`,
    };
    const provider = (
      await pool.query("SELECT id FROM insurance_payer_definitions WHERE code='SHA'")
    ).rows[0].id;
    await assignPayer(actor, provider, facility, true);
    await assignPayer(actor, provider, otherFacility, true);
    await upsertFacilityPayerConfig(scope, {
      isActive: true,
      contractedSchemes: ['SYNTHETIC'],
      requireVerifiedEligibility: true,
    });
    await upsertFacilityPayerConfig(
      {
        tenantId: tenant,
        facilityId: otherFacility,
        userId: otherActor,
        userUid: `p3-sha-b-${suffix}`,
      },
      { isActive: true, contractedSchemes: ['SYNTHETIC'], requireVerifiedEligibility: true },
    );
    mapping = (
      await upsertServiceCodeMapping(scope, {
        tariffId: tariff,
        localCode: `P3-SHA-TARIFF-${suffix}`,
        localDescription: 'Synthetic consultation',
        serviceArea: 'OPD',
        payerServiceCode: 'SHA-TEST-001',
        payerServiceName: 'Synthetic test code only',
        fund: 'SYNTHETIC',
        accessPoint: 'OP',
        paymentMechanism: 'SYNTHETIC',
        reimbursementTariff: '75.00',
        requiresClinicalNotes: false,
      })
    ).id;
    const rule = await createBenefitRule(scope, {
      ruleCode: `SYN-${suffix}`,
      benefitPackage: 'SYNTHETIC',
      serviceCategory: 'OPD',
      payerServiceCode: 'SHA-TEST-001',
      requiredEvidence: ['DIAGNOSIS'],
      copayType: 'NONE',
      sourceReference: 'Synthetic test fixture only',
      effectiveFrom: '2000-01-01',
    });
    ruleId = rule.id;
    await reviewBenefitRuleStatus(scope, rule.id, 'APPROVE');

    async function eligibility(
      options: {
        tenantId?: number;
        facilityId?: number;
        payer?: string;
        source?: string;
        isSimulated?: boolean;
        outcome?: string;
        start?: string | null;
        end?: string | null;
        checkedAt?: string;
      } = {},
    ) {
      return (
        await pool.query(
          `INSERT INTO insurance_eligibility_verifications
           (tenant_id,facility_id,patient_id,payer_code,identification_type,identification_hint,
            outcome,source,is_simulated,manual_reference,checked_by_user_id,response_classification,
            coverage_start_date,coverage_end_date,checked_at)
           VALUES($1,$2,$3,$4,'SHA_NUMBER','synthetic',$5,$6,$7,'synthetic-test-reference',$8,'SYNTHETIC', $9,$10,COALESCE($11::timestamp,now())) RETURNING id`,
          [
            options.tenantId ?? tenant,
            options.facilityId ?? facility,
            patient,
            options.payer ?? 'SHA',
            options.outcome ?? 'Eligible',
            options.source ?? 'MANUAL_VERIFICATION:SYNTHETIC_TEST',
            options.isSimulated ?? false,
            actor,
            options.start ?? null,
            options.end ?? null,
            options.checkedAt ?? null,
          ],
        )
      ).rows[0].id as number;
    }
    shaManual = await eligibility();
    privateManual = await eligibility({ payer: 'BRITAM' });
    foreignFacilityEligibility = await eligibility({ facilityId: otherFacility });
    // A deliberately inconsistent row tests defense in depth against legacy corruption.
    foreignTenantEligibility = await eligibility({
      tenantId: foreignTenant,
      checkedAt: '2090-01-01',
    });
    simulated = await eligibility({ isSimulated: true, source: 'SANDBOX_SIMULATION' });
    unavailable = await eligibility({ source: 'UNAVAILABLE' });
    ineligible = await eligibility({ outcome: 'Ineligible' });
    expired = await eligibility({ end: '2025-12-31' });
    future = await eligibility({ start: '2027-01-01' });
  });

  afterAll(async () => {
    if (close) await close();
  });

  it('rejects another payer, facility, tenant or nonexistent explicit evidence without saving a validation', async () => {
    const before = (
      await pool.query(
        'SELECT count(*)::int n FROM insurance_benefit_validations WHERE facility_id=$1',
        [facility],
      )
    ).rows[0].n;
    for (const id of [
      privateManual,
      foreignFacilityEligibility,
      foreignTenantEligibility,
      2147483647,
    ]) {
      const result = await post(input(id));
      expect(result.status).toBe(404);
      expect(result.body).toMatchObject({ error: 'ELIGIBILITY_NOT_FOUND' });
    }
    const after = (
      await pool.query(
        'SELECT count(*)::int n FROM insurance_benefit_validations WHERE facility_id=$1',
        [facility],
      )
    ).rows[0].n;
    expect(after).toBe(before);
  });

  it('enforces session, permission and same-tenant facility isolation for the HTTP route', async () => {
    expect((await post(input(shaManual), '')).status).toBe(401);
    expect((await post(input(shaManual), deniedToken)).status).toBe(403);
    const wrongFacility = await post(input(shaManual), otherToken);
    expect([403, 404]).toContain(wrongFacility.status);
    expect((await post({ ...input(shaManual), facilityId: otherFacility })).status).toBe(403);
  });

  it('keeps mock and unavailable eligibility unverified, and labels a manual negative as manual', async () => {
    const mock = await post(input(simulated));
    expect(mock.status).toBe(201);
    expect(mock.body.validation).toMatchObject({
      decision: 'UNABLE_TO_VERIFY',
      verificationSource: 'SIMULATED_NOT_VERIFIED',
      isSimulated: true,
      payerTariffAmount: null,
      deductibleEstimate: null,
      estimatedCopayAmount: null,
      estimatedCoveredAmount: null,
    });
    const untrusted = await post(input(unavailable));
    expect(untrusted.status).toBe(201);
    expect(untrusted.body.validation).toMatchObject({
      decision: 'UNABLE_TO_VERIFY',
      verificationSource: 'UNVERIFIED_ELIGIBILITY_SOURCE',
      estimatedCoveredAmount: null,
    });
    const negative = await post(input(ineligible));
    expect(negative.body.validation).toMatchObject({
      decision: 'NOT_COVERED',
      verificationSource: 'MANUAL_VERIFICATION:SYNTHETIC_TEST',
    });
  });

  it('does not use eligibility outside recorded dates or substitute the facility price for an unknown payer rate', async () => {
    const invalidDate = await post({ ...input(shaManual), serviceDate: '2026-02-31' });
    expect(invalidDate.status).toBe(400);
    expect(invalidDate.body.error).toBe('INVALID_SERVICE_DATE');
    for (const evidence of [expired, future]) {
      const result = await post(input(evidence));
      expect(result.status).toBe(201);
      expect(result.body.validation).toMatchObject({
        decision: 'UNABLE_TO_VERIFY',
        verificationSource: 'ELIGIBILITY_OUTSIDE_RECORDED_WINDOW',
        estimatedCoveredAmount: null,
      });
    }
    await pool.query(
      'UPDATE payer_service_code_mappings SET reimbursement_tariff=NULL WHERE id=$1',
      [mapping],
    );
    try {
      const result = await post(input(shaManual));
      expect(result.status).toBe(201);
      expect(result.body.validation).toMatchObject({
        decision: 'UNABLE_TO_VERIFY',
        verificationSource: 'PAYER_RATE_NOT_RECORDED',
        payerTariffAmount: null,
        deductibleEstimate: null,
        estimatedCopayAmount: null,
        estimatedCoveredAmount: null,
      });
      const persisted = (
        await pool.query(
          'SELECT deductible_estimate,estimated_copay_amount FROM insurance_benefit_validations WHERE id=$1',
          [result.body.validation.id],
        )
      ).rows[0];
      expect(persisted).toEqual({ deductible_estimate: null, estimated_copay_amount: null });
    } finally {
      await pool.query(
        "UPDATE payer_service_code_mappings SET reimbursement_tariff='75.00' WHERE id=$1",
        [mapping],
      );
    }
  });

  it('holds unsupported SHA financial terms instead of guessing an estimate', async () => {
    try {
      for (const [field, value] of [
        ['annual_limit', '100.00'],
        ['deductible_amount', '10.00'],
        ['coinsurance_percent', '5.00'],
      ] as const) {
        // Names are hard-coded test identifiers, never user-supplied SQL.
        await pool.query(`UPDATE payer_benefit_rules SET ${field}=$2 WHERE id=$1`, [ruleId, value]);
        const result = await post(input(shaManual));
        expect(result.body.validation).toMatchObject({
          decision: 'UNABLE_TO_VERIFY',
          verificationSource: 'UNSUPPORTED_RULE_FINANCIAL_TERMS',
          deductibleEstimate: null,
          estimatedCopayAmount: null,
          estimatedCoveredAmount: null,
        });
        await pool.query(`UPDATE payer_benefit_rules SET ${field}=$2 WHERE id=$1`, [
          ruleId,
          field === 'annual_limit' ? null : '0.00',
        ]);
      }
    } finally {
      await pool.query(
        "UPDATE payer_benefit_rules SET annual_limit=NULL,deductible_amount='0.00',coinsurance_percent='0.00' WHERE id=$1",
        [ruleId],
      );
    }
  });

  it('preserves historical ambiguous defaults but does not present them as estimates', async () => {
    const old = await post(input(unavailable));
    const id = old.body.validation.id as number;
    // A legacy fixture simulates the old schema's defaults; the read must not
    // change the stored record or turn that ambiguous zero into an estimate.
    await pool.query(
      "UPDATE insurance_benefit_validations SET deductible_estimate='0.00',estimated_copay_amount='0.00' WHERE id=$1",
      [id],
    );
    const summary = await httpJson(base, 'GET', `/api/insurance/sha/patients/${patient}/benefits`, {
      token,
    });
    const visible = summary.body.recentValidations.find(
      (validation: { id: number }) => validation.id === id,
    );
    expect(visible).toMatchObject({
      deductibleEstimate: null,
      estimatedCopayAmount: null,
      estimatedCoveredAmount: null,
    });
    const stored = (
      await pool.query(
        'SELECT deductible_estimate,estimated_copay_amount FROM insurance_benefit_validations WHERE id=$1',
        [id],
      )
    ).rows[0];
    expect(stored).toEqual({ deductible_estimate: '0.00', estimated_copay_amount: '0.00' });
  });

  it('uses only this patient’s diagnosis and returns a clearly labelled local estimate', async () => {
    const unrelatedEncounter = (
      await pool.query(
        `INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status)
         VALUES($1,$2,$3,'OUTPATIENT','COMPLETED') RETURNING id`,
        [tenant, facility, patient],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description)
       VALUES($1,$2,'ICD-10','Z00.0','Synthetic unrelated patient')`,
      [unrelatedEncounter, otherPatient],
    );
    const wrongDiagnosis = await post({ ...input(shaManual), encounterId: unrelatedEncounter });
    expect(wrongDiagnosis.body.validation.decision).toBe('INCOMPLETE_INFORMATION');
    expect(wrongDiagnosis.body.validation.missingRequirements).toContain(
      'Coded clinical diagnosis on encounter',
    );
    await pool.query(
      `INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description)
       VALUES($1,$2,'ICD-10',NULL,'Synthetic incomplete diagnosis')`,
      [unrelatedEncounter, patient],
    );
    const incomplete = await post({ ...input(shaManual), encounterId: unrelatedEncounter });
    expect(incomplete.body.validation.decision).toBe('INCOMPLETE_INFORMATION');
    const local = await post(input(shaManual));
    expect(local.status).toBe(201);
    expect(local.body.validation).toMatchObject({
      decision: 'COVERED',
      verificationSource: 'APPROVED_FACILITY_RULE_ESTIMATE',
      estimatedCoveredAmount: '75.00',
    });
    expect(local.body.advisoryDisclaimer).toMatch(/local estimate/i);
    expect(local.body.advisoryDisclaimer).toMatch(/does not .*confirm.*payment/i);
    const audit = await pool.query(
      `SELECT id FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND action='SHA_BENEFITS_VALIDATED' AND resource_id=$3`,
      [tenant, facility, String(local.body.validation.id)],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('requires non-simulated authorization for the same encounter before estimating an authorized service', async () => {
    const anotherEncounter = (
      await pool.query(
        `INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status)
         VALUES($1,$2,$3,'OUTPATIENT','COMPLETED') RETURNING id`,
        [tenant, facility, patient],
      )
    ).rows[0].id;
    async function preauth(
      encounterId: number,
      isSimulated: boolean,
      source: string,
      serviceCode = 'SHA-TEST-001',
    ) {
      const reference = `SYN-REF-${randomUUID()}`;
      await pool.query(
        `INSERT INTO insurance_preauthorizations
         (tenant_id,facility_id,patient_id,encounter_id,payer_code,preauth_number,external_bundle_id,
          payer_auth_reference,status,source,is_simulated,clinical_indication,primary_diagnosis_code,
          primary_diagnosis_display,requested_service_code,requested_service_name,estimated_amount,valid_from,valid_until)
         VALUES($1,$2,$3,$4,'SHA',$5,$6,$7,'APPROVED',$8,$9,'synthetic','TEST',
          'synthetic',$10,'synthetic','75.00','2026-01-01','2027-01-01')`,
        [
          tenant,
          facility,
          patient,
          encounterId,
          `SYN-PA-${randomUUID()}`,
          randomUUID(),
          reference,
          source,
          isSimulated,
          serviceCode,
        ],
      );
      return reference;
    }
    await pool.query('UPDATE payer_service_code_mappings SET requires_preauth=true WHERE id=$1', [
      mapping,
    ]);
    try {
      await preauth(encounter, true, 'SANDBOX_SIMULATION');
      await preauth(anotherEncounter, false, 'MANUAL_PAYER_DECISION');
      const blocked = await post(input(shaManual));
      expect(blocked.status).toBe(201);
      expect(blocked.body.validation.decision).toBe('AUTHORIZATION_REQUIRED');
      const wrongServiceRef = await preauth(encounter, false, 'MANUAL_PAYER_DECISION', 'SHA-OTHER');
      const wrongService = await post({ ...input(shaManual), preauthReference: wrongServiceRef });
      expect(wrongService.status).toBe(201);
      expect(wrongService.body.validation.decision).toBe('AUTHORIZATION_REQUIRED');
      await preauth(encounter, false, 'MANUAL_PAYER_DECISION');
      const manual = await post(input(shaManual));
      expect(manual.status).toBe(201);
      expect(manual.body.validation).toMatchObject({
        decision: 'COVERED',
        verificationSource: 'APPROVED_FACILITY_RULE_ESTIMATE',
      });
    } finally {
      await pool.query(
        'UPDATE payer_service_code_mappings SET requires_preauth=false WHERE id=$1',
        [mapping],
      );
    }
  });

  it('does not use simulated utilization as a verified exhausted limit', async () => {
    await pool.query(
      `INSERT INTO sha_benefit_utilization_snapshots
       (tenant_id,facility_id,patient_id,payer_code,intervention_code,individual_remaining_limit,source,is_simulated)
       VALUES($1,$2,$3,'SHA','SHA-TEST-001','0.00','SANDBOX_SIMULATION',true)`,
      [tenant, facility, patient],
    );
    const result = await post(input(shaManual));
    expect(result.status).toBe(201);
    expect(result.body.validation).toMatchObject({
      decision: 'COVERED',
      verificationSource: 'APPROVED_FACILITY_RULE_ESTIMATE',
    });
  });

  it('authorizes a scoped, idempotent HTTP receipt match without creating a receipt', async () => {
    // Pre-existing local synthetic staff-attested records, not a provider
    // response, real adjudication, money transfer or bank statement.
    const invoice = (
      await pool.query(
        `INSERT INTO billing_invoices
         (tenant_id,facility_id,patient_id,encounter_id,invoice_number,total_amount,paid_amount,balance_amount,status,payer_type)
         VALUES($1,$2,$3,$4,$5,'10.00','10.00','0.00','Paid','SHA') RETURNING id`,
        [tenant, facility, patient, encounter, `SYN-MATCH-INV-${suffix}`],
      )
    ).rows[0].id as number;
    const claim = (
      await pool.query(
        `INSERT INTO sha_eclaims
         (tenant_id,facility_id,patient_id,encounter_id,invoice_id,claim_number,claim_uuid,environment_mode,
          is_simulated,status,billable_start,billable_end,total_billed_amount,total_claimed_amount,total_approved_amount)
         VALUES($1,$2,$3,$4,$5,$6,$7,'SYNTHETIC_TEST_FIXTURE',false,'ADJUDICATED',
          '2026-10-28','2026-10-28','10.00','10.00','10.00') RETURNING id`,
        [tenant, facility, patient, encounter, invoice, `SYN-MATCH-CLAIM-${suffix}`, randomUUID()],
      )
    ).rows[0].id as number;
    const reference = `SYN-ADVICE-REF-${suffix}`;
    const payment = (
      await pool.query(
        `INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,reference_code,cashier_name)
         VALUES($1,$2,'SHA','10.00',$3,'Synthetic cashier') RETURNING id`,
        [invoice, `SYN-RECEIPT-${suffix}`, reference],
      )
    ).rows[0].id as number;
    const advice = (
      await pool.query(
        `INSERT INTO insurance_remittances
         (tenant_id,facility_id,payer_code,remittance_number,payer_remittance_ref,payment_date,payment_channel,
          total_remitted_amount,allocated_amount,unallocated_amount,status,source,is_simulated)
         VALUES($1,$2,'SHA',$3,$4,'2026-10-28','EFT','10.00','10.00','0.00','AWAITING_RECEIPT',
          'SYNTHETIC_TEST_FIXTURE',false) RETURNING id`,
        [tenant, facility, `SYN-ADVICE-${suffix}`, reference],
      )
    ).rows[0].id as number;
    const entry = (
      await pool.query(
        `INSERT INTO insurance_reconciliation_entries
         (tenant_id,facility_id,remittance_id,eclaim_id,invoice_id,claimed_amount,approved_amount,remitted_amount)
         VALUES($1,$2,$3,$4,$5,'10.00','10.00','10.00') RETURNING id`,
        [tenant, facility, advice, claim, invoice],
      )
    ).rows[0].id as number;
    const url = `/api/insurance/sha/remittances/${advice}/entries/${entry}/match-receipt`;
    const request = (bearer: string, id: number) =>
      httpJson(base, 'POST', url, { token: bearer, body: { billingPaymentId: id } });
    expect((await request('', payment)).status).toBe(401);
    expect((await request(deniedToken, payment)).status).toBe(403);
    expect((await request(otherToken, payment)).status).toBe(404);
    expect((await request(token, 0)).status).toBe(400);
    const notFound = await request(token, 2147483647);
    expect(notFound.status).toBe(409);
    expect(notFound.body.error).toBe('PAYMENT_NOT_FOUND');
    const matched = await request(token, payment);
    expect(matched.status).toBe(200);
    expect(matched.body).toMatchObject({
      idempotentReplay: false,
      entry: { postedPaymentId: payment, appliedToInvoiceAmount: '10.00' },
      remittance: { status: 'RECONCILED' },
    });
    expect((await request(token, payment)).body.idempotentReplay).toBe(true);
    const state = (
      await pool.query(
        `SELECT c.status,c.total_paid_amount,i.paid_amount,
          (SELECT count(*)::int FROM billing_payments WHERE invoice_id=i.id) AS receipts,
          (SELECT count(*)::int FROM audit_logs WHERE facility_id=$2 AND action='SHA_REMITTANCE_RECEIPT_MATCHED' AND resource_id=$3) AS audits
         FROM sha_eclaims c JOIN billing_invoices i ON i.id=c.invoice_id WHERE c.id=$1`,
        [claim, facility, String(entry)],
      )
    ).rows[0];
    expect(state).toEqual({
      status: 'PAID',
      total_paid_amount: '10.00',
      paid_amount: '10.00',
      receipts: 1,
      audits: 1,
    });
    const foreignInvoice = (
      await pool.query(
        `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status,payer_type)
         VALUES($1,$2,$3,$4,'1.00','0.00','1.00','Unpaid','SHA') RETURNING id`,
        [tenant, otherFacility, otherPatient, `SYN-OTHER-INV-${suffix}`],
      )
    ).rows[0].id as number;
    const foreignClaim = (
      await pool.query(
        `INSERT INTO sha_eclaims(tenant_id,facility_id,patient_id,invoice_id,claim_number,claim_uuid,environment_mode,is_simulated,status,billable_start,billable_end,total_billed_amount,total_claimed_amount)
         VALUES($1,$2,$3,$4,$5,$6,'SYNTHETIC_TEST_FIXTURE',false,'ADJUDICATED','2026-10-28','2026-10-28','1.00','1.00') RETURNING id`,
        [
          tenant,
          otherFacility,
          otherPatient,
          foreignInvoice,
          `SYN-OTHER-CLAIM-${suffix}`,
          randomUUID(),
        ],
      )
    ).rows[0].id as number;
    // Deliberately inconsistent legacy reference: an in-facility allocation
    // must not reveal another facility's claim or invoice in the register.
    await pool.query(
      `INSERT INTO insurance_reconciliation_entries
       (tenant_id,facility_id,remittance_id,eclaim_id,invoice_id,claimed_amount,approved_amount,remitted_amount)
       VALUES($1,$2,$3,$4,$5,'1.00','1.00','1.00')`,
      [tenant, facility, advice, foreignClaim, foreignInvoice],
    );
    const listing = await httpJson(base, 'GET', '/api/insurance/sha/remittances', { token });
    expect(listing.status).toBe(200);
    const listedAdvice = listing.body.remittances.find((row: { id: number }) => row.id === advice);
    expect(listedAdvice.entries).toHaveLength(1);
    expect(listedAdvice.entries[0].id).toBe(entry);
  });

  it('does not let a mismatched-tenant row replace the scoped SHA eligibility in the patient summary', async () => {
    const result = await httpJson(base, 'GET', `/api/insurance/sha/patients/${patient}/benefits`, {
      token,
    });
    expect(result.status).toBe(200);
    expect(result.body.latestEligibility.id).not.toBe(foreignTenantEligibility);
    expect(result.body.latestEligibility.tenantId).toBe(tenant);
    const activeMapping = await pool.query(
      'SELECT is_active FROM payer_service_code_mappings WHERE id=$1 AND tenant_id=$2',
      [mapping, tenant],
    );
    expect(activeMapping.rows[0].is_active).toBe(true);
  });
});
