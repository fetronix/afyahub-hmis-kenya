import { Router } from 'express';
import {
  createStaffInvitation,
  listStaffInvitations,
  revokeStaffInvitation,
  reissueStaffInvitation,
  StaffInvitationError,
} from './staff-invitation.service';
import { listAssignableStaffRoles } from './staff-roles.service';
import { buildInvitationUrl, resolveInvitationBaseUrl } from './invitation-url.ts';
import { requireAuth, type AuthRequest } from './auth.middleware';
import { requirePermission } from './authorization.middleware';

import {
  ProfessionalVerificationError,
  getVerificationDashboardScoped,
  recordManualVerificationScoped,
  verifyPractitionerScoped,
} from '../integrations/professional/professional-verification.service.ts';
import { REGULATORS } from '../integrations/professional/practitioner.contracts.ts';
import {
  createStaffInvitationBodySchema,
  invitationIdParamSchema,
} from '../validation/schemas/index.ts';
import { validateBody, validateParams } from '../validation/validate.ts';

const router = Router();

router.use(requireAuth);

function getScope(req: AuthRequest) {
  const context = req.authContext;

  if (
    !context ||
    !Number.isSafeInteger(context.tenantId) ||
    !Number.isSafeInteger(context.facilityId)
  ) {
    throw new StaffInvitationError(
      'Your account must be assigned to a tenant and facility.',
      403,
      'FACILITY_SCOPE_REQUIRED',
    );
  }

  return {
    tenantId: context.tenantId as number,
    facilityId: context.facilityId as number,
    userId: context.userId,
  };
}

function sendError(res: any, error: unknown) {
  if (error instanceof ProfessionalVerificationError) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }

  if (error instanceof StaffInvitationError) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }

  console.error('Staff invitation API error:', error);

  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'The staff invitation request could not be completed.',
  });
}

/**
 * Regulator catalogue for the invitation popup.
 *
 * Read-only and static; it tells the client which regulators exist, which
 * staff roles they cover, and which of them can be checked automatically.
 */
router.get('/regulators', requirePermission('users.invite'), async (_req, res) => {
  return res.json({
    success: true,
    regulators: REGULATORS.map((regulator) => ({
      code: regulator.code,
      name: regulator.name,
      shortName: regulator.shortName,
      professions: regulator.professions,
      apiSupported: regulator.apiSupported,
      website: regulator.website,
      staffRoles: regulator.staffRoles,
    })),
  });
});

/**
 * Pre-invitation check.
 *
 * Runs the registry lookup and stores the result, returning a
 * `credentialId` that the invitation endpoint will require for a clinical
 * role. A simulated answer is returned as simulated and is not invitable.
 */
router.post(
  '/verify-practitioner',
  requirePermission('users.invite'),
  async (req: AuthRequest, res) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          code: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const scope = getScope(req);
      const {
        regulator,
        registrationNumber,
        identificationNumber,
        identificationType,
        fullName,
        userId,
      } = req.body ?? {};

      const outcome = await verifyPractitionerScoped(req.authContext, {
        regulator,
        registrationNumber: typeof registrationNumber === 'string' ? registrationNumber : null,
        identificationNumber:
          typeof identificationNumber === 'string' ? identificationNumber : null,
        identificationType: typeof identificationType === 'string' ? identificationType : null,
        fullName: typeof fullName === 'string' ? fullName : null,
        userId: Number.isSafeInteger(Number(userId)) && Number(userId) > 0 ? Number(userId) : null,
        facilityId: scope.facilityId,
      });

      return res.json({ success: true, verification: outcome });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

/**
 * Manual verification.
 *
 * For regulators without an authorised API, and for any case where the
 * automated check cannot decide. The source and date are recorded, and
 * the result is never labelled as automated.
 */
router.post(
  '/manual-verification',
  requirePermission('users.invite'),
  async (req: AuthRequest, res) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          code: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const scope = getScope(req);
      const body = req.body ?? {};

      const outcome = await recordManualVerificationScoped(req.authContext, {
        credentialId: body.credentialId ?? null,
        regulator: body.regulator,
        registrationNumber: body.registrationNumber,
        fullName: body.fullName ?? null,
        source: body.source,
        notes: body.notes ?? null,
        status: body.status ?? null,
        licenceExpiry: body.licenceExpiry ?? null,
        // Only used when the check is made for an existing staff account;
        // the service confirms that account belongs to this facility.
        userId: body.userId ?? null,
        facilityId: scope.facilityId,
      });

      return res.json({ success: true, verification: outcome });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

router.get(
  '/verification-dashboard',
  requirePermission('users.invitations.read'),
  async (req: AuthRequest, res) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          code: 'AUTHORIZATION_CONTEXT_MISSING',
          message: 'Authorization context is required.',
        });
      }

      const scope = getScope(req);
      const dashboard = await getVerificationDashboardScoped(req.authContext, scope.facilityId);

      return res.json({ success: true, dashboard });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

router.get('/roles', requirePermission('users.invite'), async (req, res) => {
  try {
    const scope = getScope(req);
    const roles = await listAssignableStaffRoles(scope.tenantId);
    return res.json({ success: true, roles });
  } catch (error) {
    return sendError(res, error);
  }
});
router.post(
  '/',
  requirePermission('users.invite'),
  validateBody(createStaffInvitationBodySchema, { code: 'INVALID_INPUT' }),
  async (req, res) => {
    try {
      const scope = getScope(req);
      const { email, fullName, phone, designation, roleId, credentialId } = req.body ?? {};

      if (
        typeof email !== 'string' ||
        typeof fullName !== 'string' ||
        !Number.isSafeInteger(Number(roleId)) ||
        Number(roleId) <= 0
      ) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_INPUT',
          message: 'Email, full name, and a valid role are required.',
        });
      }

      const resolvedBase = resolveInvitationBaseUrl(req);
      if (!resolvedBase.ok) {
        return res.status(500).json({
          success: false,
          code: resolvedBase.code,
          message: resolvedBase.message,
        });
      }

      const result = await createStaffInvitation({
        tenantId: scope.tenantId,
        facilityId: scope.facilityId,
        email,
        fullName,
        phone: typeof phone === 'string' ? phone : null,
        designation: typeof designation === 'string' ? designation : null,
        roleId: Number(roleId),
        invitedBy: String(scope.userId),
        credentialId:
          Number.isSafeInteger(Number(credentialId)) && Number(credentialId) > 0
            ? Number(credentialId)
            : null,
      });

      const invitationUrl = buildInvitationUrl(
        resolvedBase.baseUrl,
        '/accept-staff-invitation',
        result.token,
      );

      return res.status(201).json({
        success: true,
        invitation: result.invitation,
        invitationUrl,
      });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

router.get('/', requirePermission('users.invitations.read'), async (req, res) => {
  try {
    const scope = getScope(req);

    const invitations = await listStaffInvitations(scope.tenantId, scope.facilityId);

    return res.json({
      success: true,
      invitations,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post(
  '/:id/reissue',
  requirePermission('users.invitations.reissue'),
  validateParams(invitationIdParamSchema, { code: 'INVALID_INVITATION_ID' }),
  async (req, res) => {
    try {
      const scope = getScope(req);
      const invitationId = Number(req.params.id);

      if (!Number.isSafeInteger(invitationId) || invitationId <= 0) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_INVITATION_ID',
          message: 'A valid invitation ID is required.',
        });
      }

      const resolvedBase = resolveInvitationBaseUrl(req);
      if (!resolvedBase.ok) {
        return res.status(500).json({
          success: false,
          code: resolvedBase.code,
          message: resolvedBase.message,
        });
      }

      const result = await reissueStaffInvitation(invitationId, scope.tenantId, scope.facilityId);

      return res.json({
        success: true,
        invitation: result.invitation,
        invitationUrl: buildInvitationUrl(
          resolvedBase.baseUrl,
          '/accept-staff-invitation',
          result.token,
        ),
      });
    } catch (error) {
      return sendError(res, error);
    }
  },
);
router.post(
  '/:id/revoke',
  requirePermission('users.invitations.revoke'),
  validateParams(invitationIdParamSchema, { code: 'INVALID_INVITATION_ID' }),
  async (req, res) => {
    try {
      const scope = getScope(req);
      const invitationId = Number(req.params.id);

      if (!Number.isSafeInteger(invitationId) || invitationId <= 0) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_INVITATION_ID',
          message: 'A valid invitation ID is required.',
        });
      }

      const result = await revokeStaffInvitation(invitationId, scope.tenantId, scope.facilityId);

      return res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

export default router;
