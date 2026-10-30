/**
 * Public Drizzle schema barrel.
 *
 * drizzle.config.ts and existing application imports depend on these exports.
 * Tables and relations live in domain modules; their definitions and database
 * migrations are unchanged by this extraction.
 */

export * from './schema/tenancy.ts';
export * from './schema/auth.ts';
export * from './schema/patients.ts';
export * from './schema/referrals.ts';
export * from './schema/clinical.ts';
export * from './schema/inpatient.ts';
export * from './schema/theatre-scheduling.ts';
export * from './schema/laboratory.ts';
export * from './schema/inventory.ts';
export * from './schema/billing.ts';
export * from './schema/public-health.ts';
export * from './schema/maternity.ts';
export * from './schema/platform.ts';
export * from './schema/insurance-payers.ts';
export * from './schema/insurance-benefits.ts';
export * from './schema/sha-claims.ts';
export * from './schema/insurance-remittances.ts';
export * from './schema/private-insurance.ts';
export * from './schema/icd.ts';
export * from './schema/financial-ledger.ts';
export * from './schema/banking.ts';
export * from './schema/dialysis.ts';
export * from './schema/website-booking.ts';
export * from './schema/payment-hub.ts';
export * from './schema/relations-tenancy-auth.ts';
export * from './schema/relations-clinical.ts';
export * from './schema/relations-operations.ts';
