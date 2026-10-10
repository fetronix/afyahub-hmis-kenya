
import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import * as schema from '../db/schema.ts';
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
    const [tenant] = await db
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

    await queries.logAuditEvent(
      tenant.id,
      null,
      auditActor(context),
      'CREATE',
      'TENANT',
      String(tenant.id),
      `Created tenant "${tenant.name}" (${tenant.slug}).`,
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

export default router;
