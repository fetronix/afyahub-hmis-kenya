/**
 * Document printing endpoints.
 *
 *   GET /api/documents/invoices/:invoiceId/pdf
 *   GET /api/documents/receipts/:paymentId/pdf[?thermal=1]
 *   GET /api/documents/credit-notes/:refundId/pdf
 *   GET /api/documents/purchase-orders/:purchaseOrderId/pdf
 *   GET /api/documents/goods-received-notes/:grnId/pdf
 *   GET /api/documents/laboratory-orders/:orderId/pdf
 *   GET /api/documents/radiology-orders/:orderId/pdf
 *   GET /api/documents/admissions/:admissionId/discharge-summary.pdf
 *
 * Each route is a thin wrapper: the service decides what may be printed and
 * from which rows, the renderer decides how it looks. Nothing here reads a
 * request field other than an id and the two display flags, so a client cannot
 * influence a figure, a name or a date.
 *
 * The same bytes serve the on-screen preview and the download; `?download=1`
 * only changes the content disposition. "Printable" and "downloadable" cannot
 * drift apart because they are the same document.
 */

import { Router } from 'express';
import type { Response } from 'express';

import { requireAuth, type AuthRequest } from '../auth/auth.middleware.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { renderDocument } from './render.ts';
import {
  buildCreditNoteDocument,
  buildDischargeSummaryDocument,
  buildGoodsReceivedNoteDocument,
  buildInvoiceDocument,
  buildLaboratoryReportDocument,
  buildPurchaseOrderDocument,
  buildRadiologyReportDocument,
  buildReceiptDocument,
  DocumentError,
  type BuiltDocument,
} from './document.service.ts';

const router = Router();

router.use(requireAuth);

function contextOf(req: AuthRequest): AuthorizationContext {
  if (!req.authContext) {
    throw new DocumentError('DOCUMENT_FORBIDDEN', 'Authentication is required.', 401);
  }
  return req.authContext;
}

function sendError(res: Response, error: unknown): Response {
  if (error instanceof DocumentError) {
    return res.status(error.status).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }
  console.error('Document generation error:', error);
  return res.status(500).json({
    success: false,
    code: 'DOCUMENT_RENDER_FAILED',
    message: 'The document could not be generated.',
  });
}

/**
 * Render and return the PDF.
 *
 * `X-Document-Pages` and `X-Letterhead-Applied` are returned so the client can
 * state "3 pages, on your letterhead" without downloading and parsing the
 * file, and so a test can assert the letterhead path was taken without
 * inspecting PDF internals.
 */
async function sendDocument(
  req: AuthRequest,
  res: Response,
  build: () => Promise<BuiltDocument>,
): Promise<Response> {
  try {
    const built = await build();
    const rendered = await renderDocument(built.model, built.letterhead);
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(rendered.bytes.length));
    res.setHeader('Content-Disposition', `${disposition}; filename="${built.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Document-Pages', String(rendered.pages));
    res.setHeader('X-Letterhead-Applied', rendered.letterheadApplied ? 'true' : 'false');
    if (built.model.brandingNote) {
      res.setHeader('X-Letterhead-Version', built.model.brandingNote);
    }
    return res.status(200).end(rendered.bytes);
  } catch (error) {
    return sendError(res, error);
  }
}

router.get('/invoices/:invoiceId/pdf', async (req: AuthRequest, res) =>
  sendDocument(req, res, () => buildInvoiceDocument(contextOf(req), Number(req.params.invoiceId))),
);

router.get('/receipts/:paymentId/pdf', async (req: AuthRequest, res) =>
  sendDocument(req, res, () =>
    buildReceiptDocument(contextOf(req), Number(req.params.paymentId), {
      thermal: req.query.thermal === '1',
    }),
  ),
);

router.get('/credit-notes/:refundId/pdf', async (req: AuthRequest, res) =>
  sendDocument(req, res, () =>
    buildCreditNoteDocument(contextOf(req), Number(req.params.refundId)),
  ),
);

router.get('/purchase-orders/:purchaseOrderId/pdf', async (req: AuthRequest, res) =>
  sendDocument(req, res, () =>
    buildPurchaseOrderDocument(contextOf(req), Number(req.params.purchaseOrderId)),
  ),
);

router.get('/goods-received-notes/:grnId/pdf', async (req: AuthRequest, res) =>
  sendDocument(req, res, () =>
    buildGoodsReceivedNoteDocument(contextOf(req), Number(req.params.grnId)),
  ),
);

router.get('/laboratory-orders/:orderId/pdf', async (req: AuthRequest, res) =>
  sendDocument(req, res, () =>
    buildLaboratoryReportDocument(contextOf(req), Number(req.params.orderId)),
  ),
);

router.get('/radiology-orders/:orderId/pdf', async (req: AuthRequest, res) =>
  sendDocument(req, res, () =>
    buildRadiologyReportDocument(contextOf(req), Number(req.params.orderId)),
  ),
);

router.get('/admissions/:admissionId/discharge-summary.pdf', async (req: AuthRequest, res) =>
  sendDocument(req, res, () =>
    buildDischargeSummaryDocument(contextOf(req), Number(req.params.admissionId)),
  ),
);

export default router;
