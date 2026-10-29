import * as domain from '../db/schema/financial-ledger.ts';
import { schemaModuleContract } from './support/schema-module-contract.ts';

schemaModuleContract('financial-ledger', domain, [
  'financialPeriods',
  'chartOfAccounts',
  'journalEntries',
  'journalLines',
  'expenseRequests',
  'fixedAssets',
  'fixedAssetMovements',
  'supplierInvoices',
]);
