import * as domain from '../db/schema/relations-operations.ts';
import { schemaModuleContract } from './support/schema-module-contract.ts';

schemaModuleContract(
  'relations-operations',
  domain,
  [
    'inventoryItemsRelations',
    'inventoryBatchesRelations',
    'pharmacyDispensationsRelations',
    'suppliersRelations',
    'purchaseOrdersRelations',
    'billingInvoicesRelations',
    'billingItemsRelations',
    'billingPaymentsRelations',
    'insuranceClaimsRelations',
    'publicHealthReportsRelations',
  ],
  'relations',
);
