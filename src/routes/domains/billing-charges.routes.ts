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
        actorUserId: context.userId,
      });

      if (!outcome) {
        return res.status(404).json({
          success: false,
          error: 'CHARGE_ATTEMPT_NOT_FOUND',
          message: 'This charge is not waiting to be billed at this facility.',
        });
      }

      return res.json(outcome);
    } catch (error: unknown) {
      if (handleScopeError(error, res)) return;

      console.error('Charge attempt retry failed.');
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
        actorUserId: context.userId,
      });

      return res.json(summary);
    } catch (error: unknown) {
      if (handleScopeError(error, res)) return;

      console.error('Charge attempt batch retry failed.');
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
      if (!reason || reason.length > 1000)
        return res.status(400).json({
          error: 'CHARGE_ATTEMPT_REASON_REQUIRED',
          message: 'Provide a reason for the write-off.',
        });

      const voided = await chargeAttempts.voidChargeAttempt(db, {
        tenantId: context.tenantId ?? 0,
        facilityId,
        attemptId,
        reason,
        actorUserId: context.userId,
      });

      if (!voided) {
        return res.status(404).json({
          success: false,
          error: 'CHARGE_ATTEMPT_NOT_FOUND',
        });
      }

      return res.json({ success: true, id: attemptId, status: 'VOID' });
    } catch (error: unknown) {
      if (handleScopeError(error, res)) return;

      console.error('Charge attempt write-off failed.');
      return res.status(500).json({
        success: false,
        error: 'CHARGE_ATTEMPT_VOID_FAILED',
      });
    }
  },
);

// Legacy family/alias tariff matching was retired; automatic charges use
// the selected facility service and its directly attached tariff instead.

export default router;
