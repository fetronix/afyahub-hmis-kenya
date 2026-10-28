/**
 * JaliCare HMIS
 * Payer Configuration, Service Code Mappings & Versioned Benefit Rules Service
 *
 * Strictly preserves JaliCare's `facility_service_tariffs` untouched while
 * maintaining explicit, effective-dated payer service mappings and versioned
 * benefit rules (`DRAFT` -> `APPROVED` -> `RETIRED`).
 */

import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { isValidShaCatalogueCode } from '../../integrations/sha/sha.fhir.ts';
import {
  formatCents,
  InsuranceDomainError,
  loadScopedFacility,
  parseMoneyToCents,
  recordInsuranceAuditEvent,
  requireMoneyCents,
  type InsuranceActorScope,
} from './contracts.ts';

export async function getFacilityPayerConfig(
  scope: Pick<InsuranceActorScope, 'tenantId' | 'facilityId'>,
  payerCode = 'SHA',
) {
  const facility = await loadScopedFacility(scope);

  const [existing] = await db
    .select()
    .from(schema.insurancePayerConfigs)
    .where(
      and(
        eq(schema.insurancePayerConfigs.facilityId, scope.facilityId),
        eq(schema.insurancePayerConfigs.tenantId, scope.tenantId),
        eq(schema.insurancePayerConfigs.payerCode, payerCode),
      ),
    )
    .limit(1);

  if (existing) return { config: existing, facility };

  return {
    config: {
      id: null,
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      payerCode,
      payerName:
        payerCode === 'SHA' ? 'Social Health Authority (SHA)' : `${payerCode} Insurance Payer`,
      payerType: payerCode === 'SHA' ? 'PUBLIC_SCHEME' : 'PRIVATE_INSURER',
      facilityRegistryCode: facility.mflCode ?? null,
      accreditationLevel: facility.level ?? 'Level 4',
      contractedSchemes: payerCode === 'SHA' ? ['SHIF', 'PHC', 'ECCIF'] : ['CORPORATE'],
      defaultCodingSystem: 'ICD-11',
      requireVerifiedEligibility: true,
      eligibilityMaxAgeHours: 24,
      isActive: true,
      notes: null,
      updatedByUserId: null,
      createdAt: null,
      updatedAt: null,
    },
    facility,
  };
}

export interface UpsertPayerConfigInput {
  payerCode?: string;
  payerName?: string;
  facilityRegistryCode?: string | null;
  accreditationLevel?: string | null;
  contractedSchemes?: string[];
  defaultCodingSystem?: 'ICD-11' | 'ICD-10';
  requireVerifiedEligibility?: boolean;
  eligibilityMaxAgeHours?: number;
  isActive?: boolean;
  notes?: string | null;
}

export async function upsertFacilityPayerConfig(
  scope: InsuranceActorScope,
  input: UpsertPayerConfigInput,
) {
  const facility = await loadScopedFacility(scope);
  const payerCode = (input.payerCode ?? 'SHA').trim().toUpperCase();
  if (!payerCode) {
    throw new InsuranceDomainError('INVALID_PAYER_CODE', 'payerCode is required.', 400);
  }

  const maxAge = input.eligibilityMaxAgeHours ?? 24;
  if (!Number.isSafeInteger(maxAge) || maxAge < 1 || maxAge > 720) {
    throw new InsuranceDomainError(
      'INVALID_ELIGIBILITY_MAX_AGE',
      'eligibilityMaxAgeHours must be between 1 and 720 hours.',
      400,
    );
  }

  const schemes = Array.isArray(input.contractedSchemes)
    ? input.contractedSchemes.map((s) => s.trim().toUpperCase()).filter(Boolean)
    : ['SHIF', 'PHC', 'ECCIF'];

  const [existing] = await db
    .select()
    .from(schema.insurancePayerConfigs)
    .where(
      and(
        eq(schema.insurancePayerConfigs.facilityId, scope.facilityId),
        eq(schema.insurancePayerConfigs.payerCode, payerCode),
      ),
    )
    .limit(1);

  let saved;
  if (existing) {
    [saved] = await db
      .update(schema.insurancePayerConfigs)
      .set({
        payerName: input.payerName?.trim() || existing.payerName,
        facilityRegistryCode:
          input.facilityRegistryCode !== undefined
            ? input.facilityRegistryCode?.trim() || null
            : existing.facilityRegistryCode,
        accreditationLevel:
          input.accreditationLevel !== undefined
            ? input.accreditationLevel?.trim() || null
            : existing.accreditationLevel,
        contractedSchemes: schemes,
        defaultCodingSystem:
          input.defaultCodingSystem ?? (existing.defaultCodingSystem as 'ICD-11' | 'ICD-10'),
        requireVerifiedEligibility:
          input.requireVerifiedEligibility ?? existing.requireVerifiedEligibility,
        eligibilityMaxAgeHours: maxAge,
        isActive: input.isActive ?? existing.isActive,
        notes: input.notes !== undefined ? input.notes?.trim() || null : existing.notes,
        updatedByUserId: scope.userId,
        updatedAt: new Date(),
      })
      .where(eq(schema.insurancePayerConfigs.id, existing.id))
      .returning();
  } else {
    [saved] = await db
      .insert(schema.insurancePayerConfigs)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        payerCode,
        payerName: input.payerName?.trim() || 'Social Health Authority (SHA)',
        payerType: payerCode === 'SHA' ? 'PUBLIC_SCHEME' : 'PRIVATE_INSURER',
        facilityRegistryCode: input.facilityRegistryCode?.trim() || facility.mflCode || null,
        accreditationLevel: input.accreditationLevel?.trim() || facility.level || 'Level 4',
        contractedSchemes: schemes,
        defaultCodingSystem: input.defaultCodingSystem ?? 'ICD-11',
        requireVerifiedEligibility: input.requireVerifiedEligibility ?? true,
        eligibilityMaxAgeHours: maxAge,
        isActive: input.isActive ?? true,
        notes: input.notes?.trim() || null,
        updatedByUserId: scope.userId,
      })
      .returning();
  }

  await recordInsuranceAuditEvent(scope, {
    action: 'SHA_PAYER_CONFIG_UPDATED',
    resource: 'insurance_payer_configs',
    resourceId: saved.id,
    summary: {
      payerCode,
      facilityRegistryCode: saved.facilityRegistryCode,
      accreditationLevel: saved.accreditationLevel,
      contractedSchemes: saved.contractedSchemes,
      requireVerifiedEligibility: saved.requireVerifiedEligibility,
    },
  });

  return saved;
}

export async function listServiceCodeMappings(
  scope: Pick<InsuranceActorScope, 'tenantId' | 'facilityId'>,
  payerCode = 'SHA',
) {
  await loadScopedFacility(scope);

  const mappings = await db
    .select()
    .from(schema.payerServiceCodeMappings)
    .where(
      and(
        eq(schema.payerServiceCodeMappings.tenantId, scope.tenantId),
        eq(schema.payerServiceCodeMappings.facilityId, scope.facilityId),
        eq(schema.payerServiceCodeMappings.payerCode, payerCode),
      ),
    )
    .orderBy(desc(schema.payerServiceCodeMappings.updatedAt));

  const tariffs = await db
    .select()
    .from(schema.facilityServiceTariffs)
    .where(
      and(
        eq(schema.facilityServiceTariffs.tenantId, scope.tenantId),
        eq(schema.facilityServiceTariffs.facilityId, scope.facilityId),
      ),
    );

  return { mappings, facilityTariffs: tariffs };
}

export interface UpsertServiceMappingInput {
  payerCode?: string;
  tariffId?: number | null;
  localCode: string;
  localDescription: string;
  serviceArea: string;
  payerServiceCode: string;
  payerServiceName: string;
  fund?: string;
  accessPoint?: 'OP' | 'IP' | 'BOTH';
  paymentMechanism?: string;
  reimbursementTariff?: string | number | null;
  isPhcZeroTariff?: boolean;
  requiresPreauth?: boolean;
  preauthCategory?: string | null;
  requiresReferral?: boolean;
  requiresClinicalNotes?: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  isActive?: boolean;
  notes?: string | null;
}

export async function upsertServiceCodeMapping(
  scope: InsuranceActorScope,
  input: UpsertServiceMappingInput,
) {
  await loadScopedFacility(scope);
  const payerCode = (input.payerCode ?? 'SHA').trim().toUpperCase();
  const localCode = input.localCode.trim();
  const payerServiceCode = input.payerServiceCode.trim();
  const payerServiceName = input.payerServiceName.trim();
  const localDescription = input.localDescription.trim();
  const serviceArea = input.serviceArea.trim().toUpperCase();

  if (!localCode || !payerServiceCode || !payerServiceName || !localDescription || !serviceArea) {
    throw new InsuranceDomainError(
      'INVALID_MAPPING_FIELDS',
      'localCode, localDescription, serviceArea, payerServiceCode, and payerServiceName are required.',
      400,
    );
  }

  if (payerCode === 'SHA' && !isValidShaCatalogueCode(payerServiceCode)) {
    throw new InsuranceDomainError(
      'INVALID_SHA_CATALOGUE_CODE',
      `payerServiceCode "${payerServiceCode}" is not a valid SHA Intervention / PMF catalogue code (expected SHA-xx-xxx or PMF-xxx; SNOMED CT codes are prohibited).`,
      400,
    );
  }

  let validatedTariffId: number | null = null;
  if (input.tariffId !== undefined && input.tariffId !== null) {
    const [tariff] = await db
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

    if (!tariff) {
      throw new InsuranceDomainError(
        'TARIFF_NOT_FOUND',
        'Selected JaliCare facility tariff does not exist in this facility.',
        404,
      );
    }
    validatedTariffId = tariff.id;
  }

  let normalizedReimbursement: string | null = null;
  if (
    input.reimbursementTariff !== undefined &&
    input.reimbursementTariff !== null &&
    input.reimbursementTariff !== ''
  ) {
    const cents = requireMoneyCents(input.reimbursementTariff, 'reimbursementTariff');
    normalizedReimbursement = formatCents(cents);
  }

  const [existing] = await db
    .select()
    .from(schema.payerServiceCodeMappings)
    .where(
      and(
        eq(schema.payerServiceCodeMappings.facilityId, scope.facilityId),
        eq(schema.payerServiceCodeMappings.payerCode, payerCode),
        eq(schema.payerServiceCodeMappings.localCode, localCode),
      ),
    )
    .limit(1);

  let saved;
  if (existing) {
    [saved] = await db
      .update(schema.payerServiceCodeMappings)
      .set({
        tariffId: validatedTariffId,
        localDescription,
        serviceArea,
        payerServiceCode,
        payerServiceName,
        fund: (input.fund ?? existing.fund).trim().toUpperCase(),
        accessPoint: input.accessPoint ?? (existing.accessPoint as 'OP' | 'IP' | 'BOTH'),
        paymentMechanism: (input.paymentMechanism ?? existing.paymentMechanism)
          .trim()
          .toUpperCase(),
        reimbursementTariff: normalizedReimbursement,
        isPhcZeroTariff: input.isPhcZeroTariff ?? existing.isPhcZeroTariff,
        requiresPreauth: input.requiresPreauth ?? existing.requiresPreauth,
        preauthCategory: input.preauthCategory?.trim().toUpperCase() || null,
        requiresReferral: input.requiresReferral ?? existing.requiresReferral,
        requiresClinicalNotes: input.requiresClinicalNotes ?? existing.requiresClinicalNotes,
        effectiveFrom: input.effectiveFrom || null,
        effectiveTo: input.effectiveTo || null,
        isActive: input.isActive ?? existing.isActive,
        notes: input.notes?.trim() || null,
        updatedByUserId: scope.userId,
        updatedAt: new Date(),
      })
      .where(eq(schema.payerServiceCodeMappings.id, existing.id))
      .returning();
  } else {
    [saved] = await db
      .insert(schema.payerServiceCodeMappings)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        payerCode,
        tariffId: validatedTariffId,
        localCode,
        localDescription,
        serviceArea,
        payerServiceCode,
        payerServiceName,
        fund: (input.fund ?? 'SHIF').trim().toUpperCase(),
        accessPoint: input.accessPoint ?? 'OP',
        paymentMechanism: (input.paymentMechanism ?? 'FEE_FOR_SERVICE').trim().toUpperCase(),
        reimbursementTariff: normalizedReimbursement,
        isPhcZeroTariff: input.isPhcZeroTariff ?? false,
        requiresPreauth: input.requiresPreauth ?? false,
        preauthCategory: input.preauthCategory?.trim().toUpperCase() || null,
        requiresReferral: input.requiresReferral ?? false,
        requiresClinicalNotes: input.requiresClinicalNotes ?? true,
        effectiveFrom: input.effectiveFrom || null,
        effectiveTo: input.effectiveTo || null,
        isActive: input.isActive ?? true,
        notes: input.notes?.trim() || null,
        createdByUserId: scope.userId,
        updatedByUserId: scope.userId,
      })
      .returning();
  }

  await recordInsuranceAuditEvent(scope, {
    action: existing ? 'SHA_SERVICE_MAPPING_UPDATED' : 'SHA_SERVICE_MAPPING_CREATED',
    resource: 'payer_service_code_mappings',
    resourceId: saved.id,
    summary: {
      payerCode,
      localCode: saved.localCode,
      payerServiceCode: saved.payerServiceCode,
      fund: saved.fund,
      reimbursementTariff: saved.reimbursementTariff,
      requiresPreauth: saved.requiresPreauth,
    },
  });

  return saved;
}

export async function listBenefitRules(
  scope: Pick<InsuranceActorScope, 'tenantId' | 'facilityId'>,
  payerCode = 'SHA',
) {
  await loadScopedFacility(scope);

  return db
    .select()
    .from(schema.payerBenefitRules)
    .where(
      and(
        eq(schema.payerBenefitRules.tenantId, scope.tenantId),
        eq(schema.payerBenefitRules.facilityId, scope.facilityId),
        eq(schema.payerBenefitRules.payerCode, payerCode),
      ),
    )
    .orderBy(desc(schema.payerBenefitRules.updatedAt));
}

export interface CreateBenefitRuleInput {
  payerCode?: string;
  ruleCode: string;
  benefitPackage: string;
  serviceCategory: string;
  payerServiceCode?: string | null;
  minFacilityLevel?: string | null;
  requiresPreauth?: boolean;
  requiresReferral?: boolean;
  requiredEvidence?: string[];
  copayType?: 'NONE' | 'FIXED' | 'PERCENTAGE';
  copayValue?: string | number;
  annualLimit?: string | number | null;
  perVisitLimit?: string | number | null;
  exclusionNotes?: string | null;
  sourceReference: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export async function createBenefitRule(scope: InsuranceActorScope, input: CreateBenefitRuleInput) {
  await loadScopedFacility(scope);

  const payerCode = (input.payerCode ?? 'SHA').trim().toUpperCase();
  const ruleCode = input.ruleCode.trim().toUpperCase();
  const benefitPackage = input.benefitPackage.trim().toUpperCase();
  const serviceCategory = input.serviceCategory.trim().toUpperCase();
  const sourceReference = input.sourceReference.trim();

  if (
    !ruleCode ||
    !benefitPackage ||
    !serviceCategory ||
    !sourceReference ||
    !input.effectiveFrom
  ) {
    throw new InsuranceDomainError(
      'INVALID_BENEFIT_RULE',
      'ruleCode, benefitPackage, serviceCategory, sourceReference, and effectiveFrom are required.',
      400,
    );
  }

  const copayType = input.copayType ?? 'NONE';
  const copayCents =
    input.copayValue !== undefined ? requireMoneyCents(input.copayValue, 'copayValue') : 0;
  if (copayType === 'PERCENTAGE' && copayCents > 10_000) {
    throw new InsuranceDomainError(
      'INVALID_COPAY_PERCENTAGE',
      'Percentage copay cannot exceed 100.00%.',
      400,
    );
  }

  const annualLimit =
    input.annualLimit !== undefined && input.annualLimit !== null && input.annualLimit !== ''
      ? formatCents(requireMoneyCents(input.annualLimit, 'annualLimit'))
      : null;
  const perVisitLimit =
    input.perVisitLimit !== undefined && input.perVisitLimit !== null && input.perVisitLimit !== ''
      ? formatCents(requireMoneyCents(input.perVisitLimit, 'perVisitLimit'))
      : null;

  const existingVersions = await db
    .select()
    .from(schema.payerBenefitRules)
    .where(
      and(
        eq(schema.payerBenefitRules.facilityId, scope.facilityId),
        eq(schema.payerBenefitRules.payerCode, payerCode),
        eq(schema.payerBenefitRules.ruleCode, ruleCode),
      ),
    );

  const nextVersion =
    existingVersions.reduce((max, r) => (r.version > max ? r.version : max), 0) + 1;

  // Newly created local benefit rules ALWAYS start in DRAFT (`UNVERIFIED`) until explicitly approved!
  const [created] = await db
    .insert(schema.payerBenefitRules)
    .values({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      payerCode,
      ruleCode,
      version: nextVersion,
      benefitPackage,
      serviceCategory,
      payerServiceCode: input.payerServiceCode?.trim() || null,
      minFacilityLevel: input.minFacilityLevel?.trim() || null,
      requiresPreauth: input.requiresPreauth ?? false,
      requiresReferral: input.requiresReferral ?? false,
      requiredEvidence: Array.isArray(input.requiredEvidence)
        ? input.requiredEvidence.map((e) => e.trim()).filter(Boolean)
        : [],
      copayType,
      copayValue: formatCents(copayCents),
      annualLimit,
      perVisitLimit,
      exclusionNotes: input.exclusionNotes?.trim() || null,
      sourceReference,
      status: 'DRAFT',
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo || null,
      createdByUserId: scope.userId,
    })
    .returning();

  await recordInsuranceAuditEvent(scope, {
    action: 'SHA_BENEFIT_RULE_CREATED_DRAFT',
    resource: 'payer_benefit_rules',
    resourceId: created.id,
    summary: {
      ruleCode: created.ruleCode,
      version: created.version,
      benefitPackage: created.benefitPackage,
      serviceCategory: created.serviceCategory,
      status: created.status,
      sourceReference: created.sourceReference,
    },
  });

  return created;
}

export async function reviewBenefitRuleStatus(
  scope: InsuranceActorScope,
  ruleId: number,
  action: 'APPROVE' | 'RETIRE',
) {
  await loadScopedFacility(scope);

  const [rule] = await db
    .select()
    .from(schema.payerBenefitRules)
    .where(
      and(
        eq(schema.payerBenefitRules.id, ruleId),
        eq(schema.payerBenefitRules.tenantId, scope.tenantId),
        eq(schema.payerBenefitRules.facilityId, scope.facilityId),
      ),
    )
    .limit(1);

  if (!rule) {
    throw new InsuranceDomainError('BENEFIT_RULE_NOT_FOUND', 'Benefit rule not found.', 404);
  }

  if (action === 'APPROVE') {
    if (rule.status === 'RETIRED') {
      throw new InsuranceDomainError(
        'RULE_RETIRED',
        'A retired benefit rule cannot be re-activated; create a new version instead.',
        409,
      );
    }

    // Retire older APPROVED versions of the same ruleCode in the same facility
    await db
      .update(schema.payerBenefitRules)
      .set({ status: 'RETIRED', updatedAt: new Date() })
      .where(
        and(
          eq(schema.payerBenefitRules.facilityId, scope.facilityId),
          eq(schema.payerBenefitRules.payerCode, rule.payerCode),
          eq(schema.payerBenefitRules.ruleCode, rule.ruleCode),
          eq(schema.payerBenefitRules.status, 'APPROVED'),
        ),
      );

    const [approved] = await db
      .update(schema.payerBenefitRules)
      .set({
        status: 'APPROVED',
        approvedByUserId: scope.userId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.payerBenefitRules.id, rule.id))
      .returning();

    await recordInsuranceAuditEvent(scope, {
      action: 'SHA_BENEFIT_RULE_APPROVED',
      resource: 'payer_benefit_rules',
      resourceId: approved.id,
      summary: {
        ruleCode: approved.ruleCode,
        version: approved.version,
        sourceReference: approved.sourceReference,
      },
    });

    return approved;
  }

  const [retired] = await db
    .update(schema.payerBenefitRules)
    .set({
      status: 'RETIRED',
      updatedAt: new Date(),
    })
    .where(eq(schema.payerBenefitRules.id, rule.id))
    .returning();

  await recordInsuranceAuditEvent(scope, {
    action: 'SHA_BENEFIT_RULE_RETIRED',
    resource: 'payer_benefit_rules',
    resourceId: retired.id,
    summary: {
      ruleCode: retired.ruleCode,
      version: retired.version,
    },
  });

  return retired;
}

export { parseMoneyToCents };
