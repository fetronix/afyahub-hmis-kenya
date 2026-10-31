/**
 * Invoices and payments.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions, same order. `src/routes/index.ts` mounts this router after the
 * facility-module gates, which is exactly where these routes sat when they
 * were registered inline in `app.ts`.
 */

import { Router, type Response } from 'express';
import type { AuthRequest } from '../../auth/auth.middleware.ts';
import { and, count, eq, sql, sum } from 'drizzle-orm';
import * as billing from '../../billing/billing.service.ts';
import * as billingPayments from '../../billing/payments.service.ts';
import { checkRefundStatus, recordManualRefund } from '../../billing/refunds.service.ts';
import { db } from '../../db/index.ts';
import {
  facilityHasTariffModule,
  requireFacilityAdminTariffRole,
  resolveTariffFacility,
  sendTariffWriteError,
  tariffModuleForDepartment,
  validateTariffInput,
} from '../../routes/shared/tariffs.ts';
import {
  handleClaimError,
  handleDhaError,
  handleEncounterValidationError,
  handleInpatientError,
  handleInventoryError,
  handlePaymentError,
  handleScopeError,
  respondInternalError,
} from '../../routes/shared/errors.ts';
import * as queries from '../../db/queries.ts';
import {
  requireAuthorization,
  requirePermission,
  requireAnyPermission,
  requireSuperAdmin,
} from '../../auth/authorization.middleware.ts';
import { ScopeAccessError, resolveFacilityScope } from '../../auth/scope.service.ts';
import * as schema from '../../db/schema.ts';
import { calendarDateInZone, validTimezone } from '../../dashboard/timezone.ts';
import { masterDepartmentMatches } from '../../billing/master-charge-resolver.ts';
import {
  dateVerdict,
  unitVerdict,
  type CatalogueServiceType,
} from '../../billing/tariff-resolver.ts';
import {
  createInvoiceBodySchema,
  paymentLedgerQuerySchema,
  recordPaymentBodySchema,
  refundBodySchema,
  refundStatusBodySchema,
} from '../../validation/schemas/index.ts';
import { validateBody, validateQuery } from '../../validation/validate.ts';

const router = Router();

router.post(
  '/api/invoices',
  requirePermission('billing.create'),
  validateBody(createInvoiceBodySchema, { code: 'INVALID_INVOICE' }),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const body = req.body;
      const invoiceInput = body?.invoice;
      const itemsInput = body?.items;

      if (!invoiceInput || typeof invoiceInput !== 'object' || Array.isArray(invoiceInput)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_INVOICE',
          message: 'Invoice details are required.',
        });
      }

      const facilityIdInput = Number(invoiceInput.facilityId);
      if (!Number.isSafeInteger(facilityIdInput) || facilityIdInput <= 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_FACILITY_ID',
          message: 'A valid facility ID is required.',
        });
      }

      const facilityId = resolveFacilityScope(req.authContext, facilityIdInput);
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

      const patientId = Number(invoiceInput.patientId);
      if (!Number.isSafeInteger(patientId) || patientId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_PATIENT_ID',
          message: 'A valid patient ID is required.',
        });
      }

      const patient = await queries.getPatientByIdScoped(req.authContext, patientId);

      if (!patient || patient.tenantId !== facility.tenantId) {
        return res.status(400).json({
          success: false,
          error: 'PATIENT_NOT_AVAILABLE',
          message: 'The patient is not available in this tenant scope.',
        });
      }

      const invoiceNumber =
        typeof invoiceInput.invoiceNumber === 'string' ? invoiceInput.invoiceNumber.trim() : '';

      if (!invoiceNumber || invoiceNumber.length > 100) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_INVOICE_NUMBER',
          message: 'A valid invoice number is required.',
        });
      }

      if (!Array.isArray(itemsInput) || itemsInput.length === 0 || itemsInput.length > 200) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_INVOICE_ITEMS',
          message: 'Provide between 1 and 200 invoice items.',
        });
      }

      let totalCents = 0;
      const safeItems: Array<{
        itemType: string;
        description: string;
        quantity: number;
        unitPrice: string;
        totalAmount: string;
        tariffId?: number | null;
        tariffCode?: string | null;
        masterServiceId?: number | null;
        serviceCode?: string | null;
        serviceDepartment?: string | null;
        serviceUnit?: string | null;
      }> = [];

      for (const item of itemsInput) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_INVOICE_ITEM',
            message: 'An invoice item is invalid.',
          });
        }

        const quantity = Number(item.quantity);

        if (!Number.isSafeInteger(quantity) || quantity <= 0) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_INVOICE_ITEM',
            message: 'Invoice item quantity must be a positive whole number.',
          });
        }

        // When a tariff is selected, the database is authoritative
        // for its code, description, department and unit fee.
        if (item.tariffId !== undefined && item.tariffId !== null) {
          const tariffId = item.tariffId;

          if (typeof tariffId !== 'number' || !Number.isSafeInteger(tariffId) || tariffId <= 0) {
            return res.status(400).json({
              success: false,
              error: 'INVALID_TARIFF_ID',
              message: 'A valid service tariff must be selected.',
            });
          }

          const [mapped] = await db
            .select({
              tariff: schema.facilityServiceTariffs,
              master: schema.masterServices,
              timezone: schema.facilities.timezone,
              tenantTimezone: schema.tenants.timezone,
            })
            .from(schema.facilityServiceTariffs)
            .innerJoin(
              schema.masterServices,
              eq(schema.masterServices.id, schema.facilityServiceTariffs.masterServiceId),
            )
            .innerJoin(
              schema.facilities,
              eq(schema.facilities.id, schema.facilityServiceTariffs.facilityId),
            )
            .innerJoin(
              schema.tenants,
              eq(schema.tenants.id, schema.facilityServiceTariffs.tenantId),
            )
            .where(
              and(
                eq(schema.facilityServiceTariffs.id, tariffId),
                eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
                eq(schema.facilityServiceTariffs.facilityId, facility.id),
              ),
            )
            .limit(1);
          const tariff = mapped?.tariff,
            master = mapped?.master;
          const zone = mapped?.timezone ?? mapped?.tenantTimezone;
          const family = (
            master?.billingFamily === 'LABORATORY' ? 'LAB_TEST' : master?.billingFamily
          ) as CatalogueServiceType;
          if (
            !mapped ||
            !tariff ||
            !master ||
            !validTimezone(zone) ||
            !master.isActive ||
            !tariff.isActive ||
            !masterDepartmentMatches(tariff.department, master.department) ||
            tariff.approvalStatus !== 'APPROVED' ||
            !tariff.approvedByUserId ||
            !tariff.approvedAt ||
            !tariff.approvalReference ||
            Number(tariff.fee) <= 0 ||
            dateVerdict(tariff.effectiveFrom, tariff.effectiveTo, calendarDateInZone(zone)) !==
              'OK' ||
            tariff.unit.trim().toLowerCase() !== master.unit.trim().toLowerCase() ||
            unitVerdict(family, tariff.unit) !== 'OK'
          ) {
            return res.status(400).json({
              success: false,
              error: 'INVALID_OR_INACTIVE_TARIFF',
              message:
                'The selected tariff must be mapped, active, approved, positive and effective with a compatible master unit.',
            });
          }

          const tariffModule = tariffModuleForDepartment(tariff.department);

          if (!tariffModule || !facilityHasTariffModule(facility, tariffModule)) {
            return res.status(400).json({
              success: false,
              error: 'TARIFF_MODULE_DISABLED',
              message: 'The tariff department is not enabled for this facility.',
            });
          }

          const tariffFee = String(tariff.fee);

          if (!/^\d{1,8}(\.\d{1,2})?$/.test(tariffFee)) {
            console.error('Invalid stored tariff fee:', tariff.id);

            return res.status(500).json({
              success: false,
              error: 'INVALID_STORED_TARIFF',
              message: 'The saved tariff fee is invalid. Contact an administrator.',
            });
          }

          const unitCents = Math.round(Number(tariffFee) * 100);
          const lineCents = unitCents * quantity;

          if (
            !Number.isSafeInteger(unitCents) ||
            !Number.isSafeInteger(lineCents) ||
            !Number.isSafeInteger(totalCents + lineCents)
          ) {
            return res.status(400).json({
              success: false,
              error: 'INVOICE_AMOUNT_TOO_LARGE',
              message: 'The invoice amount exceeds the supported limit.',
            });
          }

          totalCents += lineCents;

          safeItems.push({
            itemType: tariff.department,
            description: master.description,
            quantity,
            unitPrice: (unitCents / 100).toFixed(2),
            totalAmount: (lineCents / 100).toFixed(2),
            tariffId: tariff.id,
            tariffCode: tariff.code,
            masterServiceId: master.id,
            serviceCode: master.code,
            serviceDepartment: master.department,
            serviceUnit: tariff.unit,
          });

          continue;
        }

        // Legacy invoice items remain supported when tariffId is omitted.
        const itemType = typeof item.itemType === 'string' ? item.itemType.trim() : '';
        const description = typeof item.description === 'string' ? item.description.trim() : '';
        const unitPrice = Number(item.unitPrice);

        if (
          !itemType ||
          itemType.length > 100 ||
          !description ||
          description.length > 500 ||
          !Number.isFinite(unitPrice) ||
          unitPrice <= 0 ||
          !/^\d+(\.\d{1,2})?$/.test(String(item.unitPrice))
        ) {
          return res.status(400).json({
            success: false,
            error: 'INVALID_INVOICE_ITEM',
            message: 'Invoice item descriptions, quantities, and prices must be valid.',
          });
        }

        const unitCents = Math.round(unitPrice * 100);
        const lineCents = unitCents * quantity;

        if (!Number.isSafeInteger(lineCents) || !Number.isSafeInteger(totalCents + lineCents)) {
          return res.status(400).json({
            success: false,
            error: 'INVOICE_AMOUNT_TOO_LARGE',
            message: 'The invoice amount exceeds the supported limit.',
          });
        }

        totalCents += lineCents;

        safeItems.push({
          itemType,
          description,
          quantity,
          unitPrice: (unitCents / 100).toFixed(2),
          totalAmount: (lineCents / 100).toFixed(2),
        });
      }
      const totalAmount = (totalCents / 100).toFixed(2);

      const created = await queries.createInvoice(
        {
          tenantId: facility.tenantId,
          facilityId,
          patientId,
          invoiceNumber,
          totalAmount,
          paidAmount: '0.00',
          balanceAmount: totalAmount,
          status: 'Pending',
          payerType:
            typeof invoiceInput.payerType === 'string'
              ? invoiceInput.payerType.slice(0, 50)
              : 'Self-Pay',
          payerName:
            typeof invoiceInput.payerName === 'string'
              ? invoiceInput.payerName.slice(0, 200)
              : null,
          memberNumber:
            typeof invoiceInput.memberNumber === 'string'
              ? invoiceInput.memberNumber.slice(0, 100)
              : null,
        },
        safeItems,
      );

      return res.status(201).json(created);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;

      console.error('Failed to create invoice:', err);
      return res.status(500).json({
        success: false,
        error: 'INVOICE_CREATE_FAILED',
        message: 'Failed to create invoice.',
      });
    }
  },
);

router.post(
  '/api/billing/payments',
  requirePermission('billing.payments.record'),
  validateBody(recordPaymentBodySchema),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext || !req.user) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const headerKey = req.get('Idempotency-Key');
      if (headerKey && req.body.idempotencyKey && headerKey !== req.body.idempotencyKey) {
        return res.status(400).json({ success: false, error: 'PAYMENT_IDEMPOTENCY_MISMATCH' });
      }
      const result = await billingPayments.recordSettledPayment(
        req.authContext,
        { ...req.body, idempotencyKey: headerKey ?? req.body.idempotencyKey },
        req.user.fullName,
      );

      return res.status(result.idempotentReplay ? 200 : 201).json(result);
    } catch (err: unknown) {
      if (handlePaymentError(err, res)) return;
      if (handleScopeError(err, res)) return;

      console.error('Failed to record payment; transaction rolled back.');
      return res.status(500).json({
        success: false,
        error: 'PAYMENT_RECORD_FAILED',
        message: 'Failed to record payment.',
      });
    }
  },
);

router.post(
  '/api/billing/payments/status',
  requirePermission('billing.read', 'billing.payments.record'),
  async (req: AuthRequest, res: Response) => {
    if (!req.authContext)
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    res.setHeader('Cache-Control', 'no-store');
    try {
      return res.json(
        await billingPayments.checkPaymentRequestStatus(req.authContext, req.body ?? {}),
      );
    } catch (error) {
      if (handlePaymentError(error, res) || handleScopeError(error, res)) return;
      return res.status(500).json({
        success: false,
        error: 'PAYMENT_STATUS_FAILED',
        message: 'Payment status could not be checked.',
      });
    }
  },
);

router.post(
  '/api/billing/payments/cancel-pending',
  requirePermission('billing.read', 'billing.payments.record'),
  async (req: AuthRequest, res: Response) => {
    if (!req.authContext)
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    res.setHeader('Cache-Control', 'no-store');
    try {
      return res.json(
        await billingPayments.cancelPendingPaymentRequest(req.authContext, req.body ?? {}),
      );
    } catch (error) {
      if (handlePaymentError(error, res) || handleScopeError(error, res)) return;
      return res.status(500).json({
        success: false,
        error: 'PAYMENT_CANCELLATION_FAILED',
        message: 'The receipt request could not be cancelled.',
      });
    }
  },
);

/** Manual accounting record only; no bank, card or mobile transfer is initiated. */
router.post(
  '/api/billing/refunds',
  requirePermission('billing.read'),
  requirePermission('billing.refunds.record'),
  validateBody(refundBodySchema),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext)
        return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
      const headerKey = req.get('Idempotency-Key');
      if (headerKey && req.body.idempotencyKey && headerKey !== req.body.idempotencyKey) {
        return res.status(400).json({ success: false, error: 'REFUND_IDEMPOTENCY_MISMATCH' });
      }
      const result = await recordManualRefund(req.authContext, {
        ...req.body,
        idempotencyKey: headerKey ?? req.body.idempotencyKey,
      });
      return res.status(result.replayed ? 200 : 201).json(result);
    } catch (error: unknown) {
      if (handlePaymentError(error, res) || handleScopeError(error, res)) return;
      console.error('Refund receipt failed; transaction rolled back.');
      return res.status(500).json({
        success: false,
        error: 'REFUND_RECORD_FAILED',
        message: 'Refund could not be recorded.',
      });
    }
  },
);

router.post(
  '/api/billing/refunds/status',
  requirePermission('billing.read'),
  requirePermission('billing.refunds.record'),
  validateBody(refundStatusBodySchema),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext)
        return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
      return res.json(await checkRefundStatus(req.authContext, req.body));
    } catch (error: unknown) {
      if (handlePaymentError(error, res) || handleScopeError(error, res)) return;
      console.error('Refund status could not be loaded.');
      return res.status(500).json({
        success: false,
        error: 'REFUND_STATUS_FAILED',
        message: 'Refund status could not be loaded.',
      });
    }
  },
);

/*
 * Payment ledger for shift reconciliation: what came in, by which
 * method, under which transaction code.
 */

router.get(
  '/api/billing/payments',
  requirePermission('billing.payments.record'),
  validateQuery(paymentLedgerQuerySchema),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const queryParam = (value: unknown): string | null =>
        typeof value === 'string' && value.trim() ? value.trim() : null;

      const payments = await billingPayments.getPaymentLedgerScoped(req.authContext, {
        facilityId: queryParam(req.query.facilityId),
        invoiceId: queryParam(req.query.invoiceId),
        method: queryParam(req.query.method),
        limit: queryParam(req.query.limit),
      });

      return res.json(payments);
    } catch (err: unknown) {
      if (handlePaymentError(err, res)) return;
      if (handleScopeError(err, res)) return;

      console.error('Failed to load payment ledger:', err);
      return res.status(500).json({
        success: false,
        error: 'PAYMENT_LEDGER_FAILED',
        message: 'Failed to load payments.',
      });
    }
  },
);

export default router;
