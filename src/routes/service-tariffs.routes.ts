/**
 * The facility service tariffs routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this router on the API router.
 */

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { db } from '../db/index.ts';
import {
  importTariffs,
  previewTariffImport,
  tariffImportStatus,
  TariffImportError,
} from '../billing/tariff-import.service.ts';
import * as schema from '../db/schema.ts';
import * as reporting from '../reporting/reporting.service.ts';
import {
  facilityHasTariffModule,
  requireFacilityAdminTariffRole,
  resolveTariffFacility,
  sendTariffWriteError,
  validateTariffInput,
} from './shared/tariffs.ts';
import { and, eq } from 'drizzle-orm';
import { Router, type Response } from 'express';

const router = Router();

// =========================================================
// FACILITY SERVICE TARIFFS
// =========================================================

/**
 * Turn the two database errors this write can raise into sentences.
 *
 *   23505  two active tariffs claim the same automatic charge. That is
 *          refused on purpose: the amount billed would otherwise depend
 *          on which row the database returned first.
 *   42703  the database predates migration 0019, so a link cannot be
 *          stored. Say so instead of reporting a generic failure and
 *          letting the administrator believe the link was saved.
 */
// Tariff pricing is restricted to tenant-level Facility Administrators.
// This guard runs after requirePermission has loaded req.authContext.
router.get(
  '/api/service-tariffs',
  requirePermission('tariffs.read'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.query.facilityId);
      if (!facility) return;

      const rows = await db
        .select()
        .from(schema.facilityServiceTariffs)
        .where(
          and(
            eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
            eq(schema.facilityServiceTariffs.facilityId, facility.id),
          ),
        );

      return res.json(rows);
    } catch (error: unknown) {
      console.error('Failed to fetch service tariffs:', error);
      return res.status(500).json({
        success: false,
        error: 'SERVICE_TARIFFS_FETCH_FAILED',
        message: 'Failed to fetch service tariffs.',
      });
    }
  },
);

function tariffImportFailure(res: Response, error: unknown) {
  if (error instanceof TariffImportError)
    return res
      .status(error.status)
      .json({ success: false, error: error.code, message: error.message, issues: error.issues });
  if (sendTariffWriteError(error, res)) return;
  console.error('Tariff import failed; no partial batch was committed.');
  return res.status(500).json({
    success: false,
    error: 'TARIFF_IMPORT_FAILED',
    message: 'Tariff import failed; review before retrying.',
  });
}

router.post(
  '/api/service-tariffs/import/validate',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility) return;
      return res.json(await previewTariffImport(facility, req.body?.rows));
    } catch (error) {
      return tariffImportFailure(res, error);
    }
  },
);

router.post(
  '/api/service-tariffs/import/status',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility) return;
      return res.json(await tariffImportStatus(facility, req.body?.idempotencyKey));
    } catch (error) {
      return tariffImportFailure(res, error);
    }
  },
);

router.post(
  '/api/service-tariffs/import',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;
      const result = await importTariffs(facility, req.authContext.userId, {
        ...req.body,
        idempotencyKey: req.get('Idempotency-Key') ?? req.body?.idempotencyKey,
      });
      return res.status(result.idempotentReplay ? 200 : 201).json(result);
    } catch (error) {
      return tariffImportFailure(res, error);
    }
  },
);

router.post(
  '/api/service-tariffs',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;

      const input = validateTariffInput(req.body);
      if (!input) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_SERVICE_TARIFF',
          message:
            'Provide a valid code, description, enabled department, unit, fee, and SHA status.',
        });
      }

      if (!facilityHasTariffModule(facility, input.moduleId)) {
        return res.status(400).json({
          success: false,
          error: 'TARIFF_DEPARTMENT_MODULE_DISABLED',
          message: 'Enable the selected department module before adding its tariff.',
        });
      }

      const [existing] = await db
        .select({ id: schema.facilityServiceTariffs.id })
        .from(schema.facilityServiceTariffs)
        .where(
          and(
            eq(schema.facilityServiceTariffs.facilityId, facility.id),
            eq(schema.facilityServiceTariffs.code, input.code),
          ),
        )
        .limit(1);

      if (existing) {
        return res.status(409).json({
          success: false,
          error: 'TARIFF_CODE_EXISTS',
          message: 'That tariff code already exists for this facility.',
        });
      }

      const actorUserId = req.authContext.userId;
      const created = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(schema.facilityServiceTariffs)
          .values({
            tenantId: facility.tenantId,
            facilityId: facility.id,
            code: input.code,
            description: input.description,
            department: input.department,
            unit: input.unit,
            fee: input.fee,
            shaStatus: input.shaStatus,
            shaNotes: input.shaNotes,
            billingKey: input.billingKey,
            effectiveFrom: input.effectiveFrom,
            effectiveTo: input.effectiveTo,
            autoBill: input.autoBill,
            isActive: true,
          })
          .returning();

        await tx.insert(schema.auditLogs).values({
          tenantId: facility.tenantId,
          facilityId: facility.id,
          userId: String(actorUserId),
          action: 'CREATE',
          resource: 'FACILITY_SERVICE_TARIFF',
          resourceId: String(created.id),
          details: JSON.stringify({
            code: created.code,
            department: created.department,
            unit: created.unit,
            fee: created.fee,
            billingKey: created.billingKey,
            effectiveFrom: created.effectiveFrom,
            effectiveTo: created.effectiveTo,
            autoBill: created.autoBill,
          }),
        });
        return created;
      });

      return res.status(201).json(created);
    } catch (error: unknown) {
      if (sendTariffWriteError(error, res)) return;

      console.error('Failed to create service tariff; transaction rolled back.');
      return res.status(500).json({
        success: false,
        error: 'SERVICE_TARIFF_CREATE_FAILED',
        message: 'Failed to create service tariff.',
      });
    }
  },
);

router.put(
  '/api/service-tariffs/:id',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;

      const tariffId = Number(req.params.id);
      if (!Number.isSafeInteger(tariffId) || tariffId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_TARIFF_ID',
          message: 'A valid tariff ID is required.',
        });
      }

      const input = validateTariffInput(req.body);
      if (!input) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_SERVICE_TARIFF',
          message: 'Provide valid tariff details.',
        });
      }

      if (!facilityHasTariffModule(facility, input.moduleId)) {
        return res.status(400).json({
          success: false,
          error: 'TARIFF_DEPARTMENT_MODULE_DISABLED',
          message: 'Enable the selected department module before assigning its tariff.',
        });
      }

      const [existing] = await db
        .select()
        .from(schema.facilityServiceTariffs)
        .where(
          and(
            eq(schema.facilityServiceTariffs.id, tariffId),
            eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
            eq(schema.facilityServiceTariffs.facilityId, facility.id),
          ),
        )
        .limit(1);

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: 'TARIFF_NOT_FOUND',
          message: 'The tariff was not found in this facility.',
        });
      }

      const [duplicate] = await db
        .select({ id: schema.facilityServiceTariffs.id })
        .from(schema.facilityServiceTariffs)
        .where(
          and(
            eq(schema.facilityServiceTariffs.facilityId, facility.id),
            eq(schema.facilityServiceTariffs.code, input.code),
          ),
        )
        .limit(1);

      if (duplicate && duplicate.id !== tariffId) {
        return res.status(409).json({
          success: false,
          error: 'TARIFF_CODE_EXISTS',
          message: 'That tariff code already exists for this facility.',
        });
      }

      const actorUserId = req.authContext.userId;
      const updated = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(schema.facilityServiceTariffs)
          .where(
            and(
              eq(schema.facilityServiceTariffs.id, tariffId),
              eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
              eq(schema.facilityServiceTariffs.facilityId, facility.id),
            ),
          )
          .for('update');
        if (!locked) throw new Error('Tariff was unavailable during update');
        const [updated] = await tx
          .update(schema.facilityServiceTariffs)
          .set({
            code: input.code,
            description: input.description,
            department: input.department,
            unit: input.unit,
            fee: input.fee,
            shaStatus: input.shaStatus,
            shaNotes: input.shaNotes,
            billingKey: input.billingKey,
            effectiveFrom: input.effectiveFrom,
            effectiveTo: input.effectiveTo,
            autoBill: input.autoBill,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.facilityServiceTariffs.id, tariffId),
              eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
              eq(schema.facilityServiceTariffs.facilityId, facility.id),
            ),
          )
          .returning();

        await tx.insert(schema.auditLogs).values({
          tenantId: facility.tenantId,
          facilityId: facility.id,
          userId: String(actorUserId),
          action: 'UPDATE',
          resource: 'FACILITY_SERVICE_TARIFF',
          resourceId: String(updated.id),
          details: JSON.stringify({
            before: {
              code: locked.code,
              department: locked.department,
              unit: locked.unit,
              fee: locked.fee,
              billingKey: locked.billingKey,
              effectiveFrom: locked.effectiveFrom,
              effectiveTo: locked.effectiveTo,
              autoBill: locked.autoBill,
            },
            after: {
              code: updated.code,
              department: updated.department,
              unit: updated.unit,
              fee: updated.fee,
              billingKey: updated.billingKey,
              effectiveFrom: updated.effectiveFrom,
              effectiveTo: updated.effectiveTo,
              autoBill: updated.autoBill,
            },
          }),
        });
        return updated;
      });

      return res.json(updated);
    } catch (error: unknown) {
      if (sendTariffWriteError(error, res)) return;

      console.error('Failed to update service tariff; transaction rolled back.');
      return res.status(500).json({
        success: false,
        error: 'SERVICE_TARIFF_UPDATE_FAILED',
        message: 'Failed to update service tariff.',
      });
    }
  },
);

router.patch(
  '/api/service-tariffs/:id/deactivate',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(
        req,
        res,
        req.body?.facilityId ?? req.query.facilityId,
      );
      if (!facility || !req.authContext) return;

      const tariffId = Number(req.params.id);
      if (!Number.isSafeInteger(tariffId) || tariffId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_TARIFF_ID',
          message: 'A valid tariff ID is required.',
        });
      }

      const actorUserId = req.authContext.userId;
      const updated = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(schema.facilityServiceTariffs)
          .set({ isActive: false, updatedAt: new Date() })
          .where(
            and(
              eq(schema.facilityServiceTariffs.id, tariffId),
              eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
              eq(schema.facilityServiceTariffs.facilityId, facility.id),
              eq(schema.facilityServiceTariffs.isActive, true),
            ),
          )
          .returning();

        if (!updated) return null;
        await tx.insert(schema.auditLogs).values({
          tenantId: facility.tenantId,
          facilityId: facility.id,
          userId: String(actorUserId),
          action: 'DEACTIVATE',
          resource: 'FACILITY_SERVICE_TARIFF',
          resourceId: String(updated.id),
          details: JSON.stringify({ code: updated.code, department: updated.department }),
        });
        return updated;
      });
      if (!updated) {
        return res.status(404).json({
          success: false,
          error: 'ACTIVE_TARIFF_NOT_FOUND',
          message: 'No active tariff with that ID exists in this facility.',
        });
      }

      return res.json(updated);
    } catch (error: unknown) {
      console.error('Failed to deactivate service tariff; transaction rolled back.');
      return res.status(500).json({
        success: false,
        error: 'SERVICE_TARIFF_DEACTIVATE_FAILED',
        message: 'Failed to deactivate service tariff.',
      });
    }
  },
);

export default router;
