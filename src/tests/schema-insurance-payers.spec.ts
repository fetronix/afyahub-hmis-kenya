import * as domain from '../db/schema/insurance-payers.ts';
import { schemaModuleContract } from './support/schema-module-contract.ts';

schemaModuleContract('insurance-payers', domain, [
  'insurancePayerConfigs',
  'insurancePayerDefinitions',
  'insurancePayerCapabilityPolicies',
  'insurancePayerAssignments',
  'insurancePayerEnvironmentConfigs',
  'insurancePayerAccessRequests',
  'insuranceMemberPolicies',
  'payerServiceCodeMappings',
  'payerBenefitRules',
  'insuranceIntegrationDiagnostics',
]);
