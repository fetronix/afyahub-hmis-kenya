import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  MAX_ROLES_PER_STAFF_MEMBER,
  isAdministratorRoleName,
  isDelegablePermission,
  isRestrictedRolePermission,
} from '../auth/staff-role-policy.ts';
import { schemaSource, appSource, staffRolesServiceSource } from './support/schema-source.ts';
import { containsCode, countCode } from './support/source-text.ts';
import { staffAccountStatusBodySchema } from '../validation/schemas/index.ts';
import { validateBody } from '../validation/validate.ts';

import { describe, expect, it, vi } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

const root = resolve(here, '../..');

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

const policy = source('src/auth/staff-role-policy.ts');

const rolesService = staffRolesServiceSource();

const rolesRoutes = source('src/auth/staff-roles.routes.ts');

const invitationService = source('src/auth/staff-invitation.service.ts');

const invitationRoutes = source('src/auth/staff-invitation.routes.ts');

const verificationService = source(
  'src/integrations/professional/professional-verification.service.ts',
);

const app = appSource();

const wiring = source('src/routes/index.ts');

const panel = source('src/components/modules/StaffRolesPanel.tsx');

const configuration = source('src/components/modules/ConfigurationModule.tsx');

const sidebar = source('src/components/Sidebar.tsx');

const verificationModal = source('src/components/modules/StaffVerificationModal.tsx');

const schema = schemaSource();

const loginService = source('src/auth/login.service.ts');

const authMiddleware = source('src/auth/auth.middleware.ts');

describe('Staff roles — contract tests', () => {
  it('1. Which roles a facility may hand out', async () => {
    expect(
      containsCode(policy, 'RESTRICTED_PERMISSION_PREFIXES'),
      'The policy names restricted permission prefixes',
    ).toBe(true);

    for (const prefix of ['platform.', 'tenants.', 'subscriptions.', 'users.roles.']) {
      expect(containsCode(policy, `"${prefix}"`), `The policy blocks the ${prefix} prefix`).toBe(
        true,
      );
    }

    expect(
      isRestrictedRolePermission({ code: 'platform.tenants.read', module: 'platform' }),
      'A platform permission is restricted by module',
    ).toBe(true);
    expect(
      isRestrictedRolePermission({ code: 'roles.update', module: 'roles' }),
      'A role-mutating permission is restricted by code',
    ).toBe(true);
    expect(
      isRestrictedRolePermission({ code: 'users.roles.manage', module: 'users' }),
      'users.roles.manage is restricted even though its module is users',
    ).toBe(true);
    /*
     * Reading the facility's own audit trail is a legitimate staff role;
     * it is not an escalation. Only platform-level and role-management
     * permissions are withheld.
     */
    expect(
      !isRestrictedRolePermission({ code: 'audit.security.read', module: 'audit' }),
      'a facility auditor role stays assignable',
    ).toBe(true);

    for (const allowed of [
      { code: 'patients.read', module: 'patients' },
      { code: 'billing.payments.record', module: 'billing' },
      { code: 'inpatient.admit', module: 'inpatient' },
      { code: 'laboratory.results.enter', module: 'laboratory' },
    ]) {
      expect(!isRestrictedRolePermission(allowed), `${allowed.code} stays assignable`).toBe(true);
    }

    expect(
      isAdministratorRoleName('FACILITY_ADMIN'),
      'FACILITY_ADMIN is an administrator role',
    ).toBe(true);
    expect(
      isAdministratorRoleName('facility admin'),
      'Administrator names are matched case-insensitively',
    ).toBe(true);
    expect(
      isAdministratorRoleName('TENANT-ADMIN'),
      'Separator variants of administrator names are matched',
    ).toBe(true);
    expect(
      !isAdministratorRoleName('BILLING_CLERK'),
      'A staff role is not an administrator role',
    ).toBe(true);
    expect(
      !isAdministratorRoleName('CLINICAL_OFFICER'),
      'A clinical role is not an administrator role',
    ).toBe(true);

    /*
     * A role called "System Administrator" does not match the name
     * pattern — that is exactly why the permission check exists. The
     * service must apply both, not one.
     */
    expect(
      containsCode(rolesService, 'isAdministratorRoleName(role.name)'),
      'The role list is filtered by administrator name',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'role.permissions.some(isRestrictedRolePermission)'),
      'The role list is filtered by the permissions the role carries',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'if (role.permissions.length === 0)'),
      'A role that grants nothing is not offered',
    ).toBe(true);

    expect(
      !containsCode(policy, 'from "../db') && !containsCode(policy, "from 'drizzle-orm'"),
      'The policy module is free of database imports, so the test exercises the real rule',
    ).toBe(true);

    expect(MAX_ROLES_PER_STAFF_MEMBER, 'The per-staff role cap is a small, documented number').toBe(
      20,
    );
  });

  it('2. Scope: the facility, not a facility id from the request', async () => {
    expect(
      containsCode(wiring, 'api.use("/staff-roles", staffRolesRoutes);'),
      'The staff roles router is mounted',
    ).toBe(true);
    expect(
      containsCode(wiring, "import staffRolesRoutes from '../auth/staff-roles.routes.ts'"),
      'The router is imported by the app',
    ).toBe(true);

    expect(
      containsCode(rolesRoutes, 'router.use(requireAuth);'),
      'Every staff roles route requires authentication',
    ).toBe(true);

    const permissionGates = countCode(rolesRoutes, 'requirePermission("users.invite")');
    expect(
      permissionGates,
      'All six routes — directory, roles, role assignment, role tasks (two verbs) and account status — are gated on the staff-management permission',
    ).toBe(6);

    expect(
      containsCode(rolesRoutes, 'const scope = getScope(req);'),
      'Each route resolves scope from the authorization context',
    ).toBe(true);
    expect(
      containsCode(rolesRoutes, 'context.tenantId') &&
        containsCode(rolesRoutes, 'context.facilityId'),
      'Scope comes from the authorization context, not the body',
    ).toBe(true);
    expect(
      !containsCode(rolesRoutes, 'body.facilityId') &&
        !containsCode(rolesRoutes, 'req.body.facilityId'),
      'No route accepts a facility id from the request body',
    ).toBe(true);
    expect(
      containsCode(rolesRoutes, 'FACILITY_SCOPE_REQUIRED'),
      'An account without a facility scope is refused',
    ).toBe(true);

    expect(
      containsCode(rolesService, 'eq(users.tenantId, input.tenantId)') &&
        containsCode(rolesService, 'eq(users.facilityId, input.facilityId)'),
      'The staff directory is filtered by tenant and facility',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'target.tenantId !== input.tenantId') &&
        containsCode(rolesService, 'target.facilityId !== input.facilityId'),
      'The write re-checks the target account against the same scope',
    ).toBe(true);
    expect(
      containsCode(rolesService, '"STAFF_NOT_FOUND"') &&
        containsCode(rolesService, '"That staff account was not found at this facility."'),
      'An out-of-scope account is reported as not found, not forbidden',
    ).toBe(true);
  });

  it('3. The account that cannot be edited here', async () => {
    expect(
      containsCode(rolesService, 'holdsAdministratorRole'),
      'The service detects an account that holds an administrator role',
    ).toBe(true);
    expect(
      containsCode(rolesService, '"ADMINISTRATOR_ACCOUNT_PROTECTED"'),
      'An administrator account is protected from this screen',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'target.id === input.actorUserId'),
      'A caller cannot change their own roles',
    ).toBe(true);
    expect(
      containsCode(rolesService, '"SELF_ROLE_CHANGE_NOT_ALLOWED"'),
      'Self role changes are refused with a named code',
    ).toBe(true);
    expect(
      containsCode(
        rolesService,
        'Only a facility or platform administrator can change staff roles.',
      ),
      'A non-administrator cannot assign roles even with the invite permission',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'isAdministratorRoleName(name)'),
      'The caller role list is checked with the same policy',
    ).toBe(true);

    expect(
      containsCode(rolesService, 'fixedHeldRoleIds'),
      'Roles the facility can no longer offer are kept, not silently revoked',
    ).toBe(true);
  });

  it('4. Clinical roles still need a verified registration', async () => {
    expect(
      containsCode(rolesService, 'findVerifiedCredentialForUser({'),
      'A clinical addition asks for a verified credential',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'if (heldRoleIds.has(role.id) || !role.requiresVerification)'),
      'A role the person already holds is not re-checked',
    ).toBe(true);
    expect(
      containsCode(rolesService, '"VERIFICATION_REQUIRED"'),
      'A missing registration refuses the assignment with a named code',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'before assigning it.'),
      'The refusal says what has to happen first',
    ).toBe(true);

    expect(
      containsCode(verificationService, 'export async function findVerifiedCredentialForUser('),
      'The credential lookup lives in the verification service',
    ).toBe(true);
    expect(
      verificationService.includes(
        "sql`${schema.staffProfessionalCredentials.mode} is distinct from 'mock'`",
      ),
      'A simulated verification can never satisfy the gate',
    ).toBe(true);
    expect(
      verificationService.includes(
        'inArray(schema.staffProfessionalCredentials.status, INVITABLE_STATUSES)',
      ),
      'Only invitable statuses count as a usable credential',
    ).toBe(true);
    expect(
      containsCode(verificationService, 'row.regulator === expectedRegulator.code'),
      "The credential must match the role's regulator",
    ).toBe(true);

    expect(
      containsCode(invitationService, 'assertInvitationCredential({'),
      'Staff invitations still run the professional check',
    ).toBe(true);
    expect(
      containsCode(verificationService, "'REGULATOR_NOT_MAPPED'"),
      'An unmapped clinical role is refused in the verification service',
    ).toBe(true);
  });

  it('5. The verification record now belongs to the account', async () => {
    expect(
      containsCode(
        invitationService,
        'eq(staffProfessionalCredentials.invitationId, invitation.id)',
      ),
      'Accepting an invitation links its verification record',
    ).toBe(true);
    expect(
      containsCode(invitationService, 'isNull(staffProfessionalCredentials.userId)'),
      'An existing owner of the record is not overwritten',
    ).toBe(true);

    expect(
      containsCode(verificationService, 'async function resolveScopedStaffUser('),
      'A user id on a verification request is resolved against the facility',
    ).toBe(true);
    const scopedLookups = countCode(
      verificationService,
      'await resolveScopedStaffUser(facility, input.userId)',
    );
    expect(
      scopedLookups,
      'Both the automated and the manual check validate the staff account',
    ).toBe(2);
    expect(
      containsCode(verificationService, 'That staff account does not belong to this facility.'),
      'A staff account in another facility is refused',
    ).toBe(true);
    expect(
      containsCode(verificationService, 'eq(schema.users.tenantId, facility.tenantId)') &&
        containsCode(verificationService, 'eq(schema.users.facilityId, facility.id)'),
      'The staff account is resolved by tenant and facility',
    ).toBe(true);

    expect(
      containsCode(verificationService, 'export async function listUsableCredentialsForStaff('),
      'The directory can show which registrations are already on file',
    ).toBe(true);
  });

  it('6. One write, one audit row', async () => {
    expect(
      containsCode(rolesService, 'return db.transaction(async (tx) => {'),
      'Role assignment runs in one transaction',
    ).toBe(true);
    expect(
      containsCode(rolesService, '.for("update")'),
      'The target account row is locked for the change',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'await tx.insert(auditLogs).values({'),
      'The change writes an audit row inside the transaction',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'resource: "USER_ROLES"'),
      'The audit row names the resource',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'Changed roles for ${target.fullName}'),
      'The audit detail names the roles added and removed',
    ).toBe(true);
    expect(
      containsCode(rolesService, '.set({ isActive: false, revokedAt: now })'),
      'Revoking a role closes the row rather than deleting history',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'isActive: true,\n            revokedAt: null,'),
      'Re-adding a role reactivates the existing row, respecting the unique index',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'if (toAdd.length === 0 && toRemove.length === 0)'),
      'An unchanged request writes no audit row',
    ).toBe(true);

    // The feature must not need a migration.
    expect(!containsCode(rolesService, 'pgTable('), 'No table is declared in the new service').toBe(
      true,
    );
    const userRolesStart = schema.indexOf('export const userRoles = pgTable(');
    const userRolesEnd = schema.indexOf('export const sessions = pgTable(');
    const userRolesBlock = schema.slice(userRolesStart, userRolesEnd);

    expect(
      containsCode(userRolesBlock, "revokedAt: timestamp('revoked_at')"),
      'user_roles already has revoked_at',
    ).toBe(true);
    expect(
      containsCode(userRolesBlock, "isActive: boolean('is_active')"),
      'user_roles already has is_active',
    ).toBe(true);
    expect(
      containsCode(schema, 'export const auditLogs = pgTable('),
      'audit_logs already exists',
    ).toBe(true);
  });

  it('7. The invitation picker and the directory share one rule', async () => {
    expect(
      containsCode(
        invitationRoutes,
        'import { listAssignableStaffRoles } from "./staff-roles.service";',
      ),
      'The invitation picker uses the shared role list',
    ).toBe(true);
    expect(
      containsCode(invitationService, 'assertStaffRoleAssignable'),
      'Invitation creation uses the shared assignability check',
    ).toBe(true);
    expect(
      containsCode(invitationService, 'assertInvitationRole(db, input.tenantId, input.roleId)'),
      'The check is applied when an invitation is created',
    ).toBe(true);
    expect(
      containsCode(
        invitationService,
        'assertInvitationRole(tx, invitation.tenantId, invitation.roleId)',
      ),
      'The check is applied again when an invitation is accepted',
    ).toBe(true);
    expect(
      !containsCode(invitationService, 'normalizedRoleName.includes("SUPER_ADMIN")'),
      'The old name-only check is gone',
    ).toBe(true);
  });

  it('8. The screen', async () => {
    expect(
      containsCode(configuration, "import { StaffRolesPanel } from './StaffRolesPanel.tsx';"),
      'The configuration module imports the staff roles panel',
    ).toBe(true);
    expect(containsCode(configuration, '<StaffRolesPanel />'), 'The panel is rendered').toBe(true);
    expect(
      containsCode(configuration, "label: 'Staff & Roles'"),
      'The tab is labelled so the capability is findable',
    ).toBe(true);
    expect(
      containsCode(configuration, "{activeTab === 'staff' && ("),
      'The directory is on the staff tab, where invitations already live',
    ).toBe(true);

    /*
     * A tab nobody can open is not a capability. On a fresh install the
     * facility administrator holds users.invite and none of the four
     * permissions the Configuration nav used to require.
     */
    const configurationNavStart = sidebar.indexOf('configuration: [');
    const configurationNavEnd = sidebar.indexOf('],', configurationNavStart);
    const configurationNav = sidebar.slice(configurationNavStart, configurationNavEnd);

    expect(
      containsCode(configurationNav, "'users.invite'"),
      'The Configuration nav opens for an account that can manage staff',
    ).toBe(true);
    expect(
      containsCode(configuration, 'const canManageStaff') &&
        containsCode(configuration, "permissions.has('users.invite')"),
      'The staff tab is gated on the same permission its API requires',
    ).toBe(true);
    expect(
      containsCode(configuration, 'const staffOnly') &&
        containsCode(configuration, 'if (staffOnly) return false;'),
      'An account with only staff permissions sees only the staff tab',
    ).toBe(true);
    expect(
      containsCode(configuration, "staffOnly ? 'staff' : 'facility'"),
      'A staff-only account lands on the staff tab instead of an empty one',
    ).toBe(true);
    expect(
      containsCode(configuration, "if (isFacilityAdmin) return tab.id !== 'payments'"),
      'A facility administrator can reach the profile and module tabs',
    ).toBe(true);

    expect(
      containsCode(panel, 'fetch("/api/staff-roles/"'),
      'The panel reads the directory from the new endpoint',
    ).toBe(true);
    expect(
      containsCode(panel, '`/api/staff-roles/${editing.id}/roles`'),
      'The panel saves through the scoped role endpoint',
    ).toBe(true);
    expect(containsCode(panel, 'method: "PUT"'), 'Saving is a PUT, matching the route').toBe(true);
    expect(
      containsCode(panel, 'disabled={!member.canAssign}'),
      'A protected account cannot be opened from the list',
    ).toBe(true);
    expect(
      containsCode(panel, '!editing.canAssign ||'),
      'Saving is disabled when the account is protected',
    ).toBe(true);
    expect(
      containsCode(panel, 'subjectUserId={editing.id}'),
      'The verification check is recorded against the staff account',
    ).toBe(true);
    expect(containsCode(panel, 'No role'), 'An account with no role is called out').toBe(true);
    expect(
      containsCode(panel, 'No verified registration'),
      'A clinical role without a registration says so before saving',
    ).toBe(true);

    const modalUserIds = countCode(verificationModal, 'userId: subjectUserId');
    expect(
      modalUserIds,
      'The verification modal sends the staff account for both a registry check and a manual one',
    ).toBe(2);

    expect(
      containsCode(rolesRoutes, 'requirePermission("users.invite")'),
      "The screen's permission matches what the route enforces",
    ).toBe(true);
  });

  it('9. Task-level permissions — delegable work, never administration', async () => {
    /*
     * The two examples from the request: a doctor seeing bills, and a
     * facility managing service tariffs. If either of these is refused
     * the feature does not do what was asked.
     */
    expect(
      isDelegablePermission({ code: 'billing.read', module: 'billing' }),
      'A doctor can be given read access to bills',
    ).toBe(true);
    expect(
      isDelegablePermission({ code: 'tariffs.manage', module: 'billing' }),
      'A role can be given service-tariff management',
    ).toBe(true);
    expect(
      isDelegablePermission({ code: 'patients.read', module: 'patients' }),
      'Clinical tasks remain delegable',
    ).toBe(true);
    expect(
      isDelegablePermission({
        code: 'laboratory.results.verify',
        module: 'laboratory',
      }),
      'Verification of laboratory results is an operational task',
    ).toBe(true);

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
      expect(
        !isDelegablePermission(permission),
        `${permission.code} stays with the administrator`,
      ).toBe(true);
    }

    expect(
      !isDelegablePermission({ code: 'billing.read', module: 'made_up' }),
      'An unknown module is refused rather than assumed safe',
    ).toBe(true);

    expect(
      containsCode(policy, 'DELEGABLE_PERMISSION_MODULES') &&
        containsCode(policy, 'PROTECTED_PERMISSION_PREFIXES'),
      'The boundary is a named allowlist, not an inline condition',
    ).toBe(true);

    expect(
      containsCode(rolesService, 'PERMISSION_NOT_DELEGABLE'),
      'The service refuses a permission outside the allowlist',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'ROLE_NOT_EDITABLE'),
      'An administrator role cannot be edited from the facility',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'MIN_PERMISSIONS_PER_ROLE') ||
        containsCode(rolesService, 'INVALID_PERMISSION_SELECTION'),
      'A role cannot be saved with no tasks at all',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'delete(rolePermissions)'),
      'Revoking a task removes the grant row',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'delegableCurrentIds') && containsCode(rolesService, 'unmapped'),
      'A grant outside the allowlist is preserved and named, never silently stripped',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'resource: "ROLE_PERMISSIONS"'),
      'A task change writes an audit row naming the role',
    ).toBe(true);
    expect(
      containsCode(rolesService, '.for("update")'),
      'The role row is locked for the duration of the change',
    ).toBe(true);

    expect(
      containsCode(rolesRoutes, '"/roles/:roleId/permissions"'),
      'The task routes are registered',
    ).toBe(true);
    expect(
      containsCode(rolesRoutes, 'requirePermission("users.invite")'),
      'The task routes keep the staff permission guard',
    ).toBe(true);

    expect(
      !containsCode(schema, 'facility_role_permission_edits'),
      'No new table was invented for this feature',
    ).toBe(true);
  });

  it('10. Deactivate and activate a staff account', async () => {
    expect(
      containsCode(rolesService, 'export async function setStaffAccountStatus'),
      'The service exposes one status change',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'SELF_STATUS_CHANGE_NOT_ALLOWED'),
      'Nobody can deactivate their own account',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'ADMINISTRATOR_ACCOUNT_PROTECTED'),
      'An administrator account is protected from this screen',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'STAFF_NOT_FOUND'),
      'An account outside the facility is not found, not forbidden',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'ACCOUNT_PENDING_INVITATION'),
      'A pending invitation is revoked, not deactivated — acceptance would undo it',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'accountStatus: "DISABLED"') &&
        containsCode(rolesService, 'isActive: false'),
      'Deactivation disables the account rather than deleting it',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'securityVersion: target.securityVersion + 1'),
      'Deactivation invalidates the sessions already issued',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'deactivatedAt: now') &&
        containsCode(rolesService, 'deactivationReason'),
      'The time and reason are stored on the account',
    ).toBe(true);
    expect(
      containsCode(rolesService, 'input.active ? "ACTIVATE" : "DEACTIVATE"'),
      'Both directions are written to the audit log',
    ).toBe(true);

    expect(
      containsCode(loginService, '!user.isActive') &&
        containsCode(loginService, "accountStatus === 'DISABLED'"),
      'A deactivated account cannot sign in',
    ).toBe(true);
    expect(
      containsCode(authMiddleware, '!user.isActive') &&
        containsCode(authMiddleware, 'accountStatus === "DISABLED"'),
      'An open session stops at its next request',
    ).toBe(true);

    expect(containsCode(rolesRoutes, '"/:userId/status"'), 'The status route is registered').toBe(
      true,
    );

    const statusValidator = validateBody(staffAccountStatusBodySchema, {
      code: (issue) => (issue.path[0] === 'reason' ? 'INVALID_REASON' : 'INVALID_STATUS'),
    });
    const badRes = {
      statusCode: 200,
      payload: null as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.payload = body;
        return this;
      },
    };
    const nextSpy = vi.fn();
    statusValidator({ body: { active: 'yes' } } as any, badRes as any, nextSpy);
    expect(badRes.statusCode, 'The route refuses a body that is not true or false').toBe(400);
    expect(badRes.payload).toMatchObject({
      success: false,
      error: 'VALIDATION_ERROR',
      code: 'INVALID_STATUS',
    });
    expect(nextSpy).not.toHaveBeenCalled();

    const goodReq = { body: { active: false, reason: 'Contract ended' } } as any;
    statusValidator(goodReq, badRes as any, nextSpy);
    expect(nextSpy).toHaveBeenCalledTimes(1);
    expect(goodReq.validatedBody).toEqual({ active: false, reason: 'Contract ended' });

    expect(
      containsCode(panel, 'Deactivate') &&
        containsCode(panel, 'Activate') &&
        containsCode(panel, '/status`'),
      'The screen offers both directions and calls the route',
    ).toBe(true);

    /*
     * The capability has to be reachable. A tab nobody can open is not a
     * capability, and a button nobody can see is not one either.
     */
    expect(
      containsCode(panel, 'Role tasks') &&
        containsCode(panel, 'Edit tasks') &&
        containsCode(panel, '/permissions`'),
      'The role-task editor is on the same screen and calls its routes',
    ).toBe(true);
  });
});
