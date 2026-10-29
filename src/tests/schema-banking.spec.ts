import * as domain from '../db/schema/banking.ts';
import { schemaModuleContract } from './support/schema-module-contract.ts';

schemaModuleContract('banking', domain, [
  'bankAccounts',
  'supplierPayments',
  'bankStatementImports',
  'bankTransactions',
  'bankReconciliations',
]);
