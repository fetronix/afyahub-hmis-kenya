import { createHash, randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';

import { buildInvitationUrl, resolveInvitationBaseUrl } from '../../auth/invitation-url.ts';
import { db } from '../../db/index.ts';
import * as queries from '../../db/queries.ts';
import * as schema from '../../db/schema.ts';
import {
  createFacilityAdminInvitationSchema,
  invitationIdParamSchema,
  type CreateFacilityAdminInvitationValidated,
} from '../../validation/schemas/index.ts';
import {
  getValidatedBody,
  getValidatedParams,
  validateBody,
  validateParams,
} from '../../validation/validate.ts';
import { auditActor, getContext, handleError, requireSuperAdminMiddleware } from './shared.ts';

const router = Router();

/**
 * POST /api/platform/facility-admin-invitations
 * Create a secure invitation for a facility administrator (Platform Super Admin only).
 */
router.post(
  '/facility-admin-invitations',
  requireSuperAdminMiddleware,
  validateBody(createFacilityAdminInvitationSchema),
  async (req: Request, res: Response) => {
    const context = getContext(req)!;
    const { facilityId, fullName, email, phone } =
      getValidatedBody<CreateFacilityAdminInvitationValidated>(req);

    const resolvedBase = resolveInvitationBaseUrl(req);
    if (!resolvedBase.ok) {
      res.status(500).json({ error: 'CONFIGURATION_ERROR', message: resolvedBase.message });
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
  },
);

/**
 * GET /api/platform/facility-admin-invitations
 * List invitation metadata without exposing token hashes.
 */
router.get(
  '/facility-admin-invitations',
  requireSuperAdminMiddleware,
  async (_req: Request, res: Response) => {
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
  },
);

/**
 * POST /api/platform/facility-admin-invitations/:id/revoke
 * Revoke an invitation that has not already been accepted or revoked.
 */
router.post(
  '/facility-admin-invitations/:id/revoke',
  requireSuperAdminMiddleware,
  validateParams(invitationIdParamSchema),
  async (req: Request, res: Response) => {
    const context = getContext(req)!;
    const { id } = getValidatedParams<{ id: number }>(req);

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
  requireSuperAdminMiddleware,
  validateParams(invitationIdParamSchema),
  async (req: Request, res: Response) => {
    const context = getContext(req)!;
    const { id } = getValidatedParams<{ id: number }>(req);

    const resolvedBase = resolveInvitationBaseUrl(req);
    if (!resolvedBase.ok) {
      res.status(500).json({ error: 'CONFIGURATION_ERROR', message: resolvedBase.message });
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
  },
);

export default router;
