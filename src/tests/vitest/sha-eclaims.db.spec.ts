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
import { finalizeInvoice, getFinalizedInvoice } from '../../billing/finalized-invoice.service.ts';
import { postBillingSourceScoped } from '../../accounting/billing-posting.service.ts';
import { voidInvoiceScoped } from '../../db/queries/billing.ts';
import {
  createAccountScoped,
  createFinancialPeriodScoped,
  getAccountingOverviewScoped,
} from '../../accounting/accounting.service.ts';
import type { AuthorizationContext } from '../../auth/authorization.types.ts';
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
  getShaClaimDetail,
  prepareShaClaim,
  processIncomingShaWebhookEvent,
  listShaCallbackEvents,
  recordClaimAdjudicationDecision,
  refreshShaClaimStatus,
  resubmitShaClaim,
  submitShaClaim,
  validateShaClaim,
} from '../../insurance/eclaims/claims-workflow.service.ts';
import {
  fetchRemittanceClaimBreakdown,
  getShaOperationalReport,
  matchRemittanceReceipt,
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

/*
 * Claims may only be prepared from a finalized invoice (migration 0088).
 * Finalizing is the real workflow, not a test shortcut: a billing user has to
 * state the insurer/patient split before anything can be claimed.
 */
async function finalizeClaimInvoice(input: {
  tenantId: number;
  facilityId: number;
  userId: number;
  invoiceId: number;
  insurer: string;
  copay?: string;
}) {
  const context: AuthorizationContext = {
    userId: input.userId,
    tenantId: input.tenantId,
    facilityId: input.facilityId,
    roles: ['BILLING_CLERK'],
    permissions: ['billing.read', 'billing.update', 'clinical.read'],
    isSuperAdmin: false,
  };
  return finalizeInvoice(context, input.invoiceId, {
    insurerResponsibility: input.insurer,
    copayment: input.copay ?? '0.00',
    allocationBasis: 'Synthetic claim allocation',
  });
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
        address: 'Synthetic address',
        county: 'Nairobi',
        phone: '0000000000',
        enabledModules: ['finance', 'accounting', 'insurance'],
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

    /*
     * Claims may only be prepared from a finalized invoice (migration 0088).
     * Finalizing here is the real workflow, not a test shortcut: the split has
     * to be stated by a billing user before anything can be claimed.
     */
    const finalizeForClaim = async (invoiceId: number, insurer: string, copay = '0.00') => {
      const billingContext: AuthorizationContext = {
        userId: userA.id,
        tenantId: tenantA.id,
        facilityId: facilityA.id,
        roles: ['BILLING_CLERK'],
        permissions: ['billing.read', 'billing.update', 'clinical.read'],
        isSuperAdmin: false,
      };
      return finalizeInvoice(billingContext, invoiceId, {
        insurerResponsibility: insurer,
        copayment: copay,
        allocationBasis: 'Synthetic claim allocation',
      });
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

    const [department] = await db
      .insert(schema.departments)
      .values({ facilityId: facilityA.id, name: 'Synthetic imaging', code: `IMG-${suffix}` })
      .returning();
    const [practitioner] = await db
      .insert(schema.practitioners)
      .values({ tenantId: tenantA.id, facilityId: facilityA.id, fullName: 'Synthetic clinician' })
      .returning();
    const [encounter] = await db
      .insert(schema.encounters)
      .values({
        tenantId: tenantA.id,
        facilityId: facilityA.id,
        patientId: patient.id,
        departmentId: department.id,
        practitionerId: practitioner.id,
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
      codingSystem: 'ICD-11',
      icd11Code: '8B20',
      icd11Title: 'Acute stroke evaluation',
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
        /* Finalization requires the recorded payer identity; a SHA invoice
         * without a member number is not a claimable invoice. */
        payerName: 'Social Health Authority',
        memberNumber: `SHA-MEMBER-${randomUUID()}`,
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
    await finalizeClaimInvoice({
      tenantId: scopeA.tenantId,
      facilityId: scopeA.facilityId,
      userId: scopeA.userId,
      invoiceId: invoice.id,
      insurer: '8500.00',
    });
  });

  it('verifies eligibility, enforces tenant isolation, governs DRAFT->APPROVED rules, locks approved preauth scope, and reconciles eClaims to invoices', async () => {
    // 1. Configure facility payer settings & tariff mapping (preserving JaliCare tariff at 8500.00)
    const payerConfiguration = await upsertFacilityPayerConfig(scopeA, {
      facilityRegistryCode,
      accreditationLevel: 'Level 4',
      contractedSchemes: ['SHIF', 'PHC', 'ECCIF'],
    });
    const legacyConfigNote = 'synthetic-legacy-configuration-note';
    await pool.query('UPDATE insurance_payer_configs SET notes=$2 WHERE id=$1', [
      payerConfiguration.id,
      legacyConfigNote,
    ]);
    await expect(
      upsertFacilityPayerConfig(scopeA, { notes: legacyConfigNote }),
    ).rejects.toMatchObject({ code: 'UNSAFE_FREE_TEXT' });
    await upsertFacilityPayerConfig(scopeA, { isActive: payerConfiguration.isActive });
    expect(
      (
        await pool.query('SELECT notes FROM insurance_payer_configs WHERE id=$1', [
          payerConfiguration.id,
        ])
      ).rows[0].notes,
    ).toBe(legacyConfigNote);
    const configurationAudit = (
      await pool.query(
        "SELECT details FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND action LIKE 'SHA_PAYER_CONFIG_%' ORDER BY id DESC LIMIT 1",
        [scopeA.tenantId, scopeA.facilityId],
      )
    ).rows[0].details;
    expect(configurationAudit).not.toContain(legacyConfigNote);
    expect(configurationAudit).not.toContain(facilityRegistryCode);

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
    // A separate pre-existing, synthetic manual-evidence fixture is used for
    // the remaining local workflow. The mock result remains simulated; this is
    // not evidence of a real payer check or of a SHA manual-entry UI.
    await db.insert(schema.insuranceEligibilityVerifications).values({
      tenantId: scopeA.tenantId,
      facilityId: scopeA.facilityId,
      patientId: patientAId,
      encounterId: encounterAId,
      payerCode: 'SHA',
      identificationType: 'SHA_NUMBER',
      identificationHint: 'synthetic',
      outcome: 'Eligible',
      source: 'MANUAL_VERIFICATION:TEST_EVIDENCE',
      isSimulated: false,
      manualReference: 'SYNTHETIC-MANUAL-ELIGIBILITY',
      memberCrNumber: 'CR-SYNTHETIC-TEST',
      schemes: ['SHIF'],
      responseClassification: 'MANUAL_SYNTHETIC',
      checkedByUserId: scopeA.userId,
    });

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

    await expect(
      validateServiceBenefits(scopeA, {
        patientId: patientAId,
        serviceDescription: 'Synthetic unpriced service',
        benefitPackage: 'SHIF',
        serviceDate: '2026-10-28',
      }),
    ).rejects.toMatchObject({ code: 'FINANCIAL_REVIEW_REQUIRED' });

    // Approve rule -> now requires preauthorization (`AUTHORIZATION_REQUIRED`)
    await reviewBenefitRuleStatus(scopeA, draftRule.id, 'APPROVE');

    await pool.query(
      "UPDATE payer_service_code_mappings SET reimbursement_tariff='NaN' WHERE id=$1",
      [mapping.id],
    );
    await expect(
      validateServiceBenefits(scopeA, {
        patientId: patientAId,
        encounterId: encounterAId,
        tariffId: tariffAId,
        benefitPackage: 'SHIF',
        serviceDate: '2026-10-28',
      }),
    ).rejects.toMatchObject({ code: 'FINANCIAL_REVIEW_REQUIRED' });
    await pool.query(
      "UPDATE payer_service_code_mappings SET reimbursement_tariff='7000.00' WHERE id=$1",
      [mapping.id],
    );

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
    expect(approvedPa.isSimulated).toBe(true);

    // Unauthorized edit to approved scope without amendmentReason must fail with 409!
    await expect(
      updatePreauthorization(scopeA, preauth.id, { estimatedAmount: '9500.00' }),
    ).rejects.toThrow(/amendmentReason/i);

    // A simulated approval is not a real authorization, even after a local
    // status update. A separate invoice demonstrates the claim-side guard.
    const simulatedPreauthBenefit = await validateServiceBenefits(scopeA, {
      patientId: patientAId,
      encounterId: encounterAId,
      tariffId: tariffAId,
      benefitPackage: 'SHIF',
      serviceDate: '2026-10-28',
    });
    expect(simulatedPreauthBenefit.validation.decision).toBe('AUTHORIZATION_REQUIRED');
    const [simulationInvoice] = await db
      .insert(schema.billingInvoices)
      .values({
        tenantId: scopeA.tenantId,
        facilityId: scopeA.facilityId,
        patientId: patientAId,
        encounterId: encounterAId,
        invoiceNumber: `INV-SYN-PREAUTH-${randomUUID()}`,
        totalAmount: '8500.00',
        paidAmount: '0.00',
        balanceAmount: '8500.00',
        status: 'Unpaid',
        payerType: 'SHA',
        /* Finalization requires the recorded payer identity; a SHA invoice
         * without a member number is not a claimable invoice. */
        payerName: 'Social Health Authority',
        memberNumber: `SHA-MEMBER-${randomUUID()}`,
      })
      .returning();
    const [simulationTariff] = await db
      .select()
      .from(schema.facilityServiceTariffs)
      .where(eq(schema.facilityServiceTariffs.id, tariffAId));
    await db.insert(schema.billingItems).values({
      invoiceId: simulationInvoice.id,
      tariffId: tariffAId,
      tariffCode: simulationTariff.code,
      sourceType: 'RADIOLOGY',
      itemType: 'Radiology',
      description: 'Synthetic CT test',
      quantity: 1,
      unitPrice: '8500.00',
      totalAmount: '8500.00',
    });
    await finalizeClaimInvoice({
      tenantId: scopeA.tenantId,
      facilityId: scopeA.facilityId,
      userId: scopeA.userId,
      invoiceId: simulationInvoice.id,
      insurer: '8500.00',
    });
    const simulatedPreauthClaim = await prepareShaClaim(scopeA, {
      invoiceId: simulationInvoice.id,
      encounterId: encounterAId,
      preauthorizationId: preauth.id,
      schemeCode: 'SHIF',
      subType: 'op',
    });
    expect(simulatedPreauthClaim.status).toBe('VALIDATION_FAILED');
    expect(simulatedPreauthClaim.validationIssues.map((issue) => issue.code)).toContain(
      'MISSING_OR_INVALID_PREAUTH',
    );

    // Independently record a synthetic staff-attested manual preauthorization
    // through the existing service. This is not a provider decision.
    const manualPreauth = await createPreauthorization(scopeA, {
      patientId: patientAId,
      encounterId: encounterAId,
      tariffId: tariffAId,
      category: 'IMAGING',
      clinicalIndication: 'Synthetic test indication',
      primaryDiagnosisCode: '8B20',
      primaryDiagnosisDisplay: 'Synthetic test diagnosis',
      codingSystem: 'ICD-11',
      requestedServiceCode: 'SHA-IMG-010',
      requestedServiceName: 'Synthetic imaging',
      quantity: 1,
      estimatedAmount: '7000.00',
    });
    const manualDecision = await updatePreauthorization(scopeA, manualPreauth.id, {
      status: 'APPROVED',
      payerAuthReference: 'SYNTHETIC-MANUAL-REFERENCE',
      approvedAmount: '7000.00',
      validFrom: '2026-01-01',
      validUntil: '2027-01-01',
    });
    expect(manualDecision).toMatchObject({ source: 'MANUAL_PAYER_DECISION', isSimulated: false });

    // This is only an estimate based on synthetic manual evidence and rules.
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
    const billingLine = (
      await pool.query(
        'SELECT id,unit_price,quantity FROM billing_items WHERE invoice_id=$1 ORDER BY id LIMIT 1',
        [invoiceAId],
      )
    ).rows[0];
    /*
     * The invoice basis is frozen. These three statements used to succeed and
     * were then caught by claim preparation (FINANCIAL_REVIEW_REQUIRED). Now
     * the database itself refuses to move a finalized line, which is a stronger
     * guarantee: the amount the payer will be asked about cannot drift between
     * preparation and dispatch, and it cannot be tampered with by raw SQL.
     */
    await expect(
      pool.query("UPDATE billing_items SET unit_price='NaN' WHERE id=$1", [billingLine.id]),
    ).rejects.toThrow(/finalized invoice/i);
    await expect(
      pool.query('UPDATE billing_items SET quantity=NULL WHERE id=$1', [billingLine.id]),
    ).rejects.toThrow(/finalized invoice/i);
    await expect(
      pool.query('DELETE FROM billing_items WHERE id=$1', [billingLine.id]),
    ).rejects.toThrow(/finalized invoice/i);
    const unchangedLine = (
      await pool.query('SELECT unit_price,quantity FROM billing_items WHERE id=$1', [
        billingLine.id,
      ])
    ).rows[0];
    expect(unchangedLine.unit_price).toBe(billingLine.unit_price);
    expect(unchangedLine.quantity).toBe(billingLine.quantity);
    const prepared = await prepareShaClaim(scopeA, {
      invoiceId: invoiceAId,
      encounterId: encounterAId,
      preauthorizationId: manualPreauth.id,
      schemeCode: 'SHIF',
      subType: 'op',
    });
    expect(prepared.status).toBe('READY_FOR_SUBMISSION');
    expect(prepared.totalBilledAmount).toBe('8500.00');
    expect(prepared.totalClaimedAmount).toBe('7000.00');
    // Corrupt a synthetic approval in-place to model historical inconsistency;
    // a matching reference alone must not authorize a different service.
    await pool.query(
      "UPDATE insurance_preauthorizations SET requested_service_code='SHA-OTHER' WHERE id=$1",
      [manualPreauth.id],
    );
    try {
      const wrongService = await validateShaClaim(scopeA, prepared.id);
      expect(wrongService.status).toBe('VALIDATION_FAILED');
      expect(
        wrongService.validationIssues.some((issue) => issue.code === 'MISSING_OR_INVALID_PREAUTH'),
      ).toBe(true);
    } finally {
      await pool.query(
        "UPDATE insurance_preauthorizations SET requested_service_code='SHA-IMG-010' WHERE id=$1",
        [manualPreauth.id],
      );
    }
    await pool.query("UPDATE sha_eclaim_items SET serviced_end='2028-01-01' WHERE eclaim_id=$1", [
      prepared.id,
    ]);
    try {
      const outsideAuthorization = await validateShaClaim(scopeA, prepared.id);
      expect(outsideAuthorization.status).toBe('VALIDATION_FAILED');
      expect(
        outsideAuthorization.validationIssues.some(
          (issue) => issue.code === 'MISSING_OR_INVALID_PREAUTH',
        ),
      ).toBe(true);
    } finally {
      await pool.query("UPDATE sha_eclaim_items SET serviced_end='2026-10-28' WHERE eclaim_id=$1", [
        prepared.id,
      ]);
    }
    expect((await validateShaClaim(scopeA, prepared.id)).status).toBe('READY_FOR_SUBMISSION');
    await pool.query("UPDATE sha_eclaims SET total_claimed_amount='NaN' WHERE id=$1", [
      prepared.id,
    ]);
    await expect(validateShaClaim(scopeA, prepared.id)).rejects.toMatchObject({
      code: 'FINANCIAL_REVIEW_REQUIRED',
    });
    expect(
      (await pool.query('SELECT status FROM sha_eclaims WHERE id=$1', [prepared.id])).rows[0]
        .status,
    ).toBe('READY_FOR_SUBMISSION');
    await pool.query("UPDATE sha_eclaims SET total_claimed_amount='7000.00' WHERE id=$1", [
      prepared.id,
    ]);

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
        /* Finalization requires the recorded payer identity; a SHA invoice
         * without a member number is not a claimable invoice. */
        payerName: 'Social Health Authority',
        memberNumber: `SHA-MEMBER-${randomUUID()}`,
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
    await finalizeClaimInvoice({
      tenantId: scopeA.tenantId,
      facilityId: scopeA.facilityId,
      userId: scopeA.userId,
      invoiceId: changedInvoice.id,
      insurer: '8500.00',
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
        preauthorizationId: manualPreauth.id,
        schemeCode: 'SHIF',
        subType: 'op',
      }).then(
        () => null,
        (err: unknown) => err,
      );
      await waitForInvoiceLock(pid);
      /*
       * A concurrent writer tries to change the invoice while a claim is being
       * prepared from it. On a finalized invoice this is refused by the
       * database, so the claim basis cannot move underneath the claim. (Before
       * migration 0088 this succeeded and preparation caught it as
       * INVOICE_CHANGED; the guarantee is now stronger — the change never
       * happens at all.)
       */
      const tamperError = await lockClient
        .query(
          `UPDATE billing_items SET description='Synthetic changed item' WHERE invoice_id=$1`,
          [changedInvoice.id],
        )
        .then(
          () => null,
          (err: unknown) => err as Error,
        );
      expect(tamperError?.message).toMatch(/finalized invoice/i);
      await lockClient.query('COMMIT');
      /* `pending` maps success to null and failure to the error. */
      expect(await pending).toBeNull();
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
        /* Finalization requires the recorded payer identity; a SHA invoice
         * without a member number is not a claimable invoice. */
        payerName: 'Social Health Authority',
        memberNumber: `SHA-MEMBER-${randomUUID()}`,
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
    await finalizeClaimInvoice({
      tenantId: scopeA.tenantId,
      facilityId: scopeA.facilityId,
      userId: scopeA.userId,
      invoiceId: retryInvoice.id,
      insurer: '8500.00',
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
        preauthorizationId: manualPreauth.id,
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
    const callbackEventsBefore = await db
      .select()
      .from(schema.shaCallbackEvents)
      .where(eq(schema.shaCallbackEvents.tenantId, scopeA.tenantId));
    const untrusted = {
      entityType: 'claim' as const,
      externalEntityId: callbackFixture.claimUuid,
      externalEventId: randomUUID(),
      upstreamStatus: 'REJECTED',
      signatureVerified: true,
    };
    await expect(processIncomingShaWebhookEvent(untrusted)).rejects.toMatchObject({
      code: 'SHA_CALLBACK_NOT_VERIFIED',
    });
    await expect(processIncomingShaWebhookEvent(untrusted)).rejects.toMatchObject({
      code: 'SHA_CALLBACK_NOT_VERIFIED',
    });
    expect(
      await db
        .select()
        .from(schema.shaCallbackEvents)
        .where(eq(schema.shaCallbackEvents.tenantId, scopeA.tenantId)),
    ).toEqual(callbackEventsBefore);
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

    await pool.query("UPDATE insurance_remittances SET allocated_amount='NaN' WHERE id=$1", [
      remittance.id,
    ]);
    await expect(
      reconcileRemittance(scopeA, remittance.id, {
        allocations: [{ eclaimId: prepared.id, remittedAmount: '7000.00' }],
      }),
    ).rejects.toMatchObject({ code: 'FINANCIAL_REVIEW_REQUIRED' });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM insurance_reconciliation_entries WHERE remittance_id=$1',
          [remittance.id],
        )
      ).rows[0].count,
    ).toBe(0);
    await pool.query("UPDATE insurance_remittances SET allocated_amount='0.00' WHERE id=$1", [
      remittance.id,
    ]);

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
    expect(recon.remittance.status).toBe('AWAITING_RECEIPT');
    expect(recon.entries[0].reconciliationStatus).toBe('MATCHED');
    await expect(
      matchRemittanceReceipt(scopeA, remittance.id, recon.entries[0].id, 2147483647),
    ).rejects.toMatchObject({
      code: 'SIMULATED_REMITTANCE',
    });
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

    // Separately model a pre-existing, staff-attested synthetic adjudication.
    // Do not change the simulated claim's provenance or match its advice to a
    // receipt. The fixture is not an external payer response or real money.
    const [manualInvoice] = await db
      .insert(schema.billingInvoices)
      .values({
        tenantId: scopeA.tenantId,
        facilityId: scopeA.facilityId,
        patientId: patientAId,
        encounterId: encounterAId,
        invoiceNumber: `INV-SYN-MANUAL-${randomUUID()}`,
        totalAmount: '8500.00',
        paidAmount: '0.00',
        balanceAmount: '8500.00',
        status: 'Unpaid',
        payerType: 'SHA',
        /* Finalization requires the recorded payer identity; a SHA invoice
         * without a member number is not a claimable invoice. */
        payerName: 'Synthetic SHA payer',
        memberNumber: 'SYNTHETIC-MEMBER',
      })
      .returning();
    await db.insert(schema.billingItems).values({
      invoiceId: manualInvoice.id,
      tariffId: tariffAId,
      tariffCode: simulationTariff.code,
      sourceType: 'RADIOLOGY',
      itemType: 'Radiology',
      description: 'Synthetic manually recorded imaging line',
      quantity: 1,
      unitPrice: '8500.00',
      totalAmount: '8500.00',
    });
    const [manualClaimFixture] = await db
      .insert(schema.shaEclaims)
      .values({
        tenantId: scopeA.tenantId,
        facilityId: scopeA.facilityId,
        patientId: patientAId,
        encounterId: encounterAId,
        invoiceId: manualInvoice.id,
        claimNumber: `SYN-MANUAL-CLAIM-${randomUUID()}`,
        claimUuid: randomUUID(),
        environmentMode: 'SYNTHETIC_TEST_FIXTURE',
        isSimulated: false,
        status: 'ADJUDICATED',
        billableStart: '2026-10-28',
        billableEnd: '2026-10-28',
        totalBilledAmount: '8500.00',
        totalClaimedAmount: '7000.00',
        totalApprovedAmount: '7000.00',
      })
      .returning();
    const financeContext: AuthorizationContext = {
      userId: scopeA.userId,
      tenantId: scopeA.tenantId,
      facilityId: scopeA.facilityId,
      roles: ['BILLING_CLERK'],
      permissions: ['billing.read', 'billing.update', 'billing.payments.record', 'clinical.read'],
      isSuperAdmin: false,
    };
    const accountingScope = {
      tenantId: scopeA.tenantId,
      facilityId: scopeA.facilityId,
      actorUserId: scopeA.userId,
    };
    const account = async (code: string, type: 'ASSET' | 'REVENUE') =>
      (
        await createAccountScoped(accountingScope, {
          accountCode: code,
          accountName: `Synthetic ${code}`,
          accountType: type,
          subType: code,
          normalBalance: type === 'ASSET' ? 'DEBIT' : 'CREDIT',
        })
      ).id;
    const patientAr = await account('SYN_PATIENT_AR', 'ASSET');
    const insurerAr = await account('SYN_INSURER_AR', 'ASSET');
    const clearing = await account('SYN_CLEARING', 'ASSET');
    const revenue = await account('SYN_REVENUE', 'REVENUE');
    await createFinancialPeriodScoped(accountingScope, {
      periodCode: 'SYN-SHA',
      name: 'Synthetic SHA period',
      startDate: '2000-01-01',
      endDate: '2099-12-31',
    });
    const date = (await pool.query('SELECT current_date::text AS date')).rows[0].date as string;
    await finalizeInvoice(financeContext, manualInvoice.id, {
      insurerResponsibility: '7000.00',
      copayment: '0.00',
      allocationBasis: 'Synthetic manual test allocation',
    });
    const invoicePosting = {
      entryDate: date,
      description: 'Synthetic reviewed invoice split',
      idempotencyKey: randomUUID(),
      patientReceivableAccountId: patientAr,
      insurerReceivableAccountId: insurerAr,
      revenueAccountId: revenue,
    };
    await expect(
      postBillingSourceScoped(
        { tenantId: scopeB.tenantId, facilityId: scopeB.facilityId, actorUserId: scopeB.userId },
        'BILLING_INVOICE',
        manualInvoice.id,
        invoicePosting,
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    const invoiceJournals = await Promise.all([
      postBillingSourceScoped(accountingScope, 'BILLING_INVOICE', manualInvoice.id, invoicePosting),
      postBillingSourceScoped(accountingScope, 'BILLING_INVOICE', manualInvoice.id, invoicePosting),
    ]);
    expect(invoiceJournals[0].journal.id).toBe(invoiceJournals[1].journal.id);
    expect(invoiceJournals.filter((journal) => journal.idempotentReplay)).toHaveLength(1);
    const beforeReceipt = await getFinalizedInvoice(financeContext, manualInvoice.id);
    if (!beforeReceipt.finalized) throw new Error('Synthetic invoice was not finalized.');
    expect(beforeReceipt.financial).toMatchObject({
      netReceipts: '0.00',
      patientBalance: '1500.00',
      insurerBalance: '7000.00',
    });

    const reference = `SYNTHETIC-SHA-${randomUUID().slice(0, 8)}`;
    const manualAdvice = await recordRemittanceAdvice(scopeA, {
      payerRemittanceRef: reference,
      paymentChannel: 'EFT',
      paymentDate: '2026-10-28',
      totalRemittedAmount: '7000.00',
    });
    const adviceOnly = await reconcileRemittance(scopeA, manualAdvice.id, {
      allocations: [{ eclaimId: manualClaimFixture.id, remittedAmount: '7000.00' }],
    });
    expect(adviceOnly.remittance.status).toBe('AWAITING_RECEIPT');
    expect(adviceOnly.entries[0].postedPaymentId).toBeNull();
    expect((await getShaClaimDetail(scopeA, manualClaimFixture.id)).totalPaidAmount).toBe('0.00');
    const stillUnpaid = await getFinalizedInvoice(financeContext, manualInvoice.id);
    if (!stillUnpaid.finalized) throw new Error('Synthetic invoice was not finalized.');
    expect(stillUnpaid.financial.netReceipts).toBe('0.00');
    const paymentInput = {
      invoiceId: manualInvoice.id,
      amount: '7000.00',
      paymentMethod: 'SHA',
      referenceCode: reference,
      payerParty: 'INSURER' as const,
      idempotencyKey: randomUUID(),
    };
    const receipts = await Promise.all([
      recordSettledPayment(financeContext, paymentInput, 'Synthetic cashier'),
      recordSettledPayment(financeContext, paymentInput, 'Synthetic cashier'),
    ]);
    expect(receipts[0].payment.id).toBe(receipts[1].payment.id);
    expect(receipts.filter((item) => item.idempotentReplay)).toHaveLength(1);
    const receipt = receipts[0];
    const entryId = adviceOnly.entries[0].id;
    await expect(
      matchRemittanceReceipt(scopeB, manualAdvice.id, entryId, receipt.payment.id),
    ).rejects.toMatchObject({
      code: 'REMITTANCE_NOT_FOUND',
    });
    await pool.query("UPDATE sha_eclaims SET status='ACKNOWLEDGED' WHERE id=$1", [
      manualClaimFixture.id,
    ]);
    try {
      await expect(
        matchRemittanceReceipt(scopeA, manualAdvice.id, entryId, receipt.payment.id),
      ).rejects.toMatchObject({
        code: 'ADJUDICATION_REQUIRED',
      });
    } finally {
      await pool.query("UPDATE sha_eclaims SET status='ADJUDICATED' WHERE id=$1", [
        manualClaimFixture.id,
      ]);
    }
    await pool.query("UPDATE sha_eclaims SET total_approved_amount='6500.00' WHERE id=$1", [
      manualClaimFixture.id,
    ]);
    try {
      await expect(
        matchRemittanceReceipt(scopeA, manualAdvice.id, entryId, receipt.payment.id),
      ).rejects.toMatchObject({
        code: 'CLAIM_RECEIPT_EXCEEDS_APPROVAL',
      });
    } finally {
      await pool.query("UPDATE sha_eclaims SET total_approved_amount='7000.00' WHERE id=$1", [
        manualClaimFixture.id,
      ]);
    }

    await pool.query(
      "UPDATE insurance_reconciliation_entries SET applied_to_invoice_amount='1.00' WHERE id=$1",
      [entryId],
    );
    try {
      await expect(
        matchRemittanceReceipt(scopeA, manualAdvice.id, entryId, receipt.payment.id),
      ).rejects.toMatchObject({
        code: 'FINANCIAL_REVIEW_REQUIRED',
      });
    } finally {
      await pool.query(
        "UPDATE insurance_reconciliation_entries SET applied_to_invoice_amount='0.00' WHERE id=$1",
        [entryId],
      );
    }

    const faultId = randomUUID().replaceAll('-', '');
    const trigger = `sha_receipt_audit_${faultId}`;
    const fault = `sha_receipt_fault_${faultId}`;
    await pool.query(`CREATE FUNCTION ${fault}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.facility_id=${scopeA.facilityId} AND NEW.action='SHA_REMITTANCE_RECEIPT_MATCHED' THEN
        RAISE EXCEPTION 'Synthetic match audit failure';
      END IF; RETURN NEW; END $$`);
    await pool.query(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${fault}()`,
    );
    try {
      await expect(
        matchRemittanceReceipt(scopeA, manualAdvice.id, entryId, receipt.payment.id),
      ).rejects.toThrow();
    } finally {
      await pool.query(`DROP TRIGGER ${trigger} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${fault}()`);
    }
    const unmodifiedEntry = (
      await pool.query(
        'SELECT posted_payment_id,applied_to_invoice_amount FROM insurance_reconciliation_entries WHERE id=$1',
        [entryId],
      )
    ).rows[0];
    expect(unmodifiedEntry).toEqual({ posted_payment_id: null, applied_to_invoice_amount: '0.00' });
    expect((await getShaClaimDetail(scopeA, manualClaimFixture.id)).totalPaidAmount).toBe('0.00');
    // Model the old advice-only status in this separate synthetic fixture;
    // matching must also recover legacy entries without a second advice.
    await pool.query("UPDATE insurance_remittances SET status='RECONCILED' WHERE id=$1", [
      manualAdvice.id,
    ]);

    const matches = await Promise.all([
      matchRemittanceReceipt(scopeA, manualAdvice.id, entryId, receipt.payment.id),
      matchRemittanceReceipt(scopeA, manualAdvice.id, entryId, receipt.payment.id),
    ]);
    expect(matches[0].entry.postedPaymentId).toBe(receipt.payment.id);
    expect(matches[0].remittance.status).toBe('RECONCILED');
    expect(matches.filter((item) => item.idempotentReplay)).toHaveLength(1);
    await expect(
      matchRemittanceReceipt(scopeA, manualAdvice.id, entryId, 2147483647),
    ).rejects.toMatchObject({
      code: 'ALLOCATION_ALREADY_MATCHED',
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_logs WHERE facility_id=$1 AND action='SHA_REMITTANCE_RECEIPT_MATCHED' AND resource_id=$2",
          [scopeA.facilityId, String(entryId)],
        )
      ).rows[0].n,
    ).toBe(1);
    const paymentPosting = {
      entryDate: date,
      description: 'Synthetic reviewed insurer receipt',
      idempotencyKey: randomUUID(),
      settlementAccountId: clearing,
    };
    const receiptJournal = await postBillingSourceScoped(
      accountingScope,
      'BILLING_PAYMENT',
      receipt.payment.id,
      paymentPosting,
    );
    expect(
      (
        await postBillingSourceScoped(
          accountingScope,
          'BILLING_PAYMENT',
          receipt.payment.id,
          paymentPosting,
        )
      ).idempotentReplay,
    ).toBe(true);
    const financial = await getFinalizedInvoice(financeContext, manualInvoice.id);
    if (!financial.finalized) throw new Error('Synthetic invoice was not finalized.');
    expect(financial.financial).toMatchObject({
      netReceipts: '7000.00',
      patientBalance: '1500.00',
      insurerBalance: '0.00',
      invoiceBalance: '1500.00',
    });
    const accountBalances = (
      await pool.query(
        `SELECT l.account_id,(sum(l.debit_cents)-sum(l.credit_cents))::text AS net
         FROM journal_entries j JOIN journal_lines l ON l.journal_entry_id=j.id
         WHERE j.tenant_id=$1 AND j.facility_id=$2 AND j.id=ANY($3::int[]) AND j.status='POSTED'
         GROUP BY l.account_id`,
        [
          scopeA.tenantId,
          scopeA.facilityId,
          [invoiceJournals[0].journal.id, receiptJournal.journal.id],
        ],
      )
    ).rows;
    expect(new Map(accountBalances.map((row) => [row.account_id, row.net]))).toEqual(
      new Map([
        [patientAr, '150000'],
        [insurerAr, '0'],
        [clearing, '700000'],
        [revenue, '-850000'],
      ]),
    );
    const statements = await getAccountingOverviewScoped(accountingScope, date, date);
    expect(statements.trialBalance).toMatchObject({
      debitKes: '15500.00',
      creditKes: '15500.00',
      balanced: true,
    });
    expect(statements.profitAndLoss).toMatchObject({ postedRevenueKes: '8500.00' });
    expect(statements.balanceSheet).toMatchObject({ assetsKes: '8500.00', balanced: true });
    expect(statements.limitations.billingReconciliation).toBe('NOT_IMPLEMENTED');
    const originalSimulated = await getShaClaimDetail(scopeA, prepared.id);
    expect(originalSimulated).toMatchObject({ isSimulated: true, totalPaidAmount: '0.00' });

    // 6. Verify 2-step HIE Remittance Sync, Fail-closed Callback Processing & ATNA Operational Report
    const syncedRems = await syncFacilityHieRemittances(scopeA, { facilityIdType: 'fr-code' });
    expect(syncedRems.imported.length).toBeGreaterThan(0);
    const breakdown = await fetchRemittanceClaimBreakdown(scopeA, syncedRems.imported[0].id);
    expect(breakdown.claims.length).toBeGreaterThan(0);

    const cb = {
      entityType: 'claim' as const,
      externalEntityId: prepared.claimUuid,
      externalEventId: `EVT-${randomUUID().slice(0, 8)}`,
      upstreamStatus: 'ADJUDICATED',
      signatureVerified: true,
    };
    const claimsBeforeCallbacks = await db
      .select()
      .from(schema.shaEclaims)
      .where(eq(schema.shaEclaims.id, prepared.id));
    const eventsBeforeCallbacks = await db
      .select()
      .from(schema.shaCallbackEvents)
      .where(eq(schema.shaCallbackEvents.tenantId, scopeA.tenantId));
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => processIncomingShaWebhookEvent(cb)),
    );
    expect(
      attempts.every(
        (result) =>
          result.status === 'rejected' && result.reason.code === 'SHA_CALLBACK_NOT_VERIFIED',
      ),
    ).toBe(true);
    expect(
      await db.select().from(schema.shaEclaims).where(eq(schema.shaEclaims.id, prepared.id)),
    ).toEqual(claimsBeforeCallbacks);
    expect(
      await db
        .select()
        .from(schema.shaCallbackEvents)
        .where(eq(schema.shaCallbackEvents.tenantId, scopeA.tenantId)),
    ).toEqual(eventsBeforeCallbacks);

    // Historical callback/audit bodies can contain arbitrary provider data.
    const sentinel = 'synthetic-historical-secret';
    const ownEvent = (
      await pool.query(
        `INSERT INTO sha_callback_events(tenant_id,facility_id,entity_type,external_reference,upstream_status,processing_outcome,payload_summary)
      VALUES($1,$2,'claim','synthetic-ref','UNKNOWN','HISTORICAL',$3::jsonb) RETURNING id`,
        [scopeA.tenantId, scopeA.facilityId, JSON.stringify({ token: sentinel })],
      )
    ).rows[0].id;
    const otherEvent = (
      await pool.query(
        `INSERT INTO sha_callback_events(tenant_id,facility_id,entity_type,external_reference,upstream_status,processing_outcome,payload_summary)
      VALUES($1,$2,'claim','synthetic-ref-other','UNKNOWN','HISTORICAL',$3::jsonb) RETURNING id`,
        [scopeB.tenantId, scopeA.facilityId, JSON.stringify({ token: sentinel })],
      )
    ).rows[0].id;
    const otherAudit = (
      await pool.query(
        `INSERT INTO audit_logs(tenant_id,facility_id,user_id,action,resource,resource_id,details)
      VALUES($1,$2,'synthetic','SHA_SYNTHETIC','claim','1',$3) RETURNING id`,
        [scopeB.tenantId, scopeA.facilityId, sentinel],
      )
    ).rows[0].id;
    const ownAudit = (
      await pool.query(
        `INSERT INTO audit_logs(tenant_id,facility_id,user_id,action,resource,resource_id,details)
      VALUES($1,$2,'synthetic','SHA_SYNTHETIC','claim','1',$3) RETURNING id`,
        [scopeA.tenantId, scopeA.facilityId, sentinel],
      )
    ).rows[0].id;
    const listed = await listShaCallbackEvents(scopeA);
    expect(listed.some((event) => event.id === ownEvent)).toBe(true);
    expect(listed.some((event) => event.id === otherEvent)).toBe(false);
    expect(JSON.stringify(listed)).not.toContain(sentinel);
    const opReport = await getShaOperationalReport(scopeA);
    expect(opReport.metrics.claimsTotal).toBeGreaterThanOrEqual(1);
    expect(opReport.atnaAuditTrail.length).toBeGreaterThan(0);
    expect(opReport.atnaAuditTrail.some((event) => event.eventId === ownAudit)).toBe(true);
    expect(opReport.atnaAuditTrail.some((event) => event.eventId === otherAudit)).toBe(false);
    expect(opReport.recentCallbacks.some((event) => event.id === otherEvent)).toBe(false);
    expect(opReport.metrics.callbacksReceivedCount).toBe(1);
    expect(opReport.gatewayStatus).toMatchObject({ enabled: false, verified: false });
    expect(opReport.callbackVerification).toBe('NOT_ESTABLISHED');
    expect(JSON.stringify(opReport)).not.toContain(sentinel);
  });

  /*
   * Migration 0088: a claim is a statement about a fixed invoice. These cases
   * pin the gate itself, because the happy path above only proves that a
   * finalized invoice works — not that an unfinalized or cancelled one is
   * refused, nor that the claimed invoice state survives on the claim row.
   */
  it('refuses draft and voided invoices and freezes the claimed invoice onto the claim', async () => {
    const suffix = randomUUID().slice(0, 8);
    const billingContext: AuthorizationContext = {
      userId: scopeA.userId,
      tenantId: scopeA.tenantId,
      facilityId: scopeA.facilityId,
      roles: ['BILLING_CLERK'],
      permissions: ['billing.read', 'billing.update', 'clinical.read'],
      isSuperAdmin: false,
    };

    const makeInvoice = async (label: string) => {
      const [invoice] = await db
        .insert(schema.billingInvoices)
        .values({
          tenantId: scopeA.tenantId,
          facilityId: scopeA.facilityId,
          patientId: patientAId,
          encounterId: encounterAId,
          invoiceNumber: `INV-${label}-${suffix}`,
          totalAmount: '8500.00',
          paidAmount: '0.00',
          balanceAmount: '8500.00',
          status: 'Unpaid',
          payerType: 'SHA',
          payerName: 'Social Health Authority',
          memberNumber: `SHA-MEMBER-${randomUUID()}`,
        })
        .returning();
      await db.insert(schema.billingItems).values({
        invoiceId: invoice.id,
        tariffId: tariffAId,
        tariffCode: `RAD-CT-${suffix}`,
        sourceType: 'OPD',
        itemType: 'Radiology',
        description: 'CT Brain Scan',
        quantity: 1,
        unitPrice: '8500.00',
        totalAmount: '8500.00',
      });
      return invoice;
    };

    const prepInput = (invoiceId: number) => ({
      invoiceId,
      encounterId: encounterAId,
      schemeCode: 'SHIF',
      subType: 'op' as const,
    });

    // 1. A draft invoice has a total that can still move, so it cannot be claimed.
    const draft = await makeInvoice('DRAFT');
    await expect(prepareShaClaim(scopeA, prepInput(draft.id))).rejects.toMatchObject({
      code: 'INVOICE_NOT_FINALIZED',
      httpStatus: 409,
    });
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM sha_eclaims WHERE invoice_id=$1', [
          draft.id,
        ])
      ).rows[0].n,
    ).toBe(0);

    // 2. A finalized invoice can be claimed, and the claim records exactly what was frozen.
    const finalized = await makeInvoice('FROZEN');
    await finalizeClaimInvoice({
      tenantId: scopeA.tenantId,
      facilityId: scopeA.facilityId,
      userId: scopeA.userId,
      invoiceId: finalized.id,
      insurer: '8500.00',
    });
    const claim = await prepareShaClaim(scopeA, prepInput(finalized.id));
    const frozen = await getFinalizedInvoice(billingContext, finalized.id);
    if (!('finalizedAt' in frozen)) throw new Error('Synthetic invoice was not finalized');
    expect(claim.invoiceFinalizedAt).not.toBeNull();
    expect(new Date(claim.invoiceFinalizedAt as Date).toISOString()).toBe(frozen.finalizedAt);
    expect(claim.invoiceSnapshot).toEqual(frozen.snapshot);
    expect(claim.invoiceSnapshot).toMatchObject({
      invoice: { id: finalized.id, number: finalized.invoiceNumber },
      amounts: { itemizedTotal: '8500.00', insurerResponsibility: '8500.00' },
    });

    // 3. A void after preparation must stop the dispatch, because the payer would
    //    otherwise be billed for a cancelled receivable.
    await voidInvoiceScoped(billingContext, finalized.id, 'Synthetic cancellation before dispatch');
    await expect(submitShaClaim(scopeA, claim.id)).rejects.toMatchObject({
      code: 'INVOICE_VOIDED',
      httpStatus: 409,
    });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM sha_eclaim_submissions WHERE eclaim_id=$1',
          [claim.id],
        )
      ).rows[0].n,
    ).toBe(0);

    // 4. The same voided invoice can never seed another claim.
    await expect(prepareShaClaim(scopeA, prepInput(finalized.id))).rejects.toMatchObject({
      code: 'INVOICE_VOIDED',
      httpStatus: 409,
    });
  });
});
