
import { Router, type Request, type Response } from 'express';


import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
} from 'drizzle-orm';

import {
  createHash,
  randomBytes,
} from 'node:crypto';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { STAFF_ROLE_CATALOGUE } from '../auth/staff-role-catalogue.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import * as queries from '../db/queries.ts';

const router = Router();

type PlatformRequest = Request & {
  authContext?: AuthorizationContext;
};

function getContext(req: Request): AuthorizationContext | undefined {
  return (req as PlatformRequest).authContext;
}

function requireSuperAdmin(req: Request, res: Response): boolean {
  if (getContext(req)?.isSuperAdmin !== true) {
    res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Super Admin privileges are required.',
    });
    return false;
  }

  return true;
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalText(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!(key in body)) return undefined;

  if (body[key] === null || body[key] === '') {
    return null;
  }

  return textValue(body[key]);
}

function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

function parseMoneyCents(value: unknown): number | null {
  const raw = typeof value === 'number'
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';

  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(raw)) return null;

  const [whole, fraction = ''] = raw.split('.');
  const cents = Number(whole) * 100 +
    Number((fraction + '00').slice(0, 2));

  return Number.isSafeInteger(cents) ? cents : null;
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function auditActor(context: AuthorizationContext): string {
  return String(context.userId);
}

function handleError(res: Response, error: unknown): void {
  const err = error as {
    code?: string;
    cause?: { code?: string };
  };

  const code = err?.code ?? err?.cause?.code;

  if (code === '23505') {
    res.status(409).json({
      error: 'CONFLICT',
      message: 'A record with one of these unique values already exists.',
    });
    return;
  }

  if (code === '23503') {
    res.status(400).json({
      error: 'INVALID_REFERENCE',
      message: 'A referenced record does not exist.',
    });
    return;
  }

  console.error('Platform route error:', error);

  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'The request could not be completed.',
  });
}




const FACILITY_ADMIN_PERMISSION_CODES = [
  'appointments.cancel',
  'appointments.create',
  'appointments.read',
  'appointments.update',
  'audit.read',
  'billing.read',
  'tariffs.read',
  'tariffs.manage',
  'clinical.read',
  'facilities.read',
  'facilities.update',
  'inpatient.read',
  'insurance.read',
  'inventory.read',
  'laboratory.read',
  'patients.create',
  'patients.read',
  'patients.update',
  'pharmacy.read',
  'practitioners.read',
  'procurement.read',
  'reports.export',
  'reports.read',
  'roles.read',
  'users.create',
  'users.invitations.read',
  'users.invitations.revoke',
  'users.invite',
  'users.read',
  'users.update',
] as const;





/**
 * POST /api/platform/tenants
 * Create a tenant.
 */
router.post('/tenants', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;

  const context = getContext(req)!;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const name = textValue(body.name);
  const suppliedSlug = textValue(body.slug);

  const slug = (
    suppliedSlug ??
    name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  )?.toLowerCase();

  if (!name || name.length > 200 || !slug || !validSlug(slug)) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Provide a valid tenant name and slug.',
    });
    return;
  }

  const contactEmail = textValue(body.contactEmail);

  if (contactEmail && !validEmail(contactEmail)) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Provide a valid contact email.',
    });
    return;
  }

  const domain = textValue(body.domain);
  const logoUrl = textValue(body.logoUrl);
  const brandColor = textValue(body.brandColor);
  const contactPhone = textValue(body.contactPhone);
  const currency = textValue(body.currency) ?? 'KES';
  const timezone = textValue(body.timezone) ?? 'Africa/Nairobi';

  if (!/^[A-Z]{3}$/.test(currency)) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Currency must be a three-letter code such as KES.',
    });
    return;
  }

  if (timezone.length > 100) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Timezone is too long.',
    });
    return;
  }
  try {
    const tenant = await db.transaction(async (tx) => {
      // 1. Create the tenant.
      const [createdTenant] = await tx
        .insert(schema.tenants)
        .values({
          name,
          slug,
          ...(domain ? { domain } : {}),
          ...(logoUrl ? { logoUrl } : {}),
          ...(brandColor ? { brandColor } : {}),
          ...(contactEmail ? { contactEmail } : {}),
          ...(contactPhone ? { contactPhone } : {}),
          currency,
          timezone,
        })
        .returning();

      // 2. Resolve every required permission before creating
      //    the role. Missing permissions abort the transaction.
      const permissionRows = await tx
        .select({
          id: schema.permissions.id,
          code: schema.permissions.code,
        })
        .from(schema.permissions)
        .where(
          inArray(
            schema.permissions.code,
            [...FACILITY_ADMIN_PERMISSION_CODES],
          ),
        );

      const foundCodes = new Set(
        permissionRows.map((permission) => permission.code),
      );

      const missingCodes =
        FACILITY_ADMIN_PERMISSION_CODES.filter(
          (code) => !foundCodes.has(code),
        );

      if (missingCodes.length > 0) {
        throw new Error(
          `FACILITY_ADMIN_PERMISSIONS_MISSING: ${missingCodes.join(', ')}`,
        );
      }

      // 3. Create a tenant-scoped role, never a global role.
      const [facilityAdminRole] = await tx
        .insert(schema.roles)
        .values({
          tenantId: createdTenant.id,
          name: 'FACILITY_ADMIN',
          description:
            'Facility administrator for this healthcare organization.',
          isSystem: false,
          isActive: true,
        })
        .returning({
          id: schema.roles.id,
        });

      // 4. Assign the approved permission set.
      await tx
        .insert(schema.rolePermissions)
        .values(
          permissionRows.map((permission) => ({
            roleId: facilityAdminRole.id,
            permissionId: permission.id,
          })),
        );

      
      // 5. Provision the standard staff roles for the new tenant.
      const staffPermissionCodes = [
        ...new Set(STAFF_ROLE_CATALOGUE.flatMap((role) => [...role.permissions])),
      ];

      const staffPermissionRows = await tx
        .select({
          id: schema.permissions.id,
          code: schema.permissions.code,
        })
        .from(schema.permissions)
        .where(inArray(schema.permissions.code, staffPermissionCodes));

      const staffFoundCodes = new Set(
        staffPermissionRows.map((permission) => permission.code),
      );

      const missingStaffCodes = staffPermissionCodes.filter(
        (code) => !staffFoundCodes.has(code),
      );

      if (missingStaffCodes.length > 0) {
        throw new Error(
          `STAFF_ROLE_PERMISSIONS_MISSING: ${missingStaffCodes.join(', ')}`,
        );
      }

      for (const staffRole of STAFF_ROLE_CATALOGUE) {
        const [createdRole] = await tx
          .insert(schema.roles)
          .values({
            tenantId: createdTenant.id,
            name: staffRole.name,
            description: staffRole.description,
            isSystem: false,
            isActive: true,
          })
          .returning({ id: schema.roles.id });

        const rolePermissionRows = staffPermissionRows
          .filter((permission) =>
            (staffRole.permissions as readonly string[]).includes(permission.code),
          )
          .map((permission) => ({
            roleId: createdRole.id,
            permissionId: permission.id,
          }));

        await tx
          .insert(schema.rolePermissions)
          .values(rolePermissionRows);
      }
      return createdTenant;
    });

    // Audit only after the tenant and role transaction commits.
    await queries.logAuditEvent(
      tenant.id,
      null,
      auditActor(context),
      'CREATE',
      'TENANT',
      String(tenant.id),
      `Created tenant "${tenant.name}" (${tenant.slug}) with a tenant-scoped FACILITY_ADMIN role.`,
    );

    res.status(201).json({ data: tenant });
  } catch (error) {
    handleError(res, error);
  }

});

/**
 * PATCH /api/platform/tenants/:id
 * Update tenant configuration.
 */
router.patch('/tenants/:id', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;

  const context = getContext(req)!;
  const tenantId = parseId(req.params.id);

  if (!tenantId) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Invalid tenant ID.',
    });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const updates: Partial<typeof schema.tenants.$inferInsert> = {};

  if ('name' in body) {
    const name = textValue(body.name);

    if (!name || name.length > 200) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Tenant name is invalid.',
      });
      return;
    }

    updates.name = name;
  }

  if ('slug' in body) {
    const slug = textValue(body.slug)?.toLowerCase();

    if (!slug || !validSlug(slug)) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Tenant slug is invalid.',
      });
      return;
    }

    updates.slug = slug;
  }

  for (const key of [
    'domain',
    'logoUrl',
    'brandColor',
    'contactPhone',
  ] as const) {
    const value = optionalText(body, key);

    if (value === undefined) continue;

    switch (key) {
      case 'domain':
        updates.domain = value;
        break;
      case 'logoUrl':
        updates.logoUrl = value;
        break;
      case 'brandColor':
        updates.brandColor = value;
        break;
      case 'contactPhone':
        updates.contactPhone = value;
        break;
    }
  }

  if ('contactEmail' in body) {
    const email = optionalText(body, 'contactEmail');

    if (email === undefined && body.contactEmail !== undefined) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Contact email must be a valid string or null.',
      });
      return;
    }

    if (email && !validEmail(email)) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Contact email is invalid.',
      });
      return;
    }

    if (email !== undefined) {
      updates.contactEmail = email;
    }
  }

  if ('currency' in body) {
    const currency = textValue(body.currency);

    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Currency must be a three-letter code such as KES.',
      });
      return;
    }

    updates.currency = currency;
  }

  if ('timezone' in body) {
    const timezone = textValue(body.timezone);

    if (!timezone || timezone.length > 100) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Timezone is invalid.',
      });
      return;
    }

    updates.timezone = timezone;
  }

  if ('isActive' in body) {
    if (typeof body.isActive !== 'boolean') {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'isActive must be true or false.',
      });
      return;
    }

    updates.isActive = body.isActive;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'No valid fields supplied to update.',
    });
    return;
  }

  updates.updatedAt = new Date();

  try {
    const [tenant] = await db
      .update(schema.tenants)
      .set(updates)
      .where(eq(schema.tenants.id, tenantId))
      .returning();

    if (!tenant) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Tenant not found.',
      });
      return;
    }

    await queries.logAuditEvent(
      tenant.id,
      null,
      auditActor(context),
      'UPDATE',
      'TENANT',
      String(tenant.id),
      `Updated tenant configuration. Fields: ${Object.keys(updates)
        .filter((key) => key !== 'updatedAt')
        .join(', ')}.`,
    );

    res.json({ data: tenant });
  } catch (error) {
    handleError(res, error);
  }
});

/**
 * POST /api/platform/facilities
 * Create a facility and its initial onboarding record atomically.
 */
router.post('/facilities', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;

  const context = getContext(req)!;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const tenantId =
    typeof body.tenantId === 'number'
      ? body.tenantId
      : typeof body.tenantId === 'string' &&
          /^[1-9]\d*$/.test(body.tenantId)
        ? Number(body.tenantId)
        : NaN;

  const code = textValue(body.code);
  const name = textValue(body.name);

  if (
    !Number.isSafeInteger(tenantId) ||
    tenantId < 1 ||
    !code ||
    code.length > 80 ||
    !name ||
    name.length > 200
  ) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Provide a valid tenantId, facility code, and facility name.',
    });
    return;
  }

  const email = textValue(body.email);

  if (email && !validEmail(email)) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Facility email is invalid.',
    });
    return;
  }

  const level = textValue(body.level);
  const county = textValue(body.county);
  const subCounty = textValue(body.subCounty);
  const mflCode = textValue(body.mflCode);
  const address = textValue(body.address);
  const phone = textValue(body.phone);

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
          ...(county ? { county } : {}),
          ...(subCounty ? { subCounty } : {}),
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
});


/**
 * GET /api/platform/facilities/:id/onboarding
 * Retrieve the existing onboarding record for a facility.
 */
router.get(
  '/facilities/:id/onboarding',
  async (req: Request, res: Response) => {
    if (!requireSuperAdmin(req, res)) return;

    const facilityId = parseId(req.params.id);

    if (!facilityId) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid facility ID.',
      });
      return;
    }

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
        .where(
          eq(schema.facilityOnboarding.facilityId, facilityId),
        )
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
router.patch('/facilities/:id', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;

  const context = getContext(req)!;
  const facilityId = parseId(req.params.id);

  if (!facilityId) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Invalid facility ID.',
    });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const updates: Partial<typeof schema.facilities.$inferInsert> = {};

  for (const key of [
    'code',
    'name',
    'level',
    'county',
    'subCounty',
    'mflCode',
    'address',
    'phone',
    'email',
  ] as const) {
    if (!(key in body)) continue;

    const value = optionalText(body, key);

    if (value === undefined) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: `${key} must be a string or null.`,
      });
      return;
    }

    if (key === 'code' && (!value || value.length > 80)) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Facility code is required and must not exceed 80 characters.',
      });
      return;
    }

    if (key === 'name' && (!value || value.length > 200)) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Facility name is required and must not exceed 200 characters.',
      });
      return;
    }

    if (key === 'email' && value && !validEmail(value)) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Facility email is invalid.',
      });
      return;
    }

    if (value === null) {
      switch (key) {
        case 'mflCode':
          updates.mflCode = null;
          break;
        case 'address':
          updates.address = null;
          break;
        case 'phone':
          updates.phone = null;
          break;
        case 'email':
          updates.email = null;
          break;
        default:
          res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: `${key} cannot be empty.`,
          });
          return;
      }
    } else {
      switch (key) {
        case 'code':
          updates.code = value;
          break;
        case 'name':
          updates.name = value;
          break;
        case 'level':
          updates.level = value;
          break;
        case 'county':
          updates.county = value;
          break;
        case 'subCounty':
          updates.subCounty = value;
          break;
        case 'mflCode':
          updates.mflCode = value;
          break;
        case 'address':
          updates.address = value;
          break;
        case 'phone':
          updates.phone = value;
          break;
        case 'email':
          updates.email = value;
          break;
      }
    }
  }

  if ('enabledModules' in body) {
    if (
      !Array.isArray(body.enabledModules) ||
      !body.enabledModules.every(
        (item) =>
          typeof item === 'string' &&
          item.trim().length > 0 &&
          item.length <= 80,
      )
    ) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'enabledModules must be an array of non-empty strings.',
      });
      return;
    }

    updates.enabledModules = [
      ...new Set(
        (body.enabledModules as string[]).map((item) => item.trim()),
      ),
    ];
  }

  if ('isActive' in body) {
    if (typeof body.isActive !== 'boolean') {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'isActive must be true or false.',
      });
      return;
    }

    updates.isActive = body.isActive;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'No valid fields supplied to update.',
    });
    return;
  }

  updates.updatedAt = new Date();

  try {
    const [facility] = await db
      .update(schema.facilities)
      .set(updates)
      .where(eq(schema.facilities.id, facilityId))
      .returning();

    if (!facility) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Facility not found.',
      });
      return;
    }

    await queries.logAuditEvent(
      facility.tenantId,
      facility.id,
      auditActor(context),
      'UPDATE',
      'FACILITY',
      String(facility.id),
      `Updated facility configuration. Fields: ${Object.keys(updates)
        .filter((key) => key !== 'updatedAt')
        .join(', ')}.`,
    );

    res.json({ data: facility });
  } catch (error) {
    handleError(res, error);
  }
});

/**
 * POST /api/platform/facilities/:id/onboarding
 * Create onboarding only when no record exists.
 */
router.post(
  '/facilities/:id/onboarding',
  async (req: Request, res: Response) => {
    if (!requireSuperAdmin(req, res)) return;

    const context = getContext(req)!;
    const facilityId = parseId(req.params.id);

    if (!facilityId) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid facility ID.',
      });
      return;
    }

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



/**
 * POST /api/platform/facility-admin-invitations
 *
 * Create a secure invitation for a facility administrator.
 * Only the Platform Super Admin may issue this invitation.
 */
router.post(
  '/facility-admin-invitations',
  async (req: Request, res: Response) => {
    if (!requireSuperAdmin(req, res)) return;

    const context = getContext(req)!;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const facilityId =
      typeof body.facilityId === 'number'
        ? body.facilityId
        : typeof body.facilityId === 'string'
          ? Number(body.facilityId)
          : NaN;

    const fullName = textValue(body.fullName);
    const email = textValue(body.email)?.toLowerCase();
    const phone = textValue(body.phone);

    if (
      !Number.isSafeInteger(facilityId) ||
      facilityId < 1 ||
      !fullName ||
      fullName.length > 200 ||
      !email ||
      email.length > 254 ||
      !validEmail(email)
    ) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message:
          'Provide a valid facilityId, fullName, and email.',
      });
      return;
    }

    const baseUrl = process.env.APP_BASE_URL?.trim();

    if (!baseUrl) {
      res.status(500).json({
        error: 'CONFIGURATION_ERROR',
        message:
          'APP_BASE_URL must be configured before issuing invitations.',
      });
      return;
    }

    let invitationUrl: URL;

    try {
      invitationUrl = new URL(baseUrl);

      if (
        invitationUrl.protocol !== 'https:' &&
        invitationUrl.hostname !== 'localhost'
      ) {
        throw new Error('HTTPS is required.');
      }
    } catch {
      res.status(500).json({
        error: 'CONFIGURATION_ERROR',
        message: 'APP_BASE_URL is invalid.',
      });
      return;
    }

    try {
      const [facility] = await db
        .select({
          id: schema.facilities.id,
          tenantId: schema.facilities.tenantId,
          name: schema.facilities.name,
          isActive: schema.facilities.isActive,
          tenantActive: schema.tenants.isActive,
        })
        .from(schema.facilities)
        .innerJoin(
          schema.tenants,
          eq(
            schema.facilities.tenantId,
            schema.tenants.id,
          ),
        )
        .where(eq(schema.facilities.id, facilityId))
        .limit(1);

      if (!facility) {
        res.status(404).json({
          error: 'FACILITY_NOT_FOUND',
          message: 'The selected facility was not found.',
        });
        return;
      }

      if (
        !facility.isActive ||
        !facility.tenantActive
      ) {
        res.status(409).json({
          error: 'FACILITY_UNAVAILABLE',
          message:
            'The facility and its tenant must both be active.',
        });
        return;
      }
      // Verify the tenant-specific facility administrator role.
      const [facilityAdminRole] = await db
        .select({
          id: schema.roles.id,
        })
        .from(schema.roles)
        .where(
          and(
            eq(schema.roles.name, 'FACILITY_ADMIN'),
            eq(schema.roles.tenantId, facility.tenantId),
            eq(schema.roles.isActive, true),
          ),
        )
        .limit(1);

      if (!facilityAdminRole) {
        res.status(409).json({
          error: 'FACILITY_ADMIN_ROLE_NOT_CONFIGURED',
          message:
            'The facility administrator role is not configured for this organization. Contact the platform administrator.',
        });
        return;
      }

      // Verify that the role has permission assignments.
      const [rolePermission] = await db
        .select({
          id: schema.rolePermissions.id,
        })
        .from(schema.rolePermissions)
        .where(
          eq(
            schema.rolePermissions.roleId,
            facilityAdminRole.id,
          ),
        )
        .limit(1);

      if (!rolePermission) {
        res.status(409).json({
          error: 'FACILITY_ADMIN_PERMISSIONS_NOT_CONFIGURED',
          message:
            'The facility administrator role has no permissions configured. Contact the platform administrator.',
        });
        return;
      }


      const now = new Date();

      const [existingInvitation] = await db
        .select({
          id: schema.facilityAdminInvitations.id,
        })
        .from(schema.facilityAdminInvitations)
        .where(
          and(
            eq(
              schema.facilityAdminInvitations.facilityId,
              facilityId,
            ),
            eq(
              schema.facilityAdminInvitations.email,
              email,
            ),
            isNull(
              schema.facilityAdminInvitations.acceptedAt,
            ),
            isNull(
              schema.facilityAdminInvitations.revokedAt,
            ),
            gt(
              schema.facilityAdminInvitations.expiresAt,
              now,
            ),
          ),
        )
        .limit(1);

      if (existingInvitation) {
        res.status(409).json({
          error: 'INVITATION_ALREADY_PENDING',
          message:
            'An unexpired invitation already exists for this email and facility.',
        });
        return;
      }

      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256')
        .update(rawToken)
        .digest('hex');

      const expiresAt = new Date(
        now.getTime() + 48 * 60 * 60 * 1000,
      );

      const [invitation] = await db
        .insert(schema.facilityAdminInvitations)
        .values({
          tenantId: facility.tenantId,
          facilityId: facility.id,
          email,
          fullName,
          ...(phone ? { phone } : {}),
          designation: 'Facility Administrator',
          invitationTokenHash: tokenHash,
          expiresAt,
          invitedBy: String(context.userId),
        })
        .returning({
          id: schema.facilityAdminInvitations.id,
          email: schema.facilityAdminInvitations.email,
          expiresAt: schema.facilityAdminInvitations.expiresAt,
        });

      await queries.logAuditEvent(
        facility.tenantId,
        facility.id,
        String(context.userId),
        'CREATE',
        'FACILITY_ADMIN_INVITATION',
        String(invitation.id),
        `Issued a facility administrator invitation for ${email}.`,
      );

      const link = new URL(
        '/accept-facility-admin-invitation',
        invitationUrl,
      );
      link.searchParams.set('token', rawToken);

      res.status(201).json({
        success: true,
        message:
          'Facility administrator invitation created.',
        data: {
          invitationId: invitation.id,
          facilityId: facility.id,
          facilityName: facility.name,
          email: invitation.email,
          expiresAt: invitation.expiresAt,
          invitationLink: link.toString(),
        },
      });
    } catch (error) {
      handleError(res, error);
    }
  },
);




/**
 * GET /api/platform/facility-admin-invitations
 * List invitation metadata without exposing token hashes.
 */
router.get('/facility-admin-invitations', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;

  try {
    const rows = await db
      .select({
        id: schema.facilityAdminInvitations.id,
        tenantId: schema.facilityAdminInvitations.tenantId,
        tenantName: schema.tenants.name,
        facilityId: schema.facilityAdminInvitations.facilityId,
        facilityName: schema.facilities.name,
        email: schema.facilityAdminInvitations.email,
        fullName: schema.facilityAdminInvitations.fullName,
        createdAt: schema.facilityAdminInvitations.createdAt,
        expiresAt: schema.facilityAdminInvitations.expiresAt,
        acceptedAt: schema.facilityAdminInvitations.acceptedAt,
        acceptedUserId: schema.facilityAdminInvitations.acceptedUserId,
        revokedAt: schema.facilityAdminInvitations.revokedAt,
      })
      .from(schema.facilityAdminInvitations)
      .innerJoin(
        schema.tenants,
        eq(schema.facilityAdminInvitations.tenantId, schema.tenants.id),
      )
      .innerJoin(
        schema.facilities,
        eq(schema.facilityAdminInvitations.facilityId, schema.facilities.id),
      )
      .orderBy(desc(schema.facilityAdminInvitations.createdAt))
      .limit(500);

    const now = Date.now();
    const data = rows.map((row) => ({
      ...row,
      status: row.acceptedAt
        ? 'ACCEPTED'
        : row.revokedAt
          ? 'REVOKED'
          : new Date(row.expiresAt).getTime() <= now
            ? 'EXPIRED'
            : 'PENDING',
    }));

    res.json({ success: true, data });
  } catch (error) {
    handleError(res, error);
  }
});

/**
 * POST /api/platform/facility-admin-invitations/:id/revoke
 * Revoke an invitation that has not already been accepted or revoked.
 */
router.post(
  '/facility-admin-invitations/:id/revoke',
  async (req: Request, res: Response) => {
    if (!requireSuperAdmin(req, res)) return;

    const context = getContext(req)!;
    const id = parseId(req.params.id);

    if (!id) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid invitation ID.' });
      return;
    }

    try {
      const now = new Date();
      const [invitation] = await db
        .update(schema.facilityAdminInvitations)
        .set({ revokedAt: now })
        .where(
          and(
            eq(schema.facilityAdminInvitations.id, id),
            isNull(schema.facilityAdminInvitations.acceptedAt),
            isNull(schema.facilityAdminInvitations.revokedAt),
          ),
        )
        .returning({
          id: schema.facilityAdminInvitations.id,
          tenantId: schema.facilityAdminInvitations.tenantId,
          facilityId: schema.facilityAdminInvitations.facilityId,
          email: schema.facilityAdminInvitations.email,
        });

      if (!invitation) {
        res.status(409).json({
          error: 'INVITATION_NOT_REVOCABLE',
          message: 'The invitation may not exist, or it has already been accepted or revoked.',
        });
        return;
      }

      await queries.logAuditEvent(
        invitation.tenantId,
        invitation.facilityId,
        auditActor(context),
        'REVOKE',
        'FACILITY_ADMIN_INVITATION',
        String(invitation.id),
        `Revoked a facility administrator invitation for ${invitation.email}.`,
      );

      res.json({ success: true, message: 'Invitation revoked.' });
    } catch (error) {
      handleError(res, error);
    }
  },
);

/**
 * POST /api/platform/facility-admin-invitations/:id/reissue
 * Replace the old token and extend the invitation by 48 hours.
 */
router.post(
  '/facility-admin-invitations/:id/reissue',
  async (req: Request, res: Response) => {
    if (!requireSuperAdmin(req, res)) return;

    const context = getContext(req)!;
    const id = parseId(req.params.id);

    if (!id) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid invitation ID.' });
      return;
    }

    const baseUrl = process.env.APP_BASE_URL?.trim();
    let invitationUrl: URL;

    try {
      if (!baseUrl) throw new Error('Missing APP_BASE_URL.');
      invitationUrl = new URL(baseUrl);
      if (invitationUrl.protocol !== 'https:' && invitationUrl.hostname !== 'localhost') {
        throw new Error('HTTPS is required.');
      }
    } catch {
      res.status(500).json({
        error: 'CONFIGURATION_ERROR',
        message: 'APP_BASE_URL must be a valid HTTPS URL (localhost is allowed for development).',
      });
      return;
    }

    try {
      const [existing] = await db
        .select()
        .from(schema.facilityAdminInvitations)
        .where(eq(schema.facilityAdminInvitations.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Invitation not found.' });
        return;
      }

      if (existing.acceptedAt || existing.revokedAt) {
        res.status(409).json({
          error: 'INVITATION_NOT_REISSUABLE',
          message: 'Accepted or revoked invitations cannot be reissued.',
        });
        return;
      }

      const now = new Date();
      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);

      const [updated] = await db
        .update(schema.facilityAdminInvitations)
        .set({ invitationTokenHash: tokenHash, expiresAt })
        .where(
          and(
            eq(schema.facilityAdminInvitations.id, id),
            isNull(schema.facilityAdminInvitations.acceptedAt),
            isNull(schema.facilityAdminInvitations.revokedAt),
          ),
        )
        .returning({
          id: schema.facilityAdminInvitations.id,
          tenantId: schema.facilityAdminInvitations.tenantId,
          facilityId: schema.facilityAdminInvitations.facilityId,
          email: schema.facilityAdminInvitations.email,
          fullName: schema.facilityAdminInvitations.fullName,
          expiresAt: schema.facilityAdminInvitations.expiresAt,
        });

      if (!updated) {
        res.status(409).json({
          error: 'INVITATION_NOT_REISSUABLE',
          message: 'The invitation changed state. Refresh the list and try again.',
        });
        return;
      }

      await queries.logAuditEvent(
        updated.tenantId,
        updated.facilityId,
        auditActor(context),
        'UPDATE',
        'FACILITY_ADMIN_INVITATION',
        String(updated.id),
        `Reissued a facility administrator invitation for ${updated.email}.`,
      );

      const link = new URL('/accept-facility-admin-invitation', invitationUrl);
      link.searchParams.set('token', rawToken);

      res.json({
        success: true,
        message: 'Invitation reissued. The previous token is no longer valid.',
        data: {
          invitationId: updated.id,
          email: updated.email,
          expiresAt: updated.expiresAt,
          invitationLink: link.toString(),
        },
      });
    } catch (error) {
      handleError(res, error);
    }
  },
);


// SUBSCRIPTION BILLING API - INITIAL IMPLEMENTATION
// These routes manage subscription records only. They do not yet enforce
// subscription access against login or clinical routes.

router.get('/subscription-periods', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;

  try {
    const rows = await db
      .select({
        id: schema.facilitySubscriptionPeriods.id,
        tenantId: schema.facilitySubscriptionPeriods.tenantId,
        facilityId: schema.facilitySubscriptionPeriods.facilityId,
        subscriptionName: schema.facilitySubscriptionPeriods.subscriptionName,
        amountDue: schema.facilitySubscriptionPeriods.amountDue,
        currency: schema.facilitySubscriptionPeriods.currency,
        periodStart: schema.facilitySubscriptionPeriods.periodStart,
        periodEnd: schema.facilitySubscriptionPeriods.periodEnd,
        dueDate: schema.facilitySubscriptionPeriods.dueDate,
        gracePeriodEnd: schema.facilitySubscriptionPeriods.gracePeriodEnd,
        status: schema.facilitySubscriptionPeriods.status,
        notes: schema.facilitySubscriptionPeriods.notes,
        createdBy: schema.facilitySubscriptionPeriods.createdBy,
        updatedBy: schema.facilitySubscriptionPeriods.updatedBy,
        createdAt: schema.facilitySubscriptionPeriods.createdAt,
        updatedAt: schema.facilitySubscriptionPeriods.updatedAt,
        facilityName: schema.facilities.name,
        facilityCode: schema.facilities.code,
        accessStatus: schema.facilitySubscriptionAccess.accessStatus,
        suspendedAt: schema.facilitySubscriptionAccess.suspendedAt,
        suspensionReason: schema.facilitySubscriptionAccess.suspensionReason,
      })
      .from(schema.facilitySubscriptionPeriods)
      .leftJoin(
        schema.facilities,
        and(
          eq(schema.facilities.id, schema.facilitySubscriptionPeriods.facilityId),
          eq(schema.facilities.tenantId, schema.facilitySubscriptionPeriods.tenantId),
        ),
      )
      .leftJoin(
        schema.facilitySubscriptionAccess,
        and(
          eq(schema.facilitySubscriptionAccess.facilityId, schema.facilitySubscriptionPeriods.facilityId),
          eq(schema.facilitySubscriptionAccess.tenantId, schema.facilitySubscriptionPeriods.tenantId),
        ),
      )
      .orderBy(desc(schema.facilitySubscriptionPeriods.createdAt))
      .limit(200);

    res.json({ success: true, data: rows });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/subscription-periods', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  const context = getContext(req);
  if (!context) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const tenantId = parseId(String(body.tenantId ?? ''));
  const facilityId = parseId(String(body.facilityId ?? ''));
  const subscriptionName = textValue(body.subscriptionName);
  const amountDueCents = parseMoneyCents(body.amountDue);
  const amountDue = amountDueCents === null
    ? Number.NaN
    : amountDueCents / 100;
  const periodStart = textValue(body.periodStart);
  const periodEnd = textValue(body.periodEnd);
  const dueDate = textValue(body.dueDate);
  const gracePeriodEnd = optionalText(body, 'gracePeriodEnd');

  const validDate = (value: string | undefined): value is string =>
    Boolean(value && validCalendarDate(value));

  if (
    !tenantId || !facilityId || !subscriptionName ||
    !Number.isFinite(amountDue) || amountDue <= 0 ||
    !validDate(periodStart) || !validDate(periodEnd) ||
    !validDate(dueDate) ||
    (gracePeriodEnd !== undefined && gracePeriodEnd !== null &&
      !validDate(gracePeriodEnd))
  ) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Provide tenant, facility, subscription name, positive fee, and valid period dates.',
    });
    return;
  }

  if (periodStart > periodEnd || dueDate < periodStart ||
      (gracePeriodEnd && gracePeriodEnd < dueDate)) {
    res.status(400).json({
      error: 'INVALID_PERIOD_DATES',
      message: 'Check the period start/end, due date, and grace-period end date.',
    });
    return;
  }

  try {
    const created = await db.transaction(async (tx) => {
      const [facility] = await tx
        .select({
          id: schema.facilities.id,
          tenantId: schema.facilities.tenantId,
        })
        .from(schema.facilities)
        .where(eq(schema.facilities.id, facilityId))
        .limit(1);

      if (!facility || facility.tenantId !== tenantId) {
        throw Object.assign(new Error('Facility does not belong to the supplied tenant.'), {
          statusCode: 400,
        });
      }

      const [period] = await tx
        .insert(schema.facilitySubscriptionPeriods)
        .values({
          tenantId,
          facilityId,
          subscriptionName,
          amountDue: amountDue.toFixed(2),
          currency: 'KES',
          periodStart,
          periodEnd,
          dueDate,
          gracePeriodEnd: gracePeriodEnd ?? null,
          status: 'PENDING',
          createdBy: auditActor(context),
          updatedBy: auditActor(context),
        })
        .returning();

      await tx.insert(schema.auditLogs).values({
        tenantId,
        facilityId,
        userId: auditActor(context),
        action: 'CREATE',
        resource: 'FACILITY_SUBSCRIPTION_PERIOD',
        resourceId: String(period.id),
        details: `Created subscription "${subscriptionName}" for KES ${amountDue.toFixed(2)} covering ${periodStart} to ${periodEnd}.`,
        severity: 'INFO',
      });

      return period;
    });

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 400) {
      res.status(400).json({
        error: 'FACILITY_TENANT_MISMATCH',
        message: 'The selected facility does not belong to the supplied tenant.',
      });
      return;
    }
    handleError(res, error);
  }
});

router.get('/subscription-periods/:id/payments', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  const periodId = parseId(req.params.id);

  if (!periodId) {
    res.status(400).json({ error: 'INVALID_ID' });
    return;
  }

  try {
    const [period] = await db
      .select({ id: schema.facilitySubscriptionPeriods.id })
      .from(schema.facilitySubscriptionPeriods)
      .where(eq(schema.facilitySubscriptionPeriods.id, periodId))
      .limit(1);

    if (!period) {
      res.status(404).json({ error: 'SUBSCRIPTION_NOT_FOUND' });
      return;
    }

    const payments = await db
      .select()
      .from(schema.facilitySubscriptionPayments)
      .where(eq(schema.facilitySubscriptionPayments.subscriptionPeriodId, periodId))
      .orderBy(desc(schema.facilitySubscriptionPayments.createdAt));

    res.json({ success: true, data: payments });
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/subscription-periods/:id/payments', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  const context = getContext(req);
  if (!context) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const periodId = parseId(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const transactionCode = textValue(body.transactionCode);
  const amountCents = parseMoneyCents(body.amount);
  const amount = amountCents === null
    ? Number.NaN
    : amountCents / 100;
  const paymentDateInput = textValue(body.paymentDate);
  const paymentDate = paymentDateInput ? new Date(paymentDateInput) : new Date();

  if (
    !periodId || !transactionCode || transactionCode.length > 100 ||
    !Number.isFinite(amount) || amount <= 0 ||
    Number.isNaN(paymentDate.getTime())
  ) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Provide a valid subscription ID, transaction code, positive amount, and optional valid payment date.',
    });
    return;
  }

  try {
    const created = await db.transaction(async (tx) => {
      const [period] = await tx
        .select()
        .from(schema.facilitySubscriptionPeriods)
        .where(eq(schema.facilitySubscriptionPeriods.id, periodId))
        .limit(1);

      if (!period) {
        throw Object.assign(new Error('Subscription not found.'), { statusCode: 404 });
      }

      const [payment] = await tx
        .insert(schema.facilitySubscriptionPayments)
        .values({
          tenantId: period.tenantId,
          facilityId: period.facilityId,
          subscriptionPeriodId: period.id,
          transactionCode,
          amount: amount.toFixed(2),
          paymentMethod: 'MPESA',
          paymentDate,
          verificationStatus: 'PENDING',
          createdBy: auditActor(context),
        })
        .returning();

      await tx.insert(schema.auditLogs).values({
        tenantId: period.tenantId,
        facilityId: period.facilityId,
        userId: auditActor(context),
        action: 'CREATE',
        resource: 'FACILITY_SUBSCRIPTION_PAYMENT',
        resourceId: String(payment.id),
        details: `Recorded M-Pesa transaction ${transactionCode} for KES ${amount.toFixed(2)} as PENDING verification. It has not yet been counted as paid.`,
        severity: 'INFO',
      });

      return payment;
    });

    res.status(201).json({
      success: true,
      message: 'Payment recorded and awaiting verification. It does not reduce the balance yet.',
      data: created,
    });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 404) {
      res.status(404).json({ error: 'SUBSCRIPTION_NOT_FOUND' });
      return;
    }
    handleError(res, error);
  }
});

router.post('/subscription-payments/:paymentId/verify', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  const context = getContext(req);
  if (!context) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const paymentId = parseId(req.params.paymentId);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const decision = textValue(body.decision)?.toUpperCase();
  const verificationNotes = optionalText(body, 'verificationNotes');

  if (!paymentId || !['VERIFIED', 'REJECTED'].includes(decision ?? '')) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Decision must be VERIFIED or REJECTED.',
    });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(schema.facilitySubscriptionPayments)
        .where(eq(schema.facilitySubscriptionPayments.id, paymentId))
        .for('update')
        .limit(1);

      if (!payment) {
        throw Object.assign(new Error('Payment not found.'), { statusCode: 404 });
      }
      if (payment.verificationStatus !== 'PENDING') {
        throw Object.assign(new Error('Payment has already been reviewed.'), { statusCode: 409 });
      }

      const [period] = await tx
        .select()
        .from(schema.facilitySubscriptionPeriods)
        .where(eq(schema.facilitySubscriptionPeriods.id, payment.subscriptionPeriodId))
        .for('update')
        .limit(1);

      if (!period || period.tenantId !== payment.tenantId ||
          period.facilityId !== payment.facilityId) {
        throw Object.assign(new Error('Payment subscription references are inconsistent.'), {
          statusCode: 409,
        });
      }

      const [updatedPayment] = await tx
        .update(schema.facilitySubscriptionPayments)
        .set({
          verificationStatus: decision!,
          verifiedBy: auditActor(context),
          verifiedAt: new Date(),
          verificationNotes: verificationNotes ?? null,
        })
        .where(eq(schema.facilitySubscriptionPayments.id, paymentId))
        .returning();

      const verifiedPayments = await tx
        .select({ amount: schema.facilitySubscriptionPayments.amount })
        .from(schema.facilitySubscriptionPayments)
        .where(and(
          eq(schema.facilitySubscriptionPayments.subscriptionPeriodId, period.id),
          eq(schema.facilitySubscriptionPayments.tenantId, period.tenantId),
          eq(schema.facilitySubscriptionPayments.facilityId, period.facilityId),
          eq(schema.facilitySubscriptionPayments.verificationStatus, 'VERIFIED'),
        ));

      // Recalculate after either decision, using verified payments only.
      const paidCents = verifiedPayments.reduce(
        (total, item) => total + Math.round(Number(item.amount) * 100),
        0,
      );
      const dueCents = Math.round(Number(period.amountDue) * 100);
      const nextStatus = paidCents >= dueCents ? 'PAID' :
        paidCents > 0 ? 'PARTIALLY_PAID' : 'PENDING';

      const [updatedPeriod] = await tx
        .update(schema.facilitySubscriptionPeriods)
        .set({
          status: nextStatus,
          updatedBy: auditActor(context),
          updatedAt: new Date(),
        })
        .where(eq(schema.facilitySubscriptionPeriods.id, period.id))
        .returning();

      await tx.insert(schema.auditLogs).values({
        tenantId: payment.tenantId,
        facilityId: payment.facilityId,
        userId: auditActor(context),
        action: decision === 'VERIFIED' ? 'VERIFY' : 'REJECT',
        resource: 'FACILITY_SUBSCRIPTION_PAYMENT',
        resourceId: String(payment.id),
        details: `Payment ${payment.transactionCode} was ${decision}. Notes: ${verificationNotes ?? 'None provided'}.`,
        severity: decision === 'REJECTED' ? 'WARNING' : 'INFO',
      });

      return { payment: updatedPayment, period: updatedPeriod };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 404) {
      res.status(404).json({ error: 'PAYMENT_NOT_FOUND' });
      return;
    }
    if (statusCode === 409) {
      res.status(409).json({
        error: 'PAYMENT_REVIEW_CONFLICT',
        message: 'The payment was already reviewed or its subscription references are inconsistent.',
      });
      return;
    }
    handleError(res, error);
  }
});

router.post('/subscription-periods/:id/suspend', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  const context = getContext(req);
  if (!context) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const periodId = parseId(req.params.id);
  const reason = textValue((req.body ?? {}).reason);

  if (!periodId || !reason || reason.length > 1000) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Provide a subscription ID and a suspension reason of up to 1000 characters.',
    });
    return;
  }

  try {
    const access = await db.transaction(async (tx) => {
      const [period] = await tx
        .select()
        .from(schema.facilitySubscriptionPeriods)
        .where(eq(schema.facilitySubscriptionPeriods.id, periodId))
        .for('update')
        .limit(1);

      if (!period) {
        throw Object.assign(new Error('Subscription not found.'), { statusCode: 404 });
      }

      // Only allow suspension for a genuinely overdue period with a balance.
      const suspensionDeadline = String(
        period.gracePeriodEnd ?? period.dueDate
      ).slice(0, 10);

      const suspensionDateParts = new Intl.DateTimeFormat('en', {
        timeZone: 'Africa/Nairobi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date());

      const suspensionDatePart = (type: string) =>
        suspensionDateParts.find((part) => part.type === type)?.value ?? '';

      const suspensionToday =
        `${suspensionDatePart('year')}-${suspensionDatePart('month')}-${suspensionDatePart('day')}`;

      if (suspensionToday <= suspensionDeadline) {
        throw Object.assign(
          new Error('This subscription has not passed its due date and grace period.'),
          { statusCode: 422 }
        );
      }

      const suspensionPayments = await tx
        .select({
          amount: schema.facilitySubscriptionPayments.amount,
        })
        .from(schema.facilitySubscriptionPayments)
        .where(and(
          eq(schema.facilitySubscriptionPayments.subscriptionPeriodId, period.id),
          eq(schema.facilitySubscriptionPayments.facilityId, period.facilityId),
          eq(schema.facilitySubscriptionPayments.tenantId, period.tenantId),
          eq(schema.facilitySubscriptionPayments.verificationStatus, 'VERIFIED'),
        ));

      const suspensionPaidCents = suspensionPayments.reduce(
        (total, payment) => total + Math.round(Number(payment.amount) * 100),
        0,
      );
      const suspensionDueCents = Math.round(Number(period.amountDue) * 100);

      if (suspensionPaidCents >= suspensionDueCents) {
        throw Object.assign(
          new Error('This subscription has no outstanding balance.'),
          { statusCode: 422 }
        );
      }

      const [existing] = await tx
        .select()
        .from(schema.facilitySubscriptionAccess)
        .where(eq(schema.facilitySubscriptionAccess.facilityId, period.facilityId))
        .for('update')
        .limit(1);

      if (existing && existing.tenantId !== period.tenantId) {
        throw Object.assign(new Error('Facility tenant mismatch.'), { statusCode: 409 });
      }
      if (existing?.accessStatus === 'SUSPENDED') {
        throw Object.assign(new Error('Facility is already suspended.'), { statusCode: 409 });
      }

      const now = new Date();
      let updated;

      if (existing) {
        const [row] = await tx
          .update(schema.facilitySubscriptionAccess)
          .set({
            accessStatus: 'SUSPENDED',
            suspendedAt: now,
            suspendedBy: auditActor(context),
            suspensionReason: reason,
            updatedBy: auditActor(context),
            updatedAt: now,
          })
          .where(eq(schema.facilitySubscriptionAccess.id, existing.id))
          .returning();
        updated = row;
      } else {
        const [row] = await tx
          .insert(schema.facilitySubscriptionAccess)
          .values({
            tenantId: period.tenantId,
            facilityId: period.facilityId,
            accessStatus: 'SUSPENDED',
            suspendedAt: now,
            suspendedBy: auditActor(context),
            suspensionReason: reason,
            createdBy: auditActor(context),
            updatedBy: auditActor(context),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        updated = row;
      }

      await tx.insert(schema.auditLogs).values({
        tenantId: period.tenantId,
        facilityId: period.facilityId,
        userId: auditActor(context),
        action: 'SUSPEND',
        resource: 'FACILITY_SUBSCRIPTION_ACCESS',
        resourceId: String(period.facilityId),
        details: 'Facility access suspended through subscription period ' + period.id + '. Reason: ' + reason,
        severity: 'HIGH',
      });

      return updated;
    });

    res.json({ success: true, data: access });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 404) {
      res.status(404).json({ error: 'SUBSCRIPTION_NOT_FOUND' });
      return;
    }
    if (statusCode === 409) {
      res.status(409).json({ error: 'FACILITY_ACCESS_CONFLICT' });
      return;
    }
    if (statusCode === 422) {
      res.status(422).json({
        error: 'SUBSCRIPTION_NOT_ELIGIBLE_FOR_SUSPENSION',
        message: (error as Error).message,
      });
      return;
    }
    handleError(res, error);
  }
});

router.post('/subscription-periods/:id/reactivate', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;
  const context = getContext(req);
  if (!context) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const periodId = parseId(req.params.id);
  if (!periodId) {
    res.status(400).json({ error: 'INVALID_ID' });
    return;
  }

  try {
    const access = await db.transaction(async (tx) => {
      const [period] = await tx
        .select()
        .from(schema.facilitySubscriptionPeriods)
        .where(eq(schema.facilitySubscriptionPeriods.id, periodId))
        .for('update')
        .limit(1);

      if (!period) {
        throw Object.assign(new Error('Subscription not found.'), { statusCode: 404 });
      }

      const [currentAccess] = await tx
        .select()
        .from(schema.facilitySubscriptionAccess)
        .where(eq(schema.facilitySubscriptionAccess.facilityId, period.facilityId))
        .for('update')
        .limit(1);

      if (!currentAccess || currentAccess.tenantId !== period.tenantId) {
        throw Object.assign(new Error('Facility access record not found.'), { statusCode: 404 });
      }
      if (currentAccess.accessStatus !== 'SUSPENDED') {
        throw Object.assign(new Error('Facility is not suspended.'), { statusCode: 409 });
      }

      const verifiedPayments = await tx
        .select({ amount: schema.facilitySubscriptionPayments.amount })
        .from(schema.facilitySubscriptionPayments)
        .where(and(
          eq(schema.facilitySubscriptionPayments.subscriptionPeriodId, period.id),
          eq(schema.facilitySubscriptionPayments.facilityId, period.facilityId),
          eq(schema.facilitySubscriptionPayments.tenantId, period.tenantId),
          eq(schema.facilitySubscriptionPayments.verificationStatus, 'VERIFIED'),
        ));

      const paidCents = verifiedPayments.reduce(
        (total, item) => total + Math.round(Number(item.amount) * 100),
        0,
      );
      const dueCents = Math.round(Number(period.amountDue) * 100);

      if (paidCents < dueCents) {
        throw Object.assign(new Error('Outstanding balance remains.'), { statusCode: 422 });
      }

      // Facility access is shared across its subscriptions. Do not reactivate
      // while any other subscription is overdue beyond its grace period.
      const facilityPeriods = await tx
        .select({
          id: schema.facilitySubscriptionPeriods.id,
          amountDue: schema.facilitySubscriptionPeriods.amountDue,
          dueDate: schema.facilitySubscriptionPeriods.dueDate,
          gracePeriodEnd: schema.facilitySubscriptionPeriods.gracePeriodEnd,
        })
        .from(schema.facilitySubscriptionPeriods)
        .where(and(
          eq(schema.facilitySubscriptionPeriods.facilityId, period.facilityId),
          eq(schema.facilitySubscriptionPeriods.tenantId, period.tenantId),
        ));

      const facilityVerifiedPayments = await tx
        .select({
          subscriptionPeriodId: schema.facilitySubscriptionPayments.subscriptionPeriodId,
          amount: schema.facilitySubscriptionPayments.amount,
        })
        .from(schema.facilitySubscriptionPayments)
        .where(and(
          eq(schema.facilitySubscriptionPayments.facilityId, period.facilityId),
          eq(schema.facilitySubscriptionPayments.tenantId, period.tenantId),
          eq(schema.facilitySubscriptionPayments.verificationStatus, 'VERIFIED'),
        ));

      const paidByPeriod = new Map<number, number>();
      for (const payment of facilityVerifiedPayments) {
        const previous = paidByPeriod.get(payment.subscriptionPeriodId) ?? 0;
        paidByPeriod.set(
          payment.subscriptionPeriodId,
          previous + Math.round(Number(payment.amount) * 100),
        );
      }

      const reactivationDateParts = new Intl.DateTimeFormat('en', {
        timeZone: 'Africa/Nairobi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date());

      const reactivationDatePart = (type: string) =>
        reactivationDateParts.find((part) => part.type === type)?.value ?? '';

      const reactivationToday =
        `${reactivationDatePart('year')}-${reactivationDatePart('month')}-${reactivationDatePart('day')}`;

      const overdueUnpaidPeriods = facilityPeriods.filter((item) => {
        const deadline = String(item.gracePeriodEnd ?? item.dueDate).slice(0, 10);
        const paid = paidByPeriod.get(item.id) ?? 0;
        const due = Math.round(Number(item.amountDue) * 100);

        return reactivationToday > deadline && paid < due;
      });

      if (overdueUnpaidPeriods.length > 0) {
        throw Object.assign(
          new Error('Other overdue subscription balances must be cleared before reactivation.'),
          { statusCode: 422 }
        );
      }

      const now = new Date();
      const [updated] = await tx
        .update(schema.facilitySubscriptionAccess)
        .set({
          accessStatus: 'ACTIVE',
          reactivatedAt: now,
          reactivatedBy: auditActor(context),
          updatedBy: auditActor(context),
          updatedAt: now,
        })
        .where(eq(schema.facilitySubscriptionAccess.id, currentAccess.id))
        .returning();

      await tx.insert(schema.auditLogs).values({
        tenantId: period.tenantId,
        facilityId: period.facilityId,
        userId: auditActor(context),
        action: 'REACTIVATE',
        resource: 'FACILITY_SUBSCRIPTION_ACCESS',
        resourceId: String(period.facilityId),
        details: 'Facility access reactivated after checking verified payments for subscription period ' + period.id + '. Verified total: ' + (paidCents / 100).toFixed(2) + ' ' + period.currency + '.',
        severity: 'HIGH',
      });

      return updated;
    });

    res.json({ success: true, data: access });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 404) {
      res.status(404).json({ error: 'SUBSCRIPTION_OR_ACCESS_NOT_FOUND' });
      return;
    }
    if (statusCode === 409) {
      res.status(409).json({ error: 'FACILITY_ACCESS_CONFLICT' });
      return;
    }
    if (statusCode === 422) {
      res.status(422).json({
        error: 'OUTSTANDING_SUBSCRIPTIONS_REMAIN',
        message: (error as Error).message,
      });
      return;
    }
    handleError(res, error);
  }
});
router.post('/subscription-periods/:id/price-changes', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;

  const context = getContext(req);
  if (!context) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  const periodId = parseId(req.params.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const newAmountCents = parseMoneyCents(body.newAmount);
  const effectiveTiming = textValue(body.effectiveTiming)?.toUpperCase();
  const reason = textValue(body.reason);

  if (
    !periodId ||
    newAmountCents === null ||
    newAmountCents <= 0 ||
    !['CURRENT_PERIOD', 'NEXT_PERIOD'].includes(effectiveTiming ?? '') ||
    !reason ||
    reason.length > 1000
  ) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Provide a valid subscription ID, positive fee, effective timing, and reason of up to 1000 characters.',
    });
    return;
  }

  const newAmount = newAmountCents / 100;

  const shiftDate = (value: string, days: number): string => {
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };

  const daysBetween = (start: string, end: string): number => {
    const startMs = new Date(`${String(start).slice(0, 10)}T00:00:00.000Z`).getTime();
    const endMs = new Date(`${String(end).slice(0, 10)}T00:00:00.000Z`).getTime();
    return Math.round((endMs - startMs) / 86400000);
  };

  try {
    const result = await db.transaction(async (tx) => {
      const [period] = await tx
        .select()
        .from(schema.facilitySubscriptionPeriods)
        .where(eq(schema.facilitySubscriptionPeriods.id, periodId))
        .for('update')
        .limit(1);

      if (!period) {
        throw Object.assign(new Error('Subscription not found.'), { statusCode: 404 });
      }

      const [facility] = await tx
        .select({
          id: schema.facilities.id,
          tenantId: schema.facilities.tenantId,
        })
        .from(schema.facilities)
        .where(eq(schema.facilities.id, period.facilityId))
        .limit(1);

      if (!facility || facility.tenantId !== period.tenantId) {
        throw Object.assign(new Error('Subscription facility and tenant do not match.'), {
          statusCode: 409,
        });
      }

      const verifiedPayments = await tx
        .select({ amount: schema.facilitySubscriptionPayments.amount })
        .from(schema.facilitySubscriptionPayments)
        .where(and(
          eq(schema.facilitySubscriptionPayments.subscriptionPeriodId, period.id),
          eq(schema.facilitySubscriptionPayments.facilityId, period.facilityId),
          eq(schema.facilitySubscriptionPayments.tenantId, period.tenantId),
          eq(schema.facilitySubscriptionPayments.verificationStatus, 'VERIFIED'),
        ));

      const paidCents = verifiedPayments.reduce(
        (total, payment) => total + Math.round(Number(payment.amount) * 100),
        0,
      );

      const previousAmount = Number(period.amountDue);
      let changedPeriod = period;

      if (effectiveTiming === 'CURRENT_PERIOD') {
        if (paidCents > newAmountCents) {
          throw Object.assign(
            new Error('The new fee cannot be lower than payments already verified for this period.'),
            { statusCode: 422 },
          );
        }

        const nextStatus =
          paidCents >= newAmountCents ? 'PAID' :
          paidCents > 0 ? 'PARTIALLY_PAID' : 'PENDING';

        const [updatedPeriod] = await tx
          .update(schema.facilitySubscriptionPeriods)
          .set({
            amountDue: newAmount.toFixed(2),
            status: nextStatus,
            updatedBy: auditActor(context),
            updatedAt: new Date(),
          })
          .where(eq(schema.facilitySubscriptionPeriods.id, period.id))
          .returning();

        changedPeriod = updatedPeriod;
      } else {
        const start = String(period.periodStart).slice(0, 10);
        const end = String(period.periodEnd).slice(0, 10);
        const due = String(period.dueDate).slice(0, 10);
        const grace = period.gracePeriodEnd
          ? String(period.gracePeriodEnd).slice(0, 10)
          : null;

        const durationDays = daysBetween(start, end);
        const dueOffset = daysBetween(start, due);
        const graceOffset = grace ? daysBetween(start, grace) : null;

        if (
          durationDays < 0 ||
          dueOffset < 0 ||
          (graceOffset !== null && graceOffset < dueOffset)
        ) {
          throw Object.assign(
            new Error('The existing subscription dates are invalid. Correct them before changing the fee.'),
            { statusCode: 422 },
          );
        }

        const nextStart = shiftDate(end, 1);
        const nextEnd = shiftDate(nextStart, durationDays);
        const nextDue = shiftDate(nextStart, dueOffset);
        const nextGrace = graceOffset === null
          ? null
          : shiftDate(nextStart, graceOffset);

        const existingPeriods = await tx
          .select({
            id: schema.facilitySubscriptionPeriods.id,
            periodStart: schema.facilitySubscriptionPeriods.periodStart,
            periodEnd: schema.facilitySubscriptionPeriods.periodEnd,
          })
          .from(schema.facilitySubscriptionPeriods)
          .where(and(
            eq(schema.facilitySubscriptionPeriods.tenantId, period.tenantId),
            eq(schema.facilitySubscriptionPeriods.facilityId, period.facilityId),
          ));

        const overlaps = existingPeriods.some((existing) => {
          if (existing.id === period.id) return false;

          const existingStart = String(existing.periodStart).slice(0, 10);
          const existingEnd = String(existing.periodEnd).slice(0, 10);

          return existingStart <= nextEnd && existingEnd >= nextStart;
        });

        if (overlaps) {
          throw Object.assign(
            new Error('Another subscription period already overlaps the proposed next period.'),
            { statusCode: 409 },
          );
        }

        const [createdPeriod] = await tx
          .insert(schema.facilitySubscriptionPeriods)
          .values({
            tenantId: period.tenantId,
            facilityId: period.facilityId,
            subscriptionName: period.subscriptionName,
            amountDue: newAmount.toFixed(2),
            currency: period.currency,
            periodStart: nextStart,
            periodEnd: nextEnd,
            dueDate: nextDue,
            gracePeriodEnd: nextGrace,
            status: 'PENDING',
            notes: `Fee revised from KES ${previousAmount.toFixed(2)}. Reason: ${reason}`,
            createdBy: auditActor(context),
            updatedBy: auditActor(context),
          })
          .returning();

        changedPeriod = createdPeriod;
      }

      const [priceChange] = await tx
        .insert(schema.facilitySubscriptionPriceChanges)
        .values({
          tenantId: period.tenantId,
          facilityId: period.facilityId,
          subscriptionPeriodId: changedPeriod.id,
          previousAmount: previousAmount.toFixed(2),
          newAmount: newAmount.toFixed(2),
          effectiveTiming: effectiveTiming!,
          reason,
          changedBy: auditActor(context),
        })
        .returning();

      await tx.insert(schema.auditLogs).values({
        tenantId: period.tenantId,
        facilityId: period.facilityId,
        userId: auditActor(context),
        action: 'UPDATE',
        resource: 'FACILITY_SUBSCRIPTION_PRICE',
        resourceId: String(priceChange.id),
        details:
          `Subscription fee changed from KES ${previousAmount.toFixed(2)} to KES ${newAmount.toFixed(2)}. ` +
          `Timing: ${effectiveTiming}. Period ID: ${changedPeriod.id}. Reason: ${reason}`,
        severity: 'HIGH',
      });

      return { period: changedPeriod, priceChange };
    });

    res.status(200).json({
      success: true,
      message: effectiveTiming === 'CURRENT_PERIOD'
        ? 'Current subscription fee updated.'
        : 'Next subscription period created with the revised fee.',
      data: result,
    });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;

    if (statusCode === 404) {
      res.status(404).json({ error: 'SUBSCRIPTION_NOT_FOUND' });
      return;
    }

    if (statusCode === 409) {
      res.status(409).json({
        error: 'SUBSCRIPTION_CONFLICT',
        message: (error as Error).message,
      });
      return;
    }

    if (statusCode === 422) {
      res.status(422).json({
        error: 'PRICE_CHANGE_NOT_ALLOWED',
        message: (error as Error).message,
      });
      return;
    }

    handleError(res, error);
  }
});

// ============================================================
// RBAC: DATABASE-BACKED ROLE AND PERMISSION MANAGEMENT
// ============================================================

function isFacilityAdminContext(context: AuthorizationContext): boolean {
  return context.isSuperAdmin !== true &&
    context.tenantId !== null &&
    context.tenantId !== undefined &&
    context.roles.includes('FACILITY_ADMIN');
}

function isRestrictedForFacilityAdmin(permission: {
  code: string;
  module: string;
}): boolean {
  const code = permission.code.toLowerCase();
  const module = permission.module.toLowerCase();

  return [
    'platform',
    'tenants',
    'subscriptions',
    'security',
    'rbac',
  ].includes(module) ||
    code.startsWith('platform.') ||
    code.startsWith('tenants.') ||
    code.startsWith('subscriptions.') ||
    code.startsWith('permissions.') ||
    code.startsWith('users.roles.') ||
    [
      'roles.manage',
      'roles.create',
      'roles.update',
      'roles.delete',
    ].includes(code);
}

/**
 * GET /api/platform/rbac/roles
 * Return real database roles, their current permission assignments,
 * and the permission catalogue.
 */
router.get('/rbac/roles', async (req: Request, res: Response) => {
  const context = getContext(req);

  if (!context || (
    context.isSuperAdmin !== true &&
    !isFacilityAdminContext(context)
  )) {
    res.status(403).json({
      error: 'FORBIDDEN',
      message: 'You are not authorized to view role permissions.',
    });
    return;
  }

  const facilityId = Number(req.query.facilityId);

  if (!Number.isSafeInteger(facilityId) || facilityId < 1) {
    res.status(400).json({
      error: 'INVALID_FACILITY_ID',
      message: 'A valid facilityId query parameter is required.',
    });
    return;
  }

  try {
    const [facility] = await db
      .select()
      .from(schema.facilities)
      .where(eq(schema.facilities.id, facilityId))
      .limit(1);

    if (!facility) {
      res.status(404).json({
        error: 'FACILITY_NOT_FOUND',
        message: 'The selected facility was not found.',
      });
      return;
    }

    if (
      context.isSuperAdmin !== true &&
      (
        facility.tenantId !== context.tenantId ||
        (context.facilityId !== null && context.facilityId !== facility.id)
      )
    ) {
      res.status(403).json({
        error: 'FACILITY_OUT_OF_SCOPE',
        message: 'You are not authorized to manage this facility.',
      });
      return;
    }

    /*
     * This editor manages tenant roles only. Global/platform roles must
     * not receive facility-specific overrides.
     */
    const roleRows = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.tenantId, facility.tenantId))
      .orderBy(schema.roles.name);

    const permissionRows = await db
      .select()
      .from(schema.permissions)
      .orderBy(schema.permissions.module, schema.permissions.code);

    const roleIds = roleRows.map((role) => role.id);

    const defaults = roleIds.length > 0
      ? await db
          .select()
          .from(schema.rolePermissions)
          .where(inArray(schema.rolePermissions.roleId, roleIds))
      : [];

    const overrides = roleIds.length > 0
      ? await db
          .select()
          .from(schema.facilityRolePermissionOverrides)
          .where(and(
            eq(schema.facilityRolePermissionOverrides.tenantId, facility.tenantId),
            eq(schema.facilityRolePermissionOverrides.facilityId, facility.id),
            inArray(schema.facilityRolePermissionOverrides.roleId, roleIds),
          ))
      : [];

    const overrideIds = overrides.map((override) => override.id);

    const overrideAssignments = overrideIds.length > 0
      ? await db
          .select()
          .from(schema.facilityRolePermissionOverridePermissions)
          .where(inArray(
            schema.facilityRolePermissionOverridePermissions.overrideId,
            overrideIds,
          ))
      : [];

    const defaultsByRole = new Map<number, number[]>();
    for (const assignment of defaults) {
      const ids = defaultsByRole.get(assignment.roleId) ?? [];
      ids.push(assignment.permissionId);
      defaultsByRole.set(assignment.roleId, ids);
    }

    const overrideByRole = new Map<number, number>();
    for (const override of overrides) {
      overrideByRole.set(override.roleId, override.id);
    }

    const overridePermissionsById = new Map<number, number[]>();
    for (const assignment of overrideAssignments) {
      const ids = overridePermissionsById.get(assignment.overrideId) ?? [];
      ids.push(assignment.permissionId);
      overridePermissionsById.set(assignment.overrideId, ids);
    }

    const assignedRoleRows = await db
      .select({ roleId: schema.userRoles.roleId })
      .from(schema.userRoles)
      .where(and(
        eq(schema.userRoles.userId, context.userId),
        eq(schema.userRoles.isActive, true),
        isNull(schema.userRoles.revokedAt),
      ));

    const assignedRoleIds = new Set(
      assignedRoleRows.map((assignment) => assignment.roleId),
    );

    const rolesWithPermissions = roleRows.map((role) => {
      const roleName = role.name.toUpperCase();

      const isPlatformProtectedRole =
        role.tenantId === null ||
        [
          'SUPER_ADMIN',
          'PLATFORM_ADMIN',
          'PLATFORM_ADMINISTRATOR',
          'TENANT_ADMIN',
        ].includes(roleName);

      // Super Admin may override FACILITY_ADMIN permissions for a tenant
      // facility. Other system roles and platform-level roles stay protected.
      const canEdit = context.isSuperAdmin === true
        ? !isPlatformProtectedRole &&
          (!role.isSystem || roleName === 'FACILITY_ADMIN')
        : !isPlatformProtectedRole &&
          role.isSystem !== true &&
          roleName !== 'FACILITY_ADMIN' &&
          role.tenantId === context.tenantId &&
          !assignedRoleIds.has(role.id);

      const overrideId = overrideByRole.get(role.id);
      const hasFacilityOverride = overrideId !== undefined;

      // An existing empty override intentionally means no permissions.
      const effectivePermissionIds = hasFacilityOverride
        ? (overridePermissionsById.get(overrideId!) ?? [])
        : (defaultsByRole.get(role.id) ?? []);

      return {
        id: role.id,
        name: role.name,
        description: role.description,
        tenantId: role.tenantId,
        isSystem: role.isSystem,
        isActive: role.isActive,
        permissionIds: effectivePermissionIds,
        permissionCodes: permissionRows
          .filter((permission) => effectivePermissionIds.includes(permission.id))
          .map((permission) => permission.code),
        hasFacilityOverride,
        canEdit,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        roles: rolesWithPermissions,
        permissions: permissionRows.map((permission) => ({
          id: permission.id,
          code: permission.code,
          name: permission.name,
          module: permission.module,
          description: permission.description,
          assignable: context.isSuperAdmin === true ||
            !isRestrictedForFacilityAdmin(permission),
        })),
      },
    });
  } catch (error) {
    handleError(res, error);
  }
});

/**
 * PUT /api/platform/rbac/roles/:id/permissions
 * Save a facility-specific permission override without changing shared defaults.
 */
router.put(
  '/rbac/roles/:id/permissions',
  async (req: Request, res: Response) => {
    const context = getContext(req);

    if (!context || (
      context.isSuperAdmin !== true &&
      !isFacilityAdminContext(context)
    )) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'You are not authorized to edit role permissions.',
      });
      return;
    }

    const roleId = parseId(req.params.id);
    const facilityId = Number(req.body?.facilityId);
    const permissionIdsUnknown = req.body?.permissionIds;

    if (roleId === null) {
      res.status(400).json({
        error: 'INVALID_ROLE_ID',
        message: 'A valid role ID is required.',
      });
      return;
    }

    if (!Number.isSafeInteger(facilityId) || facilityId < 1) {
      res.status(400).json({
        error: 'INVALID_FACILITY_ID',
        message: 'A valid facilityId is required.',
      });
      return;
    }

    if (
      !Array.isArray(permissionIdsUnknown) ||
      permissionIdsUnknown.some(
        (id: unknown) =>
          typeof id !== 'number' ||
          !Number.isSafeInteger(id) ||
          id < 1,
      )
    ) {
      res.status(400).json({
        error: 'INVALID_PERMISSION_IDS',
        message: 'permissionIds must be an array of positive integer IDs.',
      });
      return;
    }

    const permissionIds = [...new Set(permissionIdsUnknown as number[])];

    if (permissionIds.length !== permissionIdsUnknown.length) {
      res.status(400).json({
        error: 'DUPLICATE_PERMISSION_IDS',
        message: 'Each permission may only be selected once.',
      });
      return;
    }

    try {
      const [facility] = await db
        .select()
        .from(schema.facilities)
        .where(eq(schema.facilities.id, facilityId))
        .limit(1);

      if (!facility) {
        res.status(404).json({
          error: 'FACILITY_NOT_FOUND',
          message: 'The selected facility was not found.',
        });
        return;
      }

      if (
        context.isSuperAdmin !== true &&
        (
          facility.tenantId !== context.tenantId ||
          (context.facilityId !== null && context.facilityId !== facility.id)
        )
      ) {
        res.status(403).json({
          error: 'FACILITY_OUT_OF_SCOPE',
          message: 'You are not authorized to manage this facility.',
        });
        return;
      }

      const [role] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.id, roleId))
        .limit(1);

      if (!role) {
        res.status(404).json({
          error: 'ROLE_NOT_FOUND',
          message: 'The requested role was not found.',
        });
        return;
      }

      // Only roles belonging to the selected facility's tenant can be overridden.
      if (role.tenantId !== facility.tenantId) {
        res.status(403).json({
          error: 'ROLE_OUT_OF_SCOPE',
          message: 'Only roles belonging to the facility tenant can be overridden.',
        });
        return;
      }

      if (context.isSuperAdmin !== true) {
        const isForbiddenRole =
          role.isSystem === true ||
          [
            'SUPER_ADMIN',
            'PLATFORM_ADMIN',
            'PLATFORM_ADMINISTRATOR',
            'FACILITY_ADMIN',
            'TENANT_ADMIN',
          ].includes(role.name.toUpperCase());

        if (isForbiddenRole) {
          res.status(403).json({
            error: 'ROLE_OUT_OF_SCOPE',
            message: 'Facility administrators may edit only eligible staff roles.',
          });
          return;
        }

        const [selfAssignment] = await db
          .select({ id: schema.userRoles.id })
          .from(schema.userRoles)
          .where(and(
            eq(schema.userRoles.userId, context.userId),
            eq(schema.userRoles.roleId, role.id),
            eq(schema.userRoles.isActive, true),
            isNull(schema.userRoles.revokedAt),
          ))
          .limit(1);

        if (selfAssignment) {
          res.status(403).json({
            error: 'SELF_ROLE_MODIFICATION_BLOCKED',
            message: 'You cannot modify a role assigned to your own account.',
          });
          return;
        }
      }

      const requestedPermissions = permissionIds.length > 0
        ? await db
            .select()
            .from(schema.permissions)
            .where(inArray(schema.permissions.id, permissionIds))
        : [];

      if (requestedPermissions.length !== permissionIds.length) {
        res.status(400).json({
          error: 'UNKNOWN_PERMISSION',
          message: 'One or more selected permissions do not exist.',
        });
        return;
      }

      if (
        context.isSuperAdmin !== true &&
        requestedPermissions.some(isRestrictedForFacilityAdmin)
      ) {
        res.status(403).json({
          error: 'PRIVILEGED_PERMISSION_BLOCKED',
          message: 'Facility administrators cannot grant platform, tenant-administration, or RBAC-management permissions.',
        });
        return;
      }

      await db.transaction(async (tx) => {
        const [existingOverride] = await tx
          .select()
          .from(schema.facilityRolePermissionOverrides)
          .where(and(
            eq(schema.facilityRolePermissionOverrides.tenantId, facility.tenantId),
            eq(schema.facilityRolePermissionOverrides.facilityId, facility.id),
            eq(schema.facilityRolePermissionOverrides.roleId, role.id),
          ))
          .limit(1);

        let overrideId: number;

        if (existingOverride) {
          overrideId = existingOverride.id;

          await tx
            .update(schema.facilityRolePermissionOverrides)
            .set({ updatedAt: new Date() })
            .where(eq(schema.facilityRolePermissionOverrides.id, overrideId));

          await tx
            .delete(schema.facilityRolePermissionOverridePermissions)
            .where(
              eq(
                schema.facilityRolePermissionOverridePermissions.overrideId,
                overrideId,
              ),
            );
        } else {
          const [createdOverride] = await tx
            .insert(schema.facilityRolePermissionOverrides)
            .values({
              tenantId: facility.tenantId,
              facilityId: facility.id,
              roleId: role.id,
            })
            .returning({
              id: schema.facilityRolePermissionOverrides.id,
            });

          overrideId = createdOverride.id;
        }

        if (permissionIds.length > 0) {
          await tx
            .insert(schema.facilityRolePermissionOverridePermissions)
            .values(permissionIds.map((permissionId) => ({
              overrideId,
              permissionId,
            })));
        }

        await tx.insert(schema.auditLogs).values({
          tenantId: facility.tenantId,
          facilityId: facility.id,
          userId: String(context.userId),
          action: 'UPDATE',
          resource: 'facility_role_permission_override',
          resourceId: String(overrideId),
          details: JSON.stringify({
            facilityId: facility.id,
            facilityName: facility.name,
            roleId: role.id,
            roleName: role.name,
            permissionIds,
            permissionCodes: requestedPermissions.map(
              (permission) => permission.code,
            ),
            hasFacilityOverride: true,
            changedBy: context.userId,
          }),
          severity: 'HIGH',
        });
      });

      res.status(200).json({
        success: true,
        message: 'Facility-specific role permissions updated successfully.',
        data: {
          facilityId: facility.id,
          roleId: role.id,
          permissionIds,
          permissionCodes: requestedPermissions.map(
            (permission) => permission.code,
          ),
          hasFacilityOverride: true,
        },
      });
    } catch (error) {
      handleError(res, error);
    }
  },
);
export default router;






