import * as domain from '../db/schema/icd.ts';
import { schemaModuleContract } from './support/schema-module-contract.ts';

schemaModuleContract('icd', domain, ['icd11CatalogueEntries', 'icd10ToIcd11Mappings']);
