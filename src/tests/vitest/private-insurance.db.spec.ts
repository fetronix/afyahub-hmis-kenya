/**
 * JaliCare HMIS — Private Insurance Multi-Payer Module (Britam & PACIS First)
 * PostgreSQL End-to-End Integration & Tenant Isolation Suite
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeAll, expect, it } from 'vitest';

import { describeDb } from './support/db.ts';
import { db, pool } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import {
  listPrivatePayers,
  updatePrivatePayer,
} from '../../insurance/payers/payer-config.service.ts';
import {
  createInsuranceMemberPolicy,
  listInsuranceMembers,
  updateInsuranceMemberPolicy,
} from '../../insurance/eligibility/member-policy.service.ts';
import { checkPrivateInsuranceEligibility } from '../../insurance/eligibility/eligibility.service.ts';
import { assignPayer, setActivation } from '../../insurance/hub/service.ts';
import { recordSettledPayment } from '../../billing/payments.service.ts';
import { attributeInvoicePayment } from '../../billing/finalized-invoice.service.ts';
import { matchRecordedPayerPayment } from '../../insurance/hub/recorded-payment.ts';
import { getPayerAdapter, registerPayerAdapter } from '../../insurance/core/adapter-registry.ts';
import { createPayerServiceMapping } from '../../insurance/mappings/mappings.service.ts';
import {
  createOrApprovePayerBenefitRule,
  validatePrivateServiceBenefit,
} from '../../insurance/benefits/benefits.service.ts';
import {
  addPrivatePreauthAttachment,
  createPrivatePreauthorization,
  recordPrivatePreauthDecision,
  submitPrivatePreauthorization,
} from '../../insurance/preauthorization/preauthorization.service.ts';
import {
  getPrivateInsuranceClaimById,
  preparePrivateInsuranceClaim,
  recordPrivateClaimDecision,
  submitPrivateInsuranceClaim,
  updateOrCorrectPrivateClaim,
  validatePrivateInsuranceClaimById,
} from '../../insurance/claims/private-claims.service.ts';
import {
  getPrivateReconciliationRegister,
  importPrivateRemittance,
  reconcilePrivateRemittance,
} from '../../insurance/remittance/remittance-reconciliation.service.ts';

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

interface TestActor {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole: string;
  actorDisplayName: string;
}

describeDb(
  'Private Insurance (Britam & PACIS) PostgreSQL end-to-end workflow & tenant isolation',
  () => {
    let actorA: TestActor;
    let actorB: TestActor;
    let patientAId = 0;
    let encounterAId = 0;
    let tariffConsultId = 0;
    let tariffCtId = 0;
    let invoiceBritamId = 0;
    let invoicePacisId = 0;

    beforeAll(async () => {
      const dbName = process.env.SQL_DB_NAME ?? 'jalicare_test';
      if (!dbName.includes('test')) {
        throw new Error(`Refusing to run DB integration tests against non-test DB "${dbName}".`);
      }

      execFileSync('node', ['scripts/run-script.mjs', 'migrate', '--yes'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 120_000,
        env: process.env,
      });

      const suffix = randomUUID().slice(0, 8);

      const [tenantA] = await db
        .insert(schema.tenants)
        .values({ name: `Private Ins Tenant A ${suffix}`, slug: `priv-ins-a-${suffix}` })
        .returning();

      const [tenantB] = await db
        .insert(schema.tenants)
        .values({ name: `Private Ins Tenant B ${suffix}`, slug: `priv-ins-b-${suffix}` })
        .returning();

      const [facilityA] = await db
        .insert(schema.facilities)
        .values({
          tenantId: tenantA.id,
          code: `PRIV-FAC-A-${suffix}`,
          name: 'Nyeri Multi-Payer Hospital A',
          level: 'Level 4',
        })
        .returning();

      const [facilityB] = await db
        .insert(schema.facilities)
        .values({
          tenantId: tenantB.id,
          code: `PRIV-FAC-B-${suffix}`,
          name: 'Other Tenant Hospital B',
          level: 'Level 3',
        })
        .returning();

      const [userA] = await db
        .insert(schema.users)
        .values({
          uid: `uid-priv-a-${suffix}`,
          username: `priv_admin_a_${suffix}`,
          email: `priv_a_${suffix}@example.test`,
          passwordHash: 'not-used-in-service-test',
          fullName: 'Insurance Desk Lead A',
          tenantId: tenantA.id,
          facilityId: facilityA.id,
        })
        .returning();

      const [userB] = await db
        .insert(schema.users)
        .values({
          uid: `uid-priv-b-${suffix}`,
          username: `priv_admin_b_${suffix}`,
          email: `priv_b_${suffix}@example.test`,
          passwordHash: 'not-used-in-service-test',
          fullName: 'Insurance Desk Lead B',
          tenantId: tenantB.id,
          facilityId: facilityB.id,
        })
        .returning();

      actorA = {
        tenantId: tenantA.id,
        facilityId: facilityA.id,
        actorUserId: userA.id,
        actorUserUid: userA.uid,
        actorRole: 'BILLING_CLERK',
        actorDisplayName: userA.fullName ?? 'Insurance Desk Lead A',
      };

      actorB = {
        tenantId: tenantB.id,
        facilityId: facilityB.id,
        actorUserId: userB.id,
        actorUserUid: userB.uid,
        actorRole: 'BILLING_CLERK',
        actorDisplayName: userB.fullName ?? 'Insurance Desk Lead B',
      };

      // Each provider is explicitly assigned by the platform and activated by
      // the facility. Legacy auto-created defaults are not authorization.
      const definitions = await db.select().from(schema.insurancePayerDefinitions);
      for (const payer of definitions.filter((p) => ['BRITAM', 'PACIS'].includes(p.code))) {
        await assignPayer(userA.id, payer.id, facilityA.id, true);
        await setActivation(
          { tenantId: tenantA.id, facilityId: facilityA.id, actorUserId: userA.id },
          payer.id,
          true,
        );
      }

      const [patient] = await db
        .insert(schema.patients)
        .values({
          tenantId: tenantA.id,
          registrationFacilityId: facilityA.id,
          mrn: `MRN-PRIV-${suffix}`,
          firstName: 'Wanjiku',
          lastName: 'Kamau',
          dateOfBirth: '1991-03-15',
          gender: 'Female',
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
          chiefComplaint: 'Chest pain and cough',
          clinicalNotes: 'Evaluated in OPD; chest CT and consultation completed.',
        })
        .returning();
      encounterAId = encounter.id;

      await db.insert(schema.diagnoses).values({
        encounterId: encounter.id,
        patientId: patient.id,
        icd10Code: 'J18.9',
        icd10Description: 'Pneumonia, unspecified organism',
      });

      const [tConsult] = await db
        .insert(schema.facilityServiceTariffs)
        .values({
          tenantId: tenantA.id,
          facilityId: facilityA.id,
          code: `OPD-CONS-${suffix}`,
          description: 'Specialist Consultation',
          department: 'OPD',
          fee: '3000.00',
        })
        .returning();
      tariffConsultId = tConsult.id;

      const [tCt] = await db
        .insert(schema.facilityServiceTariffs)
        .values({
          tenantId: tenantA.id,
          facilityId: facilityA.id,
          code: `IMG-CT-${suffix}`,
          description: 'CT Chest Scan',
          department: 'RADIOLOGY',
          fee: '12000.00',
        })
        .returning();
      tariffCtId = tCt.id;

      // Invoice 1: Britam outpatient consultation (KES 3,000.00)
      const [invBritam] = await db
        .insert(schema.billingInvoices)
        .values({
          tenantId: tenantA.id,
          facilityId: facilityA.id,
          patientId: patient.id,
          encounterId: encounter.id,
          invoiceNumber: `INV-BRM-${suffix}`,
          totalAmount: '3000.00',
          paidAmount: '0.00',
          balanceAmount: '3000.00',
          status: 'Unpaid',
          payerType: 'Insurance',
        })
        .returning();
      invoiceBritamId = invBritam.id;

      await db.insert(schema.billingItems).values({
        invoiceId: invBritam.id,
        tariffId: tConsult.id,
        tariffCode: tConsult.code,
        sourceType: 'OPD',
        itemType: 'Consultation',
        description: 'Specialist Consultation',
        quantity: 1,
        unitPrice: '3000.00',
        totalAmount: '3000.00',
      });

      // Invoice 2: PACIS CT scan requiring preauth (KES 12,000.00)
      const [invPacis] = await db
        .insert(schema.billingInvoices)
        .values({
          tenantId: tenantA.id,
          facilityId: facilityA.id,
          patientId: patient.id,
          encounterId: encounter.id,
          invoiceNumber: `INV-PAC-${suffix}`,
          totalAmount: '12000.00',
          paidAmount: '0.00',
          balanceAmount: '12000.00',
          status: 'Unpaid',
          payerType: 'Insurance',
        })
        .returning();
      invoicePacisId = invPacis.id;

      await db.insert(schema.billingItems).values({
        invoiceId: invPacis.id,
        tariffId: tCt.id,
        tariffCode: tCt.code,
        sourceType: 'RADIOLOGY',
        itemType: 'Imaging',
        description: 'CT Chest Scan',
        quantity: 1,
        unitPrice: '12000.00',
        totalAmount: '12000.00',
      });
    });

    it('executes complete Britam & PACIS workflows while preserving original invoices and enforcing tenant isolation', async () => {
      // 1. Britam & PACIS configurations assigned and activated explicitly
      const payersA = await listPrivatePayers({
        tenantId: actorA.tenantId,
        facilityId: actorA.facilityId,
      });
      const britam = payersA.find((p) => p.payerCode === 'BRITAM');
      const pacis = payersA.find((p) => p.payerCode === 'PACIS');
      expect(britam).toBeDefined();
      expect(pacis).toBeDefined();
      expect(britam?.connectionStatus).toBe('NOT_CONFIGURED');
      expect(pacis?.connectionStatus).toBe('NOT_CONFIGURED');

      await updatePrivatePayer({
        ...actorA,
        payerId: britam!.id,
        input: {
          providerIdentifier: 'BRITAM-NYERI-401',
          claimRequirements: {
            allowedCodingSystems: ['ICD-10'],
            codingPolicyVerified: true,
            codingPolicyEvidence: 'Synthetic test policy; not real payer documentation.',
          },
        },
      });

      // 2. Link SAME JaliCare patient to BOTH Britam and PACIS policies (multi-policy support)
      const britamPolicy = await createInsuranceMemberPolicy({
        ...actorA,
        input: {
          patientId: patientAId,
          payerCode: 'BRITAM',
          memberNumber: 'BRM-770011-00',
          policyNumber: 'CORP-BRM-2026',
          planName: 'Britam Corporate Gold',
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
        },
      });
      expect(britamPolicy.verificationStatus).toBe('UNVERIFIED_LOCAL');

      const pacisPolicy = await createInsuranceMemberPolicy({
        ...actorA,
        input: {
          patientId: patientAId,
          payerCode: 'PACIS',
          memberNumber: 'PAC-990022-00',
          policyNumber: 'CORP-PAC-2026',
          planName: 'PACIS Preferred Executive',
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
        },
      });
      expect(pacisPolicy.verificationStatus).toBe('UNVERIFIED_LOCAL');

      // Duplicate active policy prevention
      await expect(
        createInsuranceMemberPolicy({
          ...actorA,
          input: {
            patientId: patientAId,
            payerCode: 'BRITAM',
            memberNumber: 'BRM-770011-00',
          },
        }),
      ).rejects.toThrow();

      // Audited policy correction requires correctionReason
      const correctedPolicy = await updateInsuranceMemberPolicy({
        ...actorA,
        memberId: britamPolicy.id,
        input: {
          schemeName: 'Nyeri Tea Growers Corporate',
          correctionReason: 'Added corporate employer name from Britam card',
        },
      });
      expect(correctedPolicy.correctionCount).toBe(1);

      // 3. Eligibility verification: adapter returns honest Not supported; manual verification records reference
      const adapterCheck = await checkPrivateInsuranceEligibility({
        ...actorA,
        input: {
          patientId: patientAId,
          payerCode: 'BRITAM',
          memberPolicyId: britamPolicy.id,
          verificationMode: 'ADAPTER',
        },
      });
      expect(adapterCheck.source).not.toBe('PAYER_LIVE_API');
      expect(adapterCheck.outcome).not.toBe('Ineligible');

      const manualBritamCheck = await checkPrivateInsuranceEligibility({
        ...actorA,
        input: {
          patientId: patientAId,
          payerCode: 'BRITAM',
          memberPolicyId: britamPolicy.id,
          encounterId: encounterAId,
          verificationMode: 'MANUAL',
          manualOutcome: 'Eligible',
          evidenceSource: 'PAYER_PORTAL_MANUAL',
          manualReference: 'BRITAM-PORTAL-VER-5501',
        },
      });
      expect(manualBritamCheck.outcome).toBe('Eligible');
      expect(manualBritamCheck.source).toBe('MANUAL_VERIFICATION:PAYER_PORTAL_MANUAL');

      await checkPrivateInsuranceEligibility({
        ...actorA,
        input: {
          patientId: patientAId,
          payerCode: 'PACIS',
          memberPolicyId: pacisPolicy.id,
          encounterId: encounterAId,
          verificationMode: 'MANUAL',
          manualOutcome: 'Eligible',
          evidenceSource: 'PAYER_PORTAL_MANUAL',
          manualReference: 'PACIS-DESK-VER-8802',
        },
      });

      // 4. Separate Britam & PACIS mappings and benefit/copayment rules
      await createPayerServiceMapping({
        ...actorA,
        input: {
          payerCode: 'BRITAM',
          tariffId: tariffConsultId,
          serviceArea: 'OPD_CONSULTATION',
          payerServiceCode: 'BRM-SPEC-CONS',
          reimbursementTariff: '3000.00',
          requiresPreauth: false,
        },
      });

      await createPayerServiceMapping({
        ...actorA,
        input: {
          payerCode: 'PACIS',
          tariffId: tariffCtId,
          serviceArea: 'IMAGING',
          payerServiceCode: 'PAC-IMG-CT01',
          reimbursementTariff: '12000.00',
          requiresPreauth: true,
        },
      });

      await createOrApprovePayerBenefitRule({
        ...actorA,
        input: {
          payerCode: 'BRITAM',
          ruleCode: 'BRM-OPD-COPAY-500',
          benefitPackage: 'Synthetic test package',
          serviceCategory: 'OPD_CONSULTATION',
          copayType: 'FIXED',
          copayValue: '500.00',
          deductibleAmount: '0.00',
          coinsurancePercent: '0.00',
          effectiveFrom: '2026-01-01',
          sourceReference: 'Synthetic test schedule',
          approveImmediately: true,
        },
      });

      const missingClinicalEvidence = await validatePrivateServiceBenefit({
        ...actorA,
        input: {
          patientId: patientAId,
          payerCode: 'BRITAM',
          tariffId: tariffConsultId,
          quantity: 1,
        },
      });
      expect(missingClinicalEvidence.decision).toBe('INCOMPLETE_INFORMATION');
      expect(missingClinicalEvidence.missingRequirements).toContain(
        'Clinical consultation notes / diagnosis required.',
      );

      const benefitVal = await validatePrivateServiceBenefit({
        ...actorA,
        input: {
          patientId: patientAId,
          payerCode: 'BRITAM',
          tariffId: tariffConsultId,
          quantity: 1,
          hasClinicalNotes: true,
        },
      });
      expect(benefitVal.decision).toBe('COVERED');
      expect(benefitVal.estimatedCopayAmount).toBe('500.00');
      expect(benefitVal.estimatedCoveredAmount).toBe('2500.00');

      // 5. PACIS Preauthorization workflow (Draft -> Attachment -> Submit -> Approved)
      const pacisPreauth = await createPrivatePreauthorization({
        ...actorA,
        input: {
          patientId: patientAId,
          payerCode: 'PACIS',
          memberPolicyId: pacisPolicy.id,
          encounterId: encounterAId,
          invoiceId: invoicePacisId,
          category: 'IMAGING',
          clinicalIndication: 'Suspected pneumonia complications',
          primaryDiagnosisCode: 'J18.9',
          primaryDiagnosisDisplay: 'Pneumonia',
          requestedItems: [
            {
              serviceCode: 'PAC-IMG-CT01',
              serviceName: 'CT Chest Scan',
              quantity: 1,
              unitPrice: '12000.00',
            },
          ],
        },
      });
      expect(pacisPreauth.status).toBe('DRAFT');

      await addPrivatePreauthAttachment({
        ...actorA,
        preauthId: pacisPreauth.id,
        input: {
          documentType: 'RADIOLOGY_REQUEST',
          fileName: 'pacis-ct-request.pdf',
          storageReference: 'vault://preauth/pacis-ct-request.pdf',
        },
      });

      const submittedPreauth = await submitPrivatePreauthorization({
        ...actorA,
        preauthId: pacisPreauth.id,
        input: { submissionMode: 'MANUAL', manualDispatchReference: 'PACIS-EMAIL-001' },
      });
      expect(submittedPreauth.status).toBe('REQUESTED');

      await expect(
        recordPrivatePreauthDecision({
          ...actorA,
          preauthId: pacisPreauth.id,
          input: { status: 'APPROVED', payerAuthReference: 'SYNTHETIC-TEST-REFERENCE' },
        }),
      ).rejects.toThrow(/actual payer-approved amount/i);
      const approvedPreauth = await recordPrivatePreauthDecision({
        ...actorA,
        preauthId: pacisPreauth.id,
        input: {
          status: 'APPROVED',
          payerAuthReference: 'PACIS-AUTH-2026-9911',
          approvedAmount: '12000.00',
          validUntil: '2026-12-31',
        },
      });
      expect(approvedPreauth.status).toBe('APPROVED');
      expect(approvedPreauth.payerAuthReference).toBe('PACIS-AUTH-2026-9911');

      // An unrelated invoice demonstrates that patient-paid totals use explicit receipt provenance.
      const [splitInvoice] = await db
        .insert(schema.billingInvoices)
        .values({
          tenantId: actorA.tenantId,
          facilityId: actorA.facilityId,
          patientId: patientAId,
          encounterId: encounterAId,
          invoiceNumber: `INV-SPLIT-${randomUUID()}`,
          totalAmount: '3000.00',
          paidAmount: '0.00',
          balanceAmount: '3000.00',
          status: 'Unpaid',
          payerType: 'Insurance',
        })
        .returning();
      const [splitTariff] = await db
        .select()
        .from(schema.facilityServiceTariffs)
        .where(eq(schema.facilityServiceTariffs.id, tariffConsultId));
      await db.insert(schema.billingItems).values({
        invoiceId: splitInvoice.id,
        tariffId: tariffConsultId,
        tariffCode: splitTariff.code,
        sourceType: 'OPD',
        itemType: 'Consultation',
        description: 'Specialist Consultation',
        quantity: 1,
        unitPrice: '3000.00',
        totalAmount: '3000.00',
      });
      const paymentCtx = {
        userId: actorA.actorUserId,
        tenantId: actorA.tenantId,
        facilityId: actorA.facilityId,
        roles: ['BILLING_CLERK'],
        permissions: ['billing.read', 'billing.payments.record'],
        isSuperAdmin: false,
      };
      const unattributed = await recordSettledPayment(
        paymentCtx,
        { invoiceId: splitInvoice.id, amount: '100.00', paymentMethod: 'Cash' },
        'Synthetic cashier',
      );
      const splitInput = {
        ...actorA,
        input: {
          invoiceId: splitInvoice.id,
          payerCode: 'BRITAM',
          memberPolicyId: britamPolicy.id,
          encounterId: encounterAId,
          attachmentsManifest: [
            {
              documentType: 'ITEMIZED_INVOICE',
              fileName: 'synthetic.pdf',
              storageReference: 'synthetic://invoice',
            },
            {
              documentType: 'SIGNED_CLAIM_FORM',
              fileName: 'synthetic.pdf',
              storageReference: 'synthetic://form',
            },
          ],
        },
      };
      await expect(preparePrivateInsuranceClaim(splitInput)).rejects.toMatchObject({
        code: 'PAYMENT_ATTRIBUTION_REQUIRED',
      });
      await attributeInvoicePayment(
        paymentCtx,
        splitInvoice.id,
        unattributed.payment.id,
        'PATIENT',
        'Synthetic source review',
      );
      await recordSettledPayment(
        paymentCtx,
        {
          invoiceId: splitInvoice.id,
          amount: '200.00',
          paymentMethod: 'Insurance - BRITAM',
          payerParty: 'INSURER',
        },
        'Synthetic cashier',
      );
      const lockClient = await pool.connect();
      try {
        await lockClient.query('BEGIN');
        const pid = (await lockClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await lockClient.query('SELECT id FROM billing_invoices WHERE id=$1 FOR UPDATE', [
          splitInvoice.id,
        ]);
        const pending = preparePrivateInsuranceClaim(splitInput).then(
          () => null,
          (err: unknown) => err,
        );
        await waitForInvoiceLock(pid);
        await lockClient.query(
          `UPDATE billing_items SET description='Synthetic changed consultation' WHERE invoice_id=$1`,
          [splitInvoice.id],
        );
        await lockClient.query('COMMIT');
        expect(await pending).toMatchObject({ code: 'INVOICE_CHANGED' });
      } finally {
        await lockClient.query('ROLLBACK');
        lockClient.release();
      }
      const concurrentPrep = await Promise.allSettled([
        preparePrivateInsuranceClaim(splitInput),
        preparePrivateInsuranceClaim(splitInput),
      ]);
      expect(concurrentPrep.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(concurrentPrep.filter((r) => r.status === 'rejected')).toHaveLength(1);
      const splitClaim = concurrentPrep.find(
        (
          r,
        ): r is PromiseFulfilledResult<Awaited<ReturnType<typeof preparePrivateInsuranceClaim>>> =>
          r.status === 'fulfilled',
      )!.value;
      expect(splitClaim.patientPaidAmount).toBe('100.00');
      const originalAdapter = getPayerAdapter(splitClaim.adapterKey);
      if (!originalAdapter) throw new Error('Synthetic payer adapter not registered');
      let sends = 0;
      const brokenAdapter = new Proxy(originalAdapter, {
        get(target, property, receiver) {
          if (property === 'submitClaim')
            return async () => {
              sends += 1;
              throw new Error('synthetic lost response');
            };
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      registerPayerAdapter(brokenAdapter);
      try {
        const uncertain = () =>
          submitPrivateInsuranceClaim({
            ...actorA,
            claimId: splitClaim.id,
            input: { submissionMode: 'ADAPTER' },
          });
        await expect(uncertain()).rejects.toMatchObject({ code: 'CLAIM_DISPATCH_REVIEW_REQUIRED' });
        await expect(uncertain()).rejects.toMatchObject({ code: 'CLAIM_DISPATCH_REVIEW_REQUIRED' });
        expect(sends).toBe(1);
        const uncertainClaim = await getPrivateInsuranceClaimById({
          tenantId: actorA.tenantId,
          facilityId: actorA.facilityId,
          claimId: splitClaim.id,
        });
        expect(uncertainClaim.dispatchReview?.state).toBe('UNCERTAIN');
      } finally {
        registerPayerAdapter(originalAdapter);
      }

      // 6. Prepare Britam Claim from JaliCare invoice WITHOUT mutating original invoice
      const britamClaim = await preparePrivateInsuranceClaim({
        ...actorA,
        input: {
          invoiceId: invoiceBritamId,
          payerCode: 'BRITAM',
          memberPolicyId: britamPolicy.id,
          encounterId: encounterAId,
          attachmentsManifest: [
            {
              documentType: 'ITEMIZED_INVOICE',
              fileName: 'synthetic-invoice.pdf',
              storageReference: `jalicare://invoices/${invoiceBritamId}`,
            },
            {
              documentType: 'SIGNED_CLAIM_FORM',
              fileName: 'britam-signed-claim.pdf',
              storageReference: 'vault://claims/britam-signed-claim.pdf',
            },
          ],
        },
      });
      expect(britamClaim.status).toBe('DRAFT');
      const validatedClaim = await validatePrivateInsuranceClaimById({
        ...actorA,
        claimId: britamClaim.id,
      });
      expect(validatedClaim.validationIssues.filter((issue) => issue.severity === 'ERROR')).toEqual(
        [],
      );
      expect(validatedClaim.status).toBe('READY');
      expect(britamClaim.grossInvoiceAmount).toBe('3000.00');
      expect(britamClaim.confirmedCopayAmount).toBe('500.00');
      expect(britamClaim.proposedClaimAmount).toBe('2500.00');

      // Verify original JaliCare invoice is untouched and STILL Unpaid!
      const [invBeforeSubmit] = await db
        .select()
        .from(schema.billingInvoices)
        .where(eq(schema.billingInvoices.id, invoiceBritamId));
      expect(invBeforeSubmit.status).toBe('Unpaid');
      expect(invBeforeSubmit.paidAmount).toBe('0.00');

      // Submit claim & verify duplicate-submission prevention
      const submitInput = {
        ...actorA,
        claimId: britamClaim.id,
        input: {
          submissionMode: 'MANUAL',
          dispatchReference: `BRITAM-PORTAL-SUB-101-${actorA.facilityId}`,
        },
      };
      const simultaneous = await Promise.allSettled([
        submitPrivateInsuranceClaim(submitInput),
        submitPrivateInsuranceClaim(submitInput),
      ]);
      const submittedClaim = simultaneous.find(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof submitPrivateInsuranceClaim>>> =>
          r.status === 'fulfilled',
      )?.value;
      expect(simultaneous.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(simultaneous.filter((r) => r.status === 'rejected')).toHaveLength(1);
      if (!submittedClaim) throw new Error('Expected one manually recorded dispatch');
      expect(submittedClaim.status).toBe('SUBMITTED');
      expect(submittedClaim.submissions).toHaveLength(1);

      const [invAfterSubmit] = await db
        .select()
        .from(schema.billingInvoices)
        .where(eq(schema.billingInvoices.id, invoiceBritamId));
      expect(invAfterSubmit.status).toBe('Unpaid');

      await expect(
        submitPrivateInsuranceClaim({
          ...actorA,
          claimId: britamClaim.id,
          input: {
            submissionMode: 'MANUAL',
            dispatchReference: `BRITAM-PORTAL-SUB-DUP-${actorA.facilityId}`,
          },
        }),
      ).rejects.toThrow();

      // 7. Rejection -> Audited Correction -> Resubmission -> Adjudication
      const rejectedClaim = await recordPrivateClaimDecision({
        ...actorA,
        claimId: britamClaim.id,
        input: {
          status: 'REJECTED',
          externalClaimReference: 'SYNTHETIC-REJECT-001',
          rejectionCode: 'CLINICAL_SUMMARY_REQ',
          rejectionReason: 'Attach discharge/OPD clinical note',
        },
      });
      expect(rejectedClaim.status).toBe('REJECTED');

      const correctedClaim = await updateOrCorrectPrivateClaim({
        ...actorA,
        claimId: britamClaim.id,
        input: {
          correctionReason: 'Added OPD clinical note attachment alongside signed claim form',
          attachmentsManifest: [
            {
              documentType: 'ITEMIZED_INVOICE',
              fileName: 'synthetic-invoice.pdf',
              storageReference: `jalicare://invoices/${invoiceBritamId}`,
            },
            {
              documentType: 'SIGNED_CLAIM_FORM',
              fileName: 'britam-signed-claim.pdf',
              storageReference: 'vault://claims/britam-signed-claim.pdf',
            },
            {
              documentType: 'CLINICAL_NOTES',
              fileName: 'opd-notes.pdf',
              storageReference: 'vault://claims/opd-notes.pdf',
            },
          ],
        },
      });
      expect(correctedClaim.revisionNumber).toBe(2);
      expect(correctedClaim.status).toBe('DRAFT');
      const revalidatedClaim = await validatePrivateInsuranceClaimById({
        ...actorA,
        claimId: britamClaim.id,
      });
      expect(
        revalidatedClaim.validationIssues.filter((issue) => issue.severity === 'ERROR'),
      ).toEqual([]);
      expect(revalidatedClaim.status).toBe('READY');

      const resubmittedClaim = await submitPrivateInsuranceClaim({
        ...actorA,
        claimId: britamClaim.id,
        isResubmission: true,
        input: {
          submissionMode: 'MANUAL',
          dispatchReference: `BRITAM-PORTAL-SUB-102-${actorA.facilityId}`,
          correctionReason: 'Synthetic test correction with supporting documents.',
        },
      });
      expect(resubmittedClaim.status).toBe('SUBMITTED');
      expect(resubmittedClaim.submissionCount).toBe(2);

      // A separate uncertain claim cannot be altered by remittance matching.
      const guardedAdvice = await importPrivateRemittance({
        ...actorA,
        input: {
          payerCode: 'BRITAM',
          payerRemittanceRef: `SYN-GUARD-${randomUUID()}`,
          paymentChannel: 'EFT',
          paymentDate: '2026-10-28',
          totalRemittedAmount: '10.00',
        },
      });
      await expect(
        reconcilePrivateRemittance({
          ...actorA,
          remittanceId: guardedAdvice.id,
          input: { allocations: [{ claimId: splitClaim.id, remittedAmount: '10.00' }] },
        }),
      ).rejects.toMatchObject({ code: 'CLAIM_DISPATCH_REVIEW_REQUIRED' });

      // 8. Remittance Import & Transactional Additive Reconciliation
      const remittance = await importPrivateRemittance({
        ...actorA,
        input: {
          payerCode: 'BRITAM',
          payerRemittanceRef: `BRITAM-EFT-20261028-${actorA.facilityId}`,
          paymentChannel: 'EFT',
          paymentDate: '2026-10-28',
          totalRemittedAmount: '2500.00',
        },
      });

      await expect(
        reconcilePrivateRemittance({
          ...actorA,
          remittanceId: remittance.id,
          input: {
            allocations: [
              { claimId: britamClaim.id, remittedAmount: '2500.00', postToInvoice: true },
            ],
          },
        }),
      ).rejects.toThrow(/record the receipt through billing first/i);

      const reconciled = await reconcilePrivateRemittance({
        ...actorA,
        remittanceId: remittance.id,
        input: {
          allocations: [
            {
              claimId: britamClaim.id,
              approvedAmount: '2500.00',
              remittedAmount: '2500.00',
            },
          ],
        },
      });
      expect(reconciled.remittance.status).toBe('RECONCILED');

      const finalClaim = await getPrivateInsuranceClaimById({
        tenantId: actorA.tenantId,
        facilityId: actorA.facilityId,
        claimId: britamClaim.id,
      });
      expect(finalClaim.status).toBe('SUBMITTED');
      expect(finalClaim.paidAmount).toBe('0.00');
      // Advice alone is not evidence of receipt and cannot change an invoice.
      expect(finalClaim.originalInvoice.paidAmount).toBe('0.00');
      expect(finalClaim.originalInvoice.balanceAmount).toBe('3000.00');

      const register = await getPrivateReconciliationRegister({
        tenantId: actorA.tenantId,
        facilityId: actorA.facilityId,
        payerCode: 'BRITAM',
      });
      expect(register.summary.entriesCount).toBe(1);
      expect(register.summary.totalRemittedAmount).toBe('2500.00');

      // Synthetic payer decision and independently recorded billing receipt.
      // Two concurrent attempts cannot allocate the same advice/payment twice.
      await recordPrivateClaimDecision({
        ...actorA,
        claimId: britamClaim.id,
        input: {
          status: 'ADJUDICATED',
          approvedAmount: '2500.00',
          externalClaimReference: 'SYNTHETIC-DECISION-001',
        },
      });
      const reference = `SYNTHETIC-EFT-${actorA.facilityId}`;
      const receipt = await recordSettledPayment(
        {
          userId: actorA.actorUserId,
          tenantId: actorA.tenantId,
          facilityId: actorA.facilityId,
          roles: ['BILLING_CLERK'],
          permissions: ['billing.payments.record'],
          isSuperAdmin: false,
        },
        {
          invoiceId: invoiceBritamId,
          amount: '2500.00',
          paymentMethod: 'Insurance - BRITAM',
          referenceCode: reference,
        },
        'Synthetic cashier',
      );
      const patientReceipt = await recordSettledPayment(
        paymentCtx,
        {
          invoiceId: invoiceBritamId,
          amount: '100.00',
          paymentMethod: 'Insurance - BRITAM',
          referenceCode: `PATIENT-${actorA.facilityId}`,
          payerParty: 'PATIENT',
        },
        'Synthetic cashier',
      );
      await expect(
        db.transaction((tx) =>
          matchRecordedPayerPayment(tx, {
            paymentId: patientReceipt.payment.id,
            invoiceId: invoiceBritamId,
            payerCode: 'BRITAM',
            remittanceReference: `PATIENT-${actorA.facilityId}`,
            bankReference: null,
            amountCents: 10000,
          }),
        ),
      ).rejects.toMatchObject({ code: 'PAYMENT_PARTY_MISMATCH' });
      const secondAdvice = await importPrivateRemittance({
        ...actorA,
        input: {
          payerCode: 'BRITAM',
          payerRemittanceRef: reference,
          paymentChannel: 'EFT',
          paymentDate: '2026-10-28',
          totalRemittedAmount: '2500.00',
        },
      });
      const match = () =>
        reconcilePrivateRemittance({
          ...actorA,
          remittanceId: secondAdvice.id,
          input: {
            allocations: [
              {
                claimId: britamClaim.id,
                remittedAmount: '2500.00',
                billingPaymentId: receipt.payment.id,
              },
            ],
          },
        });
      const attempts = await Promise.allSettled([match(), match()]);
      expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
      expect(attempts.filter((a) => a.status === 'rejected')).toHaveLength(1);
      const matchedClaim = await getPrivateInsuranceClaimById({
        tenantId: actorA.tenantId,
        facilityId: actorA.facilityId,
        claimId: britamClaim.id,
      });
      expect(matchedClaim.status).toBe('PAID');
      expect(matchedClaim.paidAmount).toBe('2500.00');
      expect(matchedClaim.originalInvoice.balanceAmount).toBe('400.00');

      // 9. Cross-tenant & cross-facility isolation check: Tenant B cannot see or load Tenant A records
      const membersB = await listInsuranceMembers({
        tenantId: actorB.tenantId,
        facilityId: actorB.facilityId,
      });
      expect(membersB).toHaveLength(0);

      await expect(
        getPrivateInsuranceClaimById({
          tenantId: actorB.tenantId,
          facilityId: actorB.facilityId,
          claimId: britamClaim.id,
        }),
      ).rejects.toThrow();
    });
  },
);
