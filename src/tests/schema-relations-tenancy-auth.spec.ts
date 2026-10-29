import * as domain from '../db/schema/relations-tenancy-auth.ts';
import { schemaModuleContract } from './support/schema-module-contract.ts';

schemaModuleContract(
  'relations-tenancy-auth',
  domain,
  [
    'tenantsRelations',
    'facilitiesRelations',
    'departmentsRelations',
    'rolesRelations',
    'permissionsRelations',
    'rolePermissionsRelations',
    'usersRelations',
    'userRolesRelations',
    'sessionsRelations',
    'loginAttemptsRelations',
    'passwordResetsRelations',
    'facilityOnboardingRelations',
    'facilityDocumentsRelations',
    'facilityAdminInvitationsRelations',
    'userInvitationsRelations',
  ],
  'relations',
);
