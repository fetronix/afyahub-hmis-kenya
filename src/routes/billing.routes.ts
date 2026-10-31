/**
 * The billing & cashier routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this router on the API router.
 */

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import * as billing from '../billing/billing.service.ts';
import * as finalized from '../billing/finalized-invoice.service.ts';
import { db } from '../db/index.ts';
import * as queries from '../db/queries.ts';
import * as schema from '../db/schema.ts';
import { handleInpatientError, handleScopeError } from './shared/errors.ts';
import { requireAuthContext } from './shared/request.ts';
import { and, eq } from 'drizzle-orm';
import { Router, type Response } from 'express';
import { voidInvoiceBodySchema } from '../validation/schemas/index.ts';
import { getValidatedBody, validateBody } from '../validation/validate.ts';

const router = Router();

// =========================================================
// BILLING & CASHIER
// =========================================================

router.get(
  '/api/invoices',
  requirePermission('billing.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const rawFacilityId = req.query.facilityId;
      const requestedFacilityId =
        typeof rawFacilityId === 'string' && rawFacilityId.trim()
          ? Number(rawFacilityId)
          : undefined;

      const facilityId = resolveFacilityScope(req.authContext, requestedFacilityId);

      const facility = await queries.getFacilityByIdScoped(req.authContext, facilityId);

      if (!facility) {
        return res.status(404).json({
          success: false,
          error: 'FACILITY_NOT_FOUND',
          message: 'Facility not found.',
        });
      }

      if (!Array.isArray(facility.enabledModules) || !facility.enabledModules.includes('finance')) {
        return res.status(403).json({
          success: false,
          error: 'FACILITY_MODULE_DISABLED',
          module: 'finance',
          message: 'The finance module is disabled for this facility.',
        });
      }

      const rawPatientId = req.query.patientId;
      let patientId: number | undefined;

      if (rawPatientId !== undefined) {
        if (
          typeof rawPatientId !== 'string' ||
          !rawPatientId.trim() ||
          !Number.isInteger(Number(rawPatientId)) ||
          Number(rawPatientId) <= 0
        ) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_PATIENT_ID',
            message: 'Invalid patient ID.',
          });
        }

        patientId = Number(rawPatientId);
      }

      const list = await queries.getInvoices(facilityId, patientId);
      return res.json(list);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;

      console.error('Failed to fetch invoices:', err);
      return res.status(500).json({
        success: false,
        error: 'INVOICE_FETCH_FAILED',
        message: 'Failed to fetch invoices.',
      });
    }
  },
);
router.get(
  '/api/invoices/:id/items',
  requirePermission('billing.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const invoiceId = Number(req.params.id);
      if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_INVOICE_ID',
          message: 'A valid invoice ID is required.',
        });
      }

      const [invoice] = await db
        .select()
        .from(schema.billingInvoices)
        .where(eq(schema.billingInvoices.id, invoiceId))
        .limit(1);

      if (!invoice) {
        return res.status(404).json({
          success: false,
          error: 'INVOICE_NOT_FOUND',
          message: 'Invoice not found.',
        });
      }

      const facility = await queries.getFacilityByIdScoped(req.authContext, invoice.facilityId);

      if (!facility || facility.tenantId !== invoice.tenantId) {
        return res.status(404).json({
          success: false,
          error: 'INVOICE_NOT_FOUND',
          message: 'Invoice not found.',
        });
      }

      if (!Array.isArray(facility.enabledModules) || !facility.enabledModules.includes('finance')) {
        return res.status(403).json({
          success: false,
          error: 'FACILITY_MODULE_DISABLED',
          module: 'finance',
          message: 'The finance module is disabled for this facility.',
        });
      }

      const items = await queries.getInvoiceItems(invoiceId);
      return res.json(items);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;

      console.error('Failed to fetch invoice items:', err);
      return res.status(500).json({
        success: false,
        error: 'INVOICE_ITEMS_FETCH_FAILED',
        message: 'Failed to fetch invoice items.',
      });
    }
  },
);

/**
 * Full invoice: header, line items with their clinical provenance and
 * every payment already recorded.
 */
router.get(
  '/api/invoices/:id',
  requirePermission('billing.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const detail = await queries.getInvoiceDetailScoped(context, Number(req.params.id));

      if (!detail) {
        return res.status(404).json({
          success: false,
          error: 'INVOICE_NOT_FOUND',
        });
      }

      return res.json(detail);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Invoice detail error:', err);
      return res.status(500).json({
        success: false,
        error: 'INVOICE_DETAIL_FETCH_FAILED',
      });
    }
  },
);

/**
 * Finalized statements contain diagnosis information, so billing and clinical
 * read permission are both required. The service commits an access log before
 * returning the statement. No provider request settles an invoice here.
 */
router.get(
  '/api/invoices/:id/finalization',
  requirePermission('billing.read', 'clinical.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json(await finalized.getFinalizedInvoice(context, Number(req.params.id)));
    } catch (error) {
      if (error instanceof finalized.InvoiceFinalizationError) {
        return res.status(error.status).json({
          success: false,
          error: error.code,
          message: error.message,
          detail: { issues: error.issues },
        });
      }
      if (handleScopeError(error, res)) return;
      res.status(500).json({
        success: false,
        error: 'INVOICE_STATEMENT_FAILED',
        message: 'The finalized invoice could not be loaded.',
      });
    }
  },
);
router.post(
  '/api/invoices/:id/finalize',
  requirePermission('billing.read', 'billing.update', 'clinical.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    res.setHeader('Cache-Control', 'no-store');
    try {
      const result = await finalized.finalizeInvoice(
        context,
        Number(req.params.id),
        req.body ?? {},
      );
      res.status(result.idempotentReplay ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof finalized.InvoiceFinalizationError) {
        return res.status(error.status).json({
          success: false,
          error: error.code,
          message: error.message,
          detail: { issues: error.issues },
        });
      }
      if (handleScopeError(error, res)) return;
      res.status(500).json({
        success: false,
        error: 'INVOICE_FINALIZATION_FAILED',
        message: 'The invoice could not be finalized.',
      });
    }
  },
);
router.post(
  '/api/invoices/:id/print-access',
  requirePermission('billing.read', 'clinical.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    res.setHeader('Cache-Control', 'no-store');
    try {
      await finalized.recordInvoicePrintAccess(context, Number(req.params.id));
      res.json({ authorized: true });
    } catch (error) {
      if (error instanceof finalized.InvoiceFinalizationError)
        return res
          .status(error.status)
          .json({ success: false, error: error.code, message: error.message });
      if (handleScopeError(error, res)) return;
      res.status(500).json({
        success: false,
        error: 'INVOICE_PRINT_AUDIT_FAILED',
        message: 'Printing could not be authorized and audited.',
      });
    }
  },
);
router.post(
  '/api/invoices/:id/payments/:paymentId/attribution',
  requirePermission('billing.read', 'billing.payments.record'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);
    if (!context) return;
    res.setHeader('Cache-Control', 'no-store');
    try {
      const result = await finalized.attributeInvoicePayment(
        context,
        Number(req.params.id),
        Number(req.params.paymentId),
        req.body?.party,
        req.body?.reason,
      );
      res.status(result.idempotentReplay ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof finalized.InvoiceFinalizationError) {
        return res
          .status(error.status)
          .json({ success: false, error: error.code, message: error.message });
      }
      if (handleScopeError(error, res)) return;
      res.status(500).json({
        success: false,
        error: 'PAYMENT_ATTRIBUTION_FAILED',
        message: 'The receipt could not be attributed.',
      });
    }
  },
);

/**
 * Void an invoice. Audit-preserving: the row and its lines remain,
 * marked voided, so the record is never destroyed.
 */
router.post(
  '/api/invoices/:id/void',
  requirePermission('billing.update'),
  validateBody(voidInvoiceBodySchema),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    const { reason } = getValidatedBody<{ reason: string }>(req);

    try {
      const invoice = await queries.voidInvoiceScoped(context, Number(req.params.id), reason);

      return res.json(invoice);
    } catch (err: unknown) {
      if (handleInpatientError(err, res)) return;

      console.error('Invoice void error:', err);
      return res.status(500).json({
        success: false,
        error: 'INVOICE_VOID_FAILED',
      });
    }
  },
);

/**
 * The facility a request *asks* for, as a hint only.
 *
 * `resolveFacilityScope` decides whether the caller may have it. A
 * superadmin must name one; a facility user's own scope wins.
 */

export default router;
