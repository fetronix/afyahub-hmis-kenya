/**
 * JaliCare HMIS
 * SHA eClaims, Eligibility, Benefits, Preauthorization & Remittance — PostgreSQL Integration Suite
 *
 * Exercises end-to-end persistence, transactions, tenant/facility isolation,
 * DRAFT -> APPROVED rule governance, preauth scope locking & audited amendment,
 * claim preparation -> validation -> submission -> rejection -> resubmission ->
 * adjudication -> remittance reconciliation, and additive `'SHA'` invoice
 * payment receipts against PostgreSQL 16.
 *
 * Uses `SHA_MODE=mock` and synthetic data only — never contacts external networks.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeAll, expect, it } from 'vitest';

import { describeDb } from './support/db.ts';
import { db, pool } from '../../db/index.ts';
import { defaultShaGatewayAdapter } from '../../integrations/sha/sha.adapter.ts';
import { recordSettledPayment } from '../../billing/payments.service.ts';
import * as schema from '../../db/schema.ts';
import type { InsuranceActorScope } from '../../insurance/eclaims/contracts.ts';
import {
  createBenefitRule,
  reviewBenefitRuleStatus,
  upsertFacilityPayerConfig,
  upsertServiceCodeMapping,
} from '../../insurance/eclaims/configuration.service.ts';
import {
  checkPatientEligibility,
  getEligibilityVerificationById,
  resolvePatientClientRegistryIdentity,
} from '../../insurance/eclaims/eligibility.service.ts';
import {
  lookupPatientHieCoverageAndUtilization,
  validateServiceBenefits,
} from '../../insurance/eclaims/benefits.service.ts';
import {
  authorizePatientVisitConsent,
  createPreauthorization,
  submitPreauthorization,
  updatePreauthorization,
} from '../../insurance/eclaims/preauthorization.service.ts';
import {
  prepareShaClaim,
  processIncomingShaWebhookEvent,
  recordClaimAdjudicationDecision,
  refreshShaClaimStatus,
  resubmitShaClaim,
  submitShaClaim,
} from '../../insurance/eclaims/claims-workflow.service.ts';
import {
  fetchRemittanceClaimBreakdown,
  getShaOperationalReport,
  reconcileRemittance,
  recordRemittanceAdvice,
  syncFacilityHieRemittances,
} from '../../insurance/eclaims/remittance.service.ts';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

async function waitForInvoiceLock(blocker: number) {
  for (let i = 0; i < 300; i++) {
    const waiting = await pool.query(
      `SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) LIMIT 1`,
      [blocker],
    );
    if (waiting.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for the synthetic claim transaction to block on its invoice.');
}

describeDb('SHA eClaims end-to-end PostgreSQL workflow & tenant isolation', () => {
  let scopeA: InsuranceActorScope;
  let scopeB: InsuranceActorScope;
  let patientAId = 0;
  let encounterAId = 0;
  let tariffAId = 0;
  let invoiceAId = 0;
  let facilityRegistryCode = '';

  beforeAll(async () => {
    const dbName = process.env.SQL_DB_NAME ?? 'jalicare_test';
    if (!dbName.includes('test')) {
      throw new Error(`Refusing to run DB integration tests against non-test DB "${dbName}".`);
    }

    process.env.SHA_MODE = 'mock';

    execFileSync('node', ['scripts/run-script.mjs', 'migrate', '--yes'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000,
      env: process.env,
    });

    const suffix = randomUUID().slice(0, 8);
    facilityRegistryCode = `FID-47-900001-${suffix}`;

    const [tenantA] = await db
      .insert(schema.tenants)
      .values({
        name: `SHA Test Tenant A ${suffix}`,
        slug: `sha-tenant-a-${suffix}`,
      })
      .returning();

    const [tenantB] = await db
      .insert(schema.tenants)
      .values({
        name: `SHA Test Tenant B ${suffix}`,
        slug: `sha-tenant-b-${suffix}`,
      })
      .returning();

    const [facilityA] = await db
      .insert(schema.facilities)
      .values({
        tenantId: tenantA.id,
        code: `FAC-A-${suffix}`,
        name: 'Nyeri Test Hospital A',
        level: 'Level 4',
        mflCode: facilityRegistryCode,
      })
      .returning();

    const [facilityB] = await db
      .insert(schema.facilities)
      .values({
        tenantId: tenantB.id,
        code: `FAC-B-${suffix}`,
        name: 'Other Tenant Hospital B',
        level: 'Level 3',
        mflCode: `FID-47-900002-${suffix}`,
      })
      .returning();

    const [userA] = await db
      .insert(schema.users)
      .values({
        uid: `uid-sha-a-${suffix}`,
        username: `sha_admin_a_${suffix}`,
        email: `sha_a_${suffix}@example.test`,
        passwordHash: 'not-used-in-service-test',
        fullName: 'SHA Billing Lead A',
        tenantId: tenantA.id,
        facilityId: facilityA.id,
      })
      .returning();

    const [userB] = await db
      .insert(schema.users)
      .values({
        uid: `uid-sha-b-${suffix}`,
        username: `sha_admin_b_${suffix}`,
        email: `sha_b_${suffix}@example.test`,
        passwordHash: 'not-used-in-service-test',
        fullName: 'SHA Billing Lead B',
        tenantId: tenantB.id,
        facilityId: facilityB.id,
      })
      .returning();

    scopeA = {
      tenantId: tenantA.id,
      facilityId: facilityA.id,
      userId: userA.id,
      userUid: userA.uid,
      userEmail: userA.email,
    };

    scopeB = {
      tenantId: tenantB.id,
      facilityId: facilityB.id,
      userId: userB.id,
      userUid: userB.uid,
      userEmail: userB.email,
    };

    const [patient] = await db
      .insert(schema.patients)
      .values({
        tenantId: tenantA.id,
        registrationFacilityId: facilityA.id,
        mrn: `MRN-SHA-${suffix}`,
        firstName: 'Synthetic',
        lastName: 'Beneficiary',
        dateOfBirth: '1988-06-12',
        gender: 'Female',
        shaNumber: 'SHA-88112233',
        nationalId: '29881122',
      })
      .returning();
    patientAId = patient.id;

    const [encounter] = await db
      .insert(schema.encounters)
      .values({
        tenantId: tenantA.id,
        facilityId: facilityA.id,
        patientId: patient.id,
        encounterType: 'OUTPATIENT',
        status: 'COMPLETED',
        chiefComplaint: 'Severe headache requiring CT imaging',
        clinicalNotes: 'Focal neurological deficit documented; CT head ordered.',
      })
      .returning();
    encounterAId = encounter.id;

    await db.insert(schema.diagnoses).values({
      encounterId: encounter.id,
      patientId: patient.id,
      icd10Code: '8B20',
      icd10Description: 'Acute stroke evaluation',
    });

    const [tariff] = await db
      .insert(schema.facilityServiceTariffs)
      .values({
        tenantId: tenantA.id,
        facilityId: facilityA.id,
        code: `RAD-CT-${suffix}`,
        description: 'CT Brain Scan',
        department: 'RADIOLOGY',
        fee: '8500.00',
      })
      .returning();
    tariffAId = tariff.id;

    const [invoice] = await db
      .insert(schema.billingInvoices)
      .values({
        tenantId: tenantA.id,
        facilityId: facilityA.id,
        patientId: patient.id,
        encounterId: encounter.id,
        invoiceNumber: `INV-SHA-${suffix}`,
        totalAmount: '8500.00',
        paidAmount: '0.00',
        balanceAmount: '8500.00',
        status: 'Unpaid',
        payerType: 'SHA',
      })
      .returning();
    invoiceAId = invoice.id;

    await db.insert(schema.billingItems).values({
      invoiceId: invoice.id,
      tariffId: tariff.id,
      tariffCode: tariff.code,
      sourceType: 'RADIOLOGY',
      itemType: 'Radiology',
      description: 'CT Brain Scan',
      quantity: 1,
      unitPrice: '8500.00',
      totalAmount: '8500.00',
    });
  });

  it('verifies eligibility, enforces tenant isolation, governs DRAFT->APPROVED rules, locks approved preauth scope, and reconciles eClaims to invoices', async () => {
    // 1. Configure facility payer settings & tariff mapping (preserving JaliCare tariff at 8500.00)
    await upsertFacilityPayerConfig(scopeA, {
      facilityRegistryCode,
      accreditationLevel: 'Level 4',
      contractedSchemes: ['SHIF', 'PHC', 'ECCIF'],
    });

    const mapping = await upsertServiceCodeMapping(scopeA, {
      tariffId: tariffAId,
      localCode: 'RAD-CT',
      localDescription: 'CT Brain Scan',
      serviceArea: 'RADIOLOGY',
      payerServiceCode: 'SHA-IMG-010',
      payerServiceName: 'CT Scan Head & Neck',
      fund: 'SHIF',
      accessPoint: 'OP',
      paymentMechanism: 'FEE_FOR_SERVICE',
      reimbursementTariff: '7000.00',
      requiresPreauth: true,
      preauthCategory: 'IMAGING',
    });
    expect(mapping.reimbursementTariff).toBe('7000.00');

    const [preservedTariff] = await db
      .select()
      .from(schema.facilityServiceTariffs)
      .where(eq(schema.facilityServiceTariffs.id, tariffAId));
    expect(preservedTariff.fee).toBe('8500.00');

    // 2. Resolve Client Registry CR ID + Check SHA eligibility in mock mode + enforce cross-tenant 404
    const crRes = await resolvePatientClientRegistryIdentity(scopeA, {
      patientId: patientAId,
      identificationType: 'NATIONAL_ID',
    });
    expect(crRes.registry.found).toBe(true);
    expect(crRes.registry.crId).toMatch(/^CR/);

    const eligRes = await checkPatientEligibility(scopeA, {
      patientId: patientAId,
      encounterId: encounterAId,
      identificationType: 'SHA_NUMBER',
    });
    expect(eligRes.verification.outcome).toBe('Eligible');
    expect(eligRes.verification.isSimulated).toBe(true);
    // Synthetic test-only manual evidence, not a sandbox or production result.
    await db
      .update(schema.insuranceEligibilityVerifications)
      .set({ isSimulated: false, source: 'MANUAL_VERIFICATION:TEST_EVIDENCE' })
      .where(eq(schema.insuranceEligibilityVerifications.id, eligRes.verification.id));

    // 2b. Query DHA HIE benefits & utilization matrix + authorize beneficiary OTP consent
    const hieMatrix = await lookupPatientHieCoverageAndUtilization(scopeA, {
      patientId: patientAId,
      interventionCode: 'SHA-IMG-010',
      includePomsfBalances: true,
    });
    expect(hieMatrix.snapshot).toBeTruthy();

    const consentAuth = await authorizePatientVisitConsent(scopeA, {
      patientId: patientAId,
      encounterId: encounterAId,
      serviceType: 'OUTPATIENT',
      consentMethod: 'OTP',
      otp: '123456',
      interventions: ['SHA-IMG-010'],
      isElectivePreVisit: true,
      practitionerRegNumber: 'A12345',
      practitionerRegulator: 'KMPDC',
    });
    expect(consentAuth.authStatus).toBe('AUTHORIZED_PENDING_VISIT');

    await expect(getEligibilityVerificationById(scopeB, eligRes.verification.id)).rejects.toThrow(
      /not found/i,
    );

    // 3. Create DRAFT benefit rule -> must return UNABLE_TO_VERIFY until approved!
    const draftRule = await createBenefitRule(scopeA, {
      ruleCode: 'SHIF-RAD-CT',
      benefitPackage: 'SHIF',
      serviceCategory: 'RADIOLOGY',
      payerServiceCode: 'SHA-IMG-010',
      minFacilityLevel: 'Level 4',
      requiresPreauth: true,
      copayType: 'NONE',
      sourceReference: 'SHA Tariff Schedule 2024',
      effectiveFrom: '2026-01-01',
    });
    expect(draftRule.status).toBe('DRAFT');

    const unverifiedCheck = await validateServiceBenefits(scopeA, {
      patientId: patientAId,
      encounterId: encounterAId,
      tariffId: tariffAId,
      benefitPackage: 'SHIF',
      serviceDate: '2026-10-28',
    });
    expect(unverifiedCheck.validation.decision).toBe('UNABLE_TO_VERIFY');
    expect(unverifiedCheck.validation.verificationSource).toBe('UNVERIFIED_DRAFT_RULE');

    // Approve rule -> now requires preauthorization (`AUTHORIZATION_REQUIRED`)
    await reviewBenefitRuleStatus(scopeA, draftRule.id, 'APPROVE');

    const authReqCheck = await validateServiceBenefits(scopeA, {
      patientId: patientAId,
      encounterId: encounterAId,
      tariffId: tariffAId,
      benefitPackage: 'SHIF',
      serviceDate: '2026-10-28',
    });
    expect(authReqCheck.validation.decision).toBe('AUTHORIZATION_REQUIRED');

    // 4. Create, submit & approve Preauthorization + verify locked-scope guard
    const preauth = await createPreauthorization(scopeA, {
      patientId: patientAId,
      encounterId: encounterAId,
      tariffId: tariffAId,
      category: 'IMAGING',
      clinicalIndication: 'Focal neurological deficit',
      primaryDiagnosisCode: '8B20',
      primaryDiagnosisDisplay: 'Acute stroke evaluation',
      codingSystem: 'ICD-11',
      requestedServiceCode: 'SHA-IMG-010',
      requestedServiceName: 'CT Scan Head & Neck',
      quantity: 1,
      estimatedAmount: '7000.00',
    });

    await expect(submitPreauthorization(scopeA, preauth.id)).rejects.toMatchObject({
      code: 'PREAUTH_CONTEXT_REQUIRED',
    });
    const submittedPa = await submitPreauthorization(scopeA, preauth.id, undefined, {
      serviceStart: '2026-01-01',
      serviceEnd: '2026-01-01',
      subType: 'op',
      schemeCode: 'SHIF',
    });
    expect(submittedPa.preauthorization.status).toBe('PENDING');

    const approvedPa = await updatePreauthorization(scopeA, preauth.id, {
      status: 'APPROVED',
      payerAuthReference: 'PA-AUTH-TEST-001',
      approvedAmount: '7000.00',
      validFrom: '2026-01-01',
      validUntil: '2027-01-01',
    });
    expect(approvedPa.status).toBe('APPROVED');

    // Unauthorized edit to approved scope without amendmentReason must fail with 409!
    await expect(
      updatePreauthorization(scopeA, preauth.id, { estimatedAmount: '9500.00' }),
    ).rejects.toThrow(/amendmentReason/i);

    // Benefits validation now returns COVERED!
    const coveredCheck = await validateServiceBenefits(scopeA, {
      patientId: patientAId,
      encounterId: encounterAId,
      tariffId: tariffAId,
      benefitPackage: 'SHIF',
      serviceDate: '2026-10-28',
    });
    expect(coveredCheck.validation.decision).toBe('COVERED');
    expect(coveredCheck.validation.estimatedCoveredAmount).toBe('7000.00');

    // 5. Prepare, validate, submit, reject, correct & resubmit, adjudicate, and reconcile eClaim!
    await expect(
      prepareShaClaim(scopeA, {
        invoiceId: invoiceAId,
        encounterId: 999999999,
        schemeCode: 'SHIF',
      }),
    ).rejects.toMatchObject({ code: 'ENCOUNTER_MISMATCH' });
    await expect(
      prepareShaClaim(scopeA, { invoiceId: invoiceAId, encounterId: encounterAId }),
    ).rejects.toMatchObject({ code: 'SCHEME_REQUIRED' });
    const prepared = await prepareShaClaim(scopeA, {
      invoiceId: invoiceAId,
      encounterId: encounterAId,
      preauthorizationId: preauth.id,
      schemeCode: 'SHIF',
      subType: 'op',
    });
    expect(prepared.status).toBe('READY_FOR_SUBMISSION');
    expect(prepared.totalBilledAmount).toBe('8500.00');
    expect(prepared.totalClaimedAmount).toBe('7000.00');

    // Force an invoice change after the initial read but before the claim lock.
    const [changedInvoice] = await db
      .insert(schema.billingInvoices)
      .values({
        tenantId: scopeA.tenantId,
        facilityId: scopeA.facilityId,
        patientId: patientAId,
        encounterId: encounterAId,
        invoiceNumber: `INV-CHANGED-${randomUUID()}`,
        totalAmount: '8500.00',
        paidAmount: '0.00',
        balanceAmount: '8500.00',
        status: 'Unpaid',
        payerType: 'SHA',
      })
      .returning();
    const [changeTariff] = await db
      .select()
      .from(schema.facilityServiceTariffs)
      .where(eq(schema.facilityServiceTariffs.id, tariffAId));
    await db.insert(schema.billingItems).values({
      invoiceId: changedInvoice.id,
      tariffId: tariffAId,
      tariffCode: changeTariff.code,
      sourceType: 'RADIOLOGY',
      itemType: 'Radiology',
      description: 'CT Brain Scan',
      quantity: 1,
      unitPrice: '8500.00',
      totalAmount: '8500.00',
    });
    const lockClient = await pool.connect();
    try {
      await lockClient.query('BEGIN');
      const pid = (await lockClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await lockClient.query('SELECT id FROM billing_invoices WHERE id=$1 FOR UPDATE', [
        changedInvoice.id,
      ]);
      const pending = prepareShaClaim(scopeA, {
        invoiceId: changedInvoice.id,
        encounterId: encounterAId,
        preauthorizationId: preauth.id,
        schemeCode: 'SHIF',
        subType: 'op',
      }).then(
        () => null,
        (err: unknown) => err,
      );
      await waitForInvoiceLock(pid);
      await lockClient.query(
        `UPDATE billing_items SET description='Synthetic changed item' WHERE invoice_id=$1`,
        [changedInvoice.id],
      );
      await lockClient.query('COMMIT');
      expect(await pending).toMatchObject({ code: 'INVOICE_CHANGED' });
    } finally {
      await lockClient.query('ROLLBACK');
      lockClient.release();
    }

    // A separate synthetic invoice exercises claim creation races and a lost transport outcome.
    const [retryInvoice] = await db
      .insert(schema.billingInvoices)
      .values({
        tenantId: scopeA.tenantId,
        facilityId: scopeA.facilityId,
        patientId: patientAId,
        encounterId: encounterAId,
        invoiceNumber: `INV-SHA-RACE-${randomUUID()}`,
        totalAmount: '8500.00',
        paidAmount: '0.00',
        balanceAmount: '8500.00',
        status: 'Unpaid',
        payerType: 'SHA',
      })
      .returning();
    const [tariff] = await db
      .select()
      .from(schema.facilityServiceTariffs)
      .where(eq(schema.facilityServiceTariffs.id, tariffAId));
    await db.insert(schema.billingItems).values({
      invoiceId: retryInvoice.id,
      tariffId: tariffAId,
      tariffCode: tariff.code,
      sourceType: 'RADIOLOGY',
      itemType: 'Radiology',
      description: 'CT Brain Scan',
      quantity: 1,
      unitPrice: '8500.00',
      totalAmount: '8500.00',
    });
    const [otherPatient] = await db
      .insert(schema.patients)
      .values({
        tenantId: scopeA.tenantId,
        registrationFacilityId: scopeA.facilityId,
        mrn: `OTHER-${randomUUID()}`,
        firstName: 'Synthetic',
        lastName: 'Other',
        dateOfBirth: '1990-01-01',
        gender: 'Female',
      })
      .returning();
    await db.insert(schema.diagnoses).values({
      patientId: otherPatient.id,
      encounterId: encounterAId,
      icd10Code: 'SECRET',
      icd10Description: 'Other patient diagnosis',
    });
    await db.insert(schema.labOrders).values({
      tenantId: scopeA.tenantId,
      facilityId: scopeA.facilityId,
      patientId: otherPatient.id,
      encounterId: encounterAId,
      testName: 'Other patient laboratory order',
    });
    const prepareRetry = () =>
      prepareShaClaim(scopeA, {
        invoiceId: retryInvoice.id,
        encounterId: encounterAId,
        preauthorizationId: preauth.id,
        schemeCode: 'SHIF',
        subType: 'op',
      });
    const claimRaces = await Promise.allSettled([prepareRetry(), prepareRetry()]);
    expect(claimRaces.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(claimRaces.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const retryClaim = claimRaces.find(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof prepareShaClaim>>> =>
        r.status === 'fulfilled',
    )!.value;
    expect(JSON.stringify(retryClaim.diagnosesSnapshot)).not.toContain('Other patient diagnosis');
    expect(retryClaim.supportingSummary.labOrdersCount).toBe(0);
    let attempted = 0;
    const offlineAdapter = new Proxy(defaultShaGatewayAdapter, {
      get(target, property, receiver) {
        if (property === 'submitBundle')
          return async () => {
            attempted += 1;
            throw new Error('synthetic lost response');
          };
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(submitShaClaim(scopeA, retryClaim.id, offlineAdapter)).rejects.toMatchObject({
      code: 'CLAIM_DISPATCH_REVIEW_REQUIRED',
    });
    await expect(submitShaClaim(scopeA, retryClaim.id, offlineAdapter)).rejects.toMatchObject({
      code: 'CLAIM_DISPATCH_REVIEW_REQUIRED',
    });
    expect(attempted).toBe(1);
    expect(
      (
        await db
          .select()
          .from(schema.insuranceClaimDispatchGuards)
          .where(eq(schema.insuranceClaimDispatchGuards.claimId, retryClaim.id))
      )[0].state,
    ).toBe('UNCERTAIN');
    await expect(refreshShaClaimStatus(scopeA, retryClaim.id)).rejects.toMatchObject({
      code: 'CLAIM_DISPATCH_REVIEW_REQUIRED',
    });

    // Synthetic in-flight reservation on an acknowledged fixture: a delayed
    // callback must be retained for review, not overwrite or release the guard.
    const [callbackFixture] = await db
      .insert(schema.shaEclaims)
      .values({
        tenantId: scopeA.tenantId,
        facilityId: scopeA.facilityId,
        patientId: patientAId,
        invoiceId: retryInvoice.id,
        encounterId: encounterAId,
        claimNumber: `SYN-CALLBACK-${randomUUID()}`,
        claimUuid: randomUUID(),
        billableStart: '2026-01-01',
        billableEnd: '2026-01-01',
        totalBilledAmount: '100.00',
        totalClaimedAmount: '100.00',
        status: 'ACKNOWLEDGED',
        submissionCount: 1,
      })
      .returning();
    await db.insert(schema.insuranceClaimDispatchGuards).values({
      tenantId: scopeA.tenantId,
      facilityId: scopeA.facilityId,
      workflow: 'SHA',
      claimId: callbackFixture.id,
      claimRevision: callbackFixture.dispatchRevision,
      attemptNumber: 2,
      correlationId: randomUUID(),
      actorUserId: scopeA.userId,
    });
    const deferred = await processIncomingShaWebhookEvent({
      entityType: 'claim',
      externalEntityId: callbackFixture.claimUuid,
      externalEventId: randomUUID(),
      upstreamStatus: 'REJECTED',
      signatureVerified: true,
    });
    expect(deferred.event.processingOutcome).toBe('DEFERRED_CLAIM_DISPATCH_REVIEW_REQUIRED');
    const [unchanged] = await db
      .select()
      .from(schema.shaEclaims)
      .where(eq(schema.shaEclaims.id, callbackFixture.id));
    expect(unchanged.status).toBe('ACKNOWLEDGED');
    expect(
      await db
        .select()
        .from(schema.insuranceClaimDispatchGuards)
        .where(eq(schema.insuranceClaimDispatchGuards.claimId, callbackFixture.id)),
    ).toHaveLength(1);

    const guardedAdvice = await recordRemittanceAdvice(scopeA, {
      payerRemittanceRef: `SYN-GUARD-${randomUUID()}`,
      paymentChannel: 'EFT',
      paymentDate: '2026-10-28',
      totalRemittedAmount: '10.00',
    });
    await expect(
      reconcileRemittance(scopeA, guardedAdvice.id, {
        allocations: [{ eclaimId: callbackFixture.id, remittedAmount: '10.00' }],
      }),
    ).rejects.toMatchObject({ code: 'CLAIM_DISPATCH_REVIEW_REQUIRED' });

    const simultaneous = await Promise.allSettled([
      submitShaClaim(scopeA, prepared.id),
      submitShaClaim(scopeA, prepared.id),
    ]);
    const dispatched = simultaneous.find(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof submitShaClaim>>> =>
        r.status === 'fulfilled',
    )?.value;
    expect(simultaneous.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(simultaneous.filter((r) => r.status === 'rejected')).toHaveLength(1);
    if (!dispatched) throw new Error('Expected one synthetic dispatch');
    expect(dispatched.status).toBe('ACKNOWLEDGED');
    expect(dispatched.submissions).toHaveLength(1);
    expect(dispatched.submissionCount).toBe(1);

    // Adjudicate as REJECTED -> correct & resubmit preserving submission history
    const rejected = await recordClaimAdjudicationDecision(scopeA, prepared.id, {
      targetStatus: 'REJECTED',
      reason: 'Missing secondary ICD-11 specificity',
    });
    expect(rejected.status).toBe('REJECTED');

    const resubmitted = await resubmitShaClaim(scopeA, prepared.id, {
      correctionNotes: 'Updated ICD-11 code to 8B11.0 cerebral ischaemic stroke',
      diagnosesSnapshot: [
        {
          code: '8B11.0',
          display: 'Cerebral ischaemic stroke',
          system: 'ICD-11',
          type: 'principal',
        },
      ],
    });
    expect(resubmitted.status).toBe('ACKNOWLEDGED');
    expect(resubmitted.submissionCount).toBe(2);
    expect(resubmitted.submissions).toHaveLength(2);
    expect(resubmitted.previousSubmissionRef).toBeTruthy();

    // Adjudicate as ADJUDICATED -> record remittance -> reconcile against JaliCare invoice!
    const adjudicated = await recordClaimAdjudicationDecision(scopeA, prepared.id, {
      targetStatus: 'ADJUDICATED',
      approvedAmount: '7000.00',
      reason: 'Approved per SHIF imaging schedule',
    });
    expect(adjudicated.status).toBe('ADJUDICATED');

    const remittance = await recordRemittanceAdvice(scopeA, {
      payerRemittanceRef: `EFT-TEST-${randomUUID().slice(0, 6)}`,
      paymentDate: '2026-10-28',
      paymentChannel: 'EFT',
      totalRemittedAmount: '7000.00',
    });

    await expect(
      reconcileRemittance(scopeA, remittance.id, {
        allocations: [{ eclaimId: prepared.id, remittedAmount: '7000.00', postToInvoice: true }],
      }),
    ).rejects.toThrow(/record the receipt through billing first/i);
    await expect(
      reconcileRemittance(scopeA, remittance.id, {
        allocations: [{ eclaimId: prepared.id, remittedAmount: '7000.00', billingPaymentId: 1 }],
      }),
    ).rejects.toThrow(/simulated/i);

    const recon = await reconcileRemittance(scopeA, remittance.id, {
      allocations: [{ eclaimId: prepared.id, remittedAmount: '7000.00', postToInvoice: false }],
    });
    expect(recon.remittance.status).toBe('RECONCILED');
    expect(recon.entries[0].reconciliationStatus).toBe('MATCHED');
    expect(recon.entries[0].postedPaymentId).toBeNull();

    // Advice allocation alone must not change the invoice or mark money received.
    const [updatedInvoice] = await db
      .select()
      .from(schema.billingInvoices)
      .where(eq(schema.billingInvoices.id, invoiceAId));
    expect(updatedInvoice.totalAmount).toBe('8500.00');
    expect(updatedInvoice.paidAmount).toBe('0.00');
    expect(updatedInvoice.balanceAmount).toBe('8500.00');
    expect(updatedInvoice.status).toBe('Unpaid');

    // Synthetic local fixture only: prove a real billing record can be matched
    // without creating another receipt; this is not a verified payer result.
    await db
      .update(schema.shaEclaims)
      .set({ isSimulated: false })
      .where(eq(schema.shaEclaims.id, prepared.id));
    const reference = `SYNTHETIC-SHA-${randomUUID().slice(0, 8)}`;
    const receipt = await recordSettledPayment(
      {
        userId: scopeA.userId,
        tenantId: scopeA.tenantId,
        facilityId: scopeA.facilityId,
        roles: ['BILLING_CLERK'],
        permissions: ['billing.payments.record'],
        isSuperAdmin: false,
      },
      { invoiceId: invoiceAId, amount: '7000.00', paymentMethod: 'SHA', referenceCode: reference },
      'Synthetic cashier',
    );
    const secondAdvice = await recordRemittanceAdvice(scopeA, {
      payerRemittanceRef: reference,
      paymentChannel: 'EFT',
      paymentDate: '2026-10-28',
      totalRemittedAmount: '7000.00',
    });
    const matched = await reconcileRemittance(scopeA, secondAdvice.id, {
      allocations: [
        { eclaimId: prepared.id, remittedAmount: '7000.00', billingPaymentId: receipt.payment.id },
      ],
    });
    expect(matched.entries[0].postedPaymentId).toBe(receipt.payment.id);
    const [afterMatch] = await db
      .select()
      .from(schema.billingInvoices)
      .where(eq(schema.billingInvoices.id, invoiceAId));
    expect(afterMatch.paidAmount).toBe('7000.00');
    expect(afterMatch.balanceAmount).toBe('1500.00');

    // 6. Verify 2-step HIE Remittance Sync, Idempotent Callback Event Processing & ATNA Operational Report
    const syncedRems = await syncFacilityHieRemittances(scopeA, { facilityIdType: 'fr-code' });
    expect(syncedRems.imported.length).toBeGreaterThan(0);
    const breakdown = await fetchRemittanceClaimBreakdown(scopeA, syncedRems.imported[0].id);
    expect(breakdown.claims.length).toBeGreaterThan(0);

    const cbFirst = await processIncomingShaWebhookEvent({
      entityType: 'claim',
      externalEntityId: prepared.claimUuid,
      externalEventId: `EVT-${randomUUID().slice(0, 8)}`,
      upstreamStatus: 'ADJUDICATED',
      signatureVerified: true,
    });
    expect(cbFirst.duplicate).toBe(false);
    const cbDup = await processIncomingShaWebhookEvent({
      entityType: 'claim',
      externalEntityId: prepared.claimUuid,
      externalEventId: cbFirst.event.correlationId,
      upstreamStatus: 'ADJUDICATED',
      signatureVerified: true,
    });
    expect(cbDup.duplicate).toBe(true);

    const opReport = await getShaOperationalReport(scopeA);
    expect(opReport.metrics.claimsTotal).toBeGreaterThanOrEqual(1);
    expect(opReport.atnaAuditTrail.length).toBeGreaterThan(0);
  });
});
