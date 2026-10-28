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
  resolveHiddenFacilityModules,
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
      hiddenModules: resolveHiddenFacilityModules(facility.hiddenModules),
      clinicalProtocols:
        facility.clinicalProtocols && typeof facility.clinicalProtocols === 'object'
          ? facility.clinicalProtocols
          : {},
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

  let requestedHidden: string[] | undefined;
  if ('hiddenModules' in body && body.hiddenModules !== undefined) {
    if (
      !Array.isArray(body.hiddenModules) ||
      !body.hiddenModules.every((item) => typeof item === 'string')
    ) {
      res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'hiddenModules must be an array of module ids.',
      });
      return;
    }

    const unknownHidden = unknownFacilityModules(body.hiddenModules);
    if (unknownHidden.length > 0) {
      res.status(400).json({
        success: false,
        error: 'UNKNOWN_MODULE',
        message: `Unknown hidden module id(s): ${unknownHidden.join(', ')}.`,
        modules: unknownHidden,
      });
      return;
    }

    requestedHidden = body.hiddenModules as string[];
  }

  // Clinical protocol changes are not module provisioning. A module manager
  // must not be able to prescribe facility clinical rules through this route.
  if ('clinicalProtocols' in body) {
    res.status(403).json({
      success: false,
      error: 'CLINICAL_PROTOCOL_PERMISSION_REQUIRED',
      message: 'Clinical protocols require a separately authorized clinical workflow.',
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

    // Lock the facility row so two administrators cannot silently overwrite
    // each other's module list and so the audit entry commits with the change.
    const result = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(schema.facilities)
        .where(eq(schema.facilities.id, facility.id))
        .for('update');
      if (!locked || locked.tenantId !== facility.tenantId) throw new Error('Facility unavailable');
      const previous = resolveFacilityModules(locked.enabledModules);
      const next = resolveFacilityModules(requested);
      const added = next.filter((id) => !previous.includes(id));
      const removed = previous.filter((id) => !next.includes(id));
      const previousHidden = resolveHiddenFacilityModules(locked.hiddenModules);
      const nextHidden =
        requestedHidden !== undefined
          ? resolveHiddenFacilityModules(requestedHidden)
          : previousHidden;
      const hiddenAdded = nextHidden.filter((id) => !previousHidden.includes(id));
      const hiddenRemoved = previousHidden.filter((id) => !nextHidden.includes(id));
      const [updated] = await tx
        .update(schema.facilities)
        .set({
          enabledModules: next,
          hiddenModules: nextHidden,
          updatedAt: new Date(),
        })
        .where(eq(schema.facilities.id, locked.id))
        .returning();
      // Unlike the legacy logAuditEvent helper, this audit is not best effort:
      // an audit write failure rolls back the configuration change.
      await tx.insert(schema.auditLogs).values({
        tenantId: facility.tenantId,
        facilityId: facility.id,
        userId: String(context.userId),
        action: 'UPDATE',
        resource: 'facility_modules',
        resourceId: String(facility.id),
        details: JSON.stringify({
          added,
          removed,
          hiddenAdded,
          hiddenRemoved,
          historicalDataPreserved: true,
        }),
      });
      return { updated, next, nextHidden, added, removed, hiddenAdded, hiddenRemoved };
    });

    res.json({
      success: true,
      facilityId: result.updated.id,
      enabledModules: result.next,
      hiddenModules: result.nextHidden,
      added: result.added,
      removed: result.removed,
      hiddenAdded: result.hiddenAdded,
      hiddenRemoved: result.hiddenRemoved,
      alwaysEnabled: [...ALWAYS_ENABLED_MODULES],
      changed:
        result.added.length +
          result.removed.length +
          result.hiddenAdded.length +
          result.hiddenRemoved.length >
        0,
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
