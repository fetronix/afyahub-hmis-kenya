import { Router, type Request, type Response } from 'express';

import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';

import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
import { STAFF_ROLE_CATALOGUE } from '../auth/staff-role-catalogue.ts';
import { buildInvitationUrl, resolveInvitationBaseUrl } from '../auth/invitation-url.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import * as queries from '../db/queries.ts';
import {
  auditActor,
  getContext,
  handleError,
  optionalText,
  parseId,
  requireSuperAdmin,
  textValue,
  validEmail,
  validSlug,
  type PlatformRequest,
} from './platform/shared.ts';
import subscriptionsRoutes from './platform/subscriptions.routes.ts';
import { bodyOf, parseFacilityUpdate, parseTenantInput } from './platform/validation.ts';
import { resolveLocation } from '../constants/kenya-locations.ts';
import {
  resolveFacilityModules,
  resolveHiddenFacilityModules,
  unknownFacilityModules,
} from '../config/facility-modules.ts';

const router = Router();

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
  'insurance.sha.read',
  'insurance.sha.eligibility.check',
  'insurance.sha.benefits.validate',
  'insurance.sha.preauthorization.create',
  'insurance.sha.claims.read',
  'insurance.sha.claims.prepare',
  'insurance.sha.claims.submit',
  'insurance.sha.claims.resubmit',
  'insurance.sha.remittance.read',
  'insurance.sha.reconciliation.manage',
  'insurance.sha.configuration.manage',
  'insurance.payers.read',
  'insurance.payers.manage',
  'insurance.members.read',
  'insurance.members.manage',
  'insurance.eligibility.check',
  'insurance.benefits.validate',
  'insurance.mappings.manage',
  'insurance.preauthorization.manage',
  'insurance.private.claims.prepare',
  'insurance.private.claims.submit',
  'insurance.private.remittance.reconcile',
  'inventory.read',
  'laboratory.read',
  'patients.create',
  'patients.read',
  'patients.update',
  'pharmacy.read',
  /*
   * Patient portal oversight. A facility administrator runs the
   * portal; the invitation codes are included because they also run
   * the desk when needed, but `portal.accounts.manage` is the one that
   * matters for the administration screen.
   */
  'portal.accounts.manage',
  'portal.audit.read',
  'portal.invite',
  'portal.invites.manage',
  'portal.settings.manage',
  'practitioners.read',
  'procurement.read',
  'reports.export',
  'reports.read',
  'roles.read',
  'users.create',
  'users.invitations.read',
  'users.invitations.revoke',
  'users.invitations.reissue',
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
  /* Validation lives in ./platform/validation.ts so the rules can be
     exercised without authentication or a database. It reproduces this
     handler's decisions exactly; the messages below are the ones it always
     returned. */
  const parsed = parseTenantInput(bodyOf(req));

  if (!parsed.ok) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: parsed.message,
    });
    return;
  }

  const {
    name,
    slug,
    domain,
    logoUrl,
    brandColor,
    contactEmail,
    contactPhone,
    currency,
    timezone,
  } = parsed.value;
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
        .where(inArray(schema.permissions.code, [...FACILITY_ADMIN_PERMISSION_CODES]));

      const foundCodes = new Set(permissionRows.map((permission) => permission.code));

      const missingCodes = FACILITY_ADMIN_PERMISSION_CODES.filter((code) => !foundCodes.has(code));

      if (missingCodes.length > 0) {
        throw new Error(`FACILITY_ADMIN_PERMISSIONS_MISSING: ${missingCodes.join(', ')}`);
      }

      // 3. Create a tenant-scoped role, never a global role.
      const [facilityAdminRole] = await tx
        .insert(schema.roles)
        .values({
          tenantId: createdTenant.id,
          name: 'FACILITY_ADMIN',
          description: 'Facility administrator for this healthcare organization.',
          isSystem: false,
          isActive: true,
        })
        .returning({
          id: schema.roles.id,
        });

      // 4. Assign the approved permission set.
      await tx.insert(schema.rolePermissions).values(
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

      const staffFoundCodes = new Set(staffPermissionRows.map((permission) => permission.code));

      const missingStaffCodes = staffPermissionCodes.filter((code) => !staffFoundCodes.has(code));

      if (missingStaffCodes.length > 0) {
        throw new Error(`STAFF_ROLE_PERMISSIONS_MISSING: ${missingStaffCodes.join(', ')}`);
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

        await tx.insert(schema.rolePermissions).values(rolePermissionRows);
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

  for (const key of ['domain', 'logoUrl', 'brandColor', 'contactPhone'] as const) {
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
      : typeof body.tenantId === 'string' && /^[1-9]\d*$/.test(body.tenantId)
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
  const mflCode = textValue(body.mflCode);
  const address = textValue(body.address);
  const phone = textValue(body.phone);

  /* The pair is checked together: a sub-county must belong to the county it
     is stored with. A facility with no county keeps the column defaults -
     that is the existing behaviour and it is a deliberate choice for
     facilities that have not been surveyed yet. Once a county is given,
     though, the sub-county is written explicitly (possibly null) so the
     Westlands default cannot be attached to, say, a Kisumu facility. */
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
});

/**
 * GET /api/platform/facilities/:id/onboarding
 * Retrieve the existing onboarding record for a facility.
 */
router.get('/facilities/:id/onboarding', async (req: Request, res: Response) => {
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
});

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

  /* Same reasoning as tenant creation: the rules moved to
     ./platform/validation.ts, unchanged, so they can be tested directly.
     A PATCH with nothing to change is rejected before it reaches the
     database or writes an audit entry saying nothing happened. */
  const parsed = parseFacilityUpdate(bodyOf(req));

  if (!parsed.ok) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: parsed.message,
    });
    return;
  }

  const updates: Partial<typeof schema.facilities.$inferInsert> = {
    ...parsed.value,
  };
  const unknown = unknownFacilityModules([
    ...(parsed.value.enabledModules ?? []),
    ...(parsed.value.hiddenModules ?? []),
  ]);
  if (unknown.length) {
    res.status(400).json({
      error: 'UNKNOWN_MODULE',
      message: 'The module list contains unknown module IDs.',
      modules: unknown,
    });
    return;
  }
  if (parsed.value.enabledModules)
    updates.enabledModules = resolveFacilityModules(parsed.value.enabledModules);
  if (parsed.value.hiddenModules)
    updates.hiddenModules = resolveHiddenFacilityModules(parsed.value.hiddenModules);

  updates.updatedAt = new Date();

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
          enabledModules: parsed.value.enabledModules ? updated.enabledModules : undefined,
          hiddenModules: parsed.value.hiddenModules ? updated.hiddenModules : undefined,
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
});

/**
 * POST /api/platform/facilities/:id/onboarding
 * Create onboarding only when no record exists.
 */
router.post('/facilities/:id/onboarding', async (req: Request, res: Response) => {
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
});

/**
 * POST /api/platform/facility-admin-invitations
 *
 * Create a secure invitation for a facility administrator.
 * Only the Platform Super Admin may issue this invitation.
 */
router.post('/facility-admin-invitations', async (req: Request, res: Response) => {
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
      message: 'Provide a valid facilityId, fullName, and email.',
    });
    return;
  }

  const resolvedBase = resolveInvitationBaseUrl(req);

  if (!resolvedBase.ok) {
    res.status(500).json({
      error: 'CONFIGURATION_ERROR',
      message: resolvedBase.message,
    });
    return;
  }

  const invitationUrl = resolvedBase.baseUrl;

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
      .innerJoin(schema.tenants, eq(schema.facilities.tenantId, schema.tenants.id))
      .where(eq(schema.facilities.id, facilityId))
      .limit(1);

    if (!facility) {
      res.status(404).json({
        error: 'FACILITY_NOT_FOUND',
        message: 'The selected facility was not found.',
      });
      return;
    }

    if (!facility.isActive || !facility.tenantActive) {
      res.status(409).json({
        error: 'FACILITY_UNAVAILABLE',
        message: 'The facility and its tenant must both be active.',
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
      .where(eq(schema.rolePermissions.roleId, facilityAdminRole.id))
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
          eq(schema.facilityAdminInvitations.facilityId, facilityId),
          eq(schema.facilityAdminInvitations.email, email),
          isNull(schema.facilityAdminInvitations.acceptedAt),
          isNull(schema.facilityAdminInvitations.revokedAt),
          gt(schema.facilityAdminInvitations.expiresAt, now),
        ),
      )
      .limit(1);

    if (existingInvitation) {
      res.status(409).json({
        error: 'INVITATION_ALREADY_PENDING',
        message: 'An unexpired invitation already exists for this email and facility.',
      });
      return;
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);

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

    const invitationLink = buildInvitationUrl(
      invitationUrl,
      '/accept-facility-admin-invitation',
      rawToken,
    );

    res.status(201).json({
      success: true,
      message: 'Facility administrator invitation created.',
      data: {
        invitationId: invitation.id,
        facilityId: facility.id,
        facilityName: facility.name,
        email: invitation.email,
        expiresAt: invitation.expiresAt,
        invitationLink,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
});

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
      .innerJoin(schema.tenants, eq(schema.facilityAdminInvitations.tenantId, schema.tenants.id))
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
router.post('/facility-admin-invitations/:id/revoke', async (req: Request, res: Response) => {
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
});

/**
 * POST /api/platform/facility-admin-invitations/:id/reissue
 * Replace the old token and extend the invitation by 48 hours.
 */
router.post('/facility-admin-invitations/:id/reissue', async (req: Request, res: Response) => {
  if (!requireSuperAdmin(req, res)) return;

  const context = getContext(req)!;
  const id = parseId(req.params.id);

  if (!id) {
    res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid invitation ID.' });
    return;
  }

  const resolvedBase = resolveInvitationBaseUrl(req);

  if (!resolvedBase.ok) {
    res.status(500).json({
      error: 'CONFIGURATION_ERROR',
      message: resolvedBase.message,
    });
    return;
  }

  const invitationUrl = resolvedBase.baseUrl;

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

    const invitationLink = buildInvitationUrl(
      invitationUrl,
      '/accept-facility-admin-invitation',
      rawToken,
    );

    res.json({
      success: true,
      message: 'Invitation reissued. The previous token is no longer valid.',
      data: {
        invitationId: updated.id,
        email: updated.email,
        expiresAt: updated.expiresAt,
        invitationLink,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
});

// ============================================================
// SUBSCRIPTION BILLING
// Extracted to ./platform/subscriptions.routes.ts and mounted here, so
// the paths the client already uses do not change.
// ============================================================

router.use(subscriptionsRoutes);

// ============================================================
// RBAC: DATABASE-BACKED ROLE AND PERMISSION MANAGEMENT
// ============================================================

function isFacilityAdminContext(context: AuthorizationContext): boolean {
  return (
    context.isSuperAdmin !== true &&
    context.tenantId !== null &&
    context.tenantId !== undefined &&
    context.roles.includes('FACILITY_ADMIN')
  );
}

function isRestrictedForFacilityAdmin(permission: { code: string; module: string }): boolean {
  const code = permission.code.toLowerCase();
  const module = permission.module.toLowerCase();

  return (
    ['platform', 'tenants', 'subscriptions', 'security', 'rbac'].includes(module) ||
    code.startsWith('platform.') ||
    code.startsWith('tenants.') ||
    code.startsWith('subscriptions.') ||
    code.startsWith('permissions.') ||
    code.startsWith('users.roles.') ||
    ['roles.manage', 'roles.create', 'roles.update', 'roles.delete'].includes(code)
  );
}

/**
 * GET /api/platform/rbac/roles
 * Return real database roles, their current permission assignments,
 * and the permission catalogue.
 */
router.get('/rbac/roles', async (req: Request, res: Response) => {
  const context = getContext(req);

  if (!context || (context.isSuperAdmin !== true && !isFacilityAdminContext(context))) {
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
      (facility.tenantId !== context.tenantId ||
        (context.facilityId !== null && context.facilityId !== facility.id))
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

    const defaults =
      roleIds.length > 0
        ? await db
            .select()
            .from(schema.rolePermissions)
            .where(inArray(schema.rolePermissions.roleId, roleIds))
        : [];

    const overrides =
      roleIds.length > 0
        ? await db
            .select()
            .from(schema.facilityRolePermissionOverrides)
            .where(
              and(
                eq(schema.facilityRolePermissionOverrides.tenantId, facility.tenantId),
                eq(schema.facilityRolePermissionOverrides.facilityId, facility.id),
                inArray(schema.facilityRolePermissionOverrides.roleId, roleIds),
              ),
            )
        : [];

    const overrideIds = overrides.map((override) => override.id);

    const overrideAssignments =
      overrideIds.length > 0
        ? await db
            .select()
            .from(schema.facilityRolePermissionOverridePermissions)
            .where(
              inArray(schema.facilityRolePermissionOverridePermissions.overrideId, overrideIds),
            )
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
      .where(
        and(
          eq(schema.userRoles.userId, context.userId),
          eq(schema.userRoles.isActive, true),
          isNull(schema.userRoles.revokedAt),
        ),
      );

    const assignedRoleIds = new Set(assignedRoleRows.map((assignment) => assignment.roleId));

    const rolesWithPermissions = roleRows.map((role) => {
      const roleName = role.name.toUpperCase();

      const isPlatformProtectedRole =
        role.tenantId === null ||
        ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'PLATFORM_ADMINISTRATOR', 'TENANT_ADMIN'].includes(
          roleName,
        );

      // Super Admin may override FACILITY_ADMIN permissions for a tenant
      // facility. Other system roles and platform-level roles stay protected.
      const canEdit =
        context.isSuperAdmin === true
          ? !isPlatformProtectedRole && (!role.isSystem || roleName === 'FACILITY_ADMIN')
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

    /*
     * Catalogue coverage.
     *
     * Roles are tenant-scoped, so a tenant created before a role was
     * added to the catalogue simply does not have it: the role exists in
     * the code, is offered by the invitation form, and cannot be granted
     * to anyone. That is a silent hole, so the editor asks for it
     * explicitly instead of hoping someone reads a script header.
     *
     * Drift is reported separately from absence. A role that exists but
     * lacks catalogue permissions may have been trimmed on purpose, so
     * nothing is re-granted without the admin asking for it by name.
     */
    const permissionIdByCode = new Map(
      permissionRows.map((permission) => [permission.code, permission.id]),
    );

    const roleRowByName = new Map(roleRows.map((role) => [role.name.trim().toUpperCase(), role]));

    const catalogueCoverage = STAFF_ROLE_CATALOGUE.map((entry) => {
      const existingRole = roleRowByName.get(entry.name);
      const assignedIds = existingRole
        ? new Set(defaultsByRole.get(existingRole.id) ?? [])
        : new Set<number>();

      const unknownPermissionCodes = entry.permissions.filter(
        (permissionCode) => !permissionIdByCode.has(permissionCode),
      );

      const missingPermissionCodes = existingRole
        ? entry.permissions.filter((permissionCode) => {
            const permissionId = permissionIdByCode.get(permissionCode);

            return permissionId !== undefined && !assignedIds.has(permissionId);
          })
        : [...entry.permissions];

      return {
        name: entry.name,
        description: entry.description,
        permissionCount: entry.permissions.length,
        permissions: [...entry.permissions],
        exists: existingRole !== undefined,
        isActive: existingRole ? existingRole.isActive : null,
        missingPermissionCodes,
        unknownPermissionCodes,
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
          assignable: context.isSuperAdmin === true || !isRestrictedForFacilityAdmin(permission),
        })),
        catalogue: {
          roleCount: STAFF_ROLE_CATALOGUE.length,
          roles: catalogueCoverage,
          missingCount: catalogueCoverage.filter((entry) => !entry.exists).length,
          driftCount: catalogueCoverage.filter(
            (entry) => entry.exists && entry.missingPermissionCodes.length > 0,
          ).length,
        },
      },
    });
  } catch (error) {
    handleError(res, error);
  }
});

/**
 * POST /api/platform/rbac/catalogue/apply
 * Create the catalogue roles this tenant does not have yet.
 *
 * Additive only. It never deletes a role, never removes a permission,
 * and never touches a role's facility override. Existing roles are
 * topped up only when the caller names them explicitly, because a
 * permission removed on purpose must not quietly come back.
 */
router.post('/rbac/catalogue/apply', async (req: Request, res: Response) => {
  const context = getContext(req);

  if (!context || (context.isSuperAdmin !== true && !isFacilityAdminContext(context))) {
    res.status(403).json({
      error: 'FORBIDDEN',
      message: 'You are not authorized to manage role permissions.',
    });
    return;
  }

  const body = (req.body ?? {}) as {
    facilityId?: unknown;
    roleNames?: unknown;
    topUpExisting?: unknown;
  };

  const facilityId = Number(body.facilityId);

  if (!Number.isSafeInteger(facilityId) || facilityId < 1) {
    res.status(400).json({
      error: 'INVALID_FACILITY_ID',
      message: 'A valid facilityId is required.',
    });
    return;
  }

  const topUpExisting = body.topUpExisting === true;

  let requestedNames: string[] | null = null;

  if (body.roleNames !== undefined) {
    if (!Array.isArray(body.roleNames) || body.roleNames.some((name) => typeof name !== 'string')) {
      res.status(400).json({
        error: 'INVALID_ROLE_NAMES',
        message: 'roleNames must be an array of catalogue role names.',
      });
      return;
    }

    requestedNames = body.roleNames.map((name: string) => name.trim().toUpperCase());
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
      (facility.tenantId !== context.tenantId ||
        (context.facilityId !== null && context.facilityId !== facility.id))
    ) {
      res.status(403).json({
        error: 'FACILITY_OUT_OF_SCOPE',
        message: 'You are not authorized to manage this facility.',
      });
      return;
    }

    const catalogueNames = new Set<string>(STAFF_ROLE_CATALOGUE.map((entry) => entry.name));

    const unknownNames = (requestedNames ?? []).filter((name) => !catalogueNames.has(name));

    if (unknownNames.length > 0) {
      res.status(400).json({
        error: 'UNKNOWN_ROLE_NAMES',
        message: `Not in the catalogue: ${unknownNames.join(', ')}.`,
      });
      return;
    }

    const targets = STAFF_ROLE_CATALOGUE.filter((entry) =>
      requestedNames === null ? true : requestedNames.includes(entry.name),
    );

    /*
     * Every permission a catalogue role needs must already exist. They are
     * seeded, not created on the fly: inventing a permission row here
     * would produce a role that holds something no route checks.
     */
    const requiredCodes = [...new Set(targets.flatMap((entry) => [...entry.permissions]))];

    const permissionRows =
      requiredCodes.length > 0
        ? await db
            .select({
              id: schema.permissions.id,
              code: schema.permissions.code,
            })
            .from(schema.permissions)
            .where(inArray(schema.permissions.code, requiredCodes))
        : [];

    const permissionIdByCode = new Map(
      permissionRows.map((permission) => [permission.code, permission.id]),
    );

    const absentCodes = requiredCodes.filter((code) => !permissionIdByCode.has(code));

    if (absentCodes.length > 0) {
      res.status(409).json({
        error: 'CATALOGUE_PERMISSIONS_MISSING',
        message:
          'These permission codes are not seeded in this database, so the catalogue roles cannot be created: ' +
          absentCodes.join(', ') +
          '. Seed the permission catalogue before retrying.',
      });
      return;
    }

    const existingRoleRows = await db
      .select({
        id: schema.roles.id,
        name: schema.roles.name,
      })
      .from(schema.roles)
      .where(eq(schema.roles.tenantId, facility.tenantId));

    const existingByName = new Map(
      existingRoleRows.map((role) => [role.name.trim().toUpperCase(), role]),
    );

    const result = await db.transaction(async (tx) => {
      const createdRoles: string[] = [];
      const toppedUpRoles: Array<{ name: string; granted: number }> = [];
      const skippedRoles: string[] = [];
      let addedPermissionLinks = 0;

      for (const entry of targets) {
        const existing = existingByName.get(entry.name);

        if (!existing) {
          const [createdRole] = await tx
            .insert(schema.roles)
            .values({
              tenantId: facility.tenantId,
              name: entry.name,
              description: entry.description,
              isSystem: false,
              isActive: true,
            })
            .returning({ id: schema.roles.id });

          const values = entry.permissions.map((code) => ({
            roleId: createdRole.id,
            permissionId: permissionIdByCode.get(code)!,
          }));

          await tx.insert(schema.rolePermissions).values(values);

          addedPermissionLinks += values.length;
          createdRoles.push(entry.name);

          continue;
        }

        if (!topUpExisting) {
          skippedRoles.push(entry.name);
          continue;
        }

        const currentLinks = await tx
          .select({ permissionId: schema.rolePermissions.permissionId })
          .from(schema.rolePermissions)
          .where(eq(schema.rolePermissions.roleId, existing.id));

        const currentIds = new Set(currentLinks.map((link) => link.permissionId));

        const missingValues = entry.permissions
          .map((code) => permissionIdByCode.get(code)!)
          .filter((permissionId) => !currentIds.has(permissionId))
          .map((permissionId) => ({
            roleId: existing.id,
            permissionId,
          }));

        if (missingValues.length > 0) {
          await tx.insert(schema.rolePermissions).values(missingValues);

          addedPermissionLinks += missingValues.length;
          toppedUpRoles.push({
            name: entry.name,
            granted: missingValues.length,
          });
        }
      }

      return { createdRoles, toppedUpRoles, skippedRoles, addedPermissionLinks };
    });

    if (result.createdRoles.length > 0 || result.toppedUpRoles.length > 0) {
      await queries.logAuditEvent(
        facility.tenantId,
        facility.id,
        auditActor(context),
        'CREATE',
        'ROLE',
        null,
        [
          result.createdRoles.length > 0
            ? `Created catalogue roles: ${result.createdRoles.join(', ')}`
            : null,
          result.toppedUpRoles.length > 0
            ? `Granted missing catalogue permissions: ${result.toppedUpRoles
                .map((entry) => `${entry.name} (+${entry.granted})`)
                .join(', ')}`
            : null,
        ]
          .filter(Boolean)
          .join('. '),
      );
    }

    res.status(200).json({
      success: true,
      data: {
        createdRoles: result.createdRoles,
        toppedUpRoles: result.toppedUpRoles,
        skippedRoles: result.skippedRoles,
        addedPermissionLinks: result.addedPermissionLinks,
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
router.put('/rbac/roles/:id/permissions', async (req: Request, res: Response) => {
  const context = getContext(req);

  if (!context || (context.isSuperAdmin !== true && !isFacilityAdminContext(context))) {
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
      (id: unknown) => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1,
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
      (facility.tenantId !== context.tenantId ||
        (context.facilityId !== null && context.facilityId !== facility.id))
    ) {
      res.status(403).json({
        error: 'FACILITY_OUT_OF_SCOPE',
        message: 'You are not authorized to manage this facility.',
      });
      return;
    }

    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, roleId)).limit(1);

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
        .where(
          and(
            eq(schema.userRoles.userId, context.userId),
            eq(schema.userRoles.roleId, role.id),
            eq(schema.userRoles.isActive, true),
            isNull(schema.userRoles.revokedAt),
          ),
        )
        .limit(1);

      if (selfAssignment) {
        res.status(403).json({
          error: 'SELF_ROLE_MODIFICATION_BLOCKED',
          message: 'You cannot modify a role assigned to your own account.',
        });
        return;
      }
    }

    const requestedPermissions =
      permissionIds.length > 0
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

    if (context.isSuperAdmin !== true && requestedPermissions.some(isRestrictedForFacilityAdmin)) {
      res.status(403).json({
        error: 'PRIVILEGED_PERMISSION_BLOCKED',
        message:
          'Facility administrators cannot grant platform, tenant-administration, or RBAC-management permissions.',
      });
      return;
    }

    await db.transaction(async (tx) => {
      const [existingOverride] = await tx
        .select()
        .from(schema.facilityRolePermissionOverrides)
        .where(
          and(
            eq(schema.facilityRolePermissionOverrides.tenantId, facility.tenantId),
            eq(schema.facilityRolePermissionOverrides.facilityId, facility.id),
            eq(schema.facilityRolePermissionOverrides.roleId, role.id),
          ),
        )
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
          .where(eq(schema.facilityRolePermissionOverridePermissions.overrideId, overrideId));
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
        await tx.insert(schema.facilityRolePermissionOverridePermissions).values(
          permissionIds.map((permissionId) => ({
            overrideId,
            permissionId,
          })),
        );
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
          permissionCodes: requestedPermissions.map((permission) => permission.code),
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
        permissionCodes: requestedPermissions.map((permission) => permission.code),
        hasFacilityOverride: true,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
});
export default router;
