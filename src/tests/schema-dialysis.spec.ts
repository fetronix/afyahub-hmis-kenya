import * as domain from '../db/schema/dialysis.ts';
import { schemaModuleContract } from './support/schema-module-contract.ts';

schemaModuleContract('dialysis', domain, [
  'dialysisMachines',
  'dialysisPatientAssessments',
  'dialysisTreatmentPlans',
  'dialysisSchedules',
  'dialysisSessions',
  'dialysisConsumableUsages',
  'dialysisAdverseEvents',
]);
