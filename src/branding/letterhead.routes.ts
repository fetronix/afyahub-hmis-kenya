/**
 * Facility letterhead HTTP surface.
 *
 *   GET    /api/facility-branding/facilities/:facilityId/letterheads
 *   POST   /api/facility-branding/facilities/:facilityId/letterheads
 *   GET    /api/facility-branding/facilities/:facilityId/letterheads/:letterheadId
 *   GET    /api/facility-branding/facilities/:facilityId/letterheads/:letterheadId/file
 *   PATCH  /api/facility-branding/facilities/:facilityId/letterheads/:letterheadId
 *   POST   /api/facility-branding/facilities/:facilityId/letterheads/:letterheadId/activate
 *   POST   /api/facility-branding/facilities/:facilityId/letterheads/:letterheadId/withdraw
 *
 * WHY THIS ROUTER IS MOUNTED ABOVE `express.json()`
 * -------------------------------------------------
 * The upload carries the PDF itself as the request body. The global JSON parser
 * would consume that stream first and either reject the request or leave an
 * empty body, so the router is mounted before it in `app.ts` and parses its own
 * bodies: `express.raw()` for the PDF, and a small `express.json()` on the one
 * endpoint that takes JSON. `requireAuth` is applied here rather than inherited
 * from the later `/api` mount for the same reason — there is no later mount on
 * this path.
 *
 * WHAT NEVER LEAVES THIS ROUTER
 * -----------------------------
 * The stored bytes, a storage path, or a URL that works without a session. The
 * file endpoint re-checks tenant and facility scope on every request and sends
 * `Cache-Control: private, no-store` so a shared browser does not keep a copy.
 */

import express, { Router } from 'express';
import type { Response } from 'express';

import { requireAuth, type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { ScopeAccessError } from '../auth/scope.service.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { LETTERHEAD_MAX_BYTES, LetterheadError } from './letterhead-pdf.ts';
import {
  activateLetterhead,
  getLetterhead,
  listLetterheads,
  readLetterheadBytes,
  resolveLetterheadVersion,
  updateLetterheadLayout,
  uploadLetterhead,
  withdrawLetterhead,
} from './letterhead.service.ts';
import {
  buildInvoiceDocument,
  buildReceiptDocument,
  DocumentError,
  latestFinalizedInvoiceId,
} from '../documents/document.service.ts';
import { renderDocument } from '../documents/render.ts';

const router = Router();

router.use(requireAuth);

const READ = 'facility.branding.read';
const MANAGE = 'facility.branding.manage';

function contextOf(req: AuthRequest): AuthorizationContext {
  const context = req.authContext;
  if (!context) {
    throw new LetterheadError('LETTERHEAD_FORBIDDEN', 'Authentication is required.', 401);
  }
  return context;
}

function facilityIdOf(req: AuthRequest): number {
  return Number(req.params.facilityId);
}

function letterheadIdOf(req: AuthRequest): number {
  return Number(req.params.letterheadId);
}

function sendError(res: Response, error: unknown): Response {
  if (error instanceof LetterheadError) {
    return res.status(error.status).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }
  if (error instanceof ScopeAccessError) {
    /*
     * A scope failure is answered as 404 by the service for cross-tenant ids.
     * This branch exists for the ids that never reached the service (a missing
     * facility row), so an unauthorized caller cannot tell "not yours" from
     * "does not exist" by the status code.
     */
    return res.status(404).json({
      success: false,
      code: 'LETTERHEAD_NOT_FOUND',
      message: 'Letterhead version not found.',
    });
  }
  console.error('Facility branding API error:', error);
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'The branding request could not be completed.',
  });
}

/** Both the facility in the path and the row's own facility must agree. */
async function loadScoped(
  req: AuthRequest,
  facilityId: number,
  letterheadId: number,
): Promise<Awaited<ReturnType<typeof getLetterhead>>> {
  const view = await getLetterhead(contextOf(req), letterheadId);
  if (view.facilityId !== facilityId) {
    throw new LetterheadError('LETTERHEAD_NOT_FOUND', 'Letterhead version not found.', 404);
  }
  return view;
}

/* ------------------------------------------------------------------ list */

router.get(
  '/facilities/:facilityId/letterheads',
  requirePermission(READ),
  async (req: AuthRequest, res) => {
    try {
      const state = await listLetterheads(contextOf(req), facilityIdOf(req));
      return res.json({ success: true, ...state });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

/* ---------------------------------------------------------------- upload */

router.post(
  '/facilities/:facilityId/letterheads',
  requirePermission(MANAGE),
  express.raw({
    type: 'application/pdf',
    limit: LETTERHEAD_MAX_BYTES,
  }),
  async (req: AuthRequest, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new LetterheadError(
          'LETTERHEAD_EMPTY',
          'Send the letterhead as the raw request body with Content-Type: application/pdf.',
          400,
        );
      }

      /*
       * The filename is metadata for the event log, not a path. It is taken
       * from the query string (a header would be dropped by some proxies) and
       * reduced to its base name so nothing can traverse anywhere.
       */
      const raw = typeof req.query.filename === 'string' ? req.query.filename : 'letterhead.pdf';
      const filename = raw.split(/[\\/]/).pop()?.trim() || 'letterhead.pdf';

      const layout = parseLayoutBody(req.query);

      const result = await uploadLetterhead(contextOf(req), {
        facilityId: facilityIdOf(req),
        filename,
        mimeType: String(req.headers['content-type'] ?? ''),
        bytes: req.body,
        body: layout ?? undefined,
      });

      return res.status(201).json({
        success: true,
        letterhead: result.letterhead,
        measurement: result.measurement,
      });
    } catch (error) {
      if (isTooLarge(error)) {
        return res.status(413).json({
          success: false,
          code: 'LETTERHEAD_TOO_LARGE',
          message: `The letterhead is larger than ${Math.floor(LETTERHEAD_MAX_BYTES / (1024 * 1024))} MB.`,
        });
      }
      return sendError(res, error);
    }
  },
);

function isTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { type?: string }).type === 'entity.too.large'
  );
}

/** Accept only the four integers the layout correction needs. */
function parseLayoutBody(query: AuthRequest['query']): {
  bodyTopPt?: number;
  bodyBottomPt?: number;
  bodyLeftPt?: number;
  bodyRightPt?: number;
} | null {
  const pick = (key: string): number | undefined => {
    const value = query[key];
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new LetterheadError(
        'LETTERHEAD_LAYOUT_INVALID',
        `${key} must be a non-negative number of points.`,
        400,
      );
    }
    return parsed;
  };
  const result = {
    bodyTopPt: pick('bodyTopPt'),
    bodyBottomPt: pick('bodyBottomPt'),
    bodyLeftPt: pick('bodyLeftPt'),
    bodyRightPt: pick('bodyRightPt'),
  };
  return Object.values(result).some((value) => value !== undefined) ? result : null;
}

/* ------------------------------------------------------------------ read */

router.get(
  '/facilities/:facilityId/letterheads/:letterheadId',
  requirePermission(READ),
  async (req: AuthRequest, res) => {
    try {
      const view = await loadScoped(req, facilityIdOf(req), letterheadIdOf(req));
      return res.json({ success: true, letterhead: view });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

/**
 * The stored PDF, for preview and for download.
 *
 * `?download=1` asks the browser to save it rather than display it; the preview
 * uses the default. The response is never cacheable: it is tenant data behind a
 * session, and a shared workstation must not keep a copy after sign-out.
 */
router.get(
  '/facilities/:facilityId/letterheads/:letterheadId/file',
  requirePermission(READ),
  async (req: AuthRequest, res) => {
    try {
      const view = await loadScoped(req, facilityIdOf(req), letterheadIdOf(req));
      const file = await readLetterheadBytes(contextOf(req), view.id);
      const disposition = req.query.download === '1' ? 'attachment' : 'inline';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(file.bytes.length));
      res.setHeader('Content-Disposition', `${disposition}; filename="${file.filename}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).end(file.bytes);
    } catch (error) {
      return sendError(res, error);
    }
  },
);

/**
 * Preview an ACTUAL document on a candidate letterhead, before activation.
 *
 * Showing the letterhead PDF on its own answers "what does the paper look
 * like". It does not answer the question that decides whether to activate:
 * "does my invoice still fit, and does the content clear the artwork". This
 * endpoint renders a real, already-finalized invoice (or receipt) of the same
 * facility through the same renderer the live document endpoints use, so the
 * administrator sees exactly what will be issued.
 *
 * The newest finalized invoice is chosen automatically; `?invoiceId=` names a
 * different one. Nothing is written: the version stays whatever it was, which
 * is why a draft can be previewed at all.
 */
router.get(
  '/facilities/:facilityId/letterheads/:letterheadId/preview-document',
  requirePermission(READ),
  async (req: AuthRequest, res) => {
    try {
      const view = await loadScoped(req, facilityIdOf(req), letterheadIdOf(req));
      const context = contextOf(req);
      const candidate = await resolveLetterheadVersion(
        view.facilityId === facilityIdOf(req) ? (context.tenantId ?? 0) : -1,
        view.facilityId,
        view.id,
      );
      if (!candidate || !candidate.bytes) {
        throw new LetterheadError(
          'LETTERHEAD_NOT_A_DOCUMENT',
          'This version has no uploaded page to preview.',
          409,
        );
      }

      const kind = typeof req.query.document === 'string' ? req.query.document : 'invoice';
      /*
       * The invoice builder is the most demanding layout (line items, totals,
       * multi-page continuation), so it is the honest sample. With no id given
       * the newest finalized invoice is used, so the button always works
       * without the administrator having to know an invoice number.
       */
      let built;
      if (kind === 'receipt') {
        built = await buildReceiptDocument(context, Number(req.query.paymentId));
      } else {
        const requested = req.query.invoiceId ? Number(req.query.invoiceId) : NaN;
        const invoiceId =
          Number.isSafeInteger(requested) && requested > 0
            ? requested
            : await latestFinalizedInvoiceId(
                context.tenantId ?? view.facilityId,
                facilityIdOf(req),
              );
        if (!invoiceId) {
          throw new DocumentError(
            'DOCUMENT_NOT_PRINTABLE',
            'Finalize an invoice at this facility first, then preview the letterhead on it.',
            409,
          );
        }
        built = await buildInvoiceDocument(context, invoiceId);
      }

      const rendered = await renderDocument(built.model, {
        bytes: candidate.bytes,
        bodyTopPt: candidate.bodyTopPt,
        bodyBottomPt: candidate.bodyBottomPt,
        bodyLeftPt: candidate.bodyLeftPt,
        bodyRightPt: candidate.bodyRightPt,
        pageWidthPt: candidate.pageWidthPt,
        pageHeightPt: candidate.pageHeightPt,
        label: `${candidate.label} (preview)`,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(rendered.bytes.length));
      res.setHeader('Content-Disposition', 'inline; filename="letterhead-preview.pdf"');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Document-Pages', String(rendered.pages));
      res.setHeader('X-Letterhead-Applied', rendered.letterheadApplied ? 'true' : 'false');
      return res.status(200).end(rendered.bytes);
    } catch (error) {
      if (error instanceof DocumentError) {
        return res.status(error.status).json({
          success: false,
          code: error.code,
          message:
            error.code === 'DOCUMENT_NOT_PRINTABLE'
              ? 'Finalize an invoice at this facility first, then preview the letterhead on it.'
              : error.message,
        });
      }
      return sendError(res, error);
    }
  },
);

/* ---------------------------------------------------------------- layout */

router.patch(
  '/facilities/:facilityId/letterheads/:letterheadId',
  requirePermission(MANAGE),
  express.json({ limit: '16kb' }),
  async (req: AuthRequest, res) => {
    try {
      const view = await loadScoped(req, facilityIdOf(req), letterheadIdOf(req));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: Record<string, number> = {};
      for (const key of ['bodyTopPt', 'bodyBottomPt', 'bodyLeftPt', 'bodyRightPt']) {
        const value = body[key];
        if (value === undefined) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          throw new LetterheadError(
            'LETTERHEAD_LAYOUT_INVALID',
            `${key} must be a non-negative number of points.`,
            400,
          );
        }
        patch[key] = value;
      }
      const updated = await updateLetterheadLayout(contextOf(req), view.id, patch);
      return res.json({ success: true, letterhead: updated });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

/* ------------------------------------------------------------- lifecycle */

router.post(
  '/facilities/:facilityId/letterheads/:letterheadId/activate',
  requirePermission(MANAGE),
  express.json({ limit: '16kb' }),
  async (req: AuthRequest, res) => {
    try {
      const view = await loadScoped(req, facilityIdOf(req), letterheadIdOf(req));
      const reason = typeof req.body?.reason === 'string' ? (req.body.reason as string) : undefined;
      const activated = await activateLetterhead(contextOf(req), view.id, reason);
      return res.json({ success: true, letterhead: activated });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

router.post(
  '/facilities/:facilityId/letterheads/:letterheadId/withdraw',
  requirePermission(MANAGE),
  express.json({ limit: '16kb' }),
  async (req: AuthRequest, res) => {
    try {
      const view = await loadScoped(req, facilityIdOf(req), letterheadIdOf(req));
      const reason = typeof req.body?.reason === 'string' ? (req.body.reason as string) : '';
      const withdrawn = await withdrawLetterhead(contextOf(req), view.id, reason);
      return res.json({ success: true, letterhead: withdrawn });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

export default router;
