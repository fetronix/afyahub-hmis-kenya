/**
 * Insurance claims.
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
import * as insuranceClaims from '../../insurance/claims.service.ts';
import path from 'path';
import {
  requireAuthorization,
  requirePermission,
  requireAnyPermission,
  requireSuperAdmin,
} from '../../auth/authorization.middleware.ts';

const router = Router();

/*
 * =========================================================
 * INSURANCE CLAIMS
 * =========================================================
 *
 * Claims are drafted from real invoice lines, adjudicated when the
 * payer responds, and settled only when the approved money is actually
 * posted. Nothing here contacts SHA or any other payer.
 */

router.get(
  '/api/claims',
  requireAnyPermission('insurance.read', 'billing.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const claims = await insuranceClaims.getClaimsScoped(
        req.authContext,
        typeof req.query.facilityId === 'string' ? req.query.facilityId : null,
      );

      return res.json(claims);
    } catch (err: unknown) {
      if (handleClaimError(err, res)) return;

      console.error('Failed to load claims:', err);
      return res.status(500).json({
        success: false,
        error: 'CLAIMS_FETCH_FAILED',
        message: 'Failed to load insurance claims.',
      });
    }
  },
);

/*
 * The lines a claim could cover, plus any claim already open on the
 * invoice. The screen prefills its selection from this.
 */

router.get(
  '/api/invoices/:id/claimable-lines',
  requireAnyPermission('insurance.read', 'billing.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const result = await insuranceClaims.getClaimableLinesScoped(
        req.authContext,
        req.params.id,
        typeof req.query.facilityId === 'string' ? req.query.facilityId : null,
      );

      return res.json(result);
    } catch (err: unknown) {
      if (handleClaimError(err, res)) return;

      console.error('Failed to load claimable lines:', err);
      return res.status(500).json({
        success: false,
        error: 'CLAIM_LINES_FETCH_FAILED',
        message: 'Failed to load the invoice charges.',
      });
    }
  },
);

router.get(
  '/api/claims/:id/items',
  requireAnyPermission('insurance.read', 'billing.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const items = await insuranceClaims.getClaimItemsScoped(
        req.authContext,
        req.params.id,
        typeof req.query.facilityId === 'string' ? req.query.facilityId : null,
      );

      return res.json(items);
    } catch (err: unknown) {
      if (handleClaimError(err, res)) return;

      console.error('Failed to load claim items:', err);
      return res.status(500).json({
        success: false,
        error: 'CLAIM_ITEMS_FETCH_FAILED',
        message: 'Failed to load the claim lines.',
      });
    }
  },
);

router.post(
  '/api/claims',
  requirePermission('insurance.claims.create'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext || !req.user) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const result = await insuranceClaims.draftClaimScoped(req.authContext, req.body, req.user.id);

      return res.status(201).json(result);
    } catch (err: unknown) {
      if (handleClaimError(err, res)) return;

      console.error('Failed to draft claim:', err);
      return res.status(500).json({
        success: false,
        error: 'CLAIM_CREATE_FAILED',
        message: 'Failed to draft the claim.',
      });
    }
  },
);

router.post(
  '/api/claims/:id/submit',
  requirePermission('insurance.claims.create'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const claim = await insuranceClaims.submitClaimScoped(
        req.authContext,
        req.params.id,
        req.body?.facilityId ?? null,
      );

      return res.json(claim);
    } catch (err: unknown) {
      if (handleClaimError(err, res)) return;

      console.error('Failed to submit claim:', err);
      return res.status(500).json({
        success: false,
        error: 'CLAIM_SUBMIT_FAILED',
        message: 'Failed to mark the claim as submitted.',
      });
    }
  },
);

router.post(
  '/api/claims/:id/adjudicate',
  requirePermission('insurance.claims.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const claim = await insuranceClaims.adjudicateClaimScoped(
        req.authContext,
        req.params.id,
        req.body,
      );

      return res.json(claim);
    } catch (err: unknown) {
      if (handleClaimError(err, res)) return;

      console.error('Failed to adjudicate claim:', err);
      return res.status(500).json({
        success: false,
        error: 'CLAIM_ADJUDICATION_FAILED',
        message: 'Failed to record the adjudication.',
      });
    }
  },
);

/*
 * Settling posts the approved money against the invoice. This is the
 * only path that can move a claim to "Settled".
 */

router.post(
  '/api/claims/:id/settle',
  requirePermission('insurance.claims.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext || !req.user) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const result = await insuranceClaims.settleClaimScoped(
        req.authContext,
        req.params.id,
        req.user.fullName,
        req.body?.facilityId ?? null,
      );

      return res.json(result);
    } catch (err: unknown) {
      if (handleClaimError(err, res)) return;

      console.error('Failed to settle claim:', err);
      return res.status(500).json({
        success: false,
        error: 'CLAIM_SETTLEMENT_FAILED',
        message: 'Failed to settle the claim.',
      });
    }
  },
);

/*
 * Legacy status endpoint. Kept so existing screens do not break, but
 * it now goes through the same state machine: "Settled" posts money.
 */

router.put(
  '/api/claims/:id/status',
  requirePermission('insurance.claims.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext || !req.user) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const status = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
      const facilityId = req.body?.facilityId ?? null;

      if (status === 'Submitted') {
        const claim = await insuranceClaims.submitClaimScoped(
          req.authContext,
          req.params.id,
          facilityId,
        );

        return res.json(claim);
      }

      if (status === 'Approved' || status === 'Rejected') {
        const claim = await insuranceClaims.adjudicateClaimScoped(req.authContext, req.params.id, {
          approvedAmount: status === 'Rejected' ? 0 : req.body?.approvedAmount,
          notes: req.body?.notes,
          facilityId,
        });

        return res.json(claim);
      }

      if (status === 'Settled') {
        const result = await insuranceClaims.settleClaimScoped(
          req.authContext,
          req.params.id,
          req.user.fullName,
          facilityId,
        );

        return res.json(result.claim);
      }

      return res.status(400).json({
        success: false,
        error: 'INVALID_TRANSITION',
        message: 'A claim cannot be set back to Draft. Use submit, adjudicate or settle.',
      });
    } catch (err: unknown) {
      if (handleClaimError(err, res)) return;

      console.error('Failed to update claim status:', err);
      return res.status(500).json({
        success: false,
        error: 'CLAIM_UPDATE_FAILED',
        message: 'Failed to update insurance claim.',
      });
    }
  },
);

export default router;
