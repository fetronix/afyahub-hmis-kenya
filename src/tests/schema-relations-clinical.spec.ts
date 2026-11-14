import * as domain from '../db/schema/relations-clinical.ts';
import { schemaModuleContract } from './support/schema-module-contract.ts';

schemaModuleContract(
  'relations-clinical',
  domain,
  [
    'practitionersRelations',
    'patientsRelations',
    'patientIdentifiersRelations',
    'encountersRelations',
    'observationsRelations',
    'diagnosesRelations',
    'medicationsRelations',
    'wardsRelations',
    'bedsRelations',
    'admissionsRelations',
    'theatreCasesRelations',
    'labTestsRelations',
    'labOrdersRelations',
    'labResultsRelations',
    'radiologyOrdersRelations',
  ],
  'relations',
);
