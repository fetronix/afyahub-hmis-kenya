/**
 * JaliCare HMIS
 * Database queries - the barrel
 *
 * The query functions live in `src/db/queries/<domain>.ts`, grouped by the
 * domain that owns the SQL. This file re-exports every one of them, so
 * `import * as queries from './db/queries.ts'` and the named imports beside it
 * keep working unchanged.
 *
 * Why this file is still here rather than being deleted: `queries` is a
 * namespace in 40-odd call sites, and `queries.PatientMrnConflictError` is
 * used with `instanceof`. A move that breaks either is a move that breaks the
 * API layer, so the barrel is the compatibility boundary.
 */

export { bedDayTariffCodes } from '../billing/billing.service.ts';
export * from './queries/tenancy.ts';
export * from './queries/patients.ts';
export * from './queries/encounters.ts';
export * from './queries/queues.ts';
export * from './queries/clinical.ts';
export * from './queries/inpatient.ts';
export * from './queries/laboratory.ts';
export * from './queries/inventory.ts';
export * from './queries/billing.ts';
export * from './queries/public-health.ts';

/*
 * The shared helpers stay out of the barrel on purpose: they were internal
 * before the split and they are internal now. Re-exporting them would widen
 * the module's public surface for no caller's benefit.
 *
 * The inpatient contract constants are different - they were part of the
 * public surface, so they are re-exported explicitly.
 */
export {
  ADMISSION_STATUSES,
  BED_STATUSES,
  BED_STATUS_SETTABLE,
  InpatientDomainError,
  type InpatientErrorCode,
} from './inpatient-contracts.ts';
