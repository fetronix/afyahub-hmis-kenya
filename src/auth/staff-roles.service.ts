/**
 * JaliCare HMIS — Staff Directory & Role Assignment Facade
 *
 * Domain workflows live under `src/auth/staff-roles/`:
 *   - `shared.ts` — `StaffRoleError`, assignability policy & catalogue loader
 *   - `directory.service.ts` — scoped staff directory & atomic role assignment
 *   - `permissions.service.ts` — delegable task catalogue & facility override sync
 *   - `status.service.ts` — staff account activation/deactivation & session revocation
 */

export {
  MAX_ROLES_PER_STAFF_MEMBER,
  MIN_PERMISSIONS_PER_ROLE,
  isAdministratorRoleName,
  isDelegablePermission,
  isRestrictedRolePermission,
} from './staff-role-policy';

export {
  StaffRoleError,
  assertStaffRoleAssignable,
  assertStaffRolesAssignable,
  describeRole,
  listAssignableStaffRoles,
  loadAssignableRoleCatalogue,
  pickAssignableRoles,
  type AssignableRole,
  type AssignableRoleCatalogue,
  type StaffRoleExecutor,
} from './staff-roles/shared.ts';

export {
  assignStaffRoles,
  getStaffRolesOverview,
  type FacilityStaffMember,
} from './staff-roles/directory.service.ts';

export {
  getRoleTaskCatalogue,
  updateRolePermissions,
  type RoleTaskCatalogue,
  type RoleTaskGroup,
} from './staff-roles/permissions.service.ts';

export { setStaffAccountStatus } from './staff-roles/status.service.ts';
