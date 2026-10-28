/**
 * JaliCare HMIS — Private Insurance Benefits, Limits & Copayments Engine
 *
 * Evaluates insurer-specific benefit categories, service limits, exclusions,
 * deductibles, copayments, coinsurance, and preauthorization rules without
 * assuming Britam and PACIS share tariffs, rules, or exclusions.
 *
 * Configured estimates are ALWAYS labelled as estimates, never guaranteed
 * reimbursement or payer-approved claim decisions.
 */

import { and, desc, eq, ne } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { findFacilityPatient } from '../hub/patient-scope.ts';
import * as schema from '../../db/schema.ts';
import { formatCents } from '../../billing/settlement.ts';
import {
  computeBenefitFinancialsCents,
  inferPrivateServiceCategory,
  moneyToCentsStrict,
  PrivateInsuranceError,
  type PrivateBenefitDecision,
} from '../core/types.ts';
import { recordPrivateInsuranceAudit } from '../audit/diagnostics.service.ts';
import { isEffectiveOnDate } from '../mappings/mappings.service.ts';
import { getPayerRowScoped } from '../payers/payer-config.service.ts';

export async function listPayerBenefitRulesAndValidations(params: {
  tenantId: number;
  facilityId: number;
  payerCode?: string;
  patientId?: number;
}) {
  const ruleConditions = [
    eq(schema.payerBenefitRules.tenantId, params.tenantId),
    eq(schema.payerBenefitRules.facilityId, params.facilityId),
  ];
  const valConditions = [
    eq(schema.insuranceBenefitValidations.tenantId, params.tenantId),
    eq(schema.insuranceBenefitValidations.facilityId, params.facilityId),
  ];

  if (params.payerCode) {
    const code = params.payerCode.trim().toUpperCase();
    ruleConditions.push(eq(schema.payerBenefitRules.payerCode, code));
    valConditions.push(eq(schema.insuranceBenefitValidations.payerCode, code));
  } else {
    ruleConditions.push(ne(schema.payerBenefitRules.payerCode, 'SHA'));
    valConditions.push(ne(schema.insuranceBenefitValidations.payerCode, 'SHA'));
  }

  if (params.patientId) {
    valConditions.push(eq(schema.insuranceBenefitValidations.patientId, params.patientId));
  }

  const [rules, validations] = await Promise.all([
    db
      .select()
      .from(schema.payerBenefitRules)
      .where(and(...ruleConditions))
      .orderBy(desc(schema.payerBenefitRules.updatedAt)),
    db
      .select()
      .from(schema.insuranceBenefitValidations)
      .where(and(...valConditions))
      .orderBy(desc(schema.insuranceBenefitValidations.validatedAt))
      .limit(100),
  ]);

  return { rules, validations };
}

export async function createOrApprovePayerBenefitRule(params: {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  input: Record<string, unknown>;
}) {
  const payerCode = String(params.input.payerCode ?? '')
    .trim()
    .toUpperCase();
  if (!payerCode) {
    throw new PrivateInsuranceError('PAYER_CODE_REQUIRED', 'payerCode is required.', 400);
  }
  const payerRow = await getPayerRowScoped({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    payerCode,
  });

  const ruleCode = String(params.input.ruleCode ?? '')
    .trim()
    .toUpperCase();
  const benefitPackage = String(params.input.benefitPackage ?? '').trim();
  const serviceCategory = String(params.input.serviceCategory ?? '')
    .trim()
    .toUpperCase();
  const sourceReference = String(params.input.sourceReference ?? '').trim();
  const effectiveFrom =
    typeof params.input.effectiveFrom === 'string' ? params.input.effectiveFrom.trim() : '';
  const financialTerms = ['copayType', 'copayValue', 'deductibleAmount', 'coinsurancePercent'];
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) ||
    financialTerms.some(
      (key) =>
        params.input[key] === null ||
        params.input[key] === undefined ||
        String(params.input[key]).trim() === '',
    )
  )
    throw new PrivateInsuranceError(
      'BENEFIT_TERMS_REQUIRED',
      'Enter the actual effective date and each contracted financial term; use zero only where the contract specifies none.',
      400,
    );

  if (!ruleCode || !benefitPackage || !serviceCategory || !sourceReference) {
    throw new PrivateInsuranceError(
      'BENEFIT_RULE_FIELDS_REQUIRED',
      'ruleCode, benefitPackage, serviceCategory, and sourceReference (insurer policy/schedule document ref) are required.',
      400,
    );
  }

  const copayType = String(params.input.copayType ?? '')
    .trim()
    .toUpperCase();
  if (!['NONE', 'FIXED', 'PERCENTAGE'].includes(copayType)) {
    throw new PrivateInsuranceError(
      'INVALID_COPAY_TYPE',
      'copayType must be NONE, FIXED, or PERCENTAGE.',
      400,
    );
  }

  const copayValue = formatCents(
    moneyToCentsStrict(params.input.copayValue as string | number | undefined, 'Copay value'),
  );
  const deductibleAmount = formatCents(
    moneyToCentsStrict(
      params.input.deductibleAmount as string | number | undefined,
      'Deductible amount',
    ),
  );
  const coinsurancePercent = formatCents(
    moneyToCentsStrict(
      params.input.coinsurancePercent as string | number | undefined,
      'Coinsurance percentage',
    ),
  );

  const annualLimit =
    params.input.annualLimit !== undefined &&
    params.input.annualLimit !== null &&
    params.input.annualLimit !== ''
      ? formatCents(moneyToCentsStrict(params.input.annualLimit as string | number, 'Annual limit'))
      : null;

  const perVisitLimit =
    params.input.perVisitLimit !== undefined &&
    params.input.perVisitLimit !== null &&
    params.input.perVisitLimit !== ''
      ? formatCents(
          moneyToCentsStrict(params.input.perVisitLimit as string | number, 'Per-visit limit'),
        )
      : null;

  const approveImmediately = Boolean(params.input.approveImmediately);

  const [created] = await db
    .insert(schema.payerBenefitRules)
    .values({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      payerCode: payerRow.payerCode,
      ruleCode,
      version: Number(params.input.version ?? 1),
      benefitPackage,
      serviceCategory,
      payerServiceCode:
        typeof params.input.payerServiceCode === 'string' && params.input.payerServiceCode.trim()
          ? params.input.payerServiceCode.trim()
          : null,
      requiresPreauth: Boolean(params.input.requiresPreauth),
      requiresReferral: Boolean(params.input.requiresReferral),
      requiredEvidence: Array.isArray(params.input.requiredEvidence)
        ? params.input.requiredEvidence.map(String)
        : [],
      copayType,
      copayValue,
      deductibleAmount,
      coinsurancePercent,
      waitingPeriodDays: Math.max(0, Math.trunc(Number(params.input.waitingPeriodDays ?? 0))),
      panelRestrictionNotes:
        typeof params.input.panelRestrictionNotes === 'string'
          ? params.input.panelRestrictionNotes
          : null,
      annualLimit,
      perVisitLimit,
      exclusionNotes:
        typeof params.input.exclusionNotes === 'string' && params.input.exclusionNotes.trim()
          ? params.input.exclusionNotes.trim()
          : null,
      sourceReference,
      status: approveImmediately ? 'APPROVED' : 'DRAFT',
      effectiveFrom,
      effectiveTo:
        typeof params.input.effectiveTo === 'string' && params.input.effectiveTo.trim()
          ? params.input.effectiveTo.trim()
          : null,
      createdByUserId: params.actorUserId,
      approvedByUserId: approveImmediately ? params.actorUserId : null,
      approvedAt: approveImmediately ? new Date() : null,
    })
    .returning();

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_BENEFIT_RULE_CREATED',
    entityType: 'payer_benefit_rule',
    entityId: created.id,
    details: {
      payerCode: created.payerCode,
      ruleCode: created.ruleCode,
      status: created.status,
      sourceReference: created.sourceReference,
    },
  });

  return created;
}

export async function updatePayerBenefitRuleStatus(params: {
  tenantId: number;
  facilityId: number;
  ruleId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  status: 'DRAFT' | 'APPROVED' | 'RETIRED';
}) {
  const [existing] = await db
    .select()
    .from(schema.payerBenefitRules)
    .where(
      and(
        eq(schema.payerBenefitRules.id, params.ruleId),
        eq(schema.payerBenefitRules.tenantId, params.tenantId),
        eq(schema.payerBenefitRules.facilityId, params.facilityId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new PrivateInsuranceError('BENEFIT_RULE_NOT_FOUND', 'Benefit rule not found.', 404);
  }

  const [updated] = await db
    .update(schema.payerBenefitRules)
    .set({
      status: params.status,
      approvedByUserId:
        params.status === 'APPROVED' ? params.actorUserId : existing.approvedByUserId,
      approvedAt: params.status === 'APPROVED' ? new Date() : existing.approvedAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.payerBenefitRules.id, existing.id))
    .returning();

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_BENEFIT_RULE_STATUS_CHANGED',
    entityType: 'payer_benefit_rule',
    entityId: updated.id,
    details: { payerCode: updated.payerCode, ruleCode: updated.ruleCode, status: updated.status },
  });

  return updated;
}

export async function validatePrivateServiceBenefit(params: {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole?: string;
  input: Record<string, unknown>;
}) {
  const patientId = Number(params.input.patientId);
  if (!Number.isInteger(patientId) || patientId <= 0) {
    throw new PrivateInsuranceError('INVALID_PATIENT_ID', 'Valid patientId is required.', 400);
  }

  if (!(await findFacilityPatient(params.tenantId, params.facilityId, patientId)))
    throw new PrivateInsuranceError(
      'PATIENT_NOT_FOUND',
      'Patient is not associated with this facility.',
      404,
    );

  const payerCode = String(params.input.payerCode ?? '')
    .trim()
    .toUpperCase();
  if (!payerCode) {
    throw new PrivateInsuranceError('PAYER_CODE_REQUIRED', 'payerCode is required.', 400);
  }

  const payerRow = await getPayerRowScoped({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    payerCode,
  });

  // Resolve tariff or item details
  let tariff: typeof schema.facilityServiceTariffs.$inferSelect | null = null;
  if (
    params.input.tariffId !== undefined &&
    params.input.tariffId !== null &&
    params.input.tariffId !== ''
  ) {
    const [found] = await db
      .select()
      .from(schema.facilityServiceTariffs)
      .where(
        and(
          eq(schema.facilityServiceTariffs.id, Number(params.input.tariffId)),
          eq(schema.facilityServiceTariffs.tenantId, params.tenantId),
          eq(schema.facilityServiceTariffs.facilityId, params.facilityId),
        ),
      )
      .limit(1);
    if (!found) {
      throw new PrivateInsuranceError(
        'TARIFF_NOT_FOUND',
        'Facility service tariff not found.',
        404,
      );
    }
    tariff = found;
  }

  const jaliCareItemCode = String(params.input.localCode ?? tariff?.code ?? '').trim();
  const serviceDescription = String(
    params.input.serviceDescription ?? tariff?.description ?? '',
  ).trim();
  if (!serviceDescription) {
    throw new PrivateInsuranceError(
      'SERVICE_DESCRIPTION_REQUIRED',
      'Select a JaliCare tariff or provide serviceDescription.',
      400,
    );
  }

  const serviceCategory =
    typeof params.input.serviceCategory === 'string' && params.input.serviceCategory.trim()
      ? params.input.serviceCategory.trim().toUpperCase()
      : inferPrivateServiceCategory(tariff?.department ?? serviceDescription);

  const serviceDate =
    typeof params.input.serviceDate === 'string' && params.input.serviceDate.trim()
      ? params.input.serviceDate.trim()
      : new Date().toISOString().slice(0, 10);

  const quantity = Math.max(1, Math.trunc(Number(params.input.quantity ?? 1)));
  const unitPriceRaw =
    params.input.unitPrice !== undefined &&
    params.input.unitPrice !== null &&
    params.input.unitPrice !== ''
      ? (params.input.unitPrice as string | number)
      : (tariff?.fee ?? '0.00');
  const unitPriceCents = moneyToCentsStrict(unitPriceRaw, 'Service unit price');
  const facilityTariffAmount = formatCents(unitPriceCents * quantity);

  // Check member policy & recent eligibility evidence
  let memberPolicy: typeof schema.insuranceMemberPolicies.$inferSelect | null = null;
  if (params.input.memberPolicyId) {
    const [foundPolicy] = await db
      .select()
      .from(schema.insuranceMemberPolicies)
      .where(
        and(
          eq(schema.insuranceMemberPolicies.id, Number(params.input.memberPolicyId)),
          eq(schema.insuranceMemberPolicies.tenantId, params.tenantId),
          eq(schema.insuranceMemberPolicies.facilityId, params.facilityId),
          eq(schema.insuranceMemberPolicies.patientId, patientId),
        ),
      )
      .limit(1);
    if (!foundPolicy || foundPolicy.payerCode !== payerRow.payerCode)
      throw new PrivateInsuranceError(
        'MEMBER_POLICY_NOT_FOUND',
        'Membership does not belong to this patient, payer and facility.',
        404,
      );
    memberPolicy = foundPolicy;
  }

  const [latestElig] = await db
    .select()
    .from(schema.insuranceEligibilityVerifications)
    .where(
      and(
        eq(schema.insuranceEligibilityVerifications.tenantId, params.tenantId),
        eq(schema.insuranceEligibilityVerifications.facilityId, params.facilityId),
        eq(schema.insuranceEligibilityVerifications.patientId, patientId),
        eq(schema.insuranceEligibilityVerifications.payerCode, payerRow.payerCode),
      ),
    )
    .orderBy(desc(schema.insuranceEligibilityVerifications.checkedAt))
    .limit(1);

  if (params.input.encounterId) {
    const [encounter] = await db
      .select({ id: schema.encounters.id })
      .from(schema.encounters)
      .where(
        and(
          eq(schema.encounters.id, Number(params.input.encounterId)),
          eq(schema.encounters.tenantId, params.tenantId),
          eq(schema.encounters.facilityId, params.facilityId),
          eq(schema.encounters.patientId, patientId),
        ),
      )
      .limit(1);
    if (!encounter)
      throw new PrivateInsuranceError(
        'ENCOUNTER_NOT_FOUND',
        'Encounter does not belong to this patient and facility.',
        404,
      );
  }

  // Lookup insurer-specific service mapping
  const mappings = await db
    .select()
    .from(schema.payerServiceCodeMappings)
    .where(
      and(
        eq(schema.payerServiceCodeMappings.tenantId, params.tenantId),
        eq(schema.payerServiceCodeMappings.facilityId, params.facilityId),
        eq(schema.payerServiceCodeMappings.payerCode, payerRow.payerCode),
      ),
    );

  const matchingMapping = mappings.find(
    (m) =>
      (tariff && m.tariffId === tariff.id) ||
      (jaliCareItemCode && m.localCode.toUpperCase() === jaliCareItemCode.toUpperCase()),
  );

  let mappingStatus: 'MAPPED' | 'INACTIVE_MAPPING' | 'UNMAPPED' = 'UNMAPPED';
  if (matchingMapping) {
    mappingStatus =
      matchingMapping.isActive &&
      isEffectiveOnDate(matchingMapping.effectiveFrom, matchingMapping.effectiveTo, serviceDate)
        ? 'MAPPED'
        : 'INACTIVE_MAPPING';
  }

  // Lookup approved effective-dated benefit rules for this insurer
  const rules = await db
    .select()
    .from(schema.payerBenefitRules)
    .where(
      and(
        eq(schema.payerBenefitRules.tenantId, params.tenantId),
        eq(schema.payerBenefitRules.facilityId, params.facilityId),
        eq(schema.payerBenefitRules.payerCode, payerRow.payerCode),
        eq(schema.payerBenefitRules.status, 'APPROVED'),
      ),
    );

  const effectiveRules = rules.filter((r) =>
    isEffectiveOnDate(r.effectiveFrom, r.effectiveTo, serviceDate),
  );

  const matchedRule =
    effectiveRules.find(
      (r) =>
        matchingMapping &&
        r.payerServiceCode &&
        r.payerServiceCode.toUpperCase() === matchingMapping.payerServiceCode.toUpperCase(),
    ) ??
    effectiveRules.find((r) => r.serviceCategory.toUpperCase() === serviceCategory) ??
    null;

  const missingRequirements: string[] = [];
  if (!latestElig || latestElig.outcome !== 'Eligible') {
    missingRequirements.push(
      `No confirmed 'Eligible' verification on file for ${payerRow.payerName}.`,
    );
  }
  if (mappingStatus !== 'MAPPED') {
    missingRequirements.push(
      `JaliCare service "${jaliCareItemCode || serviceDescription}" is ${mappingStatus} for ${payerRow.payerCode}.`,
    );
  }

  const requiresPreauth = Boolean(matchingMapping?.requiresPreauth || matchedRule?.requiresPreauth);
  const preauthReference =
    typeof params.input.preauthReference === 'string' && params.input.preauthReference.trim()
      ? params.input.preauthReference.trim()
      : null;

  if (requiresPreauth && !preauthReference) {
    missingRequirements.push(
      `${payerRow.payerName} requires an approved preauthorization reference before claiming this service.`,
    );
  }

  const hasClinicalNotes = Boolean(params.input.hasClinicalNotes ?? false);
  const hasReferral = Boolean(params.input.hasReferral ?? false);

  if (matchingMapping?.requiresClinicalNotes && !hasClinicalNotes) {
    missingRequirements.push('Clinical consultation notes / diagnosis required.');
  }
  if ((matchingMapping?.requiresReferral || matchedRule?.requiresReferral) && !hasReferral) {
    missingRequirements.push('Referral letter required by insurer benefit rule.');
  }

  // Determine decision & financial estimate ONLY when a verified rule is matched
  let decision: PrivateBenefitDecision = 'UNABLE_TO_VERIFY';
  let verificationSource = 'UNVERIFIED_NO_RULE';
  let reason = '';
  let payerTariffAmount: string | null = null;
  let deductibleEstimate = '0.00';
  let estimatedCopayAmount = '0.00';
  let estimatedCoveredAmount: string | null = null;

  if (mappingStatus !== 'MAPPED') {
    decision = 'INCOMPLETE_INFORMATION';
    reason = `Service is not mapped to an active ${payerRow.payerName} service code for ${serviceDate}.`;
  } else if (!matchedRule) {
    decision = 'UNABLE_TO_VERIFY';
    reason = `No approved effective-dated ${payerRow.payerName} benefit rule exists for category ${serviceCategory}. Configure and approve a verified insurer schedule rule first.`;
  } else if (
    matchedRule.exclusionNotes &&
    matchedRule.exclusionNotes.toUpperCase().includes('EXCLUDED')
  ) {
    decision = 'NOT_COVERED';
    verificationSource = `APPROVED_RULE:${matchedRule.ruleCode}:v${matchedRule.version}`;
    reason = `Excluded under ${payerRow.payerName} rule ${matchedRule.ruleCode}: ${matchedRule.exclusionNotes}`;
    estimatedCoveredAmount = '0.00';
    estimatedCopayAmount = facilityTariffAmount;
  } else {
    verificationSource = `APPROVED_RULE:${matchedRule.ruleCode}:v${matchedRule.version}`;
    const basisUnitAmount = matchingMapping?.reimbursementTariff ?? unitPriceRaw;
    if (matchingMapping?.reimbursementTariff) {
      const reimbUnitCents = moneyToCentsStrict(
        matchingMapping.reimbursementTariff,
        'Payer reimbursement tariff',
      );
      payerTariffAmount = formatCents(reimbUnitCents * quantity);
    }

    const fin = computeBenefitFinancialsCents({
      unitAmountKes: basisUnitAmount,
      quantity,
      copayType: matchedRule.copayType,
      copayValueKesOrPercent: matchedRule.copayValue,
      deductibleAmountKes: matchedRule.deductibleAmount,
      coinsurancePercent: matchedRule.coinsurancePercent,
      perVisitLimitKes: matchedRule.perVisitLimit,
      annualLimitRemainingKes: matchedRule.annualLimit,
    });

    deductibleEstimate = fin.deductibleFormatted;
    estimatedCopayAmount = formatCents(fin.copayCents + fin.coinsuranceCents);
    estimatedCoveredAmount = fin.estimatedClaimableFormatted;

    if (requiresPreauth && !preauthReference) {
      decision = 'AUTHORIZATION_REQUIRED';
      reason = `Covered under ${matchedRule.benefitPackage} subject to mandatory ${payerRow.payerName} preauthorization. Estimated claimable: KES ${fin.estimatedClaimableFormatted}; estimated patient contribution: KES ${fin.patientContributionFormatted} (not guaranteed reimbursement).`;
    } else if (missingRequirements.length > 0) {
      decision = 'INCOMPLETE_INFORMATION';
      reason = missingRequirements.join(' ');
    } else {
      decision = 'COVERED';
      reason = `Validated against ${payerRow.payerName} rule ${matchedRule.ruleCode} (${matchedRule.sourceReference}). Estimated insurer share: KES ${fin.estimatedClaimableFormatted}; estimated patient contribution: KES ${fin.patientContributionFormatted}. Estimate only — subject to payer adjudication.`;
    }
  }

  const [saved] = await db
    .insert(schema.insuranceBenefitValidations)
    .values({
      tenantId: params.tenantId,
      facilityId: params.facilityId,
      patientId,
      memberPolicyId: memberPolicy?.id ?? null,
      encounterId:
        params.input.encounterId !== undefined &&
        params.input.encounterId !== null &&
        params.input.encounterId !== ''
          ? Number(params.input.encounterId)
          : null,
      eligibilityVerificationId: latestElig?.id ?? null,
      payerCode: payerRow.payerCode,
      tariffId: tariff?.id ?? null,
      mappingId: matchingMapping?.id ?? null,
      benefitRuleId: matchedRule?.id ?? null,
      ruleVersion: matchedRule?.version ?? null,
      serviceDescription,
      serviceCategory,
      payerServiceCode: matchingMapping?.payerServiceCode ?? null,
      benefitPackage: matchedRule?.benefitPackage ?? memberPolicy?.planName ?? null,
      serviceDate,
      quantity,
      facilityTariffAmount,
      payerTariffAmount,
      deductibleEstimate,
      estimatedCopayAmount,
      estimatedCoveredAmount,
      decision,
      verificationSource,
      isSimulated: false,
      requiresPreauth,
      preauthReference,
      hasReferral,
      hasClinicalNotes,
      missingRequirements,
      reason,
      validatedByUserId: params.actorUserId,
    })
    .returning();

  await recordPrivateInsuranceAudit({
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    actorUserUid: params.actorUserUid,
    actorRole: params.actorRole,
    action: 'PRIVATE_INSURANCE_BENEFIT_VALIDATED',
    entityType: 'insurance_benefit_validation',
    entityId: saved.id,
    details: {
      payerCode: payerRow.payerCode,
      patientId,
      decision,
      mappingStatus,
      verificationSource,
    },
  });

  return {
    ...saved,
    jaliCareItemCode: jaliCareItemCode || null,
    mappingStatus,
    patientContributionEstimate:
      estimatedCoveredAmount !== null
        ? formatCents(
            Math.max(
              0,
              moneyToCentsStrict(facilityTariffAmount, 'Facility tariff') -
                moneyToCentsStrict(estimatedCoveredAmount, 'Estimated covered'),
            ),
          )
        : null,
    matchedRuleSummary: matchedRule
      ? {
          id: matchedRule.id,
          ruleCode: matchedRule.ruleCode,
          version: matchedRule.version,
          benefitPackage: matchedRule.benefitPackage,
          copayType: matchedRule.copayType,
          copayValue: matchedRule.copayValue,
          deductibleAmount: matchedRule.deductibleAmount,
          coinsurancePercent: matchedRule.coinsurancePercent,
          perVisitLimit: matchedRule.perVisitLimit,
          annualLimit: matchedRule.annualLimit,
          sourceReference: matchedRule.sourceReference,
        }
      : null,
    eligibilityEvidence: latestElig
      ? {
          id: latestElig.id,
          outcome: latestElig.outcome,
          source: latestElig.source,
          checkedAt: latestElig.checkedAt,
        }
      : null,
  };
}
