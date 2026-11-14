import express, { Router, type Response, type NextFunction } from 'express';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { PlanningError } from '../budget-planning/calculations.ts';
import { pool } from '../db/index.ts';
import { resolveActiveLetterhead } from '../branding/letterhead.service.ts';
import { renderDocument } from '../documents/render.ts';
import type { DocumentFacility } from '../documents/document-model.ts';
import * as svc from './service.ts';
import { equityDocument, statementCsv, statementXlsx } from './export.ts';
const router = Router();
router.use(
  express.json({ limit: '512kb' }),
  requirePermission('accounting.read', 'accounting.equity.read'),
);
type Request = AuthRequest & { equityScope: svc.Scope };
router.use((req: AuthRequest, res: Response, next: NextFunction) => {
  const ctx = req.authContext;
  if (
    !ctx ||
    ctx.isSuperAdmin ||
    ctx.roles.includes('SUPER_ADMIN') ||
    !ctx.tenantId ||
    !ctx.facilityId
  ) {
    res.status(403).json({
      error: 'FACILITY_ACCOUNT_REQUIRED',
      message: 'Partner statements require an authorized facility account.',
    });
    return;
  }
  if (
    [req.query.facilityId, req.body?.facilityId].some(
      (v) => v !== undefined && Number(v) !== ctx.facilityId,
    )
  ) {
    res.status(403).json({
      error: 'FACILITY_MISMATCH',
      message: 'Statement scope is always your authenticated facility.',
    });
    return;
  }
  (req as Request).equityScope = {
    tenantId: ctx.tenantId,
    facilityId: ctx.facilityId,
    actorId: ctx.userId,
  };
  next();
});
const work =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: AuthRequest, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      await fn(req as Request, res);
    } catch (e) {
      if (e instanceof PlanningError) {
        res.status(e.status).json({ error: e.code, message: e.message });
        return;
      }
      const code = (e as { code?: string })?.code;
      if (code === '23505' || code === '23514') {
        res.status(409).json({
          error: 'EQUITY_CONFLICT',
          message: 'Statement integrity or duplicate-period check refused the operation. Reload.',
        });
        return;
      }
      if (e instanceof Error && !(e as { code?: string }).code) {
        res.status(400).json({ error: 'INVALID_EQUITY_INPUT', message: e.message });
        return;
      }
      res.status(500).json({
        error: 'EQUITY_FAILED',
        message: 'Operation could not be verified. Writes are atomic; reload saved data.',
      });
    }
  };
const permission = (key: string) => requirePermission('accounting.equity.' + key);
router.get(
  '/partners',
  work(async (req, res) => res.json(await svc.register(req.equityScope))),
);
router.put(
  '/partners',
  permission('partners'),
  work(async (req, res) => res.json(await svc.savePartner(req.equityScope, req.body))),
);
router.get(
  '/statements',
  work(async (req, res) => res.json(await svc.listStatements(req.equityScope, req.query.year))),
);
router.post(
  '/statements',
  permission('manage'),
  work(async (req, res) =>
    res.status(201).json(await svc.createStatement(req.equityScope, req.body)),
  ),
);
router.get(
  '/statements/:id',
  work(async (req, res) => res.json(await svc.getStatement(req.equityScope, req.params.id))),
);
router.put(
  '/statements/:id',
  permission('manage'),
  work(async (req, res) =>
    res.json(await svc.saveStatement(req.equityScope, req.params.id, req.body)),
  ),
);
router.post(
  '/statements/:id/revise',
  permission('manage'),
  work(async (req, res) =>
    res.status(201).json(await svc.revise(req.equityScope, req.params.id, req.body)),
  ),
);
router.post(
  '/statements/:id/include-partner',
  permission('manage'),
  work(async (req, res) =>
    res.json(await svc.includePartner(req.equityScope, req.params.id, req.body)),
  ),
);
router.get(
  '/statements/:id/carry-preview',
  permission('manage'),
  work(async (req, res) =>
    res.json(await svc.carryPreview(req.equityScope, req.params.id, req.query.sourceId)),
  ),
);
router.post(
  '/statements/:id/carry',
  permission('manage'),
  work(async (req, res) =>
    res.json(await svc.carryForward(req.equityScope, req.params.id, req.body)),
  ),
);
router.post(
  '/statements/:id/workflow',
  (req, res, next) => {
    const action = req.body?.action;
    const p =
      action === 'submit'
        ? 'manage'
        : action === 'approve'
          ? 'approve'
          : action === 'review' || action === 'return'
            ? 'review'
            : null;
    if (!p) {
      res
        .status(400)
        .json({ error: 'INVALID_ACTION', message: 'Choose submit, review, return or approve.' });
      return;
    }
    permission(p)(req, res, next);
  },
  work(async (req, res) =>
    res.json(await svc.transition(req.equityScope, req.params.id, req.body)),
  ),
);
router.get(
  '/statements/:id/audit',
  permission('audit'),
  work(async (req, res) => res.json(await svc.history(req.equityScope, req.params.id))),
);
router.get(
  '/statements/:id/export',
  permission('export'),
  work(async (req, res) => {
    const format = String(req.query.format);
    if (!['csv', 'xlsx', 'pdf'].includes(format)) throw new Error('Choose CSV, XLSX or PDF.');
    const s = await svc.getStatement(req.equityScope, req.params.id);
    let bytes: Buffer | string;
    if (format === 'pdf') {
      const head = await resolveActiveLetterhead(
        req.equityScope.tenantId,
        req.equityScope.facilityId,
      );
      if (!head?.bytes)
        throw new PlanningError(
          'ACTIVE_LETTERHEAD_REQUIRED',
          'Activate the facility letterhead/logo in Facility Branding before PDF export.',
          409,
        );
      if (
        head.pageWidthPt - head.bodyLeftPt - head.bodyRightPt < 250 ||
        head.pageHeightPt - head.bodyTopPt - head.bodyBottomPt < 220
      )
        throw new PlanningError(
          'LETTERHEAD_BODY_TOO_SMALL',
          'Review facility letterhead body margins before generating this statement.',
          409,
        );
      const facility = (
        await pool.query(
          'SELECT name,code,mfl_code AS "registryCode",address,county,phone,email FROM facilities WHERE id=$1 AND tenant_id=$2',
          [req.equityScope.facilityId, req.equityScope.tenantId],
        )
      ).rows[0] as DocumentFacility;
      const model = equityDocument(s, facility);
      model.brandingNote = `Facility letterhead version ${head.version}`;
      bytes = (await renderDocument(model, head)).bytes;
    } else bytes = format === 'csv' ? statementCsv(s) : statementXlsx(s);
    await svc.exportAudit(req.equityScope, s.id, format, s.version);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="partner-equity-${s.financial_year}-${s.id}-r${s.revision}.${format}"`,
    );
    res.type(
      format === 'pdf'
        ? 'application/pdf'
        : format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.send(bytes);
  }),
);
export default router;
