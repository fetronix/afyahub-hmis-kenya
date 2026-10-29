import * as domain from '../db/schema/insurance-remittances.ts';
import { schemaModuleContract } from './support/schema-module-contract.ts';

schemaModuleContract('insurance-remittances', domain, [
  'insuranceRemittances',
  'insuranceReconciliationEntries',
]);
