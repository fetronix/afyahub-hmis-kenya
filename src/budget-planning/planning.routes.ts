import express, { Router, type Response, type NextFunction } from 'express';
import path from 'node:path';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { requireScopedFacility } from '../routes/shared/scoping.ts';
import * as planning from './planning.service.ts';
import * as reports from './reports.service.ts';
import * as outcomes from './import-results.service.ts';
import { PlanningError, assert } from './calculations.ts';
const router = Router();
router.use(requirePermission('accounting.read', 'accounting.planning.read'));
type Work = (req: AuthRequest, res: Response, s: planning.PlanningScope) => Promise<unknown>;
function route(fn: Work) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const ctx = req.authContext;
      assert(
        ctx && !ctx.isSuperAdmin && !ctx.roles.includes('SUPER_ADMIN'),
        'FACILITY_ACCOUNT_REQUIRED',
        'Planning requires an authorized facility account.',
        403,
      );
      const facility = await requireScopedFacility(
        req,
        res,
        req.query.facilityId ?? req.body?.facilityId,
      );
      if (!facility) return;
      res.setHeader('Cache-Control', 'private, no-store');
      await fn(req, res, {
        tenantId: facility.tenantId,
        facilityId: facility.id,
        actorId: ctx.userId,
      });
    } catch (error) {
      if (error instanceof PlanningError) {
        res.status(error.status).json({ error: error.code, message: error.message });
        return;
      }
      const code = (error as { code?: string })?.code;
      if (code === '23505' || code === '23514') {
        res.status(409).json({
          error: 'PLANNING_CONFLICT',
          message:
            code === '23505'
              ? 'A matching plan or record already exists. Refresh and choose controlled merge/skip/update.'
              : 'Planning integrity checks refused this operation.',
        });
        return;
      }
      if ((error as { type?: string })?.type === 'entity.too.large') {
        next(error);
        return;
      }
      console.error(
        'Budget planning operation failed',
        error instanceof Error ? error.name : 'unknown',
      );
      res.status(500).json({
        error: 'PLANNING_FAILED',
        message: req.path.startsWith('/imports')
          ? 'The import request could not be verified. Reopen batch results before retrying. Import writes are atomic.'
          : 'The planning request could not be completed. No partial changes were committed.',
      });
    }
  };
}
const manage = requirePermission('accounting.planning.manage'),
  importPermission = requirePermission('accounting.planning.import', 'accounting.planning.manage'),
  exportPermission = requirePermission('accounting.planning.export');
router.get(
  '/plans',
  route(async (req, res, s) => res.json(await planning.listPlans(s, req.query))),
);
router.post(
  '/plans',
  manage,
  route(async (req, res, s) => res.status(201).json(await planning.createPlan(s, req.body))),
);
router.get(
  '/plans/:id',
  route(async (req, res, s) =>
    res.json(
      await reports.projection(s, req.params.id, { ...req.query, all: req.query.all === 'true' }),
    ),
  ),
);
router.get(
  '/plans/:id/items/:recordId',
  route(async (req, res, s) => {
    const result = await reports.projection(s, req.params.id, {
      itemId: req.params.recordId,
      all: true,
    });
    assert(result.items[0], 'ITEM_NOT_FOUND', 'Item not found.', 404);
    res.json(result.items[0]);
  }),
);
router.patch(
  '/plans/:id',
  manage,
  route(async (req, res, s) => res.json(await planning.updatePlan(s, req.params.id, req.body))),
);
router.post(
  '/plans/:id/status',
  route(async (req, res, s) => {
    const current = await planning.transaction((c) => planning.scopedPlan(c, s, req.params.id));
    const permission =
      req.body.status === 'APPROVED' ||
      (req.body.status === 'ARCHIVED' && current.status === 'APPROVED')
        ? 'accounting.planning.approve'
        : 'accounting.planning.manage';
    assert(
      req.authContext!.permissions.includes(permission),
      'PLANNING_FORBIDDEN',
      `This action requires ${permission}.`,
      403,
    );
    res.json(await planning.transitionPlan(s, req.params.id, req.body));
  }),
);
router.post(
  '/plans/:id/categories',
  manage,
  route(async (req, res, s) =>
    res.status(201).json(await planning.saveCategory(s, req.params.id, null, req.body)),
  ),
);
router.patch(
  '/plans/:id/categories/:recordId',
  manage,
  route(async (req, res, s) =>
    res.json(await planning.saveCategory(s, req.params.id, req.params.recordId, req.body)),
  ),
);
router.post(
  '/plans/:id/items',
  manage,
  route(async (req, res, s) =>
    res.status(201).json(await planning.saveItem(s, req.params.id, null, req.body)),
  ),
);
router.patch(
  '/plans/:id/items/:recordId',
  manage,
  route(async (req, res, s) =>
    res.json(await planning.saveItem(s, req.params.id, req.params.recordId, req.body)),
  ),
);
router.delete(
  '/plans/:id/items/:recordId',
  manage,
  route(async (req, res, s) =>
    res.json(
      await planning.archiveRecord(
        s,
        req.params.id,
        'items',
        req.params.recordId,
        req.body.version,
      ),
    ),
  ),
);
router.post(
  '/plans/:id/uniforms',
  manage,
  route(async (req, res, s) =>
    res.status(201).json(await planning.saveUniform(s, req.params.id, null, req.body)),
  ),
);
router.patch(
  '/plans/:id/uniforms/:recordId',
  manage,
  route(async (req, res, s) =>
    res.json(await planning.saveUniform(s, req.params.id, req.params.recordId, req.body)),
  ),
);
router.delete(
  '/plans/:id/uniforms/:recordId',
  manage,
  route(async (req, res, s) =>
    res.json(
      await planning.archiveRecord(
        s,
        req.params.id,
        'uniforms',
        req.params.recordId,
        req.body.version,
      ),
    ),
  ),
);
router.get(
  '/imports',
  route(async (req, res, s) =>
    res.json(await planning.importHistory(s, Number(req.query.page ?? 1))),
  ),
);
router.get(
  '/imports/summary',
  route(async (req, res, s) => res.json(await outcomes.importSummary(s, req.query.planId))),
);
router.get(
  '/imports/:id/results',
  route(async (req, res, s) => res.json(await outcomes.importResults(s, req.params.id))),
);
router.get(
  '/imports/:id/results.csv',
  exportPermission,
  route(async (req, res, s) => {
    const result = await outcomes.importResults(s, req.params.id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="planning-import-${result.batch.id}-${req.query.errorsOnly === 'true' ? 'errors' : 'results'}.csv"`,
    );
    res.send(outcomes.resultsCsv(result, req.query.errorsOnly === 'true'));
  }),
);
router.post(
  '/imports',
  importPermission,
  express.raw({
    type: [
      'text/csv',
      'application/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    limit: '4mb',
  }),
  route(async (req, res, s) => {
    assert(
      Buffer.isBuffer(req.body),
      'WORKBOOK_REQUIRED',
      'Send the workbook binary with its matching CSV/Excel MIME type.',
    );
    const filename = path.basename(
      decodeURIComponent(req.get('X-Filename') ?? '').replace(/\\/g, '/'),
    );
    res
      .status(201)
      .json(
        await planning.upload(s, req.body, filename, (req.get('Content-Type') ?? '').split(';')[0]),
      );
  }),
);
router.get(
  '/imports/:id',
  importPermission,
  route(async (req, res, s) => res.json(await planning.inspectBatch(s, req.params.id))),
);
router.post(
  '/imports/:id/preview',
  importPermission,
  route(async (req, res, s) => res.json(await planning.previewImport(s, req.params.id, req.body))),
);
router.post(
  '/imports/:id/confirm',
  importPermission,
  route(async (req, res, s) => res.json(await planning.confirmImport(s, req.params.id, req.body))),
);
router.post(
  '/imports/:id/retry-review',
  importPermission,
  route(async (req, res, s) =>
    res.json(await planning.retryImportReview(s, req.params.id, req.body)),
  ),
);
router.post(
  '/imports/:id/cancel',
  importPermission,
  route(async (req, res, s) => res.json(await planning.cancelImport(s, req.params.id))),
);
router.get(
  '/audit',
  requirePermission('accounting.planning.audit'),
  route(async (req, res, s) =>
    res.json(await planning.auditHistory(s, req.query.planId, Number(req.query.page ?? 1))),
  ),
);
router.get(
  '/plans/:id/reports',
  exportPermission,
  route(async (req, res, s) => res.json(await reports.reportHistory(s, req.params.id))),
);
router.post(
  '/plans/:id/reports',
  exportPermission,
  route(async (req, res, s) =>
    res.status(201).json(await reports.createReport(s, req.params.id, req.body)),
  ),
);
router.get(
  '/reports/:id/:format',
  exportPermission,
  route(async (req, res, s) => {
    assert(
      ['pdf', 'xlsx'].includes(String(req.params.format)),
      'REPORT_FORMAT',
      'Use pdf or xlsx.',
    );
    const format = req.params.format as 'pdf' | 'xlsx',
      bytes = await reports.reportFile(s, req.params.id, format);
    res.setHeader(
      'Content-Type',
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `${req.query.print === '1' ? 'inline' : 'attachment'}; filename="budget-plan-report-${Number(req.params.id)}.${format}"`,
    );
    res.send(bytes);
  }),
);
export default router;
