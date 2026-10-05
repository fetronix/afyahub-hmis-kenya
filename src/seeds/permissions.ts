/**
 * JaliCare HMIS
 * Permission Seed
 *
 * Seeds the system-wide permission catalogue.
 *
 * Safe to run repeatedly.
 */

import 'dotenv/config';

import { db } from '../db';

import {
  permissions,
  roles,
  rolePermissions,
} from '../db/schema';

import {
  and,
  eq,
  isNull,
} from 'drizzle-orm';


/* ============================================================
   PERMISSION DEFINITIONS
   ============================================================ */

const PERMISSIONS = [

  /* ==========================================================
     PLATFORM
     ========================================================== */

  {
    code: 'platform.read',
    name: 'View Platform',
    module: 'platform',
    description:
      'View platform-wide JaliCare administration information.',
  },

  {
    code: 'platform.manage',
    name: 'Manage Platform',
    module: 'platform',
    description:
      'Manage global JaliCare platform configuration.',
  },

  {
    code: 'platform.settings.manage',
    name: 'Manage Platform Settings',
    module: 'platform',
    description:
      'Manage global platform settings.',
  },


  /* ==========================================================
     TENANTS
     ========================================================== */

  {
    code: 'tenants.read',
    name: 'View Tenants',
    module: 'tenants',
    description:
      'View registered healthcare organizations and tenants.',
  },

  {
    code: 'tenants.create',
    name: 'Create Tenants',
    module: 'tenants',
    description:
      'Create new healthcare organization tenants.',
  },

  {
    code: 'tenants.update',
    name: 'Update Tenants',
    module: 'tenants',
    description:
      'Update tenant information.',
  },

  {
    code: 'tenants.deactivate',
    name: 'Deactivate Tenants',
    module: 'tenants',
    description:
      'Deactivate a tenant organization.',
  },


  /* ==========================================================
     FACILITIES
     ========================================================== */

  {
    code: 'facilities.read',
    name: 'View Facilities',
    module: 'facilities',
    description:
      'View healthcare facilities.',
  },

  {
    code: 'facilities.create',
    name: 'Create Facilities',
    module: 'facilities',
    description:
      'Create healthcare facilities.',
  },

  {
    code: 'facilities.update',
    name: 'Update Facilities',
    module: 'facilities',
    description:
      'Update healthcare facility information.',
  },

  {
    code: 'facilities.approve',
    name: 'Approve Facilities',
    module: 'facilities',
    description:
      'Approve facility onboarding.',
  },

  {
    code: 'facilities.deactivate',
    name: 'Deactivate Facilities',
    module: 'facilities',
    description:
      'Deactivate healthcare facilities.',
  },


  /* ==========================================================
     USERS
     ========================================================== */

  {
    code: 'users.read',
    name: 'View Users',
    module: 'users',
    description:
      'View users within the authorized scope.',
  },

  {
    code: 'users.create',
    name: 'Create Users',
    module: 'users',
    description:
      'Create user accounts.',
  },

  {
    code: 'users.update',
    name: 'Update Users',
    module: 'users',
    description:
      'Update user accounts.',
  },

  {
    code: 'users.deactivate',
    name: 'Deactivate Users',
    module: 'users',
    description:
      'Deactivate user accounts.',
  },

  {
    code: 'users.roles.manage',
    name: 'Manage User Roles',
    module: 'users',
    description:
      'Assign and revoke user roles.',
  },


  /* ==========================================================
     ROLES
     ========================================================== */

  {
    code: 'roles.read',
    name: 'View Roles',
    module: 'roles',
    description:
      'View roles and their permissions.',
  },

  {
    code: 'roles.create',
    name: 'Create Roles',
    module: 'roles',
    description:
      'Create custom roles.',
  },

  {
    code: 'roles.update',
    name: 'Update Roles',
    module: 'roles',
    description:
      'Update custom roles.',
  },

  {
    code: 'roles.permissions.manage',
    name: 'Manage Role Permissions',
    module: 'roles',
    description:
      'Assign and revoke permissions from roles.',
  },


  /* ==========================================================
     AUTHENTICATION
     ========================================================== */

  {
    code: 'auth.sessions.read',
    name: 'View Sessions',
    module: 'authentication',
    description:
      'View active authentication sessions.',
  },

  {
    code: 'auth.sessions.revoke',
    name: 'Revoke Sessions',
    module: 'authentication',
    description:
      'Revoke authentication sessions.',
  },

  {
    code: 'auth.password.reset',
    name: 'Reset Passwords',
    module: 'authentication',
    description:
      'Perform authorized password reset operations.',
  },

  {
    code: 'auth.mfa.manage',
    name: 'Manage MFA',
    module: 'authentication',
    description:
      'Manage multi-factor authentication settings.',
  },


  /* ==========================================================
     PRACTITIONERS
     ========================================================== */

  {
    code: 'practitioners.read',
    name: 'View Practitioners',
    module: 'practitioners',
    description:
      'View healthcare practitioners.',
  },

  {
    code: 'practitioners.create',
    name: 'Create Practitioners',
    module: 'practitioners',
    description:
      'Create practitioner records.',
  },

  {
    code: 'practitioners.update',
    name: 'Update Practitioners',
    module: 'practitioners',
    description:
      'Update practitioner information.',
  },

  {
    code: 'practitioners.verify',
    name: 'Verify Practitioner Credentials',
    module: 'practitioners',
    description:
      'Verify professional credentials and registrations.',
  },


  /* ==========================================================
     PATIENTS
     ========================================================== */

  {
    code: 'patients.read',
    name: 'View Patients',
    module: 'patients',
    description:
      'View patient records within the authorized facility.',
  },

  {
    code: 'patients.create',
    name: 'Register Patients',
    module: 'patients',
    description:
      'Register new patients.',
  },

  {
    code: 'patients.update',
    name: 'Update Patients',
    module: 'patients',
    description:
      'Update patient demographic information.',
  },

  {
    code: 'patients.deactivate',
    name: 'Deactivate Patients',
    module: 'patients',
    description:
      'Deactivate patient records where permitted.',
  },


  /* ==========================================================
     CLINICAL
     ========================================================== */

  {
    code: 'clinical.read',
    name: 'View Clinical Records',
    module: 'clinical',
    description:
      'View clinical records.',
  },

  {
    code: 'clinical.create',
    name: 'Create Clinical Records',
    module: 'clinical',
    description:
      'Create clinical records.',
  },

  {
    code: 'clinical.update',
    name: 'Update Clinical Records',
    module: 'clinical',
    description:
      'Update clinical records.',
  },


  /* ==========================================================
     APPOINTMENTS
     ========================================================== */

  {
    code: 'appointments.read',
    name: 'View Appointments',
    module: 'appointments',
    description:
      'View patient appointments.',
  },

  {
    code: 'appointments.create',
    name: 'Create Appointments',
    module: 'appointments',
    description:
      'Create appointments.',
  },

  {
    code: 'appointments.update',
    name: 'Update Appointments',
    module: 'appointments',
    description:
      'Update appointments.',
  },

  {
    code: 'appointments.cancel',
    name: 'Cancel Appointments',
    module: 'appointments',
    description:
      'Cancel appointments.',
  },


  /* ==========================================================
     INPATIENT
     ========================================================== */

  {
    code: 'inpatient.read',
    name: 'View Inpatient Records',
    module: 'inpatient',
    description:
      'View inpatient admissions and records.',
  },

  {
    code: 'inpatient.admit',
    name: 'Admit Patients',
    module: 'inpatient',
    description:
      'Admit patients.',
  },

  {
    code: 'inpatient.discharge',
    name: 'Discharge Patients',
    module: 'inpatient',
    description:
      'Discharge admitted patients.',
  },


  /* ==========================================================
     LABORATORY
     ========================================================== */

  {
    code: 'laboratory.read',
    name: 'View Laboratory',
    module: 'laboratory',
    description:
      'View laboratory records.',
  },

  {
    code: 'laboratory.orders.create',
    name: 'Create Laboratory Orders',
    module: 'laboratory',
    description:
      'Create laboratory test orders.',
  },

  {
    code: 'laboratory.results.enter',
    name: 'Enter Laboratory Results',
    module: 'laboratory',
    description:
      'Enter laboratory results.',
  },

  {
    code: 'laboratory.results.verify',
    name: 'Verify Laboratory Results',
    module: 'laboratory',
    description:
      'Verify laboratory results.',
  },


  /* ==========================================================
     PHARMACY
     ========================================================== */

  {
    code: 'pharmacy.read',
    name: 'View Pharmacy',
    module: 'pharmacy',
    description:
      'View pharmacy records.',
  },

  {
    code: 'pharmacy.dispense',
    name: 'Dispense Medicines',
    module: 'pharmacy',
    description:
      'Dispense prescribed medicines.',
  },

  {
    code: 'pharmacy.inventory.manage',
    name: 'Manage Pharmacy Inventory',
    module: 'pharmacy',
    description:
      'Manage pharmacy inventory.',
  },


  /* ==========================================================
     INVENTORY
     ========================================================== */

  {
    code: 'inventory.read',
    name: 'View Inventory',
    module: 'inventory',
    description:
      'View inventory.',
  },

  {
    code: 'inventory.manage',
    name: 'Manage Inventory',
    module: 'inventory',
    description:
      'Manage inventory items and stock.',
  },


  /* ==========================================================
     BILLING
     ========================================================== */

  {
    code: 'billing.read',
    name: 'View Billing',
    module: 'billing',
    description:
      'View billing information.',
  },

  {
    code: 'billing.create',
    name: 'Create Bills',
    module: 'billing',
    description:
      'Create patient bills.',
  },

  {
    code: 'billing.update',
    name: 'Update Bills',
    module: 'billing',
    description:
      'Update billing records.',
  },

  {
    code: 'billing.payments.record',
    name: 'Record Payments',
    module: 'billing',
    description:
      'Record patient payments.',
  },


  /* ==========================================================
     INSURANCE / SHA
     ========================================================== */

  {
    code: 'insurance.read',
    name: 'View Insurance',
    module: 'insurance',
    description:
      'View insurance and SHA information.',
  },

  {
    code: 'insurance.claims.create',
    name: 'Create Claims',
    module: 'insurance',
    description:
      'Create insurance or SHA claims.',
  },

  {
    code: 'insurance.claims.submit',
    name: 'Submit Claims',
    module: 'insurance',
    description:
      'Submit insurance or SHA claims.',
  },

  {
    code: 'insurance.claims.manage',
    name: 'Manage Claims',
    module: 'insurance',
    description:
      'Manage insurance and SHA claims.',
  },


  /* ==========================================================
     PROCUREMENT
     ========================================================== */

  {
    code: 'procurement.read',
    name: 'View Procurement',
    module: 'procurement',
    description:
      'View procurement information.',
  },

  {
    code: 'procurement.create',
    name: 'Create Procurement Requests',
    module: 'procurement',
    description:
      'Create procurement requests.',
  },

  {
    code: 'procurement.approve',
    name: 'Approve Procurement',
    module: 'procurement',
    description:
      'Approve procurement transactions.',
  },


  /* ==========================================================
     REPORTS
     ========================================================== */

  {
    code: 'reports.read',
    name: 'View Reports',
    module: 'reports',
    description:
      'View authorized reports.',
  },

  {
    code: 'reports.export',
    name: 'Export Reports',
    module: 'reports',
    description:
      'Export authorized reports.',
  },


  /* ==========================================================
     AUDIT
     ========================================================== */

  {
    code: 'audit.read',
    name: 'View Audit Logs',
    module: 'audit',
    description:
      'View system audit logs.',
  },

  {
    code: 'audit.security.read',
    name: 'View Security Audit Logs',
    module: 'audit',
    description:
      'View authentication and security audit events.',
  },


  /* ==========================================================
     SYSTEM
     ========================================================== */

  {
    code: 'system.health.read',
    name: 'View System Health',
    module: 'system',
    description:
      'View system health and operational status.',
  },

  {
    code: 'system.settings.manage',
    name: 'Manage System Settings',
    module: 'system',
    description:
      'Manage system configuration.',
  },

] as const;


/* ============================================================
   SEED PERMISSIONS
   ============================================================ */

async function seedPermissions(): Promise<void> {

  console.log('');
  console.log('==============================================');
  console.log('JaliCare HMIS - Permission Seeder');
  console.log('==============================================');

  console.log(
    `Preparing ${PERMISSIONS.length} permissions...`,
  );


  /* ==========================================================
     1. INSERT / UPDATE PERMISSIONS
     ========================================================== */

  for (const permission of PERMISSIONS) {

    const existing = await db
      .select()
      .from(permissions)
      .where(
        eq(
          permissions.code,
          permission.code,
        ),
      )
      .limit(1);


    if (existing.length === 0) {

      await db
        .insert(permissions)
        .values({
          code: permission.code,

          name: permission.name,

          module: permission.module,

          description:
            permission.description,

          createdAt: new Date(),
        });

      console.log(
        `Created permission: ${permission.code}`,
      );

    } else {

      /*
       * Keep the seed idempotent while allowing the
       * description/name to be corrected later.
       */

      await db
        .update(permissions)
        .set({
          name: permission.name,

          module: permission.module,

          description:
            permission.description,
        })
        .where(
          eq(
            permissions.code,
            permission.code,
          ),
        );
    }
  }


  /* ==========================================================
     2. FIND GLOBAL SUPER_ADMIN
     ========================================================== */

  const [superAdminRole] = await db
    .select()
    .from(roles)
    .where(
      and(
        eq(
          roles.name,
          'SUPER_ADMIN',
        ),
        isNull(
          roles.tenantId,
        ),
      ),
    )
    .limit(1);


  if (!superAdminRole) {
    throw new Error(
      'Global SUPER_ADMIN role was not found. Run bootstrap-admin.ts first.',
    );
  }


  /* ==========================================================
     3. ASSIGN ALL PERMISSIONS TO SUPER_ADMIN
     ========================================================== */

  console.log('');
  console.log(
    'Synchronizing SUPER_ADMIN permissions...',
  );

  const allPermissions = await db
    .select()
    .from(permissions);


  for (const permission of allPermissions) {

    const existingAssignment = await db
      .select()
      .from(rolePermissions)
      .where(
        and(
          eq(
            rolePermissions.roleId,
            superAdminRole.id,
          ),

          eq(
            rolePermissions.permissionId,
            permission.id,
          ),
        ),
      )
      .limit(1);


    if (existingAssignment.length === 0) {

      await db
        .insert(rolePermissions)
        .values({
          roleId: superAdminRole.id,

          permissionId: permission.id,
        });

      console.log(
        `Assigned: ${permission.code}`,
      );
    }
  }


  /* ==========================================================
     4. RESULT
     ========================================================== */

  console.log('');
  console.log('==============================================');
  console.log('PERMISSION SEED COMPLETE');
  console.log('==============================================');

  console.log(
    `Total permissions: ${allPermissions.length}`,
  );

  console.log(
    `SUPER_ADMIN role ID: ${superAdminRole.id}`,
  );

  console.log(
    'SUPER_ADMIN now has all seeded platform permissions.',
  );

  console.log('==============================================');
  console.log('');
}


/* ============================================================
   EXECUTE
   ============================================================ */

seedPermissions()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {

    console.error('');
    console.error(
      '==============================================',
    );

    console.error(
      'PERMISSION SEED FAILED',
    );

    console.error(
      '==============================================',
    );

    console.error(error);

    console.error(
      '==============================================',
    );

    process.exit(1);
  });