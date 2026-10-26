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
  isDelegablePermission,
  isRestrictedRolePermission,
} from '../auth/staff-role-policy.ts';
import { schemaSource } from './support/schema-source.ts';
import { containsCode, countCode } from './support/source-text.ts';

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
  assert(actual === expected, `${label} — expected ${String(expected)}, got ${String(actual)}`);
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
const sidebar = source('src/components/Sidebar.tsx');
const verificationModal = source('src/components/modules/StaffVerificationModal.tsx');
const schema = schemaSource();
const loginService = source('src/auth/login.service.ts');
const authMiddleware = source('src/auth/auth.middleware.ts');

/* ============================================================
   1. Which roles a facility may hand out
   ============================================================ */

function testAssignabilityPolicy(): void {
  assert(
    containsCode(policy, 'RESTRICTED_PERMISSION_PREFIXES'),
    'The policy names restricted permission prefixes',
  );

  for (const prefix of ['platform.', 'tenants.', 'subscriptions.', 'users.roles.']) {
    assert(containsCode(policy, `"${prefix}"`), `The policy blocks the ${prefix} prefix`);
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
    assert(!isRestrictedRolePermission(allowed), `${allowed.code} stays assignable`);
  }

  assert(isAdministratorRoleName('FACILITY_ADMIN'), 'FACILITY_ADMIN is an administrator role');
  assert(
    isAdministratorRoleName('facility admin'),
    'Administrator names are matched case-insensitively',
  );
  assert(
    isAdministratorRoleName('TENANT-ADMIN'),
    'Separator variants of administrator names are matched',
  );
  assert(!isAdministratorRoleName('BILLING_CLERK'), 'A staff role is not an administrator role');
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
    containsCode(rolesService, 'isAdministratorRoleName(role.name)'),
    'The role list is filtered by administrator name',
  );
  assert(
    containsCode(rolesService, 'role.permissions.some(isRestrictedRolePermission)'),
    'The role list is filtered by the permissions the role carries',
  );
  assert(
    containsCode(rolesService, 'if (role.permissions.length === 0)'),
    'A role that grants nothing is not offered',
  );

  assert(
    !containsCode(policy, 'from "../db') && !containsCode(policy, "from 'drizzle-orm'"),
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
    containsCode(app, 'app.use("/api/staff-roles", staffRolesRoutes);'),
    'The staff roles router is mounted',
  );
  assert(
    containsCode(app, 'import staffRolesRoutes from "./auth/staff-roles.routes";'),
    'The router is imported by the app',
  );

  assert(
    containsCode(rolesRoutes, 'router.use(requireAuth);'),
    'Every staff roles route requires authentication',
  );

  const permissionGates = countCode(rolesRoutes, 'requirePermission("users.invite")');
  assertEqual(
    permissionGates,
    6,
    'All six routes — directory, roles, role assignment, role tasks (two verbs) and account status — are gated on the staff-management permission',
  );

  assert(
    containsCode(rolesRoutes, 'const scope = getScope(req);'),
    'Each route resolves scope from the authorization context',
  );
  assert(
    containsCode(rolesRoutes, 'context.tenantId') &&
      containsCode(rolesRoutes, 'context.facilityId'),
    'Scope comes from the authorization context, not the body',
  );
  assert(
    !containsCode(rolesRoutes, 'body.facilityId') &&
      !containsCode(rolesRoutes, 'req.body.facilityId'),
    'No route accepts a facility id from the request body',
  );
  assert(
    containsCode(rolesRoutes, 'FACILITY_SCOPE_REQUIRED'),
    'An account without a facility scope is refused',
  );

  assert(
    containsCode(rolesService, 'eq(users.tenantId, input.tenantId)') &&
      containsCode(rolesService, 'eq(users.facilityId, input.facilityId)'),
    'The staff directory is filtered by tenant and facility',
  );
  assert(
    containsCode(rolesService, 'target.tenantId !== input.tenantId') &&
      containsCode(rolesService, 'target.facilityId !== input.facilityId'),
    'The write re-checks the target account against the same scope',
  );
  assert(
    containsCode(rolesService, '"STAFF_NOT_FOUND"') &&
      containsCode(rolesService, '"That staff account was not found at this facility."'),
    'An out-of-scope account is reported as not found, not forbidden',
  );
}

/* ============================================================
   3. The account that cannot be edited here
   ============================================================ */

function testProtectedAccounts(): void {
  assert(
    containsCode(rolesService, 'holdsAdministratorRole'),
    'The service detects an account that holds an administrator role',
  );
  assert(
    containsCode(rolesService, '"ADMINISTRATOR_ACCOUNT_PROTECTED"'),
    'An administrator account is protected from this screen',
  );
  assert(
    containsCode(rolesService, 'target.id === input.actorUserId'),
    'A caller cannot change their own roles',
  );
  assert(
    containsCode(rolesService, '"SELF_ROLE_CHANGE_NOT_ALLOWED"'),
    'Self role changes are refused with a named code',
  );
  assert(
    containsCode(rolesService, 'Only a facility or platform administrator can change staff roles.'),
    'A non-administrator cannot assign roles even with the invite permission',
  );
  assert(
    containsCode(rolesService, 'isAdministratorRoleName(name)'),
    'The caller role list is checked with the same policy',
  );

  assert(
    containsCode(rolesService, 'fixedHeldRoleIds'),
    'Roles the facility can no longer offer are kept, not silently revoked',
  );
}

/* ============================================================
   4. Clinical roles still need a verified registration
   ============================================================ */

function testVerificationGate(): void {
  assert(
    containsCode(rolesService, 'findVerifiedCredentialForUser({'),
    'A clinical addition asks for a verified credential',
  );
  assert(
    containsCode(rolesService, 'if (heldRoleIds.has(role.id) || !role.requiresVerification)'),
    'A role the person already holds is not re-checked',
  );
  assert(
    containsCode(rolesService, '"VERIFICATION_REQUIRED"'),
    'A missing registration refuses the assignment with a named code',
  );
  assert(
    containsCode(rolesService, 'before assigning it.'),
    'The refusal says what has to happen first',
  );

  assert(
    containsCode(verificationService, 'export async function findVerifiedCredentialForUser('),
    'The credential lookup lives in the verification service',
  );
  assert(
    verificationService.includes(
      "sql`${schema.staffProfessionalCredentials.mode} is distinct from 'mock'`",
    ),
    'A simulated verification can never satisfy the gate',
  );
  assert(
    verificationService.includes(
      'inArray(schema.staffProfessionalCredentials.status, INVITABLE_STATUSES)',
    ),
    'Only invitable statuses count as a usable credential',
  );
  assert(
    containsCode(verificationService, 'row.regulator === expectedRegulator.code'),
    "The credential must match the role's regulator",
  );

  assert(
    containsCode(invitationService, 'assertInvitationCredential({'),
    'Staff invitations still run the professional check',
  );
  assert(
    containsCode(verificationService, "'REGULATOR_NOT_MAPPED'"),
    'An unmapped clinical role is refused in the verification service',
  );
}

/* ============================================================
   5. The verification record now belongs to the account
   ============================================================ */

function testCredentialOwnership(): void {
  assert(
    containsCode(invitationService, 'eq(staffProfessionalCredentials.invitationId, invitation.id)'),
    'Accepting an invitation links its verification record',
  );
  assert(
    containsCode(invitationService, 'isNull(staffProfessionalCredentials.userId)'),
    'An existing owner of the record is not overwritten',
  );

  assert(
    containsCode(verificationService, 'async function resolveScopedStaffUser('),
    'A user id on a verification request is resolved against the facility',
  );
  const scopedLookups = countCode(
    verificationService,
    'await resolveScopedStaffUser(facility, input.userId)',
  );
  assertEqual(
    scopedLookups,
    2,
    'Both the automated and the manual check validate the staff account',
  );
  assert(
    containsCode(verificationService, 'That staff account does not belong to this facility.'),
    'A staff account in another facility is refused',
  );
  assert(
    containsCode(verificationService, 'eq(schema.users.tenantId, facility.tenantId)') &&
      containsCode(verificationService, 'eq(schema.users.facilityId, facility.id)'),
    'The staff account is resolved by tenant and facility',
  );

  assert(
    containsCode(verificationService, 'export async function listUsableCredentialsForStaff('),
    'The directory can show which registrations are already on file',
  );
}

/* ============================================================
   6. One write, one audit row
   ============================================================ */

function testAtomicWrite(): void {
  assert(
    containsCode(rolesService, 'return db.transaction(async (tx) => {'),
    'Role assignment runs in one transaction',
  );
  assert(
    containsCode(rolesService, '.for("update")'),
    'The target account row is locked for the change',
  );
  assert(
    containsCode(rolesService, 'await tx.insert(auditLogs).values({'),
    'The change writes an audit row inside the transaction',
  );
  assert(containsCode(rolesService, 'resource: "USER_ROLES"'), 'The audit row names the resource');
  assert(
    containsCode(rolesService, 'Changed roles for ${target.fullName}'),
    'The audit detail names the roles added and removed',
  );
  assert(
    containsCode(rolesService, '.set({ isActive: false, revokedAt: now })'),
    'Revoking a role closes the row rather than deleting history',
  );
  assert(
    containsCode(rolesService, 'isActive: true,\n            revokedAt: null,'),
    'Re-adding a role reactivates the existing row, respecting the unique index',
  );
  assert(
    containsCode(rolesService, 'if (toAdd.length === 0 && toRemove.length === 0)'),
    'An unchanged request writes no audit row',
  );

  // The feature must not need a migration.
  assert(!containsCode(rolesService, 'pgTable('), 'No table is declared in the new service');
  const userRolesStart = schema.indexOf('export const userRoles = pgTable(');
  const userRolesEnd = schema.indexOf('export const sessions = pgTable(');
  const userRolesBlock = schema.slice(userRolesStart, userRolesEnd);

  assert(
    containsCode(userRolesBlock, "revokedAt: timestamp('revoked_at')"),
    'user_roles already has revoked_at',
  );
  assert(
    containsCode(userRolesBlock, "isActive: boolean('is_active')"),
    'user_roles already has is_active',
  );
  assert(containsCode(schema, 'export const auditLogs = pgTable('), 'audit_logs already exists');
}

/* ============================================================
   7. The invitation picker and the directory share one rule
   ============================================================ */

function testOneRule(): void {
  assert(
    containsCode(
      invitationRoutes,
      'import { listAssignableStaffRoles } from "./staff-roles.service";',
    ),
    'The invitation picker uses the shared role list',
  );
  assert(
    containsCode(invitationService, 'assertStaffRoleAssignable'),
    'Invitation creation uses the shared assignability check',
  );
  assert(
    containsCode(invitationService, 'assertInvitationRole(db, input.tenantId, input.roleId)'),
    'The check is applied when an invitation is created',
  );
  assert(
    containsCode(
      invitationService,
      'assertInvitationRole(tx, invitation.tenantId, invitation.roleId)',
    ),
    'The check is applied again when an invitation is accepted',
  );
  assert(
    !containsCode(invitationService, 'normalizedRoleName.includes("SUPER_ADMIN")'),
    'The old name-only check is gone',
  );
}

/* ============================================================
   8. The screen
   ============================================================ */

function testScreen(): void {
  assert(
    containsCode(configuration, "import { StaffRolesPanel } from './StaffRolesPanel.tsx';"),
    'The configuration module imports the staff roles panel',
  );
  assert(containsCode(configuration, '<StaffRolesPanel />'), 'The panel is rendered');
  assert(
    containsCode(configuration, "label: 'Staff & Roles'"),
    'The tab is labelled so the capability is findable',
  );
  assert(
    containsCode(configuration, "{activeTab === 'staff' && ("),
    'The directory is on the staff tab, where invitations already live',
  );

  /*
   * A tab nobody can open is not a capability. On a fresh install the
   * facility administrator holds users.invite and none of the four
   * permissions the Configuration nav used to require.
   */
  const configurationNavStart = sidebar.indexOf('configuration: [');
  const configurationNavEnd = sidebar.indexOf('],', configurationNavStart);
  const configurationNav = sidebar.slice(configurationNavStart, configurationNavEnd);

  assert(
    containsCode(configurationNav, "'users.invite'"),
    'The Configuration nav opens for an account that can manage staff',
  );
  assert(
    containsCode(configuration, 'const canManageStaff') &&
      containsCode(configuration, "permissions.has('users.invite')"),
    'The staff tab is gated on the same permission its API requires',
  );
  assert(
    containsCode(configuration, 'const staffOnly') &&
      containsCode(configuration, 'if (staffOnly) return false;'),
    'An account with only staff permissions sees only the staff tab',
  );
  assert(
    containsCode(configuration, "staffOnly ? 'staff' : 'facility'"),
    'A staff-only account lands on the staff tab instead of an empty one',
  );
  assert(
    containsCode(configuration, "if (isFacilityAdmin) return tab.id !== 'payments'"),
    'A facility administrator can reach the profile and module tabs',
  );

  assert(
    containsCode(panel, 'fetch("/api/staff-roles/"'),
    'The panel reads the directory from the new endpoint',
  );
  assert(
    containsCode(panel, '`/api/staff-roles/${editing.id}/roles`'),
    'The panel saves through the scoped role endpoint',
  );
  assert(containsCode(panel, 'method: "PUT"'), 'Saving is a PUT, matching the route');
  assert(
    containsCode(panel, 'disabled={!member.canAssign}'),
    'A protected account cannot be opened from the list',
  );
  assert(
    containsCode(panel, '!editing.canAssign ||'),
    'Saving is disabled when the account is protected',
  );
  assert(
    containsCode(panel, 'subjectUserId={editing.id}'),
    'The verification check is recorded against the staff account',
  );
  assert(containsCode(panel, 'No role'), 'An account with no role is called out');
  assert(
    containsCode(panel, 'No verified registration'),
    'A clinical role without a registration says so before saving',
  );

  const modalUserIds = countCode(verificationModal, 'userId: subjectUserId');
  assertEqual(
    modalUserIds,
    2,
    'The verification modal sends the staff account for both a registry check and a manual one',
  );

  assert(
    containsCode(rolesRoutes, 'requirePermission("users.invite")'),
    "The screen's permission matches what the route enforces",
  );
}

/* ============================================================
   9. Task-level permissions — delegable work, never administration
   ============================================================ */

function testTaskDelegationBoundary(): void {
  /*
   * The two examples from the request: a doctor seeing bills, and a
   * facility managing service tariffs. If either of these is refused
   * the feature does not do what was asked.
   */
  assert(
    isDelegablePermission({ code: 'billing.read', module: 'billing' }),
    'A doctor can be given read access to bills',
  );
  assert(
    isDelegablePermission({ code: 'tariffs.manage', module: 'billing' }),
    'A role can be given service-tariff management',
  );
  assert(
    isDelegablePermission({ code: 'patients.read', module: 'patients' }),
    'Clinical tasks remain delegable',
  );
  assert(
    isDelegablePermission({
      code: 'laboratory.results.verify',
      module: 'laboratory',
    }),
    'Verification of laboratory results is an operational task',
  );

  for (const permission of [
    { code: 'users.invite', module: 'users' },
    { code: 'users.roles.manage', module: 'users' },
    { code: 'roles.permissions.manage', module: 'roles' },
    { code: 'audit.read', module: 'audit' },
    { code: 'audit.security.read', module: 'audit' },
    { code: 'facilities.update', module: 'facilities' },
    { code: 'platform.manage', module: 'platform' },
    { code: 'system.settings.manage', module: 'system' },
    { code: 'auth.password.reset', module: 'authentication' },
    { code: 'tenants.update', module: 'tenants' },
  ]) {
    assert(!isDelegablePermission(permission), `${permission.code} stays with the administrator`);
  }

  assert(
    !isDelegablePermission({ code: 'billing.read', module: 'made_up' }),
    'An unknown module is refused rather than assumed safe',
  );

  assert(
    containsCode(policy, 'DELEGABLE_PERMISSION_MODULES') &&
      containsCode(policy, 'PROTECTED_PERMISSION_PREFIXES'),
    'The boundary is a named allowlist, not an inline condition',
  );

  assert(
    containsCode(rolesService, 'PERMISSION_NOT_DELEGABLE'),
    'The service refuses a permission outside the allowlist',
  );
  assert(
    containsCode(rolesService, 'ROLE_NOT_EDITABLE'),
    'An administrator role cannot be edited from the facility',
  );
  assert(
    containsCode(rolesService, 'MIN_PERMISSIONS_PER_ROLE') ||
      containsCode(rolesService, 'INVALID_PERMISSION_SELECTION'),
    'A role cannot be saved with no tasks at all',
  );
  assert(
    containsCode(rolesService, 'delete(rolePermissions)'),
    'Revoking a task removes the grant row',
  );
  assert(
    containsCode(rolesService, 'delegableCurrentIds') && containsCode(rolesService, 'unmapped'),
    'A grant outside the allowlist is preserved and named, never silently stripped',
  );
  assert(
    containsCode(rolesService, 'resource: "ROLE_PERMISSIONS"'),
    'A task change writes an audit row naming the role',
  );
  assert(
    containsCode(rolesService, '.for("update")'),
    'The role row is locked for the duration of the change',
  );

  assert(
    containsCode(rolesRoutes, '"/roles/:roleId/permissions"'),
    'The task routes are registered',
  );
  assert(
    containsCode(rolesRoutes, 'requirePermission("users.invite")'),
    'The task routes keep the staff permission guard',
  );

  assert(
    !containsCode(schema, 'facility_role_permission_edits'),
    'No new table was invented for this feature',
  );
}

/* ============================================================
   10. Deactivate and activate a staff account
   ============================================================ */

function testAccountStatus(): void {
  assert(
    containsCode(rolesService, 'export async function setStaffAccountStatus'),
    'The service exposes one status change',
  );
  assert(
    containsCode(rolesService, 'SELF_STATUS_CHANGE_NOT_ALLOWED'),
    'Nobody can deactivate their own account',
  );
  assert(
    containsCode(rolesService, 'ADMINISTRATOR_ACCOUNT_PROTECTED'),
    'An administrator account is protected from this screen',
  );
  assert(
    containsCode(rolesService, 'STAFF_NOT_FOUND'),
    'An account outside the facility is not found, not forbidden',
  );
  assert(
    containsCode(rolesService, 'ACCOUNT_PENDING_INVITATION'),
    'A pending invitation is revoked, not deactivated — acceptance would undo it',
  );
  assert(
    containsCode(rolesService, 'accountStatus: "DISABLED"') &&
      containsCode(rolesService, 'isActive: false'),
    'Deactivation disables the account rather than deleting it',
  );
  assert(
    containsCode(rolesService, 'securityVersion: target.securityVersion + 1'),
    'Deactivation invalidates the sessions already issued',
  );
  assert(
    containsCode(rolesService, 'deactivatedAt: now') &&
      containsCode(rolesService, 'deactivationReason'),
    'The time and reason are stored on the account',
  );
  assert(
    containsCode(rolesService, 'input.active ? "ACTIVATE" : "DEACTIVATE"'),
    'Both directions are written to the audit log',
  );

  assert(
    containsCode(loginService, '!user.isActive') &&
      containsCode(loginService, "accountStatus === 'DISABLED'"),
    'A deactivated account cannot sign in',
  );
  assert(
    containsCode(authMiddleware, '!user.isActive') &&
      containsCode(authMiddleware, 'accountStatus === "DISABLED"'),
    'An open session stops at its next request',
  );

  assert(containsCode(rolesRoutes, '"/:userId/status"'), 'The status route is registered');
  assert(
    containsCode(rolesRoutes, 'typeof body.active !== "boolean"'),
    'The route refuses a body that is not true or false',
  );

  assert(
    containsCode(panel, 'Deactivate') &&
      containsCode(panel, 'Activate') &&
      containsCode(panel, '/status`'),
    'The screen offers both directions and calls the route',
  );

  /*
   * The capability has to be reachable. A tab nobody can open is not a
   * capability, and a button nobody can see is not one either.
   */
  assert(
    containsCode(panel, 'Role tasks') &&
      containsCode(panel, 'Edit tasks') &&
      containsCode(panel, '/permissions`'),
    'The role-task editor is on the same screen and calls its routes',
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
  console.log("  2. Every query is scoped by the caller's tenant and facility");
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
  testTaskDelegationBoundary();
  console.log('  9. Tasks are delegable, administration is not');
  testAccountStatus();
  console.log('  10. A staff account can be switched off and on');

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
