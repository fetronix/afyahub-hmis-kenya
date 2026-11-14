import { Router, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requireAnyPermission, requirePermission } from '../auth/authorization.middleware.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import * as queries from '../db/queries.ts';
import { handleScopeError } from './shared/errors.ts';
import { listClinicalCatalogue } from '../billing/clinical-catalogue.service.ts';
import {
  addReviewedSpecimen,
  listReviewedSpecimens,
  retireReviewedSpecimen,
} from '../billing/lab-specimen-config.service.ts';
import { requireFacilityAdminTariffRole, resolveTariffFacility } from './shared/tariffs.ts';
import {
  approveMasterTariff,
  approveMasterAlias,
  retireMasterAlias,
  setMasterSourceMapping,
  listMasterMappings,
  attachLegacyTariff,
  createImagingService,
  editMasterTariffs,
  listMasterCatalogue,
  MasterCatalogueError,
  syncMasterCatalogue,
  tariffHistory,
} from '../billing/master-catalogue.service.ts';

const router = Router();
function failure(res: Response, error: unknown) {
  if (error instanceof MasterCatalogueError)
    return res.status(error.status).json({ error: error.code, message: error.message });
  if (handleScopeError(error, res)) return;
  console.error('Master tariff operation failed; no partial changes were committed.');
  return res.status(500).json({
    error: 'MASTER_TARIFF_FAILED',
    message: 'The operation could not be completed. Review configuration and try again.',
  });
}

router.get(
  '/api/master-tariffs',
  requirePermission('tariffs.read'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.query.facilityId);
      if (!facility) return;
      return res.json(await listMasterCatalogue(facility));
    } catch (error) {
      return failure(res, error);
    }
  },
);
router.post(
  '/api/master-tariffs/sync',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;
      return res.json(await syncMasterCatalogue(facility, req.authContext.userId));
    } catch (error) {
      return failure(res, error);
    }
  },
);
router.post(
  '/api/master-tariffs/imaging-services',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;
      return res
        .status(201)
        .json(await createImagingService(facility, req.authContext.userId, req.body));
    } catch (error) {
      return failure(res, error);
    }
  },
);
router.put(
  '/api/master-tariffs/batch',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;
      return res.json(await editMasterTariffs(facility, req.authContext.userId, req.body?.rows));
    } catch (error) {
      return failure(res, error);
    }
  },
);
router.post(
  '/api/master-tariffs/:id/approve',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;
      return res.json(
        await approveMasterTariff(
          facility,
          req.authContext.userId,
          req.params.id,
          req.body?.revision,
          req.body?.approvalReference,
        ),
      );
    } catch (error) {
      return failure(res, error);
    }
  },
);
router.post(
  '/api/master-tariffs/:masterId/link-existing',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;
      return res.json(
        await attachLegacyTariff(
          facility,
          req.authContext.userId,
          req.params.masterId,
          req.body?.tariffId,
          req.body?.revision,
        ),
      );
    } catch (error) {
      return failure(res, error);
    }
  },
);
router.get(
  '/api/master-tariffs/:id/history',
  requirePermission('tariffs.read'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.query.facilityId);
      if (!facility) return;
      return res.json(await tariffHistory(facility, req.params.id));
    } catch (error) {
      return failure(res, error);
    }
  },
);

router.get(
  '/api/master-tariffs/:masterId/mappings',
  requirePermission('tariffs.read'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.query.facilityId);
      if (!facility) return;
      return res.json(await listMasterMappings(facility, req.params.masterId));
    } catch (error) {
      return failure(res, error);
    }
  },
);
router.post(
  '/api/master-tariffs/:masterId/source-mapping',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;
      return res.json(
        await setMasterSourceMapping(
          facility,
          req.authContext.userId,
          req.params.masterId,
          req.body,
        ),
      );
    } catch (error) {
      return failure(res, error);
    }
  },
);
router.post(
  '/api/master-tariffs/:masterId/aliases',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;
      return res
        .status(201)
        .json(
          await approveMasterAlias(facility, req.authContext.userId, req.params.masterId, req.body),
        );
    } catch (error) {
      return failure(res, error);
    }
  },
);
router.post(
  '/api/master-tariff-aliases/:id/retire',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;
      return res.json(
        await retireMasterAlias(
          facility,
          req.authContext.userId,
          req.params.id,
          req.body?.reviewReference,
        ),
      );
    } catch (error) {
      return failure(res, error);
    }
  },
);
router.get(
  '/api/master-tariff-sources',
  requirePermission('tariffs.read'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.query.facilityId);
      if (!facility) return;
      const labs = await db
        .select({ id: schema.labTests.id, code: schema.labTests.code, name: schema.labTests.name })
        .from(schema.labTests)
        .where(eq(schema.labTests.facilityId, facility.id));
      const items = await db
        .select({
          id: schema.inventoryItems.id,
          code: schema.inventoryItems.itemCode,
          name: schema.inventoryItems.name,
        })
        .from(schema.inventoryItems)
        .where(eq(schema.inventoryItems.facilityId, facility.id));
      const wards = await db
        .select({ id: schema.wards.id, code: schema.wards.code, name: schema.wards.name })
        .from(schema.wards)
        .where(eq(schema.wards.facilityId, facility.id));
      return res.json({ LAB_TEST: labs, PHARMACY: items, BED_DAY: wards });
    } catch (error) {
      return failure(res, error);
    }
  },
);

// Specimen choices are recorded only with an external clinical review reference.
router.get(
  '/api/master-lab-specimens',
  requirePermission('tariffs.read'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.query.facilityId);
      if (!facility) return;
      return res.json(await listReviewedSpecimens(facility));
    } catch (error) {
      return failure(res, error);
    }
  },
);
router.post(
  '/api/master-lab-specimens',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;
      return res
        .status(201)
        .json(await addReviewedSpecimen(facility, req.authContext.userId, req.body));
    } catch (error) {
      return failure(res, error);
    }
  },
);
router.post(
  '/api/master-lab-specimens/:id/retire',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;
      return res.json(
        await retireReviewedSpecimen(
          facility,
          req.authContext.userId,
          Number(req.params.id),
          req.body?.reviewReference,
        ),
      );
    } catch (error) {
      return failure(res, error);
    }
  },
);

/** Facility-scoped indicative prices; completion always revalidates the tariff. */
router.get(
  '/api/master-services',
  requireAnyPermission('clinical.read', 'laboratory.read', 'billing.read', 'tariffs.read'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) return res.status(401).json({ error: 'AUTHORIZATION_CONTEXT_MISSING' });
      const requested = Number(req.query.facilityId);
      if (!Number.isSafeInteger(requested) || requested <= 0)
        return res.status(400).json({ error: 'INVALID_FACILITY_ID' });
      const id = resolveFacilityScope(req.authContext, requested);
      const facility = await queries.getFacilityByIdScoped(req.authContext, id);
      if (!facility) return res.status(404).json({ error: 'FACILITY_NOT_FOUND' });
      const family = typeof req.query.family === 'string' ? req.query.family.toUpperCase() : '';
      if (family !== 'RADIOLOGY' && family !== 'LABORATORY' && family !== 'CONSULTATION')
        return res.status(400).json({ error: 'INVALID_SERVICE_FAMILY' });
      return res.json(await listClinicalCatalogue(facility, family));
    } catch (error) {
      return failure(res, error);
    }
  },
);
export default router;
