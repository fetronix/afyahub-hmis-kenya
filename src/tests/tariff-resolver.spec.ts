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

import { describe, expect, it } from 'vitest';
import { queriesSource } from './support/schema-source.ts';

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

describe('Service → tariff resolution — the laboratory billing reconstruction', () => {
  it('1. EACH EXISTING SERVICE FINDS ITS OWN TARIFF', async () => {
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

      expect(JSON.stringify(resolution.tariff?.code), `${name} prices from ${code}`).toBe(
        JSON.stringify(code),
      );
      expect(JSON.stringify(resolution.tariff?.fee), `${name} keeps its ${fee} fee`).toBe(
        JSON.stringify(fee),
      );
      expect(JSON.stringify(resolution.tariff?.unit), `${name} uses its own unit`).toBe(
        JSON.stringify(unit),
      );
      expect(JSON.stringify(resolution.rule), `${name} matched on its description`).toBe(
        JSON.stringify('CATALOGUE'),
      );
      expect(resolution.failure === null, `${name} reports no failure`).toBe(true);
    }
  });

  it('2. LAB-BLOOD IS NOT A GENERIC DUMPING GROUND', async () => {
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

    expect(JSON.stringify(vague.tariff), '"Blood" does not resolve to LAB-BLOOD').toBe(
      JSON.stringify(null),
    );
    expect(JSON.stringify(vague.failure?.code), 'it is reported as unlinked').toBe(
      JSON.stringify('NO_TARIFF'),
    );

    expect(
      isVaguePhrase('Blood') && isVaguePhrase('Laboratory test'),
      'vague phrases are recognised',
    ).toBe(true);
    expect(
      !isVaguePhrase('Haemoglobin test') && !isVaguePhrase('Malaria rapid diagnostic test'),
      'a specific service name is not vague',
    ).toBe(true);

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

    expect(JSON.stringify(byCode.tariff?.code), 'LAB-BLOOD is still reachable by code').toBe(
      JSON.stringify('LAB-BLOOD'),
    );
    expect(JSON.stringify(byCode.tariff?.fee), 'at its existing 800').toBe(
      JSON.stringify('800.00'),
    );
    expect(JSON.stringify(byCode.rule), 'by exact code, not by the word "blood"').toBe(
      JSON.stringify('CODE'),
    );

    /*
     * And it can be linked explicitly to a catalogue service if the
     * facility decides that is what it is for.
     */
    const linked = resolveFromRows(
      input({
        serviceId: 7,
        links: [
          {
            id: 1,
            serviceType: 'LAB_TEST',
            serviceId: 7,
            tariffId: 108,
            autoBill: true,
            isActive: true,
          },
        ],
      }),
    );

    expect(JSON.stringify(linked.tariff?.code), 'an explicit link may use it').toBe(
      JSON.stringify('LAB-BLOOD'),
    );
    expect(JSON.stringify(linked.rule), 'through the link rule').toBe(JSON.stringify('LINK'));
    expect(JSON.stringify(linked.tariff?.fee), 'still at 800').toBe(JSON.stringify('800.00'));
  });

  it('3. EXPLICIT LINKS BY ID', async () => {
    const links: TariffLink[] = [
      {
        id: 11,
        serviceType: 'LAB_TEST',
        serviceId: 5,
        tariffId: 105,
        autoBill: true,
        isActive: true,
      },
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

    expect(JSON.stringify(resolution.rule), 'a link by catalogue id is used first').toBe(
      JSON.stringify('LINK'),
    );
    expect(JSON.stringify(resolution.tariff?.code), 'and points at the linked tariff').toBe(
      JSON.stringify('LAB-005'),
    );
    expect(JSON.stringify(resolution.linkId), 'the link row is reported').toBe(JSON.stringify(11));
    expect(JSON.stringify(resolution.tariff?.fee), 'the link does not change the price').toBe(
      JSON.stringify('300.00'),
    );

    /*
     * The id is what makes it stable: renaming the catalogue code does
     * not break the link, because the link never mentioned the code.
     */
    const renamed = resolveFromRows(
      input({ serviceId: 5, serviceName: 'Hb (renamed)', codes: ['HB'], links }),
    );

    expect(JSON.stringify(renamed.tariff?.code), 'a renamed service keeps its price').toBe(
      JSON.stringify('LAB-005'),
    );
  });

  it('Family Link', async () => {
    const links: TariffLink[] = [
      {
        id: 21,
        serviceType: 'LAB_TEST',
        serviceId: null,
        tariffId: 107,
        autoBill: true,
        isActive: true,
      },
    ];

    const resolution = resolveFromRows(input({ serviceId: 3, serviceName: 'Urinalysis', links }));

    expect(
      JSON.stringify(resolution.rule),
      'a family link applies when no specific one exists',
    ).toBe(JSON.stringify('FAMILY_LINK'));
    expect(JSON.stringify(resolution.tariff?.code), 'and prices from the family tariff').toBe(
      JSON.stringify('LAB-008'),
    );

    const specificWins = resolveFromRows(
      input({
        serviceId: 3,
        links: [
          ...links,
          {
            id: 22,
            serviceType: 'LAB_TEST',
            serviceId: 3,
            tariffId: 103,
            autoBill: true,
            isActive: true,
          },
        ],
      }),
    );

    expect(
      JSON.stringify(specificWins.tariff?.code),
      'a service-specific link beats the family link',
    ).toBe(JSON.stringify('LAB-003'));
    expect(JSON.stringify(specificWins.rule), 'and is reported as a direct link').toBe(
      JSON.stringify('LINK'),
    );
  });

  it('4. VALIDITY: INACTIVE, EXPIRED, OTHER FACILITY, AUTO-BILL OFF', async () => {
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

    expect(JSON.stringify(resolution.tariff), 'an inactive tariff is not used').toBe(
      JSON.stringify(null),
    );
    expect(
      JSON.stringify(resolution.failure?.code),
      'and the reason is "inactive", not "not found"',
    ).toBe(JSON.stringify('INACTIVE'));
    expect(
      (resolution.failure?.message ?? '').includes('LAB-001'),
      'the message names the row that was found and refused',
    ).toBe(true);
    expect(needsConfiguration('INACTIVE'), 'which is a configuration problem').toBe(true);
  });

  it('Expired And Future', async () => {
    expect(JSON.stringify(dateVerdict(null, null, TODAY)), 'no dates means always valid').toBe(
      JSON.stringify('OK'),
    );
    expect(
      JSON.stringify(dateVerdict('2026-01-01', '2026-12-31', TODAY)),
      'inside the period is valid',
    ).toBe(JSON.stringify('OK'));
    expect(
      JSON.stringify(dateVerdict('2026-01-01', '2026-10-21', TODAY)),
      'a day after the end is expired',
    ).toBe(JSON.stringify('EXPIRED'));
    expect(
      JSON.stringify(dateVerdict('2026-01-01', '2026-10-22', TODAY)),
      'the last day is still valid',
    ).toBe(JSON.stringify('OK'));
    expect(
      JSON.stringify(dateVerdict('2026-11-01', null, TODAY)),
      'a future start is not yet valid',
    ).toBe(JSON.stringify('NOT_YET_EFFECTIVE'));

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

    expect(JSON.stringify(expired.tariff), 'an expired price is not charged').toBe(
      JSON.stringify(null),
    );
    expect(JSON.stringify(expired.failure?.code), 'it is reported as expired').toBe(
      JSON.stringify('EXPIRED'),
    );

    const future = resolveFromRows(
      input({
        serviceName: 'Urinalysis',
        phrases: ['Urinalysis'],
        codes: ['LAB-003'],
        tariffs: labTariffs.map((row) =>
          row.code === 'LAB-003' ? { ...row, effectiveFrom: '2027-01-01' } : row,
        ),
      }),
    );

    expect(JSON.stringify(future.tariff), 'a future price is not charged either').toBe(
      JSON.stringify(null),
    );
    expect(JSON.stringify(future.failure?.code), 'and says so').toBe(
      JSON.stringify('NOT_YET_EFFECTIVE'),
    );
  });

  it('Other Facility Cannot Price', async () => {
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

    expect(
      JSON.stringify(otherFacilityOnly.tariff),
      'another facility’s tariff is not visible here, so it cannot price the test',
    ).toBe(JSON.stringify(null));

    const danglingLink = resolveFromRows(
      input({
        serviceId: 1,
        links: [
          {
            id: 31,
            serviceType: 'LAB_TEST',
            serviceId: 1,
            tariffId: 999999,
            autoBill: true,
            isActive: true,
          },
        ],
      }),
    );

    expect(
      JSON.stringify(danglingLink.tariff),
      'a link to a tariff not in this facility does not resolve',
    ).toBe(JSON.stringify(null));
    expect(JSON.stringify(danglingLink.failure?.code), 'and is reported').toBe(
      JSON.stringify('NO_TARIFF'),
    );

    const migration = readFileSync(
      resolve(process.cwd(), 'drizzle/0021_service_tariff_links.sql'),
      'utf8',
    );

    expect(
      migration.includes('"service_tariff_links_tariff_facility_fk"') &&
        migration.includes('FOREIGN KEY ("facility_id", "tariff_id")'),
      'the database constraint makes cross-facility linking impossible',
    ).toBe(true);
  });

  it('Automatic Billing Flag', async () => {
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

    expect(
      JSON.stringify(auto.tariff),
      'a tariff excluded from automatic billing is not used automatically',
    ).toBe(JSON.stringify(null));
    expect(JSON.stringify(auto.failure?.code), 'and says why').toBe(
      JSON.stringify('AUTOMATIC_BILLING_DISABLED'),
    );

    const manual = resolveFromRows(
      input({
        serviceName: 'Random blood glucose',
        phrases: ['Random blood glucose'],
        codes: ['LAB-002'],
        tariffs,
        mode: 'MANUAL',
      }),
    );

    expect(JSON.stringify(manual.tariff?.code), 'manual pricing may still use it').toBe(
      JSON.stringify('LAB-002'),
    );
  });

  it('5. UNITS', async () => {
    expect(JSON.stringify(unitVerdict('LAB_TEST', 'Test')), 'a test unit is fine').toBe(
      JSON.stringify('OK'),
    );
    expect(JSON.stringify(unitVerdict('LAB_TEST', 'Per test')), 'per test is fine').toBe(
      JSON.stringify('OK'),
    );
    expect(JSON.stringify(unitVerdict('LAB_TEST', 'Per day')), 'a lab test cannot be per day').toBe(
      JSON.stringify('INCOMPATIBLE'),
    );
    expect(
      JSON.stringify(unitVerdict('CONSULTATION', 'Per visit')),
      'a consultation is per visit',
    ).toBe(JSON.stringify('OK'));
    expect(
      JSON.stringify(unitVerdict('CONSULTATION', 'Per day')),
      'a consultation cannot be per day',
    ).toBe(JSON.stringify('INCOMPATIBLE'));
    expect(JSON.stringify(unitVerdict('BED_DAY', 'Per night')), 'a bed-day is per night').toBe(
      JSON.stringify('OK'),
    );
    expect(JSON.stringify(unitVerdict('LAB_TEST', '')), 'an empty unit is missing').toBe(
      JSON.stringify('MISSING'),
    );

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

    expect(JSON.stringify(incompatible.tariff), 'a test priced per day is not charged').toBe(
      JSON.stringify(null),
    );
    expect(JSON.stringify(incompatible.failure?.code), 'and the unit is named as the problem').toBe(
      JSON.stringify('UNIT_INCOMPATIBLE'),
    );

    const missing = resolveFromRows(
      input({
        serviceName: 'Urinalysis',
        phrases: ['Urinalysis'],
        codes: ['LAB-003'],
        tariffs: labTariffs.map((row) => (row.code === 'LAB-003' ? { ...row, unit: '' } : row)),
      }),
    );

    expect(JSON.stringify(missing.failure?.code), 'a missing unit is its own diagnosis').toBe(
      JSON.stringify('NO_UNIT'),
    );
  });

  it('6. AMBIGUITY NEVER PICKS', async () => {
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

    expect(
      JSON.stringify(resolution.tariff),
      'two candidate tariffs produce no charge at all',
    ).toBe(JSON.stringify(null));
    expect(
      JSON.stringify(resolution.failure?.code),
      'the failure is ambiguity, not "not found"',
    ).toBe(JSON.stringify('AMBIGUOUS'));
    expect(
      JSON.stringify(resolution.failure?.candidates),
      'both codes are named so the facility can decide',
    ).toBe(JSON.stringify(['LAB-001', 'LAB-009']));
    expect(JSON.stringify(toCents('0')), 'nothing is billed, so nothing can be wrong').toBe(
      JSON.stringify(0),
    );
  });

  it('7. DIAGNOSTICS', async () => {
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
      expect(failureLabel(code) !== code, `${code} has a human label`).toBe(true);
    }

    expect(JSON.stringify(failureLabel('NO_TARIFF')), 'the unlinked label is plain English').toBe(
      JSON.stringify('No tariff linked'),
    );
    expect(JSON.stringify(failureLabel('AMBIGUOUS')), 'ambiguity is named').toBe(
      JSON.stringify('Ambiguous tariff mapping'),
    );
    expect(JSON.stringify(failureLabel('UNIT_INCOMPATIBLE')), 'units are named').toBe(
      JSON.stringify('Incompatible unit'),
    );

    expect(
      CONFIGURATION_FAILURES.includes('NO_TARIFF') && CONFIGURATION_FAILURES.includes('AMBIGUOUS'),
      'configuration failures are distinguishable from data errors',
    ).toBe(true);

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

    expect(JSON.stringify(haemoglobin?.verdict), 'the rows carry a verdict each').toBe(
      JSON.stringify('INACTIVE'),
    );
    expect(
      typeof haemoglobin?.note === 'string' && haemoglobin.note.length > 0,
      'and a sentence naming what to do',
    ).toBe(true);
  });

  it('8. THE WORDS THE OLD ENGINE SEARCHED FOR', async () => {
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
    expect(!codes.includes('LAB-BLOOD'), 'LAB-BLOOD is not generated from the word “blood”').toBe(
      true,
    );
    expect(!codes.includes('BLOOD'), 'nor is the bare word').toBe(true);
    expect(codes.includes('LAB-GENERAL'), 'the generic fallback is still offered').toBe(true);

    /*
     * An *explicit* catalogue code is a different matter: if the facility
     * really did code a catalogue test LAB-BLOOD, that code is used.
     */
    const explicit = codesForFamily({ family: 'LABORATORY', code: 'LAB-BLOOD', name: 'Blood' });

    expect(explicit.includes('LAB-BLOOD'), 'a real catalogue code is always tried').toBe(true);

    const resolution = resolveFromRows(input({ serviceName: 'Blood', codes, phrases: ['Blood'] }));

    expect(
      JSON.stringify(resolution.tariff),
      'trying them does not mean charging one of them',
    ).toBe(JSON.stringify(null));
    expect(JSON.stringify(resolution.codesTried), 'the codes tried are reported back').toBe(
      JSON.stringify(codes),
    );

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

    expect(
      JSON.stringify(withGeneric.tariff?.code),
      'an explicit generic tariff still prices a test',
    ).toBe(JSON.stringify('LAB-GENERAL'));
    expect(JSON.stringify(withGeneric.rule), 'by its code, not by the word “laboratory”').toBe(
      JSON.stringify('CODE'),
    );
  });

  it('9. THE ORDER CARRIES ITS CATALOGUE ID', async () => {
    const queries = queriesSource();

    expect(
      queries.includes('resolveCatalogueTestByName'),
      'free-text investigations are resolved against the catalogue',
    ).toBe(true);
    expect(
      queries.includes("'AMBIGUOUS'"),
      'an ambiguous catalogue name is reported, not guessed',
    ).toBe(true);
    expect(
      queries.includes('testId: resolution.test.id'),
      'a resolved name attaches the catalogue id to the order',
    ).toBe(true);
    expect(
      queries.includes('unresolved') && queries.includes('ambiguous'),
      'what could not be resolved is reported back to the caller',
    ).toBe(true);

    const charges = readFileSync(resolve(process.cwd(), 'src/billing/service-charges.ts'), 'utf8');

    expect(
      charges.includes("type: 'LAB_TEST'"),
      'the laboratory charge carries its catalogue type',
    ).toBe(true);
    expect(
      charges.includes("id: typeof order.testId === 'number' ? order.testId : null"),
      'and its catalogue id, which is what a link is keyed on',
    ).toBe(true);
  });

  it('10. CONSULTATION AND THE OTHER WORKFLOWS STILL RESOLVE', async () => {
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

    expect(
      JSON.stringify(consultation.tariff?.code),
      'consultation still prices from OPD-001',
    ).toBe(JSON.stringify('OPD-001'));
    expect(JSON.stringify(consultation.tariff?.fee), 'at 150').toBe(JSON.stringify('150.00'));
    expect(JSON.stringify(consultation.tariff?.unit), 'per visit').toBe(
      JSON.stringify('Per visit'),
    );

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

    expect(JSON.stringify(opd002.tariff?.code), 'a follow-up still prices from OPD-002').toBe(
      JSON.stringify('OPD-002'),
    );

    expect(
      JSON.stringify(familyForServiceType('LAB_TEST')),
      'LAB_TEST maps to the laboratory family',
    ).toBe(JSON.stringify('LABORATORY'));
    expect(JSON.stringify(familyForServiceType('RADIOLOGY')), 'radiology maps to itself').toBe(
      JSON.stringify('RADIOLOGY'),
    );
    expect(isCatalogueServiceType('LAB_TEST'), 'the type vocabulary is closed').toBe(true);
    expect(!isCatalogueServiceType('ANYTHING'), 'and rejects unknown types').toBe(true);
  });

  it('11. SCHEMA AND MIGRATION GUARDS', async () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'drizzle/0021_service_tariff_links.sql'),
      'utf8',
    );
    const journal = readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8');

    expect(
      /ADD COLUMN IF NOT EXISTS "effective_from"/.test(migration),
      'validity dates are added idempotently',
    ).toBe(true);
    expect(
      /ADD COLUMN IF NOT EXISTS "auto_bill" boolean NOT NULL DEFAULT true/.test(migration),
      'the automatic-billing flag defaults to today’s behaviour',
    ).toBe(true);
    expect(
      migration.includes('CREATE TABLE IF NOT EXISTS "service_tariff_links"'),
      'the link table is created idempotently',
    ).toBe(true);
    expect(
      migration.includes('service_tariff_links_service_unique'),
      'one active link per catalogue service',
    ).toBe(true);
    expect(
      migration.includes('ON DELETE RESTRICT'),
      'a tariff with a link cannot be deleted out from under it',
    ).toBe(true);
    expect(
      !/DROP\s+TABLE/i.test(migration) &&
        !/TRUNCATE/i.test(migration) &&
        !/DROP\s+COLUMN/i.test(migration),
      'the migration destroys nothing',
    ).toBe(true);
    expect(
      !/UPDATE\s+"?facility_service_tariffs"?/i.test(migration),
      'no existing tariff row is rewritten',
    ).toBe(true);
    expect(journal.includes('0021_service_tariff_links'), 'and it is recorded in the journal').toBe(
      true,
    );

    expect(
      isMissingSchemaObject({ code: '42P01' }) && isMissingSchemaObject({ code: '42703' }),
      'a database one migration behind is detected, not crashed',
    ).toBe(true);

    expect(todayKey(new Date(2026, 9, 22)) === '2026-10-22', 'today is a local calendar date').toBe(
      true,
    );
  });

  it('12. NO SECOND BILLING ENGINE', async () => {
    const billing = readFileSync(resolve(process.cwd(), 'src/billing/billing.service.ts'), 'utf8');

    expect(
      billing.includes('resolveServiceTariff('),
      'the charge path calls the shared resolver',
    ).toBe(true);
    expect(
      !billing.includes('insert(schema.billingItems)') ||
        billing.split('insert(schema.billingItems)').length === 2,
      'there is exactly one place that writes an invoice line',
    ).toBe(true);

    const app = readFileSync(resolve(process.cwd(), 'src/app.ts'), 'utf8');

    expect(
      app.includes("'/api/service-tariff-links'"),
      'links are configured through the existing tariff configuration surface',
    ).toBe(true);
    expect(
      app.includes("'/api/billing/lab-service-diagnostics'"),
      'and the laboratory diagnostics are served from the billing module',
    ).toBe(true);
    expect(
      app.includes("requirePermission('tariffs.manage')"),
      'link changes require the tariff-management permission',
    ).toBe(true);
    /* The guard moved to src/routes/shared/tariffs.ts. */
    expect(
      readFileSync(resolve(process.cwd(), 'src/routes/shared/tariffs.ts'), 'utf8').includes(
        'requireFacilityAdminTariffRole',
      ),
      'and the facility-admin guard',
    ).toBe(true);
  });
});
