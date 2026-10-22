/**
 * JaliCare HMIS
 * Patient portal — staff routes
 *
 * Two audiences with different permissions:
 *
 *   Reception      may invite, resend, hand over and revoke invitations
 *                  for a patient at their own facility. Nothing else.
 *   Facility Admin manages accounts, policy and oversight.
 *
 * The distinction is enforced with permission codes on each route, not
 * by hiding menu items. A receptionist who types the admin URL gets 403
 * from `requirePermission('portal.accounts.manage')`.
 */

import { Router } from 'express';

import { requireAuth, type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { ScopeAccessError } from '../auth/scope.service.ts';

import {
  PortalError,
  getPatientPortalStatus,
  issueInvitation,
  markHandedOver,
  reissueManualLink,
  revokeInvitation,
} from './portal.service.ts';

import {
  findPortalAccountRisks,
  getPortalAccountDetail,
  getPortalOverviewStats,
  listPortalAuditTrail,
  getPortalSettings,
  forcePortalPasswordReset,
  reactivatePortalAccount,
  revokePortalAccount,
  savePortalSettings,
  searchPortalAccounts,
  suspendPortalAccount,
} from './portal-admin.service.ts';

import { resolveDigitalCard } from './qr.service.ts';

import { redeemSharingGrant } from './portal-sharing.service.ts';

const router = Router();

/*
 * Every route below is staff-only. This router is mounted at
 * `/api/portal/admin`, so a request to `/api/portal/auth/login` never
 * enters it and this middleware cannot accidentally guard a patient
 * endpoint.
 */
router.use(requireAuth);

function sendError(res: import('express').Response, error: unknown): boolean {
  if (error instanceof PortalError) {
    res.status(error.statusCode).json({
      success: false,
      error: error.code,
      message: error.message,
      ...(error.detail ? { detail: error.detail } : {}),
    });

    return true;
  }

  if (error instanceof ScopeAccessError) {
    const status =
      error.code === 'FACILITY_REQUIRED' || error.code === 'INVALID_SCOPE_ID'
        ? 400
        : 403;

    res.status(status).json({
      success: false,
      error: error.code,
      message: error.message,
    });

    return true;
  }

  return false;
}

function facts(req: AuthRequest) {
  return { ipAddress: req.ip ?? null };
}

/* ============================================================
   Reception — invitations
   ============================================================ */

router.get(
  '/patients/:patientId/status',
  requirePermission('portal.invite'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      res.json(await getPatientPortalStatus(req.authContext, req.params.patientId));
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Portal status read failed:', error);
      res.status(500).json({ success: false, error: 'PORTAL_STATUS_READ_FAILED' });
    }
  },
);

router.post(
  '/patients/:patientId/invitations',
  requirePermission('portal.invite'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      const body = (req.body ?? {}) as Record<string, unknown>;

      const result = await issueInvitation(
        req.authContext,
        req.params.patientId,
        {
          channel:
            body.channel === 'SMS' || body.channel === 'EMAIL' || body.channel === 'MANUAL'
              ? body.channel
              : 'MANUAL',
          purpose:
            body.purpose === 'RECOVERY' || body.purpose === 'REVERIFICATION'
              ? body.purpose
              : 'ACTIVATION',
          contactOverride:
            typeof body.contact === 'string' ? body.contact : null,
        },
        facts(req),
      );

      res.status(201).json({ success: true, ...result });
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Portal invitation failed:', error);
      res.status(500).json({ success: false, error: 'INVITATION_CREATE_FAILED' });
    }
  },
);

/**
 * Re-issue a manual link.
 *
 * Returns a *new* token: the previous slip stops working the moment this
 * succeeds. That is the correct behaviour for a lost card, and it is
 * also why the raw token is never stored for display.
 */
router.post(
  '/invitations/:invitationId/link',
  requirePermission('portal.invite'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      const result = await reissueManualLink(
        req.authContext,
        req.params.invitationId,
        facts(req),
      );

      res.json({
        success: true,
        ...result,
        message:
          'New link created. Any copy already printed has stopped working.',
      });
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Portal link reissue failed:', error);
      res.status(500).json({ success: false, error: 'INVITATION_REISSUE_FAILED' });
    }
  },
);

router.post(
  '/invitations/:invitationId/handed-over',
  requirePermission('portal.invite'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      res.json({
        success: true,
        ...(await markHandedOver(req.authContext, req.params.invitationId)),
      });
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Portal handover failed:', error);
      res.status(500).json({ success: false, error: 'HANDOVER_FAILED' });
    }
  },
);

router.post(
  '/invitations/:invitationId/revoke',
  requirePermission('portal.invites.manage'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      const reason = (req.body ?? {}).reason;

      res.json({
        success: true,
        ...(await revokeInvitation(req.authContext, req.params.invitationId, reason)),
      });
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Portal invitation revoke failed:', error);
      res.status(500).json({ success: false, error: 'INVITATION_REVOKE_FAILED' });
    }
  },
);

/* ============================================================
   Facility admin — overview
   ============================================================ */

router.get(
  '/overview',
  requirePermission('portal.accounts.manage'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      res.json(await getPortalOverviewStats(req.authContext));
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Portal overview failed:', error);
      res.status(500).json({ success: false, error: 'OVERVIEW_FAILED' });
    }
  },
);

router.get(
  '/accounts',
  requirePermission('portal.accounts.manage'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      res.json({
        success: true,
        accounts: await searchPortalAccounts(req.authContext, {
          search: req.query.search,
          status: req.query.status,
          limit: req.query.limit,
        }),
      });
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Portal account search failed:', error);
      res.status(500).json({ success: false, error: 'ACCOUNT_SEARCH_FAILED' });
    }
  },
);

router.get(
  '/accounts/:accountId',
  requirePermission('portal.accounts.manage'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      res.json(await getPortalAccountDetail(req.authContext, req.params.accountId));
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Portal account detail failed:', error);
      res.status(500).json({ success: false, error: 'ACCOUNT_READ_FAILED' });
    }
  },
);

router.post(
  '/accounts/:accountId/suspend',
  requirePermission('portal.accounts.manage'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      res.json({
        success: true,
        ...(await suspendPortalAccount(
          req.authContext,
          req.params.accountId,
          (req.body ?? {}).reason,
        )),
      });
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Portal suspend failed:', error);
      res.status(500).json({ success: false, error: 'SUSPEND_FAILED' });
    }
  },
);

router.post(
  '/accounts/:accountId/reactivate',
  requirePermission('portal.accounts.manage'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      res.json({
        success: true,
        ...(await reactivatePortalAccount(
          req.authContext,
          req.params.accountId,
          (req.body ?? {}).reason,
        )),
      });
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Portal reactivate failed:', error);
      res.status(500).json({ success: false, error: 'REACTIVATE_FAILED' });
    }
  },
);

router.post(
  '/accounts/:accountId/revoke',
  requirePermission('portal.accounts.manage'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      res.json({
        success: true,
        ...(await revokePortalAccount(
          req.authContext,
          req.params.accountId,
          (req.body ?? {}).reason,
        )),
      });
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Portal revoke failed:', error);
      res.status(500).json({ success: false, error: 'REVOKE_FAILED' });
    }
  },
);

router.post(
  '/accounts/:accountId/force-reset',
  requirePermission('portal.accounts.manage'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      res.json({
        success: true,
        ...(await forcePortalPasswordReset(req.authContext, req.params.accountId)),
      });
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Portal force reset failed:', error);
      res.status(500).json({ success: false, error: 'FORCE_RESET_FAILED' });
    }
  },
);

router.get(
  '/audit',
  requirePermission('portal.audit.read'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      res.json({
        success: true,
        ...(await listPortalAuditTrail(req.authContext, {
          limit: req.query.limit,
          offset: req.query.offset,
        })),
      });
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Portal audit read failed:', error);
      res.status(500).json({ success: false, error: 'AUDIT_READ_FAILED' });
    }
  },
);

router.get(
  '/risks',
  requirePermission('portal.accounts.manage'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      res.json(await findPortalAccountRisks(req.authContext));
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Portal risk scan failed:', error);
      res.status(500).json({ success: false, error: 'RISK_SCAN_FAILED' });
    }
  },
);

/* ============================================================
   Settings
   ============================================================ */

router.get(
  '/settings',
  requirePermission('portal.settings.manage'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      res.json({ success: true, ...(await getPortalSettings(req.authContext)) });
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Portal settings read failed:', error);
      res.status(500).json({ success: false, error: 'SETTINGS_READ_FAILED' });
    }
  },
);

router.put(
  '/settings',
  requirePermission('portal.settings.manage'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      res.json({
        success: true,
        ...(await savePortalSettings(req.authContext, req.body)),
      });
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Portal settings save failed:', error);
      res.status(500).json({ success: false, error: 'SETTINGS_SAVE_FAILED' });
    }
  },
);

/* ============================================================
   Digital card — staff side
   ============================================================ */

/**
 * Resolve a scanned card.
 *
 * Scanning is a lookup under the staff member's own session — it is not
 * an authentication event. The response says so, so nobody mistakes a
 * successful scan for "the patient is verified".
 */
router.post(
  '/card/lookup',
  requirePermission('patients.read'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      const body = (req.body ?? {}) as Record<string, unknown>;

      res.json({
        success: true,
        ...(await resolveDigitalCard(req.authContext, body.code, {
          ipAddress: req.ip ?? null,
          userAgent: req.get('user-agent') ?? null,
        })),
      });
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Card lookup failed:', error);
      res.status(500).json({ success: false, error: 'CARD_LOOKUP_FAILED' });
    }
  },
);

/** A staff member viewing a patient's card SVG is an auditable read. */
router.get(
  '/accounts/:accountId/card',
  requirePermission('portal.accounts.manage'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      const accountId = Number(req.params.accountId);

      /* Reuse the admin detail reader for the scope check. */
      const detail = await getPortalAccountDetail(req.authContext, accountId);

      if (!detail.account.hasDigitalCard) {
        return res.status(404).json({
          success: false,
          error: 'NO_DIGITAL_CARD',
          message: 'This patient has not issued a digital card.',
        });
      }

      /*
       * The card is rendered from the sealed code by the patient's own
       * session helper; staff cannot re-render it, because the helper
       * takes a portal session. Staff see whether a card exists, not
       * its contents — which is enough for administration and avoids
       * handing every administrator a scannable identifier.
       */
      res.json({
        success: true,
        hasDigitalCard: true,
        issuedAt: null,
        message:
          'A digital card exists. The patient shows it themselves; it cannot be re-rendered from staff screens.',
      });
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Account card read failed:', error);
      res.status(500).json({ success: false, error: 'CARD_READ_FAILED' });
    }
  },
);

/* ============================================================
   Sharing grant redemption
   ============================================================ */

router.post(
  '/sharing/redeem',
  requirePermission('patients.read'),
  async (req: AuthRequest, res) => {
    if (!req.authContext) {
      return res.status(401).json({ success: false, error: 'AUTHORIZATION_CONTEXT_MISSING' });
    }

    try {
      const body = (req.body ?? {}) as Record<string, unknown>;

      res.json({
        success: true,
        ...(await redeemSharingGrant(req.authContext, body.code)),
      });
    } catch (error) {
      if (sendError(res, error)) return;

      console.error('Sharing grant redemption failed:', error);
      res.status(500).json({ success: false, error: 'SHARING_REDEEM_FAILED' });
    }
  },
);

export default router;
