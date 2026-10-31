import { Router, type Response } from 'express';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthRequest } from '../auth/auth.middleware.ts';
import { requireAnyPermission, requirePermission } from '../auth/authorization.middleware.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import * as queries from '../db/queries.ts';
import { dateVerdict } from '../billing/tariff-resolver.ts';
import {
  hasProtectedReferences,
  hasCodeBasedClinicalHistory,
  type FacilityDeleteTransaction,
} from '../billing/facility-delete-safety.ts';
import { calendarDateInZone, validTimezone } from '../dashboard/timezone.ts';
import { parseMoneyToCents } from '../billing/settlement.ts';
import { handleScopeError } from './shared/errors.ts';
import {
  facilityHasTariffModule,
  requireFacilityAdminTariffRole,
  resolveTariffFacility,
  tariffModuleForDepartment,
} from './shared/tariffs.ts';

const router = Router();
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._/-]{0,49}$/);
const money = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine((value) => /^\d{1,8}(\.\d{1,2})?$/.test(value));
const day = z
  .union([
    z.string().refine((value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }),
    z.null(),
  ])
  .optional();
const categories = z.enum([
  'CONSULTATION',
  'LABORATORY',
  'RADIOLOGY',
  'PHARMACY',
  'PROCEDURE',
  'ADMISSION',
  'BED_DAY',
  'DELIVERY',
  'OTHER',
]);
const serviceInput = z.object({
  code,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(500),
  department: z.string().trim().min(1).max(100),
  category: categories,
  unit: z.string().trim().min(1).max(50),
  isActive: z.boolean(),
  autoBill: z.boolean(),
});
const createServiceInput = serviceInput.extend({
  initialPrice: money,
  initialTariffCode: code.optional(),
});
const tariffInput = z
  .object({
    serviceId: z.number().int().positive(),
    code,
    description: z.string().trim().min(1).max(500),
    department: z.string().trim().min(1).max(100),
    unit: z.string().trim().min(1).max(50),
    fee: money,
    effectiveFrom: day,
    effectiveTo: day,
    isActive: z.boolean(),
    autoBill: z.boolean(),
  })
  .refine(
    (x) => !x.effectiveFrom || !x.effectiveTo || x.effectiveFrom <= x.effectiveTo,
    'Invalid effective dates.',
  );

type Facility = { id: number; tenantId: number; enabledModules: unknown; timezone?: string | null };
class FacilityServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
function failure(res: Response, error: unknown) {
  if (error instanceof FacilityServiceError)
    return res.status(error.status).json({ error: error.code, message: error.message });
  if (handleScopeError(error, res)) return;
  const pgCode =
    (error as { code?: string; cause?: { code?: string } } | null)?.code ??
    (error as { cause?: { code?: string } } | null)?.cause?.code;
  if (pgCode === '23505')
    return res.status(409).json({
      error: 'DUPLICATE_OR_ACTIVE_TARIFF',
      message: 'The code already exists or this service already has an active tariff.',
    });
  if (pgCode === '23503' || pgCode === '23514')
    return res.status(400).json({
      error: 'INVALID_FACILITY_SERVICE',
      message: 'The service or tariff does not belong to this facility or has invalid details.',
    });
  console.error('Facility service operation failed; no partial changes were committed.');
  return res
    .status(500)
    .json({ error: 'FACILITY_SERVICE_FAILED', message: 'The operation could not be completed.' });
}
function id(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new FacilityServiceError('INVALID_ID', 'A valid identifier is required.');
  return n;
}
function requireModule(facility: Facility, department: string, category?: string) {
  const module = tariffModuleForDepartment(department);
  if (!module || !facilityHasTariffModule(facility, module))
    throw new FacilityServiceError(
      'DEPARTMENT_UNAVAILABLE',
      'Enable the service department before configuring it.',
    );
  const familyDepartment: Record<string, string> = {
    CONSULTATION: 'opd',
    LABORATORY: 'laboratory',
    RADIOLOGY: 'radiology',
    PHARMACY: 'pharmacy',
    ADMISSION: 'inpatient',
    BED_DAY: 'inpatient',
    // Delivery can be configured under maternity or inpatient at the facility.
    DELIVERY: module === 'maternity' ? 'maternity' : 'inpatient',
  };
  if (category && familyDepartment[category] && familyDepartment[category] !== module)
    throw new FacilityServiceError(
      'CATEGORY_DEPARTMENT_MISMATCH',
      'The category must belong to its clinical department.',
    );
  return module;
}
async function clinicalFacility(req: AuthRequest): Promise<Facility> {
  if (!req.authContext || req.authContext.isSuperAdmin)
    throw new FacilityServiceError(
      'FACILITY_ACCESS_DENIED',
      'An authorized facility user is required.',
      403,
    );
  const facilityId = resolveFacilityScope(req.authContext, id(req.query.facilityId));
  const facility = await queries.getFacilityByIdScoped(req.authContext, facilityId);
  if (!facility) throw new FacilityServiceError('FACILITY_NOT_FOUND', 'Facility not found.', 404);
  return facility;
}
async function audit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  facility: Facility,
  actor: number,
  action: string,
  resource: string,
  resourceId: number,
  details: unknown,
) {
  await tx.insert(schema.auditLogs).values({
    tenantId: facility.tenantId,
    facilityId: facility.id,
    userId: String(actor),
    action,
    resource,
    resourceId: String(resourceId),
    details: JSON.stringify(details),
  });
}

type FacilityTariffRow = typeof schema.facilityServiceTariffs.$inferSelect;

function tariffAuditSnapshot(row: FacilityTariffRow) {
  return {
    code: row.code,
    description: row.description,
    serviceId: row.facilityServiceId,
    fee: row.fee,
    unit: row.unit,
    department: row.department,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    isActive: row.isActive,
    autoBill: row.autoBill,
    archivedAt: row.archivedAt,
  };
}

async function assertTariffsDeletable(tx: FacilityDeleteTransaction, tariffs: FacilityTariffRow[]) {
  if (tariffs.some((row) => row.masterServiceId !== null))
    throw new FacilityServiceError(
      'TARIFF_IN_USE',
      'A historical master-linked tariff must be retained. Archive it instead.',
      409,
    );
  if (
    await hasProtectedReferences(
      tx,
      'facility_service_tariffs',
      tariffs.map((row) => row.id),
    )
  )
    throw new FacilityServiceError(
      'TARIFF_IN_USE',
      'This tariff is linked to billing, payer or other records and must be retained. Archive it instead.',
      409,
    );
}

function deletionFailure(res: Response, error: unknown) {
  const pgCode =
    (error as { code?: string; cause?: { code?: string } } | null)?.code ??
    (error as { cause?: { code?: string } } | null)?.cause?.code;
  if (pgCode === '23503')
    return res.status(409).json({
      error: 'RECORD_IN_USE',
      message:
        'This record is in use and cannot be deleted. Deactivate the service or archive the tariff instead.',
    });
  return failure(res, error);
}

/** Active clinical services remain selectable even without a billable tariff.
 * The actual tariff is revalidated when the clinical event completes. */
router.get(
  '/api/facility-services/available',
  requireAnyPermission(
    'clinical.read',
    'laboratory.read',
    'radiology.read',
    'pharmacy.read',
    'inpatient.read',
    'maternity.read',
    'billing.read',
    'tariffs.read',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const facility = await clinicalFacility(req);
      const department =
        typeof req.query.department === 'string'
          ? tariffModuleForDepartment(req.query.department)
          : null;
      const category =
        typeof req.query.category === 'string' ? req.query.category.toUpperCase() : null;
      if (typeof req.query.department === 'string' && !department)
        throw new FacilityServiceError('INVALID_DEPARTMENT', 'A valid department is required.');
      if (!department && !category)
        throw new FacilityServiceError('FILTER_REQUIRED', 'A department or category is required.');
      if (department && !facilityHasTariffModule(facility, department))
        throw new FacilityServiceError(
          'DEPARTMENT_UNAVAILABLE',
          'This department is not enabled.',
          403,
        );
      if (category && !categories.safeParse(category).success)
        throw new FacilityServiceError('INVALID_CATEGORY', 'A valid category is required.');
      const [zone] = await db
        .select({ timezone: schema.facilities.timezone, tenant: schema.tenants.timezone })
        .from(schema.facilities)
        .innerJoin(schema.tenants, eq(schema.tenants.id, schema.facilities.tenantId))
        .where(
          and(
            eq(schema.facilities.id, facility.id),
            eq(schema.facilities.tenantId, facility.tenantId),
          ),
        )
        .limit(1);
      const timezone = zone?.timezone ?? zone?.tenant;
      const today = validTimezone(timezone) ? calendarDateInZone(timezone) : null;
      const rows = await db
        .select({ service: schema.facilityServices, tariff: schema.facilityServiceTariffs })
        .from(schema.facilityServices)
        .leftJoin(
          schema.facilityServiceTariffs,
          and(
            eq(schema.facilityServiceTariffs.facilityServiceId, schema.facilityServices.id),
            eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
            eq(schema.facilityServiceTariffs.facilityId, facility.id),
            eq(schema.facilityServiceTariffs.isActive, true),
            isNull(schema.facilityServiceTariffs.archivedAt),
          ),
        )
        .where(
          and(
            eq(schema.facilityServices.tenantId, facility.tenantId),
            eq(schema.facilityServices.facilityId, facility.id),
            eq(schema.facilityServices.isActive, true),
            ...(department ? [eq(schema.facilityServices.department, department)] : []),
            ...(category ? [eq(schema.facilityServices.category, category)] : []),
          ),
        )
        .orderBy(asc(schema.facilityServices.name));
      return res.json(
        rows
          .filter(({ service }) => facilityHasTariffModule(facility, service.department))
          .map(({ service, tariff }) => {
            const valid =
              today &&
              tariff &&
              service.autoBill &&
              tariff.autoBill &&
              dateVerdict(tariff.effectiveFrom, tariff.effectiveTo, today) === 'OK' &&
              (parseMoneyToCents(tariff.fee) ?? 0) > 0 &&
              tariff.unit.trim().toLowerCase() === service.unit.trim().toLowerCase();
            return {
              ...service,
              tariffId: tariff?.id ?? null,
              tariffCode: tariff?.code ?? null,
              unitPrice: valid ? tariff!.fee : null,
              priceStatus: !today
                ? 'TIMEZONE_REQUIRED'
                : valid
                  ? 'AVAILABLE'
                  : 'UNCONFIGURED_OR_OUTSIDE_DATE',
            };
          }),
      );
    } catch (error) {
      return failure(res, error);
    }
  },
);

router.get(
  '/api/facility-services',
  requirePermission('tariffs.read'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.query.facilityId);
      if (!facility) return;
      const rows = await db
        .select()
        .from(schema.facilityServices)
        .where(
          and(
            eq(schema.facilityServices.tenantId, facility.tenantId),
            eq(schema.facilityServices.facilityId, facility.id),
          ),
        )
        .orderBy(asc(schema.facilityServices.name));
      return res.json(rows);
    } catch (error) {
      return failure(res, error);
    }
  },
);

router.post(
  '/api/facility-services',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;
      const input = createServiceInput.safeParse(req.body);
      if (!input.success)
        throw new FacilityServiceError(
          'INVALID_SERVICE',
          'Provide a valid service, category, unit, price and status.',
        );
      const data = input.data;
      const department = requireModule(facility, data.department, data.category);
      const actor = req.authContext.userId;
      const created = await db.transaction(async (tx) => {
        const [service] = await tx
          .insert(schema.facilityServices)
          .values({
            tenantId: facility.tenantId,
            facilityId: facility.id,
            code: data.code,
            name: data.name,
            description: data.description,
            department,
            category: data.category,
            unit: data.unit,
            isActive: data.isActive,
            autoBill: data.autoBill,
          })
          .returning();
        const [tariff] = await tx
          .insert(schema.facilityServiceTariffs)
          .values({
            tenantId: facility.tenantId,
            facilityId: facility.id,
            facilityServiceId: service.id,
            code: data.initialTariffCode ?? data.code,
            description: data.description,
            department,
            unit: data.unit,
            fee: data.initialPrice,
            isActive: true,
            autoBill: data.autoBill,
          })
          .returning();
        await audit(tx, facility, actor, 'CREATE', 'FACILITY_SERVICE', service.id, {
          code: service.code,
          department,
          category: service.category,
          initialTariffId: tariff.id,
          fee: tariff.fee,
        });
        await audit(tx, facility, actor, 'CREATE', 'FACILITY_SERVICE_TARIFF', tariff.id, {
          serviceId: service.id,
          code: tariff.code,
          fee: tariff.fee,
        });
        return { service, tariff };
      });
      return res.status(201).json(created);
    } catch (error) {
      return failure(res, error);
    }
  },
);

router.put(
  '/api/facility-services/:id',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;
      const parsed = serviceInput.safeParse(req.body);
      if (!parsed.success)
        throw new FacilityServiceError('INVALID_SERVICE', 'Provide valid service details.');
      const data = parsed.data;
      const department = requireModule(facility, data.department, data.category);
      const serviceId = id(req.params.id),
        actor = req.authContext.userId;
      const updated = await db.transaction(async (tx) => {
        const [old] = await tx
          .select()
          .from(schema.facilityServices)
          .where(
            and(
              eq(schema.facilityServices.id, serviceId),
              eq(schema.facilityServices.tenantId, facility.tenantId),
              eq(schema.facilityServices.facilityId, facility.id),
            ),
          )
          .limit(1)
          .for('update');
        if (!old)
          throw new FacilityServiceError(
            'SERVICE_NOT_FOUND',
            'Service not found in this facility.',
            404,
          );
        if (
          old.code !== data.code ||
          old.department !== department ||
          old.category !== data.category ||
          old.unit !== data.unit
        )
          throw new FacilityServiceError(
            'SERVICE_IDENTITY_IMMUTABLE',
            'Create a new service to change its code, department, category or billing unit.',
            409,
          );
        const [row] = await tx
          .update(schema.facilityServices)
          .set({
            name: data.name,
            description: data.description,
            isActive: data.isActive,
            autoBill: data.autoBill,
            updatedAt: new Date(),
          })
          .where(eq(schema.facilityServices.id, old.id))
          .returning();
        await audit(tx, facility, actor, 'UPDATE', 'FACILITY_SERVICE', row.id, {
          before: {
            name: old.name,
            description: old.description,
            isActive: old.isActive,
            autoBill: old.autoBill,
          },
          after: {
            name: row.name,
            description: row.description,
            isActive: row.isActive,
            autoBill: row.autoBill,
          },
        });
        return row;
      });
      return res.json(updated);
    } catch (error) {
      return failure(res, error);
    }
  },
);

router.patch(
  '/api/facility-services/:id/status',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;
      if (typeof req.body?.isActive !== 'boolean')
        throw new FacilityServiceError('INVALID_STATUS', 'A boolean isActive is required.');
      const serviceId = id(req.params.id),
        actor = req.authContext.userId,
        active = req.body.isActive as boolean;
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.facilityServices)
          .set({ isActive: active, updatedAt: new Date() })
          .where(
            and(
              eq(schema.facilityServices.id, serviceId),
              eq(schema.facilityServices.tenantId, facility.tenantId),
              eq(schema.facilityServices.facilityId, facility.id),
            ),
          )
          .returning();
        if (!row)
          throw new FacilityServiceError(
            'SERVICE_NOT_FOUND',
            'Service not found in this facility.',
            404,
          );
        await audit(
          tx,
          facility,
          actor,
          active ? 'ACTIVATE' : 'DEACTIVATE',
          'FACILITY_SERVICE',
          row.id,
          { code: row.code },
        );
        return row;
      });
      return res.json(updated);
    } catch (error) {
      return failure(res, error);
    }
  },
);

/** Permanently remove an unused service and its unused tariffs atomically. */
router.delete(
  '/api/facility-services/:id/permanent',
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
      const serviceId = id(req.params.id),
        actor = req.authContext.userId;
      const deletedTariffs = await db.transaction(async (tx) => {
        const [service] = await tx
          .select()
          .from(schema.facilityServices)
          .where(
            and(
              eq(schema.facilityServices.id, serviceId),
              eq(schema.facilityServices.tenantId, facility.tenantId),
              eq(schema.facilityServices.facilityId, facility.id),
            ),
          )
          .limit(1)
          .for('update');
        if (!service)
          throw new FacilityServiceError(
            'SERVICE_NOT_FOUND',
            'Service not found in this facility.',
            404,
          );
        if (
          (await hasProtectedReferences(tx, 'facility_services', [service.id])) ||
          (await hasCodeBasedClinicalHistory(tx, service))
        )
          throw new FacilityServiceError(
            'SERVICE_IN_USE',
            'This service is linked to clinical, billing or other records and must be retained. Deactivate it instead.',
            409,
          );
        // Lock in a stable order. The service lock prevents concurrent tariff
        // attachment; the tariff locks prevent new billing/payer references.
        const tariffs = await tx
          .select()
          .from(schema.facilityServiceTariffs)
          .where(
            and(
              eq(schema.facilityServiceTariffs.facilityServiceId, service.id),
              eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
              eq(schema.facilityServiceTariffs.facilityId, facility.id),
            ),
          )
          .orderBy(asc(schema.facilityServiceTariffs.id))
          .for('update');
        await assertTariffsDeletable(tx, tariffs);
        for (const tariff of tariffs) {
          await tx
            .delete(schema.facilityServiceTariffs)
            .where(eq(schema.facilityServiceTariffs.id, tariff.id));
          await audit(
            tx,
            facility,
            actor,
            'DELETE',
            'FACILITY_SERVICE_TARIFF',
            tariff.id,
            tariffAuditSnapshot(tariff),
          );
        }
        await tx.delete(schema.facilityServices).where(eq(schema.facilityServices.id, service.id));
        await audit(tx, facility, actor, 'DELETE', 'FACILITY_SERVICE', service.id, {
          code: service.code,
          name: service.name,
          description: service.description,
          department: service.department,
          category: service.category,
          unit: service.unit,
          isActive: service.isActive,
          autoBill: service.autoBill,
          deletedTariffIds: tariffs.map((row) => row.id),
        });
        return tariffs.length;
      });
      return res.json({ deleted: true, id: serviceId, deletedTariffs });
    } catch (error) {
      return deletionFailure(res, error);
    }
  },
);

router.get(
  '/api/facility-tariffs',
  requirePermission('tariffs.read'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.query.facilityId);
      if (!facility) return;
      return res.json(
        await db
          .select()
          .from(schema.facilityServiceTariffs)
          .where(
            and(
              eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
              eq(schema.facilityServiceTariffs.facilityId, facility.id),
            ),
          )
          .orderBy(asc(schema.facilityServiceTariffs.code)),
      );
    } catch (error) {
      return failure(res, error);
    }
  },
);

router.get(
  '/api/facility-tariffs/by-service-code/:code',
  requireAnyPermission(
    'clinical.read',
    'laboratory.read',
    'radiology.read',
    'pharmacy.read',
    'inpatient.read',
    'billing.read',
    'tariffs.read',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const facility = await clinicalFacility(req);
      const parsed = code.safeParse(req.params.code);
      if (!parsed.success)
        throw new FacilityServiceError('INVALID_CODE', 'A valid service code is required.');
      const [row] = await db
        .select({
          service: schema.facilityServices,
          tariff: schema.facilityServiceTariffs,
          timezone: schema.facilities.timezone,
          tenantTimezone: schema.tenants.timezone,
        })
        .from(schema.facilityServices)
        .leftJoin(
          schema.facilityServiceTariffs,
          and(
            eq(schema.facilityServiceTariffs.facilityServiceId, schema.facilityServices.id),
            eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
            eq(schema.facilityServiceTariffs.facilityId, facility.id),
            eq(schema.facilityServiceTariffs.isActive, true),
            isNull(schema.facilityServiceTariffs.archivedAt),
          ),
        )
        .innerJoin(schema.facilities, eq(schema.facilities.id, schema.facilityServices.facilityId))
        .innerJoin(schema.tenants, eq(schema.tenants.id, schema.facilityServices.tenantId))
        .where(
          and(
            eq(schema.facilityServices.tenantId, facility.tenantId),
            eq(schema.facilityServices.facilityId, facility.id),
            eq(schema.facilityServices.code, parsed.data),
            eq(schema.facilityServices.isActive, true),
          ),
        )
        .limit(1);
      if (!row || !facilityHasTariffModule(facility, row.service.department))
        throw new FacilityServiceError(
          'SERVICE_NOT_FOUND',
          'No active facility service was found.',
          404,
        );
      const zone = row.timezone ?? row.tenantTimezone,
        tariff = row.tariff;
      const valid =
        validTimezone(zone) &&
        tariff &&
        row.service.autoBill &&
        tariff.autoBill &&
        dateVerdict(tariff.effectiveFrom, tariff.effectiveTo, calendarDateInZone(zone)) === 'OK' &&
        (parseMoneyToCents(tariff.fee) ?? 0) > 0 &&
        tariff.unit.trim().toLowerCase() === row.service.unit.trim().toLowerCase();
      return res.json({
        service: row.service,
        tariff: valid ? tariff : null,
        priceStatus: valid ? 'AVAILABLE' : 'UNAVAILABLE',
      });
    } catch (error) {
      return failure(res, error);
    }
  },
);

async function tariffWrite(req: AuthRequest, res: Response, edit: boolean) {
  if (!requireFacilityAdminTariffRole(req, res)) return;
  try {
    const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
    if (!facility || !req.authContext) return;
    const parsed = tariffInput.safeParse(req.body);
    if (!parsed.success)
      throw new FacilityServiceError(
        'INVALID_TARIFF',
        'Provide a service, code, description, matching department and unit, valid price, dates and status.',
      );
    const data = parsed.data,
      actor = req.authContext.userId;
    const tariffId = edit ? id(req.params.id) : null;
    const result = await db.transaction(async (tx) => {
      const [service] = await tx
        .select()
        .from(schema.facilityServices)
        .where(
          and(
            eq(schema.facilityServices.id, data.serviceId),
            eq(schema.facilityServices.tenantId, facility.tenantId),
            eq(schema.facilityServices.facilityId, facility.id),
          ),
        )
        .limit(1)
        .for('share');
      if (!service)
        throw new FacilityServiceError(
          'SERVICE_NOT_FOUND',
          'Service not found in this facility.',
          404,
        );
      if (
        requireModule(facility, data.department, service.category) !== service.department ||
        data.unit.trim().toLowerCase() !== service.unit.trim().toLowerCase()
      )
        throw new FacilityServiceError(
          'TARIFF_SERVICE_MISMATCH',
          'Tariff department and unit must match the service.',
        );
      const values = {
        code: data.code,
        description: data.description,
        department: service.department,
        unit: service.unit,
        fee: data.fee,
        effectiveFrom: data.effectiveFrom ?? null,
        effectiveTo: data.effectiveTo ?? null,
        autoBill: data.autoBill,
        isActive: data.isActive,
        updatedAt: new Date(),
      };
      if (tariffId) {
        const [old] = await tx
          .select()
          .from(schema.facilityServiceTariffs)
          .where(
            and(
              eq(schema.facilityServiceTariffs.id, tariffId),
              eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
              eq(schema.facilityServiceTariffs.facilityId, facility.id),
            ),
          )
          .limit(1)
          .for('update');
        if (!old || old.archivedAt)
          throw new FacilityServiceError(
            'TARIFF_NOT_FOUND',
            'Active or inactive tariff not found.',
            404,
          );
        if (old.facilityServiceId !== null && old.facilityServiceId !== service.id)
          throw new FacilityServiceError(
            'TARIFF_SERVICE_IMMUTABLE',
            'Create a new tariff for a different service.',
            409,
          );
        if (old.masterServiceId && old.code !== data.code)
          throw new FacilityServiceError(
            'HISTORICAL_TARIFF_CODE_IMMUTABLE',
            'A historical tariff code cannot be renamed. Create a new tariff instead.',
            409,
          );
        const [row] = await tx
          .update(schema.facilityServiceTariffs)
          .set({ ...values, facilityServiceId: service.id })
          .where(eq(schema.facilityServiceTariffs.id, old.id))
          .returning();
        await audit(tx, facility, actor, 'UPDATE', 'FACILITY_SERVICE_TARIFF', row.id, {
          before: {
            code: old.code,
            fee: old.fee,
            isActive: old.isActive,
            autoBill: old.autoBill,
            effectiveFrom: old.effectiveFrom,
            effectiveTo: old.effectiveTo,
          },
          after: {
            code: row.code,
            fee: row.fee,
            isActive: row.isActive,
            autoBill: row.autoBill,
            effectiveFrom: row.effectiveFrom,
            effectiveTo: row.effectiveTo,
          },
        });
        return row;
      }
      const [row] = await tx
        .insert(schema.facilityServiceTariffs)
        .values({
          ...values,
          tenantId: facility.tenantId,
          facilityId: facility.id,
          facilityServiceId: service.id,
        })
        .returning();
      await audit(tx, facility, actor, 'CREATE', 'FACILITY_SERVICE_TARIFF', row.id, {
        code: row.code,
        serviceId: service.id,
        fee: row.fee,
      });
      return row;
    });
    return res.status(edit ? 200 : 201).json(result);
  } catch (error) {
    return failure(res, error);
  }
}
router.post(
  '/api/facility-tariffs',
  requirePermission('tariffs.manage'),
  (req: AuthRequest, res: Response) => tariffWrite(req, res, false),
);
router.put(
  '/api/facility-tariffs/:id',
  requirePermission('tariffs.manage'),
  (req: AuthRequest, res: Response) => tariffWrite(req, res, true),
);
router.patch(
  '/api/facility-tariffs/:id/status',
  requirePermission('tariffs.manage'),
  async (req: AuthRequest, res: Response) => {
    if (!requireFacilityAdminTariffRole(req, res)) return;
    try {
      const facility = await resolveTariffFacility(req, res, req.body?.facilityId);
      if (!facility || !req.authContext) return;
      if (typeof req.body?.isActive !== 'boolean')
        throw new FacilityServiceError('INVALID_STATUS', 'A boolean isActive is required.');
      const tariffId = id(req.params.id),
        actor = req.authContext.userId,
        active = req.body.isActive as boolean;
      const row = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(schema.facilityServiceTariffs)
          .set({ isActive: active, updatedAt: new Date() })
          .where(
            and(
              eq(schema.facilityServiceTariffs.id, tariffId),
              eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
              eq(schema.facilityServiceTariffs.facilityId, facility.id),
              isNull(schema.facilityServiceTariffs.archivedAt),
            ),
          )
          .returning();
        if (!updated)
          throw new FacilityServiceError(
            'TARIFF_NOT_FOUND',
            'Facility service tariff not found.',
            404,
          );
        await audit(
          tx,
          facility,
          actor,
          active ? 'ACTIVATE' : 'DEACTIVATE',
          'FACILITY_SERVICE_TARIFF',
          updated.id,
          { code: updated.code },
        );
        return updated;
      });
      return res.json(row);
    } catch (error) {
      return failure(res, error);
    }
  },
);
/** An explicit permanent endpoint keeps the existing DELETE-as-archive API compatible. */
router.delete(
  '/api/facility-tariffs/:id/permanent',
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
      const tariffId = id(req.params.id),
        actor = req.authContext.userId;
      await db.transaction(async (tx) => {
        const [tariff] = await tx
          .select()
          .from(schema.facilityServiceTariffs)
          .where(
            and(
              eq(schema.facilityServiceTariffs.id, tariffId),
              eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
              eq(schema.facilityServiceTariffs.facilityId, facility.id),
            ),
          )
          .limit(1)
          .for('update');
        if (!tariff)
          throw new FacilityServiceError(
            'TARIFF_NOT_FOUND',
            'Facility service tariff not found.',
            404,
          );
        await assertTariffsDeletable(tx, [tariff]);
        await tx
          .delete(schema.facilityServiceTariffs)
          .where(eq(schema.facilityServiceTariffs.id, tariff.id));
        await audit(
          tx,
          facility,
          actor,
          'DELETE',
          'FACILITY_SERVICE_TARIFF',
          tariff.id,
          tariffAuditSnapshot(tariff),
        );
      });
      return res.json({ deleted: true, id: tariffId });
    } catch (error) {
      return deletionFailure(res, error);
    }
  },
);

router.delete(
  '/api/facility-tariffs/:id',
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
      const tariffId = id(req.params.id),
        actor = req.authContext.userId;
      const row = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(schema.facilityServiceTariffs)
          .set({
            isActive: false,
            archivedAt: new Date(),
            archivedByUserId: actor,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.facilityServiceTariffs.id, tariffId),
              eq(schema.facilityServiceTariffs.tenantId, facility.tenantId),
              eq(schema.facilityServiceTariffs.facilityId, facility.id),
              isNull(schema.facilityServiceTariffs.archivedAt),
            ),
          )
          .returning();
        if (!updated)
          throw new FacilityServiceError(
            'TARIFF_NOT_FOUND',
            'Facility service tariff not found.',
            404,
          );
        await audit(tx, facility, actor, 'ARCHIVE', 'FACILITY_SERVICE_TARIFF', updated.id, {
          code: updated.code,
          serviceId: updated.facilityServiceId,
        });
        return updated;
      });
      return res.json(row);
    } catch (error) {
      return failure(res, error);
    }
  },
);

export default router;
