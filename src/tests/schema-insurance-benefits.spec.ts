import * as domain from '../db/schema/insurance-benefits.ts';
import { schemaModuleContract } from './support/schema-module-contract.ts';

schemaModuleContract('insurance-benefits', domain, [
  'insuranceEligibilityVerifications',
  'insuranceBenefitValidations',
  'shaPatientAuthorizations',
  'shaBenefitUtilizationSnapshots',
  'insurancePreauthorizations',
  'insurancePreauthorizationAttachments',
]);
