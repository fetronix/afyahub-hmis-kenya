/**
 * JaliCare HMIS
 * SHA Benefits & Service Coverage Validation Service
 *
 * Distinct from membership eligibility: an active SHA beneficiary may still
 * require preauthorization, a higher KEPH facility level, referral notes,
 * or face scheme exclusions/limits for a specific service or medicine.
 *
 * Never treats unmapped JaliCare tariffs or unapproved (`DRAFT`) local rules
 * as SHA-covered, and never promises reimbursement.
 */

import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { parseCalendarDate } from '../../dashboard/date-range.ts';
import {
  defaultShaGatewayAdapter,
  type PayerGatewayAdapter,
} from '../../integrations/sha/sha.adapter.ts';
import { isPomsfSchemeCode } from '../../integrations/sha/sha.fhir.ts';
import { getFacilityPayerConfig } from './configuration.service.ts';
import {
  formatCents,
  InsuranceDomainError,
  isDateWithinWindow,
  loadScopedFacility,
  loadTenantPatient,
  multiplyMoneyCents,
  parseFacilityLevelRank,
  recordInsuranceAuditEvent,
  requireMoneyCents,
  requireRecordedMoneyCents,
  type BenefitDecision,
  type InsuranceActorScope,
} from './contracts.ts';

export interface ValidateServiceBenefitInput {
  patientId: number;
  encounterId?: number | null;
  eligibilityVerificationId?: number | null;
  payerCode?: string;
  tariffId?: number | null;
  localCode?: string | null;
  serviceDescription?: string | null;
  serviceCategory?: string | null;
  benefitPackage?: string | null;
  serviceDate?: string;
  quantity?: number;
  facilityUnitAmount?: string | number | null;
  preauthReference?: string | null;
  hasReferralOverride?: boolean;
  hasClinicalNotesOverride?: boolean;
}

export async function validateServiceBenefits(
  scope: InsuranceActorScope,
  input: ValidateServiceBenefitInput,
) {
  const facility = await loadScopedFacility(scope);
  const patient = await loadTenantPatient(scope.tenantId, input.patientId, scope.facilityId);
  const payerCode = (input.payerCode ?? 'SHA').trim().toUpperCase();
  const serviceDate = (input.serviceDate ?? new Date().toISOString().slice(0, 10)).trim();
  const quantity = input.quantity ?? 1;

  if (!parseCalendarDate(serviceDate)) {
    throw new InsuranceDomainError(
      'INVALID_SERVICE_DATE',
      'serviceDate must be a valid calendar date formatted as YYYY-MM-DD.',
      400,
    );
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new InsuranceDomainError('INVALID_QUANTITY', 'quantity must be a positive integer.', 400);
  }

  const { config: payerConfig } = await getFacilityPayerConfig(scope, payerCode);

  // 1. Inspect optional clinical encounter for notes, diagnoses & referral evidence
  let encounter: typeof schema.encounters.$inferSelect | null = null;
  let hasClinicalNotes = Boolean(input.hasClinicalNotesOverride);
  let hasReferral = Boolean(input.hasReferralOverride);
  let hasCodedDiagnosis = false;

  if (input.encounterId !== undefined && input.encounterId !== null) {
    const [enc] = await db
      .select()
      .from(schema.encounters)
      .where(
        and(
          eq(schema.encounters.id, input.encounterId),
          eq(schema.encounters.tenantId, scope.tenantId),
          eq(schema.encounters.facilityId, scope.facilityId),
          eq(schema.encounters.patientId, patient.id),
        ),
      )
      .limit(1);

    if (!enc) {
      throw new InsuranceDomainError(
        'ENCOUNTER_NOT_FOUND',
        'Encounter not found for this patient at the active facility.',
        404,
      );
    }
    encounter = enc;
    if (
      (enc.clinicalNotes && enc.clinicalNotes.trim().length > 0) ||
      (enc.chiefComplaint && enc.chiefComplaint.trim().length > 0)
    ) {
      hasClinicalNotes = true;
    }
    if (enc.referralFacility && enc.referralFacility.trim().length > 0) {
      hasReferral = true;
    }

    const encDiagnoses = await db
      .select()
      .from(schema.diagnoses)
      .where(
        and(eq(schema.diagnoses.encounterId, enc.id), eq(schema.diagnoses.patientId, patient.id)),
      )
      .limit(5);
    hasCodedDiagnosis = encDiagnoses.some((diagnosis) => {
      const code =
        diagnosis.codingSystem === 'ICD-11'
          ? diagnosis.icd11Code
          : diagnosis.codingSystem === 'ICD-10'
            ? diagnosis.icd10Code
            : null;
      const display =
        diagnosis.codingSystem === 'ICD-11'
          ? diagnosis.icd11Title
          : diagnosis.codingSystem === 'ICD-10'
            ? diagnosis.icd10Description
            : null;
      const type = diagnosis.diagnosisType?.trim().toLowerCase();
      return Boolean(
        code?.trim() && display?.trim() && ['primary', 'secondary'].includes(type ?? ''),
      );
    });
    if (hasCodedDiagnosis) hasClinicalNotes = true;
  }

  // 2. Resolve JaliCare facility tariff (without modifying it)
  let tariff: typeof schema.facilityServiceTariffs.$inferSelect | null = null;
  if (input.tariffId !== undefined && input.tariffId !== null) {
    const [found] = await db
      .select()
      .from(schema.facilityServiceTariffs)
      .where(
        and(
          eq(schema.facilityServiceTariffs.id, input.tariffId),
          eq(schema.facilityServiceTariffs.tenantId, scope.tenantId),
          eq(schema.facilityServiceTariffs.facilityId, scope.facilityId),
        ),
      )
      .limit(1);

    if (!found) {
      throw new InsuranceDomainError(
        'TARIFF_NOT_FOUND',
        'Selected facility tariff does not exist in this facility.',
        404,
      );
    }
    tariff = found;
  }

  const localCode = input.localCode?.trim() || tariff?.code || null;
  const serviceDescription =
    input.serviceDescription?.trim() || tariff?.description || localCode || '';
  const serviceCategory = (
    input.serviceCategory?.trim() ||
    tariff?.department ||
    'OPD'
  ).toUpperCase();

  if (!serviceDescription) {
    throw new InsuranceDomainError(
      'MISSING_SERVICE_DESCRIPTION',
      'Select a JaliCare facility tariff or provide a service description.',
      400,
    );
  }

  const unitFacilityCents =
    input.facilityUnitAmount !== undefined &&
    input.facilityUnitAmount !== null &&
    input.facilityUnitAmount !== ''
      ? requireMoneyCents(input.facilityUnitAmount, 'facilityUnitAmount')
      : tariff
        ? requireMoneyCents(tariff.fee, 'tariff.fee')
        : requireRecordedMoneyCents(null);
  const totalFacilityCents = multiplyMoneyCents(unitFacilityCents, quantity);

  // 3. Resolve latest or specified eligibility verification
  let eligibility: typeof schema.insuranceEligibilityVerifications.$inferSelect | null = null;
  if (input.eligibilityVerificationId) {
    const [ver] = await db
      .select()
      .from(schema.insuranceEligibilityVerifications)
      .where(
        and(
          eq(schema.insuranceEligibilityVerifications.id, input.eligibilityVerificationId),
          eq(schema.insuranceEligibilityVerifications.tenantId, scope.tenantId),
          eq(schema.insuranceEligibilityVerifications.facilityId, scope.facilityId),
          eq(schema.insuranceEligibilityVerifications.patientId, patient.id),
          eq(schema.insuranceEligibilityVerifications.payerCode, payerCode),
        ),
      )
      .limit(1);
    if (!ver)
      throw new InsuranceDomainError(
        'ELIGIBILITY_NOT_FOUND',
        'Eligibility record does not belong to this patient, payer, and facility.',
        404,
      );
    eligibility = ver;
  } else {
    const [latest] = await db
      .select()
      .from(schema.insuranceEligibilityVerifications)
      .where(
        and(
          eq(schema.insuranceEligibilityVerifications.tenantId, scope.tenantId),
          eq(schema.insuranceEligibilityVerifications.facilityId, scope.facilityId),
          eq(schema.insuranceEligibilityVerifications.patientId, patient.id),
          eq(schema.insuranceEligibilityVerifications.payerCode, payerCode),
        ),
      )
      .orderBy(desc(schema.insuranceEligibilityVerifications.checkedAt))
      .limit(1);
    eligibility = latest ?? null;
  }

  // 4. Resolve explicit payer service-code mapping
  const allFacilityMappings = await db
    .select()
    .from(schema.payerServiceCodeMappings)
    .where(
      and(
        eq(schema.payerServiceCodeMappings.tenantId, scope.tenantId),
        eq(schema.payerServiceCodeMappings.facilityId, scope.facilityId),
        eq(schema.payerServiceCodeMappings.payerCode, payerCode),
        eq(schema.payerServiceCodeMappings.isActive, true),
      ),
    );

  const mapping =
    allFacilityMappings.find((m) => tariff && m.tariffId === tariff.id) ??
    (localCode ? allFacilityMappings.find((m) => m.localCode === localCode) : undefined) ??
    null;

  const effectiveBenefitPackage = (
    input.benefitPackage?.trim() ||
    mapping?.fund ||
    eligibility?.schemes?.[0] ||
    ''
  ).toUpperCase();
  if (!effectiveBenefitPackage)
    throw new InsuranceDomainError(
      'SCHEME_REQUIRED',
      'Select the actual payer scheme for this benefit validation.',
      400,
    );

  // 5. Resolve matching benefit rules (distinguishing APPROVED vs unverified DRAFT!)
  const allRules = await db
    .select()
    .from(schema.payerBenefitRules)
    .where(
      and(
        eq(schema.payerBenefitRules.tenantId, scope.tenantId),
        eq(schema.payerBenefitRules.facilityId, scope.facilityId),
        eq(schema.payerBenefitRules.payerCode, payerCode),
      ),
    )
    .orderBy(desc(schema.payerBenefitRules.version));

  const matchingActiveRules = allRules.filter(
    (r) =>
      r.status === 'APPROVED' &&
      r.benefitPackage === effectiveBenefitPackage &&
      isDateWithinWindow(serviceDate, r.effectiveFrom, r.effectiveTo) &&
      ((mapping && r.payerServiceCode === mapping.payerServiceCode) ||
        (!r.payerServiceCode &&
          (r.serviceCategory === serviceCategory || r.serviceCategory === mapping?.serviceArea))),
  );

  // Prefer specific payerServiceCode rule over category-level rule
  const approvedRule =
    matchingActiveRules.find((r) => mapping && r.payerServiceCode === mapping.payerServiceCode) ??
    matchingActiveRules[0] ??
    null;

  const matchingDraftRule = !approvedRule
    ? (allRules.find(
        (r) =>
          r.status === 'DRAFT' &&
          r.benefitPackage === effectiveBenefitPackage &&
          ((mapping && r.payerServiceCode === mapping.payerServiceCode) ||
            r.serviceCategory === serviceCategory ||
            r.serviceCategory === mapping?.serviceArea),
      ) ?? null)
    : null;

  // 6. Evaluate coverage decision strictly without guessing
  let decision: BenefitDecision = 'UNABLE_TO_VERIFY';
  let verificationSource = 'UNVERIFIED';
  const isSimulated = Boolean(eligibility?.isSimulated);
  const missingRequirements: string[] = [];
  let reason = '';
  const requiresPreauth = Boolean(mapping?.requiresPreauth || approvedRule?.requiresPreauth);
  let resolvedPreauthRef = input.preauthReference?.trim() || null;
  let payerTotalCents: number | null = null;
  let copayCents: number | null = null;
  let coveredCents: number | null = null;

  if (eligibility?.isSimulated) {
    decision = 'UNABLE_TO_VERIFY';
    verificationSource = 'SIMULATED_NOT_VERIFIED';
    missingRequirements.push('A non-simulated payer or documented manual eligibility check');
    reason = 'A simulated result cannot verify patient eligibility or coverage.';
  } else if (!eligibility && payerConfig.requireVerifiedEligibility) {
    decision = 'UNABLE_TO_VERIFY';
    verificationSource = 'NO_ELIGIBILITY_VERIFICATION';
    missingRequirements.push('Verified SHA patient eligibility check');
    reason =
      'Patient SHA membership eligibility has not been verified yet. Run SHA Eligibility Check first.';
  } else if (
    eligibility &&
    eligibility.source !== 'AUTHORITATIVE_PAYER' &&
    !eligibility.source.startsWith('MANUAL_VERIFICATION:')
  ) {
    decision = 'UNABLE_TO_VERIFY';
    verificationSource = 'UNVERIFIED_ELIGIBILITY_SOURCE';
    missingRequirements.push('A non-simulated payer or documented manual eligibility check');
    reason = 'The recorded eligibility source does not establish a verified payer or manual check.';
  } else if (
    eligibility &&
    !isDateWithinWindow(serviceDate, eligibility.coverageStartDate, eligibility.coverageEndDate)
  ) {
    decision = 'UNABLE_TO_VERIFY';
    verificationSource = 'ELIGIBILITY_OUTSIDE_RECORDED_WINDOW';
    missingRequirements.push('Eligibility evidence applicable to the service date');
    reason = 'The service date is outside the recorded eligibility coverage dates.';
  } else if (eligibility && eligibility.isAlive === false) {
    decision = 'NOT_COVERED';
    verificationSource = eligibility.source;
    reason =
      'The recorded eligibility evidence marks the beneficiary as deceased; SHA service coverage and billing are blocked.';
  } else if (eligibility && eligibility.outcome === 'Ineligible') {
    decision = 'NOT_COVERED';
    verificationSource = eligibility.source;
    reason = `Patient SHA eligibility outcome is Ineligible (${eligibility.reason ?? 'inactive membership'}).`;
  } else if (
    eligibility &&
    eligibility.outcome !== 'Eligible' &&
    payerConfig.requireVerifiedEligibility
  ) {
    decision = 'UNABLE_TO_VERIFY';
    verificationSource = eligibility.source;
    missingRequirements.push(`Confirmed Eligible SHA status (current: ${eligibility.outcome})`);
    reason = `Benefit coverage cannot be confirmed while SHA membership status is "${eligibility.outcome}".`;
  } else if (
    !mapping ||
    !isDateWithinWindow(serviceDate, mapping.effectiveFrom, mapping.effectiveTo)
  ) {
    decision = 'UNABLE_TO_VERIFY';
    verificationSource = 'UNMAPPED_SERVICE';
    missingRequirements.push('Active SHA payer service-code mapping');
    reason =
      'This JaliCare service/tariff is not mapped to an effective SHA intervention code. Configure a verified SHA mapping before claiming.';
  } else if (!approvedRule) {
    decision = 'UNABLE_TO_VERIFY';
    verificationSource = matchingDraftRule ? 'UNVERIFIED_DRAFT_RULE' : 'NO_APPROVED_RULE';
    missingRequirements.push(
      matchingDraftRule
        ? `Administrator approval for draft rule ${matchingDraftRule.ruleCode} v${matchingDraftRule.version}`
        : `Approved SHA benefit rule for ${effectiveBenefitPackage} / ${mapping.serviceArea}`,
    );
    reason = matchingDraftRule
      ? `Local benefit rule ${matchingDraftRule.ruleCode} v${matchingDraftRule.version} is still in DRAFT (unverified) and cannot be applied until approved by an authorized administrator.`
      : `No approved effective-dated SHA benefit rule exists for package ${effectiveBenefitPackage} and service area ${mapping.serviceArea}.`;
  } else if (!mapping.isPhcZeroTariff && mapping.reimbursementTariff === null) {
    decision = 'UNABLE_TO_VERIFY';
    verificationSource = 'PAYER_RATE_NOT_RECORDED';
    missingRequirements.push('A documented payer reimbursement tariff');
    reason =
      'The payer reimbursement tariff is not recorded; the facility price cannot replace it.';
  } else if (
    !['NONE', 'FIXED', 'PERCENTAGE'].includes(approvedRule.copayType) ||
    (approvedRule.copayType === 'PERCENTAGE' &&
      requireRecordedMoneyCents(approvedRule.copayValue) > 10_000) ||
    requireRecordedMoneyCents(approvedRule.deductibleAmount) !== 0 ||
    requireRecordedMoneyCents(approvedRule.coinsurancePercent) !== 0 ||
    approvedRule.annualLimit !== null
  ) {
    decision = 'UNABLE_TO_VERIFY';
    verificationSource = 'UNSUPPORTED_RULE_FINANCIAL_TERMS';
    missingRequirements.push('Reviewed copay, deductible, coinsurance and annual-limit terms');
    reason =
      'The configured financial terms cannot be calculated safely by this SHA estimate; payer review is required.';
  } else {
    verificationSource = isSimulated
      ? 'APPROVED_FACILITY_RULE_WITH_SIMULATED_ELIGIBILITY'
      : 'APPROVED_FACILITY_RULE_ESTIMATE';

    // Check facility KEPH accreditation level
    const facilityRank = parseFacilityLevelRank(payerConfig.accreditationLevel ?? facility.level);
    const requiredRank = parseFacilityLevelRank(approvedRule.minFacilityLevel);

    if (approvedRule.exclusionNotes && /excluded|not covered/i.test(approvedRule.exclusionNotes)) {
      decision = 'NOT_COVERED';
      reason = `Excluded under ${approvedRule.ruleCode} v${approvedRule.version}: ${approvedRule.exclusionNotes}`;
    } else if (requiredRank !== null && facilityRank !== null && facilityRank < requiredRank) {
      decision = 'NOT_COVERED';
      reason = `Service requires minimum KEPH Level ${requiredRank} accreditation (${approvedRule.minFacilityLevel}); active facility is accredited at Level ${facilityRank}.`;
    } else if (
      !payerConfig.contractedSchemes.some(
        (sc) =>
          sc.toUpperCase() === effectiveBenefitPackage ||
          (isPomsfSchemeCode(effectiveBenefitPackage) && isPomsfSchemeCode(sc)),
      )
    ) {
      decision = 'NOT_COVERED';
      reason = `Facility is not contracted for scheme ${effectiveBenefitPackage} in SHA payer configuration.`;
    } else {
      // Check latest HIE benefit utilization snapshot for exhausted individual/household limits
      const [latestUtil] = await db
        .select()
        .from(schema.shaBenefitUtilizationSnapshots)
        .where(
          and(
            eq(schema.shaBenefitUtilizationSnapshots.tenantId, scope.tenantId),
            eq(schema.shaBenefitUtilizationSnapshots.facilityId, scope.facilityId),
            eq(schema.shaBenefitUtilizationSnapshots.patientId, patient.id),
            eq(schema.shaBenefitUtilizationSnapshots.payerCode, payerCode),
            eq(schema.shaBenefitUtilizationSnapshots.interventionCode, mapping.payerServiceCode),
          ),
        )
        .orderBy(desc(schema.shaBenefitUtilizationSnapshots.checkedAt))
        .limit(1);

      // A mock or unavailable snapshot is not evidence of an exhausted (or
      // available) payer limit. Do not fall back to an older snapshot when the
      // latest one is unverified; the result below remains a local estimate.
      const usableUtil =
        latestUtil && !latestUtil.isSimulated && latestUtil.source === 'AUTHORITATIVE_PAYER'
          ? latestUtil
          : null;
      const indRemCents =
        usableUtil?.individualRemainingLimit !== null &&
        usableUtil?.individualRemainingLimit !== undefined
          ? requireRecordedMoneyCents(usableUtil.individualRemainingLimit)
          : null;
      const hhRemCents =
        usableUtil?.householdRemainingLimit !== null &&
        usableUtil?.householdRemainingLimit !== undefined
          ? requireRecordedMoneyCents(usableUtil.householdRemainingLimit)
          : null;

      if ((indRemCents !== null && indRemCents <= 0) || (hhRemCents !== null && hhRemCents <= 0)) {
        decision = 'NOT_COVERED';
        reason = `SHA benefit utilization limit for ${mapping.payerServiceCode} is exhausted (individual remaining: KES ${usableUtil?.individualRemainingLimit ?? 'not recorded'}, household remaining: KES ${usableUtil?.householdRemainingLimit ?? 'not recorded'}${usableUtil?.nextAvailability ? `, next available: ${usableUtil.nextAvailability}` : ''}).`;
      } else {
        // Compute payer tariff & copay using decimal-safe cents math
        if (mapping.isPhcZeroTariff) {
          payerTotalCents = 0;
        } else {
          const unitPayerCents = requireRecordedMoneyCents(mapping.reimbursementTariff);
          payerTotalCents = multiplyMoneyCents(unitPayerCents, quantity);
        }

        const perVisitLimitCents =
          approvedRule.perVisitLimit !== null
            ? requireRecordedMoneyCents(approvedRule.perVisitLimit)
            : null;
        const cappedBaseCents =
          perVisitLimitCents !== null
            ? Math.min(payerTotalCents, perVisitLimitCents)
            : payerTotalCents;

        const ruleCopayValCents =
          approvedRule.copayType === 'NONE'
            ? 0
            : requireRecordedMoneyCents(approvedRule.copayValue);
        if (approvedRule.copayType === 'FIXED') {
          copayCents = Math.min(cappedBaseCents, ruleCopayValCents);
        } else if (approvedRule.copayType === 'PERCENTAGE') {
          // ruleCopayValCents is percentage * 100 (e.g., 10.00% -> 1000)
          copayCents = Math.round((cappedBaseCents * ruleCopayValCents) / 10_000);
        } else {
          copayCents = 0;
        }
        coveredCents = Math.max(0, cappedBaseCents - copayCents);

        // Check clinical documentation & referral requirements
        const needReferral = Boolean(mapping.requiresReferral || approvedRule.requiresReferral);
        const needNotes = Boolean(mapping.requiresClinicalNotes);

        if (needReferral && !hasReferral) {
          missingRequirements.push('Referral documentation / referring facility record');
        }
        if (needNotes && !hasClinicalNotes && encounter !== null) {
          missingRequirements.push(
            'Clinical consultation notes or coded ICD-11 diagnosis on encounter',
          );
        }
        if (
          approvedRule.requiredEvidence.includes('DIAGNOSIS') &&
          !hasCodedDiagnosis &&
          encounter !== null
        ) {
          missingRequirements.push('Coded clinical diagnosis on encounter');
        }

        // Check preauthorization requirement
        if (requiresPreauth) {
          let validPreauth: typeof schema.insurancePreauthorizations.$inferSelect | null = null;
          const patientPreauths = await db
            .select()
            .from(schema.insurancePreauthorizations)
            .where(
              and(
                eq(schema.insurancePreauthorizations.tenantId, scope.tenantId),
                eq(schema.insurancePreauthorizations.facilityId, scope.facilityId),
                eq(schema.insurancePreauthorizations.patientId, patient.id),
                eq(schema.insurancePreauthorizations.payerCode, payerCode),
              ),
            )
            .orderBy(desc(schema.insurancePreauthorizations.createdAt));

          for (const pa of patientPreauths) {
            const matchesRef = resolvedPreauthRef
              ? pa.payerAuthReference === resolvedPreauthRef ||
                pa.preauthNumber === resolvedPreauthRef
              : pa.requestedServiceCode === mapping.payerServiceCode;

            if (
              matchesRef &&
              !pa.isSimulated &&
              (pa.source === 'AUTHORITATIVE_PAYER' || pa.source === 'MANUAL_PAYER_DECISION') &&
              Boolean(pa.payerAuthReference?.trim()) &&
              pa.requestedServiceCode === mapping.payerServiceCode &&
              (!pa.encounterId || pa.encounterId === encounter?.id) &&
              // This validation has no invoice input: an invoice-specific
              // authorization cannot be matched without that context.
              !pa.invoiceId &&
              (pa.status === 'APPROVED' || pa.status === 'PARTIALLY_APPROVED') &&
              isDateWithinWindow(serviceDate, pa.validFrom, pa.validUntil)
            ) {
              validPreauth = pa;
              resolvedPreauthRef = pa.payerAuthReference ?? pa.preauthNumber;
              break;
            }
          }

          if (!validPreauth) {
            missingRequirements.push(
              `Approved SHA preauthorization for ${mapping.payerServiceCode} (${mapping.payerServiceName})`,
            );
            decision = 'AUTHORIZATION_REQUIRED';
            reason = `Service ${mapping.payerServiceCode} (${mapping.payerServiceName}) requires active SHA preauthorization under rule ${approvedRule.ruleCode} v${approvedRule.version}.`;
          } else if (missingRequirements.length > 0) {
            decision = 'INCOMPLETE_INFORMATION';
            reason = `Preauthorization ${resolvedPreauthRef} found, but required clinical/referral documentation is incomplete: ${missingRequirements.join('; ')}.`;
          } else {
            decision = 'COVERED';
            reason = `Covered under approved rule ${approvedRule.ruleCode} v${approvedRule.version} (${approvedRule.sourceReference}) with preauthorization ${resolvedPreauthRef}. Subject to final SHA claim adjudication.`;
          }
        } else if (missingRequirements.length > 0) {
          decision = 'INCOMPLETE_INFORMATION';
          reason = `Benefit validation requires additional clinical/referral evidence: ${missingRequirements.join('; ')}.`;
        } else {
          decision = 'COVERED';
          reason = mapping.isPhcZeroTariff
            ? `Covered under Primary Healthcare (${effectiveBenefitPackage}) zero-tariff schedule (${approvedRule.ruleCode} v${approvedRule.version}). Subject to SHA adjudication.`
            : `Covered under approved rule ${approvedRule.ruleCode} v${approvedRule.version} (${approvedRule.sourceReference}). Estimates do not guarantee reimbursement until final SHA adjudication.`;
        }
      }
    }
  }

  const [saved] = await db
    .insert(schema.insuranceBenefitValidations)
    .values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      patientId: patient.id,
      encounterId: encounter?.id ?? null,
      eligibilityVerificationId: eligibility?.id ?? null,
      payerCode,
      tariffId: tariff?.id ?? null,
      mappingId: mapping?.id ?? null,
      benefitRuleId: approvedRule?.id ?? null,
      ruleVersion: approvedRule?.version ?? null,
      serviceDescription,
      serviceCategory,
      payerServiceCode: mapping?.payerServiceCode ?? null,
      benefitPackage: effectiveBenefitPackage,
      serviceDate,
      quantity,
      facilityTariffAmount: formatCents(totalFacilityCents),
      payerTariffAmount: payerTotalCents !== null ? formatCents(payerTotalCents) : null,
      // SHA deductible calculation is not implemented; do not imply none.
      deductibleEstimate: null,
      estimatedCopayAmount: copayCents !== null ? formatCents(copayCents) : null,
      estimatedCoveredAmount: coveredCents !== null ? formatCents(coveredCents) : null,
      decision,
      verificationSource,
      isSimulated,
      requiresPreauth,
      preauthReference: resolvedPreauthRef,
      hasReferral,
      hasClinicalNotes,
      missingRequirements,
      reason,
      validatedByUserId: scope.userId,
    })
    .returning();

  await recordInsuranceAuditEvent(scope, {
    action: 'SHA_BENEFITS_VALIDATED',
    resource: 'insurance_benefit_validations',
    resourceId: saved.id,
    summary: {
      patientId: patient.id,
      encounterId: encounter?.id ?? null,
      payerServiceCode: saved.payerServiceCode,
      benefitPackage: saved.benefitPackage,
      decision: saved.decision,
      verificationSource: saved.verificationSource,
      ruleId: saved.benefitRuleId,
      ruleVersion: saved.ruleVersion,
    },
  });

  return {
    validation: saved,
    advisoryDisclaimer:
      'This is a local estimate from recorded evidence and facility rules; it does not itself verify eligibility or confirm coverage, adjudication or payment. Review the decision and evidence source.',
  };
}

export async function getPatientBenefitsSummary(
  scope: Pick<InsuranceActorScope, 'tenantId' | 'facilityId'>,
  patientId: number,
  payerCode = 'SHA',
) {
  await loadScopedFacility(scope);
  const patient = await loadTenantPatient(scope.tenantId, patientId, scope.facilityId);
  const { config: payerConfig } = await getFacilityPayerConfig(scope, payerCode);

  const [latestEligibility] = await db
    .select()
    .from(schema.insuranceEligibilityVerifications)
    .where(
      and(
        eq(schema.insuranceEligibilityVerifications.tenantId, scope.tenantId),
        eq(schema.insuranceEligibilityVerifications.facilityId, scope.facilityId),
        eq(schema.insuranceEligibilityVerifications.patientId, patient.id),
        eq(schema.insuranceEligibilityVerifications.payerCode, payerCode),
      ),
    )
    .orderBy(desc(schema.insuranceEligibilityVerifications.checkedAt))
    .limit(1);

  const validations = await db
    .select()
    .from(schema.insuranceBenefitValidations)
    .where(
      and(
        eq(schema.insuranceBenefitValidations.tenantId, scope.tenantId),
        eq(schema.insuranceBenefitValidations.facilityId, scope.facilityId),
        eq(schema.insuranceBenefitValidations.patientId, patient.id),
        eq(schema.insuranceBenefitValidations.payerCode, payerCode),
      ),
    )
    .orderBy(desc(schema.insuranceBenefitValidations.validatedAt))
    .limit(30);

  const activeApprovedRules = await db
    .select()
    .from(schema.payerBenefitRules)
    .where(
      and(
        eq(schema.payerBenefitRules.tenantId, scope.tenantId),
        eq(schema.payerBenefitRules.facilityId, scope.facilityId),
        eq(schema.payerBenefitRules.payerCode, payerCode),
        eq(schema.payerBenefitRules.status, 'APPROVED'),
      ),
    );

  const utilizationSnapshots = await db
    .select()
    .from(schema.shaBenefitUtilizationSnapshots)
    .where(
      and(
        eq(schema.shaBenefitUtilizationSnapshots.tenantId, scope.tenantId),
        eq(schema.shaBenefitUtilizationSnapshots.facilityId, scope.facilityId),
        eq(schema.shaBenefitUtilizationSnapshots.patientId, patient.id),
        eq(schema.shaBenefitUtilizationSnapshots.payerCode, payerCode),
      ),
    )
    .orderBy(desc(schema.shaBenefitUtilizationSnapshots.checkedAt))
    .limit(20);

  return {
    patient: {
      id: patient.id,
      mrn: patient.mrn,
      fullName: [patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(' '),
      dhaClientRegistryId: patient.dhaClientRegistryId ?? null,
    },
    facilityContractedSchemes: payerConfig.contractedSchemes,
    facilityAccreditationLevel: payerConfig.accreditationLevel,
    latestEligibility: latestEligibility ?? null,
    approvedBenefitRulesCount: activeApprovedRules.length,
    // Older rows stored default zero even where no estimate was possible. Do
    // not rewrite that history, or expose the ambiguous default as evidence.
    recentValidations: validations.map((validation) => ({
      ...validation,
      deductibleEstimate: null,
      estimatedCopayAmount:
        validation.estimatedCoveredAmount === null ? null : validation.estimatedCopayAmount,
    })),
    recentUtilizationSnapshots: utilizationSnapshots,
  };
}

export interface LookupHieCoverageAndUtilizationInput {
  patientId: number;
  memberCrNumber?: string | null;
  parentBenefitCode?: string | null;
  subBenefitCode?: string | null;
  interventionCode?: string | null;
  accessPoint?: string | null;
  search?: string | null;
  includePomsfBalances?: boolean;
  includeBedOccupancy?: boolean;
}

/**
 * Workflows 2 & 3: Queries DHA HIE `/patients/benefits`, `/patients/sub-benefits`,
 * `/patients/benefits/interventions`, `/patients/benefits/utilization`, `/patients/pomsf-balances`,
 * and `/facilities/{facilityCode}/beds/occupancy`, persisting auditable utilization snapshots.
 */
export async function lookupPatientHieCoverageAndUtilization(
  scope: InsuranceActorScope,
  input: LookupHieCoverageAndUtilizationInput,
  adapter: PayerGatewayAdapter = defaultShaGatewayAdapter,
) {
  await loadScopedFacility(scope);
  const patient = await loadTenantPatient(scope.tenantId, input.patientId, scope.facilityId);
  const { config: payerConfig } = await getFacilityPayerConfig(scope, 'SHA');

  const [latestEligibility] = await db
    .select()
    .from(schema.insuranceEligibilityVerifications)
    .where(
      and(
        eq(schema.insuranceEligibilityVerifications.tenantId, scope.tenantId),
        eq(schema.insuranceEligibilityVerifications.facilityId, scope.facilityId),
        eq(schema.insuranceEligibilityVerifications.patientId, patient.id),
        eq(schema.insuranceEligibilityVerifications.payerCode, 'SHA'),
      ),
    )
    .orderBy(desc(schema.insuranceEligibilityVerifications.checkedAt))
    .limit(1);

  if (latestEligibility?.isAlive === false) {
    throw new InsuranceDomainError(
      'PATIENT_DECEASED_BLOCK',
      'Beneficiary is marked deceased in DHA Client Registry (isAlive=false); benefit and utilization queries for billing are blocked.',
      409,
    );
  }

  if (
    input.memberCrNumber?.trim() &&
    input.memberCrNumber.trim() !== patient.dhaClientRegistryId?.trim() &&
    input.memberCrNumber.trim() !== latestEligibility?.memberCrNumber?.trim()
  )
    throw new InsuranceDomainError(
      'IDENTIFIER_PATIENT_MISMATCH',
      'Client Registry ID does not belong to the selected patient.',
      400,
    );

  const crNumber =
    input.memberCrNumber?.trim() ||
    latestEligibility?.memberCrNumber?.trim() ||
    patient.dhaClientRegistryId?.trim() ||
    null;

  if (!crNumber) {
    throw new InsuranceDomainError(
      'MISSING_CLIENT_REGISTRY_ID',
      'Beneficiary Client Registry ID (CR ID) is mandatory for HIE Benefits, Intervention Matrix, and Utilization queries. Run Client Registry Search or SHA Eligibility Check first.',
      400,
    );
  }

  const coverageResult = adapter.fetchPatientBenefitsAndInterventions
    ? await adapter.fetchPatientBenefitsAndInterventions({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        actorUserId: scope.userId,
        facilityRegistryOverride: payerConfig.facilityRegistryCode,
        memberCrNumber: crNumber,
        parentBenefitCode: input.parentBenefitCode ?? null,
        subBenefitCode: input.subBenefitCode ?? null,
        interventionCode: input.interventionCode ?? null,
        accessPoint: input.accessPoint ?? null,
        search: input.search ?? null,
      })
    : null;

  const targetInterventionCode =
    input.interventionCode?.trim().toUpperCase() || coverageResult?.interventions[0]?.code || null;

  const hasPomsf =
    Boolean(input.includePomsfBalances) ||
    Boolean(latestEligibility?.schemes?.some((sc) => isPomsfSchemeCode(sc)));

  const utilizationResult =
    targetInterventionCode && adapter.fetchBenefitUtilizationAndBalances
      ? await adapter.fetchBenefitUtilizationAndBalances({
          tenantId: scope.tenantId,
          facilityId: scope.facilityId,
          actorUserId: scope.userId,
          facilityRegistryOverride: payerConfig.facilityRegistryCode,
          memberCrNumber: crNumber,
          interventionCode: targetInterventionCode,
          includePomsfBalances: hasPomsf,
          includeBedOccupancy: Boolean(input.includeBedOccupancy),
        })
      : null;

  let savedSnapshot: typeof schema.shaBenefitUtilizationSnapshots.$inferSelect | null = null;
  if (coverageResult?.reachable || utilizationResult?.reachable) {
    const matchedIntervention =
      coverageResult?.interventions.find((i) => i.code === targetInterventionCode) ??
      coverageResult?.interventions[0] ??
      null;
    const matchedUtil =
      utilizationResult?.utilization.find((u) => u.code === targetInterventionCode) ??
      utilizationResult?.utilization[0] ??
      null;
    const pomsfRem = utilizationResult?.pomsfBalances[0]?.remainingBalanceKes ?? null;

    [savedSnapshot] = await db
      .insert(schema.shaBenefitUtilizationSnapshots)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        patientId: patient.id,
        payerCode: 'SHA',
        memberCrNumber: crNumber,
        interventionCode: targetInterventionCode,
        subBenefitCode: input.subBenefitCode?.trim() || null,
        benefitPackage: matchedIntervention?.fund ?? null,
        limitScope: matchedUtil?.limitScope ?? null,
        individualMaxLimit: matchedUtil?.individualMaxLimitKes ?? null,
        individualUtilisedLimit: matchedUtil?.individualUtilisedLimitKes ?? null,
        individualRemainingLimit: matchedUtil?.individualRemainingLimitKes ?? null,
        householdMaxLimit: matchedUtil?.householdMaxLimitKes ?? null,
        householdUtilisedLimit: matchedUtil?.householdUtilisedLimitKes ?? null,
        householdRemainingLimit: matchedUtil?.householdRemainingLimitKes ?? null,
        pomsfBalance: pomsfRem,
        overallTariff: matchedIntervention?.overallTariff ?? null,
        needsPreauth: matchedIntervention?.needsPreauth ?? null,
        needsManualPreauthApproval: matchedIntervention?.needsManualPreauthApproval ?? null,
        needsDoctorAuthorization: matchedIntervention?.needsDoctorAuthorization ?? null,
        specialistPreauthFlags: matchedIntervention
          ? { ...matchedIntervention.specialistFlags }
          : {},
        utilizationDays: matchedUtil?.utilizationDays ?? null,
        nextAvailability: matchedUtil?.nextAvailability ?? null,
        source: coverageResult?.source ?? utilizationResult?.source ?? 'UNAVAILABLE',
        isSimulated: Boolean(coverageResult?.isSimulated || utilizationResult?.isSimulated),
        correlationId: coverageResult?.correlationId ?? utilizationResult?.correlationId ?? null,
        checkedByUserId: scope.userId,
      })
      .returning();
  }

  await recordInsuranceAuditEvent(scope, {
    action: 'SHA_HIE_BENEFITS_UTILIZATION_CHECKED',
    resource: 'sha_benefit_utilization_snapshots',
    resourceId: savedSnapshot?.id ?? patient.id,
    summary: {
      patientId: patient.id,
      interventionCode: targetInterventionCode,
      reachable: Boolean(coverageResult?.reachable || utilizationResult?.reachable),
      isSimulated: Boolean(coverageResult?.isSimulated || utilizationResult?.isSimulated),
    },
  });

  return {
    memberCrNumber: crNumber,
    coverage: coverageResult,
    utilization: utilizationResult,
    snapshot: savedSnapshot,
  };
}
