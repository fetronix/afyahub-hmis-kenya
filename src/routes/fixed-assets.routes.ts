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
  requirePermission('assets.manage'),
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

export default router;
