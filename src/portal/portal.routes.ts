/**
 * JaliCare HMIS
 * Patient portal routes
 *
 * Two halves, deliberately in one file so the boundary is visible:
 *
 *   PUBLIC   /api/portal/auth/*        no session required
 *   PATIENT  /api/portal/*             requirePortalAuth only
 *
 * Nothing in this router calls `requireAuth`, and `requirePortalAuth`
 * does not accept a staff token. A patient session cannot reach a staff
 * route and a staff session cannot reach these — the two middlewares read
 * different tables.
 */

import { Router, type Request, type Response } from 'express';

import rateLimit from 'express-rate-limit';

import { requirePortalAuth, type PortalRequest } from './portal.middleware.ts';
import {
  activateInvitation,
  flagVerificationRequired,
  PortalError,
} from './portal.service.ts';
import {
  changePortalPassword,
  getPortalAccountSummary,
  portalLogin,
  revokePortalSession,
} from './portal-auth.service.ts';
import {
  buildPortalRecordSummary,
  getPortalOverview,
  listPortalAppointments,
  listPortalDischargeSummaries,
  listPortalLabResults,
  listPortalMedications,
  listPortalVisits,
  logPortalRecordAccess,
  requestRecordCorrection,
} from './portal-records.service.ts';
import {
  createSharingGrant,
  listPortalRecordAccessHistory,
  listSharingGrants,
  revokeSharingGrant,
} from './portal-sharing.service.ts';
import { getDigitalCard, issueDigitalCard } from './qr.service.ts';

const router = Router();

/* ============================================================
   Rate limits
   ============================================================ */

/**
 * Portal rate limits.
 *
 * Tighter than the staff API, because these endpoints are reachable by
 * anyone with a phone. The limit is per address, and the per-account
 * lockout in `portalLogin` covers the case where an attacker rotates
 * addresses.
 */
function limiter(message: string) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7' as const,
    legacyHeaders: false,
    handler(_req, res) {
      res.status(429).json({
        success: false,
        error: 'TOO_MANY_ATTEMPTS',
        message,
      });
    },
  });
}

const activationLimiter = limiter(
  'Too many activation attempts. Try again in a few minutes.',
);

const loginLimiter = limiter(
  'Too many sign-in attempts. Try again in a few minutes.',
);

/* ============================================================
   Error handling
   ============================================================ */

function sendPortalError(res: Response, error: unknown): boolean {
  if (error instanceof PortalError) {
    res.status(error.statusCode).json({
      success: false,
      error: error.code,
      message: error.message,
    });

    return true;
  }

  return false;
}

function bearerOf(req: Request): string {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) return '';

  return header.slice(7).trim();
}

/* ============================================================
   PUBLIC — activation
   ============================================================ */

/**
 * Activate an account.
 *
 * The token arrives in the request **body**, never the URL. The browser
 * reads it from the URL fragment (which servers never see) and posts it
 * here, so it does not land in an access log or a Referer header.
 */
router.post('/auth/activate', activationLimiter, async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const result = await activateInvitation(
      {
        token: body.token,
        password: body.password,
        confirmPassword: body.confirmPassword,
        dateOfBirth: body.dateOfBirth,
      },
      {
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      },
    );

    if (result.requiresStaffVerification) {
      /*
       * No session is issued. A staff member has to establish identity
       * in person before this account can be used — issuing a session
       * here would hand the record to whoever holds the link.
       */
      if (result.accountId === 0 && result.patientId > 0) {
        await flagVerificationRequired(
          result.patientId,
          'Activation refused: contact already belongs to another portal account',
        );
      }

      return res.status(202).json({
        success: true,
        requiresStaffVerification: true,
        message: result.verificationReason,
      });
    }

    /*
     * The patient is *not* logged in automatically. They sign in with
     * the password they just chose, which confirms they remember it and
     * gives the session a clean creation moment.
     */
    return res.status(201).json({
      success: true,
      requiresStaffVerification: false,
      message: 'Your account is ready. Sign in with your phone number or email and the password you chose.',
      loginIdentifier: result.loginIdentifier,
    });
  } catch (error) {
    if (sendPortalError(res, error)) return;

    console.error('Portal activation failed:', error);

    res.status(500).json({
      success: false,
      error: 'ACTIVATION_FAILED',
      message: 'Your account could not be activated. Ask the reception desk for help.',
    });
  }
});

/* ============================================================
   PUBLIC — login / logout
   ============================================================ */

router.post('/auth/login', loginLimiter, async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const result = await portalLogin(
      { identifier: body.identifier, password: body.password },
      { ipAddress: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    );

    res.json({
      success: true,
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt,
      firstName: result.firstName,
      lastName: result.lastName,
    });
  } catch (error) {
    if (sendPortalError(res, error)) return;

    console.error('Portal login failed:', error);

    res.status(500).json({
      success: false,
      error: 'LOGIN_FAILED',
      message: 'Sign-in could not be completed. Try again.',
    });
  }
});

router.post('/auth/logout', async (req, res) => {
  const token = bearerOf(req);

  if (token) {
    await revokePortalSession(token, 'Signed out');
  }

  res.json({ success: true });
});

/* ============================================================
   Everything below needs a patient session
   ============================================================ */

router.use(requirePortalAuth);

router.get('/me', async (req: PortalRequest, res) => {
  try {
    res.json(await getPortalAccountSummary(req.portalSession!));
  } catch (error) {
    if (sendPortalError(res, error)) return;
    res.status(500).json({ success: false, error: 'PROFILE_READ_FAILED' });
  }
});

router.get('/overview', async (req: PortalRequest, res) => {
  try {
    res.json(
      await getPortalOverview(req.portalSession!, {
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      }),
    );
  } catch (error) {
    if (sendPortalError(res, error)) return;
    res.status(500).json({ success: false, error: 'OVERVIEW_READ_FAILED' });
  }
});

router.get('/visits', async (req: PortalRequest, res) => {
  try {
    res.json(await listPortalVisits(req.portalSession!, requestFacts(req)));
  } catch (error) {
    if (sendPortalError(res, error)) return;
    res.status(500).json({ success: false, error: 'VISITS_READ_FAILED' });
  }
});

router.get('/laboratory', async (req: PortalRequest, res) => {
  try {
    res.json(await listPortalLabResults(req.portalSession!, requestFacts(req)));
  } catch (error) {
    if (sendPortalError(res, error)) return;
    res.status(500).json({ success: false, error: 'LAB_READ_FAILED' });
  }
});

router.get('/medications', async (req: PortalRequest, res) => {
  try {
    res.json(await listPortalMedications(req.portalSession!, requestFacts(req)));
  } catch (error) {
    if (sendPortalError(res, error)) return;
    res.status(500).json({ success: false, error: 'MEDICATIONS_READ_FAILED' });
  }
});

router.get('/appointments', async (req: PortalRequest, res) => {
  try {
    res.json(await listPortalAppointments(req.portalSession!, requestFacts(req)));
  } catch (error) {
    if (sendPortalError(res, error)) return;
    res.status(500).json({ success: false, error: 'APPOINTMENTS_READ_FAILED' });
  }
});

router.get('/discharge-summaries', async (req: PortalRequest, res) => {
  try {
    res.json(
      await listPortalDischargeSummaries(req.portalSession!, requestFacts(req)),
    );
  } catch (error) {
    if (sendPortalError(res, error)) return;
    res.status(500).json({ success: false, error: 'SUMMARIES_READ_FAILED' });
  }
});

/**
 * Download.
 *
 * Generated on the fly and streamed with `Content-Disposition:
 * attachment`. There is no stored file and no public URL, so a link
 * forwarded to the wrong person resolves to 401 unless they also hold a
 * live portal session.
 */
router.get('/records/download', async (req: PortalRequest, res) => {
  try {
    const session = req.portalSession!;
    const summary = await buildPortalRecordSummary(session);

    logPortalRecordAccess(session, {
      action: 'EXPORT',
      recordType: 'PatientRecordSummary',
      request: requestFacts(req),
    }).catch((error) => {
      console.error('Portal download access log failed:', error);
    });

    const filename = `jalicare-record-${summary.patient.mrn ?? session.patientId}-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    res.send(JSON.stringify(summary, null, 2));
  } catch (error) {
    if (sendPortalError(res, error)) return;
    res.status(500).json({ success: false, error: 'DOWNLOAD_FAILED' });
  }
});

router.post('/records/correction-request', async (req: PortalRequest, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const result = await requestRecordCorrection(req.portalSession!, {
      recordType: body.recordType,
      detail: body.detail,
    });

    res.status(201).json({
      success: true,
      ...result,
      message:
        'Your request has been sent to the facility. A clinician reviews corrections; the portal cannot edit the record directly.',
    });
  } catch (error) {
    if (sendPortalError(res, error)) return;
    res.status(500).json({ success: false, error: 'CORRECTION_REQUEST_FAILED' });
  }
});

/* ---------------- sharing ---------------- */

router.get('/sharing', async (req: PortalRequest, res) => {
  try {
    res.json(await listSharingGrants(req.portalSession!));
  } catch (error) {
    if (sendPortalError(res, error)) return;
    res.status(500).json({ success: false, error: 'SHARING_READ_FAILED' });
  }
});

router.post('/sharing', async (req: PortalRequest, res) => {
  try {
    const result = await createSharingGrant(req.portalSession!, req.body);

    res.status(201).json({
      success: true,
      ...result,
      message:
        'Give this code to the recipient. It works once, only for them, and only within your staff session at a facility in this network.',
    });
  } catch (error) {
    if (sendPortalError(res, error)) return;
    res.status(500).json({ success: false, error: 'SHARING_CREATE_FAILED' });
  }
});

router.post('/sharing/:id/revoke', async (req: PortalRequest, res) => {
  try {
    res.json(await revokeSharingGrant(req.portalSession!, req.params.id));
  } catch (error) {
    if (sendPortalError(res, error)) return;
    res.status(500).json({ success: false, error: 'SHARING_REVOKE_FAILED' });
  }
});

router.get('/access-history', async (req: PortalRequest, res) => {
  try {
    res.json(await listPortalRecordAccessHistory(req.portalSession!));
  } catch (error) {
    if (sendPortalError(res, error)) return;
    res.status(500).json({ success: false, error: 'HISTORY_READ_FAILED' });
  }
});

/* ---------------- digital card ---------------- */

router.get('/card', async (req: PortalRequest, res) => {
  try {
    res.json(await getDigitalCard(req.portalSession!));
  } catch (error) {
    if (sendPortalError(res, error)) return;
    res.status(500).json({ success: false, error: 'CARD_READ_FAILED' });
  }
});

router.post('/card', async (req: PortalRequest, res) => {
  try {
    const card = await issueDigitalCard(req.portalSession!);

    /*
     * The SVG is returned, the code is not. The patient shows the card;
     * they cannot copy the code into an API call.
     */
    res.status(201).json({
      success: true,
      svg: card.svg,
      issuedAt: card.issuedAt,
      message:
        'Card issued. Any previous card for this account has stopped working. Scanning the card only helps a staff member find your record — it does not open it.',
    });
  } catch (error) {
    if (sendPortalError(res, error)) return;
    res.status(500).json({ success: false, error: 'CARD_ISSUE_FAILED' });
  }
});

/* ---------------- account security ---------------- */

router.post('/password', async (req: PortalRequest, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const result = await changePortalPassword(req.portalSession!, {
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      confirmPassword: body.confirmPassword,
    });

    res.json({
      success: true,
      ...result,
      message: 'Password changed. Every other device has been signed out.',
    });
  } catch (error) {
    if (sendPortalError(res, error)) return;
    res.status(500).json({ success: false, error: 'PASSWORD_CHANGE_FAILED' });
  }
});

function requestFacts(req: Request) {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

export default router;
