/**
 * JaliCare HMIS
 * Bootstrap Platform Administrator
 *
 * Creates the initial platform-level SUPER_ADMIN.
 *
 * SECURITY:
 * - Password is supplied through environment variables.
 * - Password is hashed with Argon2id.
 * - Plaintext password is NEVER stored in PostgreSQL.
 * - Existing passwords are NEVER overwritten.
 * - Platform administrator must not belong to a tenant/facility.
 * - Safe to run repeatedly.
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import {
  and,
  eq,
  isNull,
  or,
} from 'drizzle-orm';

import { db } from './db';

import {
  users,
  roles,
  userRoles,
} from './db/schema';

import { hashPassword } from './utils/password';


/* ============================================================
   ENVIRONMENT CONFIGURATION
   ============================================================ */

const ADMIN_USERNAME =
  process.env.ADMIN_USERNAME?.trim().toLowerCase();

const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL?.trim().toLowerCase();

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD;

const ADMIN_FULL_NAME =
  process.env.ADMIN_FULL_NAME?.trim() ||
  'JaliCare Platform Administrator';

const ADMIN_PHONE =
  process.env.ADMIN_PHONE?.trim() || null;


/* ============================================================
   VALIDATION
   ============================================================ */

function validateEnvironment(): void {
  const missing: string[] = [];

  if (!ADMIN_USERNAME) {
    missing.push('ADMIN_USERNAME');
  }

  if (!ADMIN_EMAIL) {
    missing.push('ADMIN_EMAIL');
  }

  if (!ADMIN_PASSWORD) {
    missing.push('ADMIN_PASSWORD');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  if (ADMIN_USERNAME!.length < 3) {
    throw new Error(
      'ADMIN_USERNAME must contain at least 3 characters.',
    );
  }

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      ADMIN_EMAIL!,
    )
  ) {
    throw new Error(
      'ADMIN_EMAIL does not appear to be valid.',
    );
  }

  if (ADMIN_PASSWORD!.length < 12) {
    throw new Error(
      'ADMIN_PASSWORD must contain at least 12 characters.',
    );
  }

  if (ADMIN_FULL_NAME.length < 2) {
    throw new Error(
      'ADMIN_FULL_NAME must contain at least 2 characters.',
    );
  }
}


/* ============================================================
   UID GENERATOR
   ============================================================ */

function generateUserUid(): string {
  return `usr_${randomUUID()}`;
}


/* ============================================================
   MAIN BOOTSTRAP
   ============================================================ */

async function bootstrapAdmin(): Promise<void> {
  console.log('');
  console.log('==============================================');
  console.log('JaliCare HMIS - Platform Admin Bootstrap');
  console.log('==============================================');

  validateEnvironment();

  console.log('Environment validation passed.');
  console.log('Checking platform administrator...');


  /* ==========================================================
     1. FIND EXISTING USER
     ========================================================== */

  const existingUsers = await db
    .select()
    .from(users)
    .where(
      or(
        eq(users.username, ADMIN_USERNAME!),
        eq(users.email, ADMIN_EMAIL!),
      ),
    );

  if (existingUsers.length > 1) {
    throw new Error(
      'Username/email collision detected. More than one existing user matches the supplied ADMIN_USERNAME or ADMIN_EMAIL. Resolve this manually before running bootstrap.',
    );
  }

  const existingUser =
    existingUsers.length === 1
      ? existingUsers[0]
      : null;


  /* ==========================================================
     2. VALIDATE EXISTING USER
     ========================================================== */

  if (existingUser) {
    console.log(
      `Existing user found: ${existingUser.username}`,
    );

    if (
      existingUser.username !== ADMIN_USERNAME ||
      existingUser.email.toLowerCase() !== ADMIN_EMAIL
    ) {
      throw new Error(
        'The supplied ADMIN_USERNAME and ADMIN_EMAIL do not belong to the same existing user. Bootstrap stopped for safety.',
      );
    }

    if (existingUser.tenantId !== null) {
      throw new Error(
        `Existing user "${existingUser.username}" already belongs to tenant ID ${existingUser.tenantId}. Bootstrap will NOT elevate a tenant user into a platform administrator.`,
      );
    }

    if (existingUser.facilityId !== null) {
      throw new Error(
        `Existing user "${existingUser.username}" already belongs to facility ID ${existingUser.facilityId}. Bootstrap will NOT elevate a facility user into a platform administrator.`,
      );
    }

    console.log(
      'Existing user is a platform-level account.',
    );

    console.log(
      'Existing password will NOT be overwritten.',
    );
  } else {
    console.log(
      'Platform administrator does not exist.',
    );
  }


  /* ==========================================================
     3. DATABASE TRANSACTION
     ========================================================== */

  await db.transaction(async (tx) => {

    /* ========================================================
       3A. FIND GLOBAL SUPER_ADMIN ROLE
       ======================================================== */

    let [superAdminRole] = await tx
      .select()
      .from(roles)
      .where(
        and(
          eq(roles.name, 'SUPER_ADMIN'),
          isNull(roles.tenantId),
        ),
      )
      .limit(1);


    /* ========================================================
       3B. CREATE GLOBAL SUPER_ADMIN ROLE
       ======================================================== */

    if (!superAdminRole) {
      console.log(
        'Global SUPER_ADMIN role does not exist.',
      );

      console.log(
        'Creating platform SUPER_ADMIN role...',
      );

      const insertedRoles = await tx
        .insert(roles)
        .values({
          tenantId: null,

          name: 'SUPER_ADMIN',

          description:
            'Platform administrator with system-wide administrative privileges.',

          isSystem: true,

          isActive: true,
        })
        .returning();

      if (!insertedRoles[0]) {
        throw new Error(
          'Failed to create SUPER_ADMIN role.',
        );
      }

      superAdminRole = insertedRoles[0];

      console.log(
        `SUPER_ADMIN role created. ID: ${superAdminRole.id}`,
      );

    } else {

      console.log(
        `Global SUPER_ADMIN role already exists. ID: ${superAdminRole.id}`,
      );


      /* ======================================================
         3C. NORMALIZE SYSTEM ROLE
         ====================================================== */

      if (
        superAdminRole.tenantId !== null ||
        !superAdminRole.isSystem ||
        !superAdminRole.isActive
      ) {
        console.log(
          'Normalizing SUPER_ADMIN as an active system role...',
        );

        const updatedRoles = await tx
          .update(roles)
          .set({
            tenantId: null,
            isSystem: true,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(
            eq(
              roles.id,
              superAdminRole.id,
            ),
          )
          .returning();

        if (!updatedRoles[0]) {
          throw new Error(
            'Failed to normalize SUPER_ADMIN role.',
          );
        }

        superAdminRole = updatedRoles[0];

        console.log(
          'SUPER_ADMIN role normalized successfully.',
        );
      }
    }


    /* ========================================================
       3D. CREATE PLATFORM ADMIN USER
       ======================================================== */

    let adminUser = existingUser;

    if (!adminUser) {

      console.log(
        'Generating Argon2id password hash...',
      );

      /*
       * Password hashing is centralized in password.ts.
       *
       * This guarantees that bootstrap and normal
       * registration use the same Argon2id configuration.
       */

      const passwordHash =
        await hashPassword(
          ADMIN_PASSWORD!,
        );

      console.log(
        'Argon2id password hash generated.',
      );

      console.log(
        'Creating platform administrator account...',
      );

      const insertedUsers = await tx
        .insert(users)
        .values({
          uid: generateUserUid(),

          tenantId: null,

          facilityId: null,

          username: ADMIN_USERNAME!,

          email: ADMIN_EMAIL!,

          fullName: ADMIN_FULL_NAME,

          phone: ADMIN_PHONE,

          designation:
            'Platform Administrator',

          passwordHash,

          passwordChangedAt: new Date(),

          mustChangePassword: false,

          accountStatus: 'ACTIVE',

          failedLoginAttempts: 0,

          lastFailedLoginAt: null,

          lockedUntil: null,

          lastLoginAt: null,

          lastLoginIp: null,

          lastLogoutAt: null,

          mfaEnabled: false,

          mfaRequired: false,

          mfaSecretEncrypted: null,

          securityVersion: 1,

          isActive: true,
        })
        .returning();

      if (!insertedUsers[0]) {
        throw new Error(
          'Failed to create platform administrator.',
        );
      }

      adminUser = insertedUsers[0];

      console.log(
        `Platform administrator created. User ID: ${adminUser.id}`,
      );

    } else {

      console.log(
        `Using existing platform administrator. User ID: ${adminUser.id}`,
      );
    }


    /* ========================================================
       3E. FIND EXISTING SUPER_ADMIN ASSIGNMENT
       ======================================================== */

    const existingAssignment = await tx
      .select()
      .from(userRoles)
      .where(
        and(
          eq(
            userRoles.userId,
            adminUser.id,
          ),

          eq(
            userRoles.roleId,
            superAdminRole.id,
          ),
        ),
      )
      .limit(1);


    /* ========================================================
       3F. CREATE OR REACTIVATE ASSIGNMENT
       ======================================================== */

    if (existingAssignment.length === 0) {

      console.log(
        'SUPER_ADMIN role is not assigned.',
      );

      await tx
        .insert(userRoles)
        .values({
          userId: adminUser.id,

          roleId: superAdminRole.id,

          /*
           * Bootstrap is performed by the system itself.
           *
           * assignedBy is a nullable FK to users.id,
           * therefore NULL is correct here.
           */
          assignedBy: null,

          assignedAt: new Date(),

          revokedAt: null,

          isActive: true,
        });

      console.log(
        'SUPER_ADMIN role assigned successfully.',
      );

    } else {

      const assignment =
        existingAssignment[0];

      if (
        !assignment.isActive ||
        assignment.revokedAt !== null
      ) {

        console.log(
          'Existing SUPER_ADMIN assignment is inactive/revoked.',
        );

        await tx
          .update(userRoles)
          .set({
            isActive: true,

            revokedAt: null,

            assignedAt: new Date(),
          })
          .where(
            eq(
              userRoles.id,
              assignment.id,
            ),
          );

        console.log(
          'SUPER_ADMIN assignment reactivated.',
        );

      } else {

        console.log(
          'SUPER_ADMIN role is already assigned.',
        );
      }
    }
  });


  /* ==========================================================
     4. FINAL RESULT
     ========================================================== */

  console.log('');

  console.log(
    '==============================================',
  );

  console.log(
    'BOOTSTRAP COMPLETE',
  );

  console.log(
    '==============================================',
  );

  console.log(
    `Username: ${existingUser?.username ?? ADMIN_USERNAME}`,
  );

  console.log(
    `Email:    ${existingUser?.email ?? ADMIN_EMAIL}`,
  );

  console.log(
    `User ID:  ${existingUser?.id ?? 'created successfully'}`,
  );

  console.log(
    'Tenant:   PLATFORM',
  );

  console.log(
    'Facility: PLATFORM',
  );

  console.log(
    'Role:     SUPER_ADMIN',
  );

  console.log(
    'Status:   ACTIVE',
  );

  console.log('');

  console.log(
    'The administrator password was NOT printed.',
  );

  console.log(
    'The administrator password was NOT stored in plaintext.',
  );

  console.log(
    '==============================================',
  );

  console.log('');
}


/* ============================================================
   EXECUTE
   ============================================================ */

bootstrapAdmin()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {

    console.error('');

    console.error(
      '==============================================',
    );

    console.error(
      'BOOTSTRAP FAILED',
    );

    console.error(
      '==============================================',
    );

    console.error(error);

    console.error(
      '==============================================',
    );

    console.error('');

    process.exit(1);
  });