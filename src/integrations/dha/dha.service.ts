/**
 * JaliCare HMIS
 * DHA / AfyaConnect — eligibility and coverage service
 *
 * Implements exactly what the published documentation describes:
 *
 *   GET /patients/eligibility
 *   GET /patients/benefits
 *   GET /patients/benefits/interventions
 *   GET /patients/benefits/utilization
 *   GET /patients/sub-benefits
 *   GET /patients/pomsf-balances
 *
 * Two rules from the documentation are enforced here rather than left to
 * the caller:
 *
 *   * POMSF is matched as a PREFIX. Scheme names come back suffixed
 *     (POMSF-047), so exact string equality would silently report a
 *     civil servant as not covered.
 *   * `isAlive: false` blocks every subsequent transaction for that
 *     patient.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';

import type { AuthorizationContext } from '../../auth/authorization.types.ts';
import { resolveFacilityScope } from '../../auth/scope.service.ts';
import { getFacilityByIdScoped } from '../../db/queries.ts';

import { dhaCall, type DhaAuditEvent, type DhaResponse } from './dha.client.ts';
import { DhaError } from './dha.errors.ts';
import { loadDhaConfig, type DhaConfig } from './dha.config.ts';
import {
  DHA_SERVICE_AREAS,
  describeServiceAreaCoverage,
  getServiceArea,
  resolveServiceArea,
  type DhaAccessPoint,
  type DhaFund,
  type DhaPaymentMechanism,
  type DhaServiceAreaId,
  type ServiceAreaMapping,
} from './dha.service-areas.ts';

/*
 * The verdict logic lives in dha.eligibility.ts so it can be tested
 * without a database connection. Re-exported here for convenience.
 */
export {
  interpretEligibility,
  schemeMatchesPomsf,
  matchedSchemePrefixes,
  maskIdentifier,
  type EligibilityVerdict,
} from './dha.eligibility.ts';

import {
  interpretEligibility,
  maskIdentifier,
  type EligibilityVerdict,
} from './dha.eligibility.ts';

import {
  DHA_ENDPOINTS,
  DHA_IDENTIFICATION_TYPES,
  type DhaBenefit,
  type DhaEligibilityResponse,
  type DhaIdentificationType,
  type DhaIntervention,
  type DhaPaginated,
  type DhaSubBenefit,
  type DhaUtilization,
} from './dha.contracts.ts';

/* ============================================================
   AUDIT SINK
   ============================================================ */

export function createAuditSink(context: {
  tenantId?: number | null;
  facilityId?: number | null;
  userId?: number | null;
}) {
  return async (event: DhaAuditEvent): Promise<void> => {
    await db.insert(schema.dhaApiCalls).values({
      tenantId: context.tenantId ?? null,
      facilityId: context.facilityId ?? null,
      userId: context.userId ?? null,
      mode: event.mode,
      operation: event.operation,
      method: event.method,
      path: event.path,
      status: event.status,
      durationMs: event.durationMs,
      outcome: event.outcome,
      errorCode: event.errorCode,
      requestId: event.requestId,
    });
  };
}

/* ============================================================
   FACILITY + PATIENT SCOPE
   ============================================================ */

async function resolveScope(
  context: AuthorizationContext,
  requestedFacilityId?: number | string | null,
) {
  const parsed =
    requestedFacilityId === undefined ||
    requestedFacilityId === null ||
    requestedFacilityId === ''
      ? null
      : Number(requestedFacilityId);

  const facilityId = resolveFacilityScope(context, parsed);
  const facility = await getFacilityByIdScoped(context, facilityId);

  if (!facility) {
    throw new DhaError('NOT_FOUND', 'facility', 'Facility not found.');
  }

  return facility;
}

async function loadPatient(
  facility: { id: number; tenantId: number },
  patientId: number | string,
) {
  const id = Number(patientId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new DhaError('VALIDATION_FAILED', 'patient', 'A valid patient is required.');
  }

  const [patient] = await db
    .select()
    .from(schema.patients)
    .where(
      and(
        eq(schema.patients.id, id),
        eq(schema.patients.tenantId, facility.tenantId),
      ),
    )
    .limit(1);

  if (!patient) {
    throw new DhaError('NOT_FOUND', 'patient', 'Patient not found.');
  }

  return patient;
}

function identificationFor(
  patient: {
    dhaClientRegistryId?: string | null;
    nationalId?: string | null;
    shaNumber?: string | null;
  },
  override?: {
    identificationType?: string | null;
    identificationNumber?: string | null;
  },
): { type: DhaIdentificationType; number: string } {
  if (override?.identificationType && override?.identificationNumber) {
    const type = DHA_IDENTIFICATION_TYPES.find(
      (candidate) =>
        candidate.toLowerCase() === override.identificationType?.toLowerCase(),
    );

    if (!type) {
      throw new DhaError(
        'VALIDATION_FAILED',
        'eligibility.check',
        `Identification type must be one of: ${DHA_IDENTIFICATION_TYPES.join(', ')}.`,
      );
    }

    return { type, number: override.identificationNumber };
  }

  /*
   * The documentation is explicit: use the Client Registry id by
   * default, and treat the other types as fallbacks for when a CR id is
   * not yet known.
   */
  if (patient.dhaClientRegistryId) {
    return { type: 'ClientRegistry ID', number: patient.dhaClientRegistryId };
  }

  if (patient.nationalId) {
    return { type: 'National ID', number: patient.nationalId };
  }

  throw new DhaError(
    'VALIDATION_FAILED',
    'eligibility.check',
    'This patient has no Client Registry id or national ID. Record one, or resolve the patient through Patient Search first.',
  );
}

/* ============================================================
   ELIGIBILITY
   ============================================================ */

export interface EligibilityResult {
  verdict: EligibilityVerdict;
  identificationType: DhaIdentificationType;
  /** Masked for display: only the last four characters survive. */
  identificationHint: string;
  simulated: boolean;
  mode: string;
  retrievedAt: string;
  memberCrNumberRecorded: boolean;
}

export async function checkEligibilityScoped(
  context: AuthorizationContext,
  input: {
    patientId: number | string;
    facilityId?: number | string | null;
    identificationType?: string | null;
    identificationNumber?: string | null;
  },
  options: { config?: DhaConfig } = {},
): Promise<EligibilityResult> {
  const facility = await resolveScope(context, input?.facilityId);
  const patient = await loadPatient(facility, input.patientId);
  const config = options.config ?? loadDhaConfig();

  const identification = identificationFor(patient, input);

  const response: DhaResponse<DhaEligibilityResponse> = await dhaCall<DhaEligibilityResponse>(
    config,
    {
      tenantId: facility.tenantId,
      facilityId: facility.id,
      onAudit: createAuditSink({
        tenantId: facility.tenantId,
        facilityId: facility.id,
      }),
    },
    {
      operation: 'eligibility.check',
      method: 'GET',
      path: DHA_ENDPOINTS.eligibility,
      query: {
        identification_number: identification.number,
        identification_type: identification.type,
      },
    },
  );

  const verdict = interpretEligibility(response.data);

  /*
   * Record the CR id the moment SHA tells us what it is, so subsequent
   * calls use the identifier the exchange actually works in.
   */
  const memberCrNumber = verdict.memberCrNumber;
  const memberCrNumberRecorded = Boolean(memberCrNumber);

  await db
    .update(schema.patients)
    .set({
      dhaEligibilityStatus:
        verdict.deceased
          ? 'DECEASED'
          : verdict.eligible
            ? 'ELIGIBLE'
            : 'NOT_ELIGIBLE',
      dhaEligibilityCheckedAt: new Date(),
      dhaEligibilitySchemes: verdict.schemes,
      ...(memberCrNumber && !patient.dhaClientRegistryId
        ? { dhaClientRegistryId: memberCrNumber }
        : {}),
    })
    .where(eq(schema.patients.id, patient.id));

  return {
    verdict,
    identificationType: identification.type,
    identificationHint: maskIdentifier(identification.number),
    simulated: response.simulated,
    mode: response.mode,
    retrievedAt: response.retrievedAt,
    memberCrNumberRecorded,
  };
}

/* ============================================================
   COVERAGE
   ============================================================ */

async function coverageCall<T>(
  context: AuthorizationContext,
  patientId: number | string,
  facilityId: number | string | null | undefined,
  call: {
    operation: string;
    path: string;
    query: Record<string, string | number | boolean | null | undefined>;
  },
  configOverride?: DhaConfig,
): Promise<DhaResponse<T>> {
  const facility = await resolveScope(context, facilityId);
  const patient = await loadPatient(facility, patientId);

  if (!patient.dhaClientRegistryId) {
    throw new DhaError(
      'VALIDATION_FAILED',
      call.operation,
      'This patient has no Client Registry id yet. Run an eligibility check or Patient Search first.',
    );
  }

  const config = configOverride ?? loadDhaConfig();

  return dhaCall<T>(
    config,
    {
      tenantId: facility.tenantId,
      facilityId: facility.id,
      onAudit: createAuditSink({
        tenantId: facility.tenantId,
        facilityId: facility.id,
      }),
    },
    {
      operation: call.operation,
      method: 'GET',
      path: call.path,
      query: { patient_id: patient.dhaClientRegistryId, ...call.query },
    },
  );
}

export async function getBenefitsScoped(
  context: AuthorizationContext,
  patientId: number | string,
  facilityId?: number | string | null,
  config?: DhaConfig,
) {
  return coverageCall<DhaPaginated<DhaBenefit>>(context, patientId, facilityId, {
    operation: 'coverage.benefits',
    path: DHA_ENDPOINTS.benefits,
    query: {},
  }, config);
}

export async function getInterventionsScoped(
  context: AuthorizationContext,
  patientId: number | string,
  filters: {
    subBenefitCode?: string | null;
    code?: string | null;
    accessPoint?: string | null;
    search?: string | null;
    page?: number | string | null;
    pageSize?: number | string | null;
  } = {},
  facilityId?: number | string | null,
  config?: DhaConfig,
) {
  return coverageCall<DhaPaginated<DhaIntervention>>(context, patientId, facilityId, {
    operation: 'coverage.interventions',
    path: DHA_ENDPOINTS.interventions,
    query: {
      sub_benefit_code: filters.subBenefitCode ?? null,
      code: filters.code ?? null,
      access_point: filters.accessPoint ?? null,
      search: filters.search ?? null,
      page: filters.page ?? null,
      page_size: filters.pageSize ?? null,
    },
  }, config);
}

export async function getSubBenefitsScoped(
  context: AuthorizationContext,
  patientId: number | string,
  parentBenefitCode?: string | null,
  facilityId?: number | string | null,
  config?: DhaConfig,
) {
  return coverageCall<DhaPaginated<DhaSubBenefit>>(context, patientId, facilityId, {
    operation: 'coverage.subBenefits',
    path: DHA_ENDPOINTS.subBenefits,
    query: { parent_benefit_code: parentBenefitCode ?? null },
  }, config);
}

export async function getUtilizationScoped(
  context: AuthorizationContext,
  patientId: number | string,
  interventionCode: string,
  facilityId?: number | string | null,
  config?: DhaConfig,
) {
  if (!interventionCode?.trim()) {
    throw new DhaError(
      'VALIDATION_FAILED',
      'coverage.utilization',
      'An intervention code is required to read a utilization balance.',
    );
  }

  return coverageCall<DhaUtilization[]>(context, patientId, facilityId, {
    operation: 'coverage.utilization',
    path: DHA_ENDPOINTS.utilization,
    query: { intervention_code: interventionCode.trim() },
  }, config);
}

export async function getPomsfBalancesScoped(
  context: AuthorizationContext,
  patientId: number | string,
  policyYear?: string | null,
  facilityId?: number | string | null,
  config?: DhaConfig,
) {
  return coverageCall<Record<string, unknown>>(context, patientId, facilityId, {
    operation: 'coverage.pomsf',
    path: DHA_ENDPOINTS.pomsfBalances,
    query: { policy_year: policyYear ?? null },
  }, config);
}

/* ============================================================
   SERVICE-AREA MAPPINGS
   ============================================================ */

const ACCESS_POINTS: DhaAccessPoint[] = ['OP', 'IP'];
const PAYMENT_MECHANISMS: DhaPaymentMechanism[] = ['PER_DIEM', 'FEE_FOR_SERVICE'];
const FUNDS: DhaFund[] = ['SHIF', 'UHC', 'ECCIF'];

function toMapping(row: {
  serviceArea: string;
  interventionCode: string | null;
  accessPoint: string | null;
  paymentMechanism: string | null;
  fund: string | null;
  needsPreauth: boolean | null;
}): ServiceAreaMapping {
  return {
    serviceArea: row.serviceArea as DhaServiceAreaId,
    interventionCode: row.interventionCode,
    accessPoint: (row.accessPoint as DhaAccessPoint) ?? null,
    paymentMechanism: (row.paymentMechanism as DhaPaymentMechanism) ?? null,
    fund: (row.fund as DhaFund) ?? null,
    needsPreauth: row.needsPreauth ?? null,
  };
}

/**
 * Every service area, whether or not it has a code yet.
 *
 * Returning the unmapped ones is deliberate: an administrator needs to see
 * the gap, and a claim builder needs to know when it must refuse.
 */
export async function listServiceMappingsScoped(
  context: AuthorizationContext,
  facilityId?: number | string | null,
) {
  const facility = await resolveScope(context, facilityId);

  const rows = await db
    .select()
    .from(schema.dhaServiceMappings)
    .where(eq(schema.dhaServiceMappings.facilityId, facility.id));

  const byArea = new Map(rows.map((row) => [row.serviceArea, row]));
  const mappings = DHA_SERVICE_AREAS.map((area) => {
    const row = byArea.get(area.id);

    return {
      ...area,
      configured: Boolean(row),
      interventionCode: row?.interventionCode ?? null,
      configuredAccessPoint: (row?.accessPoint as DhaAccessPoint) ?? null,
      configuredPaymentMechanism:
        (row?.paymentMechanism as DhaPaymentMechanism) ?? null,
      configuredFund: (row?.fund as DhaFund) ?? null,
      configuredNeedsPreauth: row?.needsPreauth ?? null,
      notes: row?.notes ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  });

  return {
    facilityId: facility.id,
    mappings,
    coverage: describeServiceAreaCoverage(rows.map(toMapping)),
  };
}

/**
 * Record the intervention code covering one service area.
 *
 * The code is validated only for shape — it must be a plausible code, not
 * one this system recognises, because the authoritative list belongs to
 * DHA and arrives per beneficiary. A fabricated list here would be worse
 * than no list.
 */
export async function saveServiceMappingScoped(
  context: AuthorizationContext,
  input: {
    serviceArea: string;
    interventionCode: string;
    accessPoint?: string | null;
    paymentMechanism?: string | null;
    fund?: string | null;
    needsPreauth?: boolean | null;
    notes?: string | null;
    facilityId?: number | string | null;
    userId?: number | null;
  },
) {
  const facility = await resolveScope(context, input.facilityId);
  const area = getServiceArea(input.serviceArea);

  if (!area) {
    throw new DhaError(
      'VALIDATION_FAILED',
      'serviceMapping.save',
      `Service area must be one of: ${DHA_SERVICE_AREAS.map((item) => item.id).join(', ')}.`,
    );
  }

  const code = (input.interventionCode ?? '').trim();

  if (code.length === 0) {
    throw new DhaError(
      'VALIDATION_FAILED',
      'serviceMapping.save',
      'An intervention code is required. Copy it from the beneficiary intervention list or the DHA portal; it is never generated here.',
    );
  }

  if (code.length > 64 || !/^[A-Za-z0-9._\-/ ]+$/.test(code)) {
    throw new DhaError(
      'VALIDATION_FAILED',
      'serviceMapping.save',
      'The intervention code contains characters DHA codes do not use.',
    );
  }

  const accessPoint = input.accessPoint ? String(input.accessPoint).toUpperCase() : null;

  if (accessPoint && !ACCESS_POINTS.includes(accessPoint as DhaAccessPoint)) {
    throw new DhaError(
      'VALIDATION_FAILED',
      'serviceMapping.save',
      'accessPoint must be IP or OP.',
    );
  }

  const paymentMechanism = input.paymentMechanism
    ? String(input.paymentMechanism).toUpperCase()
    : null;

  if (
    paymentMechanism &&
    !PAYMENT_MECHANISMS.includes(paymentMechanism as DhaPaymentMechanism)
  ) {
    throw new DhaError(
      'VALIDATION_FAILED',
      'serviceMapping.save',
      'paymentMechanism must be PER_DIEM or FEE_FOR_SERVICE.',
    );
  }

  const fund = input.fund ? String(input.fund).toUpperCase() : null;

  if (fund && !FUNDS.includes(fund as DhaFund)) {
    throw new DhaError(
      'VALIDATION_FAILED',
      'serviceMapping.save',
      'fund must be SHIF, UHC or ECCIF.',
    );
  }

  const [saved] = await db
    .insert(schema.dhaServiceMappings)
    .values({
      tenantId: facility.tenantId,
      facilityId: facility.id,
      serviceArea: area.id,
      interventionCode: code,
      accessPoint,
      paymentMechanism,
      fund,
      needsPreauth: input.needsPreauth ?? area.expectsPreauth,
      notes: input.notes?.trim() || null,
      createdBy: input.userId ?? null,
    })
    .onConflictDoUpdate({
      target: [
        schema.dhaServiceMappings.facilityId,
        schema.dhaServiceMappings.serviceArea,
      ],
      set: {
        interventionCode: code,
        accessPoint,
        paymentMechanism,
        fund,
        needsPreauth: input.needsPreauth ?? area.expectsPreauth,
        notes: input.notes?.trim() || null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return {
    serviceArea: saved.serviceArea,
    interventionCode: saved.interventionCode,
    accessPoint: saved.accessPoint,
    paymentMechanism: saved.paymentMechanism,
    fund: saved.fund,
    needsPreauth: saved.needsPreauth,
    notes: saved.notes,
    updatedAt: saved.updatedAt,
  };
}

/**
 * Group an invoice's claimable lines by service area and attach the
 * facility's configured intervention code.
 *
 * Lines whose area has no code are returned as unmapped. The caller must
 * surface them: silently dropping a line understates the claim, and
 * guessing a code overstates it to the authority.
 */
export async function resolveInvoiceInterventionsScoped(
  context: AuthorizationContext,
  invoiceId: number | string,
  facilityId?: number | string | null,
) {
  const facility = await resolveScope(context, facilityId);
  const id = Number(invoiceId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new DhaError('VALIDATION_FAILED', 'invoice', 'A valid invoice is required.');
  }

  const [invoice] = await db
    .select()
    .from(schema.billingInvoices)
    .where(
      and(
        eq(schema.billingInvoices.id, id),
        eq(schema.billingInvoices.facilityId, facility.id),
      ),
    )
    .limit(1);

  if (!invoice) {
    throw new DhaError('NOT_FOUND', 'invoice', 'Invoice not found at this facility.');
  }

  const lines = await db
    .select()
    .from(schema.billingItems)
    .where(eq(schema.billingItems.invoiceId, invoice.id))
    .orderBy(schema.billingItems.id);

  const rows = await db
    .select()
    .from(schema.dhaServiceMappings)
    .where(eq(schema.dhaServiceMappings.facilityId, facility.id));

  const mapped = new Map(rows.map((row) => [row.serviceArea, row]));

  const groups = new Map<
    string,
    {
      serviceArea: string;
      label: string;
      interventionCode: string | null;
      accessPoint: DhaAccessPoint | null;
      paymentMechanism: DhaPaymentMechanism | null;
      fund: DhaFund | null;
      needsPreauth: boolean | null;
      lines: Array<{
        id: number;
        description: string;
        sourceType: string | null;
        quantity: number | null;
        unitPrice: string | null;
        totalAmount: string | null;
      }>;
      amountCents: number;
    }
  >();

  const unmappedLines: Array<{ id: number; description: string; reason: string }> = [];

  for (const line of lines) {
    const area = resolveServiceArea({
      sourceType: line.sourceType,
      department: line.tariffCode,
    });

    if (!area) {
      unmappedLines.push({
        id: line.id,
        description: line.description,
        reason: 'No service area could be resolved from this line.',
      });
      continue;
    }

    const config = mapped.get(area.id);
    const key = area.id;

    if (!groups.has(key)) {
      groups.set(key, {
        serviceArea: area.id,
        label: area.label,
        interventionCode: config?.interventionCode ?? null,
        accessPoint:
          (config?.accessPoint as DhaAccessPoint) ?? area.accessPoint,
        paymentMechanism:
          (config?.paymentMechanism as DhaPaymentMechanism) ?? area.paymentMechanism,
        fund: (config?.fund as DhaFund) ?? area.fund,
        needsPreauth: config?.needsPreauth ?? area.expectsPreauth,
        lines: [],
        amountCents: 0,
      });
    }

    const group = groups.get(key)!;

    group.lines.push({
      id: line.id,
      description: line.description,
      sourceType: line.sourceType,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      totalAmount: line.totalAmount,
    });

    group.amountCents += Math.round(Number(line.totalAmount ?? 0) * 100);

    if (!config?.interventionCode) {
      unmappedLines.push({
        id: line.id,
        description: line.description,
        reason: `The ${area.label} service area has no intervention code configured.`,
      });
    }
  }

  return {
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      patientId: invoice.patientId,
      totalAmount: invoice.totalAmount,
    },
    groups: Array.from(groups.values()),
    unmappedLines,
    claimable: unmappedLines.length === 0,
  };
}

/* ============================================================
   AUDIT READ
   ============================================================ */

export async function listRecentCallsScoped(
  context: AuthorizationContext,
  facilityId: number | string | null | undefined,
  limit = 50,
) {
  const facility = await resolveScope(context, facilityId);
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);

  return db
    .select()
    .from(schema.dhaApiCalls)
    .where(eq(schema.dhaApiCalls.facilityId, facility.id))
    .orderBy(schema.dhaApiCalls.id)
    .limit(capped);
}
