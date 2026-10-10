
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";

import { db } from "../db";
import {
  facilityAdminInvitations,
  facilities,
  tenants,
  users,
  roles,
  rolePermissions,
  userRoles,
} from "../db/schema";
import { hashPassword } from "../utils/password";

export class FacilityAdminInvitationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly code: string = "INVITATION_ERROR",
  ) {
    super(message);
    this.name = "FacilityAdminInvitationError";
  }
}

export interface AcceptFacilityAdminInvitationInput {
  token: string;
  username: string;
  password: string;
}

function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function validateUsername(username: string): void {
  if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
    throw new FacilityAdminInvitationError(
      "Username must be 3–50 characters and contain only letters, numbers, dots, underscores, or hyphens.",
      400,
      "INVALID_USERNAME",
    );
  }
}

function assertInvitationIsUsable(invitation: {
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}): void {
  if (invitation.acceptedAt) {
    throw new FacilityAdminInvitationError(
      "This invitation has already been accepted.",
      409,
      "INVITATION_ALREADY_ACCEPTED",
    );
  }

  if (invitation.revokedAt) {
    throw new FacilityAdminInvitationError(
      "This invitation has been revoked.",
      410,
      "INVITATION_REVOKED",
    );
  }

  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new FacilityAdminInvitationError(
      "This invitation has expired. Please request a new invitation.",
      410,
      "INVITATION_EXPIRED",
    );
  }
}

/**
 * Validate a facility administrator invitation without exposing
 * its token hash or any internal database details.
 */
export async function validateFacilityAdminInvitation(token: string) {
  if (!token || token.length < 20 || token.length > 500) {
    throw new FacilityAdminInvitationError(
      "The invitation link is invalid.",
      400,
      "INVALID_INVITATION",
    );
  }

  const tokenHash = hashInvitationToken(token);

  const [invitation] = await db
    .select({
      id: facilityAdminInvitations.id,
      tenantId: facilityAdminInvitations.tenantId,
      facilityId: facilityAdminInvitations.facilityId,
      email: facilityAdminInvitations.email,
      fullName: facilityAdminInvitations.fullName,
      designation: facilityAdminInvitations.designation,
      expiresAt: facilityAdminInvitations.expiresAt,
      acceptedAt: facilityAdminInvitations.acceptedAt,
      revokedAt: facilityAdminInvitations.revokedAt,
    })
    .from(facilityAdminInvitations)
    .where(eq(facilityAdminInvitations.invitationTokenHash, tokenHash))
    .limit(1);

  if (!invitation) {
    throw new FacilityAdminInvitationError(
      "The invitation link is invalid.",
      404,
      "INVITATION_NOT_FOUND",
    );
  }

  assertInvitationIsUsable(invitation);

  const [facility] = await db
    .select({
      id: facilities.id,
      name: facilities.name,
      tenantId: facilities.tenantId,
      isActive: facilities.isActive,
    })
    .from(facilities)
    .where(eq(facilities.id, invitation.facilityId))
    .limit(1);

  if (
    !facility ||
    !facility.isActive ||
    facility.tenantId !== invitation.tenantId
  ) {
    throw new FacilityAdminInvitationError(
      "The facility associated with this invitation is unavailable.",
      409,
      "FACILITY_UNAVAILABLE",
    );
  }

  const [tenant] = await db
    .select({
      id: tenants.id,
      isActive: tenants.isActive,
    })
    .from(tenants)
    .where(eq(tenants.id, invitation.tenantId))
    .limit(1);

  if (!tenant || !tenant.isActive) {
    throw new FacilityAdminInvitationError(
      "The organization associated with this invitation is unavailable.",
      409,
      "TENANT_UNAVAILABLE",
    );
  }

  return {
    email: invitation.email,
    fullName: invitation.fullName,
    designation: invitation.designation,
    facilityName: facility.name,
    expiresAt: invitation.expiresAt,
  };
}

/**
 * Accept an invitation and create a facility-scoped administrator.
 *
 * The invitation token is stored only as a SHA-256 hash in the database.
 * The password is hashed using the project's existing Argon2id utility.
 */
export async function acceptFacilityAdminInvitation(
  input: AcceptFacilityAdminInvitationInput,
) {
  const token = input.token?.trim();
  const username = normalizeUsername(input.username ?? "");
  const password = input.password ?? "";

  if (!token || token.length < 20 || token.length > 500) {
    throw new FacilityAdminInvitationError(
      "The invitation link is invalid.",
      400,
      "INVALID_INVITATION",
    );
  }

  validateUsername(username);

  if (typeof password !== "string" || password.length < 12) {
    throw new FacilityAdminInvitationError(
      "Password must be at least 12 characters long.",
      400,
      "INVALID_PASSWORD",
    );
  }

  const tokenHash = hashInvitationToken(token);

  // Check first so we don't perform an expensive password hash
  // for an obviously invalid invitation.
  const [initialInvitation] = await db
    .select({
      id: facilityAdminInvitations.id,
      expiresAt: facilityAdminInvitations.expiresAt,
      acceptedAt: facilityAdminInvitations.acceptedAt,
      revokedAt: facilityAdminInvitations.revokedAt,
    })
    .from(facilityAdminInvitations)
    .where(eq(facilityAdminInvitations.invitationTokenHash, tokenHash))
    .limit(1);

  if (!initialInvitation) {
    throw new FacilityAdminInvitationError(
      "The invitation link is invalid.",
      404,
      "INVITATION_NOT_FOUND",
    );
  }

  assertInvitationIsUsable(initialInvitation);

  const passwordHash = await hashPassword(password);
  const now = new Date();

  try {
    return await db.transaction(async (tx) => {
      // Lock the invitation row so simultaneous acceptance requests
      // cannot successfully use the same invitation.
      const [invitation] = await tx
        .select()
        .from(facilityAdminInvitations)
        .where(
          eq(facilityAdminInvitations.invitationTokenHash, tokenHash),
        )
        .limit(1)
        .for("update");

      if (!invitation) {
        throw new FacilityAdminInvitationError(
          "The invitation link is invalid.",
          404,
          "INVITATION_NOT_FOUND",
        );
      }

      assertInvitationIsUsable(invitation);

      const [facility] = await tx
        .select()
        .from(facilities)
        .where(eq(facilities.id, invitation.facilityId))
        .limit(1);

      if (
        !facility ||
        !facility.isActive ||
        facility.tenantId !== invitation.tenantId
      ) {
        throw new FacilityAdminInvitationError(
          "The facility associated with this invitation is unavailable.",
          409,
          "FACILITY_UNAVAILABLE",
        );
      }

      const [tenant] = await tx
        .select()
        .from(tenants)
        .where(eq(tenants.id, invitation.tenantId))
        .limit(1);

      if (!tenant || !tenant.isActive) {
        throw new FacilityAdminInvitationError(
          "The organization associated with this invitation is unavailable.",
          409,
          "TENANT_UNAVAILABLE",
        );
      }

      // Check both globally unique account identifiers.
      const [existingUser] = await tx
        .select({
          id: users.id,
          email: users.email,
          username: users.username,
        })
        .from(users)
        .where(
          or(
            eq(users.email, invitation.email.toLowerCase()),
            eq(users.username, username),
          ),
        )
        .limit(1);

      if (existingUser) {
        const conflict =
          existingUser.email.toLowerCase() ===
          invitation.email.toLowerCase()
            ? "An account already exists for this invitation email."
            : "This username is already taken.";

        throw new FacilityAdminInvitationError(
          conflict,
          409,
          "ACCOUNT_CONFLICT",
        );
      }

      // Only allow the facility-admin role belonging to this tenant.
      // Never fall back to a global role or SUPER_ADMIN.
      const [facilityAdminRole] = await tx
        .select({
          id: roles.id,
          name: roles.name,
          tenantId: roles.tenantId,
        })
        .from(roles)
        .where(
          and(
            eq(roles.name, "FACILITY_ADMIN"),
            eq(roles.tenantId, invitation.tenantId),
            eq(roles.isActive, true),
          ),
        )
        .limit(1);

      if (
        !facilityAdminRole ||
        facilityAdminRole.tenantId !== invitation.tenantId ||
        facilityAdminRole.name !== "FACILITY_ADMIN"
      ) {
        throw new FacilityAdminInvitationError(
          "The facility administrator role has not been configured for this organization. Contact the platform administrator.",
          500,
          "FACILITY_ADMIN_ROLE_NOT_CONFIGURED",
        );
      }

      // Do not create an administrator whose role grants no permissions.
      const [rolePermission] = await tx
        .select({ id: rolePermissions.id })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, facilityAdminRole.id))
        .limit(1);

      if (!rolePermission) {
        throw new FacilityAdminInvitationError(
          "The facility administrator role has no permissions configured. Contact the platform administrator.",
          500,
          "FACILITY_ADMIN_PERMISSIONS_NOT_CONFIGURED",
        );
      }

      const [newUser] = await tx
        .insert(users)
        .values({
          uid: `usr_${randomUUID()}`,
          tenantId: invitation.tenantId,
          facilityId: invitation.facilityId,
          username,
          email: invitation.email.toLowerCase(),
          emailVerifiedAt: now,
          fullName: invitation.fullName,
          phone: invitation.phone,
          designation:
            invitation.designation ?? "Facility Administrator",
          passwordHash,
          passwordChangedAt: now,
          mustChangePassword: false,
          accountStatus: "ACTIVE",
          failedLoginAttempts: 0,
          mfaEnabled: false,
          mfaRequired: false,
          securityVersion: 1,
          isActive: true,
        })
        .returning({
          id: users.id,
          uid: users.uid,
          username: users.username,
          email: users.email,
          fullName: users.fullName,
          tenantId: users.tenantId,
          facilityId: users.facilityId,
        });

      if (!newUser) {
        throw new Error("User creation failed.");
      }

      await tx.insert(userRoles).values({
        userId: newUser.id,
        roleId: facilityAdminRole.id,
        assignedBy: invitation.invitedBy,
        isActive: true,
      });

      // Mark accepted only if it is still valid and unused.
      const acceptedRows = await tx
        .update(facilityAdminInvitations)
        .set({
          acceptedAt: now,
          acceptedUserId: newUser.id,
        })
        .where(
          and(
            eq(facilityAdminInvitations.id, invitation.id),
            isNull(facilityAdminInvitations.acceptedAt),
            isNull(facilityAdminInvitations.revokedAt),
            gt(facilityAdminInvitations.expiresAt, now),
          ),
        )
        .returning({
          id: facilityAdminInvitations.id,
        });

      if (acceptedRows.length !== 1) {
        throw new FacilityAdminInvitationError(
          "This invitation is no longer valid. Request a new invitation.",
          409,
          "INVITATION_NO_LONGER_VALID",
        );
      }

      // No password hash, invitation token, or session token is returned.
      return {
        success: true as const,
        message: "Your facility administrator account has been created. You can now sign in.",
        user: newUser,
      };
    });
  } catch (error) {
    if (error instanceof FacilityAdminInvitationError) {
      throw error;
    }

    // Covers unique-constraint races not caught by the earlier lookup.
    const dbError = error as { code?: string };

    if (dbError?.code === "23505") {
      throw new FacilityAdminInvitationError(
        "The username or email is already registered.",
        409,
        "ACCOUNT_CONFLICT",
      );
    }

    throw error;
  }
}
