import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';

import { resolveLocation } from '../../constants/kenya-locations.ts';
import {
  resolveFacilityModules,
  resolveHiddenFacilityModules,
  unknownFacilityModules,
} from '../../config/facility-modules.ts';
import { db } from '../../db/index.ts';
import * as queries from '../../db/queries.ts';
import * as schema from '../../db/schema.ts';
import {
  createFacilitySchema,
  facilityIdParamSchema,
  updateFacilitySchema,
  type CreateFacilityValidated,
  type UpdateFacilityValidated,
} from '../../validation/schemas/index.ts';
import {
  getValidatedBody,
  getValidatedParams,
  validateBody,
  validateParams,
} from '../../validation/validate.ts';
import {
  auditActor,
  getContext,
  handleError,
  requireSuperAdminMiddleware,
  textValue,
} from './shared.ts';

const router = Router();

/**
 * POST /api/platform/facilities
 * Create a facility and its initial onboarding record atomically.
 */
router.post(
  '/facilities',
  requireSuperAdminMiddleware,
  validateBody(createFacilitySchema),
  async (req: Request, res: Response) => {
    const context = getContext(req)!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { tenantId, code, name, level, mflCode, address, phone, email } =
      getValidatedBody<CreateFacilityValidated>(req);

    const location = resolveLocation(textValue(body.county), textValue(body.subCounty));
    if (!location.ok) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: location.message,
      });
      return;
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [tenant] = await tx
          .select({
            id: schema.tenants.id,
            isActive: schema.tenants.isActive,
          })
          .from(schema.tenants)
          .where(eq(schema.tenants.id, tenantId))
          .limit(1);

        if (!tenant) {
          const error = new Error('TENANT_NOT_FOUND');
          error.name = 'TenantNotFoundError';
          throw error;
        }

        if (tenant.isActive === false) {
          const error = new Error('TENANT_INACTIVE');
          error.name = 'TenantInactiveError';
          throw error;
        }

        const [facility] = await tx
          .insert(schema.facilities)
          .values({
            tenantId,
            code,
            name,
            ...(level ? { level } : {}),
            ...(location.county ? { county: location.county, subCounty: location.subCounty } : {}),
            ...(mflCode ? { mflCode } : {}),
            ...(address ? { address } : {}),
            ...(phone ? { phone } : {}),
            ...(email ? { email } : {}),
          })
          .returning();

        const [onboarding] = await tx
          .insert(schema.facilityOnboarding)
          .values({
            tenantId,
            facilityId: facility.id,
            status: 'PROSPECT',
            notes: 'Initial onboarding record created by platform administrator.',
          })
          .returning();

        return { facility, onboarding };
      });

      await queries.logAuditEvent(
        tenantId,
        result.facility.id,
        auditActor(context),
        'CREATE',
        'FACILITY',
        String(result.facility.id),
        `Created facility "${result.facility.name}" (${result.facility.code}) with onboarding status PROSPECT.`,
      );

      res.status(201).json({ data: result });
    } catch (error) {
      const err = error as Error & {
        code?: string;
        cause?: { code?: string };
      };

      if (err.name === 'TenantNotFoundError') {
        res.status(404).json({
          error: 'TENANT_NOT_FOUND',
          message: 'The selected tenant does not exist.',
        });
        return;
      }

      if (err.name === 'TenantInactiveError') {
        res.status(409).json({
          error: 'TENANT_INACTIVE',
          message: 'Facilities cannot be added to an inactive tenant.',
        });
        return;
      }

      handleError(res, error);
    }
  },
);

/**
 * GET /api/platform/facilities/:id/onboarding
 * Retrieve the existing onboarding record for a facility.
 */
router.get(
  '/facilities/:id/onboarding',
  requireSuperAdminMiddleware,
  validateParams(facilityIdParamSchema),
  async (req: Request, res: Response) => {
    const { id: facilityId } = getValidatedParams<{ id: number }>(req);

    try {
      const [facility] = await db
        .select({
          id: schema.facilities.id,
          tenantId: schema.facilities.tenantId,
          name: schema.facilities.name,
        })
        .from(schema.facilities)
        .where(eq(schema.facilities.id, facilityId))
        .limit(1);

      if (!facility) {
        res.status(404).json({
          error: 'NOT_FOUND',
          message: 'Facility not found.',
        });
        return;
      }

      const [onboarding] = await db
        .select()
        .from(schema.facilityOnboarding)
        .where(eq(schema.facilityOnboarding.facilityId, facilityId))
        .limit(1);

      if (!onboarding) {
        res.status(404).json({
          error: 'ONBOARDING_NOT_FOUND',
          message: 'No onboarding record exists for this facility.',
        });
        return;
      }

      res.status(200).json({
        data: {
          facility,
          onboarding,
        },
      });
    } catch (error) {
      handleError(res, error);
    }
  },
);

/**
 * PATCH /api/platform/facilities/:id
 * Update facility configuration without permitting tenant reassignment.
 */
router.patch(
  '/facilities/:id',
  requireSuperAdminMiddleware,
  validateParams(facilityIdParamSchema),
  validateBody(updateFacilitySchema, { fallbackMessage: 'No valid fields supplied to update.' }),
  async (req: Request, res: Response) => {
    const context = getContext(req)!;
    const { id: facilityId } = getValidatedParams<{ id: number }>(req);
    const parsedUpdates = getValidatedBody<UpdateFacilityValidated>(req);

    const updates: Partial<typeof schema.facilities.$inferInsert> = {
      ...parsedUpdates,
      updatedAt: new Date(),
    };
    const unknown = unknownFacilityModules([
      ...(parsedUpdates.enabledModules ?? []),
      ...(parsedUpdates.hiddenModules ?? []),
    ]);
    if (unknown.length) {
      res.status(400).json({
        error: 'UNKNOWN_MODULE',
        message: 'The module list contains unknown module IDs.',
        modules: unknown,
      });
      return;
    }
    if (parsedUpdates.enabledModules)
      updates.enabledModules = resolveFacilityModules(parsedUpdates.enabledModules);
    if (parsedUpdates.hiddenModules)
      updates.hiddenModules = resolveHiddenFacilityModules(parsedUpdates.hiddenModules);

    try {
      const facility = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(schema.facilities)
          .set(updates)
          .where(eq(schema.facilities.id, facilityId))
          .returning();
        if (!updated) return null;
        await tx.insert(schema.auditLogs).values({
          tenantId: updated.tenantId,
          facilityId: updated.id,
          userId: auditActor(context),
          action: 'UPDATE',
          resource: 'FACILITY',
          resourceId: String(updated.id),
          details: JSON.stringify({
            fields: Object.keys(updates).filter((key) => key !== 'updatedAt'),
            enabledModules: parsedUpdates.enabledModules ? updated.enabledModules : undefined,
            hiddenModules: parsedUpdates.hiddenModules ? updated.hiddenModules : undefined,
          }),
        });
        return updated;
      });

      if (!facility) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Facility not found.' });
        return;
      }

      res.json({ data: facility });
    } catch (error) {
      handleError(res, error);
    }
  },
);

/**
 * POST /api/platform/facilities/:id/onboarding
 * Create onboarding only when no record exists.
 */
router.post(
  '/facilities/:id/onboarding',
  requireSuperAdminMiddleware,
  validateParams(facilityIdParamSchema),
  async (req: Request, res: Response) => {
    const context = getContext(req)!;
    const { id: facilityId } = getValidatedParams<{ id: number }>(req);

    try {
      const result = await db.transaction(async (tx) => {
        const [facility] = await tx
          .select({
            id: schema.facilities.id,
            tenantId: schema.facilities.tenantId,
            name: schema.facilities.name,
          })
          .from(schema.facilities)
          .where(eq(schema.facilities.id, facilityId))
          .limit(1);

        if (!facility) {
          return { missingFacility: true as const };
        }

        const [existing] = await tx
          .select({
            id: schema.facilityOnboarding.id,
          })
          .from(schema.facilityOnboarding)
          .where(eq(schema.facilityOnboarding.facilityId, facilityId))
          .limit(1);

        if (existing) {
          return { alreadyExists: true as const };
        }

        const [onboarding] = await tx
          .insert(schema.facilityOnboarding)
          .values({
            tenantId: facility.tenantId,
            facilityId: facility.id,
            status: 'PROSPECT',
            notes: 'Initial onboarding record created by platform administrator.',
          })
          .returning();

        return { facility, onboarding };
      });

      if ('missingFacility' in result) {
        res.status(404).json({
          error: 'NOT_FOUND',
          message: 'Facility not found.',
        });
        return;
      }

      if ('alreadyExists' in result) {
        res.status(409).json({
          error: 'ONBOARDING_EXISTS',
          message: 'This facility already has an onboarding record.',
        });
        return;
      }

      await queries.logAuditEvent(
        result.facility.tenantId,
        result.facility.id,
        auditActor(context),
        'CREATE',
        'FACILITY_ONBOARDING',
        String(result.onboarding.id),
        `Created onboarding record for facility "${result.facility.name}".`,
      );

      res.status(201).json({ data: result.onboarding });
    } catch (error) {
      handleError(res, error);
    }
  },
);

export default router;
