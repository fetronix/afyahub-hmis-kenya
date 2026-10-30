/**
 * JaliCare HMIS — Private Insurance & Multi-Insurer Routes (`/api/insurance/*`)
 *
 * Mounted at `/api/insurance` after `/api/insurance/sha`, behind `requireAuth`,
 * `requireAuthorization`, and `requireFacilityModule('insurance')`.
 *
 * Enforces RBAC, authoritative tenant/facility scoping, pagination, input
 * validation, and zero exposure of payer credentials or tokens.
 */

import { Router, type Response } from 'express';
import { eq } from 'drizzle-orm';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requireAnyPermission, requirePermission } from '../auth/authorization.middleware.ts';
import { resolveFacilityScope, ScopeAccessError } from '../auth/scope.service.ts';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { PrivateInsuranceError } from '../insurance/core/types.ts';
import { privatePolicyGuard } from '../insurance/hub/guards.ts';
import { PayerHubError } from '../insurance/hub/service.ts';
import { facilityActionBodySchema } from '../validation/schemas/index.ts';
import { validateBody } from '../validation/validate.ts';
import { listIntegrationDiagnostics } from '../insurance/audit/diagnostics.service.ts';
import {
  createPrivatePayer,
  getPayerCapabilitiesScoped,
  getPayerRowScoped,
  listPrivatePayers,
  probeAndPersistPayerConnectionStatus,
  serializePayerConfig,
  updatePrivatePayer,
} from '../insurance/payers/payer-config.service.ts';
import {
  createInsuranceMemberPolicy,
  getInsuranceMemberById,
  listInsuranceMembers,
  updateInsuranceMemberPolicy,
} from '../insurance/eligibility/member-policy.service.ts';
import {
  checkPrivateInsuranceEligibility,
  getEligibilityVerificationById,
  listPrivateEligibilityVerifications,
} from '../insurance/eligibility/eligibility.service.ts';
import {
  createOrApprovePayerBenefitRule,
  listPayerBenefitRulesAndValidations,
  updatePayerBenefitRuleStatus,
  validatePrivateServiceBenefit,
} from '../insurance/benefits/benefits.service.ts';
import {
  createPayerServiceMapping,
  listPayerServiceMappings,
  updatePayerServiceMapping,
} from '../insurance/mappings/mappings.service.ts';
import {
  addPrivatePreauthAttachment,
  createPrivatePreauthorization,
  getPrivatePreauthorizationById,
  listPrivatePreauthorizations,
  recordPrivatePreauthDecision,
  submitPrivatePreauthorization,
} from '../insurance/preauthorization/preauthorization.service.ts';
import {
  getPrivateInsuranceClaimById,
  listPrivateInsuranceClaims,
  preparePrivateInsuranceClaim,
  queryPrivateClaimStatus,
  recordPrivateClaimDecision,
  submitPrivateInsuranceClaim,
  updateOrCorrectPrivateClaim,
  validatePrivateInsuranceClaimById,
} from '../insurance/claims/private-claims.service.ts';
import {
  getPrivateInsuranceDashboardSummary,
  getPrivateReconciliationRegister,
  importPrivateRemittance,
  listPrivateRemittances,
  reconcilePrivateRemittance,
} from '../insurance/remittance/remittance-reconciliation.service.ts';

const router = Router();
router.use(privatePolicyGuard);

interface ScopedInsuranceActor {
  tenantId: number;
  facilityId: number;
  actorUserId: number;
  actorUserUid: string;
  actorRole: string;
  actorDisplayName: string;
}

function parsePositiveInt(value: unknown, field: string): number {
  const num = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isSafeInteger(num) || num <= 0) {
    throw new PrivateInsuranceError(
      'VALIDATION_ERROR',
      `${field} must be a positive integer.`,
      400,
    );
  }
  return num;
}

function bodyObject(req: AuthRequest): Record<string, unknown> {
  if (typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body)) {
    return req.body as Record<string, unknown>;
  }
  return {};
}

async function resolveActor(req: AuthRequest): Promise<ScopedInsuranceActor> {
  const context = req.authContext;
  if (!context) {
    throw new PrivateInsuranceError(
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
    throw new PrivateInsuranceError('FACILITY_NOT_FOUND', 'Facility does not exist.', 404);
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
    actorUserId: context.userId,
    actorUserUid: req.user?.uid ?? `user-${context.userId}`,
    actorRole: context.roles[0] ?? 'STAFF',
    actorDisplayName: req.user?.email ?? `User #${context.userId}`,
  };
}

function respondError(res: Response, err: unknown, fallbackMessage: string): Response {
  if (err instanceof ScopeAccessError) {
    return res.status(403).json({ error: err.code, message: err.message });
  }
  if (err instanceof PayerHubError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  if (err instanceof PrivateInsuranceError) {
    return res.status(err.status).json({
      error: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
  }
  return res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: fallbackMessage,
  });
}

/* ============================================================
   1. DASHBOARD & DIAGNOSTICS
   ============================================================ */

router.get(
  '/dashboard',
  requirePermission('insurance.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const summary = await getPrivateInsuranceDashboardSummary({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
      });
      res.json(summary);
    } catch (err) {
      respondError(res, err, 'Failed to load private insurance dashboard.');
    }
  },
);

router.get(
  '/diagnostics',
  requireAnyPermission('insurance.payers.read', 'audit.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const payerCode =
        typeof req.query.payerCode === 'string' && req.query.payerCode.trim()
          ? req.query.payerCode.trim()
          : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const data = await listIntegrationDiagnostics({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        payerCode,
        limit,
      });
      res.json(data);
    } catch (err) {
      respondError(res, err, 'Failed to load integration diagnostics.');
    }
  },
);

/* ============================================================
   2. INSURER CONFIGURATION & CAPABILITIES
   ============================================================ */

router.get(
  '/payers',
  requireAnyPermission('insurance.payers.read', 'insurance.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const payers = await listPrivatePayers({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        includePublicSha: req.query.includePublic === 'true',
      });
      res.json({ payers });
    } catch (err) {
      respondError(res, err, 'Failed to list configured insurers.');
    }
  },
);

router.post(
  '/payers',
  requirePermission('insurance.payers.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const created = await createPrivatePayer({
        ...actor,
        input: bodyObject(req),
      });
      res.status(201).json(created);
    } catch (err) {
      respondError(res, err, 'Failed to create insurer configuration.');
    }
  },
);

router.get(
  '/payers/:payerId',
  requireAnyPermission('insurance.payers.read', 'insurance.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const payerId = parsePositiveInt(req.params.payerId, 'payerId');
      const row = await getPayerRowScoped({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        payerId,
      });
      res.json(serializePayerConfig(row));
    } catch (err) {
      respondError(res, err, 'Failed to load insurer configuration.');
    }
  },
);

router.patch(
  '/payers/:payerId',
  requirePermission('insurance.payers.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const payerId = parsePositiveInt(req.params.payerId, 'payerId');
      const updated = await updatePrivatePayer({
        ...actor,
        payerId,
        input: bodyObject(req),
      });
      res.json(updated);
    } catch (err) {
      respondError(res, err, 'Failed to update insurer configuration.');
    }
  },
);

router.get(
  '/payers/:payerId/capabilities',
  requireAnyPermission('insurance.payers.read', 'insurance.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const payerId = parsePositiveInt(req.params.payerId, 'payerId');
      const capabilities = await getPayerCapabilitiesScoped({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        payerId,
      });
      res.json(capabilities);
    } catch (err) {
      respondError(res, err, 'Failed to load insurer capabilities.');
    }
  },
);

router.get(
  '/payers/:payerId/connection-status',
  requireAnyPermission('insurance.payers.read', 'insurance.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const payerId = parsePositiveInt(req.params.payerId, 'payerId');
      const status = await probeAndPersistPayerConnectionStatus({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        payerId,
        actorUserId: actor.actorUserId,
      });
      res.json(status);
    } catch (err) {
      respondError(res, err, 'Failed to probe insurer connection status.');
    }
  },
);

/* ============================================================
   3. MEMBERSHIP & ELIGIBILITY
   ============================================================ */

router.get(
  '/members',
  requireAnyPermission('insurance.members.read', 'insurance.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const members = await listInsuranceMembers({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        payerCode: typeof req.query.payerCode === 'string' ? req.query.payerCode : undefined,
        patientId: req.query.patientId
          ? parsePositiveInt(req.query.patientId, 'patientId')
          : undefined,
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 50,
        offset: req.query.offset ? Number(req.query.offset) : 0,
      });
      res.json({ members });
    } catch (err) {
      respondError(res, err, 'Failed to list insurance memberships.');
    }
  },
);

router.post(
  '/members',
  requirePermission('insurance.members.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const created = await createInsuranceMemberPolicy({
        ...actor,
        input: bodyObject(req),
      });
      res.status(201).json(created);
    } catch (err) {
      respondError(res, err, 'Failed to register insurance membership.');
    }
  },
);

router.get(
  '/members/:memberId',
  requireAnyPermission('insurance.members.read', 'insurance.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const memberId = parsePositiveInt(req.params.memberId, 'memberId');
      const member = await getInsuranceMemberById({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        memberId,
      });
      res.json(member);
    } catch (err) {
      respondError(res, err, 'Failed to load insurance membership.');
    }
  },
);

router.patch(
  '/members/:memberId',
  requirePermission('insurance.members.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const memberId = parsePositiveInt(req.params.memberId, 'memberId');
      const updated = await updateInsuranceMemberPolicy({
        ...actor,
        memberId,
        input: bodyObject(req),
      });
      res.json(updated);
    } catch (err) {
      respondError(res, err, 'Failed to update insurance membership.');
    }
  },
);

router.get(
  '/eligibility',
  requireAnyPermission('insurance.members.read', 'insurance.eligibility.check', 'insurance.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const verifications = await listPrivateEligibilityVerifications({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        payerCode: typeof req.query.payerCode === 'string' ? req.query.payerCode : undefined,
        patientId: req.query.patientId
          ? parsePositiveInt(req.query.patientId, 'patientId')
          : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 50,
      });
      res.json({ verifications });
    } catch (err) {
      respondError(res, err, 'Failed to list eligibility verifications.');
    }
  },
);

router.post(
  '/eligibility/check',
  requirePermission('insurance.eligibility.check'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const result = await checkPrivateInsuranceEligibility({
        ...actor,
        input: bodyObject(req),
      });
      res.status(201).json(result);
    } catch (err) {
      respondError(res, err, 'Failed to verify private insurance eligibility.');
    }
  },
);

router.get(
  '/eligibility/:verificationId',
  requireAnyPermission('insurance.members.read', 'insurance.eligibility.check', 'insurance.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const verificationId = parsePositiveInt(req.params.verificationId, 'verificationId');
      const verification = await getEligibilityVerificationById({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        verificationId,
      });
      res.json(verification);
    } catch (err) {
      respondError(res, err, 'Failed to load eligibility verification.');
    }
  },
);

router.get(
  '/patients/:patientId/eligibility-history',
  requireAnyPermission('insurance.members.read', 'insurance.eligibility.check', 'insurance.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const patientId = parsePositiveInt(req.params.patientId, 'patientId');
      const verifications = await listPrivateEligibilityVerifications({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        patientId,
        payerCode: typeof req.query.payerCode === 'string' ? req.query.payerCode : undefined,
        limit: 100,
      });
      res.json({ patientId, verifications });
    } catch (err) {
      respondError(res, err, 'Failed to load patient eligibility history.');
    }
  },
);

/* ============================================================
   4. BENEFITS, LIMITS, COPAYMENTS & SERVICE MAPPINGS
   ============================================================ */

router.get(
  '/benefits',
  requireAnyPermission('insurance.benefits.validate', 'insurance.payers.read', 'insurance.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const result = await listPayerBenefitRulesAndValidations({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        payerCode: typeof req.query.payerCode === 'string' ? req.query.payerCode : undefined,
        patientId: req.query.patientId
          ? parsePositiveInt(req.query.patientId, 'patientId')
          : undefined,
      });
      res.json(result);
    } catch (err) {
      respondError(res, err, 'Failed to load benefits and limits.');
    }
  },
);

router.post(
  '/benefits',
  requirePermission('insurance.mappings.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const created = await createOrApprovePayerBenefitRule({
        ...actor,
        input: bodyObject(req),
      });
      res.status(201).json(created);
    } catch (err) {
      respondError(res, err, 'Failed to create insurer benefit rule.');
    }
  },
);

router.patch(
  '/benefits/:ruleId',
  requirePermission('insurance.mappings.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const ruleId = parsePositiveInt(req.params.ruleId, 'ruleId');
      const body = bodyObject(req);
      const status = String(body.status ?? '')
        .trim()
        .toUpperCase();
      if (!['DRAFT', 'APPROVED', 'RETIRED'].includes(status)) {
        throw new PrivateInsuranceError(
          'INVALID_RULE_STATUS',
          'status must be DRAFT, APPROVED, or RETIRED.',
          400,
        );
      }
      const updated = await updatePayerBenefitRuleStatus({
        ...actor,
        ruleId,
        status: status as 'DRAFT' | 'APPROVED' | 'RETIRED',
      });
      res.json(updated);
    } catch (err) {
      respondError(res, err, 'Failed to update benefit rule status.');
    }
  },
);

router.post(
  '/benefits/validate',
  requirePermission('insurance.benefits.validate'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const result = await validatePrivateServiceBenefit({
        ...actor,
        input: bodyObject(req),
      });
      res.status(201).json(result);
    } catch (err) {
      respondError(res, err, 'Failed to validate service benefit.');
    }
  },
);

router.get(
  '/mappings',
  requireAnyPermission('insurance.payers.read', 'insurance.benefits.validate', 'insurance.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const mappings = await listPayerServiceMappings({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        payerCode: typeof req.query.payerCode === 'string' ? req.query.payerCode : undefined,
        serviceArea: typeof req.query.serviceArea === 'string' ? req.query.serviceArea : undefined,
        activeOnly: req.query.activeOnly === 'true',
      });
      res.json({ mappings });
    } catch (err) {
      respondError(res, err, 'Failed to list insurer service-code mappings.');
    }
  },
);

router.post(
  '/mappings',
  requirePermission('insurance.mappings.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const created = await createPayerServiceMapping({
        ...actor,
        input: bodyObject(req),
      });
      res.status(201).json(created);
    } catch (err) {
      respondError(res, err, 'Failed to create insurer service-code mapping.');
    }
  },
);

router.patch(
  '/mappings/:mappingId',
  requirePermission('insurance.mappings.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const mappingId = parsePositiveInt(req.params.mappingId, 'mappingId');
      const updated = await updatePayerServiceMapping({
        ...actor,
        mappingId,
        input: bodyObject(req),
      });
      res.json(updated);
    } catch (err) {
      respondError(res, err, 'Failed to update insurer service-code mapping.');
    }
  },
);

/* ============================================================
   5. PREAUTHORIZATION MANAGEMENT
   ============================================================ */

router.get(
  '/preauthorizations',
  requireAnyPermission(
    'insurance.preauthorization.manage',
    'insurance.payers.read',
    'insurance.read',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const preauthorizations = await listPrivatePreauthorizations({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        payerCode: typeof req.query.payerCode === 'string' ? req.query.payerCode : undefined,
        patientId: req.query.patientId
          ? parsePositiveInt(req.query.patientId, 'patientId')
          : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
      });
      res.json({ preauthorizations });
    } catch (err) {
      respondError(res, err, 'Failed to list preauthorizations.');
    }
  },
);

router.post(
  '/preauthorizations',
  requirePermission('insurance.preauthorization.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const created = await createPrivatePreauthorization({
        ...actor,
        input: bodyObject(req),
      });
      res.status(201).json(created);
    } catch (err) {
      respondError(res, err, 'Failed to create preauthorization.');
    }
  },
);

router.get(
  '/preauthorizations/:id',
  requireAnyPermission(
    'insurance.preauthorization.manage',
    'insurance.payers.read',
    'insurance.read',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const preauthId = parsePositiveInt(req.params.id, 'id');
      const preauth = await getPrivatePreauthorizationById({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        preauthId,
      });
      res.json(preauth);
    } catch (err) {
      respondError(res, err, 'Failed to load preauthorization.');
    }
  },
);

router.patch(
  '/preauthorizations/:id',
  requirePermission('insurance.preauthorization.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const preauthId = parsePositiveInt(req.params.id, 'id');
      const updated = await recordPrivatePreauthDecision({
        ...actor,
        preauthId,
        input: bodyObject(req),
      });
      res.json(updated);
    } catch (err) {
      respondError(res, err, 'Failed to update preauthorization.');
    }
  },
);

router.post(
  '/preauthorizations/:id/submit',
  requirePermission('insurance.preauthorization.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const preauthId = parsePositiveInt(req.params.id, 'id');
      const submitted = await submitPrivatePreauthorization({
        ...actor,
        preauthId,
        input: bodyObject(req),
      });
      res.json(submitted);
    } catch (err) {
      respondError(res, err, 'Failed to submit preauthorization.');
    }
  },
);

router.post(
  '/preauthorizations/:id/attachments',
  requirePermission('insurance.preauthorization.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const preauthId = parsePositiveInt(req.params.id, 'id');
      const attachment = await addPrivatePreauthAttachment({
        ...actor,
        preauthId,
        input: bodyObject(req),
      });
      res.status(201).json(attachment);
    } catch (err) {
      respondError(res, err, 'Failed to attach preauthorization document.');
    }
  },
);

/* ============================================================
   6. CLAIM GENERATION, VALIDATION, SUBMISSION & TRACKING
   ============================================================ */

router.get(
  '/claims',
  requireAnyPermission(
    'insurance.private.claims.prepare',
    'insurance.private.claims.submit',
    'insurance.read',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const claims = await listPrivateInsuranceClaims({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        payerCode: typeof req.query.payerCode === 'string' ? req.query.payerCode : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        patientId: req.query.patientId
          ? parsePositiveInt(req.query.patientId, 'patientId')
          : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 50,
        offset: req.query.offset ? Number(req.query.offset) : 0,
      });
      res.json({ claims });
    } catch (err) {
      respondError(res, err, 'Failed to list private insurance claims.');
    }
  },
);

router.post(
  '/claims/prepare',
  requirePermission('insurance.private.claims.prepare'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const claim = await preparePrivateInsuranceClaim({
        ...actor,
        input: bodyObject(req),
      });
      res.status(201).json(claim);
    } catch (err) {
      respondError(res, err, 'Failed to prepare private insurance claim from invoice.');
    }
  },
);

router.get(
  '/claims/:claimId',
  requireAnyPermission(
    'insurance.private.claims.prepare',
    'insurance.private.claims.submit',
    'insurance.read',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const claimId = parsePositiveInt(req.params.claimId, 'claimId');
      const claim = await getPrivateInsuranceClaimById({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        claimId,
      });
      res.json(claim);
    } catch (err) {
      respondError(res, err, 'Failed to load private insurance claim.');
    }
  },
);

router.patch(
  '/claims/:claimId',
  requirePermission('insurance.private.claims.prepare'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const claimId = parsePositiveInt(req.params.claimId, 'claimId');
      const updated = await updateOrCorrectPrivateClaim({
        ...actor,
        claimId,
        input: bodyObject(req),
      });
      res.json(updated);
    } catch (err) {
      respondError(res, err, 'Failed to update or correct claim.');
    }
  },
);

router.post(
  '/claims/:claimId/validate',
  requirePermission('insurance.private.claims.prepare'),
  validateBody(facilityActionBodySchema),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const claimId = parsePositiveInt(req.params.claimId, 'claimId');
      const validated = await validatePrivateInsuranceClaimById({
        ...actor,
        claimId,
      });
      res.json(validated);
    } catch (err) {
      respondError(res, err, 'Failed to validate private insurance claim.');
    }
  },
);

router.post(
  '/claims/:claimId/submit',
  requirePermission('insurance.private.claims.submit'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const claimId = parsePositiveInt(req.params.claimId, 'claimId');
      const submitted = await submitPrivateInsuranceClaim({
        ...actor,
        claimId,
        isResubmission: false,
        input: bodyObject(req),
      });
      res.json(submitted);
    } catch (err) {
      respondError(res, err, 'Failed to submit private insurance claim.');
    }
  },
);

router.post(
  '/claims/:claimId/resubmit',
  requirePermission('insurance.private.claims.submit'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const claimId = parsePositiveInt(req.params.claimId, 'claimId');
      const resubmitted = await submitPrivateInsuranceClaim({
        ...actor,
        claimId,
        isResubmission: true,
        input: bodyObject(req),
      });
      res.json(resubmitted);
    } catch (err) {
      respondError(res, err, 'Failed to resubmit private insurance claim.');
    }
  },
);

router.post(
  '/claims/:claimId/decision',
  requirePermission('insurance.private.claims.submit'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const claimId = parsePositiveInt(req.params.claimId, 'claimId');
      const updated = await recordPrivateClaimDecision({
        ...actor,
        claimId,
        input: bodyObject(req),
      });
      res.json(updated);
    } catch (err) {
      respondError(res, err, 'Failed to record insurer claim decision.');
    }
  },
);

router.get(
  '/claims/:claimId/status',
  requireAnyPermission(
    'insurance.private.claims.prepare',
    'insurance.private.claims.submit',
    'insurance.read',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const claimId = parsePositiveInt(req.params.claimId, 'claimId');
      const status = await queryPrivateClaimStatus({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        claimId,
        actorUserId: actor.actorUserId,
      });
      res.json(status);
    } catch (err) {
      respondError(res, err, 'Failed to query claim status.');
    }
  },
);

/* ============================================================
   7. REMITTANCE & RECONCILIATION
   ============================================================ */

router.get(
  '/remittances',
  requireAnyPermission('insurance.private.remittance.reconcile', 'insurance.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const remittances = await listPrivateRemittances({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        payerCode: typeof req.query.payerCode === 'string' ? req.query.payerCode : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
      });
      res.json({ remittances });
    } catch (err) {
      respondError(res, err, 'Failed to list private insurance remittances.');
    }
  },
);

router.post(
  '/remittances/import',
  requirePermission('insurance.private.remittance.reconcile'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const created = await importPrivateRemittance({
        ...actor,
        input: bodyObject(req),
      });
      res.status(201).json(created);
    } catch (err) {
      respondError(res, err, 'Failed to import remittance advice.');
    }
  },
);

router.post(
  '/remittances/:id/reconcile',
  requirePermission('insurance.private.remittance.reconcile'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const remittanceId = parsePositiveInt(req.params.id, 'id');
      const reconciled = await reconcilePrivateRemittance({
        ...actor,
        remittanceId,
        input: bodyObject(req),
      });
      res.json(reconciled);
    } catch (err) {
      respondError(res, err, 'Failed to reconcile remittance advice.');
    }
  },
);

router.get(
  '/reconciliation',
  requireAnyPermission('insurance.private.remittance.reconcile', 'insurance.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveActor(req);
      const register = await getPrivateReconciliationRegister({
        tenantId: actor.tenantId,
        facilityId: actor.facilityId,
        payerCode: typeof req.query.payerCode === 'string' ? req.query.payerCode : undefined,
      });
      res.json(register);
    } catch (err) {
      respondError(res, err, 'Failed to load reconciliation register.');
    }
  },
);

export default router;
