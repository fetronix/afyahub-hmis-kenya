import { Router, type NextFunction, type Response } from 'express';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission, requireSuperAdmin } from '../auth/authorization.middleware.ts';
import { hasPermission } from '../auth/authorization.service.ts';
import { resolveFacilityScope, ScopeAccessError } from '../auth/scope.service.ts';
import { getFacilityByIdScoped } from '../db/queries.ts';
import { PaymentHubError } from './errors.ts';
import * as hub from './service.ts';

const router = Router();
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
function fail(res: Response, error: unknown) {
  if (error instanceof PaymentHubError) {
    res.status(error.status).json({ success: false, error: error.code, message: error.message });
    return;
  }
  if (error instanceof ScopeAccessError) {
    res.status(403).json({ success: false, error: error.code, message: 'Facility access denied.' });
    return;
  }
  res.status(500).json({
    success: false,
    error: 'PAYMENT_HUB_OPERATION_FAILED',
    message: 'Payment integration operation failed.',
  });
}
async function scope(req: AuthRequest, finance = false): Promise<hub.HubScope> {
  const context = req.authContext;
  // A global provider administrator is not automatically a facility finance
  // operator. An explicitly assigned facility user must perform those actions.
  if (!context || context.isSuperAdmin)
    throw new ScopeAccessError('Facility-scoped authorization is required.');
  const query = req.query.facilityId,
    body = req.body?.facilityId;
  if (query != null && body != null && Number(query) !== Number(body))
    throw new ScopeAccessError('Facility identifiers do not match.');
  const raw = body ?? query;
  const id = raw === undefined || raw === null || raw === '' ? undefined : Number(raw);
  if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0))
    throw new ScopeAccessError('Invalid facility.');
  const facilityId = resolveFacilityScope(context, id);
  const facility = await getFacilityByIdScoped(context, facilityId);
  if (!facility) throw new ScopeAccessError('Facility not found.');
  if (
    finance &&
    (!Array.isArray(facility.enabledModules) || !facility.enabledModules.includes('finance'))
  )
    throw new PaymentHubError('FINANCE_DISABLED', 'Finance is disabled for this facility.', 403);
  return { tenantId: facility.tenantId, facilityId: facility.id, actorUserId: context.userId };
}
function secureCredentials(req: AuthRequest, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === 'production' && !req.secure) {
    res.status(403).json({
      success: false,
      error: 'HTTPS_REQUIRED',
      message: 'Credentials may only be configured over HTTPS.',
    });
    return;
  }
  next();
}
const actor = (req: AuthRequest) => req.authContext!.userId;
const wrap =
  (handler: (req: AuthRequest, res: Response) => Promise<void>) =>
  async (req: AuthRequest, res: Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      fail(res, error);
    }
  };

// Super-admin pages are metadata/provisioning only, never facility finance.
router.get(
  '/platform',
  requireSuperAdmin(),
  requirePermission('payment_hub.global.read'),
  wrap(async (_req, res) => {
    res.json({ success: true, ...(await hub.listPlatformHub()) });
  }),
);
router.get(
  '/platform/facilities',
  requireSuperAdmin(),
  requirePermission('payment_hub.assign'),
  wrap(async (_req, res) => {
    res.json({ success: true, facilities: await hub.listPlatformFacilities() });
  }),
);
router.post(
  '/platform/providers',
  requireSuperAdmin(),
  requirePermission('payment_hub.global.manage'),
  wrap(async (req, res) => {
    res
      .status(201)
      .json({ success: true, ...(await hub.registerProvider(actor(req), req.body ?? {})) });
  }),
);
router.patch(
  '/platform/providers/:id',
  requireSuperAdmin(),
  requirePermission('payment_hub.global.manage'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      ...(await hub.updateProvider(actor(req), Number(req.params.id), req.body ?? {})),
    });
  }),
);
router.put(
  '/platform/providers/:id/environments/:environment',
  requireSuperAdmin(),
  requirePermission('payment_hub.global.manage'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      ...(await hub.updateProviderEnvironment(
        actor(req),
        Number(req.params.id),
        req.params.environment,
        req.body ?? {},
      )),
    });
  }),
);
router.put(
  '/platform/providers/:id/capabilities/:capability',
  requireSuperAdmin(),
  requirePermission('payment_hub.global.manage'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      ...(await hub.updateProviderCapability(
        actor(req),
        Number(req.params.id),
        req.params.capability,
        req.body ?? {},
      )),
    });
  }),
);
router.put(
  '/platform/providers/:id/facilities/:facilityId',
  requireSuperAdmin(),
  requirePermission('payment_hub.assign'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      ...(await hub.assignProvider(
        actor(req),
        Number(req.params.id),
        Number(req.params.facilityId),
        req.body ?? {},
      )),
    });
  }),
);
router.post(
  '/platform/integrations/:id/production-decision',
  requireSuperAdmin(),
  requirePermission('payment_hub.production.approve'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      ...(await hub.decideProduction(actor(req), Number(req.params.id), req.body ?? {})),
    });
  }),
);

router.get(
  '/facility/catalogue',
  requirePermission('payment_hub.catalogue.read'),
  wrap(async (req, res) => {
    const s = await scope(req);
    res.json({
      success: true,
      ...(await hub.facilityCatalogue(
        s,
        hasPermission(req.authContext!, 'payment_hub.accounts.read'),
      )),
    });
  }),
);
router.post(
  '/facility/providers/:id/access-request',
  requirePermission('payment_hub.facility.manage'),
  wrap(async (req, res) => {
    res.status(201).json({
      success: true,
      ...(await hub.requestAccess(await scope(req), Number(req.params.id))),
    });
  }),
);
router.post(
  '/facility/providers/:id/integrations',
  requirePermission('payment_hub.facility.manage'),
  wrap(async (req, res) => {
    res.status(201).json({
      success: true,
      ...(await hub.configureIntegration(await scope(req), Number(req.params.id), req.body ?? {})),
    });
  }),
);
router.put(
  '/facility/integrations/:id/credentials',
  requirePermission('payment_hub.credentials.manage'),
  secureCredentials,
  wrap(async (req, res) => {
    res.json({
      success: true,
      ...(await hub.saveCredentials(await scope(req), Number(req.params.id), req.body ?? {})),
    });
  }),
);
router.post(
  '/facility/integrations/:id/accounts',
  requirePermission('payment_hub.facility.manage'),
  wrap(async (req, res) => {
    res.status(201).json({
      success: true,
      account: await hub.addFacilityAccount(
        await scope(req),
        Number(req.params.id),
        req.body ?? {},
      ),
    });
  }),
);
router.post(
  '/facility/integrations/:id/health',
  requirePermission('payment_hub.facility.manage'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      ...(await hub.testConnection(await scope(req), Number(req.params.id))),
    });
  }),
);
router.put(
  '/facility/integrations/:id/enabled',
  requirePermission('payment_hub.facility.manage'),
  wrap(async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean')
      throw new PaymentHubError('INVALID_INPUT', 'Specify whether the integration is enabled.');
    res.json({
      success: true,
      ...(await hub.setIntegrationEnabled(
        await scope(req),
        Number(req.params.id),
        req.body.enabled,
      )),
    });
  }),
);
router.post(
  '/facility/integrations/:id/production-request',
  requirePermission('payment_hub.production.request'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      ...(await hub.requestProduction(await scope(req), Number(req.params.id))),
    });
  }),
);

router.get(
  '/facility/transactions',
  requirePermission('payment_hub.transactions.read'),
  wrap(async (req, res) => {
    res.json({ success: true, ...(await hub.listFacilityTransactions(await scope(req, true))) });
  }),
);
router.post(
  '/facility/collections',
  requirePermission('payment_hub.collection.initiate'),
  wrap(async (req, res) => {
    const r = await hub.initiateCollection(await scope(req, true), {
      ...req.body,
      idempotencyKey: req.get('Idempotency-Key') ?? req.body?.idempotencyKey,
    });
    res.status(r.idempotentReplay ? 200 : 201).json({ success: true, ...r });
  }),
);
router.post(
  '/facility/transactions/:id/query',
  requirePermission('payment_hub.payments.verify'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      ...(await hub.queryTransaction(await scope(req, true), Number(req.params.id))),
    });
  }),
);
router.post(
  '/facility/transactions/:id/reconcile',
  requirePermission('payment_hub.reconciliation.manage'),
  wrap(async (req, res) => {
    res.status(201).json({
      success: true,
      ...(await hub.reconcileReceipt(
        await scope(req, true),
        Number(req.params.id),
        req.body ?? {},
      )),
    });
  }),
);
router.post(
  '/facility/reconciliations/:id/void',
  requirePermission('payment_hub.reconciliation.manage'),
  wrap(async (req, res) => {
    res.json({
      success: true,
      ...(await hub.voidReconciliation(
        await scope(req, true),
        Number(req.params.id),
        req.body?.reason,
      )),
    });
  }),
);
export default router;
