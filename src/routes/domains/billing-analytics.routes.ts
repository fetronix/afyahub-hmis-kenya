/**
 * Billing diagnostics, reporting and analytics.
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
import { inspectTariffConfiguration } from '../../billing/tariff-validation.service.ts';
import { billingServiceKeys, isValidBillingKey } from '../../billing/tariff-codes.ts';
import { codesForFamily } from '../../billing/tariff-matching.ts';
import { db } from '../../db/index.ts';
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
import * as reporting from '../../reporting/reporting.service.ts';
import { parseOptionalPositiveId, requireAuthContext } from '../../routes/shared/request.ts';
import {
  facilityHasTariffModule,
  requireFacilityAdminTariffRole,
  resolveTariffFacility,
  sendTariffWriteError,
  tariffModuleForDepartment,
  validateTariffInput,
} from '../../routes/shared/tariffs.ts';
import {
  requireAuthorization,
  requirePermission,
  requireAnyPermission,
  requireSuperAdmin,
} from '../../auth/authorization.middleware.ts';
import { ScopeAccessError, resolveFacilityScope } from '../../auth/scope.service.ts';
import * as schema from '../../db/schema.ts';

const router = Router();

router.get(
  '/api/billing/tariff-validation',
  requirePermission('tariffs.read'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.query.facilityId);
      if (!facility) return;
      const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
      const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 200
      )
        return res.status(400).json({
          success: false,
          error: 'INVALID_PAGINATION',
          message: 'Use a valid offset and page size between 1 and 200.',
        });
      return res.json(
        await inspectTariffConfiguration(facility.tenantId, facility.id, offset, limit),
      );
    } catch (error: unknown) {
      return respondInternalError(res, error, 'tariff validation');
    }
  },
);

/**
 * Every active laboratory test in this facility, with what it would
 * bill today — and, when it would bill nothing, why.
 *
 * This is the screen that answers "why did my order not bill?": it
 * runs the same resolver the charger runs, over the facility's own
 * catalogue, and names the row and the reason.
 */

router.get(
  '/api/billing/lab-service-diagnostics',
  requirePermission('tariffs.read'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;

    try {
      const facility = await resolveFacilityScope(
        req.authContext!,
        req.query.facilityId ? Number(req.query.facilityId) : undefined,
      );

      const tests = await db
        .select({
          id: schema.labTests.id,
          code: schema.labTests.code,
          name: schema.labTests.name,
          category: schema.labTests.category,
          isActive: schema.labTests.isActive,
          cataloguePrice: schema.labTests.price,
        })
        .from(schema.labTests)
        .where(eq(schema.labTests.facilityId, facility));

      const diagnostics = [];

      for (const test of tests) {
        const resolution = await billing.resolveTariffForCharge(db, {
          facilityId: facility,
          codes: codesForFamily({
            family: 'LABORATORY',
            code: test.code,
            name: test.name,
          }),
          serviceKeys: billingServiceKeys('LABORATORY', [test.code, test.name]),
          family: 'LABORATORY',
          serviceName: test.name,
          serviceType: 'LAB_TEST',
          serviceId: test.id,
        });

        diagnostics.push({
          testId: test.id,
          code: test.code,
          name: test.name,
          category: test.category,
          isActive: test.isActive,
          /*
           * The catalogue price is shown beside the tariff so the two
           * cannot be confused. It is NOT used for billing; the
           * invoice amount always comes from the tariff.
           */
          cataloguePrice: test.cataloguePrice,
          resolved: resolution.tariff
            ? {
                tariffId: resolution.tariff.id,
                code: resolution.tariff.code,
                description: resolution.tariff.description,
                fee: resolution.tariff.fee,
                unit: resolution.tariff.unit,
                rule: resolution.rule,
              }
            : null,
          failure: resolution.failure
            ? {
                code: resolution.failure.code,
                label: resolution.failure.label,
                message: resolution.failure.message,
                ...(resolution.failure.candidates
                  ? { candidates: resolution.failure.candidates }
                  : {}),
              }
            : null,
          codesTried: resolution.codesTried,
        });
      }

      return res.json({
        facilityId: facility,
        total: diagnostics.length,
        resolved: diagnostics.filter((entry) => entry.resolved !== null).length,
        unresolvable: diagnostics.filter((entry) => entry.resolved === null).length,
        tests: diagnostics,
      });
    } catch (error: unknown) {
      if (handleScopeError(error, res)) return;

      console.error('Laboratory diagnostics error:', error);
      return res.status(500).json({
        success: false,
        error: 'LAB_SERVICE_DIAGNOSTICS_FAILED',
      });
    }
  },
);

/**
 * Operational report: bed occupancy by ward and length of stay.
 *
 * Length of stay is measured from the admission date to now for
 * patients still in a bed, and from admission to discharge for those
 * discharged in the last 30 days.
 */

router.get(
  '/api/reporting/operations',
  requirePermission('reports.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const facilityId = resolveFacilityScope(
        context,
        req.query.facilityId ? Number(req.query.facilityId) : undefined,
      );

      const report = await reporting.getOperationsReportScoped(context, facilityId);

      return res.json(report);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;

      if (err instanceof queries.InpatientDomainError) {
        return res.status(err.status).json({
          success: false,
          error: err.code,
          message: err.message,
        });
      }

      console.error('Operational report error:', err);
      return res.status(500).json({
        success: false,
        error: 'OPERATIONS_REPORT_FAILED',
      });
    }
  },
);

/**
 * Occupied bed-days per calendar day, for the occupancy sparkline.
 * Defaults to 14 days, capped at 90 so a bad query string cannot ask
 * the server to walk years of admissions.
 */

router.get(
  '/api/reporting/occupancy-trend',
  requirePermission('reports.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const facilityId = resolveFacilityScope(
        context,
        req.query.facilityId ? Number(req.query.facilityId) : undefined,
      );

      const requestedDays = Number(req.query.days);
      const days = Number.isFinite(requestedDays) ? requestedDays : 14;

      const points = await reporting.getOccupancyTrendScoped(context, facilityId, days);

      return res.json({ facilityId, days: points.length, points });
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;

      if (err instanceof queries.InpatientDomainError) {
        return res.status(err.status).json({
          success: false,
          error: err.code,
          message: err.message,
        });
      }

      console.error('Occupancy trend error:', err);
      return res.status(500).json({
        success: false,
        error: 'OCCUPANCY_TREND_FAILED',
      });
    }
  },
);

/**
 * Revenue by service category, derived from invoice lines.
 * Excludes voided invoices so the figures reconcile to cash.
 */

router.get(
  '/api/analytics/revenue',
  requirePermission('reports.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const facilityId = resolveFacilityScope(
        context,
        req.query.facilityId ? Number(req.query.facilityId) : undefined,
      );

      /*
       * Optional reporting window. Anything unparseable is a 400
       * rather than a silently unbounded report.
       */
      /*
       * Build the date in SERVER-LOCAL time, not UTC.
       *
       * `new Date('2026-10-21')` is UTC midnight, which in Nairobi is
       * 03:00 on the 21st: a report run at 01:00 would silently drop
       * the first three hours of the day it was asked about.
       */
      const parseRangeDate = (value: unknown, field: string) => {
        if (typeof value !== 'string' || value.trim().length === 0) {
          return undefined;
        }

        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());

        if (!match) {
          throw new Error(`INVALID_${field.toUpperCase()}_DATE`);
        }

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);

        const parsed = new Date(year, month - 1, day);

        /* Reject 2026-02-31, which Date would roll forward to March. */
        if (
          Number.isNaN(parsed.getTime()) ||
          parsed.getFullYear() !== year ||
          parsed.getMonth() !== month - 1 ||
          parsed.getDate() !== day
        ) {
          throw new Error(`INVALID_${field.toUpperCase()}_DATE`);
        }

        return parsed;
      };

      let from: Date | undefined;
      let to: Date | undefined;

      try {
        from = parseRangeDate(req.query.from, 'from');
        to = parseRangeDate(req.query.to, 'to');
      } catch {
        return res.status(400).json({
          success: false,
          error: 'INVALID_DATE_RANGE',
          message: 'from and to must be dates in YYYY-MM-DD format.',
        });
      }

      if (from && to && from.getTime() > to.getTime()) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_DATE_RANGE',
          message: 'from must not be after to.',
        });
      }

      const range = { from, to };

      const [rows, totals, channelSplit] = await Promise.all([
        billing.getRevenueByServiceType(db, facilityId, range),
        billing.getRevenueTotals(db, facilityId, range),
        billing.getRevenueByPaymentChannel(db, facilityId, range),
      ]);

      const totalCents = rows.reduce((sum, row) => sum + billing.toCents(row.revenue), 0);

      /*
       * The channel lines must add up to what the invoices say was
       * collected. When they do not, the report says so instead of
       * quietly presenting a split that does not reconcile.
       */
      const collectedCents = billing.toCents(totals.collected);
      const channelDifferenceCents = channelSplit.totalCents - collectedCents;

      const echoDate = (value: unknown) =>
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;

      return res.json({
        facilityId,
        from: echoDate(req.query.from),
        to: echoDate(req.query.to),
        totalRevenue: billing.fromCents(totalCents),
        totals: {
          invoiceCount: totals.invoiceCount,
          voidedCount: totals.voidedCount,
          invoiced: billing.fromCents(billing.toCents(totals.invoiced)),
          collected: billing.fromCents(billing.toCents(totals.collected)),
          outstanding: billing.fromCents(billing.toCents(totals.outstanding)),
        },
        byService: rows
          .map((row) => ({
            ...row,
            revenue: billing.fromCents(billing.toCents(row.revenue)),
          }))
          .sort((a, b) => billing.toCents(b.revenue) - billing.toCents(a.revenue)),
        byChannel: channelSplit.channels,
        channelTotal: billing.fromCents(channelSplit.totalCents),
        channelReconciliation: {
          collected: billing.fromCents(collectedCents),
          difference: billing.fromCents(channelDifferenceCents),
          reconciled: channelDifferenceCents === 0,
          unmappedMethods: channelSplit.unmappedMethods,
        },
      });
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;

      console.error('Revenue report error:', err);
      return res.status(500).json({
        success: false,
        error: 'REVENUE_REPORT_FAILED',
      });
    }
  },
);

// =========================================================
// AGGREGATED ANALYTICS
// =========================================================

router.get(
  '/api/analytics/summary',
  requirePermission('reports.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      const rawFacilityId = req.query.facilityId;
      if (typeof rawFacilityId !== 'string' || !/^[1-9]\d*$/.test(rawFacilityId)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_FACILITY_ID',
          message: 'A valid facilityId is required.',
        });
      }

      const requestedFacilityId = Number(rawFacilityId);
      if (!Number.isSafeInteger(requestedFacilityId)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_FACILITY_ID',
        });
      }

      const facility = await queries.getFacilityByIdScoped(req.authContext, requestedFacilityId);

      if (!facility) {
        return res.status(404).json({
          success: false,
          error: 'FACILITY_NOT_FOUND',
        });
      }

      const tenantId = facility.tenantId;
      const facilityId = facility.id;

      /* Today + 30 days, as the ISO text expiry_date stores. */
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 30);

      const expiryHorizon = [
        horizon.getFullYear(),
        String(horizon.getMonth() + 1).padStart(2, '0'),
        String(horizon.getDate()).padStart(2, '0'),
      ].join('-');

      const [
        patientRows,
        queueRows,
        admissionRows,
        bedRows,
        surgeryRows,
        labRows,
        invoiceRows,
        inventoryRows,
        expiringRows,
      ] = await Promise.all([
        db
          .select({ value: count() })
          .from(schema.patients)
          .where(
            and(
              eq(schema.patients.tenantId, tenantId),
              eq(schema.patients.registrationFacilityId, facilityId),
            ),
          ),

        db
          .select({ value: count() })
          .from(schema.queues)
          .where(
            and(
              eq(schema.queues.tenantId, tenantId),
              eq(schema.queues.facilityId, facilityId),
              sql`lower(coalesce(${schema.queues.status}, 'waiting')) IN ('waiting', 'in progress', 'serving')`,
            ),
          ),

        db
          .select({ value: count() })
          .from(schema.admissions)
          .where(
            and(
              eq(schema.admissions.tenantId, tenantId),
              eq(schema.admissions.facilityId, facilityId),
              sql`lower(coalesce(${schema.admissions.status}, 'admitted')) = 'admitted'`,
            ),
          ),

        db
          .select({
            total: count(),
            occupied: sql<number>`count(*) FILTER (WHERE lower(coalesce(${schema.beds.status}, '')) = 'occupied')`,
          })
          .from(schema.beds)
          .innerJoin(schema.wards, eq(schema.beds.wardId, schema.wards.id))
          .where(eq(schema.wards.facilityId, facilityId)),

        db
          .select({ value: count() })
          .from(schema.theatreCases)
          .where(
            and(
              eq(schema.theatreCases.tenantId, tenantId),
              eq(schema.theatreCases.facilityId, facilityId),
              sql`lower(coalesce(${schema.theatreCases.status}, '')) = 'scheduled'`,
            ),
          ),

        db
          .select({ value: count() })
          .from(schema.labOrders)
          .where(
            and(
              eq(schema.labOrders.tenantId, tenantId),
              eq(schema.labOrders.facilityId, facilityId),
              sql`lower(coalesce(${schema.labOrders.status}, 'ordered')) NOT IN ('completed', 'cancelled', 'canceled', 'reported', 'rejected')`,
            ),
          ),

        db
          .select({
            revenue: sum(schema.billingInvoices.paidAmount),
            outstanding: sum(schema.billingInvoices.balanceAmount),
          })
          .from(schema.billingInvoices)
          .where(
            and(
              eq(schema.billingInvoices.tenantId, tenantId),
              eq(schema.billingInvoices.facilityId, facilityId),
            ),
          ),

        db
          .select({ value: count() })
          .from(schema.inventoryItems)
          .where(
            and(
              eq(schema.inventoryItems.facilityId, facilityId),
              eq(schema.inventoryItems.isActive, true),
              sql`${schema.inventoryItems.currentStock} <= coalesce(${schema.inventoryItems.reorderLevel}, 0)`,
            ),
          ),

        /*
         * Batches already expired or expiring within 30 days that
         * still hold stock. expiry_date is stored as ISO text, so a
         * lexicographic comparison is also a chronological one.
         */
        db
          .select({ value: count() })
          .from(schema.inventoryBatches)
          .innerJoin(
            schema.inventoryItems,
            eq(schema.inventoryBatches.itemId, schema.inventoryItems.id),
          )
          .where(
            and(
              eq(schema.inventoryItems.facilityId, facilityId),
              sql`${schema.inventoryBatches.quantityRemaining} > 0`,
              sql`${schema.inventoryBatches.expiryDate} <= ${expiryHorizon}`,
            ),
          ),
      ]);

      const totalBeds = Number(bedRows[0]?.total ?? 0);
      const occupiedBeds = Number(bedRows[0]?.occupied ?? 0);

      return res.json({
        totalPatients: Number(patientRows[0]?.value ?? 0),
        activeQueuesCount: Number(queueRows[0]?.value ?? 0),
        currentAdmissions: Number(admissionRows[0]?.value ?? 0),
        bedOccupancyRate: totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 1000) / 10 : 0,
        scheduledSurgeries: Number(surgeryRows[0]?.value ?? 0),
        pendingLabOrders: Number(labRows[0]?.value ?? 0),
        totalRevenueKes: Number(invoiceRows[0]?.revenue ?? 0),
        outstandingBillsKes: Number(invoiceRows[0]?.outstanding ?? 0),
        lowStockAlerts: Number(inventoryRows[0]?.value ?? 0),
        expiringStockAlerts: Number(expiringRows[0]?.value ?? 0),
      });
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;

      console.error('Analytics summary error:', err);
      return res.status(500).json({
        success: false,
        error: 'ANALYTICS_SUMMARY_FAILED',
        message: 'Unable to load the facility analytics summary.',
      });
    }
  },
);

export default router;
