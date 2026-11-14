import * as domain from '../db/schema/sha-claims.ts';
import { schemaModuleContract } from './support/schema-module-contract.ts';

schemaModuleContract('sha-claims', domain, [
  'shaEclaims',
  'shaEclaimItems',
  'shaEclaimSubmissions',
  'shaEclaimStatusHistory',
  'shaCallbackEvents',
]);
