/**
 * Charge attempts and tariff matching.
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
import * as chargeAttempts from '../../billing/charge-attempts.ts';
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
import { requestedFacilityHint, requireScopedFacility } from '../../routes/shared/scoping.ts';
import {
  requireAuthorization,
  requirePermission,
  requireAnyPermission,
  requireSuperAdmin,
} from '../../auth/authorization.middleware.ts';
import { parseOptionalPositiveId, requireAuthContext } from '../../routes/shared/request.ts';
import { ScopeAccessError, resolveFacilityScope } from '../../auth/scope.service.ts';

const router = Router();

// =========================================================
// UNBILLED CHARGES
// =========================================================
//
// A charge the engine could not price is written to
// `billing_charge_attempts` (migration 0020). These routes are how a
// facility sees that money and bills it once the price list is right.

/** Everything waiting to be billed, plus what has been resolved. */

router.get(
  '/api/billing/charge-attempts',
  /*
   * OR, not AND: a Facility Administrator holds `tariffs.*` and a
   * Billing Clerk holds `billing.*`. Either is entitled to see what
   * this facility failed to bill.
   */
  requireAnyPermission('billing.read', 'tariffs.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const rawFacilityId = req.query.facilityId;
      const requestedFacilityId =
        typeof rawFacilityId === 'string' && rawFacilityId.trim()
          ? Number(rawFacilityId)
          : undefined;

      const facilityId = resolveFacilityScope(context, requestedFacilityId);

      const status =
        typeof req.query.status === 'string' && req.query.status.trim()
          ? req.query.status.trim().toUpperCase()
          : null;

      const rows = await chargeAttempts.listChargeAttempts(db, {
        tenantId: context.tenantId ?? 0,
        facilityId,
        status,
      });

      const pending = await chargeAttempts.countPendingChargeAttempts(db, {
        tenantId: context.tenantId ?? 0,
        facilityId,
      });

      return res.json({ facilityId, pending, attempts: rows });
    } catch (error: unknown) {
      if (handleScopeError(error, res)) return;

      console.error('Charge attempt list error:', error);
      return res.status(500).json({
        success: false,
        error: 'CHARGE_ATTEMPTS_LIST_FAILED',
      });
    }
  },
);

/** Retry one charge after the tariff has been configured. */

router.post(
  '/api/billing/charge-attempts/:id/retry',
  requireAnyPermission('billing.update', 'tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    const attemptId = Number(req.params.id);

    if (!Number.isSafeInteger(attemptId) || attemptId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_CHARGE_ATTEMPT_ID',
      });
    }

    try {
      const facilityId = resolveFacilityScope(context, requestedFacilityHint(req));

      const outcome = await chargeAttempts.retryChargeAttempt(db, {
        tenantId: context.tenantId ?? 0,
        facilityId,
        attemptId,
      });

      if (!outcome) {
        return res.status(404).json({
          success: false,
          error: 'CHARGE_ATTEMPT_NOT_FOUND',
          message: 'This charge is not waiting to be billed at this facility.',
        });
      }

      if (outcome.status === 'BILLED') {
        await queries.logAuditEvent(
          context.tenantId ?? 0,
          facilityId,
          String(context.userId),
          'UPDATE',
          'BillingChargeAttempt',
          String(attemptId),
          `Unbilled charge retried and billed as ${outcome.result.tariffCode ?? 'tariff'} on invoice ${outcome.result.invoiceNumber ?? '—'}.`,
        );
      }

      return res.json(outcome);
    } catch (error: unknown) {
      if (handleScopeError(error, res)) return;

      console.error('Charge attempt retry error:', error);
      return res.status(500).json({
        success: false,
        error: 'CHARGE_ATTEMPT_RETRY_FAILED',
      });
    }
  },
);

/** Retry everything waiting for this facility, bounded. */

router.post(
  '/api/billing/charge-attempts/retry',
  requireAnyPermission('billing.update', 'tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    try {
      const facilityId = resolveFacilityScope(context, requestedFacilityHint(req));

      const summary = await chargeAttempts.retryPendingChargeAttempts(db, {
        tenantId: context.tenantId ?? 0,
        facilityId,
      });

      await queries.logAuditEvent(
        context.tenantId ?? 0,
        facilityId,
        String(context.userId),
        'UPDATE',
        'BillingChargeAttempt',
        'batch',
        `Retried ${summary.tried} unbilled charge(s): ${summary.billed} billed, ${summary.stillPending} still waiting.`,
      );

      return res.json(summary);
    } catch (error: unknown) {
      if (handleScopeError(error, res)) return;

      console.error('Charge attempt batch retry error:', error);
      return res.status(500).json({
        success: false,
        error: 'CHARGE_ATTEMPT_RETRY_FAILED',
      });
    }
  },
);

/** Write an unbilled charge off, keeping the record. */

router.post(
  '/api/billing/charge-attempts/:id/void',
  requireAnyPermission('billing.update', 'tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    const attemptId = Number(req.params.id);

    if (!Number.isSafeInteger(attemptId) || attemptId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_CHARGE_ATTEMPT_ID',
      });
    }

    try {
      const facilityId = resolveFacilityScope(context, requestedFacilityHint(req));

      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

      const voided = await chargeAttempts.voidChargeAttempt(db, {
        tenantId: context.tenantId ?? 0,
        facilityId,
        attemptId,
        ...(reason ? { reason } : {}),
      });

      if (!voided) {
        return res.status(404).json({
          success: false,
          error: 'CHARGE_ATTEMPT_NOT_FOUND',
        });
      }

      await queries.logAuditEvent(
        context.tenantId ?? 0,
        facilityId,
        String(context.userId),
        'UPDATE',
        'BillingChargeAttempt',
        String(attemptId),
        `Unbilled charge written off${reason ? `: ${reason}` : '.'}`,
      );

      return res.json({ success: true, id: attemptId, status: 'VOID' });
    } catch (error: unknown) {
      if (handleScopeError(error, res)) return;

      console.error('Charge attempt void error:', error);
      return res.status(500).json({
        success: false,
        error: 'CHARGE_ATTEMPT_VOID_FAILED',
      });
    }
  },
);

/**
 * Explain what a charge would be priced at, and why.
 *
 * Read-only. Every tariff in the facility comes back with a verdict,
 * so "OPD-001 was not used" is answered about the facility's own rows.
 */

router.post(
  '/api/billing/tariff-match',
  requireAnyPermission('billing.read', 'tariffs.read'),
  async (req: AuthRequest, res: Response) => {
    const context = requireAuthContext(req, res);

    if (!context) return;

    const family = typeof req.body?.family === 'string' ? req.body.family.trim().toUpperCase() : '';

    const known = [
      'CONSULTATION',
      'LABORATORY',
      'RADIOLOGY',
      'PROCEDURE',
      'ADMISSION',
      'BED_DAY',
      'DELIVERY',
      'PHARMACY',
    ];

    if (!known.includes(family)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_BILLING_FAMILY',
        message: `family must be one of ${known.join(', ')}.`,
      });
    }

    const asText = (value: unknown): string | null =>
      typeof value === 'string' && value.trim() ? value.trim() : null;

    try {
      /*
       * Scope first, body second: the requested facility is only ever
       * a *hint*, and `resolveFacilityScope` refuses one outside the
       * session's scope.
       */
      const facilityId = resolveFacilityScope(context, requestedFacilityHint(req));

      const explanation = await billing.explainFacilityTariffMatch(db, {
        facilityId,
        family: family as NonNullable<billing.ChargeRequest['family']>,
        code: asText(req.body?.code),
        name: asText(req.body?.name),
        wardCode: asText(req.body?.wardCode),
        encounterType: asText(req.body?.encounterType),
      });

      return res.json({
        facilityId,
        family,
        ...explanation,
        wouldBill: explanation.outcome.tariff
          ? {
              code: explanation.outcome.tariff.code,
              description: explanation.outcome.tariff.description,
              fee: explanation.outcome.tariff.fee,
              unit: explanation.outcome.tariff.unit,
              rule: explanation.outcome.rule,
            }
          : null,
      });
    } catch (error: unknown) {
      if (handleScopeError(error, res)) return;

      console.error('Tariff match explanation error:', error);
      return res.status(500).json({
        success: false,
        error: 'TARIFF_MATCH_FAILED',
      });
    }
  },
);

export default router;
