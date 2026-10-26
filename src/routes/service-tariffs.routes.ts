/**
 * The facility service tariffs routes.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions. `src/routes/index.ts` mounts this router on the API router.
 */

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requirePermission } from '../auth/authorization.middleware.ts';
import { db } from '../db/index.ts';
import * as queries from '../db/queries.ts';
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

      const [created] = await db
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

      await queries.logAuditEvent(
        facility.tenantId,
        facility.id,
        String(req.authContext.userId),
        'CREATE',
        'FACILITY_SERVICE_TARIFF',
        String(created.id),
        `Created tariff ${created.code} for department ${created.department}.`,
      );

      return res.status(201).json(created);
    } catch (error: unknown) {
      if (sendTariffWriteError(error, res)) return;

      console.error('Failed to create service tariff:', error);
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

      const [updated] = await db
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

      await queries.logAuditEvent(
        facility.tenantId,
        facility.id,
        String(req.authContext.userId),
        'UPDATE',
        'FACILITY_SERVICE_TARIFF',
        String(updated.id),
        `Updated tariff ${updated.code}. Existing invoice item snapshots are unchanged.`,
      );

      return res.json(updated);
    } catch (error: unknown) {
      if (sendTariffWriteError(error, res)) return;

      console.error('Failed to update service tariff:', error);
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

      const [updated] = await db
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

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: 'ACTIVE_TARIFF_NOT_FOUND',
          message: 'No active tariff with that ID exists in this facility.',
        });
      }

      await queries.logAuditEvent(
        facility.tenantId,
        facility.id,
        String(req.authContext.userId),
        'DEACTIVATE',
        'FACILITY_SERVICE_TARIFF',
        String(updated.id),
        `Deactivated tariff ${updated.code}. Existing invoice item snapshots are unchanged.`,
      );

      return res.json(updated);
    } catch (error: unknown) {
      console.error('Failed to deactivate service tariff:', error);
      return res.status(500).json({
        success: false,
        error: 'SERVICE_TARIFF_DEACTIVATE_FAILED',
        message: 'Failed to deactivate service tariff.',
      });
    }
  },
);

export default router;
