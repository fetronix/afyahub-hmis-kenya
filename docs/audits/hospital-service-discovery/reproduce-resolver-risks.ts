/**
 * Read-only characterization of the audited resolver at source commit b198db1.
 *
 * Everything here is synthetic. IDs, codes and amounts are test fixtures, not
 * actual facility, payer or patient data and not suggested prices. This script
 * documents *current risky behavior*, not the expected behavior after a fix.
 * If a risk is fixed, change the audit and replace the characterization with
 * a regression test for the corrected behavior; do not restore the risk merely
 * to make this script pass. No database, network or application server is used.
 *
 * Run: node --import tsx docs/audits/hospital-service-discovery/reproduce-resolver-risks.ts
 */
import assert from 'node:assert/strict';

import {
  resolveFromRows,
  type ResolvableTariff,
  type ResolutionInput,
  type TariffLink,
} from '../../../src/billing/tariff-resolver.ts';

function tariff(overrides: Partial<ResolvableTariff> = {}): ResolvableTariff {
  return {
    id: 1,
    code: 'SYNTHETIC',
    description: 'Synthetic fixture',
    fee: '1.00',
    unit: 'Test',
    department: 'laboratory',
    billingKey: null,
    isActive: true,
    effectiveFrom: null,
    effectiveTo: null,
    autoBill: true,
    ...overrides,
  };
}

function lab(overrides: Partial<ResolutionInput> = {}): ResolutionInput {
  return {
    serviceType: 'LAB_TEST',
    serviceId: 42,
    serviceName: 'Synthetic lab test',
    family: 'LABORATORY',
    codes: ['LAB-SYNTHETIC'],
    serviceKeys: [],
    phrases: [],
    links: [],
    tariffs: [],
    today: '2026-10-31',
    ...overrides,
  };
}

function link(overrides: Partial<TariffLink> = {}): TariffLink {
  return {
    id: 1,
    serviceType: 'LAB_TEST',
    serviceId: null,
    tariffId: 1,
    isActive: true,
    autoBill: true,
    ...overrides,
  };
}

const bed: ResolutionInput = {
  serviceType: 'BED_DAY',
  serviceId: 42,
  serviceName: 'bed day',
  family: 'BED_DAY',
  wardType: 'ICU/HDU',
  codes: ['BED-ICU', 'WARD-ICU', 'BED-DAY'],
  serviceKeys: ['BED_DAY:ICU', 'BED_DAY'],
  phrases: [],
  links: [link({ serviceType: 'BED_DAY', tariffId: 1 })],
  tariffs: [tariff({ id: 1, code: 'BED-DAY', unit: 'Per day', department: 'inpatient' })],
  today: '2026-10-31',
};
const genericBedCode = resolveFromRows(bed);
assert.equal(genericBedCode.rule, 'CODE');
assert.equal(genericBedCode.tariff?.id, 1);
console.log('R1: ICU/HDU -> generic BED-DAY code despite skipped family link: reproduced');

const genericBedAlias = resolveFromRows({
  ...bed,
  tariffs: [
    tariff({
      id: 1,
      code: 'SYNTHETIC-BED-TARIFF',
      billingKey: 'BED_DAY',
      unit: 'Per day',
      department: 'inpatient',
    }),
  ],
});
assert.equal(genericBedAlias.rule, 'ALIAS');
assert.equal(genericBedAlias.tariff?.id, 1);
console.log('R2: ICU/HDU -> family BED_DAY billing-key alias despite skipped link: reproduced');

const familyLab = resolveFromRows(
  lab({
    links: [link({ tariffId: 1 })],
    tariffs: [tariff({ id: 1 }), tariff({ id: 2, code: 'LAB-SYNTHETIC' })],
  }),
);
assert.equal(familyLab.rule, 'FAMILY_LINK');
assert.equal(familyLab.tariff?.id, 1);
console.log('R3: family-wide lab link outranks a test-specific code: reproduced');

const first = tariff({ id: 1, code: 'LAB-SYNTHETIC' });
const second = tariff({ id: 2, code: 'lab-synthetic', fee: '2.00' });
const forward = resolveFromRows(lab({ tariffs: [first, second] }));
const backward = resolveFromRows(lab({ tariffs: [second, first] }));
assert.equal(forward.rule, 'CODE');
assert.equal(backward.rule, 'CODE');
assert.equal(forward.tariff?.id, 1);
assert.equal(backward.tariff?.id, 2);
console.log('R4: case-variant exact codes select different IDs when row order changes: reproduced');

const aliasFirst = tariff({ id: 1, code: 'A', billingKey: 'LABORATORY:LAB-SYNTHETIC' });
const aliasSecond = tariff({ id: 2, code: 'B', billingKey: 'laboratory:lab-synthetic' });
const aliasRequest = lab({ codes: [], serviceKeys: ['LABORATORY:LAB-SYNTHETIC'] });
const aliasForward = resolveFromRows({ ...aliasRequest, tariffs: [aliasFirst, aliasSecond] });
const aliasBackward = resolveFromRows({ ...aliasRequest, tariffs: [aliasSecond, aliasFirst] });
assert.equal(aliasForward.rule, 'ALIAS');
assert.equal(aliasBackward.rule, 'ALIAS');
assert.equal(aliasForward.tariff?.id, 1);
assert.equal(aliasBackward.tariff?.id, 2);
console.log(
  'R5: case-variant billing keys select different IDs when row order changes: reproduced',
);

const wrongDepartment = resolveFromRows(
  lab({ tariffs: [tariff({ code: 'LAB-SYNTHETIC', department: 'pharmacy' })] }),
);
assert.equal(wrongDepartment.rule, 'CODE');
assert.equal(wrongDepartment.tariff?.department, 'pharmacy');
console.log('R6: exact lab code resolves a tariff filed under pharmacy: reproduced');

const explicit = resolveFromRows(
  lab({
    links: [link({ id: 1, tariffId: 1 }), link({ id: 2, serviceId: 42, tariffId: 2 })],
    tariffs: [tariff({ id: 1 }), tariff({ id: 2, code: 'LAB-SYNTHETIC' })],
  }),
);
assert.equal(explicit.rule, 'LINK');
assert.equal(explicit.tariff?.id, 2);
console.log('Control: an explicit test-ID link wins over the family link');
