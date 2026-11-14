import * as domain from '../db/schema/private-insurance.ts';
import { schemaModuleContract } from './support/schema-module-contract.ts';

schemaModuleContract('private-insurance', domain, [
  'privateInsuranceClaims',
  'privateInsuranceClaimLines',
  'privateInsuranceClaimSubmissions',
  'privateInsuranceClaimStatusHistory',
  'privateInsuranceRemittanceAllocations',
]);
