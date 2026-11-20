/**
 * Syrona Medical Center HMIS — /api/financial-statements
 *
 * Every route is facility-scoped to the authenticated facility and gated by a
 * separate permission for preparing, reviewing, approving, reopening and
 * configuring. Facility isolation and permission checks are the only way a
 * statement crosses a facility boundary — none is accepted from the request.
 */

import express, { Router, type Response } from 'express';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { ScopeAccessError, resolveFacilityScope } from '../auth/scope.service.ts';
import { getValidatedBody, validateBody } from '../validation/validate.ts';
import {
  addStatementNoteBodySchema,
  approveFinancialStatementBodySchema,
  closeFinancialYearBodySchema,
  financialStatementMappingBodySchema,
  financialStatementSettingsBodySchema,
  generateFinancialStatementBodySchema,
  reopenFinancialPeriodBodySchema,
  reviewFinancialStatementBodySchema,
  reviseFinancialStatementBodySchema,
} from '../validation/schemas/index.ts';
import {
  FinancialStatementError,
  addNoteScoped,
  approveRunScoped,
  closeFinancialYearScoped,
  dashboardScoped,
  exportRunScoped,
  generateScoped,
  getRunScoped,
  getSettingsScoped,
  listMappingScoped,
  listRunsScoped,
  reopenPeriodScoped,
  reviewRunScoped,
  reviseRunScoped,
  saveMappingScoped,
  saveSettingsScoped,
  type GenerateStatementInput,
} from '../financial-statements/service.ts';
import type { ExportFormat, ExportStatement } from '../financial-statements/export.ts';

const router = Router();
router.use(express.json({ limit: '1mb' }));

type ScopedRequest = AuthRequest & {
  statementScope: { tenantId: number; facilityId: number; actorUserId: number };
};

/**
 * Statements are always for the authenticated facility. A cross-facility
 * request is refused rather than silently narrowed, because a statement
 * mislabelled with another facility's name is worse than an error.
 */
router.use((req: AuthRequest, res: Response, next) => {
  const context = req.authContext;
  if (!context || context.isSuperAdmin || !context.tenantId || !context.facilityId) {
    res.status(403).json({
      error: 'FACILITY_ACCOUNT_REQUIRED',
      message:
        'Financial statements require an authorized facility account. System administration cannot read facility books.',
    });
    return;
  }
  try {
    const requested = [
      req.query.facilityId,
      (req.body as { facilityId?: unknown } | undefined)?.facilityId,
    ].find((value) => value !== undefined && value !== null && value !== '');
    const facilityId = resolveFacilityScope(
      context,
      requested === undefined ? undefined : Number(requested),
    );
    (req as ScopedRequest).statementScope = {
      tenantId: context.tenantId,
      facilityId,
      actorUserId: context.userId,
    };
    next();
  } catch (error) {
    if (error instanceof ScopeAccessError) {
      res.status(403).json({ error: error.code, message: error.message });
      return;
    }
    next(error);
  }
});

const work =
  (fn: (req: ScopedRequest, res: Response) => Promise<unknown>) =>
  async (req: AuthRequest, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      await fn(req as ScopedRequest, res);
    } catch (error) {
      if (error instanceof FinancialStatementError) {
        res.status(error.status).json({ error: error.code, message: error.message });
        return;
      }
      if (error instanceof ScopeAccessError) {
        res.status(403).json({ error: error.code, message: error.message });
        return;
      }
      const code = (error as { code?: string })?.code;
      if (code === '23505') {
        res.status(409).json({
          error: 'STATEMENT_CONFLICT',
          message:
            'Another version of this statement was saved at the same moment. Reload the archive and try again.',
        });
        return;
      }
      if (code === '23514') {
        res.status(409).json({
          error: 'STATEMENT_FROZEN',
          message:
            'An approved statement cannot be changed. Create a revised version instead of editing the approved one.',
        });
        return;
      }
      console.error('[financial-statements]', error);
      res.status(500).json({
        error: 'STATEMENT_FAILED',
        message: 'The request could not be completed. No statement was approved or altered.',
      });
    }
  };

const read = requirePermission('accounting.read');
const prepare = requirePermission('accounting.statements.prepare');
const review = requirePermission('accounting.statements.review');
const approve = requirePermission('accounting.statements.approve');
const reopen = requirePermission('accounting.statements.reopen');
const configure = requirePermission('accounting.statements.configure');
const exportPermission = requirePermission('accounting.reports.export');

/* ---------------- dashboard and configuration ---------------- */

router.get(
  '/dashboard',
  read,
  work(async (req, res) => res.json(await dashboardScoped(req.statementScope))),
);

router.get(
  '/settings',
  read,
  work(async (req, res) => res.json(await getSettingsScoped(req.statementScope))),
);

router.put(
  '/settings',
  configure,
  validateBody(financialStatementSettingsBodySchema),
  work(async (req, res) =>
    res.json(
      await saveSettingsScoped(req.statementScope, getValidatedBody<Record<string, unknown>>(req)),
    ),
  ),
);

router.get(
  '/mapping',
  read,
  work(async (req, res) => res.json({ accounts: await listMappingScoped(req.statementScope) })),
);

router.put(
  '/mapping',
  configure,
  validateBody(financialStatementMappingBodySchema),
  work(async (req, res) =>
    res.json({
      accounts: await saveMappingScoped(
        req.statementScope,
        getValidatedBody<Record<string, unknown>>(req),
      ),
    }),
  ),
);

/* ---------------- generation ---------------- */

router.post(
  '/runs',
  prepare,
  validateBody(generateFinancialStatementBodySchema),
  work(async (req, res) => {
    const body = getValidatedBody<GenerateStatementInput & { notes?: unknown }>(req);
    const notes = Array.isArray(body.notes)
      ? body.notes.map((note, index) => {
          const entry = note as { title?: unknown; body?: unknown };
          if (typeof entry.body !== 'string' || !entry.body.trim()) {
            throw new FinancialStatementError('INVALID_NOTE', `Note ${index + 1} needs text.`);
          }
          return {
            noteRef: String(index + 1),
            title:
              typeof entry.title === 'string' && entry.title.trim()
                ? entry.title.trim()
                : 'Management note',
            body: entry.body.trim(),
            authorUserId: req.statementScope.actorUserId,
            authorName: null,
            recordedAt: new Date().toISOString(),
          };
        })
      : [];
    res.status(201).json(await generateScoped(req.statementScope, body, notes));
  }),
);

/* ---------------- archive ---------------- */

router.get(
  '/runs',
  read,
  work(async (req, res) =>
    res.json({
      runs: await listRunsScoped(req.statementScope, {
        financialYear:
          typeof req.query.financialYear === 'string' ? req.query.financialYear : undefined,
        frequency: typeof req.query.frequency === 'string' ? req.query.frequency : undefined,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
      }),
    }),
  ),
);

router.get(
  '/runs/:id',
  read,
  work(async (req, res) => res.json(await getRunScoped(req.statementScope, Number(req.params.id)))),
);

router.post(
  '/runs/:id/notes',
  prepare,
  validateBody(addStatementNoteBodySchema),
  work(async (req, res) =>
    res
      .status(201)
      .json(
        await addNoteScoped(
          req.statementScope,
          Number(req.params.id),
          getValidatedBody<Record<string, unknown>>(req),
        ),
      ),
  ),
);

router.post(
  '/runs/:id/review',
  review,
  validateBody(reviewFinancialStatementBodySchema),
  work(async (req, res) => {
    const body = getValidatedBody<{ comment?: string | null }>(req);
    res.json(await reviewRunScoped(req.statementScope, Number(req.params.id), body.comment));
  }),
);

router.post(
  '/runs/:id/approve',
  approve,
  validateBody(approveFinancialStatementBodySchema),
  work(async (req, res) => {
    const body = getValidatedBody<{ comment: string }>(req);
    res.json(await approveRunScoped(req.statementScope, Number(req.params.id), body.comment));
  }),
);

router.post(
  '/runs/:id/revise',
  reopen,
  validateBody(reviseFinancialStatementBodySchema),
  work(async (req, res) => {
    const body = getValidatedBody<{ reason: string }>(req);
    res
      .status(201)
      .json(await reviseRunScoped(req.statementScope, Number(req.params.id), body.reason));
  }),
);

/* ---------------- exports ---------------- */

const FORMATS = new Set<ExportFormat>(['pdf', 'xlsx']);
const STATEMENTS = new Set<ExportStatement>([
  'ALL',
  'financialPosition',
  'incomeStatement',
  'cashFlows',
  'changesInEquity',
  'trialBalance',
  'generalLedger',
  'cashbook',
  'receivables',
  'payables',
  'fixedAssets',
]);

router.get(
  '/runs/:id/export',
  exportPermission,
  work(async (req, res) => {
    const format = String(req.query.format ?? 'pdf').toLowerCase() as ExportFormat;
    if (!FORMATS.has(format)) {
      throw new FinancialStatementError(
        'UNSUPPORTED_FORMAT',
        'Choose PDF or Excel. CSV is not offered for a signed statement because it loses the layout a reader relies on.',
      );
    }
    const statement = String(req.query.statement ?? 'ALL') as ExportStatement;
    if (!STATEMENTS.has(statement)) {
      throw new FinancialStatementError('UNSUPPORTED_STATEMENT', 'Choose a statement that exists.');
    }
    res.json(await exportRunScoped(req.statementScope, Number(req.params.id), format, statement));
  }),
);

/* ---------------- period operations ---------------- */

router.post(
  '/year-end-close',
  approve,
  validateBody(closeFinancialYearBodySchema),
  work(async (req, res) => {
    res
      .status(201)
      .json(
        await closeFinancialYearScoped(
          req.statementScope,
          getValidatedBody<Record<string, unknown>>(req),
        ),
      );
  }),
);

router.post(
  '/periods/reopen',
  reopen,
  validateBody(reopenFinancialPeriodBodySchema),
  work(async (req, res) => {
    res.json(
      await reopenPeriodScoped(req.statementScope, getValidatedBody<Record<string, unknown>>(req)),
    );
  }),
);

export default router;
