/**
 * JaliCare HMIS
 * SHA eClaims Preparation, Validation, Submission, Status Tracking & Resubmission Service
 *
 * Pulls clinical & billing evidence from existing JaliCare OPD, IPD, Lab,
 * Radiology, Pharmacy, Tariffs, and Invoices without mutating original
 * accounting records. Enforces server-side state machine transitions and
 * decimal-safe cents arithmetic throughout.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { openPatientIdentifiers } from '../../security/patient-identifiers.ts';
import {
  defaultShaGatewayAdapter,
  type PayerGatewayAdapter,
} from '../../integrations/sha/sha.adapter.ts';
import {
  ALLOWED_PRACTITIONER_REGULATORS,
  buildShaFhirBundle,
  evaluateShaInterventionCombinations,
  isValidShaCatalogueCode,
  validateShaFhirBundle,
  type PractitionerRegulator,
} from '../../integrations/sha/sha.fhir.ts';
import { getFacilityPayerConfig } from './configuration.service.ts';
import {
  assertEclaimTransition,
  canTransitionEclaimStatus,
  formatCents,
  InsuranceDomainError,
  isDateWithinWindow,
  loadScopedFacility,
  loadTenantPatient,
  multiplyMoneyCents,
  parseMoneyToCents,
  recordInsuranceAuditEvent,
  requireMoneyCents,
  type EclaimStatus,
  type InsuranceActorScope,
} from './contracts.ts';

export interface ClaimValidationIssue {
  code: string;
  severity: 'ERROR' | 'WARNING';
  field?: string;
  message: string;
}

export interface ClaimValidationContext {
  hasPatientShaOrNationalId: boolean;
  facilityRegistryCode: string | null;
  requireVerifiedEligibility: boolean;
  eligibilityOutcome: string | null;
  isBeneficiaryAlive?: boolean | null;
  eligibilityCheckedAt: Date | string | null;
  eligibilityMaxAgeHours: number;
  billableStart: string;
  billableEnd: string;
  subType: string;
  hasAdmissionRecord: boolean;
  hasDischargeDate: boolean;
  diagnosesCount: number;
  diagnoses?: Array<{ code: string; system?: string }>;
  isPhcClaim: boolean;
  totalClaimedCents: number;
  hasDuplicateActiveInvoiceClaim: boolean;
  items: Array<{
    sequence: number;
    description: string;
    payerServiceCode: string | null;
    servicedStart: string;
    servicedEnd: string;
    quantity: number;
    claimedUnitCents: number;
    claimedNetCents: number;
    requiresPreauth: boolean;
    preauthReference: string | null;
    preauthApprovedAndValid: boolean;
  }>;
}

/**
 * Pure, deterministic pre-submission validation rule evaluator.
 */
export function evaluateClaimValidationRules(
  ctx: ClaimValidationContext,
  nowMs = Date.now(),
): ClaimValidationIssue[] {
  const issues: ClaimValidationIssue[] = [];

  if (!ctx.hasPatientShaOrNationalId) {
    issues.push({
      code: 'MISSING_PATIENT_IDENTIFIER',
      severity: 'ERROR',
      field: 'patientId',
      message:
        'Patient must have a SHA Member Number, National ID, or Client Registry ID recorded.',
    });
  }

  if (!ctx.facilityRegistryCode || ctx.facilityRegistryCode.trim().length < 3) {
    issues.push({
      code: 'MISSING_FACILITY_REGISTRY_CODE',
      severity: 'ERROR',
      field: 'facilityRegistryCode',
      message: 'Facility Registry Code (FID / MFL code) is missing in SHA payer configuration.',
    });
  }

  if (ctx.isBeneficiaryAlive === false) {
    issues.push({
      code: 'BENEFICIARY_DECEASED',
      severity: 'ERROR',
      field: 'eligibilityVerificationId',
      message:
        'Beneficiary is marked deceased in DHA Client Registry (isAlive=false); SHA claims cannot be submitted.',
    });
  }

  if (ctx.requireVerifiedEligibility) {
    if (!ctx.eligibilityOutcome) {
      issues.push({
        code: 'MISSING_ELIGIBILITY_VERIFICATION',
        severity: 'ERROR',
        field: 'eligibilityVerificationId',
        message: 'Patient SHA eligibility has not been verified for this claim.',
      });
    } else if (ctx.eligibilityOutcome !== 'Eligible') {
      issues.push({
        code: 'PATIENT_NOT_CONFIRMED_ELIGIBLE',
        severity: 'ERROR',
        field: 'eligibilityVerificationId',
        message: `Patient SHA eligibility outcome is "${ctx.eligibilityOutcome}"; only confirmed Eligible claims can be submitted.`,
      });
    } else if (ctx.eligibilityCheckedAt) {
      const checkedMs = new Date(ctx.eligibilityCheckedAt).getTime();
      const ageHours = (nowMs - checkedMs) / (1000 * 60 * 60);
      if (Number.isFinite(ageHours) && ageHours > ctx.eligibilityMaxAgeHours) {
        issues.push({
          code: 'STALE_ELIGIBILITY_VERIFICATION',
          severity: 'WARNING',
          field: 'eligibilityVerificationId',
          message: `Eligibility check is ${Math.round(ageHours)}h old (configured freshness window: ${ctx.eligibilityMaxAgeHours}h). Consider rechecking.`,
        });
      }
    }
  }

  if (ctx.billableStart > ctx.billableEnd) {
    issues.push({
      code: 'INVALID_BILLABLE_PERIOD',
      severity: 'ERROR',
      field: 'billableStart',
      message: `billableStart (${ctx.billableStart}) cannot be after billableEnd (${ctx.billableEnd}).`,
    });
  }

  if (ctx.diagnosesCount === 0) {
    issues.push({
      code: 'MISSING_DIAGNOSIS',
      severity: 'ERROR',
      field: 'diagnosesSnapshot',
      message:
        'At least one coded clinical diagnosis (ICD-11 / ICD-10) is required for SHA claims.',
    });
  } else if (Array.isArray(ctx.diagnoses)) {
    for (const diag of ctx.diagnoses) {
      if (
        diag.system?.toLowerCase().includes('snomed') ||
        diag.code?.toLowerCase().includes('snomed')
      ) {
        issues.push({
          code: 'PROHIBITED_SNOMED_CT',
          severity: 'ERROR',
          field: 'diagnosesSnapshot',
          message:
            'SNOMED CT diagnosis coding is prohibited by Kenya eClaims FHIR IG; use ICD-11 (or approved transitional ICD-10).',
        });
      }
    }
  }

  if (ctx.subType === 'ip') {
    if (!ctx.hasAdmissionRecord) {
      issues.push({
        code: 'MISSING_IPD_ADMISSION',
        severity: 'ERROR',
        field: 'subType',
        message: 'Inpatient (IP) eClaims require a linked inpatient admission/episode record.',
      });
    } else if (!ctx.hasDischargeDate) {
      issues.push({
        code: 'MISSING_IPD_DISCHARGE_DATE',
        severity: 'WARNING',
        field: 'billableEnd',
        message:
          'Inpatient admission has no discharge date yet; interim claim submission may be queried.',
      });
    }
  }

  if (ctx.hasDuplicateActiveInvoiceClaim) {
    issues.push({
      code: 'DUPLICATE_INVOICE_CLAIM',
      severity: 'ERROR',
      field: 'invoiceId',
      message: 'Another active SHA eClaim already exists for this JaliCare invoice.',
    });
  }

  if (ctx.items.length === 0) {
    issues.push({
      code: 'EMPTY_CLAIM_ITEMS',
      severity: 'ERROR',
      field: 'items',
      message: 'Claim package must contain at least one billable service or pharmacy line item.',
    });
  }

  let summedCents = 0;
  const mappedCodes: string[] = [];
  for (const item of ctx.items) {
    if (!item.payerServiceCode || item.payerServiceCode.trim().length === 0) {
      issues.push({
        code: 'UNMAPPED_SERVICE_CODE',
        severity: 'ERROR',
        field: `items[${item.sequence}]`,
        message: `Line #${item.sequence} ("${item.description}") is not mapped to an SHA intervention code.`,
      });
    } else if (!isValidShaCatalogueCode(item.payerServiceCode)) {
      issues.push({
        code: 'INVALID_SHA_SERVICE_CODE',
        severity: 'ERROR',
        field: `items[${item.sequence}]`,
        message: `Line #${item.sequence} code "${item.payerServiceCode}" is not a valid SHA / PMF intervention catalogue code (SNOMED CT codes are prohibited).`,
      });
    } else {
      mappedCodes.push(item.payerServiceCode.trim().toUpperCase());
    }

    if (item.servicedStart < ctx.billableStart || item.servicedEnd > ctx.billableEnd) {
      issues.push({
        code: 'ITEM_DATE_OUTSIDE_BILLABLE_PERIOD',
        severity: 'ERROR',
        field: `items[${item.sequence}].servicedPeriod`,
        message: `Line #${item.sequence} service dates (${item.servicedStart}..${item.servicedEnd}) fall outside claim billablePeriod (${ctx.billableStart}..${ctx.billableEnd}).`,
      });
    }

    const expectedLineNet = item.claimedUnitCents * item.quantity;
    if (!ctx.isPhcClaim && expectedLineNet !== item.claimedNetCents) {
      issues.push({
        code: 'LINE_TOTAL_MISMATCH',
        severity: 'ERROR',
        field: `items[${item.sequence}].claimedNetAmount`,
        message: `Line #${item.sequence} net amount (${formatCents(item.claimedNetCents)}) does not equal unitPrice * quantity (${formatCents(expectedLineNet)}).`,
      });
    }
    summedCents += item.claimedNetCents;

    if (item.requiresPreauth && (!item.preauthReference || !item.preauthApprovedAndValid)) {
      issues.push({
        code: 'MISSING_OR_INVALID_PREAUTH',
        severity: 'ERROR',
        field: `items[${item.sequence}].preauthReference`,
        message: `Line #${item.sequence} ("${item.description}") requires an active APPROVED SHA preauthorization within its validity window.`,
      });
    }
  }

  const combinationEval = evaluateShaInterventionCombinations(mappedCodes);
  if (!combinationEval.valid) {
    for (const conflict of combinationEval.violations) {
      issues.push({
        code: 'SHA_INTERVENTION_COMBINATION_CONFLICT',
        severity: 'ERROR',
        field: 'items',
        message: conflict,
      });
    }
  }

  if (ctx.isPhcClaim && ctx.totalClaimedCents !== 0) {
    issues.push({
      code: 'PHC_NON_ZERO_TOTAL',
      severity: 'ERROR',
      field: 'totalClaimedAmount',
      message: 'Primary Healthcare (PHC) claims must carry a total claimed amount of KES 0.00.',
    });
  } else if (!ctx.isPhcClaim && summedCents !== ctx.totalClaimedCents) {
    issues.push({
      code: 'CLAIM_TOTAL_MISMATCH',
      severity: 'ERROR',
      field: 'totalClaimedAmount',
      message: `Claim header total (${formatCents(ctx.totalClaimedCents)}) does not match sum of line items (${formatCents(summedCents)}).`,
    });
  }

  return issues;
}

async function nextEclaimNumber(): Promise<string> {
  const res = await db.execute(sql`SELECT nextval('sha_eclaim_number_seq') AS seq`);
  const rows = (res as unknown as { rows?: Array<{ seq: string | number }> }).rows ?? [];
  const seq = Number(rows[0]?.seq ?? Date.now() % 1_000_000);
  return `ECLM-SHA-${String(seq).padStart(6, '0')}`;
}

export interface PrepareShaClaimInput {
  invoiceId: number;
  encounterId?: number | null;
  eligibilityVerificationId?: number | null;
  preauthorizationId?: number | null;
  authorizationId?: number | null;
  consentToken?: string | null;
  submissionProtocol?: 'FHIR_BUNDLE' | 'HIE_VIRTUAL_CLAIM';
  hieVirtualClaimId?: string | null;
  dischargeReason?: 'RECOVERED' | 'REFERRED' | 'ABSCONDED' | 'DECEASED' | 'OTHER' | null;
  practitionerRegNumber?: string | null;
  practitionerRegulator?: string | null;
  payerCode?: string;
  schemeCode?: string;
  claimType?: 'institutional' | 'pharmacy' | 'professional';
  subType?: 'op' | 'ip';
  isPhcClaim?: boolean;
  patientCopayAmount?: string | number;
  diagnosesOverride?: Array<{ code: string; display: string; system?: string; type?: string }>;
}

export async function prepareShaClaim(scope: InsuranceActorScope, input: PrepareShaClaimInput) {
  await loadScopedFacility(scope);
  const payerCode = (input.payerCode ?? 'SHA').trim().toUpperCase();

  // 1. Load JaliCare invoice & verify tenant/facility ownership (never mutate invoice!)
  const [invoice] = await db
    .select()
    .from(schema.billingInvoices)
    .where(
      and(
        eq(schema.billingInvoices.id, input.invoiceId),
        eq(schema.billingInvoices.tenantId, scope.tenantId),
        eq(schema.billingInvoices.facilityId, scope.facilityId),
      ),
    )
    .limit(1);

  if (!invoice) {
    throw new InsuranceDomainError(
      'INVOICE_NOT_FOUND',
      'Selected JaliCare invoice does not exist in this facility.',
      404,
    );
  }

  // Prevent duplicate active eClaim on the same invoice + payer
  const existingClaims = await db
    .select()
    .from(schema.shaEclaims)
    .where(
      and(
        eq(schema.shaEclaims.invoiceId, invoice.id),
        eq(schema.shaEclaims.payerCode, payerCode),
        ne(schema.shaEclaims.status, 'CANCELLED'),
      ),
    );

  if (existingClaims.length > 0) {
    throw new InsuranceDomainError(
      'DUPLICATE_INVOICE_CLAIM',
      `An active ${payerCode} eClaim (${existingClaims[0].claimNumber}, status ${existingClaims[0].status}) already exists for invoice ${invoice.invoiceNumber}.`,
      409,
    );
  }

  const patient = await loadTenantPatient(scope.tenantId, invoice.patientId);
  const invoiceItems = await db
    .select()
    .from(schema.billingItems)
    .where(eq(schema.billingItems.invoiceId, invoice.id))
    .orderBy(asc(schema.billingItems.id));

  if (invoiceItems.length === 0) {
    throw new InsuranceDomainError(
      'EMPTY_INVOICE',
      `Invoice ${invoice.invoiceNumber} has no billable line items to assemble into an eClaim.`,
      400,
    );
  }

  // 2. Resolve clinical encounter, diagnoses, procedures, lab, radiology, pharmacy & IPD admission
  const effectiveEncounterId = input.encounterId ?? invoice.encounterId ?? null;
  let encounter: typeof schema.encounters.$inferSelect | null = null;
  if (effectiveEncounterId) {
    const [enc] = await db
      .select()
      .from(schema.encounters)
      .where(
        and(
          eq(schema.encounters.id, effectiveEncounterId),
          eq(schema.encounters.facilityId, scope.facilityId),
          eq(schema.encounters.patientId, patient.id),
        ),
      )
      .limit(1);
    encounter = enc ?? null;
  }

  const [admission] = await db
    .select()
    .from(schema.admissions)
    .where(
      and(
        eq(schema.admissions.facilityId, scope.facilityId),
        eq(schema.admissions.patientId, patient.id),
      ),
    )
    .orderBy(desc(schema.admissions.id))
    .limit(1);

  const subType: 'op' | 'ip' =
    input.subType ??
    (encounter?.encounterType === 'INPATIENT' ||
    invoiceItems.some((i) => i.sourceType === 'ADMISSION' || i.sourceType === 'BED_DAY')
      ? 'ip'
      : 'op');

  const claimType: 'institutional' | 'pharmacy' | 'professional' =
    input.claimType ??
    (invoiceItems.every((i) => i.sourceType === 'PHARMACY' || i.itemType === 'Pharmacy')
      ? 'pharmacy'
      : 'institutional');

  // Gather diagnoses from encounter or explicit override
  let diagnosesSnapshot: Array<{ code: string; display: string; system: string; type: string }> =
    [];
  if (input.diagnosesOverride && input.diagnosesOverride.length > 0) {
    diagnosesSnapshot = input.diagnosesOverride.map((d, idx) => ({
      code: d.code.trim(),
      display: d.display.trim(),
      system: d.system ?? 'ICD-11',
      type: d.type ?? (idx === 0 ? 'principal' : 'secondary'),
    }));
  } else if (encounter) {
    const encDiags = await db
      .select()
      .from(schema.diagnoses)
      .where(eq(schema.diagnoses.encounterId, encounter.id));
    diagnosesSnapshot = encDiags.map((d, idx) => {
      // Preserve the recorded coding system; never infer it from code shape
      // or silently convert a historical diagnosis for a claim.
      const isIcd11 = d.codingSystem === 'ICD-11';
      return {
        code: (isIcd11 ? d.icd11Code : d.icd10Code) ?? '',
        display: (isIcd11 ? d.icd11Title : d.icd10Description) ?? '',
        system: isIcd11 ? 'ICD-11' : 'ICD-10',
        type: idx === 0 ? 'principal' : 'secondary',
      };
    });
  }

  // Gather supporting clinical summary (lab, radiology, pharmacy, procedures, IPD discharge)
  const encounterLabOrders = encounter
    ? await db
        .select({
          id: schema.labOrders.id,
          testName: schema.labOrders.testName,
          status: schema.labOrders.status,
          clinicalNotes: schema.labOrders.clinicalNotes,
          orderedAt: schema.labOrders.orderedAt,
        })
        .from(schema.labOrders)
        .where(eq(schema.labOrders.encounterId, encounter.id))
    : [];
  const labCount = encounterLabOrders.length;
  const radiologyCount = encounter
    ? (
        await db
          .select({ id: schema.radiologyOrders.id })
          .from(schema.radiologyOrders)
          .where(eq(schema.radiologyOrders.encounterId, encounter.id))
      ).length
    : 0;
  const procedureCount = encounter
    ? (
        await db
          .select({ id: schema.clinicalProcedures.id })
          .from(schema.clinicalProcedures)
          .where(eq(schema.clinicalProcedures.encounterId, encounter.id))
      ).length
    : 0;
  const encounterMedications = encounter
    ? await db
        .select()
        .from(schema.medications)
        .where(eq(schema.medications.encounterId, encounter.id))
    : [];

  // Resolve latest eligibility check & optional preauthorization
  let eligibilityId = input.eligibilityVerificationId ?? null;
  if (!eligibilityId) {
    const [latestElig] = await db
      .select()
      .from(schema.insuranceEligibilityVerifications)
      .where(
        and(
          eq(schema.insuranceEligibilityVerifications.facilityId, scope.facilityId),
          eq(schema.insuranceEligibilityVerifications.patientId, patient.id),
          eq(schema.insuranceEligibilityVerifications.payerCode, payerCode),
        ),
      )
      .orderBy(desc(schema.insuranceEligibilityVerifications.checkedAt))
      .limit(1);
    eligibilityId = latestElig?.id ?? null;
  }

  let linkedPreauth: typeof schema.insurancePreauthorizations.$inferSelect | null = null;
  if (input.preauthorizationId) {
    const [pa] = await db
      .select()
      .from(schema.insurancePreauthorizations)
      .where(
        and(
          eq(schema.insurancePreauthorizations.id, input.preauthorizationId),
          eq(schema.insurancePreauthorizations.facilityId, scope.facilityId),
          eq(schema.insurancePreauthorizations.patientId, patient.id),
        ),
      )
      .limit(1);
    linkedPreauth = pa ?? null;
  }

  let resolvedAuthorization: typeof schema.shaPatientAuthorizations.$inferSelect | null = null;
  if (input.authorizationId) {
    const [auth] = await db
      .select()
      .from(schema.shaPatientAuthorizations)
      .where(
        and(
          eq(schema.shaPatientAuthorizations.id, input.authorizationId),
          eq(schema.shaPatientAuthorizations.facilityId, scope.facilityId),
          eq(schema.shaPatientAuthorizations.patientId, patient.id),
        ),
      )
      .limit(1);
    resolvedAuthorization = auth ?? null;
  }

  let validatedPractitionerRegulator: PractitionerRegulator | null = null;
  if (input.practitionerRegulator?.trim()) {
    const regUpper = input.practitionerRegulator.trim().toUpperCase() as PractitionerRegulator;
    if (!ALLOWED_PRACTITIONER_REGULATORS.includes(regUpper)) {
      throw new InsuranceDomainError(
        'INVALID_PRACTITIONER_REGULATOR',
        `practitionerRegulator must be one of: ${ALLOWED_PRACTITIONER_REGULATORS.join(', ')}.`,
        400,
      );
    }
    validatedPractitionerRegulator = regUpper;
  } else if (resolvedAuthorization?.practitionerRegulator) {
    validatedPractitionerRegulator =
      resolvedAuthorization.practitionerRegulator as PractitionerRegulator;
  }

  const effectiveConsentToken =
    input.consentToken?.trim() ||
    resolvedAuthorization?.consentToken ||
    linkedPreauth?.consentToken ||
    null;

  const effectiveVirtualClaimId =
    input.hieVirtualClaimId?.trim() || resolvedAuthorization?.virtualClaimId || null;

  const submissionProtocol = input.submissionProtocol ?? 'FHIR_BUNDLE';

  // Load facility service mappings
  const mappings = await db
    .select()
    .from(schema.payerServiceCodeMappings)
    .where(
      and(
        eq(schema.payerServiceCodeMappings.facilityId, scope.facilityId),
        eq(schema.payerServiceCodeMappings.payerCode, payerCode),
        eq(schema.payerServiceCodeMappings.isActive, true),
      ),
    );

  const schemeCode = (input.schemeCode ?? 'SHIF').trim().toUpperCase();
  const isPhcClaim = Boolean(input.isPhcClaim || schemeCode === 'PHC');

  const encounterDate = encounter
    ? encounter.startedAt.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const billableStart =
    subType === 'ip' && admission?.admissionDate
      ? admission.admissionDate.slice(0, 10)
      : encounterDate;
  const billableEnd =
    subType === 'ip' && admission?.dischargeDate
      ? admission.dischargeDate.slice(0, 10)
      : encounter?.endedAt
        ? encounter.endedAt.toISOString().slice(0, 10)
        : billableStart;

  // Build claim line items with decimal-safe cents arithmetic
  let totalBilledCents = 0;
  let totalClaimedCents = 0;

  const preparedLines = invoiceItems.map((bi, index) => {
    const qty = Math.max(1, bi.quantity ?? 1);
    const facUnitCents = parseMoneyToCents(bi.unitPrice) ?? 0;
    const facLineCents = multiplyMoneyCents(facUnitCents, qty);
    totalBilledCents += facLineCents;

    const matchedMapping =
      (bi.tariffId ? mappings.find((m) => m.tariffId === bi.tariffId) : undefined) ??
      (bi.tariffCode ? mappings.find((m) => m.localCode === bi.tariffCode) : undefined) ??
      null;

    const claimedUnitCents =
      isPhcClaim || matchedMapping?.isPhcZeroTariff
        ? 0
        : matchedMapping?.reimbursementTariff !== null &&
            matchedMapping?.reimbursementTariff !== undefined
          ? (parseMoneyToCents(matchedMapping.reimbursementTariff) ?? facUnitCents)
          : facUnitCents;

    const claimedNetCents = isPhcClaim ? 0 : multiplyMoneyCents(claimedUnitCents, qty);
    totalClaimedCents += claimedNetCents;

    const preauthRef =
      matchedMapping?.requiresPreauth && linkedPreauth
        ? (linkedPreauth.payerAuthReference ?? linkedPreauth.preauthNumber)
        : null;

    return {
      billingItemId: bi.id,
      tariffId: bi.tariffId ?? null,
      sequence: index + 1,
      sourceType: bi.sourceType ?? bi.itemType,
      sourceId: bi.sourceId ?? null,
      localCode: bi.tariffCode ?? matchedMapping?.localCode ?? null,
      description: bi.description,
      serviceArea: matchedMapping?.serviceArea ?? bi.itemType.toUpperCase(),
      payerServiceCode: matchedMapping?.payerServiceCode ?? null,
      payerServiceName: matchedMapping?.payerServiceName ?? null,
      fund: matchedMapping?.fund ?? schemeCode,
      paymentMechanism: matchedMapping?.paymentMechanism ?? 'FEE_FOR_SERVICE',
      servicedStart: billableStart,
      servicedEnd: billableEnd,
      quantity: qty,
      facilityUnitPrice: formatCents(facUnitCents),
      claimedUnitPrice: formatCents(claimedUnitCents),
      claimedNetAmount: formatCents(claimedNetCents),
      preauthReference: preauthRef,
    };
  });

  const copayCents =
    input.patientCopayAmount !== undefined
      ? requireMoneyCents(input.patientCopayAmount, 'patientCopayAmount')
      : 0;

  const claimNumber = await nextEclaimNumber();
  const claimUuid = randomUUID();
  const connStatus = defaultShaGatewayAdapter.getConnectionStatus();

  const created = await db.transaction(async (tx) => {
    const [claim] = await tx
      .insert(schema.shaEclaims)
      .values({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        patientId: patient.id,
        encounterId: encounter?.id ?? null,
        invoiceId: invoice.id,
        eligibilityVerificationId: eligibilityId,
        preauthorizationId: linkedPreauth?.id ?? null,
        authorizationId: resolvedAuthorization?.id ?? null,
        consentToken: effectiveConsentToken,
        submissionProtocol,
        hieVirtualClaimId: effectiveVirtualClaimId,
        dischargeReason: input.dischargeReason ?? null,
        practitionerRegNumber:
          input.practitionerRegNumber?.trim() ||
          resolvedAuthorization?.practitionerRegNumber ||
          linkedPreauth?.practitionerRegNumber ||
          null,
        practitionerRegulator: validatedPractitionerRegulator,
        payerCode,
        schemeCode,
        claimNumber,
        claimUuid,
        claimType,
        subType,
        status: 'DRAFT',
        environmentMode: connStatus.mode,
        isSimulated: connStatus.isSimulated,
        billableStart: billableStart <= billableEnd ? billableStart : billableEnd,
        billableEnd: billableEnd >= billableStart ? billableEnd : billableStart,
        totalBilledAmount: formatCents(totalBilledCents),
        totalClaimedAmount: formatCents(isPhcClaim ? 0 : totalClaimedCents),
        patientCopayAmount: formatCents(copayCents),
        isPhcClaim,
        diagnosesSnapshot,
        supportingSummary: {
          invoiceNumber: invoice.invoiceNumber,
          encounterType: encounter?.encounterType ?? null,
          referralFacility: encounter?.referralFacility ?? null,
          hasClinicalNotes: Boolean(encounter?.clinicalNotes || encounter?.chiefComplaint),
          labOrdersCount: labCount,
          radiologyOrdersCount: radiologyCount,
          proceduresCount: procedureCount,
          medicationsCount: encounterMedications.length,
          ipdAdmissionId: subType === 'ip' ? (admission?.id ?? null) : null,
          ipdDischargeSummaryPresent:
            subType === 'ip' ? Boolean(admission?.dischargeSummary) : false,
        },
        createdByUserId: scope.userId,
      })
      .returning();

    const insertedItems = await tx
      .insert(schema.shaEclaimItems)
      .values(
        preparedLines.map((line) => ({
          ...line,
          eclaimId: claim.id,
        })),
      )
      .returning();

    await tx.insert(schema.shaEclaimStatusHistory).values({
      eclaimId: claim.id,
      fromStatus: null,
      toStatus: 'DRAFT',
      source: 'SYSTEM',
      actorUserId: scope.userId,
      reason: `Prepared from JaliCare invoice ${invoice.invoiceNumber} (${insertedItems.length} line items).`,
    });

    return { claim, items: insertedItems };
  });

  await recordInsuranceAuditEvent(scope, {
    action: 'SHA_ECLAIM_PREPARED',
    resource: 'sha_eclaims',
    resourceId: created.claim.id,
    summary: {
      claimNumber: created.claim.claimNumber,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      patientId: patient.id,
      itemCount: created.items.length,
      totalBilledAmount: created.claim.totalBilledAmount,
      totalClaimedAmount: created.claim.totalClaimedAmount,
    },
  });

  // Immediately run initial validation pass so user sees actionable issues or READY_FOR_SUBMISSION
  return validateShaClaim(scope, created.claim.id);
}

export async function getShaClaimDetail(
  scope: Pick<InsuranceActorScope, 'tenantId' | 'facilityId'>,
  claimId: number,
) {
  await loadScopedFacility(scope);

  const [row] = await db
    .select({
      claim: schema.shaEclaims,
      invoiceNumber: schema.billingInvoices.invoiceNumber,
      invoiceStatus: schema.billingInvoices.status,
      patientMrn: schema.patients.mrn,
      patientFirstName: schema.patients.firstName,
      patientMiddleName: schema.patients.middleName,
      patientLastName: schema.patients.lastName,
    })
    .from(schema.shaEclaims)
    .innerJoin(schema.billingInvoices, eq(schema.billingInvoices.id, schema.shaEclaims.invoiceId))
    .innerJoin(schema.patients, eq(schema.patients.id, schema.shaEclaims.patientId))
    .where(
      and(
        eq(schema.shaEclaims.id, claimId),
        eq(schema.shaEclaims.tenantId, scope.tenantId),
        eq(schema.shaEclaims.facilityId, scope.facilityId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new InsuranceDomainError(
      'ECLAIM_NOT_FOUND',
      'SHA eClaim not found in this facility.',
      404,
    );
  }

  const items = await db
    .select()
    .from(schema.shaEclaimItems)
    .where(eq(schema.shaEclaimItems.eclaimId, row.claim.id))
    .orderBy(asc(schema.shaEclaimItems.sequence));

  const submissions = await db
    .select()
    .from(schema.shaEclaimSubmissions)
    .where(eq(schema.shaEclaimSubmissions.eclaimId, row.claim.id))
    .orderBy(desc(schema.shaEclaimSubmissions.attemptNumber));

  const statusHistory = await db
    .select()
    .from(schema.shaEclaimStatusHistory)
    .where(eq(schema.shaEclaimStatusHistory.eclaimId, row.claim.id))
    .orderBy(desc(schema.shaEclaimStatusHistory.createdAt));

  return {
    ...row.claim,
    invoiceNumber: row.invoiceNumber,
    invoiceStatus: row.invoiceStatus,
    patientMrn: row.patientMrn,
    patientName: [row.patientFirstName, row.patientMiddleName, row.patientLastName]
      .filter(Boolean)
      .join(' '),
    items,
    submissions,
    statusHistory,
  };
}

export async function listShaClaims(
  scope: Pick<InsuranceActorScope, 'tenantId' | 'facilityId'>,
  filters?: { status?: string; patientId?: number },
) {
  await loadScopedFacility(scope);

  const conditions = [
    eq(schema.shaEclaims.tenantId, scope.tenantId),
    eq(schema.shaEclaims.facilityId, scope.facilityId),
  ];
  if (filters?.status) {
    conditions.push(eq(schema.shaEclaims.status, filters.status.toUpperCase()));
  }
  if (filters?.patientId) {
    conditions.push(eq(schema.shaEclaims.patientId, filters.patientId));
  }

  const rows = await db
    .select({
      claim: schema.shaEclaims,
      invoiceNumber: schema.billingInvoices.invoiceNumber,
      patientMrn: schema.patients.mrn,
      patientFirstName: schema.patients.firstName,
      patientMiddleName: schema.patients.middleName,
      patientLastName: schema.patients.lastName,
    })
    .from(schema.shaEclaims)
    .innerJoin(schema.billingInvoices, eq(schema.billingInvoices.id, schema.shaEclaims.invoiceId))
    .innerJoin(schema.patients, eq(schema.patients.id, schema.shaEclaims.patientId))
    .where(and(...conditions))
    .orderBy(desc(schema.shaEclaims.updatedAt))
    .limit(100);

  return rows.map((r) => ({
    ...r.claim,
    invoiceNumber: r.invoiceNumber,
    patientMrn: r.patientMrn,
    patientName: [r.patientFirstName, r.patientMiddleName, r.patientLastName]
      .filter(Boolean)
      .join(' '),
  }));
}

export async function validateShaClaim(scope: InsuranceActorScope, claimId: number) {
  const facility = await loadScopedFacility(scope);
  const detail = await getShaClaimDetail(scope, claimId);

  if (
    detail.status !== 'DRAFT' &&
    detail.status !== 'VALIDATION_FAILED' &&
    detail.status !== 'READY_FOR_SUBMISSION' &&
    detail.status !== 'REJECTED'
  ) {
    throw new InsuranceDomainError(
      'CLAIM_LOCKED_FOR_VALIDATION',
      `Claim ${detail.claimNumber} is in status ${detail.status} and cannot be re-validated in place.`,
      409,
    );
  }

  const rawPatient = await loadTenantPatient(scope.tenantId, detail.patientId);
  const patient = openPatientIdentifiers(rawPatient);
  const { config: payerConfig } = await getFacilityPayerConfig(scope, detail.payerCode);

  let eligibility: typeof schema.insuranceEligibilityVerifications.$inferSelect | null = null;
  if (detail.eligibilityVerificationId) {
    const [ver] = await db
      .select()
      .from(schema.insuranceEligibilityVerifications)
      .where(eq(schema.insuranceEligibilityVerifications.id, detail.eligibilityVerificationId))
      .limit(1);
    eligibility = ver ?? null;
  }

  const duplicateOthers = await db
    .select({ id: schema.shaEclaims.id })
    .from(schema.shaEclaims)
    .where(
      and(
        eq(schema.shaEclaims.invoiceId, detail.invoiceId),
        eq(schema.shaEclaims.payerCode, detail.payerCode),
        ne(schema.shaEclaims.id, detail.id),
        ne(schema.shaEclaims.status, 'CANCELLED'),
      ),
    );

  const mappings = await db
    .select()
    .from(schema.payerServiceCodeMappings)
    .where(
      and(
        eq(schema.payerServiceCodeMappings.facilityId, scope.facilityId),
        eq(schema.payerServiceCodeMappings.payerCode, detail.payerCode),
        eq(schema.payerServiceCodeMappings.isActive, true),
      ),
    );

  const approvedRules = await db
    .select()
    .from(schema.payerBenefitRules)
    .where(
      and(
        eq(schema.payerBenefitRules.facilityId, scope.facilityId),
        eq(schema.payerBenefitRules.payerCode, detail.payerCode),
        eq(schema.payerBenefitRules.status, 'APPROVED'),
      ),
    );

  const patientPreauths = await db
    .select()
    .from(schema.insurancePreauthorizations)
    .where(
      and(
        eq(schema.insurancePreauthorizations.facilityId, scope.facilityId),
        eq(schema.insurancePreauthorizations.patientId, detail.patientId),
        eq(schema.insurancePreauthorizations.payerCode, detail.payerCode),
      ),
    );

  const [admission] =
    detail.subType === 'ip'
      ? await db
          .select()
          .from(schema.admissions)
          .where(
            and(
              eq(schema.admissions.facilityId, scope.facilityId),
              eq(schema.admissions.patientId, detail.patientId),
            ),
          )
          .orderBy(desc(schema.admissions.id))
          .limit(1)
      : [];

  const issues = evaluateClaimValidationRules({
    hasPatientShaOrNationalId: Boolean(
      patient.shaNumber || patient.nationalId || patient.dhaClientRegistryId,
    ),
    facilityRegistryCode: payerConfig.facilityRegistryCode ?? facility.mflCode ?? facility.code,
    requireVerifiedEligibility: payerConfig.requireVerifiedEligibility,
    eligibilityOutcome: eligibility?.outcome ?? null,
    isBeneficiaryAlive: eligibility?.isAlive ?? null,
    eligibilityCheckedAt: eligibility?.checkedAt ?? null,
    eligibilityMaxAgeHours: payerConfig.eligibilityMaxAgeHours,
    billableStart: detail.billableStart,
    billableEnd: detail.billableEnd,
    subType: detail.subType,
    hasAdmissionRecord: Boolean(admission),
    hasDischargeDate: Boolean(admission?.dischargeDate),
    diagnosesCount: detail.diagnosesSnapshot.length,
    diagnoses: detail.diagnosesSnapshot,
    isPhcClaim: detail.isPhcClaim,
    totalClaimedCents: parseMoneyToCents(detail.totalClaimedAmount) ?? 0,
    hasDuplicateActiveInvoiceClaim: duplicateOthers.length > 0,
    items: detail.items.map((item) => {
      const mapping = item.payerServiceCode
        ? mappings.find((m) => m.payerServiceCode === item.payerServiceCode)
        : undefined;
      const rule = item.payerServiceCode
        ? approvedRules.find((r) => r.payerServiceCode === item.payerServiceCode)
        : undefined;
      const requiresPreauth = Boolean(mapping?.requiresPreauth || rule?.requiresPreauth);

      const matchingPreauth = item.preauthReference
        ? patientPreauths.find(
            (pa) =>
              (pa.payerAuthReference === item.preauthReference ||
                pa.preauthNumber === item.preauthReference) &&
              (pa.status === 'APPROVED' || pa.status === 'PARTIALLY_APPROVED') &&
              isDateWithinWindow(item.servicedStart, pa.validFrom, pa.validUntil),
          )
        : undefined;

      return {
        sequence: item.sequence,
        description: item.description,
        payerServiceCode: item.payerServiceCode,
        servicedStart: item.servicedStart,
        servicedEnd: item.servicedEnd,
        quantity: item.quantity,
        claimedUnitCents: parseMoneyToCents(item.claimedUnitPrice) ?? 0,
        claimedNetCents: parseMoneyToCents(item.claimedNetAmount) ?? 0,
        requiresPreauth,
        preauthReference: item.preauthReference,
        preauthApprovedAndValid: Boolean(matchingPreauth),
      };
    }),
  });

  const errorCount = issues.filter((i) => i.severity === 'ERROR').length;
  const targetStatus: EclaimStatus =
    errorCount === 0 ? 'READY_FOR_SUBMISSION' : 'VALIDATION_FAILED';

  if (detail.status !== 'REJECTED') {
    assertEclaimTransition(detail.status, targetStatus);
  }

  const nextStatus = detail.status === 'REJECTED' && errorCount > 0 ? 'REJECTED' : targetStatus;

  await db.transaction(async (tx) => {
    await tx
      .update(schema.shaEclaims)
      .set({
        status: nextStatus,
        validationIssues: issues,
        updatedAt: new Date(),
      })
      .where(eq(schema.shaEclaims.id, detail.id));

    if (nextStatus !== detail.status) {
      await tx.insert(schema.shaEclaimStatusHistory).values({
        eclaimId: detail.id,
        fromStatus: detail.status,
        toStatus: nextStatus,
        source: 'VALIDATOR',
        actorUserId: scope.userId,
        reason:
          errorCount === 0
            ? 'All pre-submission validation checks passed.'
            : `${errorCount} validation error(s) require resolution before submission.`,
        metadata: { errorCount, warningCount: issues.length - errorCount },
      });
    }
  });

  await recordInsuranceAuditEvent(scope, {
    action: 'SHA_ECLAIM_VALIDATED',
    resource: 'sha_eclaims',
    resourceId: detail.id,
    summary: {
      claimNumber: detail.claimNumber,
      status: nextStatus,
      errorCount,
      warningCount: issues.length - errorCount,
    },
  });

  return getShaClaimDetail(scope, detail.id);
}

export async function submitShaClaim(
  scope: InsuranceActorScope,
  claimId: number,
  adapter: PayerGatewayAdapter = defaultShaGatewayAdapter,
  operation: 'claims.submit' | 'claims.resubmit' = 'claims.submit',
) {
  const facility = await loadScopedFacility(scope);
  let detail = await getShaClaimDetail(scope, claimId);

  if (detail.status === 'DRAFT') {
    detail = await validateShaClaim(scope, claimId);
  }

  if (detail.status === 'VALIDATION_FAILED') {
    throw new InsuranceDomainError(
      'CLAIM_VALIDATION_FAILED',
      `Claim ${detail.claimNumber} failed pre-submission validation and cannot be dispatched to SHA.`,
      422,
      { validationIssues: detail.validationIssues },
    );
  }

  if (detail.status !== 'READY_FOR_SUBMISSION') {
    throw new InsuranceDomainError(
      'INVALID_CLAIM_STATE_FOR_SUBMIT',
      `Claim ${detail.claimNumber} is in status ${detail.status}; expected READY_FOR_SUBMISSION.`,
      409,
    );
  }

  assertEclaimTransition(detail.status, 'SUBMITTED');

  const rawPatient = await loadTenantPatient(scope.tenantId, detail.patientId);
  const patient = openPatientIdentifiers(rawPatient);
  const { config: payerConfig } = await getFacilityPayerConfig(scope, detail.payerCode);
  const facilityRegistryCode =
    payerConfig.facilityRegistryCode || facility.mflCode || facility.code;

  const preAuthRefs = Array.from(
    new Set(
      detail.items
        .map((i) => i.preauthReference)
        .filter((r): r is string => typeof r === 'string' && r.trim().length > 0),
    ),
  );

  const bundleUuid = detail.submissionCount === 0 ? detail.claimUuid : randomUUID();

  // Pull real encounter medications & lab orders for FHIR R4 MedicationRequest/Dispense & DiagnosticReport
  const encounterMeds = detail.encounterId
    ? await db
        .select()
        .from(schema.medications)
        .where(eq(schema.medications.encounterId, detail.encounterId))
    : [];
  const encounterLabs = detail.encounterId
    ? await db
        .select()
        .from(schema.labOrders)
        .where(eq(schema.labOrders.encounterId, detail.encounterId))
    : [];

  const fhirBundle = buildShaFhirBundle({
    bundleUuid,
    claimUuid: detail.claimUuid,
    claimNumber: detail.claimNumber,
    use: 'claim',
    claimType: detail.claimType as 'institutional' | 'pharmacy' | 'professional',
    subType: detail.subType as 'op' | 'ip',
    schemeCode: detail.schemeCode,
    facilityRegistryCode,
    facilityName: facility.name,
    patient: {
      internalId: patient.id,
      shaNumber: patient.shaNumber,
      nationalId: patient.nationalId,
      crNumber: patient.dhaClientRegistryId,
      fullName: [patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(' '),
      firstName: patient.firstName,
      lastName: patient.lastName,
      gender: patient.gender,
      birthDate: patient.dateOfBirth,
    },
    encounterId: detail.encounterId,
    admissionDate: detail.subType === 'ip' ? detail.billableStart : null,
    dischargeDate: detail.subType === 'ip' ? detail.billableEnd : null,
    billableStart: detail.billableStart,
    billableEnd: detail.billableEnd,
    createdIso: new Date().toISOString(),
    isPhcClaim: detail.isPhcClaim,
    totalClaimedKes: detail.totalClaimedAmount,
    preAuthReferences: preAuthRefs,
    previousClaimReference: detail.previousSubmissionRef,
    attendingPractitioner:
      detail.practitionerRegNumber && detail.practitionerRegulator
        ? {
            registrationNumber: detail.practitionerRegNumber,
            regulator: detail.practitionerRegulator,
          }
        : null,
    diagnoses: detail.diagnosesSnapshot,
    items: detail.items.map((i) => ({
      sequence: i.sequence,
      payerServiceCode: i.payerServiceCode ?? 'UNMAPPED',
      payerServiceName: i.payerServiceName ?? i.description,
      servicedStart: i.servicedStart,
      servicedEnd: i.servicedEnd,
      quantity: i.quantity,
      unitPriceKes: i.claimedUnitPrice,
      netKes: i.claimedNetAmount,
    })),
    medications: encounterMeds.map((m) => {
      const isDispensed = (m.status ?? '').toLowerCase() === 'dispensed';
      return {
        id: m.id,
        drugName: m.drugName,
        dosageInstruction: `${m.dosage} ${m.frequency} (${m.duration})`,
        quantityDispensed: isDispensed ? (m.quantity ?? 1) : null,
        authoredOn: m.prescribedAt.toISOString(),
        dispensedOn: isDispensed ? m.prescribedAt.toISOString() : null,
      };
    }),
    diagnosticReports: encounterLabs.map((l) => ({
      id: l.id,
      category: 'LAB' as const,
      code: String(l.testId ?? l.id),
      display: l.testName,
      conclusion: l.clinicalNotes ?? l.status ?? 'Completed',
      effectiveDate: l.orderedAt.toISOString(),
    })),
  });

  // Validate FHIR R4 Kenya eClaims IG v0.1.0 conformance (including SNOMED CT prohibition & KES currency)
  const fhirValidation = validateShaFhirBundle(fhirBundle);
  if (!fhirValidation.valid) {
    throw new InsuranceDomainError(
      'FHIR_CLAIM_BUNDLE_INVALID',
      fhirValidation.issues
        .filter((i) => i.severity === 'ERROR')
        .map((i) => i.message)
        .join(' '),
      422,
      { issues: fhirValidation.issues },
    );
  }

  const attemptNumber = detail.submissionCount + 1;
  let gatewayRes;

  if (detail.submissionProtocol === 'HIE_VIRTUAL_CLAIM' && adapter.submitHieVirtualClaim) {
    if (!detail.consentToken && !detail.hieVirtualClaimId) {
      throw new InsuranceDomainError(
        'MISSING_HIE_VIRTUAL_CLAIM_TOKEN',
        'HIE virtual claim submission requires a consentToken or hieVirtualClaimId from SHA visit authorization.',
        400,
      );
    }
    const virtualConsentToken = detail.consentToken || detail.hieVirtualClaimId || detail.claimUuid;
    const dischargeReason =
      (detail.dischargeReason as
        'RECOVERED' | 'REFERRED' | 'ABSCONDED' | 'DECEASED' | 'OTHER' | null) ?? 'RECOVERED';
    if (detail.subType === 'op' && dischargeReason === 'DECEASED') {
      throw new InsuranceDomainError(
        'INVALID_OPD_DISCHARGE_REASON',
        'DECEASED discharge_reason is only permitted on IPD /claims/discharge, not OPD /claims/submit.',
        400,
      );
    }

    const defaultIntervention = detail.items[0]?.payerServiceCode ?? 'SHA-12-001';
    gatewayRes = await adapter.submitHieVirtualClaim({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      actorUserId: scope.userId,
      facilityRegistryOverride: facilityRegistryCode,
      consentToken: virtualConsentToken,
      subType: detail.subType as 'op' | 'ip',
      invoiceNumber: detail.invoiceNumber,
      dischargeReason,
      dischargeDate: detail.subType === 'ip' ? detail.billableEnd : null,
      practitionerRegNumber: detail.practitionerRegNumber,
      practitionerRegulator:
        (detail.practitionerRegulator as 'KMPDC' | 'COC' | 'NCK' | 'PPB' | null) ?? null,
      diagnoses: detail.diagnosesSnapshot.map((d) => ({
        icdCode: d.code,
        interventionCode: defaultIntervention,
      })),
      lines: detail.items.map((i) => ({
        interventionCode: i.payerServiceCode ?? 'UNMAPPED',
        serviceName: i.payerServiceName ?? i.description,
        unitPriceKes: i.claimedUnitPrice,
        quantity: i.quantity,
      })),
    });
  } else {
    gatewayRes = await adapter.submitBundle({
      tenantId: scope.tenantId,
      facilityId: scope.facilityId,
      actorUserId: scope.userId,
      facilityRegistryOverride: facilityRegistryCode,
      operation,
      bundleUuid,
      claimUuid: detail.claimUuid,
      fhirBundle,
    });
  }

  await db.insert(schema.shaEclaimSubmissions).values({
    eclaimId: detail.id,
    attemptNumber,
    operation: operation === 'claims.resubmit' ? 'RESUBMIT' : 'SUBMIT',
    bundleUuid,
    environmentMode: gatewayRes.mode,
    isSimulated: gatewayRes.isSimulated,
    requestCorrelationId: gatewayRes.correlationId,
    httpStatus: gatewayRes.httpStatus,
    outcome: gatewayRes.outcome,
    mediatorId: gatewayRes.mediatorId,
    payerClaimId: gatewayRes.payerReference,
    upstreamState: gatewayRes.upstreamState,
    rejectionReason: gatewayRes.rejectionReason,
    errors: gatewayRes.errors,
    submittedByUserId: scope.userId,
    acknowledgedAt: gatewayRes.accepted ? new Date() : null,
  });

  if (!gatewayRes.accepted && gatewayRes.outcome === 'FAILED') {
    // Keep claim in READY_FOR_SUBMISSION so operator can inspect gateway diagnostics & retry safely
    await db
      .update(schema.shaEclaims)
      .set({
        environmentMode: gatewayRes.mode,
        isSimulated: gatewayRes.isSimulated,
        fhirBundle,
        submissionCount: attemptNumber,
        updatedAt: new Date(),
      })
      .where(eq(schema.shaEclaims.id, detail.id));

    await db.insert(schema.shaEclaimStatusHistory).values({
      eclaimId: detail.id,
      fromStatus: detail.status,
      toStatus: detail.status,
      source: 'PAYER_GATEWAY',
      actorUserId: scope.userId,
      reason: `Dispatch attempt #${attemptNumber} failed: ${gatewayRes.rejectionReason ?? 'Gateway unavailable'}`,
      metadata: { correlationId: gatewayRes.correlationId, httpStatus: gatewayRes.httpStatus },
    });

    throw new InsuranceDomainError(
      'SHA_CLAIM_DISPATCH_FAILED',
      gatewayRes.rejectionReason ?? 'SHA AfyaLink gateway could not accept claim submission.',
      502,
      {
        correlationId: gatewayRes.correlationId,
        attemptNumber,
        errors: gatewayRes.errors,
      },
    );
  }

  const finalStatus: EclaimStatus =
    gatewayRes.outcome === 'REJECTED'
      ? 'REJECTED'
      : gatewayRes.outcome === 'APPROVED'
        ? 'ADJUDICATED'
        : gatewayRes.outcome === 'PARTIALLY_APPROVED'
          ? 'PARTIALLY_ADJUDICATED'
          : 'ACKNOWLEDGED';

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.shaEclaims)
      .set({
        status: finalStatus,
        environmentMode: gatewayRes.mode,
        isSimulated: gatewayRes.isSimulated,
        payerClaimReference: gatewayRes.payerReference ?? detail.payerClaimReference,
        mediatorId: gatewayRes.mediatorId ?? detail.mediatorId,
        rejectionReason: gatewayRes.rejectionReason,
        ...(gatewayRes.approvedAmountKes
          ? { totalApprovedAmount: gatewayRes.approvedAmountKes }
          : {}),
        fhirBundle,
        submissionCount: attemptNumber,
        submittedByUserId: scope.userId,
        submittedAt: now,
        ...(gatewayRes.accepted ? { acknowledgedAt: now } : {}),
        ...(finalStatus === 'ADJUDICATED' || finalStatus === 'PARTIALLY_ADJUDICATED'
          ? { adjudicatedAt: now }
          : {}),
        updatedAt: now,
      })
      .where(eq(schema.shaEclaims.id, detail.id));

    await tx.insert(schema.shaEclaimStatusHistory).values([
      {
        eclaimId: detail.id,
        fromStatus: detail.status,
        toStatus: 'SUBMITTED',
        source: 'OPERATOR',
        actorUserId: scope.userId,
        reason: `Submitted attempt #${attemptNumber} (${operation}).`,
        metadata: { bundleUuid, correlationId: gatewayRes.correlationId },
      },
      {
        eclaimId: detail.id,
        fromStatus: 'SUBMITTED',
        toStatus: finalStatus,
        source: gatewayRes.isSimulated ? 'SANDBOX_SIMULATION' : 'PAYER_GATEWAY',
        actorUserId: scope.userId,
        reason:
          finalStatus === 'REJECTED'
            ? (gatewayRes.rejectionReason ?? 'Rejected by payer.')
            : `Acknowledged by ${gatewayRes.isSimulated ? 'sandbox simulation' : 'SHA gateway'} (${gatewayRes.payerReference ?? 'queued'}).`,
        metadata: {
          payerClaimReference: gatewayRes.payerReference,
          mediatorId: gatewayRes.mediatorId,
          upstreamState: gatewayRes.upstreamState,
        },
      },
    ]);
  });

  await recordInsuranceAuditEvent(scope, {
    action: operation === 'claims.resubmit' ? 'SHA_ECLAIM_RESUBMITTED' : 'SHA_ECLAIM_SUBMITTED',
    resource: 'sha_eclaims',
    resourceId: detail.id,
    summary: {
      claimNumber: detail.claimNumber,
      attemptNumber,
      status: finalStatus,
      isSimulated: gatewayRes.isSimulated,
      payerClaimReference: gatewayRes.payerReference,
      correlationId: gatewayRes.correlationId,
    },
  });

  return getShaClaimDetail(scope, detail.id);
}

export interface ResubmitShaClaimInput {
  correctionNotes: string;
  preauthorizationId?: number | null;
  billableStart?: string;
  billableEnd?: string;
  diagnosesSnapshot?: Array<{ code: string; display: string; system?: string; type?: string }>;
  itemCorrections?: Array<{
    itemId: number;
    payerServiceCode?: string;
    payerServiceName?: string;
    claimedUnitPrice?: string | number;
    preauthReference?: string | null;
  }>;
}

export async function resubmitShaClaim(
  scope: InsuranceActorScope,
  claimId: number,
  input: ResubmitShaClaimInput,
  adapter: PayerGatewayAdapter = defaultShaGatewayAdapter,
) {
  await loadScopedFacility(scope);
  const detail = await getShaClaimDetail(scope, claimId);

  if (detail.status !== 'REJECTED') {
    throw new InsuranceDomainError(
      'RESUBMIT_REQUIRES_REJECTED_CLAIM',
      `Only REJECTED claims can be corrected and resubmitted (current status: ${detail.status}).`,
      409,
    );
  }

  const correctionNotes = input.correctionNotes?.trim() || '';
  if (correctionNotes.length < 5) {
    throw new InsuranceDomainError(
      'MISSING_CORRECTION_NOTES',
      'Provide correctionNotes describing what was fixed prior to resubmission.',
      400,
    );
  }

  await db.transaction(async (tx) => {
    if (Array.isArray(input.itemCorrections)) {
      for (const patch of input.itemCorrections) {
        const existingItem = detail.items.find((i) => i.id === patch.itemId);
        if (!existingItem) continue;

        const nextUnitCents =
          patch.claimedUnitPrice !== undefined
            ? requireMoneyCents(patch.claimedUnitPrice, 'claimedUnitPrice')
            : (parseMoneyToCents(existingItem.claimedUnitPrice) ?? 0);
        const nextNetCents = detail.isPhcClaim
          ? 0
          : multiplyMoneyCents(nextUnitCents, existingItem.quantity);

        await tx
          .update(schema.shaEclaimItems)
          .set({
            ...(patch.payerServiceCode !== undefined
              ? { payerServiceCode: patch.payerServiceCode.trim() }
              : {}),
            ...(patch.payerServiceName !== undefined
              ? { payerServiceName: patch.payerServiceName.trim() }
              : {}),
            claimedUnitPrice: formatCents(detail.isPhcClaim ? 0 : nextUnitCents),
            claimedNetAmount: formatCents(nextNetCents),
            ...(patch.preauthReference !== undefined
              ? { preauthReference: patch.preauthReference?.trim() || null }
              : {}),
            rejectionReason: null,
          })
          .where(eq(schema.shaEclaimItems.id, existingItem.id));
      }
    }

    const updatedItems = await tx
      .select()
      .from(schema.shaEclaimItems)
      .where(eq(schema.shaEclaimItems.eclaimId, detail.id));

    const recomputedClaimedCents = detail.isPhcClaim
      ? 0
      : updatedItems.reduce((sum, it) => sum + (parseMoneyToCents(it.claimedNetAmount) ?? 0), 0);

    await tx
      .update(schema.shaEclaims)
      .set({
        previousSubmissionRef: detail.payerClaimReference ?? detail.previousSubmissionRef,
        rejectionReason: null,
        ...(input.preauthorizationId !== undefined
          ? { preauthorizationId: input.preauthorizationId }
          : {}),
        ...(input.billableStart ? { billableStart: input.billableStart } : {}),
        ...(input.billableEnd ? { billableEnd: input.billableEnd } : {}),
        ...(input.diagnosesSnapshot
          ? {
              diagnosesSnapshot: input.diagnosesSnapshot.map((d, idx) => ({
                code: d.code.trim(),
                display: d.display.trim(),
                system: d.system ?? 'ICD-11',
                type: d.type ?? (idx === 0 ? 'principal' : 'secondary'),
              })),
            }
          : {}),
        totalClaimedAmount: formatCents(recomputedClaimedCents),
        status: 'DRAFT',
        updatedAt: new Date(),
      })
      .where(eq(schema.shaEclaims.id, detail.id));

    await tx.insert(schema.shaEclaimStatusHistory).values({
      eclaimId: detail.id,
      fromStatus: 'REJECTED',
      toStatus: 'DRAFT',
      source: 'CORRECTION',
      actorUserId: scope.userId,
      reason: `Claim corrected for resubmission: ${correctionNotes}`,
      metadata: { previousSubmissionRef: detail.payerClaimReference },
    });
  });

  // Re-validate and submit as RESUBMIT preserving full submission history
  const validated = await validateShaClaim(scope, detail.id);
  if (validated.status !== 'READY_FOR_SUBMISSION') {
    throw new InsuranceDomainError(
      'RESUBMIT_VALIDATION_FAILED',
      'Corrected claim still has validation errors that must be resolved before resubmission.',
      422,
      { validationIssues: validated.validationIssues },
    );
  }

  return submitShaClaim(scope, detail.id, adapter, 'claims.resubmit');
}

export async function refreshShaClaimStatus(
  scope: InsuranceActorScope,
  claimId: number,
  adapter: PayerGatewayAdapter = defaultShaGatewayAdapter,
) {
  const facility = await loadScopedFacility(scope);
  const detail = await getShaClaimDetail(scope, claimId);

  if (detail.submissionCount === 0) {
    return {
      claim: detail,
      gatewayStatus: {
        checked: false,
        message: 'Claim has not been submitted to SHA yet.',
      },
    };
  }

  const { config: payerConfig } = await getFacilityPayerConfig(scope, detail.payerCode);
  const facilityRegistryCode =
    payerConfig.facilityRegistryCode || facility.mflCode || facility.code;

  const statusRes = await adapter.queryClaimStatus({
    tenantId: scope.tenantId,
    facilityId: scope.facilityId,
    actorUserId: scope.userId,
    facilityRegistryOverride: facilityRegistryCode,
    claimUuid: detail.claimUuid,
    payerClaimReference: detail.payerClaimReference,
  });

  if (
    statusRes.recognized &&
    statusRes.mappedStatus &&
    statusRes.mappedStatus !== 'SUBMISSION_FAILED' &&
    statusRes.mappedStatus !== detail.status &&
    canTransitionEclaimStatus(detail.status, statusRes.mappedStatus)
  ) {
    const nextStatus = statusRes.mappedStatus;
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(schema.shaEclaims)
        .set({
          status: nextStatus,
          ...(statusRes.payerClaimReference
            ? { payerClaimReference: statusRes.payerClaimReference }
            : {}),
          ...(statusRes.approvedAmountKes
            ? { totalApprovedAmount: statusRes.approvedAmountKes }
            : {}),
          ...(statusRes.paidAmountKes ? { totalPaidAmount: statusRes.paidAmountKes } : {}),
          ...(statusRes.rejectionReason ? { rejectionReason: statusRes.rejectionReason } : {}),
          ...(nextStatus === 'ADJUDICATED' || nextStatus === 'PARTIALLY_ADJUDICATED'
            ? { adjudicatedAt: now }
            : {}),
          ...(nextStatus === 'PAID' ? { paidAt: now } : {}),
          updatedAt: now,
        })
        .where(eq(schema.shaEclaims.id, detail.id));

      await tx.insert(schema.shaEclaimStatusHistory).values({
        eclaimId: detail.id,
        fromStatus: detail.status,
        toStatus: nextStatus,
        source: statusRes.isSimulated ? 'SANDBOX_SIMULATION' : 'PAYER_STATUS_QUERY',
        actorUserId: scope.userId,
        reason:
          statusRes.rejectionReason ?? `Upstream adjudication status updated to ${nextStatus}.`,
        metadata: {
          upstreamState: statusRes.upstreamState,
          correlationId: statusRes.correlationId,
        },
      });
    });

    await recordInsuranceAuditEvent(scope, {
      action: 'SHA_ECLAIM_STATUS_REFRESHED',
      resource: 'sha_eclaims',
      resourceId: detail.id,
      summary: {
        claimNumber: detail.claimNumber,
        fromStatus: detail.status,
        toStatus: nextStatus,
        upstreamState: statusRes.upstreamState,
        isSimulated: statusRes.isSimulated,
      },
    });
  }

  const refreshed = await getShaClaimDetail(scope, detail.id);
  return {
    claim: refreshed,
    gatewayStatus: {
      checked: true,
      recognized: statusRes.recognized,
      upstreamState: statusRes.upstreamState,
      mode: statusRes.mode,
      isSimulated: statusRes.isSimulated,
      correlationId: statusRes.correlationId,
      errorMessage: statusRes.errorMessage,
    },
  };
}

/**
 * Record an authoritative adjudication decision (e.g. from SHA portal review or
 * verified callback) while strictly enforcing the server-side claim state machine.
 */
export async function recordClaimAdjudicationDecision(
  scope: InsuranceActorScope,
  claimId: number,
  input: {
    targetStatus: 'ADJUDICATED' | 'PARTIALLY_ADJUDICATED' | 'REJECTED' | 'DISPUTED' | 'CANCELLED';
    approvedAmount?: string | number | null;
    payerClaimReference?: string | null;
    reason: string;
  },
) {
  await loadScopedFacility(scope);
  const detail = await getShaClaimDetail(scope, claimId);

  assertEclaimTransition(detail.status, input.targetStatus);

  const reason = input.reason?.trim() || '';
  if (reason.length < 4) {
    throw new InsuranceDomainError('MISSING_DECISION_REASON', 'reason is required.', 400);
  }

  const approvedCents =
    input.approvedAmount !== undefined &&
    input.approvedAmount !== null &&
    input.approvedAmount !== ''
      ? requireMoneyCents(input.approvedAmount, 'approvedAmount')
      : input.targetStatus === 'ADJUDICATED'
        ? requireMoneyCents(detail.totalClaimedAmount, 'totalClaimedAmount')
        : input.targetStatus === 'REJECTED'
          ? 0
          : requireMoneyCents(detail.totalApprovedAmount, 'totalApprovedAmount');

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.shaEclaims)
      .set({
        status: input.targetStatus,
        totalApprovedAmount: formatCents(approvedCents),
        ...(input.payerClaimReference
          ? { payerClaimReference: input.payerClaimReference.trim() }
          : {}),
        ...(input.targetStatus === 'REJECTED' ? { rejectionReason: reason } : {}),
        ...(input.targetStatus === 'ADJUDICATED' || input.targetStatus === 'PARTIALLY_ADJUDICATED'
          ? { adjudicatedAt: now }
          : {}),
        updatedAt: now,
      })
      .where(eq(schema.shaEclaims.id, detail.id));

    await tx.insert(schema.shaEclaimStatusHistory).values({
      eclaimId: detail.id,
      fromStatus: detail.status,
      toStatus: input.targetStatus,
      source: 'ADJUDICATION_DECISION',
      actorUserId: scope.userId,
      reason,
      metadata: { approvedAmount: formatCents(approvedCents) },
    });
  });

  await recordInsuranceAuditEvent(scope, {
    action: 'SHA_ECLAIM_ADJUDICATION_RECORDED',
    resource: 'sha_eclaims',
    resourceId: detail.id,
    summary: {
      claimNumber: detail.claimNumber,
      fromStatus: detail.status,
      toStatus: input.targetStatus,
      approvedAmount: formatCents(approvedCents),
      reason,
    },
  });

  return getShaClaimDetail(scope, detail.id);
}

export interface IncomingShaCallbackInput {
  entityType: 'claim' | 'preauth' | 'authorization' | 'payment_notice';
  action?: string;
  externalEntityId: string;
  externalEventId?: string | null;
  upstreamStatus?: string | null;
  approvedAmountKes?: string | null;
  rejectionReason?: string | null;
  facilityRegistryCode?: string | null;
  environment?: string;
  signatureVerified: boolean;
  payloadSummary?: Record<string, unknown>;
}

/**
 * Workflow 8b: Processes verified DHA HIE status callbacks (`claim`, `preauth`,
 * `authorization`) and FHIR `PaymentNotice` pushes idempotently via `sha_callback_events`.
 */
export async function processIncomingShaWebhookEvent(input: IncomingShaCallbackInput) {
  if (!input.signatureVerified) {
    throw new InsuranceDomainError(
      'UNVERIFIED_SHA_CALLBACK',
      'SHA callback signature/secret verification failed.',
      401,
    );
  }

  // Idempotency check on externalEventId (stored in correlationId) when provided
  if (input.externalEventId) {
    const [existingEvent] = await db
      .select()
      .from(schema.shaCallbackEvents)
      .where(eq(schema.shaCallbackEvents.correlationId, input.externalEventId))
      .limit(1);
    if (existingEvent) {
      return { duplicate: true, event: existingEvent };
    }
  }

  let matchedTenantId: number | null = null;
  let matchedFacilityId: number | null = null;
  let mappedLocalStatus: string | null = null;
  let processingOutcome = 'LOGGED_UNMATCHED';

  const upperStatus = (input.upstreamStatus ?? '').trim().toUpperCase();

  if (input.entityType === 'claim') {
    const [claim] = await db
      .select()
      .from(schema.shaEclaims)
      .where(eq(schema.shaEclaims.payerClaimReference, input.externalEntityId))
      .limit(1);

    const resolvedClaim =
      claim ??
      (
        await db
          .select()
          .from(schema.shaEclaims)
          .where(eq(schema.shaEclaims.claimUuid, input.externalEntityId))
          .limit(1)
      )[0] ??
      null;

    if (resolvedClaim) {
      matchedTenantId = resolvedClaim.tenantId;
      matchedFacilityId = resolvedClaim.facilityId;

      let candidate: EclaimStatus | null = null;
      if (upperStatus === 'APPROVED' || upperStatus === 'ADJUDICATED') candidate = 'ADJUDICATED';
      else if (upperStatus === 'PARTIALLY_APPROVED' || upperStatus === 'PARTIAL')
        candidate = 'PARTIALLY_ADJUDICATED';
      else if (upperStatus === 'REJECTED' || upperStatus === 'DECLINED') candidate = 'REJECTED';
      else if (upperStatus === 'IN_REVIEW' || upperStatus === 'UNDER_REVIEW')
        candidate = 'ACKNOWLEDGED';

      if (candidate && canTransitionEclaimStatus(resolvedClaim.status, candidate)) {
        mappedLocalStatus = candidate;
        const now = new Date();
        await db.transaction(async (tx) => {
          await tx
            .update(schema.shaEclaims)
            .set({
              status: candidate,
              ...(input.approvedAmountKes ? { totalApprovedAmount: input.approvedAmountKes } : {}),
              ...(input.rejectionReason ? { rejectionReason: input.rejectionReason } : {}),
              ...(candidate === 'ADJUDICATED' || candidate === 'PARTIALLY_ADJUDICATED'
                ? { adjudicatedAt: now }
                : {}),
              updatedAt: now,
            })
            .where(eq(schema.shaEclaims.id, resolvedClaim.id));

          await tx.insert(schema.shaEclaimStatusHistory).values({
            eclaimId: resolvedClaim.id,
            fromStatus: resolvedClaim.status,
            toStatus: candidate,
            source: 'HIE_CALLBACK',
            reason:
              input.rejectionReason ??
              `DHA HIE callback transitioned claim status to ${candidate} (${upperStatus}).`,
            metadata: { externalEntityId: input.externalEntityId },
          });
        });
        processingOutcome = `APPLIED_CLAIM_${candidate}`;
      } else {
        processingOutcome = `IGNORED_STATE_${resolvedClaim.status}_TO_${upperStatus || 'UNKNOWN'}`;
      }
    }
  } else if (input.entityType === 'preauth') {
    const [preauth] = await db
      .select()
      .from(schema.insurancePreauthorizations)
      .where(eq(schema.insurancePreauthorizations.hiePreauthGuid, input.externalEntityId))
      .limit(1);

    const resolvedPreauth =
      preauth ??
      (
        await db
          .select()
          .from(schema.insurancePreauthorizations)
          .where(eq(schema.insurancePreauthorizations.payerAuthReference, input.externalEntityId))
          .limit(1)
      )[0] ??
      null;

    if (resolvedPreauth) {
      matchedTenantId = resolvedPreauth.tenantId;
      matchedFacilityId = resolvedPreauth.facilityId;
      const nextPreauthStatus =
        upperStatus === 'APPROVED' || upperStatus === 'FINALISED'
          ? 'APPROVED'
          : upperStatus === 'REJECTED' || upperStatus === 'DECLINED'
            ? 'REJECTED'
            : null;
      if (nextPreauthStatus) {
        mappedLocalStatus = nextPreauthStatus;
        await db
          .update(schema.insurancePreauthorizations)
          .set({
            status: nextPreauthStatus,
            ...(input.approvedAmountKes ? { approvedAmount: input.approvedAmountKes } : {}),
            ...(input.rejectionReason ? { rejectionReason: input.rejectionReason } : {}),
            decidedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.insurancePreauthorizations.id, resolvedPreauth.id));
        processingOutcome = `APPLIED_PREAUTH_${nextPreauthStatus}`;
      } else {
        processingOutcome = `LOGGED_PREAUTH_${upperStatus || 'STATUS'}`;
      }
    }
  }

  const [savedEvent] = await db
    .insert(schema.shaCallbackEvents)
    .values({
      tenantId: matchedTenantId,
      facilityId: matchedFacilityId,
      facilityFrCode: input.facilityRegistryCode ?? null,
      entityType: input.entityType,
      externalReference: input.externalEntityId,
      upstreamStatus: input.upstreamStatus ?? 'UNKNOWN',
      mappedLocalStatus,
      signatureVerified: input.signatureVerified,
      processingOutcome,
      payloadSummary: input.payloadSummary ?? {},
      correlationId: input.externalEventId ?? null,
    })
    .returning();

  return { duplicate: false, event: savedEvent };
}

export async function listShaCallbackEvents(
  scope: Pick<InsuranceActorScope, 'tenantId' | 'facilityId'>,
) {
  await loadScopedFacility(scope);
  return db
    .select()
    .from(schema.shaCallbackEvents)
    .where(eq(schema.shaCallbackEvents.facilityId, scope.facilityId))
    .orderBy(desc(schema.shaCallbackEvents.receivedAt))
    .limit(50);
}
