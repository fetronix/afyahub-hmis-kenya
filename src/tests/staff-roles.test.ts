/**
 * JaliCare HMIS
 * Staff roles — contract tests
 *
 * The facility can now list its own staff and correct the role on an
 * existing account. Before this, `user_roles` was only ever written
 * when an invitation was accepted, so a wrong role could not be fixed
 * from the application at all.
 *
 * These tests do not need a database. They assert:
 *
 *   - the policy that decides which roles may be handed out
 *   - the scope checks on the directory and on the write
 *   - the verification gate on a clinical role
 *   - the audit row and the atomic write
 *   - that the screen exists and calls these endpoints
 *
 * Run with: npx tsx src/tests/staff-roles.test.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  MAX_ROLES_PER_STAFF_MEMBER,
  isAdministratorRoleName,
  isRestrictedRolePermission,
} from '../auth/staff-role-policy.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(
    actual === expected,
    `${label} — expected ${String(expected)}, got ${String(actual)}`,
  );
}

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

const policy = source('src/auth/staff-role-policy.ts');
const rolesService = source('src/auth/staff-roles.service.ts');
const rolesRoutes = source('src/auth/staff-roles.routes.ts');
const invitationService = source('src/auth/staff-invitation.service.ts');
const invitationRoutes = source('src/auth/staff-invitation.routes.ts');
const verificationService = source(
  'src/integrations/professional/professional-verification.service.ts',
);
const app = source('src/app.ts');
const panel = source('src/components/modules/StaffRolesPanel.tsx');
const configuration = source('src/components/modules/ConfigurationModule.tsx');
const verificationModal = source('src/components/modules/StaffVerificationModal.tsx');
const schema = source('src/db/schema.ts');

/* ============================================================
   1. Which roles a facility may hand out
   ============================================================ */

function testAssignabilityPolicy(): void {
  assert(
    policy.includes('RESTRICTED_PERMISSION_PREFIXES'),
    'The policy names restricted permission prefixes',
  );

  for (const prefix of ['platform.', 'tenants.', 'subscriptions.', 'users.roles.']) {
    assert(
      policy.includes(`"${prefix}"`),
      `The policy blocks the ${prefix} prefix`,
    );
  }

  assert(
    isRestrictedRolePermission({ code: 'platform.tenants.read', module: 'platform' }),
    'A platform permission is restricted by module',
  );
  assert(
    isRestrictedRolePermission({ code: 'roles.update', module: 'roles' }),
    'A role-mutating permission is restricted by code',
  );
  assert(
    isRestrictedRolePermission({ code: 'users.roles.manage', module: 'users' }),
    'users.roles.manage is restricted even though its module is users',
  );
  /*
   * Reading the facility's own audit trail is a legitimate staff role;
   * it is not an escalation. Only platform-level and role-management
   * permissions are withheld.
   */
  assert(
    !isRestrictedRolePermission({ code: 'audit.security.read', module: 'audit' }),
    'a facility auditor role stays assignable',
  );

  for (const allowed of [
    { code: 'patients.read', module: 'patients' },
    { code: 'billing.payments.record', module: 'billing' },
    { code: 'inpatient.admit', module: 'inpatient' },
    { code: 'laboratory.results.enter', module: 'laboratory' },
  ]) {
    assert(
      !isRestrictedRolePermission(allowed),
      `${allowed.code} stays assignable`,
    );
  }

  assert(
    isAdministratorRoleName('FACILITY_ADMIN'),
    'FACILITY_ADMIN is an administrator role',
  );
  assert(
    isAdministratorRoleName('facility admin'),
    'Administrator names are matched case-insensitively',
  );
  assert(
    isAdministratorRoleName('TENANT-ADMIN'),
    'Separator variants of administrator names are matched',
  );
  assert(
    !isAdministratorRoleName('BILLING_CLERK'),
    'A staff role is not an administrator role',
  );
  assert(
    !isAdministratorRoleName('CLINICAL_OFFICER'),
    'A clinical role is not an administrator role',
  );

  /*
   * A role called "System Administrator" does not match the name
   * pattern — that is exactly why the permission check exists. The
   * service must apply both, not one.
   */
  assert(
    rolesService.includes('isAdministratorRoleName(role.name)'),
    'The role list is filtered by administrator name',
  );
  assert(
    rolesService.includes('role.permissions.some(isRestrictedRolePermission)'),
    'The role list is filtered by the permissions the role carries',
  );
  assert(
    rolesService.includes('if (role.permissions.length === 0)'),
    'A role that grants nothing is not offered',
  );

  assert(
    !policy.includes('from "../db') && !policy.includes("from 'drizzle-orm'"),
    'The policy module is free of database imports, so the test exercises the real rule',
  );

  assertEqual(
    MAX_ROLES_PER_STAFF_MEMBER,
    20,
    'The per-staff role cap is a small, documented number',
  );
}

/* ============================================================
   2. Scope: the facility, not a facility id from the request
   ============================================================ */

function testScope(): void {
  assert(
    app.includes('app.use("/api/staff-roles", staffRolesRoutes);'),
    'The staff roles router is mounted',
  );
  assert(
    app.includes('import staffRolesRoutes from "./auth/staff-roles.routes";'),
    'The router is imported by the app',
  );

  assert(
    rolesRoutes.includes('router.use(requireAuth);'),
    'Every staff roles route requires authentication',
  );

  const permissionGates = rolesRoutes.split('requirePermission("users.invite")').length - 1;
  assertEqual(
    permissionGates,
    3,
    'All three routes are gated on the staff-management permission',
  );

  assert(
    rolesRoutes.includes('const scope = getScope(req);'),
    'Each route resolves scope from the authorization context',
  );
  assert(
    rolesRoutes.includes('context.tenantId') &&
      rolesRoutes.includes('context.facilityId'),
    'Scope comes from the authorization context, not the body',
  );
  assert(
    !rolesRoutes.includes('body.facilityId') &&
      !rolesRoutes.includes('req.body.facilityId'),
    'No route accepts a facility id from the request body',
  );
  assert(
    rolesRoutes.includes('FACILITY_SCOPE_REQUIRED'),
    'An account without a facility scope is refused',
  );

  assert(
    rolesService.includes('eq(users.tenantId, input.tenantId)') &&
      rolesService.includes('eq(users.facilityId, input.facilityId)'),
    'The staff directory is filtered by tenant and facility',
  );
  assert(
    rolesService.includes('target.tenantId !== input.tenantId') &&
      rolesService.includes('target.facilityId !== input.facilityId'),
    'The write re-checks the target account against the same scope',
  );
  assert(
    rolesService.includes('"STAFF_NOT_FOUND"') &&
      rolesService.includes('"That staff account was not found at this facility."'),
    'An out-of-scope account is reported as not found, not forbidden',
  );
}

/* ============================================================
   3. The account that cannot be edited here
   ============================================================ */

function testProtectedAccounts(): void {
  assert(
    rolesService.includes('holdsAdministratorRole'),
    'The service detects an account that holds an administrator role',
  );
  assert(
    rolesService.includes('"ADMINISTRATOR_ACCOUNT_PROTECTED"'),
    'An administrator account is protected from this screen',
  );
  assert(
    rolesService.includes('target.id === input.actorUserId'),
    'A caller cannot change their own roles',
  );
  assert(
    rolesService.includes('"SELF_ROLE_CHANGE_NOT_ALLOWED"'),
    'Self role changes are refused with a named code',
  );
  assert(
    rolesService.includes('Only a facility or platform administrator can change staff roles.'),
    'A non-administrator cannot assign roles even with the invite permission',
  );
  assert(
    rolesService.includes('isAdministratorRoleName(name)'),
    'The caller role list is checked with the same policy',
  );

  assert(
    rolesService.includes('fixedHeldRoleIds'),
    'Roles the facility can no longer offer are kept, not silently revoked',
  );
}

/* ============================================================
   4. Clinical roles still need a verified registration
   ============================================================ */

function testVerificationGate(): void {
  assert(
    rolesService.includes('findVerifiedCredentialForUser({'),
    'A clinical addition asks for a verified credential',
  );
  assert(
    rolesService.includes('if (heldRoleIds.has(role.id) || !role.requiresVerification)'),
    'A role the person already holds is not re-checked',
  );
  assert(
    rolesService.includes('"VERIFICATION_REQUIRED"'),
    'A missing registration refuses the assignment with a named code',
  );
  assert(
    rolesService.includes('before assigning it.'),
    'The refusal says what has to happen first',
  );

  assert(
    verificationService.includes('export async function findVerifiedCredentialForUser('),
    'The credential lookup lives in the verification service',
  );
  assert(
    verificationService.includes("sql`${schema.staffProfessionalCredentials.mode} is distinct from 'mock'`"),
    'A simulated verification can never satisfy the gate',
  );
  assert(
    verificationService.includes('inArray(schema.staffProfessionalCredentials.status, INVITABLE_STATUSES)'),
    'Only invitable statuses count as a usable credential',
  );
  assert(
    verificationService.includes('row.regulator === expectedRegulator.code'),
    'The credential must match the role\'s regulator',
  );

  assert(
    invitationService.includes('assertInvitationCredential({'),
    'Staff invitations still run the professional check',
  );
  assert(
    verificationService.includes("'REGULATOR_NOT_MAPPED'"),
    'An unmapped clinical role is refused in the verification service',
  );
}

/* ============================================================
   5. The verification record now belongs to the account
   ============================================================ */

function testCredentialOwnership(): void {
  assert(
    invitationService.includes('eq(staffProfessionalCredentials.invitationId, invitation.id)'),
    'Accepting an invitation links its verification record',
  );
  assert(
    invitationService.includes('isNull(staffProfessionalCredentials.userId)'),
    'An existing owner of the record is not overwritten',
  );

  assert(
    verificationService.includes('async function resolveScopedStaffUser('),
    'A user id on a verification request is resolved against the facility',
  );
  const scopedLookups =
    verificationService.split('await resolveScopedStaffUser(facility, input.userId)').length - 1;
  assertEqual(
    scopedLookups,
    2,
    'Both the automated and the manual check validate the staff account',
  );
  assert(
    verificationService.includes('That staff account does not belong to this facility.'),
    'A staff account in another facility is refused',
  );
  assert(
    verificationService.includes('eq(schema.users.tenantId, facility.tenantId)') &&
      verificationService.includes('eq(schema.users.facilityId, facility.id)'),
    'The staff account is resolved by tenant and facility',
  );

  assert(
    verificationService.includes('export async function listUsableCredentialsForStaff('),
    'The directory can show which registrations are already on file',
  );
}

/* ============================================================
   6. One write, one audit row
   ============================================================ */

function testAtomicWrite(): void {
  assert(
    rolesService.includes('return db.transaction(async (tx) => {'),
    'Role assignment runs in one transaction',
  );
  assert(
    rolesService.includes('.for("update")'),
    'The target account row is locked for the change',
  );
  assert(
    rolesService.includes('await tx.insert(auditLogs).values({'),
    'The change writes an audit row inside the transaction',
  );
  assert(
    rolesService.includes('resource: "USER_ROLES"'),
    'The audit row names the resource',
  );
  assert(
    rolesService.includes('Changed roles for ${target.fullName}'),
    'The audit detail names the roles added and removed',
  );
  assert(
    rolesService.includes('.set({ isActive: false, revokedAt: now })'),
    'Revoking a role closes the row rather than deleting history',
  );
  assert(
    rolesService.includes('isActive: true,\n            revokedAt: null,'),
    'Re-adding a role reactivates the existing row, respecting the unique index',
  );
  assert(
    rolesService.includes('if (toAdd.length === 0 && toRemove.length === 0)'),
    'An unchanged request writes no audit row',
  );

  // The feature must not need a migration.
  assert(
    !rolesService.includes('pgTable('),
    'No table is declared in the new service',
  );
  const userRolesStart = schema.indexOf('export const userRoles = pgTable(');
  const userRolesEnd = schema.indexOf('export const sessions = pgTable(');
  const userRolesBlock = schema.slice(userRolesStart, userRolesEnd);

  assert(
    userRolesBlock.includes("revokedAt: timestamp('revoked_at')"),
    'user_roles already has revoked_at',
  );
  assert(
    userRolesBlock.includes("isActive: boolean('is_active')"),
    'user_roles already has is_active',
  );
  assert(
    schema.includes("export const auditLogs = pgTable("),
    'audit_logs already exists',
  );
}

/* ============================================================
   7. The invitation picker and the directory share one rule
   ============================================================ */

function testOneRule(): void {
  assert(
    invitationRoutes.includes('import { listAssignableStaffRoles } from "./staff-roles.service";'),
    'The invitation picker uses the shared role list',
  );
  assert(
    invitationService.includes('assertStaffRoleAssignable'),
    'Invitation creation uses the shared assignability check',
  );
  assert(
    invitationService.includes('assertInvitationRole(db, input.tenantId, input.roleId)'),
    'The check is applied when an invitation is created',
  );
  assert(
    invitationService.includes('assertInvitationRole(tx, invitation.tenantId, invitation.roleId)'),
    'The check is applied again when an invitation is accepted',
  );
  assert(
    !invitationService.includes('normalizedRoleName.includes("SUPER_ADMIN")'),
    'The old name-only check is gone',
  );
}

/* ============================================================
   8. The screen
   ============================================================ */

function testScreen(): void {
  assert(
    configuration.includes('import { StaffRolesPanel } from \'./StaffRolesPanel.tsx\';'),
    'The configuration module imports the staff roles panel',
  );
  assert(
    configuration.includes('<StaffRolesPanel />'),
    'The panel is rendered',
  );
  assert(
    configuration.includes('label: \'Staff & Roles\''),
    'The tab is labelled so the capability is findable',
  );
  assert(
    configuration.includes('{activeTab === \'staff\' && ('),
    'The directory is on the staff tab, where invitations already live',
  );

  assert(
    panel.includes('fetch("/api/staff-roles/"'),
    'The panel reads the directory from the new endpoint',
  );
  assert(
    panel.includes('`/api/staff-roles/${editing.id}/roles`'),
    'The panel saves through the scoped role endpoint',
  );
  assert(
    panel.includes('method: "PUT"'),
    'Saving is a PUT, matching the route',
  );
  assert(
    panel.includes('disabled={!member.canAssign}'),
    'A protected account cannot be opened from the list',
  );
  assert(
    panel.includes('!editing.canAssign ||'),
    'Saving is disabled when the account is protected',
  );
  assert(
    panel.includes('subjectUserId={editing.id}'),
    'The verification check is recorded against the staff account',
  );
  assert(
    panel.includes('No role'),
    'An account with no role is called out',
  );
  assert(
    panel.includes('No verified registration'),
    'A clinical role without a registration says so before saving',
  );

  const modalUserIds =
    verificationModal.split('userId: subjectUserId').length - 1;
  assertEqual(
    modalUserIds,
    2,
    'The verification modal sends the staff account for both a registry check and a manual one',
  );

  assert(
    rolesRoutes.includes('requirePermission("users.invite")'),
    'The screen\'s permission matches what the route enforces',
  );
}

/* ============================================================
   RUN
   ============================================================ */

function run(): void {
  console.log('');
  console.log('==============================================');
  console.log('STAFF ROLES — CONTRACT TESTS');
  console.log('==============================================');

  testAssignabilityPolicy();
  console.log('  1. Administrator roles are not assignable, by name and by permission');
  testScope();
  console.log('  2. Every query is scoped by the caller\'s tenant and facility');
  testProtectedAccounts();
  console.log('  3. Administrator and self accounts cannot be edited here');
  testVerificationGate();
  console.log('  4. A clinical role still needs a verified registration');
  testCredentialOwnership();
  console.log('  5. A verification record follows the account it belongs to');
  testAtomicWrite();
  console.log('  6. One transaction, one audit row, no migration');
  testOneRule();
  console.log('  7. Invitations and the directory share one rule');
  testScreen();
  console.log('  8. The capability is on the screen');

  console.log('');
  console.log('==============================================');
  console.log(`STAFF ROLES TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('STAFF ROLES TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
