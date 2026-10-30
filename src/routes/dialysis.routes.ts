import { Router, type Response } from 'express';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { ScopeAccessError, resolveFacilityScope } from '../auth/scope.service.ts';
import { AccountingIntegrityError } from '../accounting/accounting.service.ts';
import * as queries from '../db/queries.ts';
import { facilityActionBodySchema } from '../validation/schemas/index.ts';
import { validateBody } from '../validation/validate.ts';
import {
  DialysisSafetyError,
  addSessionObservationScoped,
  approveProtocolScoped,
  authorizePlanScoped,
  completeDialysisSessionScoped,
  createAssessmentScoped,
  createMachineScoped,
  createPlanScoped,
  followUpAdverseEventScoped,
  getDialysisWorkspaceScoped,
  recordAdverseEventScoped,
  recordConsumableScoped,
  scheduleDialysisScoped,
  setMachineStatusScoped,
  startDialysisSessionScoped,
  type DialysisScope,
} from '../dialysis/dialysis.service.ts';

const router = Router();
async function scoped(req: AuthRequest): Promise<DialysisScope> {
  if (!req.authContext || !req.user) throw new ScopeAccessError('Authorization context required.');
  const bodyId = req.body?.facilityId,
    queryId = req.query.facilityId;
  const raw = bodyId ?? queryId;
  const id = raw === undefined || raw === null || raw === '' ? undefined : Number(raw);
  if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0))
    throw new DialysisSafetyError('INVALID_FACILITY_ID', 'facilityId must be a positive integer.');
  if (bodyId != null && queryId != null && Number(bodyId) !== Number(queryId))
    throw new DialysisSafetyError(
      'FACILITY_SCOPE_MISMATCH',
      'Facility identifiers do not match.',
      403,
    );
  const facility = await queries.getFacilityByIdScoped(
    req.authContext,
    resolveFacilityScope(req.authContext, id),
  );
  if (!facility) throw new DialysisSafetyError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
  return {
    tenantId: facility.tenantId,
    facilityId: facility.id,
    actorUserId: req.authContext.userId,
    actorName: req.user.fullName,
  };
}
function fail(res: Response, error: unknown) {
  if (error instanceof DialysisSafetyError || error instanceof AccountingIntegrityError) {
    res.status(error.status).json({ success: false, error: error.code, message: error.message });
    return;
  }
  if (error instanceof ScopeAccessError) {
    res.status(403).json({ success: false, error: error.code, message: 'Facility access denied.' });
    return;
  }
  res.status(500).json({
    success: false,
    error: 'DIALYSIS_OPERATION_FAILED',
    message: 'Dialysis operation failed.',
  });
}

router.get('/workspace', requirePermission('dialysis.read'), async (req: AuthRequest, res) => {
  try {
    res.json({ success: true, ...(await getDialysisWorkspaceScoped(await scoped(req))) });
  } catch (error) {
    fail(res, error);
  }
});
router.post(
  '/protocols',
  requirePermission('dialysis.protocols.manage'),
  async (req: AuthRequest, res) => {
    try {
      res.status(201).json({
        success: true,
        protocol: await approveProtocolScoped(await scoped(req), req.body?.protocol),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/machines',
  requirePermission('dialysis.machines.manage'),
  async (req: AuthRequest, res) => {
    try {
      res.status(201).json({
        success: true,
        machine: await createMachineScoped(await scoped(req), req.body ?? {}),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.patch(
  '/machines/:id/status',
  requirePermission('dialysis.machines.manage'),
  async (req: AuthRequest, res) => {
    try {
      res.json({
        success: true,
        machine: await setMachineStatusScoped(
          await scoped(req),
          Number(req.params.id),
          req.body ?? {},
        ),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/assessments',
  requirePermission('dialysis.assessments.manage'),
  async (req: AuthRequest, res) => {
    try {
      res.status(201).json({
        success: true,
        assessment: await createAssessmentScoped(await scoped(req), req.body ?? {}),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/treatment-plans',
  requirePermission('dialysis.assessments.manage'),
  async (req: AuthRequest, res) => {
    try {
      res.status(201).json({
        success: true,
        treatmentPlan: await createPlanScoped(await scoped(req), req.body ?? {}),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/treatment-plans/:id/authorize',
  requirePermission('dialysis.plans.authorize'),
  validateBody(facilityActionBodySchema),
  async (req: AuthRequest, res) => {
    try {
      res.json({
        success: true,
        treatmentPlan: await authorizePlanScoped(await scoped(req), Number(req.params.id)),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/schedules',
  requirePermission('dialysis.schedule.manage'),
  async (req: AuthRequest, res) => {
    try {
      const result = await scheduleDialysisScoped(await scoped(req), {
        ...req.body,
        idempotencyKey: req.get('Idempotency-Key') ?? req.body?.idempotencyKey,
      });
      res.status(result.idempotentReplay ? 200 : 201).json({ success: true, ...result });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/schedules/:id/start',
  requirePermission('dialysis.sessions.record'),
  validateBody(facilityActionBodySchema),
  async (req: AuthRequest, res) => {
    try {
      const result = await startDialysisSessionScoped(await scoped(req), Number(req.params.id));
      res.status(result.idempotentReplay ? 200 : 201).json({ success: true, ...result });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/sessions/:id/observations',
  requirePermission('dialysis.sessions.record'),
  async (req: AuthRequest, res) => {
    try {
      res.status(201).json({
        success: true,
        ...(await addSessionObservationScoped(
          await scoped(req),
          Number(req.params.id),
          req.body?.values,
        )),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/sessions/:id/consumables',
  requirePermission('dialysis.sessions.record', 'inventory.manage'),
  async (req: AuthRequest, res) => {
    try {
      const result = await recordConsumableScoped(await scoped(req), Number(req.params.id), {
        ...req.body,
        idempotencyKey: req.get('Idempotency-Key') ?? req.body?.idempotencyKey,
      });
      res.status(result.idempotentReplay ? 200 : 201).json({ success: true, ...result });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/sessions/:id/complete',
  requirePermission('dialysis.sessions.record'),
  async (req: AuthRequest, res) => {
    try {
      res.json({
        success: true,
        session: await completeDialysisSessionScoped(
          await scoped(req),
          Number(req.params.id),
          req.body ?? {},
        ),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/sessions/:id/adverse-events',
  requirePermission('dialysis.adverse_events.manage'),
  async (req: AuthRequest, res) => {
    try {
      res.status(201).json({
        success: true,
        event: await recordAdverseEventScoped(
          await scoped(req),
          Number(req.params.id),
          req.body ?? {},
        ),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/adverse-events/:id/follow-up',
  requirePermission('dialysis.adverse_events.manage'),
  async (req: AuthRequest, res) => {
    try {
      res.json({
        success: true,
        event: await followUpAdverseEventScoped(
          await scoped(req),
          Number(req.params.id),
          req.body ?? {},
        ),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
export default router;
