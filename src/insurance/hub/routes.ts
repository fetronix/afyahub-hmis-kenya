import { Router, type Response } from 'express';
import type { AuthRequest } from '../../auth/auth.middleware.ts';
import {
  requireAnyPermission,
  requirePermission,
  requireSuperAdmin,
} from '../../auth/authorization.middleware.ts';
import { resolveFacilityScope, ScopeAccessError } from '../../auth/scope.service.ts';
import { getFacilityByIdScoped } from '../../db/queries.ts';
import * as hub from './service.ts';

const router = Router();
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
function body(req: AuthRequest): Record<string, unknown> {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
}
async function facilityScope(req: AuthRequest): Promise<hub.PayerScope> {
  const context = req.authContext;
  // Platform provider administration never confers facility clinical access.
  if (!context || context.isSuperAdmin)
    throw new ScopeAccessError('A facility-scoped account is required.');
  const queryId = req.query.facilityId;
  const bodyId = body(req).facilityId;
  if (queryId != null && bodyId != null && Number(queryId) !== Number(bodyId))
    throw new ScopeAccessError('Facility identifiers do not match.');
  const raw = bodyId ?? queryId;
  const requested = raw === undefined || raw === null || raw === '' ? undefined : Number(raw);
  if (requested !== undefined && (!Number.isSafeInteger(requested) || requested <= 0))
    throw new ScopeAccessError('Invalid facility.');
  const facilityId = resolveFacilityScope(context, requested);
  const facility = await getFacilityByIdScoped(context, facilityId);
  if (!facility || facility.tenantId !== context.tenantId)
    throw new ScopeAccessError('Facility not found.');
  if (!Array.isArray(facility.enabledModules) || !facility.enabledModules.includes('insurance'))
    throw new hub.PayerHubError(
      'FACILITY_MODULE_DISABLED',
      'The insurance module is disabled for this facility.',
      403,
    );
  return { tenantId: facility.tenantId, facilityId, actorUserId: context.userId };
}
function fail(res: Response, error: unknown) {
  if (error instanceof hub.PayerHubError)
    return res
      .status(error.status)
      .json({ success: false, error: error.code, message: error.message });
  if (error instanceof ScopeAccessError)
    return res
      .status(403)
      .json({ success: false, error: error.code, message: 'Facility access denied.' });
  return res.status(500).json({
    success: false,
    error: 'PAYER_HUB_OPERATION_FAILED',
    message: 'Payer hub operation failed.',
  });
}
const wrap =
  (handler: (req: AuthRequest, res: Response) => Promise<void>) =>
  async (req: AuthRequest, res: Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      fail(res, error);
    }
  };
const actor = (req: AuthRequest) => req.authContext!.userId;

router.get(
  '/platform',
  requireSuperAdmin(),
  requirePermission('payer_hub.global.read'),
  wrap(async (_req, res) => {
    res.json({ success: true, ...(await hub.listPlatformPayers()) });
  }),
);
router.get(
  '/platform/facilities',
  requireSuperAdmin(),
  requirePermission('payer_hub.assign'),
  wrap(async (_req, res) => {
    res.json({ success: true, facilities: await hub.listPlatformFacilities() });
  }),
);
router.post(
  '/platform/payers',
  requireSuperAdmin(),
  requirePermission('payer_hub.global.manage'),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, payer: await hub.registerPayer(actor(req), body(req)) });
  }),
);
router.patch(
  '/platform/payers/:id',
  requireSuperAdmin(),
  requirePermission('payer_hub.global.manage'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      payer: await hub.updatePayer(actor(req), Number(req.params.id), body(req)),
    });
  }),
);
router.put(
  '/platform/payers/:id/workflows/:workflow',
  requireSuperAdmin(),
  requirePermission('payer_hub.global.manage'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      policy: await hub.updateCapability(
        actor(req),
        Number(req.params.id),
        req.params.workflow,
        body(req).isAllowed,
      ),
    });
  }),
);
router.put(
  '/platform/payers/:id/facilities/:facilityId',
  requireSuperAdmin(),
  requirePermission('payer_hub.assign'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      assignment: await hub.assignPayer(
        actor(req),
        Number(req.params.id),
        Number(req.params.facilityId),
        body(req).isAllowed,
      ),
    });
  }),
);
router.post(
  '/platform/assignments/:id/production-decision',
  requireSuperAdmin(),
  requirePermission('payer_hub.production.approve'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      ...(await hub.decideProduction(actor(req), Number(req.params.id), body(req))),
    });
  }),
);

router.get(
  '/facility/catalogue',
  requireAnyPermission(
    'payer_hub.catalogue.read',
    'insurance.read',
    'insurance.private.claims.prepare',
    'insurance.sha.claims.prepare',
    'insurance.claims.create',
  ),
  wrap(async (req, res) => {
    res.json({ success: true, ...(await hub.facilityCatalogue(await facilityScope(req))) });
  }),
);
router.post(
  '/facility/payers/:id/access-request',
  requirePermission('payer_hub.facility.manage'),
  wrap(async (req, res) => {
    res.status(201).json({
      success: true,
      request: await hub.requestAccess(await facilityScope(req), Number(req.params.id)),
    });
  }),
);
router.put(
  '/facility/payers/:id/activation',
  requirePermission('payer_hub.facility.manage'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      ...(await hub.setActivation(
        await facilityScope(req),
        Number(req.params.id),
        body(req).isActive,
      )),
    });
  }),
);
router.put(
  '/facility/payers/:id/environments/:environment',
  requirePermission('payer_hub.credentials.manage'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      ...(await hub.configureEnvironment(
        await facilityScope(req),
        Number(req.params.id),
        req.params.environment,
        body(req),
      )),
    });
  }),
);
router.post(
  '/facility/payers/:id/production-request',
  requirePermission('payer_hub.production.request'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      ...(await hub.requestProduction(await facilityScope(req), Number(req.params.id))),
    });
  }),
);
router.post(
  '/facility/payers/:id/connection-test',
  requirePermission('payer_hub.facility.manage'),
  wrap(async (req, res) => {
    const scope = await facilityScope(req);
    const catalogue = await hub.facilityCatalogue(scope);
    const payer = catalogue.providers.find((p) => p.id === Number(req.params.id));
    if (!payer) throw new hub.PayerHubError('PAYER_NOT_FOUND', 'Payer not found.', 404);
    await hub.assertPayerAccess(scope, payer.code, 'CONFIGURE', { configuration: true });
    // No authorized sandbox transport is available; a presence check is not a test.
    res.json({
      success: true,
      tested: false,
      verified: false,
      status: 'NOT_TESTED',
      message:
        'No authorized, facility-isolated sandbox test is implemented. No external request was sent.',
    });
  }),
);
export default router;
