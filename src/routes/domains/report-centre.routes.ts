import { Router, type Response } from 'express';
import type { AuthRequest } from '../../auth/auth.middleware.ts';
import { requirePermission } from '../../auth/authorization.middleware.ts';
import { requireAuthContext } from '../shared/request.ts';
import { handleScopeError, respondInternalError } from '../shared/errors.ts';
import { exportReport } from '../../reporting/report-centre.export.ts';
import { generateReport, ReportCentreError } from '../../reporting/report-centre.service.ts';

const router = Router();
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

function handleError(error: unknown, res: Response) {
  if (handleScopeError(error, res)) return;
  if (error instanceof ReportCentreError) {
    res.status(error.status).json({ success: false, error: error.code, message: error.message });
    return;
  }
  respondInternalError(res, error, 'report centre');
}

router.post(
  '/:reportId/generate',
  requirePermission('reports.read'),
  async (req: AuthRequest, res) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      const { intent, ...filters } = req.body ?? {};
      if (intent !== undefined && intent !== 'view' && intent !== 'print') {
        throw new ReportCentreError('INVALID_REPORT_INTENT', 'Invalid report request.');
      }
      const report = await generateReport(
        context,
        req.params.reportId,
        filters,
        intent === 'print' ? 'PRINT_REQUEST' : 'VIEW',
      );
      return res.json(report);
    } catch (error) {
      handleError(error, res);
    }
  },
);

router.post(
  '/:reportId/export',
  requirePermission('reports.read'),
  async (req: AuthRequest, res) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    try {
      const { format, ...filters } = req.body ?? {};
      if (format !== 'pdf' && format !== 'xlsx') {
        throw new ReportCentreError('INVALID_REPORT_FORMAT', 'Select PDF or Excel.');
      }
      const report = await generateReport(context, req.params.reportId, filters, 'EXPORT_REQUEST');
      return res.json(await exportReport(report, format));
    } catch (error) {
      handleError(error, res);
    }
  },
);

export default router;
