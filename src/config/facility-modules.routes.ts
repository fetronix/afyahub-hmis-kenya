/**
 * JaliCare HMIS
 * Facility module provisioning
 *
 * Before this route existed the only way to change `enabled_modules`
 * was the platform super-admin facility editor. A facility
 * administrator looking at Configuration → Modular Features saw a
 * switch grid that flipped local React state and toasted "updated",
 * while the navigation rail kept whatever the database held. The
 * antenatal register was the visible casualty: it is a real screen,
 * seeded without `maternity` in the facility list, and nobody at the
 * facility could turn it on.
 *
 * This route makes the switch real:
 *
 *   GET   /api/facilities/:id/modules  — the resolved list
 *   PATCH /api/facilities/:id/modules  — replace it, audited
 *
 * Scoping is delegated to `getFacilityByIdScoped`, so a facility-level
 * account can only reach its own facility and a tenant-level account
 * only facilities in its own tenant. Nothing here trusts a tenant id
 * from the request.
 */

import { Router } from 'express';
import { eq } from 'drizzle-orm';

import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import * as queries from '../db/queries.ts';
import { requireAuth, type AuthRequest } from '../auth/auth.middleware.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { ScopeAccessError } from '../auth/scope.service.ts';
import {
  ALWAYS_ENABLED_MODULES,
  FACILITY_MODULES,
  resolveFacilityModules,
  unknownFacilityModules,
} from './facility-modules.ts';

const router = Router();

router.use(requireAuth);

function parseFacilityId(raw: unknown): number | null {
  const parsed = Number(raw);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;

  return parsed;
}

/**
 * Who may change the module list.
 *
 * `facilities.modules.manage` is the explicit grant. The
 * `FACILITY_ADMIN` role is admitted because it is the role that runs
 * the facility, and because a deployment seeded before this permission
 * existed would otherwise have nobody able to switch a module on. A
 * `system.settings.manage` holder may as well: that permission already
 * covers the configuration surface.
 *
 * The facility argument is read from the database, so the role check
 * cannot be pointed at another tenant.
 */
function mayProvisionModules(context: AuthorizationContext, facilityTenantId: number): boolean {
  if (context.isSuperAdmin) return true;

  if (context.permissions.includes('facilities.modules.manage')) return true;
  if (context.permissions.includes('system.settings.manage')) return true;

  return (
    context.roles.includes('FACILITY_ADMIN') &&
    context.tenantId !== null &&
    context.tenantId === facilityTenantId
  );
}

function sendScopeError(res: any, error: unknown): boolean {
  if (error instanceof ScopeAccessError) {
    res.status(error.code === 'FACILITY_ACCESS_DENIED' ? 403 : 404).json({
      success: false,
      error: error.code,
      message: error.message,
    });

    return true;
  }

  return false;
}

/* ============================================================
   GET /api/facilities/:id/modules
   ============================================================ */

router.get('/:id/modules', async (req: AuthRequest, res) => {
  const context = req.authContext;
  const facilityId = parseFacilityId(req.params.id);

  if (!context) {
    res.status(401).json({
      success: false,
      error: 'AUTHORIZATION_CONTEXT_MISSING',
      message: 'Authorization context is required.',
    });
    return;
  }

  if (facilityId === null) {
    res.status(400).json({
      success: false,
      error: 'INVALID_FACILITY_ID',
      message: 'facilityId must be a positive integer.',
    });
    return;
  }

  try {
    const facility = await queries.getFacilityByIdScoped(context, facilityId);

    if (!facility) {
      res.status(404).json({
        success: false,
        error: 'FACILITY_NOT_FOUND',
        message: 'The facility was not found.',
      });
      return;
    }

    res.json({
      success: true,
      facilityId: facility.id,
      enabledModules: resolveFacilityModules(facility.enabledModules),
      alwaysEnabled: [...ALWAYS_ENABLED_MODULES],
      canManage: mayProvisionModules(context, facility.tenantId),
      catalogue: FACILITY_MODULES,
    });
  } catch (error) {
    if (sendScopeError(res, error)) return;

    res.status(500).json({
      success: false,
      error: 'FACILITY_MODULES_READ_FAILED',
      message: 'Could not read the facility module list.',
    });
  }
});

/* ============================================================
   PATCH /api/facilities/:id/modules
   ============================================================ */

router.patch('/:id/modules', async (req: AuthRequest, res) => {
  const context = req.authContext;
  const facilityId = parseFacilityId(req.params.id);

  if (!context) {
    res.status(401).json({
      success: false,
      error: 'AUTHORIZATION_CONTEXT_MISSING',
      message: 'Authorization context is required.',
    });
    return;
  }

  if (facilityId === null) {
    res.status(400).json({
      success: false,
      error: 'INVALID_FACILITY_ID',
      message: 'facilityId must be a positive integer.',
    });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;

  if (
    !Array.isArray(body.enabledModules) ||
    !body.enabledModules.every((item) => typeof item === 'string')
  ) {
    res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'enabledModules must be an array of module ids.',
    });
    return;
  }

  const requested = body.enabledModules as string[];

  if (requested.length > FACILITY_MODULES.length * 2) {
    res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'enabledModules contains too many entries.',
    });
    return;
  }

  const unknown = unknownFacilityModules(requested);

  if (unknown.length > 0) {
    res.status(400).json({
      success: false,
      error: 'UNKNOWN_MODULE',
      message: `Unknown module id(s): ${unknown.join(', ')}.`,
      modules: unknown,
    });
    return;
  }

  try {
    const facility = await queries.getFacilityByIdScoped(context, facilityId);

    if (!facility) {
      res.status(404).json({
        success: false,
        error: 'FACILITY_NOT_FOUND',
        message: 'The facility was not found.',
      });
      return;
    }

    if (!mayProvisionModules(context, facility.tenantId)) {
      res.status(403).json({
        success: false,
        error: 'MODULE_PROVISIONING_FORBIDDEN',
        message:
          "Your account cannot change this facility's modules. Ask a facility administrator or platform administrator.",
      });
      return;
    }

    const previous = resolveFacilityModules(facility.enabledModules);
    const next = resolveFacilityModules(requested);

    const added = next.filter((id) => !previous.includes(id));
    const removed = previous.filter((id) => !next.includes(id));

    /*
     * `resolveFacilityModules` forces always-on modules back on. The
     * response says so (`alwaysEnabled`) rather than letting a caller
     * believe it switched Configuration off.
     */

    const [updated] = await db
      .update(schema.facilities)
      .set({
        enabledModules: next,
        updatedAt: new Date(),
      })
      .where(eq(schema.facilities.id, facility.id))
      .returning();

    if (!updated) {
      res.status(404).json({
        success: false,
        error: 'FACILITY_NOT_FOUND',
        message: 'The facility was not found.',
      });
      return;
    }

    await queries.logAuditEvent(
      facility.tenantId,
      facility.id,
      String(context.userId),
      'UPDATE',
      'facility_modules',
      String(facility.id),
      JSON.stringify({
        fields: ['enabledModules'],
        added,
        removed,
      }),
    );

    res.json({
      success: true,
      facilityId: updated.id,
      enabledModules: next,
      added,
      removed,
      alwaysEnabled: [...ALWAYS_ENABLED_MODULES],
      changed: added.length + removed.length > 0,
    });
  } catch (error) {
    if (sendScopeError(res, error)) return;

    res.status(500).json({
      success: false,
      error: 'FACILITY_MODULES_UPDATE_FAILED',
      message: 'Could not update the facility module list.',
    });
  }
});

export default router;
