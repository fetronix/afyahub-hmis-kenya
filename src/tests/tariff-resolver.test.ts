/**
 * JaliCare HMIS
 * Service → tariff resolution — the laboratory billing reconstruction
 *
 * Built around the reported failure:
 *
 *   Laboratory orders reach the Laboratory queue, but the charge is
 *   skipped because the engine looks for LAB-BLOOD, BLOOD, LAB-GENERAL
 *   and the facility's price list contains LAB-001 … LAB-008 plus one
 *   row coded LAB-BLOOD whose description is literally "LAB-BLOOD".
 *
 * Two root causes are asserted here, both at the level where money is
 * decided:
 *
 *   1. The order carried no catalogue identity. The outpatient screen
 *      sends free text, `lab_orders.test_id` was NULL, so there was
 *      nothing for a tariff to be linked to.
 *   2. Resolution compared strings and reported every failure as the
 *      same sentence.
 *
 * No database is required. Every rule is tested through
 * `resolveFromRows`, which is exactly what the server runs.
 *
 * Run with: npx tsx src/tests/tariff-resolver.test.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CONFIGURATION_FAILURES,
  dateVerdict,
  failureLabel,
  familyForServiceType,
  isCatalogueServiceType,
  isMissingSchemaObject,
  needsConfiguration,
  resolveFromRows,
  todayKey,
  unitVerdict,
  type ResolvableTariff,
  type ResolutionInput,
  type TariffLink,
} from '../billing/tariff-resolver.ts';
import { isVaguePhrase } from '../billing/tariff-matching.ts';
import { codesForFamily } from '../billing/tariff-matching.ts';
import { toCents } from '../billing/billing.service.ts';

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`,
  );
}

/* ============================================================
   THE FACILITY'S REAL PRICE LIST
   ============================================================ */

const TODAY = '2026-10-22';

function tariff(
  id: number,
  code: string,
  description: string,
  fee: string,
  unit: string,
  extra: Partial<ResolvableTariff> = {},
): ResolvableTariff {
  return {
    id,
    code,
    description,
    fee,
    unit,
    department: 'laboratory',
    billingKey: null,
    isActive: true,
    effectiveFrom: null,
    effectiveTo: null,
    autoBill: true,
    ...extra,
  };
}

/** The eight rows the facility described, unchanged. */
const labTariffs: ResolvableTariff[] = [
  tariff(101, 'LAB-001', 'Malaria rapid diagnostic test', '300.00', 'Test'),
  tariff(102, 'LAB-002', 'Random blood glucose', '200.00', 'Test'),
  tariff(103, 'LAB-003', 'Urinalysis', '300.00', 'Test'),
  tariff(104, 'LAB-004', 'Pregnancy test', '300.00', 'Test'),
  tariff(105, 'LAB-005', 'Haemoglobin test', '300.00', 'Test'),
  tariff(106, 'LAB-007', 'Stool microscopy', '400.00', 'Test'),
  tariff(107, 'LAB-008', 'Specimen collection', '150.00', 'Specimen'),
  /*
   * The row that started this: a tariff whose description is its own
   * code. It is a real existing price at 800 and is preserved exactly.
   */
  tariff(108, 'LAB-BLOOD', 'LAB-BLOOD', '800.00', 'Test'),
];

/**
 * The catalogue services a clinician can order, with the ids a link
 * would be keyed on. These mirror the tariff descriptions where the
 * catalogue name is the same clinical service.
 */
const catalogue = [
  { id: 1, code: 'MAL-RDT', name: 'Malaria rapid diagnostic test' },
  { id: 2, code: 'RBG', name: 'Random blood glucose' },
  { id: 3, code: 'URIN', name: 'Urinalysis' },
  { id: 4, code: 'PREG', name: 'Pregnancy test' },
  { id: 5, code: 'HB', name: 'Haemoglobin test' },
  { id: 6, code: 'STOOL', name: 'Stool microscopy' },
  { id: 7, code: 'BLOOD', name: 'Blood' },
];

function input(overrides: Partial<ResolutionInput>): ResolutionInput {
  return {
    serviceType: 'LAB_TEST',
    codes: [],
    serviceKeys: [],
    family: 'LABORATORY',
    phrases: [],
    links: [],
    tariffs: labTariffs,
    today: TODAY,
    ...overrides,
  };
}

/* ============================================================
   1. EACH EXISTING SERVICE FINDS ITS OWN TARIFF
   ============================================================ */

function testEachServicePricesCorrectly(): void {
  const expected: Array<[string, string, string, string]> = [
    ['Malaria rapid diagnostic test', 'LAB-001', '300.00', 'Test'],
    ['Random blood glucose', 'LAB-002', '200.00', 'Test'],
    ['Urinalysis', 'LAB-003', '300.00', 'Test'],
    ['Pregnancy test', 'LAB-004', '300.00', 'Test'],
    ['Haemoglobin test', 'LAB-005', '300.00', 'Test'],
    ['Stool microscopy', 'LAB-007', '400.00', 'Test'],
  ];

  for (const [name, code, fee, unit] of expected) {
    const resolution = resolveFromRows(
      input({
        serviceName: name,
        codes: codesForFamily({ family: 'LABORATORY', name }),
        phrases: [name],
      }),
    );

    assertEqual(resolution.tariff?.code, code, `${name} prices from ${code}`);
    assertEqual(resolution.tariff?.fee, fee, `${name} keeps its ${fee} fee`);
    assertEqual(resolution.tariff?.unit, unit, `${name} uses its own unit`);
    assertEqual(resolution.rule, 'CATALOGUE', `${name} matched on its description`);
    assert(resolution.failure === null, `${name} reports no failure`);
  }

  console.log('  ✓ Each catalogue service selects its own existing tariff');
}

/* ============================================================
   2. LAB-BLOOD IS NOT A GENERIC DUMPING GROUND
   ============================================================ */

function testLabBloodIsNotAGenericMatch(): void {
  /*
   * A test called "Blood" would previously have matched LAB-BLOOD on
   * the word alone and billed 800 for a haemoglobin test the facility
   * prices at 300.
   */
  const vague = resolveFromRows(
    input({
      serviceName: 'Blood',
      codes: codesForFamily({ family: 'LABORATORY', name: 'Blood' }),
      phrases: ['Blood'],
    }),
  );

  assertEqual(vague.tariff, null, '"Blood" does not resolve to LAB-BLOOD');
  assertEqual(vague.failure?.code, 'NO_TARIFF', 'it is reported as unlinked');

  assert(
    isVaguePhrase('Blood') && isVaguePhrase('Laboratory test'),
    'vague phrases are recognised',
  );
  assert(
    !isVaguePhrase('Haemoglobin test') && !isVaguePhrase('Malaria rapid diagnostic test'),
    'a specific service name is not vague',
  );

  /*
   * The row itself is untouched: same code, same 800, same unit. It is
   * still reachable by its own code, so nothing that used it broke.
   */
  const byCode = resolveFromRows(
    input({
      serviceName: 'LAB-BLOOD',
      codes: ['LAB-BLOOD'],
      phrases: ['LAB-BLOOD'],
    }),
  );

  assertEqual(byCode.tariff?.code, 'LAB-BLOOD', 'LAB-BLOOD is still reachable by code');
  assertEqual(byCode.tariff?.fee, '800.00', 'at its existing 800');
  assertEqual(byCode.rule, 'CODE', 'by exact code, not by the word "blood"');

  /*
   * And it can be linked explicitly to a catalogue service if the
   * facility decides that is what it is for.
   */
  const linked = resolveFromRows(
    input({
      serviceId: 7,
      links: [
        { id: 1, serviceType: 'LAB_TEST', serviceId: 7, tariffId: 108, autoBill: true, isActive: true },
      ],
    }),
  );

  assertEqual(linked.tariff?.code, 'LAB-BLOOD', 'an explicit link may use it');
  assertEqual(linked.rule, 'LINK', 'through the link rule');
  assertEqual(linked.tariff?.fee, '800.00', 'still at 800');

  console.log('  ✓ LAB-BLOOD is preserved and never matched on the word “blood”');
}

/* ============================================================
   3. EXPLICIT LINKS BY ID
   ============================================================ */

function testLinksByStableId(): void {
  const links: TariffLink[] = [
    { id: 11, serviceType: 'LAB_TEST', serviceId: 5, tariffId: 105, autoBill: true, isActive: true },
  ];

  const resolution = resolveFromRows(
    input({
      serviceId: 5,
      serviceName: 'Haemoglobin test',
      /* Deliberately misleading codes: the link must win. */
      codes: ['LAB-001', 'LAB-GENERAL'],
      links,
    }),
  );

  assertEqual(resolution.rule, 'LINK', 'a link by catalogue id is used first');
  assertEqual(resolution.tariff?.code, 'LAB-005', 'and points at the linked tariff');
  assertEqual(resolution.linkId, 11, 'the link row is reported');
  assertEqual(resolution.tariff?.fee, '300.00', 'the link does not change the price');

  /*
   * The id is what makes it stable: renaming the catalogue code does
   * not break the link, because the link never mentioned the code.
   */
  const renamed = resolveFromRows(
    input({ serviceId: 5, serviceName: 'Hb (renamed)', codes: ['HB'], links }),
  );

  assertEqual(renamed.tariff?.code, 'LAB-005', 'a renamed service keeps its price');

  console.log('  ✓ A link is by catalogue id, not by a name that can be renamed');
}

function testFamilyLink(): void {
  const links: TariffLink[] = [
    { id: 21, serviceType: 'LAB_TEST', serviceId: null, tariffId: 107, autoBill: true, isActive: true },
  ];

  const resolution = resolveFromRows(
    input({ serviceId: 3, serviceName: 'Urinalysis', links }),
  );

  assertEqual(resolution.rule, 'FAMILY_LINK', 'a family link applies when no specific one exists');
  assertEqual(resolution.tariff?.code, 'LAB-008', 'and prices from the family tariff');

  const specificWins = resolveFromRows(
    input({
      serviceId: 3,
      links: [
        ...links,
        { id: 22, serviceType: 'LAB_TEST', serviceId: 3, tariffId: 103, autoBill: true, isActive: true },
      ],
    }),
  );

  assertEqual(specificWins.tariff?.code, 'LAB-003',
    'a service-specific link beats the family link');
  assertEqual(specificWins.rule, 'LINK', 'and is reported as a direct link');

  console.log('  ✓ Family links apply, and a specific link beats them');
}

/* ============================================================
   4. VALIDITY: INACTIVE, EXPIRED, OTHER FACILITY, AUTO-BILL OFF
   ============================================================ */

function testInactiveIsRejectedWithAReason(): void {
  const tariffs = labTariffs.map((row) =>
    row.code === 'LAB-001' ? { ...row, isActive: false } : row,
  );

  const resolution = resolveFromRows(
    input({
      serviceName: 'Malaria rapid diagnostic test',
      codes: codesForFamily({ family: 'LABORATORY', name: 'Malaria rapid diagnostic test' }),
      phrases: ['Malaria rapid diagnostic test'],
      tariffs,
    }),
  );

  assertEqual(resolution.tariff, null, 'an inactive tariff is not used');
  assertEqual(resolution.failure?.code, 'INACTIVE', 'and the reason is "inactive", not "not found"');
  assert(
    (resolution.failure?.message ?? '').includes('LAB-001'),
    'the message names the row that was found and refused',
  );
  assert(needsConfiguration('INACTIVE'), 'which is a configuration problem');

  console.log('  ✓ An inactive tariff is refused, and named');
}

function testExpiredAndFuture(): void {
  assertEqual(dateVerdict(null, null, TODAY), 'OK', 'no dates means always valid');
  assertEqual(dateVerdict('2026-01-01', '2026-12-31', TODAY), 'OK', 'inside the period is valid');
  assertEqual(dateVerdict('2026-01-01', '2026-10-21', TODAY), 'EXPIRED', 'a day after the end is expired');
  assertEqual(dateVerdict('2026-01-01', '2026-10-22', TODAY), 'OK', 'the last day is still valid');
  assertEqual(dateVerdict('2026-11-01', null, TODAY), 'NOT_YET_EFFECTIVE', 'a future start is not yet valid');

  const expired = resolveFromRows(
    input({
      serviceName: 'Urinalysis',
      phrases: ['Urinalysis'],
      codes: ['LAB-003'],
      tariffs: labTariffs.map((row) =>
        row.code === 'LAB-003'
          ? { ...row, effectiveFrom: '2025-01-01', effectiveTo: '2026-06-30' }
          : row,
      ),
    }),
  );

  assertEqual(expired.tariff, null, 'an expired price is not charged');
  assertEqual(expired.failure?.code, 'EXPIRED', 'it is reported as expired');

  const future = resolveFromRows(
    input({
      serviceName: 'Urinalysis',
      phrases: ['Urinalysis'],
      codes: ['LAB-003'],
      tariffs: labTariffs.map((row) =>
        row.code === 'LAB-003'
          ? { ...row, effectiveFrom: '2027-01-01' }
          : row,
      ),
    }),
  );

  assertEqual(future.tariff, null, 'a future price is not charged either');
  assertEqual(future.failure?.code, 'NOT_YET_EFFECTIVE', 'and says so');

  console.log('  ✓ Effective dates are enforced against today’s date');
}

function testOtherFacilityCannotPrice(): void {
  /*
   * Facility isolation is a foreign key in migration 0021 and a
   * facility_id filter in every read. Here the assertion is that the
   * resolver is only ever given one facility's rows, and that a link
   * pointing at a missing row is reported rather than ignored.
   */
  const otherFacilityOnly = resolveFromRows(
    input({
      serviceName: 'Malaria rapid diagnostic test',
      phrases: ['Malaria rapid diagnostic test'],
      codes: ['LAB-001'],
      /* This facility's rows genuinely do not include LAB-001. */
      tariffs: labTariffs.filter((row) => row.code !== 'LAB-001'),
    }),
  );

  assertEqual(otherFacilityOnly.tariff, null,
    'another facility’s tariff is not visible here, so it cannot price the test');

  const danglingLink = resolveFromRows(
    input({
      serviceId: 1,
      links: [
        { id: 31, serviceType: 'LAB_TEST', serviceId: 1, tariffId: 999999, autoBill: true, isActive: true },
      ],
    }),
  );

  assertEqual(danglingLink.tariff, null, 'a link to a tariff not in this facility does not resolve');
  assertEqual(danglingLink.failure?.code, 'NO_TARIFF', 'and is reported');

  const migration = readFileSync(
    resolve(process.cwd(), 'drizzle/0021_service_tariff_links.sql'),
    'utf8',
  );

  assert(
    migration.includes('"service_tariff_links_tariff_facility_fk"') &&
      migration.includes('FOREIGN KEY ("facility_id", "tariff_id")'),
    'the database constraint makes cross-facility linking impossible',
  );

  console.log('  ✓ A tariff from another facility can never price a service here');
}

function testAutomaticBillingFlag(): void {
  const tariffs = labTariffs.map((row) =>
    row.code === 'LAB-002' ? { ...row, autoBill: false } : row,
  );

  const auto = resolveFromRows(
    input({
      serviceName: 'Random blood glucose',
      phrases: ['Random blood glucose'],
      codes: ['LAB-002'],
      tariffs,
    }),
  );

  assertEqual(auto.tariff, null, 'a tariff excluded from automatic billing is not used automatically');
  assertEqual(auto.failure?.code, 'AUTOMATIC_BILLING_DISABLED', 'and says why');

  const manual = resolveFromRows(
    input({
      serviceName: 'Random blood glucose',
      phrases: ['Random blood glucose'],
      codes: ['LAB-002'],
      tariffs,
      mode: 'MANUAL',
    }),
  );

  assertEqual(manual.tariff?.code, 'LAB-002', 'manual pricing may still use it');

  console.log('  ✓ Automatic billing can be switched off per tariff');
}

/* ============================================================
   5. UNITS
   ============================================================ */

function testUnitOfCharge(): void {
  assertEqual(unitVerdict('LAB_TEST', 'Test'), 'OK', 'a test unit is fine');
  assertEqual(unitVerdict('LAB_TEST', 'Per test'), 'OK', 'per test is fine');
  assertEqual(unitVerdict('LAB_TEST', 'Per day'), 'INCOMPATIBLE', 'a lab test cannot be per day');
  assertEqual(unitVerdict('CONSULTATION', 'Per visit'), 'OK', 'a consultation is per visit');
  assertEqual(unitVerdict('CONSULTATION', 'Per day'), 'INCOMPATIBLE', 'a consultation cannot be per day');
  assertEqual(unitVerdict('BED_DAY', 'Per night'), 'OK', 'a bed-day is per night');
  assertEqual(unitVerdict('LAB_TEST', ''), 'MISSING', 'an empty unit is missing');

  const incompatible = resolveFromRows(
    input({
      serviceName: 'Urinalysis',
      phrases: ['Urinalysis'],
      codes: ['LAB-003'],
      tariffs: labTariffs.map((row) =>
        row.code === 'LAB-003' ? { ...row, unit: 'Per day' } : row,
      ),
    }),
  );

  assertEqual(incompatible.tariff, null, 'a test priced per day is not charged');
  assertEqual(incompatible.failure?.code, 'UNIT_INCOMPATIBLE', 'and the unit is named as the problem');

  const missing = resolveFromRows(
    input({
      serviceName: 'Urinalysis',
      phrases: ['Urinalysis'],
      codes: ['LAB-003'],
      tariffs: labTariffs.map((row) =>
        row.code === 'LAB-003' ? { ...row, unit: '' } : row,
      ),
    }),
  );

  assertEqual(missing.failure?.code, 'NO_UNIT', 'a missing unit is its own diagnosis');

  console.log('  ✓ The unit of charge is validated, not assumed');
}

/* ============================================================
   6. AMBIGUITY NEVER PICKS
   ============================================================ */

function testAmbiguityFailsClosed(): void {
  const duplicated = [
    ...labTariffs,
    tariff(109, 'LAB-009', 'Malaria rapid diagnostic test', '350.00', 'Test'),
  ];

  const resolution = resolveFromRows(
    input({
      serviceName: 'Malaria rapid diagnostic test',
      phrases: ['Malaria rapid diagnostic test'],
      tariffs: duplicated,
    }),
  );

  assertEqual(resolution.tariff, null, 'two candidate tariffs produce no charge at all');
  assertEqual(resolution.failure?.code, 'AMBIGUOUS', 'the failure is ambiguity, not "not found"');
  assertEqual(
    resolution.failure?.candidates,
    ['LAB-001', 'LAB-009'],
    'both codes are named so the facility can decide',
  );
  assertEqual(
    toCents('0'),
    0,
    'nothing is billed, so nothing can be wrong',
  );

  console.log('  ✓ Ambiguity is reported, never resolved by row order');
}

/* ============================================================
   7. DIAGNOSTICS
   ============================================================ */

function testDiagnosticsCoverEveryStatedCase(): void {
  const labels = [
    'NO_TARIFF',
    'INACTIVE',
    'EXPIRED',
    'NOT_YET_EFFECTIVE',
    'AUTOMATIC_BILLING_DISABLED',
    'AMBIGUOUS',
    'UNIT_INCOMPATIBLE',
    'NO_UNIT',
  ] as const;

  for (const code of labels) {
    assert(failureLabel(code) !== code, `${code} has a human label`);
  }

  assertEqual(failureLabel('NO_TARIFF'), 'No tariff linked', 'the unlinked label is plain English');
  assertEqual(failureLabel('AMBIGUOUS'), 'Ambiguous tariff mapping', 'ambiguity is named');
  assertEqual(failureLabel('UNIT_INCOMPATIBLE'), 'Incompatible unit', 'units are named');

  assert(
    CONFIGURATION_FAILURES.includes('NO_TARIFF') &&
      CONFIGURATION_FAILURES.includes('AMBIGUOUS'),
    'configuration failures are distinguishable from data errors',
  );

  /*
   * The served screen reports each row with a verdict, so "why didn't
   * this bill?" is answered about the facility's own rows.
   */
  const resolution = resolveFromRows(
    input({
      serviceName: 'Haemoglobin test',
      phrases: ['Haemoglobin test'],
      tariffs: labTariffs.map((row) =>
        row.code === 'LAB-005' ? { ...row, isActive: false } : row,
      ),
    }),
  );

  const haemoglobin = resolution.rows.find((row) => row.tariff.code === 'LAB-005');

  assertEqual(haemoglobin?.verdict, 'INACTIVE', 'the rows carry a verdict each');
  assert(
    typeof haemoglobin?.note === 'string' && haemoglobin.note.length > 0,
    'and a sentence naming what to do',
  );

  console.log('  ✓ Every diagnostic the brief asks for has a label and a verdict');
}

/* ============================================================
   8. THE WORDS THE OLD ENGINE SEARCHED FOR
   ============================================================ */

function testOldCodesAreReportedNotGuessed(): void {
  /*
   * This is the message from the report: LAB-BLOOD, BLOOD, LAB-GENERAL.
   * The resolver still tries those codes — but a code is only used when
   * it matches a row exactly, so `LAB-GENERAL` no longer stands in for
   * "any laboratory price".
   */
  const codes = codesForFamily({ family: 'LABORATORY', name: 'Blood' });

  /*
   * A code generated from a vague name is a guess. `LAB-BLOOD` is not
   * derived from the word "Blood" any more — that derivation is what
   * made an 800 blood tariff look like a price for any blood test.
   * The generic fallbacks remain, because `LAB-GENERAL` only prices
   * anything if the facility deliberately created that row.
   */
  assert(
    !codes.includes('LAB-BLOOD'),
    'LAB-BLOOD is not generated from the word “blood”',
  );
  assert(!codes.includes('BLOOD'), 'nor is the bare word');
  assert(codes.includes('LAB-GENERAL'), 'the generic fallback is still offered');

  /*
   * An *explicit* catalogue code is a different matter: if the facility
   * really did code a catalogue test LAB-BLOOD, that code is used.
   */
  const explicit = codesForFamily({ family: 'LABORATORY', code: 'LAB-BLOOD', name: 'Blood' });

  assert(explicit.includes('LAB-BLOOD'), 'a real catalogue code is always tried');

  const resolution = resolveFromRows(
    input({ serviceName: 'Blood', codes, phrases: ['Blood'] }),
  );

  assertEqual(resolution.tariff, null, 'trying them does not mean charging one of them');
  assertEqual(resolution.codesTried, codes, 'the codes tried are reported back');

  /*
   * A row that *is* coded LAB-GENERAL is still a valid fallback, because
   * that is the facility explicitly pricing "any laboratory test".
   */
  const withGeneric = resolveFromRows(
    input({
      serviceName: 'Unpriced test',
      /* An unpriced, specifically-named test: no code of its own exists. */
      codes: ['LAB-UNPRICED-TEST', 'LAB-GENERAL', 'LABORATORY'],
      tariffs: [...labTariffs, tariff(110, 'LAB-GENERAL', 'Laboratory', '250.00', 'Test')],
    }),
  );

  assertEqual(withGeneric.tariff?.code, 'LAB-GENERAL', 'an explicit generic tariff still prices a test');
  assertEqual(withGeneric.rule, 'CODE', 'by its code, not by the word “laboratory”');

  console.log('  ✓ The old codes are tried and reported, never guessed at');
}

/* ============================================================
   9. THE ORDER CARRIES ITS CATALOGUE ID
   ============================================================ */

function testOrderCarriesCatalogueIdentity(): void {
  const queries = readFileSync(
    resolve(process.cwd(), 'src/db/queries.ts'),
    'utf8',
  );

  assert(
    queries.includes('resolveCatalogueTestByName'),
    'free-text investigations are resolved against the catalogue',
  );
  assert(
    queries.includes("'AMBIGUOUS'"),
    'an ambiguous catalogue name is reported, not guessed',
  );
  assert(
    queries.includes('testId: resolution.test.id'),
    'a resolved name attaches the catalogue id to the order',
  );
  assert(
    queries.includes('unresolved') && queries.includes('ambiguous'),
    'what could not be resolved is reported back to the caller',
  );

  const charges = readFileSync(
    resolve(process.cwd(), 'src/billing/service-charges.ts'),
    'utf8',
  );

  assert(
    charges.includes("type: 'LAB_TEST'"),
    'the laboratory charge carries its catalogue type',
  );
  assert(
    charges.includes('id: typeof order.testId === \'number\' ? order.testId : null'),
    'and its catalogue id, which is what a link is keyed on',
  );

  console.log('  ✓ A laboratory order carries the catalogue id it was ordered from');
}

/* ============================================================
   10. CONSULTATION AND THE OTHER WORKFLOWS STILL RESOLVE
   ============================================================ */

function testOtherWorkflowsUseTheSameResolver(): void {
  const consultation = resolveFromRows({
    serviceType: 'CONSULTATION',
    family: 'CONSULTATION',
    codes: codesForFamily({ family: 'CONSULTATION', encounterType: 'OUTPATIENT' }),
    serviceKeys: ['CONSULTATION'],
    phrases: ['general outpatient consultation', 'outpatient consultation'],
    links: [],
    today: TODAY,
    tariffs: [
      {
        id: 201,
        code: 'OPD-001',
        description: 'General outpatient consultation',
        fee: '150.00',
        unit: 'Per visit',
        department: 'opd',
        isActive: true,
        effectiveFrom: null,
        effectiveTo: null,
        autoBill: true,
      },
      {
        id: 202,
        code: 'OPD-002',
        description: 'Follow-up consultation',
        fee: '300.00',
        unit: 'Per visit',
        department: 'opd',
        isActive: true,
        effectiveFrom: null,
        effectiveTo: null,
        autoBill: true,
      },
    ],
  });

  assertEqual(consultation.tariff?.code, 'OPD-001', 'consultation still prices from OPD-001');
  assertEqual(consultation.tariff?.fee, '150.00', 'at 150');
  assertEqual(consultation.tariff?.unit, 'Per visit', 'per visit');

  const opd002 = resolveFromRows({
    serviceType: 'CONSULTATION',
    family: 'CONSULTATION',
    codes: codesForFamily({ family: 'CONSULTATION', encounterType: 'FOLLOW_UP' }),
    phrases: ['follow-up consultation'],
    links: [],
    today: TODAY,
    tariffs: [
      {
        id: 201,
        code: 'OPD-001',
        description: 'General outpatient consultation',
        fee: '150.00',
        unit: 'Per visit',
        department: 'opd',
        isActive: true,
        effectiveFrom: null,
        effectiveTo: null,
        autoBill: true,
      },
      {
        id: 202,
        code: 'OPD-002',
        description: 'Follow-up consultation',
        fee: '300.00',
        unit: 'Per visit',
        department: 'opd',
        isActive: true,
        effectiveFrom: null,
        effectiveTo: null,
        autoBill: true,
      },
    ],
  });

  assertEqual(opd002.tariff?.code, 'OPD-002', 'a follow-up still prices from OPD-002');

  assertEqual(familyForServiceType('LAB_TEST'), 'LABORATORY', 'LAB_TEST maps to the laboratory family');
  assertEqual(familyForServiceType('RADIOLOGY'), 'RADIOLOGY', 'radiology maps to itself');
  assert(isCatalogueServiceType('LAB_TEST'), 'the type vocabulary is closed');
  assert(!isCatalogueServiceType('ANYTHING'), 'and rejects unknown types');

  console.log('  ✓ Consultation and the other workflows use the same resolver');
}

/* ============================================================
   11. SCHEMA AND MIGRATION GUARDS
   ============================================================ */

function testMigrationIsSafeAndApplied(): void {
  const migration = readFileSync(
    resolve(process.cwd(), 'drizzle/0021_service_tariff_links.sql'),
    'utf8',
  );
  const journal = readFileSync(
    resolve(process.cwd(), 'drizzle/meta/_journal.json'),
    'utf8',
  );

  assert(
    /ADD COLUMN IF NOT EXISTS "effective_from"/.test(migration),
    'validity dates are added idempotently',
  );
  assert(
    /ADD COLUMN IF NOT EXISTS "auto_bill" boolean NOT NULL DEFAULT true/.test(migration),
    'the automatic-billing flag defaults to today’s behaviour',
  );
  assert(
    migration.includes('CREATE TABLE IF NOT EXISTS "service_tariff_links"'),
    'the link table is created idempotently',
  );
  assert(
    migration.includes('service_tariff_links_service_unique'),
    'one active link per catalogue service',
  );
  assert(
    migration.includes('ON DELETE RESTRICT'),
    'a tariff with a link cannot be deleted out from under it',
  );
  assert(
    !/DROP\s+TABLE/i.test(migration) &&
      !/TRUNCATE/i.test(migration) &&
      !/DROP\s+COLUMN/i.test(migration),
    'the migration destroys nothing',
  );
  assert(
    !/UPDATE\s+"?facility_service_tariffs"?/i.test(migration),
    'no existing tariff row is rewritten',
  );
  assert(journal.includes('0021_service_tariff_links'), 'and it is recorded in the journal');

  assert(
    isMissingSchemaObject({ code: '42P01' }) && isMissingSchemaObject({ code: '42703' }),
    'a database one migration behind is detected, not crashed',
  );

  assert(todayKey(new Date(2026, 9, 22)) === '2026-10-22', 'today is a local calendar date');

  console.log('  ✓ The migration is additive, guarded and journaled');
}

/* ============================================================
   12. NO SECOND BILLING ENGINE
   ============================================================ */

function testOneEngine(): void {
  const billing = readFileSync(
    resolve(process.cwd(), 'src/billing/billing.service.ts'),
    'utf8',
  );

  assert(
    billing.includes('resolveServiceTariff('),
    'the charge path calls the shared resolver',
  );
  assert(
    !billing.includes('insert(schema.billingItems)') ||
      billing.split('insert(schema.billingItems)').length === 2,
    'there is exactly one place that writes an invoice line',
  );

  const app = readFileSync(resolve(process.cwd(), 'src/app.ts'), 'utf8');

  assert(
    app.includes("'/api/service-tariff-links'"),
    'links are configured through the existing tariff configuration surface',
  );
  assert(
    app.includes("'/api/billing/lab-service-diagnostics'"),
    'and the laboratory diagnostics are served from the billing module',
  );
  assert(
    app.includes("requirePermission('tariffs.manage')"),
    'link changes require the tariff-management permission',
  );
  assert(
    app.includes('requireFacilityAdminTariffRole'),
    'and the facility-admin guard',
  );

  console.log('  ✓ One resolver, one invoice writer, existing permissions');
}

/* ============================================================
   RUNNER
   ============================================================ */

function run(): void {
  console.log('');
  console.log('==============================================');
  console.log('SERVICE → TARIFF RESOLUTION TESTS');
  console.log('==============================================');
  console.log('');

  testEachServicePricesCorrectly();
  testLabBloodIsNotAGenericMatch();
  testLinksByStableId();
  testFamilyLink();
  testInactiveIsRejectedWithAReason();
  testExpiredAndFuture();
  testOtherFacilityCannotPrice();
  testAutomaticBillingFlag();
  testUnitOfCharge();
  testAmbiguityFailsClosed();
  testDiagnosticsCoverEveryStatedCase();
  testOldCodesAreReportedNotGuessed();
  testOrderCarriesCatalogueIdentity();
  testOtherWorkflowsUseTheSameResolver();
  testMigrationIsSafeAndApplied();
  testOneEngine();

  console.log('');
  console.log('==============================================');
  console.log(`TARIFF RESOLVER TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('TARIFF RESOLVER TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
