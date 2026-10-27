/**
 * Facility service-tariff links.
 *
 * Moved out of `createApp` unchanged: same paths, same handlers, same
 * permissions, same order. `src/routes/index.ts` mounts this router after the
 * facility-module gates, which is exactly where these routes sat when they
 * were registered inline in `app.ts`.
 */

import { Router, type Response } from 'express';
import type { AuthRequest } from '../../auth/auth.middleware.ts';
import { CATALOGUE_SERVICE_TYPES, isCatalogueServiceType } from '../../billing/tariff-resolver.ts';
import { and, count, eq, sql, sum } from 'drizzle-orm';
import * as billing from '../../billing/billing.service.ts';
import { db } from '../../db/index.ts';
import {
  handleClaimError,
  handleDhaError,
  handleEncounterValidationError,
  handleInpatientError,
  handleInventoryError,
  handlePaymentError,
  handleScopeError,
  respondInternalError,
} from '../../routes/shared/errors.ts';
import * as queries from '../../db/queries.ts';
import {
  facilityHasTariffModule,
  requireFacilityAdminTariffRole,
  resolveTariffFacility,
  sendTariffWriteError,
  tariffModuleForDepartment,
  validateTariffInput,
} from '../../routes/shared/tariffs.ts';
import {
  requireAuthorization,
  requirePermission,
  requireAnyPermission,
  requireSuperAdmin,
} from '../../auth/authorization.middleware.ts';
import * as schema from '../../db/schema.ts';

const router = Router();

// =========================================================
// SERVICE → TARIFF LINKS
// =========================================================
//
// The explicit relationship the billing engine prefers: a catalogue
// record, by database id, priced by a tariff row of the same facility
// (migration 0021). Legacy keys (`billing_key`, 0019) still resolve,
// but a link cannot be ambiguous and can be validated field by field.

/** Every link this facility has made, with the tariff it points at. */

router.get(
  '/api/service-tariff-links',
  requirePermission('tariffs.read'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;

    try {
      const facility = await resolveTariffFacility(req, res, req.query.facilityId);
      if (!facility) return;

      const rows = await db
        .select({
          id: schema.serviceTariffLinks.id,
          serviceType: schema.serviceTariffLinks.serviceType,
          serviceId: schema.serviceTariffLinks.serviceId,
          serviceCode: schema.serviceTariffLinks.serviceCode,
          serviceName: schema.serviceTariffLinks.serviceName,
          tariffId: schema.serviceTariffLinks.tariffId,
          autoBill: schema.serviceTariffLinks.autoBill,
          isActive: schema.serviceTariffLinks.isActive,
          note: schema.serviceTariffLinks.note,
          createdAt: schema.serviceTariffLinks.createdAt,
          tariffCode: schema.facilityServiceTariffs.code,
          tariffDescription: schema.facilityServiceTariffs.description,
          tariffFee: schema.facilityServiceTariffs.fee,
          tariffUnit: schema.facilityServiceTariffs.unit,
          tariffActive: schema.facilityServiceTariffs.isActive,
          tariffAutoBill: schema.facilityServiceTariffs.autoBill,
          tariffEffectiveFrom: schema.facilityServiceTariffs.effectiveFrom,
          tariffEffectiveTo: schema.facilityServiceTariffs.effectiveTo,
        })
        .from(schema.serviceTariffLinks)
        .innerJoin(
          schema.facilityServiceTariffs,
          eq(schema.facilityServiceTariffs.id, schema.serviceTariffLinks.tariffId),
        )
        .where(
          and(
            eq(schema.serviceTariffLinks.tenantId, facility.tenantId),
            eq(schema.serviceTariffLinks.facilityId, facility.id),
          ),
        );

      return res.json(rows);
    } catch (error: unknown) {
      if (sendTariffWriteError(error, res)) return;

      console.error('Service tariff link list error:', error);
      return res.status(500).json({
        success: false,
        error: 'SERVICE_TARIFF_LINKS_FETCH_FAILED',
      });
    }
  },
);

/**
 * Link a catalogue service to this facility's tariff.
 *
 * Re-linking replaces the active link rather than stacking a second
 * one, and the old row stays with `is_active = false` so the history
 * of what priced what is not erased.
 */

router.post(
  '/api/service-tariff-links',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;

    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;

      const serviceType =
        typeof req.body?.serviceType === 'string' ? req.body.serviceType.trim().toUpperCase() : '';
      const tariffId = Number(req.body?.tariffId);
      const rawServiceId = req.body?.serviceId;
      const serviceId =
        rawServiceId === undefined || rawServiceId === null || rawServiceId === ''
          ? null
          : Number(rawServiceId);

      if (!isCatalogueServiceType(serviceType)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_SERVICE_TYPE',
          message: `serviceType must be one of ${CATALOGUE_SERVICE_TYPES.join(', ')}.`,
        });
      }

      if (serviceId !== null && (!Number.isSafeInteger(serviceId) || serviceId <= 0)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_SERVICE_ID',
        });
      }

      if (!Number.isSafeInteger(tariffId) || tariffId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_TARIFF_ID',
        });
      }

      /* The tariff must be this facility's — the database enforces it
       * too, but a 400 says which field is wrong. */
      const [tariff] = await db
        .select({
          id: schema.facilityServiceTariffs.id,
          code: schema.facilityServiceTariffs.code,
          isActive: schema.facilityServiceTariffs.isActive,
        })
        .from(schema.facilityServiceTariffs)
        .where(
          and(
            eq(schema.facilityServiceTariffs.id, tariffId),
            eq(schema.facilityServiceTariffs.facilityId, facility.id),
          ),
        )
        .limit(1);

      if (!tariff) {
        return res.status(404).json({
          success: false,
          error: 'TARIFF_NOT_FOUND',
          message: 'That tariff does not belong to this facility.',
        });
      }

      /*
       * A catalogue id must be a real, active row of this facility —
       * otherwise a typo would create a link to nothing that never
       * fires, which is the silent failure this table exists to end.
       */
      let serviceCode: string | null =
        typeof req.body?.serviceCode === 'string' ? req.body.serviceCode.trim() || null : null;
      let serviceName: string | null =
        typeof req.body?.serviceName === 'string' ? req.body.serviceName.trim() || null : null;

      /*
       * A bed-day link names a ward, so "General ward → IP-002" prices
       * that ward and leaves the ICU to its own row. The ward must be
       * this facility's, or the link would never fire.
       */
      if (serviceType === 'BED_DAY' && serviceId !== null) {
        const [ward] = await db
          .select({
            id: schema.wards.id,
            code: schema.wards.code,
            name: schema.wards.name,
          })
          .from(schema.wards)
          .where(and(eq(schema.wards.id, serviceId), eq(schema.wards.facilityId, facility.id)))
          .limit(1);

        if (!ward) {
          return res.status(404).json({
            success: false,
            error: 'CATALOGUE_SERVICE_NOT_FOUND',
            message: 'That ward does not belong to this facility.',
          });
        }

        serviceCode = ward.code ?? serviceCode;
        serviceName = ward.name ?? serviceName;
      }

      if (serviceType === 'LAB_TEST' && serviceId !== null) {
        const [test] = await db
          .select({
            id: schema.labTests.id,
            code: schema.labTests.code,
            name: schema.labTests.name,
            isActive: schema.labTests.isActive,
          })
          .from(schema.labTests)
          .where(
            and(eq(schema.labTests.id, serviceId), eq(schema.labTests.facilityId, facility.id)),
          )
          .limit(1);

        if (!test) {
          return res.status(404).json({
            success: false,
            error: 'CATALOGUE_SERVICE_NOT_FOUND',
            message: 'That laboratory test does not belong to this facility.',
          });
        }

        serviceCode = test.code ?? serviceCode;
        serviceName = test.name ?? serviceName;
      }

      const autoBill = req.body?.autoBill === undefined ? true : req.body.autoBill === true;

      const retired = await db
        .update(schema.serviceTariffLinks)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(schema.serviceTariffLinks.tenantId, facility.tenantId),
            eq(schema.serviceTariffLinks.facilityId, facility.id),
            eq(schema.serviceTariffLinks.serviceType, serviceType),
            serviceId === null
              ? sql`${schema.serviceTariffLinks.serviceId} is null`
              : eq(schema.serviceTariffLinks.serviceId, serviceId),
            eq(schema.serviceTariffLinks.isActive, true),
          ),
        )
        .returning({ id: schema.serviceTariffLinks.id });

      const [created] = await db
        .insert(schema.serviceTariffLinks)
        .values({
          tenantId: facility.tenantId,
          facilityId: facility.id,
          serviceType,
          serviceId,
          serviceCode,
          serviceName,
          tariffId,
          autoBill,
          note:
            typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) || null : null,
          createdBy: String(req.authContext.userId),
          isActive: true,
        })
        .returning();

      await queries.logAuditEvent(
        facility.tenantId,
        facility.id,
        String(req.authContext.userId),
        'CREATE',
        'SERVICE_TARIFF_LINK',
        String(created.id),
        `${serviceType}${serviceId === null ? ' (all)' : ` #${serviceId}`} linked to tariff ${tariff.code}${autoBill ? '' : ' (automatic billing off)'}.`,
      );

      return res.status(201).json({
        ...created,
        replacedLinks: retired.map((row) => row.id),
      });
    } catch (error: unknown) {
      if (handleScopeError(error, res)) return;
      if (sendTariffWriteError(error, res)) return;

      console.error('Service tariff link error:', error);
      return res.status(500).json({
        success: false,
        error: 'SERVICE_TARIFF_LINK_FAILED',
      });
    }
  },
);

/** Retire a link. The row is kept so the audit trail survives. */

router.patch(
  '/api/service-tariff-links/:id/deactivate',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;

    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;

      const linkId = Number(req.params.id);

      if (!Number.isSafeInteger(linkId) || linkId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_LINK_ID',
        });
      }

      const [updated] = await db
        .update(schema.serviceTariffLinks)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(schema.serviceTariffLinks.id, linkId),
            eq(schema.serviceTariffLinks.tenantId, facility.tenantId),
            eq(schema.serviceTariffLinks.facilityId, facility.id),
          ),
        )
        .returning();

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: 'SERVICE_TARIFF_LINK_NOT_FOUND',
        });
      }

      await queries.logAuditEvent(
        facility.tenantId,
        facility.id,
        String(req.authContext.userId),
        'UPDATE',
        'SERVICE_TARIFF_LINK',
        String(linkId),
        'Service-to-tariff link retired.',
      );

      return res.json(updated);
    } catch (error: unknown) {
      if (handleScopeError(error, res)) return;
      if (sendTariffWriteError(error, res)) return;

      console.error('Service tariff link deactivate error:', error);
      return res.status(500).json({
        success: false,
        error: 'SERVICE_TARIFF_LINK_DEACTIVATE_FAILED',
      });
    }
  },
);

export default router;
