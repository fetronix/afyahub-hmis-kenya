import { shaPolicyGuard } from '../insurance/hub/guards.ts';
/**
 * JaliCare HMIS
 * SHA eClaims, Eligibility, Benefits, Preauthorization & Remittance Routes
 *
 * Mounted at `/api/insurance/sha` behind `requireAuth`, `requireAuthorization`,
 * and `requireFacilityModule('insurance')`.
 *
 * Enforces:
 *   - Granular RBAC permissions per action
 *   - Authoritative tenant & facility scoping (`resolveFacilityScope`)
 *   - Strict request parameter & body validation
 *   - Zero leakage of credentials, tokens, or raw internal stack traces
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requireAnyPermission, requirePermission } from '../auth/authorization.middleware.ts';
import { resolveFacilityScope, ScopeAccessError } from '../auth/scope.service.ts';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { defaultShaGatewayAdapter } from '../integrations/sha/sha.adapter.ts';
import { loadShaConfig } from '../integrations/sha/sha.config.ts';
import {
  InsuranceDomainError,
  type InsuranceActorScope,
  type PreauthStatus,
} from '../insurance/eclaims/contracts.ts';
import {
  createBenefitRule,
  getFacilityPayerConfig,
  listBenefitRules,
  listServiceCodeMappings,
  reviewBenefitRuleStatus,
  upsertFacilityPayerConfig,
  upsertServiceCodeMapping,
} from '../insurance/eclaims/configuration.service.ts';
import {
  ALLOWED_SHA_IDENTIFICATION_TYPES,
  checkPatientEligibility,
  getEligibilityVerificationById,
  listFacilityRecentEligibilityChecks,
  listPatientEligibilityHistory,
  resolvePatientClientRegistryIdentity,
  type ShaIdentificationType,
} from '../insurance/eclaims/eligibility.service.ts';
import {
  getPatientBenefitsSummary,
  lookupPatientHieCoverageAndUtilization,
  validateServiceBenefits,
} from '../insurance/eclaims/benefits.service.ts';
import {
  authorizePatientVisitConsent,
  cancelPreauthorization,
  createPreauthorization,
  getPreauthorizationById,
  listPatientVisitAuthorizations,
  listPreauthorizations,
  refreshPreauthorizationStatus,
  submitPreauthorization,
  updatePreauthorization,
} from '../insurance/eclaims/preauthorization.service.ts';
import {
  getShaClaimDetail,
  listShaCallbackEvents,
  listShaClaims,
  prepareShaClaim,
  processIncomingShaWebhookEvent,
  recordClaimAdjudicationDecision,
  refreshShaClaimStatus,
  resubmitShaClaim,
  submitShaClaim,
  validateShaClaim,
} from '../insurance/eclaims/claims-workflow.service.ts';
import {
  fetchRemittanceClaimBreakdown,
  getShaOperationalReport,
  listRemittances,
  reconcileRemittance,
  recordRemittanceAdvice,
  syncFacilityHieRemittances,
} from '../insurance/eclaims/remittance.service.ts';

const router = Router();
router.use(shaPolicyGuard);

function parsePositiveInt(value: unknown, field: string): number {
  const num = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isSafeInteger(num) || num <= 0) {
    throw new InsuranceDomainError('VALIDATION_ERROR', `${field} must be a positive integer.`, 400);
  }
  return num;
}

function parseOptionalPositiveInt(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return parsePositiveInt(value, field);
}

function bodyObject(req: AuthRequest): Record<string, unknown> {
  if (typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body)) {
    return req.body as Record<string, unknown>;
  }
  return {};
}

async function resolveActorScope(req: AuthRequest): Promise<InsuranceActorScope> {
  const context = req.authContext;
  if (!context) {
    throw new InsuranceDomainError(
      'AUTHORIZATION_CONTEXT_MISSING',
      'Authentication and authorization context are required.',
      401,
    );
  }

  const body = bodyObject(req);
  const rawQueryFac = req.query.facilityId;
  const requestedFacilityId =
    body.facilityId !== undefined && body.facilityId !== null && body.facilityId !== ''
      ? parsePositiveInt(body.facilityId, 'facilityId')
      : rawQueryFac !== undefined && rawQueryFac !== null && rawQueryFac !== ''
        ? parsePositiveInt(rawQueryFac, 'facilityId')
        : undefined;

  const facilityId = resolveFacilityScope(context, requestedFacilityId);

  const [facility] = await db
    .select()
    .from(schema.facilities)
    .where(eq(schema.facilities.id, facilityId))
    .limit(1);

  if (!facility) {
    throw new InsuranceDomainError('FACILITY_NOT_FOUND', 'Target facility does not exist.', 404);
  }

  if (!context.isSuperAdmin && context.tenantId !== facility.tenantId) {
    throw new ScopeAccessError(
      'You are not authorized to access this tenant facility.',
      'TENANT_ACCESS_DENIED',
    );
  }

  return {
    tenantId: facility.tenantId,
    facilityId: facility.id,
    userId: context.userId,
    userUid: req.user?.uid ?? `user-${context.userId}`,
    userEmail: req.user?.email ?? null,
    ipAddress: req.ip ?? null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  };
}

function respondShaError(res: Response, err: unknown, fallbackMessage: string): Response {
  if (err instanceof ScopeAccessError) {
    const status = err.code === 'INVALID_SCOPE_ID' || err.code === 'FACILITY_REQUIRED' ? 400 : 403;
    return res.status(status).json({
      success: false,
      error: err.code,
      message: err.message,
    });
  }

  if (err instanceof InsuranceDomainError) {
    return res.status(err.httpStatus).json({
      success: false,
      error: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
  }

  console.error('[sha-eclaims]', fallbackMessage, 'Operation failed; details withheld.');
  return res.status(500).json({
    success: false,
    error: 'INTERNAL_SERVER_ERROR',
    message: fallbackMessage,
  });
}

/* ============================================================
   1. CONNECTION STATUS & FACILITY CONFIGURATION
   ============================================================ */

router.get(
  '/connection-status',
  requireAnyPermission('insurance.sha.read', 'insurance.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const { config: payerConfig, facility } = await getFacilityPayerConfig(scope, 'SHA');
      const status = defaultShaGatewayAdapter.getConnectionStatus(
        payerConfig.facilityRegistryCode ?? facility.mflCode,
      );

      return res.json({
        success: true,
        connection: {
          ...status,
          enabled: false,
          disabledReason:
            'SHA/DHA transport is blocked in the application. Mock adapters are used only in isolated tests; live use requires facility-specific authorization and verification.',
          middlewareBaseUrl: null,
          eclaimsBaseUrl: null,
          hasClientId: false,
          hasClientSecret: false,
          hasWebhookSecret: false,
          capabilities: [], // No operational external capability has been authorized.
        },
        facilityConfig: {
          facilityId: facility.id,
          facilityName: facility.name,
          facilityLevel: payerConfig.accreditationLevel ?? facility.level,
          facilityRegistryCode: payerConfig.facilityRegistryCode ?? facility.mflCode ?? null,
          contractedSchemes: payerConfig.contractedSchemes,
          defaultCodingSystem: payerConfig.defaultCodingSystem,
          requireVerifiedEligibility: payerConfig.requireVerifiedEligibility,
          eligibilityMaxAgeHours: payerConfig.eligibilityMaxAgeHours,
        },
      });
    } catch (err) {
      return respondShaError(res, err, 'Failed to inspect SHA connection status.');
    }
  },
);

router.get(
  '/configuration',
  requireAnyPermission('insurance.sha.read', 'insurance.sha.configuration.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const result = await getFacilityPayerConfig(scope, 'SHA');
      const { config } = result;
      return res.json({
        success: true,
        config: {
          id: config.id,
          tenantId: config.tenantId,
          facilityId: config.facilityId,
          payerCode: config.payerCode,
          payerName: config.payerName,
          facilityRegistryCode: config.facilityRegistryCode,
          accreditationLevel: config.accreditationLevel,
          contractedSchemes: config.contractedSchemes,
          defaultCodingSystem: config.defaultCodingSystem,
          requireVerifiedEligibility: config.requireVerifiedEligibility,
          eligibilityMaxAgeHours: config.eligibilityMaxAgeHours,
          isActive: config.isActive,
          notes: config.notes,
        },
      });
    } catch (err) {
      return respondShaError(res, err, 'Failed to load SHA payer configuration.');
    }
  },
);

router.put(
  '/configuration',
  requirePermission('insurance.sha.configuration.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const b = bodyObject(req);
      const saved = await upsertFacilityPayerConfig(scope, {
        payerCode: typeof b.payerCode === 'string' ? b.payerCode : 'SHA',
        payerName: typeof b.payerName === 'string' ? b.payerName : undefined,
        facilityRegistryCode:
          b.facilityRegistryCode !== undefined ? String(b.facilityRegistryCode ?? '') : undefined,
        accreditationLevel:
          b.accreditationLevel !== undefined ? String(b.accreditationLevel ?? '') : undefined,
        contractedSchemes: Array.isArray(b.contractedSchemes)
          ? b.contractedSchemes.map(String)
          : undefined,
        defaultCodingSystem:
          b.defaultCodingSystem === 'ICD-10' || b.defaultCodingSystem === 'ICD-11'
            ? b.defaultCodingSystem
            : undefined,
        requireVerifiedEligibility:
          typeof b.requireVerifiedEligibility === 'boolean'
            ? b.requireVerifiedEligibility
            : undefined,
        eligibilityMaxAgeHours:
          b.eligibilityMaxAgeHours !== undefined ? Number(b.eligibilityMaxAgeHours) : undefined,
        notes: b.notes !== undefined ? String(b.notes ?? '') : undefined,
      });

      return res.json({
        success: true,
        config: {
          id: saved.id,
          payerCode: saved.payerCode,
          payerName: saved.payerName,
          facilityRegistryCode: saved.facilityRegistryCode,
          accreditationLevel: saved.accreditationLevel,
          contractedSchemes: saved.contractedSchemes,
          defaultCodingSystem: saved.defaultCodingSystem,
          requireVerifiedEligibility: saved.requireVerifiedEligibility,
          eligibilityMaxAgeHours: saved.eligibilityMaxAgeHours,
          isActive: saved.isActive,
          notes: saved.notes,
        },
      });
    } catch (err) {
      return respondShaError(res, err, 'Failed to update SHA payer configuration.');
    }
  },
);

/* ============================================================
   2. PAYER SERVICE CODE MAPPINGS & BENEFIT RULES
   ============================================================ */

router.get(
  '/service-mappings',
  requireAnyPermission(
    'insurance.sha.read',
    'insurance.sha.claims.prepare',
    'insurance.sha.configuration.manage',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const result = await listServiceCodeMappings(scope, 'SHA');
      return res.json({ success: true, ...result });
    } catch (err) {
      return respondShaError(res, err, 'Failed to list SHA service code mappings.');
    }
  },
);

router.post(
  '/service-mappings',
  requirePermission('insurance.sha.configuration.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const b = bodyObject(req);
      const saved = await upsertServiceCodeMapping(scope, {
        tariffId: parseOptionalPositiveInt(b.tariffId, 'tariffId'),
        localCode: String(b.localCode ?? ''),
        localDescription: String(b.localDescription ?? ''),
        serviceArea: String(b.serviceArea ?? ''),
        payerServiceCode: String(b.payerServiceCode ?? ''),
        payerServiceName: String(b.payerServiceName ?? ''),
        fund: typeof b.fund === 'string' ? b.fund : undefined,
        accessPoint:
          b.accessPoint === 'OP' || b.accessPoint === 'IP' || b.accessPoint === 'BOTH'
            ? b.accessPoint
            : undefined,
        paymentMechanism: typeof b.paymentMechanism === 'string' ? b.paymentMechanism : undefined,
        reimbursementTariff:
          b.reimbursementTariff !== undefined && b.reimbursementTariff !== null
            ? (b.reimbursementTariff as string | number)
            : null,
        isPhcZeroTariff: Boolean(b.isPhcZeroTariff),
        requiresPreauth: Boolean(b.requiresPreauth),
        preauthCategory: typeof b.preauthCategory === 'string' ? b.preauthCategory : null,
        requiresReferral: Boolean(b.requiresReferral),
        requiresClinicalNotes:
          typeof b.requiresClinicalNotes === 'boolean' ? b.requiresClinicalNotes : true,
        effectiveFrom: typeof b.effectiveFrom === 'string' ? b.effectiveFrom : null,
        effectiveTo: typeof b.effectiveTo === 'string' ? b.effectiveTo : null,
        isActive: typeof b.isActive === 'boolean' ? b.isActive : true,
        notes: typeof b.notes === 'string' ? b.notes : null,
      });

      return res.status(201).json({ success: true, mapping: saved });
    } catch (err) {
      return respondShaError(res, err, 'Failed to save SHA service code mapping.');
    }
  },
);

router.get(
  '/benefit-rules',
  requireAnyPermission(
    'insurance.sha.read',
    'insurance.sha.benefits.validate',
    'insurance.sha.configuration.manage',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const rules = await listBenefitRules(scope, 'SHA');
      return res.json({ success: true, rules });
    } catch (err) {
      return respondShaError(res, err, 'Failed to list SHA benefit rules.');
    }
  },
);

router.post(
  '/benefit-rules',
  requirePermission('insurance.sha.configuration.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const b = bodyObject(req);
      const created = await createBenefitRule(scope, {
        ruleCode: String(b.ruleCode ?? ''),
        benefitPackage: String(b.benefitPackage ?? ''),
        serviceCategory: String(b.serviceCategory ?? ''),
        payerServiceCode: typeof b.payerServiceCode === 'string' ? b.payerServiceCode : null,
        minFacilityLevel: typeof b.minFacilityLevel === 'string' ? b.minFacilityLevel : null,
        requiresPreauth: Boolean(b.requiresPreauth),
        requiresReferral: Boolean(b.requiresReferral),
        requiredEvidence: Array.isArray(b.requiredEvidence) ? b.requiredEvidence.map(String) : [],
        copayType:
          b.copayType === 'NONE' || b.copayType === 'FIXED' || b.copayType === 'PERCENTAGE'
            ? b.copayType
            : undefined,
        copayValue: b.copayValue !== undefined ? (b.copayValue as string | number) : undefined,
        annualLimit: b.annualLimit !== undefined ? (b.annualLimit as string | number | null) : null,
        perVisitLimit:
          b.perVisitLimit !== undefined ? (b.perVisitLimit as string | number | null) : null,
        exclusionNotes: typeof b.exclusionNotes === 'string' ? b.exclusionNotes : null,
        sourceReference: String(b.sourceReference ?? ''),
        effectiveFrom: String(b.effectiveFrom ?? ''),
        effectiveTo: typeof b.effectiveTo === 'string' ? b.effectiveTo : null,
      });

      return res.status(201).json({ success: true, rule: created });
    } catch (err) {
      return respondShaError(res, err, 'Failed to create SHA benefit rule.');
    }
  },
);

router.post(
  '/benefit-rules/:ruleId/review',
  requirePermission('insurance.sha.configuration.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const ruleId = parsePositiveInt(req.params.ruleId, 'ruleId');
      const b = bodyObject(req);
      const action = String(b.action ?? '').toUpperCase();
      if (action !== 'APPROVE' && action !== 'RETIRE') {
        throw new InsuranceDomainError(
          'INVALID_REVIEW_ACTION',
          'action must be APPROVE or RETIRE.',
          400,
        );
      }

      const rule = await reviewBenefitRuleStatus(scope, ruleId, action);
      return res.json({ success: true, rule });
    } catch (err) {
      return respondShaError(res, err, 'Failed to update SHA benefit rule status.');
    }
  },
);

/* ============================================================
   3. ELIGIBILITY VERIFICATION & CLIENT REGISTRY RESOLUTION
   ============================================================ */

router.post(
  '/registry/patient-search',
  requirePermission('insurance.sha.eligibility.check'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const b = bodyObject(req);
      const patientId = parsePositiveInt(b.patientId, 'patientId');
      let identificationType: ShaIdentificationType | undefined;
      if (typeof b.identificationType === 'string' && b.identificationType.trim()) {
        const candidate = b.identificationType.trim().toUpperCase() as ShaIdentificationType;
        if (!ALLOWED_SHA_IDENTIFICATION_TYPES.includes(candidate)) {
          throw new InsuranceDomainError(
            'INVALID_IDENTIFICATION_TYPE',
            `identificationType must be one of: ${ALLOWED_SHA_IDENTIFICATION_TYPES.join(', ')}.`,
            400,
          );
        }
        identificationType = candidate;
      }

      const result = await resolvePatientClientRegistryIdentity(scope, {
        patientId,
        identificationType,
        identificationValue:
          typeof b.identificationValue === 'string' ? b.identificationValue : null,
      });

      return res.json({ success: true, ...result });
    } catch (err) {
      return respondShaError(res, err, 'Failed to resolve DHA Client Registry patient identity.');
    }
  },
);

router.get(
  '/eligibility',
  requireAnyPermission('insurance.sha.read', 'insurance.sha.eligibility.check'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const verifications = await listFacilityRecentEligibilityChecks(scope, 50);
      return res.json({ success: true, verifications });
    } catch (err) {
      return respondShaError(res, err, 'Failed to load recent SHA eligibility checks.');
    }
  },
);

router.post(
  '/eligibility/check',
  requirePermission('insurance.sha.eligibility.check'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const b = bodyObject(req);
      const patientId = parsePositiveInt(b.patientId, 'patientId');
      const encounterId = parseOptionalPositiveInt(b.encounterId, 'encounterId');

      let identificationType: ShaIdentificationType | undefined;
      if (typeof b.identificationType === 'string' && b.identificationType.trim()) {
        const candidate = b.identificationType.trim().toUpperCase() as ShaIdentificationType;
        if (!ALLOWED_SHA_IDENTIFICATION_TYPES.includes(candidate)) {
          throw new InsuranceDomainError(
            'INVALID_IDENTIFICATION_TYPE',
            `identificationType must be one of: ${ALLOWED_SHA_IDENTIFICATION_TYPES.join(', ')}.`,
            400,
          );
        }
        identificationType = candidate;
      }

      const result = await checkPatientEligibility(scope, {
        patientId,
        encounterId,
        identificationType,
        identificationValue:
          typeof b.identificationValue === 'string' ? b.identificationValue : null,
        intendedServiceArea:
          typeof b.intendedServiceArea === 'string' ? b.intendedServiceArea : null,
      });

      return res.status(201).json({ success: true, ...result });
    } catch (err) {
      return respondShaError(res, err, 'Failed to execute SHA eligibility verification.');
    }
  },
);

router.get(
  '/eligibility/:verificationId',
  requireAnyPermission('insurance.sha.read', 'insurance.sha.eligibility.check'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const verificationId = parsePositiveInt(req.params.verificationId, 'verificationId');
      const verification = await getEligibilityVerificationById(scope, verificationId);
      return res.json({ success: true, verification });
    } catch (err) {
      return respondShaError(res, err, 'Failed to load SHA eligibility verification.');
    }
  },
);

router.get(
  '/patients/:patientId/eligibility-history',
  requireAnyPermission('insurance.sha.read', 'insurance.sha.eligibility.check'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const patientId = parsePositiveInt(req.params.patientId, 'patientId');
      const result = await listPatientEligibilityHistory(scope, patientId);
      return res.json({ success: true, ...result });
    } catch (err) {
      return respondShaError(res, err, 'Failed to load patient SHA eligibility history.');
    }
  },
);

/* ============================================================
   4. BENEFITS & SERVICE COVERAGE VALIDATION
   ============================================================ */

router.post(
  '/benefits/validate',
  requirePermission('insurance.sha.benefits.validate'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const b = bodyObject(req);
      const patientId = parsePositiveInt(b.patientId, 'patientId');

      const result = await validateServiceBenefits(scope, {
        patientId,
        encounterId: parseOptionalPositiveInt(b.encounterId, 'encounterId'),
        eligibilityVerificationId: parseOptionalPositiveInt(
          b.eligibilityVerificationId,
          'eligibilityVerificationId',
        ),
        tariffId: parseOptionalPositiveInt(b.tariffId, 'tariffId'),
        localCode: typeof b.localCode === 'string' ? b.localCode : null,
        serviceDescription: typeof b.serviceDescription === 'string' ? b.serviceDescription : null,
        serviceCategory: typeof b.serviceCategory === 'string' ? b.serviceCategory : null,
        benefitPackage: typeof b.benefitPackage === 'string' ? b.benefitPackage : null,
        serviceDate: typeof b.serviceDate === 'string' ? b.serviceDate : undefined,
        quantity: b.quantity !== undefined ? parsePositiveInt(b.quantity, 'quantity') : 1,
        facilityUnitAmount:
          b.facilityUnitAmount !== undefined
            ? (b.facilityUnitAmount as string | number | null)
            : null,
        preauthReference: typeof b.preauthReference === 'string' ? b.preauthReference : null,
        hasReferralOverride: typeof b.hasReferral === 'boolean' ? b.hasReferral : undefined,
        hasClinicalNotesOverride:
          typeof b.hasClinicalNotes === 'boolean' ? b.hasClinicalNotes : undefined,
      });

      return res.status(201).json({ success: true, ...result });
    } catch (err) {
      return respondShaError(res, err, 'Failed to validate SHA service benefits.');
    }
  },
);

router.get(
  '/patients/:patientId/benefits',
  requireAnyPermission('insurance.sha.read', 'insurance.sha.benefits.validate'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const patientId = parsePositiveInt(req.params.patientId, 'patientId');
      const result = await getPatientBenefitsSummary(scope, patientId, 'SHA');
      return res.json({ success: true, ...result });
    } catch (err) {
      return respondShaError(res, err, 'Failed to load patient SHA benefits summary.');
    }
  },
);

router.post(
  '/benefits/hie-lookup',
  requirePermission('insurance.sha.benefits.validate'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const b = bodyObject(req);
      const patientId = parsePositiveInt(b.patientId, 'patientId');

      const result = await lookupPatientHieCoverageAndUtilization(scope, {
        patientId,
        memberCrNumber: typeof b.memberCrNumber === 'string' ? b.memberCrNumber : null,
        parentBenefitCode: typeof b.parentBenefitCode === 'string' ? b.parentBenefitCode : null,
        subBenefitCode: typeof b.subBenefitCode === 'string' ? b.subBenefitCode : null,
        interventionCode: typeof b.interventionCode === 'string' ? b.interventionCode : null,
        accessPoint: typeof b.accessPoint === 'string' ? b.accessPoint : null,
        search: typeof b.search === 'string' ? b.search : null,
        includePomsfBalances: Boolean(b.includePomsfBalances),
        includeBedOccupancy: Boolean(b.includeBedOccupancy),
      });

      return res.json({ success: true, ...result });
    } catch (err) {
      return respondShaError(res, err, 'Failed to query DHA HIE benefits and utilization.');
    }
  },
);

/* ============================================================
   5. BENEFICIARY CONSENT AUTHORIZATIONS & PREAUTHORIZATIONS
   ============================================================ */

router.get(
  '/authorizations',
  requireAnyPermission(
    'insurance.sha.read',
    'insurance.sha.preauthorization.create',
    'insurance.sha.claims.prepare',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const patientId =
        req.query.patientId !== undefined && req.query.patientId !== ''
          ? parsePositiveInt(req.query.patientId, 'patientId')
          : undefined;
      const authorizations = await listPatientVisitAuthorizations(scope, patientId);
      return res.json({ success: true, authorizations });
    } catch (err) {
      return respondShaError(res, err, 'Failed to list SHA visit consent authorizations.');
    }
  },
);

router.post(
  '/authorizations/consent',
  requirePermission('insurance.sha.preauthorization.create'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const b = bodyObject(req);
      const patientId = parsePositiveInt(b.patientId, 'patientId');
      const interventions = Array.isArray(b.interventions) ? b.interventions.map(String) : [];

      const authorization = await authorizePatientVisitConsent(scope, {
        patientId,
        encounterId: parseOptionalPositiveInt(b.encounterId, 'encounterId'),
        memberCrNumber: typeof b.memberCrNumber === 'string' ? b.memberCrNumber : null,
        serviceType:
          b.serviceType === 'INPATIENT' ||
          b.serviceType === 'EMERGENCY' ||
          b.serviceType === 'CAPITATION'
            ? b.serviceType
            : 'OUTPATIENT',
        consentMethod:
          b.consentMethod === 'BIOMETRICS' || b.consentMethod === 'MINORS_BIOMETRICS'
            ? b.consentMethod
            : 'OTP',
        otp: typeof b.otp === 'string' ? b.otp : null,
        biometricPayloadRef:
          typeof b.biometricPayloadRef === 'string' ? b.biometricPayloadRef : null,
        interventions,
        isElectivePreVisit: Boolean(b.isElectivePreVisit),
        startVirtualClaimImmediately: Boolean(b.startVirtualClaimImmediately),
        selectedPomsfScheme:
          typeof b.selectedPomsfScheme === 'string' ? b.selectedPomsfScheme : null,
        practitionerRegNumber:
          typeof b.practitionerRegNumber === 'string' ? b.practitionerRegNumber : null,
        practitionerRegulator:
          b.practitionerRegulator === 'KMPDC' ||
          b.practitionerRegulator === 'COC' ||
          b.practitionerRegulator === 'NCK' ||
          b.practitionerRegulator === 'PPB'
            ? b.practitionerRegulator
            : null,
      });

      return res.status(201).json({ success: true, authorization });
    } catch (err) {
      return respondShaError(res, err, 'Failed to authorize SHA beneficiary visit consent.');
    }
  },
);

router.get(
  '/preauthorizations',
  requireAnyPermission(
    'insurance.sha.read',
    'insurance.sha.preauthorization.create',
    'insurance.sha.claims.read',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const patientId =
        req.query.patientId !== undefined && req.query.patientId !== ''
          ? parsePositiveInt(req.query.patientId, 'patientId')
          : undefined;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;

      const preauthorizations = await listPreauthorizations(scope, { patientId, status });
      return res.json({ success: true, preauthorizations });
    } catch (err) {
      return respondShaError(res, err, 'Failed to list SHA preauthorizations.');
    }
  },
);

router.post(
  '/preauthorizations',
  requirePermission('insurance.sha.preauthorization.create'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const b = bodyObject(req);
      const patientId = parsePositiveInt(b.patientId, 'patientId');

      const created = await createPreauthorization(scope, {
        patientId,
        encounterId: parseOptionalPositiveInt(b.encounterId, 'encounterId'),
        eligibilityVerificationId: parseOptionalPositiveInt(
          b.eligibilityVerificationId,
          'eligibilityVerificationId',
        ),
        authorizationId: parseOptionalPositiveInt(b.authorizationId, 'authorizationId'),
        consentToken: typeof b.consentToken === 'string' ? b.consentToken : null,
        tariffId: parseOptionalPositiveInt(b.tariffId, 'tariffId'),
        category: typeof b.category === 'string' ? b.category : 'GENERAL',
        isElective: Boolean(b.isElective),
        needsDoctorAuthorization: Boolean(b.needsDoctorAuthorization),
        practitionerRegNumber:
          typeof b.practitionerRegNumber === 'string' ? b.practitionerRegNumber : null,
        practitionerRegulator:
          typeof b.practitionerRegulator === 'string' ? b.practitionerRegulator : null,
        requiredDocuments: Array.isArray(b.requiredDocuments)
          ? b.requiredDocuments.map(String)
          : [],
        clinicalIndication: String(b.clinicalIndication ?? ''),
        primaryDiagnosisCode: String(b.primaryDiagnosisCode ?? ''),
        primaryDiagnosisDisplay: String(b.primaryDiagnosisDisplay ?? ''),
        codingSystem: b.codingSystem === 'ICD-10' ? 'ICD-10' : 'ICD-11',
        requestedServiceCode: String(b.requestedServiceCode ?? ''),
        requestedServiceName: String(b.requestedServiceName ?? ''),
        quantity: b.quantity !== undefined ? parsePositiveInt(b.quantity, 'quantity') : 1,
        estimatedAmount: (b.estimatedAmount ?? '') as string | number,
        supportingNotes: typeof b.supportingNotes === 'string' ? b.supportingNotes : null,
      });

      return res.status(201).json({ success: true, preauthorization: created });
    } catch (err) {
      return respondShaError(res, err, 'Failed to create SHA preauthorization request.');
    }
  },
);

router.get(
  '/preauthorizations/:id',
  requireAnyPermission(
    'insurance.sha.read',
    'insurance.sha.preauthorization.create',
    'insurance.sha.claims.read',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const preauthId = parsePositiveInt(req.params.id, 'id');
      const preauthorization = await getPreauthorizationById(scope, preauthId);
      return res.json({ success: true, preauthorization });
    } catch (err) {
      return respondShaError(res, err, 'Failed to load SHA preauthorization.');
    }
  },
);

router.patch(
  '/preauthorizations/:id',
  requirePermission('insurance.sha.preauthorization.create'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const preauthId = parsePositiveInt(req.params.id, 'id');
      const b = bodyObject(req);

      const updated = await updatePreauthorization(scope, preauthId, {
        clinicalIndication:
          typeof b.clinicalIndication === 'string' ? b.clinicalIndication : undefined,
        primaryDiagnosisCode:
          typeof b.primaryDiagnosisCode === 'string' ? b.primaryDiagnosisCode : undefined,
        primaryDiagnosisDisplay:
          typeof b.primaryDiagnosisDisplay === 'string' ? b.primaryDiagnosisDisplay : undefined,
        requestedServiceCode:
          typeof b.requestedServiceCode === 'string' ? b.requestedServiceCode : undefined,
        requestedServiceName:
          typeof b.requestedServiceName === 'string' ? b.requestedServiceName : undefined,
        quantity: b.quantity !== undefined ? parsePositiveInt(b.quantity, 'quantity') : undefined,
        estimatedAmount:
          b.estimatedAmount !== undefined ? (b.estimatedAmount as string | number) : undefined,
        supportingNotes:
          b.supportingNotes !== undefined ? String(b.supportingNotes ?? '') : undefined,
        amendmentReason: typeof b.amendmentReason === 'string' ? b.amendmentReason : undefined,
        status:
          typeof b.status === 'string' ? (b.status.toUpperCase() as PreauthStatus) : undefined,
        payerAuthReference:
          b.payerAuthReference !== undefined ? String(b.payerAuthReference ?? '') : undefined,
        approvedAmount:
          b.approvedAmount !== undefined ? (b.approvedAmount as string | number | null) : undefined,
        conditions: b.conditions !== undefined ? String(b.conditions ?? '') : undefined,
        validFrom: typeof b.validFrom === 'string' ? b.validFrom : undefined,
        validUntil: typeof b.validUntil === 'string' ? b.validUntil : undefined,
        rejectionReason:
          b.rejectionReason !== undefined ? String(b.rejectionReason ?? '') : undefined,
      });

      return res.json({ success: true, preauthorization: updated });
    } catch (err) {
      return respondShaError(res, err, 'Failed to update SHA preauthorization.');
    }
  },
);

router.post(
  '/preauthorizations/:id/submit',
  requirePermission('insurance.sha.preauthorization.create'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const preauthId = parsePositiveInt(req.params.id, 'id');
      const b = bodyObject(req);
      const protocol = b.protocol === 'HIE_PREAUTH' ? 'HIE_PREAUTH' : 'FHIR_BUNDLE';
      const result = await submitPreauthorization(scope, preauthId, defaultShaGatewayAdapter, {
        protocol,
        consentToken: typeof b.consentToken === 'string' ? b.consentToken : null,
        serviceStart: typeof b.serviceStart === 'string' ? b.serviceStart : undefined,
        serviceEnd: typeof b.serviceEnd === 'string' ? b.serviceEnd : undefined,
        subType: b.subType === 'op' || b.subType === 'ip' ? b.subType : undefined,
        schemeCode: typeof b.schemeCode === 'string' ? b.schemeCode : undefined,
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      return respondShaError(res, err, 'Failed to submit SHA preauthorization.');
    }
  },
);

router.get(
  '/preauthorizations/:id/status',
  requireAnyPermission('insurance.sha.read', 'insurance.sha.preauthorization.create'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const preauthId = parsePositiveInt(req.params.id, 'id');
      const result = await refreshPreauthorizationStatus(scope, preauthId);
      return res.json({ success: true, ...result });
    } catch (err) {
      return respondShaError(res, err, 'Failed to refresh SHA preauthorization status.');
    }
  },
);

router.post(
  '/preauthorizations/:id/cancel',
  requirePermission('insurance.sha.preauthorization.create'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const preauthId = parsePositiveInt(req.params.id, 'id');
      const b = bodyObject(req);
      const result = await cancelPreauthorization(scope, preauthId, String(b.reason ?? ''));
      return res.json({ success: true, ...result });
    } catch (err) {
      return respondShaError(res, err, 'Failed to cancel SHA preauthorization.');
    }
  },
);

/* ============================================================
   6. CLAIMS PREPARATION, VALIDATION, SUBMISSION & TRACKING
   ============================================================ */

router.get(
  '/claims',
  requireAnyPermission('insurance.sha.claims.read', 'insurance.sha.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const patientId =
        req.query.patientId !== undefined && req.query.patientId !== ''
          ? parsePositiveInt(req.query.patientId, 'patientId')
          : undefined;

      const claims = await listShaClaims(scope, { status, patientId });
      return res.json({ success: true, claims });
    } catch (err) {
      return respondShaError(res, err, 'Failed to list SHA eClaims.');
    }
  },
);

router.post(
  '/claims/prepare',
  requirePermission('insurance.sha.claims.prepare'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const b = bodyObject(req);
      const invoiceId = parsePositiveInt(b.invoiceId, 'invoiceId');

      const diagnosesOverride = Array.isArray(b.diagnosesOverride)
        ? b.diagnosesOverride
            .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
            .map((d) => ({
              code: String(d.code ?? ''),
              display: String(d.display ?? ''),
              system: typeof d.system === 'string' ? d.system : 'ICD-11',
              type: typeof d.type === 'string' ? d.type : undefined,
            }))
            .filter((d) => d.code.length > 0 && d.display.length > 0)
        : undefined;

      const claim = await prepareShaClaim(scope, {
        invoiceId,
        encounterId: parseOptionalPositiveInt(b.encounterId, 'encounterId'),
        eligibilityVerificationId: parseOptionalPositiveInt(
          b.eligibilityVerificationId,
          'eligibilityVerificationId',
        ),
        preauthorizationId: parseOptionalPositiveInt(b.preauthorizationId, 'preauthorizationId'),
        authorizationId: parseOptionalPositiveInt(b.authorizationId, 'authorizationId'),
        consentToken: typeof b.consentToken === 'string' ? b.consentToken : null,
        submissionProtocol:
          b.submissionProtocol === 'HIE_VIRTUAL_CLAIM' ? 'HIE_VIRTUAL_CLAIM' : 'FHIR_BUNDLE',
        hieVirtualClaimId: typeof b.hieVirtualClaimId === 'string' ? b.hieVirtualClaimId : null,
        dischargeReason:
          b.dischargeReason === 'RECOVERED' ||
          b.dischargeReason === 'REFERRED' ||
          b.dischargeReason === 'ABSCONDED' ||
          b.dischargeReason === 'DECEASED' ||
          b.dischargeReason === 'OTHER'
            ? b.dischargeReason
            : null,
        practitionerRegNumber:
          typeof b.practitionerRegNumber === 'string' ? b.practitionerRegNumber : null,
        practitionerRegulator:
          typeof b.practitionerRegulator === 'string' ? b.practitionerRegulator : null,
        schemeCode: typeof b.schemeCode === 'string' ? b.schemeCode : undefined,
        claimType:
          b.claimType === 'pharmacy' || b.claimType === 'professional' ? b.claimType : undefined,
        subType: b.subType === 'ip' || b.subType === 'op' ? b.subType : undefined,
        isPhcClaim: typeof b.isPhcClaim === 'boolean' ? b.isPhcClaim : undefined,
        patientCopayAmount:
          b.patientCopayAmount !== undefined
            ? (b.patientCopayAmount as string | number)
            : undefined,
        diagnosesOverride,
      });

      return res.status(201).json({ success: true, claim });
    } catch (err) {
      return respondShaError(res, err, 'Failed to prepare SHA eClaim package.');
    }
  },
);

router.get(
  '/claims/:claimId',
  requireAnyPermission('insurance.sha.claims.read', 'insurance.sha.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const claimId = parsePositiveInt(req.params.claimId, 'claimId');
      const claim = await getShaClaimDetail(scope, claimId);
      return res.json({ success: true, claim });
    } catch (err) {
      return respondShaError(res, err, 'Failed to load SHA eClaim detail.');
    }
  },
);

router.post(
  '/claims/:claimId/validate',
  requirePermission('insurance.sha.claims.prepare'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const claimId = parsePositiveInt(req.params.claimId, 'claimId');
      const claim = await validateShaClaim(scope, claimId);
      return res.json({ success: true, claim });
    } catch (err) {
      return respondShaError(res, err, 'Failed to validate SHA eClaim.');
    }
  },
);

router.post(
  '/claims/:claimId/submit',
  requirePermission('insurance.sha.claims.submit'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const claimId = parsePositiveInt(req.params.claimId, 'claimId');
      const claim = await submitShaClaim(scope, claimId);
      return res.json({ success: true, claim });
    } catch (err) {
      return respondShaError(res, err, 'Failed to submit SHA eClaim.');
    }
  },
);

router.post(
  '/claims/:claimId/resubmit',
  requirePermission('insurance.sha.claims.resubmit'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const claimId = parsePositiveInt(req.params.claimId, 'claimId');
      const b = bodyObject(req);

      const diagnosesSnapshot = Array.isArray(b.diagnosesSnapshot)
        ? b.diagnosesSnapshot
            .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
            .map((d) => ({
              code: String(d.code ?? ''),
              display: String(d.display ?? ''),
              system: typeof d.system === 'string' ? d.system : 'ICD-11',
              type: typeof d.type === 'string' ? d.type : undefined,
            }))
            .filter((d) => d.code.length > 0 && d.display.length > 0)
        : undefined;

      const itemCorrections = Array.isArray(b.itemCorrections)
        ? b.itemCorrections
            .filter((it): it is Record<string, unknown> => typeof it === 'object' && it !== null)
            .map((it) => ({
              itemId: parsePositiveInt(it.itemId, 'itemId'),
              payerServiceCode:
                typeof it.payerServiceCode === 'string' ? it.payerServiceCode : undefined,
              payerServiceName:
                typeof it.payerServiceName === 'string' ? it.payerServiceName : undefined,
              claimedUnitPrice:
                it.claimedUnitPrice !== undefined
                  ? (it.claimedUnitPrice as string | number)
                  : undefined,
              preauthReference:
                it.preauthReference !== undefined ? String(it.preauthReference ?? '') : undefined,
            }))
        : undefined;

      const claim = await resubmitShaClaim(scope, claimId, {
        correctionNotes: String(b.correctionNotes ?? ''),
        preauthorizationId: parseOptionalPositiveInt(b.preauthorizationId, 'preauthorizationId'),
        billableStart: typeof b.billableStart === 'string' ? b.billableStart : undefined,
        billableEnd: typeof b.billableEnd === 'string' ? b.billableEnd : undefined,
        diagnosesSnapshot,
        itemCorrections,
      });

      return res.json({ success: true, claim });
    } catch (err) {
      return respondShaError(res, err, 'Failed to resubmit corrected SHA eClaim.');
    }
  },
);

router.get(
  '/claims/:claimId/status',
  requireAnyPermission('insurance.sha.claims.read', 'insurance.sha.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const claimId = parsePositiveInt(req.params.claimId, 'claimId');
      const result = await refreshShaClaimStatus(scope, claimId);
      return res.json({ success: true, ...result });
    } catch (err) {
      return respondShaError(res, err, 'Failed to query SHA eClaim status.');
    }
  },
);

router.post(
  '/claims/:claimId/adjudicate',
  requirePermission('insurance.sha.reconciliation.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const claimId = parsePositiveInt(req.params.claimId, 'claimId');
      const b = bodyObject(req);
      const targetStatus = String(b.targetStatus ?? '').toUpperCase();
      if (
        targetStatus !== 'ADJUDICATED' &&
        targetStatus !== 'PARTIALLY_ADJUDICATED' &&
        targetStatus !== 'REJECTED' &&
        targetStatus !== 'DISPUTED' &&
        targetStatus !== 'CANCELLED'
      ) {
        throw new InsuranceDomainError(
          'INVALID_ADJUDICATION_STATUS',
          'targetStatus must be ADJUDICATED, PARTIALLY_ADJUDICATED, REJECTED, DISPUTED, or CANCELLED.',
          400,
        );
      }

      const claim = await recordClaimAdjudicationDecision(scope, claimId, {
        targetStatus,
        approvedAmount:
          b.approvedAmount !== undefined ? (b.approvedAmount as string | number | null) : undefined,
        payerClaimReference:
          typeof b.payerClaimReference === 'string' ? b.payerClaimReference : null,
        reason: String(b.reason ?? ''),
      });

      return res.json({ success: true, claim });
    } catch (err) {
      return respondShaError(res, err, 'Failed to record SHA claim adjudication outcome.');
    }
  },
);

/* ============================================================
   7. REMITTANCES & FINANCIAL RECONCILIATION
   ============================================================ */

router.get(
  '/remittances',
  requireAnyPermission('insurance.sha.remittance.read', 'insurance.sha.reconciliation.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const remittances = await listRemittances(scope, 'SHA');
      return res.json({ success: true, remittances });
    } catch (err) {
      return respondShaError(res, err, 'Failed to list SHA remittances.');
    }
  },
);

router.post(
  '/remittances',
  requirePermission('insurance.sha.reconciliation.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const b = bodyObject(req);
      const remittance = await recordRemittanceAdvice(scope, {
        payerRemittanceRef:
          typeof b.payerRemittanceRef === 'string' ? b.payerRemittanceRef : undefined,
        paymentDate: typeof b.paymentDate === 'string' ? b.paymentDate : undefined,
        paymentChannel: typeof b.paymentChannel === 'string' ? b.paymentChannel : undefined,
        totalRemittedAmount:
          b.totalRemittedAmount !== undefined
            ? (b.totalRemittedAmount as string | number)
            : undefined,
        notes: typeof b.notes === 'string' ? b.notes : null,
        fhirPaymentNotice:
          typeof b.fhirPaymentNotice === 'object' && b.fhirPaymentNotice !== null
            ? (b.fhirPaymentNotice as Record<string, unknown>)
            : null,
      });

      return res.status(201).json({ success: true, remittance });
    } catch (err) {
      return respondShaError(res, err, 'Failed to record SHA remittance advice.');
    }
  },
);

router.post(
  '/remittances/:id/reconcile',
  requirePermission('insurance.sha.reconciliation.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const remittanceId = parsePositiveInt(req.params.id, 'id');
      const b = bodyObject(req);

      const allocations = Array.isArray(b.allocations)
        ? b.allocations
            .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
            .map((a) => ({
              eclaimId: parsePositiveInt(a.eclaimId, 'eclaimId'),
              remittedAmount: (a.remittedAmount ?? '') as string | number,
              approvedAmount:
                a.approvedAmount !== undefined
                  ? (a.approvedAmount as string | number | null)
                  : undefined,
              varianceReason: typeof a.varianceReason === 'string' ? a.varianceReason : null,
              postToInvoice: typeof a.postToInvoice === 'boolean' ? a.postToInvoice : false,
              billingPaymentId: parseOptionalPositiveInt(a.billingPaymentId, 'billingPaymentId'),
            }))
        : [];

      const result = await reconcileRemittance(scope, remittanceId, {
        allocations,
        cashierDisplayName: req.user?.fullName ?? req.user?.email ?? undefined,
      });

      return res.json({ success: true, ...result });
    } catch (err) {
      return respondShaError(res, err, 'Failed to reconcile SHA remittance.');
    }
  },
);

router.post(
  '/remittances/sync',
  requirePermission('insurance.sha.reconciliation.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const b = bodyObject(req);
      const facilityIdType =
        b.facilityIdType === 'registration-number' || b.facilityIdType === 'fid'
          ? b.facilityIdType
          : 'fr-code';
      const result = await syncFacilityHieRemittances(scope, {
        fromDate: typeof b.fromDate === 'string' ? b.fromDate : null,
        toDate: typeof b.toDate === 'string' ? b.toDate : null,
        facilityIdType,
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      return respondShaError(res, err, 'Failed to sync DHA HIE facility remittances.');
    }
  },
);

router.get(
  '/remittances/:id/claims',
  requireAnyPermission('insurance.sha.remittance.read', 'insurance.sha.reconciliation.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const remittanceId = parsePositiveInt(req.params.id, 'id');
      const result = await fetchRemittanceClaimBreakdown(scope, remittanceId);
      return res.json({ success: true, ...result });
    } catch (err) {
      return respondShaError(res, err, 'Failed to fetch claims paid by SHA remittance.');
    }
  },
);

/* ============================================================
   8. DHA HIE CALLBACK REGISTRATION & OPERATIONAL REPORTING
   ============================================================ */

router.post(
  '/callbacks/register',
  requirePermission('insurance.sha.configuration.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const b = bodyObject(req);
      const { config: payerConfig } = await getFacilityPayerConfig(scope, 'SHA');
      const environment = String(b.environment ?? 'sandbox').trim();
      const entityTypeRaw = String(b.entityType ?? 'claim').trim();
      if (
        entityTypeRaw !== 'claim' &&
        entityTypeRaw !== 'preauth' &&
        entityTypeRaw !== 'authorization'
      ) {
        throw new InsuranceDomainError(
          'INVALID_CALLBACK_ENTITY_TYPE',
          'entityType must be claim, preauth, or authorization.',
          400,
        );
      }
      const callbackUrl = String(b.callbackUrl ?? '').trim();
      if (!callbackUrl.startsWith('https://')) {
        throw new InsuranceDomainError(
          'INVALID_CALLBACK_URL',
          'callbackUrl must be an https:// endpoint.',
          400,
        );
      }

      if (environment !== 'sandbox' && environment !== 'production') {
        throw new InsuranceDomainError(
          'INVALID_CALLBACK_ENVIRONMENT',
          'environment must be "sandbox" or "production" (DHA HIE rejects "prod").',
          400,
        );
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(callbackUrl);
      } catch {
        throw new InsuranceDomainError(
          'INVALID_CALLBACK_URL',
          'callbackUrl must be a valid https:// URL.',
          400,
        );
      }

      if (!defaultShaGatewayAdapter.registerCallbackEndpoint) {
        throw new InsuranceDomainError(
          'CAPABILITY_UNAVAILABLE',
          'SHA adapter does not support callback registration.',
          501,
        );
      }

      const result = await defaultShaGatewayAdapter.registerCallbackEndpoint({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        actorUserId: scope.userId,
        facilityRegistryOverride: payerConfig.facilityRegistryCode,
        baseUrl: parsedUrl.origin,
        callbackPath: parsedUrl.pathname || '/api/webhooks/sha/status',
        environment,
        entityType: entityTypeRaw,
      });

      if (!result.registered) {
        throw new InsuranceDomainError(
          'CALLBACK_REGISTRATION_REJECTED',
          result.errorMessage ?? 'DHA HIE callback endpoint registration failed.',
          400,
        );
      }

      return res.status(201).json({ success: true, callbackRegistration: result });
    } catch (err) {
      return respondShaError(res, err, 'Failed to register DHA HIE status callback endpoint.');
    }
  },
);

router.get(
  '/callbacks',
  requireAnyPermission('insurance.sha.read', 'insurance.sha.configuration.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const events = await listShaCallbackEvents(scope);
      return res.json({ success: true, events });
    } catch (err) {
      return respondShaError(res, err, 'Failed to list SHA callback events.');
    }
  },
);

router.get(
  '/operational-report',
  requireAnyPermission(
    'insurance.sha.read',
    'insurance.sha.claims.read',
    'insurance.sha.remittance.read',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const scope = await resolveActorScope(req);
      const report = await getShaOperationalReport(scope);
      return res.json({ success: true, report });
    } catch (err) {
      return respondShaError(res, err, 'Failed to generate SHA operational and ATNA audit report.');
    }
  },
);

/**
 * Secret-verified external DHA HIE / SHA webhook router mounted at `/api/webhooks/sha`
 * prior to the staff `requireAuth` gate. Refuses 503 when `SHA_WEBHOOK_SECRET` is
 * unconfigured and enforces constant-time token/HMAC verification.
 */
function isFacilityScopedCallbackVerificationImplemented(): boolean {
  return false;
}

export function createShaWebhooksRouter(): Router {
  const webhookRouter = Router();

  webhookRouter.post('/status', async (req: Request, res: Response) => {
    const cfg = loadShaConfig();
    if (!cfg.webhookSecret) {
      return res.status(503).json({
        success: false,
        error: 'SHA_WEBHOOK_UNCONFIGURED',
        message: 'SHA_WEBHOOK_SECRET is not configured on this server.',
      });
    }

    const authHeader =
      typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const signatureHeader =
      typeof req.headers['x-sha-signature'] === 'string'
        ? req.headers['x-sha-signature'].trim()
        : '';

    const secretBuf = Buffer.from(cfg.webhookSecret, 'utf8');
    let verified = false;

    if (bearerToken) {
      const tokenBuf = Buffer.from(bearerToken, 'utf8');
      if (tokenBuf.length === secretBuf.length && timingSafeEqual(tokenBuf, secretBuf)) {
        verified = true;
      }
    } else if (signatureHeader) {
      const expectedHex = createHmac('sha256', cfg.webhookSecret)
        .update(JSON.stringify(req.body ?? {}))
        .digest('hex');
      const sigClean = signatureHeader.replace(/^sha256=/i, '');
      const sigBuf = Buffer.from(sigClean, 'utf8');
      const expBuf = Buffer.from(expectedHex, 'utf8');
      if (sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)) {
        verified = true;
      }
    }

    if (!verified) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_WEBHOOK_CREDENTIALS',
        message: 'Invalid or missing SHA callback authentication.',
      });
    }

    // The legacy verifier uses a process-wide secret and cannot authenticate
    // the sending facility. Never apply callbacks until the provider's
    // facility-specific authentication and replay contract are verified.
    if (!isFacilityScopedCallbackVerificationImplemented()) {
      return res.status(503).json({
        success: false,
        error: 'SHA_CALLBACK_NOT_VERIFIED',
        message: 'Facility-scoped callback verification is not yet available.',
      });
    }

    /* Future facility-scoped callback processing is retained below. */
    try {
      const b =
        typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};
      const entityTypeRaw = String(b.entity_type ?? b.entityType ?? 'claim')
        .trim()
        .toLowerCase();
      const entityType =
        entityTypeRaw === 'preauth' ||
        entityTypeRaw === 'authorization' ||
        entityTypeRaw === 'payment_notice'
          ? entityTypeRaw
          : 'claim';
      const externalEntityId = String(
        b.entity_id ?? b.entityId ?? b.claim_id ?? b.guid ?? '',
      ).trim();

      if (!externalEntityId) {
        return res.status(400).json({
          success: false,
          error: 'MISSING_ENTITY_ID',
          message: 'Callback payload must include entity_id / claim_id / guid.',
        });
      }

      const result = await processIncomingShaWebhookEvent({
        entityType,
        action: typeof b.action === 'string' ? b.action : 'status_changed',
        externalEntityId,
        externalEventId:
          typeof b.event_id === 'string'
            ? b.event_id
            : typeof b.eventId === 'string'
              ? b.eventId
              : null,
        upstreamStatus:
          typeof b.status === 'string'
            ? b.status
            : typeof b.upstreamStatus === 'string'
              ? b.upstreamStatus
              : null,
        approvedAmountKes:
          typeof b.approved_amount === 'number' || typeof b.approved_amount === 'string'
            ? String(b.approved_amount)
            : null,
        rejectionReason: typeof b.rejection_reason === 'string' ? b.rejection_reason : null,
        environment: cfg.mode === 'production' ? 'production' : 'sandbox',
        signatureVerified: true,
        payloadSummary: {
          entityType,
          externalEntityId,
          status: b.status ?? b.upstreamStatus ?? null,
        },
      });

      return res.status(200).json({ success: true, ...result });
    } catch (err) {
      return respondShaError(res, err, 'Failed to process SHA status callback.');
    }
  });

  return webhookRouter;
}

export default router;
