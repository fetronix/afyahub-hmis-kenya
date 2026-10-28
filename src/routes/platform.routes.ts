/**
 * JaliCare HMIS — Platform Administration Router Coordinator
 *
 * Mounted at `/api/platform` behind authentication. Domain route modules live
 * under `src/routes/platform/`:
 *   - `tenants.routes.ts` — tenant creation & partial updates
 *   - `facilities.routes.ts` — facility creation, updates, and onboarding
 *   - `invitations.routes.ts` — facility administrator invitations lifecycle
 *   - `subscriptions.routes.ts` — subscription billing, payments, suspension
 *   - `rbac.routes.ts` — database-backed role catalogue & facility overrides
 */

import { Router } from 'express';

import facilitiesRoutes from './platform/facilities.routes.ts';
import invitationsRoutes from './platform/invitations.routes.ts';
import rbacRoutes from './platform/rbac.routes.ts';
import subscriptionsRoutes from './platform/subscriptions.routes.ts';
import tenantsRoutes from './platform/tenants.routes.ts';

const router = Router();

router.use(tenantsRoutes);
router.use(facilitiesRoutes);
router.use(invitationsRoutes);
router.use(subscriptionsRoutes);
router.use(rbacRoutes);

export default router;
