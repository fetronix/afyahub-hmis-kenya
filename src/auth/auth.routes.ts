import { Router } from 'express';

import {
  acceptFacilityAdminInvitationController,
  acceptStaffInvitationController,
  loginController,
  logoutController,
  sessionController,
  validateFacilityAdminInvitationController,
  validateStaffInvitationController,
} from './auth.controller';
import { requireAuth } from './auth.middleware';
import {
  acceptInvitationBodySchema,
  invitationTokenQuerySchema,
  loginBodySchema,
} from '../validation/schemas/index.ts';
import { validateBody, validateQuery } from '../validation/validate.ts';

const router = Router();

/*
 * Public authentication endpoints
 */
router.post(
  '/login',
  validateBody(loginBodySchema, {
    code: (issue) => (issue.path[0] === 'password' ? 'INVALID_PASSWORD' : 'INVALID_IDENTIFIER'),
  }),
  loginController,
);

/*
 * Public facility administrator invitation endpoints.
 * These must be accessible before the invited user logs in.
 */
router.get(
  '/facility-admin-invitations/validate',
  validateQuery(invitationTokenQuerySchema, { code: 'INVALID_INVITATION_TOKEN' }),
  validateFacilityAdminInvitationController,
);

router.post(
  '/facility-admin-invitations/accept',
  validateBody(acceptInvitationBodySchema, { code: 'INVALID_REQUEST' }),
  acceptFacilityAdminInvitationController,
);

/*
 * Public staff invitation endpoints.
 * Keep these public so invited staff can validate and accept their link.
 */
router.get(
  '/staff-invitations/validate',
  validateQuery(invitationTokenQuerySchema, { code: 'INVALID_INVITATION_TOKEN' }),
  validateStaffInvitationController,
);

router.post(
  '/staff-invitations/accept',
  validateBody(acceptInvitationBodySchema, { code: 'INVALID_REQUEST' }),
  acceptStaffInvitationController,
);

/*
 * Session validation requires a valid session.
 */
router.get('/session', requireAuth, sessionController);

/*
 * Logout requires the current authentication session.
 */
router.post('/logout', requireAuth, logoutController);

export default router;
