import { Router, type Response } from 'express';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { ScopeAccessError, resolveFacilityScope } from '../auth/scope.service.ts';
import * as queries from '../db/queries.ts';
import {
  closeFinancialPeriodBodySchema,
  createAccountBodySchema,
  createBankAccountBodySchema,
  createFinancialPeriodBodySchema,
  createExpenseRequestBodySchema,
  decideExpenseRequestBodySchema,
  facilityActionBodySchema,
  postJournalBodySchema,
  reverseJournalBodySchema,
} from '../validation/schemas/index.ts';
import { validateBody } from '../validation/validate.ts';
import {
  AccountingIntegrityError,
  closeFinancialPeriodScoped,
  createAccountScoped,
  createExpenseRequestScoped,
  decideExpenseRequestScoped,
  listExpensesScoped,
  postApprovedExpenseScoped,
  createFinancialPeriodScoped,
  getAccountingOverviewScoped,
  postJournalScoped,
  recordAccountingExport,
  reverseJournalScoped,
  type AccountingScope,
} from '../accounting/accounting.service.ts';
import {
  BankStatementError,
  createBankAccountScoped,
  importStatementScoped,
  listBankWorkspaceScoped,
  matchBankTransactionScoped,
  previewBankReconciliationScoped,
  saveBankReconciliationScoped,
} from '../accounting/bank-integration.service.ts';

import { inspectBillingConsistencyScoped } from '../accounting/billing-diagnostics.service.ts';
import { inspectBillingLedgerScoped } from '../accounting/billing-ledger-diagnostics.service.ts';

const router = Router();

async function scoped(req: AuthRequest): Promise<AccountingScope> {
  if (!req.authContext) throw new ScopeAccessError('Authorization context required.');
  const bodyId = req.body?.facilityId;
  const queryId = req.query.facilityId;
  const raw = bodyId ?? queryId;
  const id = raw === undefined || raw === null || raw === '' ? undefined : Number(raw);
  if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) {
    throw new AccountingIntegrityError(
      'INVALID_FACILITY_ID',
      'facilityId must be a positive integer.',
    );
  }
  if (bodyId != null && queryId != null && Number(bodyId) !== Number(queryId)) {
    throw new AccountingIntegrityError(
      'FACILITY_SCOPE_MISMATCH',
      'Facility identifiers do not match.',
      403,
    );
  }
  const facilityId = resolveFacilityScope(req.authContext, id);
  const facility = await queries.getFacilityByIdScoped(req.authContext, facilityId);
  if (!facility)
    throw new AccountingIntegrityError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
  return {
    tenantId: facility.tenantId,
    facilityId: facility.id,
    actorUserId: req.authContext.userId,
  };
}

function fail(res: Response, error: unknown) {
  if (error instanceof AccountingIntegrityError || error instanceof BankStatementError) {
    res.status(error.status).json({ success: false, error: error.code, message: error.message });
    return;
  }
  if (error instanceof ScopeAccessError) {
    res.status(403).json({ success: false, error: error.code, message: 'Facility access denied.' });
    return;
  }
  // Do not return or log database errors, SQL parameters or patient data.
  res.status(500).json({
    success: false,
    error: 'ACCOUNTING_OPERATION_FAILED',
    message: 'Accounting operation failed.',
  });
}

router.get(
  '/billing-consistency',
  requirePermission('accounting.read'),
  requirePermission('billing.read'),
  async (req: AuthRequest, res) => {
    try {
      const report = await inspectBillingConsistencyScoped(await scoped(req), {
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        afterId: req.query.afterId,
        limit: req.query.limit,
      });
      res.json({ success: true, ...report });
    } catch (error) {
      fail(res, error);
    }
  },
);

router.get(
  '/billing-ledger-review',
  requirePermission('accounting.read'),
  requirePermission('billing.read'),
  async (req: AuthRequest, res) => {
    try {
      const report = await inspectBillingLedgerScoped(await scoped(req), {
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        afterId: req.query.afterId,
        limit: req.query.limit,
      });
      res.json({ success: true, ...report });
    } catch (error) {
      fail(res, error);
    }
  },
);

router.get('/overview', requirePermission('accounting.read'), async (req: AuthRequest, res) => {
  try {
    const scope = await scoped(req);
    const data = await getAccountingOverviewScoped(scope, req.query.startDate, req.query.endDate);
    res.json({ success: true, ...data });
  } catch (error) {
    fail(res, error);
  }
});

router.post(
  '/accounts',
  requirePermission('accounting.coa.manage'),
  validateBody(createAccountBodySchema),
  async (req: AuthRequest, res) => {
    try {
      res.status(201).json({
        success: true,
        account: await createAccountScoped(await scoped(req), req.body ?? {}),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);

router.post(
  '/periods',
  requirePermission('accounting.coa.manage'),
  validateBody(createFinancialPeriodBodySchema),
  async (req: AuthRequest, res) => {
    try {
      res.status(201).json({
        success: true,
        period: await createFinancialPeriodScoped(await scoped(req), req.body ?? {}),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);

router.post(
  '/periods/:id/close',
  requirePermission('accounting.periods.close'),
  validateBody(closeFinancialPeriodBodySchema),
  async (req: AuthRequest, res) => {
    try {
      res.json({
        success: true,
        period: await closeFinancialPeriodScoped(
          await scoped(req),
          Number(req.params.id),
          req.body?.notes,
        ),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);

router.post(
  '/journals',
  requirePermission('accounting.journals.post'),
  validateBody(postJournalBodySchema),
  async (req: AuthRequest, res) => {
    try {
      const result = await postJournalScoped(await scoped(req), {
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
  '/journals/:id/reverse',
  requirePermission('accounting.journals.post'),
  validateBody(reverseJournalBodySchema),
  async (req: AuthRequest, res) => {
    try {
      const result = await reverseJournalScoped(await scoped(req), Number(req.params.id), {
        ...req.body,
        idempotencyKey: req.get('Idempotency-Key') ?? req.body?.idempotencyKey,
      });
      res.status(result.idempotentReplay ? 200 : 201).json({ success: true, ...result });
    } catch (error) {
      fail(res, error);
    }
  },
);

function csvCell(value: string): string {
  // Spreadsheet formula injection is possible even in an otherwise valid CSV.
  const safe = /^[\s]*[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

router.get(
  '/trial-balance.csv',
  requirePermission('accounting.reports.export'),
  async (req: AuthRequest, res) => {
    try {
      const scope = await scoped(req);
      const data = await getAccountingOverviewScoped(scope, req.query.startDate, req.query.endDate);
      await recordAccountingExport(scope, data.filters);
      const rows = [
        ['Account code', 'Account name', 'Type', 'Debits KES', 'Credits KES'],
        ...data.accounts.map((a) => [
          a.accountCode,
          a.accountName,
          a.accountType,
          a.debitKes,
          a.creditKes,
        ]),
        ['TOTAL', '', '', data.trialBalance.debitKes, data.trialBalance.creditKes],
      ];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="trial-balance.csv"');
      res.send(rows.map((row) => row.map(csvCell).join(',')).join('\r\n'));
    } catch (error) {
      fail(res, error);
    }
  },
);

router.get('/expenses', requirePermission('accounting.read'), async (req: AuthRequest, res) => {
  try {
    res.json({ success: true, ...(await listExpensesScoped(await scoped(req))) });
  } catch (error) {
    fail(res, error);
  }
});
router.post(
  '/expenses',
  requirePermission('accounting.expenses.request'),
  validateBody(createExpenseRequestBodySchema),
  async (req: AuthRequest, res) => {
    try {
      const result = await createExpenseRequestScoped(await scoped(req), {
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
  '/expenses/:id/decision',
  requirePermission('accounting.expenses.approve'),
  validateBody(decideExpenseRequestBodySchema),
  async (req: AuthRequest, res) => {
    try {
      res.json({
        success: true,
        ...(await decideExpenseRequestScoped(
          await scoped(req),
          Number(req.params.id),
          req.body ?? {},
        )),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/expenses/:id/post',
  requirePermission('accounting.journals.post'),
  validateBody(facilityActionBodySchema),
  async (req: AuthRequest, res) => {
    try {
      const result = await postApprovedExpenseScoped(await scoped(req), Number(req.params.id));
      res.status(result.idempotentReplay ? 200 : 201).json({ success: true, ...result });
    } catch (error) {
      fail(res, error);
    }
  },
);

router.get('/bank', requirePermission('accounting.read'), async (req: AuthRequest, res) => {
  try {
    res.json({ success: true, ...(await listBankWorkspaceScoped(await scoped(req))) });
  } catch (error) {
    fail(res, error);
  }
});
router.post(
  '/bank/accounts',
  requirePermission('accounting.bank.manage'),
  validateBody(createBankAccountBodySchema),
  async (req: AuthRequest, res) => {
    try {
      res.status(201).json({
        success: true,
        account: await createBankAccountScoped(await scoped(req), req.body ?? {}),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/bank/accounts/:id/statements',
  requirePermission('accounting.bank.manage'),
  async (req: AuthRequest, res) => {
    try {
      const result = await importStatementScoped(
        await scoped(req),
        Number(req.params.id),
        req.body ?? {},
      );
      res.status(result.idempotentReplay ? 200 : 201).json({ success: true, ...result });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/bank/transactions/:id/match',
  requirePermission('accounting.bank.manage'),
  async (req: AuthRequest, res) => {
    try {
      res.json({
        success: true,
        ...(await matchBankTransactionScoped(
          await scoped(req),
          Number(req.params.id),
          Number(req.body?.journalLineId),
        )),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.get(
  '/bank/accounts/:id/statements/:statementId/reconciliation',
  requirePermission('accounting.read'),
  async (req: AuthRequest, res) => {
    try {
      res.json({
        success: true,
        worksheet: await previewBankReconciliationScoped(
          await scoped(req),
          Number(req.params.id),
          Number(req.params.statementId),
        ),
      });
    } catch (error) {
      fail(res, error);
    }
  },
);
router.post(
  '/bank/accounts/:id/statements/:statementId/reconciliation',
  requirePermission('accounting.bank.manage'),
  async (req: AuthRequest, res) => {
    try {
      const result = await saveBankReconciliationScoped(
        await scoped(req),
        Number(req.params.id),
        Number(req.params.statementId),
        { ...req.body, idempotencyKey: req.get('Idempotency-Key') ?? req.body?.idempotencyKey },
      );
      res.status(result.idempotentReplay ? 200 : 201).json({ success: true, ...result });
    } catch (error) {
      fail(res, error);
    }
  },
);

export default router;
