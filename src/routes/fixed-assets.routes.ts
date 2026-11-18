/**
 * Fixed-asset routes.
 *
 * The facility is always resolved through `requireScopedFacility`; an id in
 * the query string or body is a hint and never the authority. Reads require
 * `assets.read`. Register edits require `assets.manage`. Posting depreciation
 * is `assets.depreciate` and disposal is `assets.dispose`, so a storekeeper
 * with register access cannot write off hospital equipment or post to the
 * ledger.
 */

import { Router, type Response } from 'express';

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import * as assets from '../assets/fixed-assets.service.ts';
import * as batches from '../assets/asset-depreciation-batches.service.ts';
import * as maintenance from '../assets/asset-maintenance.service.ts';
import * as reports from '../assets/asset-reports.service.ts';
import { exportAssetReport } from '../assets/asset-report-export.ts';
import { resolveActiveLetterhead } from '../branding/letterhead.service.ts';
import { respondInternalError } from './shared/errors.ts';
import { requireScopedFacility } from './shared/scoping.ts';

const router = Router();

async function scope(
  req: AuthRequest,
  res: Response,
  rawFacilityId: unknown,
): Promise<assets.AssetScope | null> {
  const context = req.authContext;
  if (!context || !req.user) {
    res.status(401).json({
      success: false,
      error: 'AUTHORIZATION_CONTEXT_MISSING',
      message: 'Authorization context is required.',
    });
    return null;
  }
  if (context.isSuperAdmin && context.tenantId === null) {
    res.status(403).json({
      success: false,
      error: 'FACILITY_ASSET_USER_REQUIRED',
      message: 'Use an authorized facility account for fixed assets.',
    });
    return null;
  }
  const facility = await requireScopedFacility(req, res, rawFacilityId);
  if (!facility) return null;
  return {
    tenantId: facility.tenantId,
    facilityId: facility.id,
    actorId: context.userId,
    actorName: req.user.fullName || req.user.username,
  };
}

function idParam(req: AuthRequest, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res
      .status(400)
      .json({ success: false, error: 'INVALID_ID', message: 'A valid asset ID is required.' });
    return null;
  }
  return id;
}

function handleError(res: Response, err: unknown, route: string) {
  if (err instanceof assets.AssetError) {
    res.status(err.statusCode).json({ success: false, error: err.code, message: err.message });
    return;
  }
  if (err instanceof Error && err.name === 'DepreciationError') {
    res.status(400).json({
      success: false,
      error: (err as { code?: string }).code ?? 'INVALID_DEPRECIATION',
      message: err.message,
    });
    return;
  }
  if (err instanceof Error && err.name === 'AccountingIntegrityError') {
    const status = (err as { statusCode?: number }).statusCode ?? 409;
    res.status(status).json({
      success: false,
      error: (err as { code?: string }).code ?? 'LEDGER_POSTING_REFUSED',
      message: err.message,
    });
    return;
  }
  let code: string | undefined;
  let cursor: unknown = err;
  for (let depth = 0; depth < 4 && cursor; depth += 1) {
    const candidate = cursor as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string') {
      code = candidate.code;
      break;
    }
    cursor = candidate.cause;
  }
  if (code === '23505') {
    res.status(409).json({
      success: false,
      error: 'DUPLICATE_RECORD',
      message: 'A record with that code already exists in this facility.',
    });
    return;
  }
  respondInternalError(res, err, route);
}

router.get(
  '/overview',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await assets.assetOverview(access));
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/overview');
    }
  },
);

router.get(
  '/options',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await assets.assetOptions(access));
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/options');
    }
  },
);

router.get(
  '/categories',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await assets.listCategories(access));
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/categories');
    }
  },
);

router.post(
  '/categories',
  requirePermission('assets.manage'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await assets.createCategory(access, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/categories');
    }
  },
);

router.get('', requirePermission('assets.read'), async (req: AuthRequest, res: Response) => {
  const access = await scope(req, res, req.query.facilityId);
  if (!access) return;
  try {
    res.json(
      await assets.listAssets(access, {
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        categoryId: req.query.categoryId ? Number(req.query.categoryId) : undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      }),
    );
  } catch (err) {
    handleError(res, err, 'GET /api/fixed-assets');
  }
});

router.get('/report', requirePermission('assets.read'), async (req: AuthRequest, res: Response) => {
  const access = await scope(req, res, req.query.facilityId);
  if (!access) return;
  try {
    res.json(await assets.assetRegisterReport(access));
  } catch (err) {
    handleError(res, err, 'GET /api/fixed-assets/report');
  }
});

router.get(
  '/depreciation/preview',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await assets.depreciationPreview(access, String(req.query.period ?? '')));
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/depreciation/preview');
    }
  },
);

router.post(
  '/depreciation/run',
  requirePermission('assets.depreciate'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(
        await assets.runDepreciation(access, {
          period: String(body.period ?? ''),
          entryDate: typeof body.entryDate === 'string' ? body.entryDate : undefined,
        }),
      );
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/depreciation/run');
    }
  },
);

router.get(
  '/maintenance',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(
        await assets.listMaintenance(
          access,
          typeof req.query.status === 'string' ? req.query.status : undefined,
        ),
      );
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/maintenance');
    }
  },
);

router.post(
  '/maintenance',
  requirePermission('assets.manage'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await assets.createMaintenance(access, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/maintenance');
    }
  },
);

router.post(
  '/maintenance/:id/complete',
  requirePermission('assets.manage'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.json(await assets.completeMaintenance(access, id, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/maintenance/:id/complete');
    }
  },
);

router.get(
  '/transfers',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await assets.listTransfers(access));
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/transfers');
    }
  },
);

router.post('', requirePermission('assets.manage'), async (req: AuthRequest, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
  if (!access) return;
  try {
    res.status(201).json(await assets.createAsset(access, body));
  } catch (err) {
    handleError(res, err, 'POST /api/fixed-assets');
  }
});

router.put('/:id', requirePermission('assets.manage'), async (req: AuthRequest, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
  if (!access) return;
  const id = idParam(req, res);
  if (!id) return;
  try {
    res.json(await assets.updateAsset(access, id, body));
  } catch (err) {
    handleError(res, err, 'PUT /api/fixed-assets/:id');
  }
});

router.post(
  '/:id/transfer',
  requirePermission('assets.transfer'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.status(201).json(await assets.transferAsset(access, id, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/:id/transfer');
    }
  },
);

router.post(
  '/:id/dispose',
  requirePermission('assets.dispose'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.status(201).json(await assets.disposeAsset(access, id, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/:id/dispose');
    }
  },
);

/*
 * Impairment and revaluation are accounting judgements that move money between
 * the register and the ledger, so they are gated with `assets.dispose` — the
 * write-off authority — not with register-edit rights.
 */
router.post(
  '/:id/impair',
  requirePermission('assets.dispose'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.status(201).json(await assets.impairAsset(access, id, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/:id/impair');
    }
  },
);

router.post(
  '/:id/revalue',
  requirePermission('assets.dispose'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.status(201).json(await assets.revalueAsset(access, id, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/:id/revalue');
    }
  },
);

router.get(
  '/tax/rates',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await assets.listTaxRates(access));
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/tax/rates');
    }
  },
);

router.post(
  '/tax/rates',
  requirePermission('assets.manage'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await assets.createTaxRate(access, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/tax/rates');
    }
  },
);

router.get(
  '/tax/schedule',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await assets.taxDepreciationSchedule(access, String(req.query.period ?? '')));
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/tax/schedule');
    }
  },
);

/* ============================================================
   DEPRECIATION POLICY AND BATCH LIFECYCLE
   ============================================================ */

router.get(
  '/settings',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await batches.getDepreciationSettings(access));
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/settings');
    }
  },
);

router.put(
  '/settings',
  requirePermission('assets.depreciation.configure'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.json(await batches.updateDepreciationSettings(access, body));
    } catch (err) {
      handleError(res, err, 'PUT /api/fixed-assets/settings');
    }
  },
);

router.get(
  '/depreciation/batches',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(
        await batches.listDepreciationBatches(access, {
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          period: typeof req.query.period === 'string' ? req.query.period : undefined,
        }),
      );
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/depreciation/batches');
    }
  },
);

router.get(
  '/depreciation/batches/:batchId',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const batchId = Number(req.params.batchId);
    if (!Number.isSafeInteger(batchId) || batchId <= 0) {
      res
        .status(400)
        .json({ success: false, error: 'INVALID_ID', message: 'A valid batch ID is required.' });
      return;
    }
    try {
      res.json(await batches.getDepreciationBatch(access, batchId));
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/depreciation/batches/:batchId');
    }
  },
);

router.post(
  '/depreciation/batches/preview',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.json(await batches.previewDepreciationBatch(access, String(body.period ?? '')));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/depreciation/batches/preview');
    }
  },
);

router.post(
  '/depreciation/batches',
  requirePermission('assets.depreciate'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await batches.prepareDepreciationBatch(access, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/depreciation/batches');
    }
  },
);

router.post(
  '/depreciation/batches/:batchId/approve',
  requirePermission('assets.depreciation.approve'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const batchId = Number(req.params.batchId);
    if (!Number.isSafeInteger(batchId) || batchId <= 0) {
      res
        .status(400)
        .json({ success: false, error: 'INVALID_ID', message: 'A valid batch ID is required.' });
      return;
    }
    try {
      res.json(await batches.approveDepreciationBatch(access, batchId, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/depreciation/batches/:batchId/approve');
    }
  },
);

router.post(
  '/depreciation/batches/:batchId/post',
  requirePermission('assets.depreciation.approve'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const batchId = Number(req.params.batchId);
    if (!Number.isSafeInteger(batchId) || batchId <= 0) {
      res
        .status(400)
        .json({ success: false, error: 'INVALID_ID', message: 'A valid batch ID is required.' });
      return;
    }
    try {
      res.json(await batches.postDepreciationBatch(access, batchId, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/depreciation/batches/:batchId/post');
    }
  },
);

router.post(
  '/depreciation/batches/:batchId/reverse',
  requirePermission('assets.depreciation.approve'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const batchId = Number(req.params.batchId);
    if (!Number.isSafeInteger(batchId) || batchId <= 0) {
      res
        .status(400)
        .json({ success: false, error: 'INVALID_ID', message: 'A valid batch ID is required.' });
      return;
    }
    try {
      res.json(await batches.reverseDepreciationBatch(access, batchId, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/depreciation/batches/:batchId/reverse');
    }
  },
);

router.delete(
  '/depreciation/batches/:batchId',
  requirePermission('assets.depreciate'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const batchId = Number(req.params.batchId);
    if (!Number.isSafeInteger(batchId) || batchId <= 0) {
      res
        .status(400)
        .json({ success: false, error: 'INVALID_ID', message: 'A valid batch ID is required.' });
      return;
    }
    try {
      res.json(await batches.discardDepreciationBatch(access, batchId));
    } catch (err) {
      handleError(res, err, 'DELETE /api/fixed-assets/depreciation/batches/:batchId');
    }
  },
);

router.get(
  '/depreciation/schedule/:assetId',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const assetId = Number(req.params.assetId);
    if (!Number.isSafeInteger(assetId) || assetId <= 0) {
      res
        .status(400)
        .json({ success: false, error: 'INVALID_ID', message: 'A valid asset ID is required.' });
      return;
    }
    try {
      res.json(
        await batches.assetDepreciationSchedule(access, assetId, {
          months: req.query.months ? Number(req.query.months) : undefined,
          fromPeriod: typeof req.query.fromPeriod === 'string' ? req.query.fromPeriod : undefined,
        }),
      );
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/depreciation/schedule/:assetId');
    }
  },
);

/* ============================================================
   PREVENTIVE SCHEDULES AND CORRECTIVE MAINTENANCE
   ============================================================ */

router.get(
  '/maintenance/schedules',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(
        await maintenance.listMaintenanceSchedules(access, {
          assetId: req.query.assetId ? Number(req.query.assetId) : undefined,
          includeInactive: req.query.includeInactive === 'true',
          dueOnly: req.query.dueOnly === 'true',
        }),
      );
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/maintenance/schedules');
    }
  },
);

router.post(
  '/maintenance/schedules',
  requirePermission('assets.maintenance.manage'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await maintenance.createMaintenanceSchedule(access, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/maintenance/schedules');
    }
  },
);

router.put(
  '/maintenance/schedules/:scheduleId',
  requirePermission('assets.maintenance.manage'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const scheduleId = Number(req.params.scheduleId);
    if (!Number.isSafeInteger(scheduleId) || scheduleId <= 0) {
      res
        .status(400)
        .json({ success: false, error: 'INVALID_ID', message: 'A valid schedule ID is required.' });
      return;
    }
    try {
      res.json(await maintenance.updateMaintenanceSchedule(access, scheduleId, body));
    } catch (err) {
      handleError(res, err, 'PUT /api/fixed-assets/maintenance/schedules/:scheduleId');
    }
  },
);

router.post(
  '/maintenance/schedules/:scheduleId/retire',
  requirePermission('assets.maintenance.manage'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const scheduleId = Number(req.params.scheduleId);
    if (!Number.isSafeInteger(scheduleId) || scheduleId <= 0) {
      res
        .status(400)
        .json({ success: false, error: 'INVALID_ID', message: 'A valid schedule ID is required.' });
      return;
    }
    try {
      res.json(await maintenance.retireMaintenanceSchedule(access, scheduleId, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/maintenance/schedules/:scheduleId/retire');
    }
  },
);

router.post(
  '/maintenance/schedules/:scheduleId/complete',
  requirePermission('assets.maintenance.manage'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const scheduleId = Number(req.params.scheduleId);
    if (!Number.isSafeInteger(scheduleId) || scheduleId <= 0) {
      res
        .status(400)
        .json({ success: false, error: 'INVALID_ID', message: 'A valid schedule ID is required.' });
      return;
    }
    try {
      res.json(await maintenance.completeScheduledMaintenance(access, scheduleId, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/maintenance/schedules/:scheduleId/complete');
    }
  },
);

router.get(
  '/maintenance/jobs',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(
        await maintenance.listMaintenanceJobs(access, {
          assetId: req.query.assetId ? Number(req.query.assetId) : undefined,
          type: typeof req.query.type === 'string' ? req.query.type : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
        }),
      );
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/maintenance/jobs');
    }
  },
);

router.get(
  '/maintenance/dashboard',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await maintenance.maintenanceDashboard(access));
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/maintenance/dashboard');
    }
  },
);

router.post(
  '/maintenance/corrective',
  requirePermission('assets.maintenance.manage'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await maintenance.createCorrectiveMaintenance(access, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/maintenance/corrective');
    }
  },
);

router.post(
  '/maintenance/:id/complete-corrective',
  requirePermission('assets.maintenance.manage'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.json(await maintenance.completeCorrectiveMaintenance(access, id, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/maintenance/:id/complete-corrective');
    }
  },
);

router.post(
  '/maintenance/:id/verify',
  requirePermission('assets.maintenance.manage'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.json(await maintenance.verifyMaintenance(access, id, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/maintenance/:id/verify');
    }
  },
);

/* ============================================================
   INSPECTIONS
   ============================================================ */

router.get(
  '/inspections',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(
        await maintenance.listInspections(access, {
          assetId: req.query.assetId ? Number(req.query.assetId) : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          from: typeof req.query.from === 'string' ? req.query.from : undefined,
          to: typeof req.query.to === 'string' ? req.query.to : undefined,
        }),
      );
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/inspections');
    }
  },
);

router.post(
  '/inspections',
  requirePermission('assets.inspections.perform'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await maintenance.createInspection(access, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/inspections');
    }
  },
);

router.post(
  '/inspections/:id/complete',
  requirePermission('assets.inspections.perform'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.json(await maintenance.completeInspection(access, id, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/inspections/:id/complete');
    }
  },
);

/* ============================================================
   LIFECYCLE AND DOCUMENTS
   ============================================================ */

router.get(
  '/lifecycle',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(
        await maintenance.listLifecycleEvents(access, {
          assetId: req.query.assetId ? Number(req.query.assetId) : undefined,
          eventType: typeof req.query.eventType === 'string' ? req.query.eventType : undefined,
        }),
      );
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/lifecycle');
    }
  },
);

router.post(
  '/:id/status',
  requirePermission('assets.manage'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.json(await maintenance.changeAssetStatus(access, id, body));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/:id/status');
    }
  },
);

router.get(
  '/:id/operations',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.json(await maintenance.assetOperations(access, id));
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/:id/operations');
    }
  },
);

router.get(
  '/:id/documents',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.json(await maintenance.listAssetDocuments(access, id));
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/:id/documents');
    }
  },
);

router.post(
  '/:id/documents',
  requirePermission('assets.manage'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.status(201).json(await maintenance.uploadAssetDocument(access, { ...body, assetId: id }));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/:id/documents');
    }
  },
);

router.get(
  '/documents/:documentId',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const documentId = Number(req.params.documentId);
    if (!Number.isSafeInteger(documentId) || documentId <= 0) {
      res
        .status(400)
        .json({ success: false, error: 'INVALID_ID', message: 'A valid document ID is required.' });
      return;
    }
    try {
      const document = await maintenance.getAssetDocument(access, documentId);
      res.json({
        id: document.id,
        assetId: document.assetId,
        title: document.title,
        filename: document.filename,
        mimeType: document.mimeType,
        sha256: document.sha256,
        base64: document.content.toString('base64'),
      });
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/documents/:documentId');
    }
  },
);

/* ============================================================
   REPORTS AND DASHBOARD
   ============================================================ */

router.get(
  '/dashboard',
  requirePermission('assets.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      const [counters, maintenanceSummary, latestBatch] = await Promise.all([
        maintenance.assetCounters(access),
        maintenance.maintenanceDashboard(access),
        batches.listDepreciationBatches(access, { limit: 5 }),
      ]);
      res.json({ counters, maintenance: maintenanceSummary, latestBatches: latestBatch });
    } catch (err) {
      handleError(res, err, 'GET /api/fixed-assets/dashboard');
    }
  },
);

router.get(
  '/reports',
  requirePermission('assets.read'),
  async (_req: AuthRequest, res: Response) => {
    res.json({
      reports: reports.ASSET_REPORTS.map((report) => ({
        key: report.key,
        title: report.title,
        description: report.description,
        needsPeriod: report.needsPeriod,
        needsRange: report.needsRange,
        columns: report.columns,
      })),
    });
  },
);

function reportFilters(source: Record<string, unknown>): reports.ReportFilters {
  const filters: reports.ReportFilters = {};
  if (typeof source.dateFrom === 'string') filters.dateFrom = source.dateFrom;
  if (typeof source.dateTo === 'string') filters.dateTo = source.dateTo;
  if (source.period) filters.period = String(source.period);
  if (source.categoryId) filters.categoryId = Number(source.categoryId);
  if (source.departmentId) filters.departmentId = Number(source.departmentId);
  if (source.assetId) filters.assetId = Number(source.assetId);
  if (typeof source.status === 'string') filters.status = source.status;
  return filters;
}

router.post(
  '/reports/:key',
  requirePermission('assets.reports.financial'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.json(
        await reports.buildAssetReport(
          access,
          req.params.key as reports.AssetReportKey,
          reportFilters(body),
        ),
      );
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/reports/:key');
    }
  },
);

router.post(
  '/reports/:key/export',
  requirePermission('assets.reports.financial'),
  async (req: AuthRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const access = await scope(req, res, body.facilityId ?? req.query.facilityId);
    if (!access) return;
    const format = body.format;
    if (format !== 'pdf' && format !== 'xlsx') {
      res.status(400).json({
        success: false,
        error: 'INVALID_FORMAT',
        message: 'Choose PDF or Excel for this report.',
      });
      return;
    }
    try {
      const report = await reports.buildAssetReport(
        access,
        req.params.key as reports.AssetReportKey,
        reportFilters(body),
      );
      const letterhead =
        format === 'pdf' ? await resolveActiveLetterhead(access.tenantId, access.facilityId) : null;
      res.json(await exportAssetReport(report, format, letterhead));
    } catch (err) {
      handleError(res, err, 'POST /api/fixed-assets/reports/:key/export');
    }
  },
);

/* Registered last: a literal path such as /dashboard or /settings must not
   be captured as an asset id. */
router.get('/:id', requirePermission('assets.read'), async (req: AuthRequest, res: Response) => {
  const access = await scope(req, res, req.query.facilityId);
  if (!access) return;
  const id = idParam(req, res);
  if (!id) return;
  try {
    res.json(await assets.assetDetail(access, id));
  } catch (err) {
    handleError(res, err, 'GET /api/fixed-assets/:id');
  }
});

export default router;
