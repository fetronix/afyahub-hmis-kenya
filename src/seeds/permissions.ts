/**
 * JaliCare HMIS
 * Permission Seed
 *
 * Seeds the system-wide permission catalogue and grants the seeded
 * permissions to the two administrator roles that must hold them.
 *
 * WHAT IT MAY CHANGE
 * ------------------
 * - INSERTS a permission code that does not exist yet.
 * - UPDATES the name / module / description of an existing permission
 *   row. Those three columns are platform-owned: they are the label the
 *   screens print, not a facility decision.
 * - INSERTS a role_permissions row for SUPER_ADMIN (all seeded codes)
 *   and for each tenant FACILITY_ADMIN (the invitation set) when that
 *   grant is absent.
 *
 * WHAT IT NEVER DOES
 * ------------------
 * - No DELETE, no TRUNCATE, no DROP, no column drop anywhere.
 * - It never removes a permission that an operator granted by hand, and
 *   never revokes a role assignment from a user.
 * - It never touches facility-level role overrides
 *   (facility_role_permission_overrides), staff accounts, or custom
 *   roles. A facility that narrowed a role's permissions keeps that
 *   narrowing.
 *
 * Because "safe to re-run" is a claim, it is checkable: `--dry-run`
 * prints every insert/update it would make and writes nothing.
 *
 *   npm run db:seed:permissions -- --dry-run
 *   npm run db:seed:permissions
 */

import 'dotenv/config';

import { db } from '../db';

import { permissions, roles, rolePermissions } from '../db/schema';

import { and, eq, isNull, isNotNull } from 'drizzle-orm';

/*
 * A seed that writes is a deployment step, so it must be possible to see
 * what it would do first, and to run it against a database whose host is
 * not this machine only when someone says so.
 */
const dryRun = process.argv.includes('--dry-run');
const confirmed = process.argv.includes('--yes') || process.argv.includes('-y');

const RESET = '\u001b[0m';
const YELLOW = '\u001b[33m';
const DIM = '\u001b[2m';

let plannedInserts = 0;
let plannedUpdates = 0;
let skippedWrites = 0;

function plan(action: 'create' | 'update' | 'grant', message: string): void {
  if (action === 'create') plannedInserts += 1;
  else if (action === 'update') plannedUpdates += 1;
  else plannedInserts += 1;

  console.log(
    `  ${dryRun ? `${YELLOW}would ${action}${RESET}` : `${action}d`} ${DIM}${message}${RESET}`,
  );
}

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
    description: 'View platform-wide JaliCare administration information.',
  },

  {
    code: 'platform.manage',
    name: 'Manage Platform',
    module: 'platform',
    description: 'Manage global JaliCare platform configuration.',
  },

  {
    code: 'platform.settings.manage',
    name: 'Manage Platform Settings',
    module: 'platform',
    description: 'Manage global platform settings.',
  },

  /* ==========================================================
     TENANTS
     ========================================================== */

  {
    code: 'tenants.read',
    name: 'View Tenants',
    module: 'tenants',
    description: 'View registered healthcare organizations and tenants.',
  },

  {
    code: 'tenants.create',
    name: 'Create Tenants',
    module: 'tenants',
    description: 'Create new healthcare organization tenants.',
  },

  {
    code: 'tenants.update',
    name: 'Update Tenants',
    module: 'tenants',
    description: 'Update tenant information.',
  },

  {
    code: 'tenants.deactivate',
    name: 'Deactivate Tenants',
    module: 'tenants',
    description: 'Deactivate a tenant organization.',
  },

  /* ==========================================================
     FACILITIES
     ========================================================== */

  {
    code: 'facilities.read',
    name: 'View Facilities',
    module: 'facilities',
    description: 'View healthcare facilities.',
  },

  {
    code: 'facilities.create',
    name: 'Create Facilities',
    module: 'facilities',
    description: 'Create healthcare facilities.',
  },

  {
    code: 'facilities.update',
    name: 'Update Facilities',
    module: 'facilities',
    description: 'Update healthcare facility information.',
  },

  {
    code: 'facilities.modules.manage',
    name: 'Manage Facility Modules',
    module: 'facilities',
    description: "Turn a facility module on or off, which also opens or closes that module's API.",
  },

  {
    code: 'facilities.approve',
    name: 'Approve Facilities',
    module: 'facilities',
    description: 'Approve facility onboarding.',
  },

  {
    code: 'facilities.deactivate',
    name: 'Deactivate Facilities',
    module: 'facilities',
    description: 'Deactivate healthcare facilities.',
  },

  /* ==========================================================
     USERS
     ========================================================== */

  {
    code: 'users.read',
    name: 'View Users',
    module: 'users',
    description: 'View users within the authorized scope.',
  },

  {
    code: 'users.create',
    name: 'Create Users',
    module: 'users',
    description: 'Create user accounts.',
  },

  {
    code: 'users.update',
    name: 'Update Users',
    module: 'users',
    description: 'Update user accounts.',
  },

  {
    code: 'users.deactivate',
    name: 'Deactivate Users',
    module: 'users',
    description: 'Deactivate user accounts.',
  },

  {
    code: 'users.invite',
    name: 'Invite Staff',
    module: 'users',
    description: 'Invite staff to an authorized facility using a secure invitation link.',
  },

  {
    code: 'users.invitations.read',
    name: 'View Staff Invitations',
    module: 'users',
    description: 'View staff invitations within the authorized scope.',
  },

  {
    code: 'users.invitations.revoke',
    name: 'Revoke Staff Invitations',
    module: 'users',
    description: 'Revoke unused staff invitations within the authorized scope.',
  },
  {
    code: 'users.invitations.reissue',
    name: 'Reissue Staff Invitations',
    module: 'users',
    description:
      'Generate a replacement link for an unused staff invitation within the authorized scope.',
  },

  {
    code: 'users.roles.manage',
    name: 'Manage User Roles',
    module: 'users',
    description: 'Assign and revoke user roles.',
  },

  /* ==========================================================
     ROLES
     ========================================================== */

  {
    code: 'roles.read',
    name: 'View Roles',
    module: 'roles',
    description: 'View roles and their permissions.',
  },

  {
    code: 'roles.create',
    name: 'Create Roles',
    module: 'roles',
    description: 'Create custom roles.',
  },

  {
    code: 'roles.update',
    name: 'Update Roles',
    module: 'roles',
    description: 'Update custom roles.',
  },

  {
    code: 'roles.permissions.manage',
    name: 'Manage Role Permissions',
    module: 'roles',
    description: 'Assign and revoke permissions from roles.',
  },

  /* ==========================================================
     AUTHENTICATION
     ========================================================== */

  {
    code: 'auth.sessions.read',
    name: 'View Sessions',
    module: 'authentication',
    description: 'View active authentication sessions.',
  },

  {
    code: 'auth.sessions.revoke',
    name: 'Revoke Sessions',
    module: 'authentication',
    description: 'Revoke authentication sessions.',
  },

  {
    code: 'auth.password.reset',
    name: 'Reset Passwords',
    module: 'authentication',
    description: 'Perform authorized password reset operations.',
  },

  {
    code: 'auth.mfa.manage',
    name: 'Manage MFA',
    module: 'authentication',
    description: 'Manage multi-factor authentication settings.',
  },

  /* ==========================================================
     PRACTITIONERS
     ========================================================== */

  {
    code: 'practitioners.read',
    name: 'View Practitioners',
    module: 'practitioners',
    description: 'View healthcare practitioners.',
  },

  {
    code: 'practitioners.create',
    name: 'Create Practitioners',
    module: 'practitioners',
    description: 'Create practitioner records.',
  },

  {
    code: 'practitioners.update',
    name: 'Update Practitioners',
    module: 'practitioners',
    description: 'Update practitioner information.',
  },

  {
    code: 'practitioners.verify',
    name: 'Verify Practitioner Credentials',
    module: 'practitioners',
    description: 'Verify professional credentials and registrations.',
  },

  /* ==========================================================
     PATIENTS
     ========================================================== */

  {
    code: 'patients.read',
    name: 'View Patients',
    module: 'patients',
    description: 'View patient records within the authorized facility.',
  },

  {
    code: 'patients.create',
    name: 'Register Patients',
    module: 'patients',
    description: 'Register new patients.',
  },

  {
    code: 'patients.update',
    name: 'Update Patients',
    module: 'patients',
    description: 'Update patient demographic information.',
  },

  {
    code: 'patients.deactivate',
    name: 'Deactivate Patients',
    module: 'patients',
    description: 'Deactivate patient records where permitted.',
  },

  /* ==========================================================
     PATIENT PORTAL
     ========================================================== */

  /*
   * Deliberately five codes rather than one.
   *
   * Inviting a patient and suspending an account are different levels
   * of trust: the desk does the first all day, the second is a
   * decision about someone's access to their own record. Splitting them
   * means a receptionist can be productive without being able to
   * withdraw anybody's access.
   */
  {
    code: 'portal.invite',
    name: 'Invite Patients to the Portal',
    module: 'portal',
    description:
      'Issue an activation invitation to a patient at this facility and see its delivery status.',
  },

  {
    code: 'portal.invites.manage',
    name: 'Revoke Portal Invitations',
    module: 'portal',
    description:
      'Revoke an invitation that has not yet been used, and resend one within the facility limit.',
  },

  {
    code: 'portal.accounts.manage',
    name: 'Manage Patient Portal Accounts',
    module: 'portal',
    description:
      'Search portal accounts, view activation status, suspend, reactivate, revoke and force a password reset.',
  },

  {
    code: 'portal.audit.read',
    name: 'Review Portal Audit Events',
    module: 'portal',
    description:
      'Read portal invitation, activation and account-administration events for this facility.',
  },

  {
    code: 'portal.settings.manage',
    name: 'Manage Patient Portal Settings',
    module: 'portal',
    description:
      'Configure invitation expiry, resend limits, delivery channels and which record sections the portal releases.',
  },

  /* ==========================================================
     FHIR INTEROPERABILITY
     ========================================================== */

  {
    code: 'interop.fhir.patient.read',
    name: 'Export FHIR Patient Resource',
    module: 'interop',
    description: 'Read and export patient demographics through the FHIR interoperability endpoint.',
  },

  /* ==========================================================
     CLINICAL
     ========================================================== */

  {
    code: 'clinical.read',
    name: 'View Clinical Records',
    module: 'clinical',
    description: 'View clinical records.',
  },

  {
    code: 'clinical.create',
    name: 'Create Clinical Records',
    module: 'clinical',
    description: 'Create clinical records.',
  },

  {
    code: 'clinical.update',
    name: 'Update Clinical Records',
    module: 'clinical',
    description: 'Update clinical records.',
  },

  /* ==========================================================
     APPOINTMENTS
     ========================================================== */

  {
    code: 'appointments.read',
    name: 'View Appointments',
    module: 'appointments',
    description: 'View patient appointments.',
  },

  {
    code: 'appointments.create',
    name: 'Create Appointments',
    module: 'appointments',
    description: 'Create appointments.',
  },

  {
    code: 'appointments.update',
    name: 'Update Appointments',
    module: 'appointments',
    description: 'Update appointments.',
  },

  {
    code: 'appointments.cancel',
    name: 'Cancel Appointments',
    module: 'appointments',
    description: 'Cancel appointments.',
  },

  /* ==========================================================
     MATERNITY / MCH
     ========================================================== */

  {
    code: 'maternity.read',
    name: 'View Maternity Records',
    module: 'maternity',
    description: 'View antenatal visits, labour records, partographs and delivery records.',
  },

  {
    code: 'maternity.create',
    name: 'Record Maternity Care',
    module: 'maternity',
    description:
      'Book pregnancies and record antenatal visits, labour and partograph observations.',
  },

  {
    code: 'maternity.update',
    name: 'Update Maternity Records',
    module: 'maternity',
    description: 'Correct or close maternity records, including recording a delivery.',
  },

  /* ==========================================================
     INPATIENT
     ========================================================== */

  {
    code: 'inpatient.read',
    name: 'View Inpatient Records',
    module: 'inpatient',
    description: 'View inpatient admissions and records.',
  },

  {
    code: 'inpatient.admit',
    name: 'Admit Patients',
    module: 'inpatient',
    description: 'Admit patients.',
  },

  {
    code: 'inpatient.discharge',
    name: 'Discharge Patients',
    module: 'inpatient',
    description: 'Discharge admitted patients.',
  },

  /*
   * Ward and bed set-up.
   *
   * Kept separate from `inpatient.read` and `inpatient.admit` so a
   * facility can decide who configures the ward while the clinicians
   * keep admitting into it. Read access stays on `inpatient.read` —
   * a second read code would produce screens that half-work.
   *
   * No role receives these by default: whether a nurse-midwife or only
   * the matron may open a ward is a facility decision, not a default.
   */
  {
    code: 'inpatient.wards.create',
    name: 'Create Wards',
    module: 'inpatient',
    description: 'Add wards to this facility. Reading wards needs inpatient.read.',
  },

  {
    code: 'inpatient.wards.update',
    name: 'Update Wards',
    module: 'inpatient',
    description:
      'Rename a ward, change its type, allocation or daily rate, and retire or reactivate it.',
  },

  {
    code: 'inpatient.wards.delete',
    name: 'Delete Wards',
    module: 'inpatient',
    description:
      'Delete a ward that has never held a patient. A ward with admission history can only be retired.',
  },

  {
    code: 'inpatient.beds.create',
    name: 'Create Beds',
    module: 'inpatient',
    description: 'Add beds to a ward, singly or in a numbered batch.',
  },

  {
    code: 'inpatient.beds.update',
    name: 'Update Beds',
    module: 'inpatient',
    description: 'Change a bed number, type, daily charge or housekeeping status.',
  },

  {
    code: 'inpatient.beds.delete',
    name: 'Delete Beds',
    module: 'inpatient',
    description:
      'Delete a bed that has never held a patient. A bed with admission history can only be taken out of service.',
  },

  /* ==========================================================
     LABORATORY
     ========================================================== */

  {
    code: 'laboratory.read',
    name: 'View Laboratory',
    module: 'laboratory',
    description: 'View laboratory records.',
  },

  {
    code: 'laboratory.orders.create',
    name: 'Create Laboratory Orders',
    module: 'laboratory',
    description: 'Create laboratory test orders.',
  },

  {
    code: 'laboratory.results.enter',
    name: 'Enter Laboratory Results',
    module: 'laboratory',
    description: 'Enter laboratory results.',
  },

  {
    code: 'laboratory.results.verify',
    name: 'Verify Laboratory Results',
    module: 'laboratory',
    description: 'Verify laboratory results.',
  },

  /* ==========================================================
     PHARMACY
     ========================================================== */

  {
    code: 'pharmacy.read',
    name: 'View Pharmacy',
    module: 'pharmacy',
    description: 'View pharmacy records.',
  },

  {
    code: 'pharmacy.dispense',
    name: 'Dispense Medicines',
    module: 'pharmacy',
    description: 'Dispense prescribed medicines.',
  },

  {
    code: 'pharmacy.inventory.manage',
    name: 'Manage Pharmacy Inventory',
    module: 'pharmacy',
    description: 'Manage pharmacy inventory.',
  },

  /* ==========================================================
     INVENTORY
     ========================================================== */

  {
    code: 'inventory.read',
    name: 'View Inventory',
    module: 'inventory',
    description: 'View inventory.',
  },

  {
    code: 'inventory.manage',
    name: 'Manage Inventory',
    module: 'inventory',
    description: 'Manage inventory items and stock.',
  },

  /* ==========================================================
     BILLING
     ========================================================== */

  {
    code: 'billing.read',
    name: 'View Billing',
    module: 'billing',
    description: 'View billing information.',
  },

  {
    code: 'billing.create',
    name: 'Create Bills',
    module: 'billing',
    description: 'Create patient bills.',
  },

  {
    code: 'billing.update',
    name: 'Update Bills',
    module: 'billing',
    description: 'Update billing records.',
  },

  {
    code: 'billing.payments.record',
    name: 'Record Payments',
    module: 'billing',
    description: 'Record patient payments.',
  },

  /* ==========================================================
     FACILITY SERVICE TARIFFS
     ========================================================== */

  {
    code: 'tariffs.read',
    name: 'View Service Tariffs',
    module: 'billing',
    description: 'View service tariffs within the authorized facility.',
  },

  {
    code: 'tariffs.manage',
    name: 'Manage Service Tariffs',
    module: 'billing',
    description: 'Create, update, and deactivate facility service tariffs.',
  },
  /* ==========================================================
     INSURANCE / SHA
     ========================================================== */

  {
    code: 'insurance.read',
    name: 'View Insurance',
    module: 'insurance',
    description: 'View insurance and SHA information.',
  },

  {
    code: 'insurance.claims.create',
    name: 'Create Claims',
    module: 'insurance',
    description: 'Create insurance or SHA claims.',
  },

  {
    code: 'insurance.claims.submit',
    name: 'Submit Claims',
    module: 'insurance',
    description: 'Submit insurance or SHA claims.',
  },

  {
    code: 'insurance.claims.manage',
    name: 'Manage Claims',
    module: 'insurance',
    description: 'Manage insurance and SHA claims.',
  },

  /* ==========================================================
     PROCUREMENT
     ========================================================== */

  {
    code: 'procurement.read',
    name: 'View Procurement',
    module: 'procurement',
    description: 'View procurement information.',
  },

  {
    code: 'procurement.create',
    name: 'Create Procurement Requests',
    module: 'procurement',
    description: 'Create procurement requests.',
  },

  {
    code: 'procurement.approve',
    name: 'Approve Procurement',
    module: 'procurement',
    description: 'Approve procurement transactions.',
  },

  /* ==========================================================
     REPORTS
     ========================================================== */

  {
    code: 'reports.read',
    name: 'View Reports',
    module: 'reports',
    description: 'View authorized reports.',
  },

  {
    code: 'public_health.reports.create',
    name: 'Create Public Health Reports',
    module: 'public_health',
    description: 'Record disease surveillance reports for an authorized facility.',
  },

  {
    code: 'reports.export',
    name: 'Export Reports',
    module: 'reports',
    description: 'Export authorized reports.',
  },

  /* ==========================================================
     AUDIT
     ========================================================== */

  {
    code: 'audit.read',
    name: 'View Audit Logs',
    module: 'audit',
    description: 'View system audit logs.',
  },

  {
    code: 'audit.security.read',
    name: 'View Security Audit Logs',
    module: 'audit',
    description: 'View authentication and security audit events.',
  },

  /* ==========================================================
     SYSTEM
     ========================================================== */

  {
    code: 'system.health.read',
    name: 'View System Health',
    module: 'system',
    description: 'View system health and operational status.',
  },

  {
    code: 'system.settings.manage',
    name: 'Manage System Settings',
    module: 'system',
    description: 'Manage system configuration.',
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

  console.log(`Preparing ${PERMISSIONS.length} permissions...`);

  /* ==========================================================
     1. INSERT / UPDATE PERMISSIONS
     ========================================================== */

  for (const permission of PERMISSIONS) {
    const existing = await db
      .select()
      .from(permissions)
      .where(eq(permissions.code, permission.code))
      .limit(1);

    if (existing.length === 0) {
      plan('create', `permission ${permission.code}`);

      if (!dryRun) {
        await db.insert(permissions).values({
          code: permission.code,

          name: permission.name,

          module: permission.module,

          description: permission.description,

          createdAt: new Date(),
        });
      }
    } else {
      /*
       * Keep the seed idempotent while allowing the
       * description/name to be corrected later.
       *
       * Only the three platform-owned columns are written. `id` and
       * `code` are the identity every role grant and every audit row
       * points at, and are never rewritten here.
       */

      const current = existing[0];

      const unchanged =
        current.name === permission.name &&
        current.module === permission.module &&
        (current.description ?? null) === (permission.description ?? null);

      if (!unchanged) {
        plan('update', `permission ${permission.code} (name/module/description)`);

        if (!dryRun) {
          await db
            .update(permissions)
            .set({
              name: permission.name,

              module: permission.module,

              description: permission.description,
            })
            .where(eq(permissions.code, permission.code));
        }
      } else {
        skippedWrites += 1;
      }
    }
  }

  /* ==========================================================
     2. FIND GLOBAL SUPER_ADMIN
     ========================================================== */

  const [superAdminRole] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.name, 'SUPER_ADMIN'), isNull(roles.tenantId)))
    .limit(1);

  if (!superAdminRole) {
    throw new Error('Global SUPER_ADMIN role was not found. Run bootstrap-admin.ts first.');
  }

  /* ==========================================================
     3. ASSIGN ALL PERMISSIONS TO SUPER_ADMIN
     ========================================================== */

  console.log('');
  console.log('Synchronizing SUPER_ADMIN permissions...');

  const allPermissions = await db.select().from(permissions);

  for (const permission of allPermissions) {
    // Facility tariffs are managed only by tenant-level Facility Admins.
    if (permission.code === 'tariffs.read' || permission.code === 'tariffs.manage') {
      continue;
    }

    const existingAssignment = await db
      .select()
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, superAdminRole.id),

          eq(rolePermissions.permissionId, permission.id),
        ),
      )
      .limit(1);

    if (existingAssignment.length === 0) {
      plan('grant', `SUPER_ADMIN -> ${permission.code}`);

      if (!dryRun) {
        await db.insert(rolePermissions).values({
          roleId: superAdminRole.id,

          permissionId: permission.id,
        });
      }
    } else {
      skippedWrites += 1;
    }
  }

  /* ==========================================================
     3B. ASSIGN STAFF INVITATION PERMISSIONS TO FACILITY ADMINS
     ========================================================== */

  console.log('');
  console.log('Synchronizing facility-admin invitation permissions...');

  const staffInvitationPermissionCodes = [
    'users.invite',
    'users.invitations.read',
    'users.invitations.revoke',
    'users.invitations.reissue',
    'tariffs.read',
    'tariffs.manage',
    /*
     * A facility administrator is the person who decides whether this
     * facility runs a maternity unit, a theatre list or a laboratory.
     * The provisioning route also admits the FACILITY_ADMIN role so a
     * database seeded before this permission existed still works.
     */
    'facilities.modules.manage',
  ] as const;

  const staffInvitationPermissions = [];

  for (const code of staffInvitationPermissionCodes) {
    const [permission] = await db
      .select()
      .from(permissions)
      .where(eq(permissions.code, code))
      .limit(1);

    if (!permission) {
      throw new Error(`Required permission was not seeded: ${code}`);
    }

    staffInvitationPermissions.push(permission);
  }

  const facilityAdminRoles = await db
    .select()
    .from(roles)
    .where(
      and(eq(roles.name, 'FACILITY_ADMIN'), eq(roles.isActive, true), isNotNull(roles.tenantId)),
    );

  for (const facilityAdminRole of facilityAdminRoles) {
    for (const permission of staffInvitationPermissions) {
      const [existingAssignment] = await db
        .select()
        .from(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, facilityAdminRole.id),
            eq(rolePermissions.permissionId, permission.id),
          ),
        )
        .limit(1);

      if (!existingAssignment) {
        plan('grant', `FACILITY_ADMIN(${facilityAdminRole.id}) -> ${permission.code}`);

        if (!dryRun) {
          await db.insert(rolePermissions).values({
            roleId: facilityAdminRole.id,
            permissionId: permission.id,
          });
        }
      } else {
        skippedWrites += 1;
      }
    }
  }

  console.log(
    `Synchronized invitation permissions for ${facilityAdminRoles.length} tenant facility-admin roles.`,
  );

  /* ==========================================================
     4. RESULT
     ========================================================== */

  console.log('');
  console.log('==============================================');
  console.log(dryRun ? 'PERMISSION SEED — DRY RUN' : 'PERMISSION SEED COMPLETE');
  console.log('==============================================');

  console.log(`Permissions in this catalogue : ${PERMISSIONS.length}`);
  console.log(`Existing rows already correct: ${skippedWrites}`);
  console.log(
    `Rows ${dryRun ? 'that would be written' : 'written'}     : ${plannedInserts + plannedUpdates}`,
  );

  console.log(`SUPER_ADMIN role ID: ${superAdminRole.id}`);

  console.log('');
  console.log('Rules this seed follows: no DELETE, no TRUNCATE, no DROP; no role');
  console.log('assignment is removed; facility permission overrides and custom roles');
  console.log('are not touched.');

  if (dryRun) {
    console.log('');
    console.log('Dry run — nothing was written to the database.');
  }

  console.log('==============================================');
  console.log('');
}

/* ============================================================
   EXECUTE
   ============================================================ */

/**
 * Guard against the one mistake that matters: running the seeder with
 * production credentials by accident. It is additive, but it still
 * writes, so a remote host needs an explicit --yes.
 */
async function guardRemoteTarget(): Promise<void> {
  const { env } = await import('../config/env.ts');

  const local =
    ['localhost', '127.0.0.1', '::1'].includes(env.database.host.trim().toLowerCase()) ||
    env.database.host.trim() === '';

  console.log('');
  console.log(
    `Target: ${env.database.user}@${env.database.host}:${env.database.port}/${env.database.name}`,
  );

  if (dryRun) {
    console.log('Mode  : DRY RUN (read-only)');
  }

  if (!local && !confirmed && !dryRun) {
    console.log('');
    console.log('This database is not on this machine. The seed only adds rows,');
    console.log('but it still writes. Re-run with --yes once a backup exists:');
    console.log('');
    console.log('  npm run db:seed:permissions -- --yes');
    console.log('');
    process.exit(1);
  }
}

guardRemoteTarget()
  .then(() => seedPermissions())
  .then(async () => {
    /*
     * Close the pool rather than calling process.exit(). An abrupt exit
     * with an open pool is what leaves connections behind on a shared
     * PostgreSQL server, and on a low-process host it also hides whether
     * the exit was clean.
     */
    const { pool } = await import('../db/index.ts');
    await pool.end();
    process.exit(0);
  })
  .catch((error) => {
    console.error('');
    console.error('==============================================');

    console.error('PERMISSION SEED FAILED');

    console.error('==============================================');

    console.error(error);

    console.error('==============================================');

    process.exit(1);
  });
