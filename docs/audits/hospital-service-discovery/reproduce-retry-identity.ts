/**
 * Synthetic, read-only characterization of ward identity during charge retry.
 *
 * No SQL query or network connection is made. The repository's test setup
 * provides obviously fake environment defaults required by the imported
 * modules. A fix should replace this characterization with a regression test
 * asserting that the original ward identity survives the retry. Do not restore
 * the risky behavior merely to keep this script passing.
 *
 * Run: node --import tsx docs/audits/hospital-service-discovery/reproduce-retry-identity.ts
 */
import assert from 'node:assert/strict';

import '../../../src/tests/vitest/support/setup.ts';
import { resolveFromRows, type ResolvableTariff } from '../../../src/billing/tariff-resolver.ts';

const { toChargeRequest } = await import('../../../src/billing/charge-attempts.ts');

// The queue currently stores the admission/date and ward labels, not ward ID.
const request = toChargeRequest(
  {
    id: 1,
    facilityId: 1,
    patientId: 1,
    encounterId: null,
    sourceType: 'BED_DAY',
    sourceId: 7,
    itemType: 'Inpatient',
    description: 'Synthetic ward bed',
    codes: ['BED-SYNTHETIC-WARD'],
    serviceKeys: ['BED_DAY:SYNTHETIC-WARD', 'BED_DAY'],
    family: 'BED_DAY',
    serviceName: 'bed day',
    encounterType: null,
    aliases: [],
    idempotencySuffix: '2026-10-01',
    wardType: 'ICU/HDU',
    wardName: 'Synthetic ICU',
    quantity: 1,
    fallbackUnitPrice: null,
    reason: 'TARIFF_NOT_CONFIGURED',
    detail: null,
    codesTried: [],
    status: 'PENDING',
    attempts: 1,
    lastAttemptAt: new Date('2026-10-02T00:00:00Z'),
    resolvedItemId: null,
    resolvedInvoiceId: null,
    resolvedTariffCode: null,
    resolvedUnitPrice: null,
    resolvedAt: null,
    createdAt: new Date('2026-10-02T00:00:00Z'),
  },
  1,
);
assert.equal(request.serviceRef, undefined);
assert.equal(request.idempotencySuffix, '2026-10-01');

const tariff: ResolvableTariff = {
  id: 1,
  code: 'SYNTHETIC-ONLY-LINK',
  description: 'Synthetic ward-only tariff',
  fee: '1.00', // synthetic input, not a facility price
  unit: 'Per day',
  department: 'inpatient',
  billingKey: null,
  isActive: true,
  effectiveFrom: null,
  effectiveTo: null,
  autoBill: true,
};
const input = {
  serviceType: 'BED_DAY' as const,
  family: 'BED_DAY' as const,
  serviceName: 'bed day',
  wardType: request.wardType,
  codes: request.codes,
  serviceKeys: request.serviceKeys,
  phrases: [],
  links: [
    { id: 1, serviceType: 'BED_DAY', serviceId: 42, tariffId: 1, isActive: true, autoBill: true },
  ],
  tariffs: [tariff],
  today: '2026-10-31',
};
const originally = resolveFromRows({ ...input, serviceId: 42 });
const reconstructed = resolveFromRows({ ...input, serviceId: null });
assert.equal(originally.rule, 'LINK');
assert.equal(originally.tariff?.id, 1);
assert.equal(reconstructed.tariff, null);
assert.equal(reconstructed.failure?.code, 'NO_TARIFF');
console.log(
  'Ward-specific link resolves with the original ward ID, but not with the reconstructed retry request: reproduced',
);
console.log('No database or patient data was accessed.');
