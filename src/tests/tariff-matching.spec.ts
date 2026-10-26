import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bedDayTariffCodes, buildIdempotencyKey, toCents } from '../billing/billing.service.ts';
import { toChargeRequest } from '../billing/charge-attempts.ts';
import {
  codesForFamily,
  consultationPhrases,
  departmentsForFamily,
  explainMatch,
  matchTariff,
  normaliseDepartment,
  phrasesForCharge,
  serviceWords,
  words,
} from '../billing/tariff-matching.ts';

import { describe, expect, it } from 'vitest';

const opdTariffs = [
  {
    id: 1,
    code: 'REG-001',
    description: 'Patient registration',
    fee: '100.00',
    unit: 'Per visit',
    department: 'registration',
    billingKey: null,
    isActive: true,
  },
  {
    id: 2,
    code: 'OPD-001',
    description: 'General outpatient consultation',
    fee: '150.00',
    unit: 'Per visit',
    department: 'opd',
    billingKey: null,
    isActive: true,
  },
  {
    id: 3,
    code: 'OPD-002',
    description: 'Follow-up consultation',
    fee: '300.00',
    unit: 'Per visit',
    department: 'opd',
    billingKey: null,
    isActive: true,
  },
  {
    id: 4,
    code: 'LAB-001',
    description: 'Malaria RDT',
    fee: '300.00',
    unit: 'Test',
    department: 'laboratory',
    billingKey: null,
    isActive: true,
  },
  {
    id: 5,
    code: 'LAB-006',
    description: 'Full Blood Count (FBC/CBC)',
    fee: '800.00',
    unit: 'Test',
    department: 'laboratory',
    billingKey: null,
    isActive: true,
  },
];

describe("Tariff matching — the facility's own price list", () => {
  it('Opd Consultation Is Priced', async () => {
    const outcome = matchTariff({
      rows: opdTariffs,
      codes: codesForFamily({ family: 'CONSULTATION', encounterType: 'OUTPATIENT' }),
      serviceKeys: ['CONSULTATION'],
      family: 'CONSULTATION',
      phrases: phrasesForCharge({
        family: 'CONSULTATION',
        encounterType: 'OUTPATIENT',
      }),
    });

    expect(outcome.tariff !== null, 'the facility consultation is found').toBe(true);
    expect(JSON.stringify(outcome.tariff?.code), 'it is the existing OPD-001 row').toBe(
      JSON.stringify('OPD-001'),
    );
    expect(JSON.stringify(outcome.tariff?.fee), 'and it keeps its 150 fee').toBe(
      JSON.stringify('150.00'),
    );
    expect(JSON.stringify(outcome.tariff?.unit), 'billed per visit, not per day').toBe(
      JSON.stringify('Per visit'),
    );
    expect(JSON.stringify(outcome.rule), 'matched on the facility description').toBe(
      JSON.stringify('CATALOGUE'),
    );
    expect(
      JSON.stringify(toCents(outcome.tariff?.fee ?? '0')),
      'the amount that reaches the invoice is 150.00, in cents',
    ).toBe(JSON.stringify(15000));
  });

  it('The Codes That Were Actually Tried', async () => {
    const codes = codesForFamily({
      family: 'CONSULTATION',
      encounterType: 'OUTPATIENT',
    });

    /*
     * The error message the user saw printed the first three of five. The
     * two behind "(+2 more)" are asserted here, because "we tried
     * everything" is only true if the hidden ones are known.
     */
    expect(
      JSON.stringify(codes),
      'all five consultation codes, in the order the engine tries them',
    ).toBe(
      JSON.stringify([
        'CONSULT-OUTPATIENT',
        'OUTPATIENT',
        'OPD-CONSULT',
        'CONSULTATION',
        'CONSULT',
      ]),
    );

    expect(JSON.stringify(codes.length), 'five candidates, not three').toBe(JSON.stringify(5));
  });

  it('Meaningful Distinctions Survive', async () => {
    /*
     * Case, spacing and punctuation are not distinctions. "Follow-up" and
     * "general" are: they are 300 and 150 on this very price list.
     */
    expect(
      JSON.stringify(words('  General   OUTPATIENT  consultation ')),
      'case and whitespace collapse',
    ).toBe(JSON.stringify(['general', 'outpatient', 'consultation']));

    expect(JSON.stringify(words('Follow-up')), 'hyphens are spacing').toBe(
      JSON.stringify(words('follow up')),
    );

    /*
     * A code stored by a script or an import in lower case must still be
     * found by the candidate the engine writes in capitals. This used to
     * be an `upper()` in the SQL; it is now one comparison rule, tested
     * here rather than assumed to survive a refactor.
     */
    const storedLower = [
      {
        id: 1,
        code: ' opd-001 ',
        description: 'anything',
        fee: '150.00',
        unit: 'Per visit',
        department: 'opd',
        billingKey: null,
        isActive: true,
      },
    ];

    const caseMatch = matchTariff({
      rows: storedLower,
      codes: ['OPD-001'],
    });

    expect(
      JSON.stringify(caseMatch.tariff?.code),
      'a lower-case, space-padded stored code is still matched',
    ).toBe(JSON.stringify(' opd-001 '));
    expect(JSON.stringify(caseMatch.rule), 'by the code rule').toBe(JSON.stringify('CODE'));

    expect(
      JSON.stringify(words('Full Blood Count (FBC/CBC)').slice(0, 3)),
      'brackets do not become words',
    ).toBe(JSON.stringify(['full', 'blood', 'count']));

    expect(
      !words('Follow-up consultation').includes('general'),
      'a follow-up is not a general consultation',
    ).toBe(true);

    const followUp = matchTariff({
      rows: opdTariffs,
      codes: codesForFamily({ family: 'CONSULTATION', encounterType: 'FOLLOW_UP' }),
      serviceKeys: ['CONSULTATION'],
      family: 'CONSULTATION',
      phrases: phrasesForCharge({
        family: 'CONSULTATION',
        encounterType: 'FOLLOW_UP',
      }),
    });

    expect(JSON.stringify(followUp.tariff?.code), 'a follow-up prices from OPD-002').toBe(
      JSON.stringify('OPD-002'),
    );
    expect(JSON.stringify(followUp.tariff?.fee), 'at 300, not the 150 general fee').toBe(
      JSON.stringify('300.00'),
    );
  });

  it('Ambiguity Fails Closed', async () => {
    const duplicated = [
      ...opdTariffs,
      {
        id: 9,
        code: 'OPD-003',
        description: 'General Outpatient Consultation (repeat)',
        fee: '250.00',
        unit: 'Per visit',
        department: 'opd',
        billingKey: null,
        isActive: true,
      },
    ];

    const outcome = matchTariff({
      rows: duplicated,
      codes: codesForFamily({ family: 'CONSULTATION', encounterType: 'OUTPATIENT' }),
      family: 'CONSULTATION',
      phrases: phrasesForCharge({
        family: 'CONSULTATION',
        encounterType: 'OUTPATIENT',
      }),
    });

    expect(JSON.stringify(outcome.tariff), 'two candidates produce no price at all').toBe(
      JSON.stringify(null),
    );
    expect(outcome.ambiguity !== undefined, 'they are reported as an ambiguity').toBe(true);
    expect(
      JSON.stringify(outcome.ambiguity?.codes),
      'both codes are named so the facility can choose',
    ).toBe(JSON.stringify(['OPD-001', 'OPD-003']));
  });

  it('Inactive And Missing', async () => {
    const inactive = opdTariffs.map((row) =>
      row.code === 'OPD-001' ? { ...row, isActive: false } : row,
    );

    const outcome = matchTariff({
      rows: inactive,
      codes: codesForFamily({ family: 'CONSULTATION', encounterType: 'OUTPATIENT' }),
      family: 'CONSULTATION',
      phrases: phrasesForCharge({
        family: 'CONSULTATION',
        encounterType: 'OUTPATIENT',
      }),
    });

    expect(JSON.stringify(outcome.tariff), 'a deactivated tariff is not used').toBe(
      JSON.stringify(null),
    );

    const missing = opdTariffs.filter((row) => !row.code.startsWith('OPD'));
    const none = matchTariff({
      rows: missing,
      codes: codesForFamily({ family: 'CONSULTATION', encounterType: 'OUTPATIENT' }),
      family: 'CONSULTATION',
      phrases: phrasesForCharge({
        family: 'CONSULTATION',
        encounterType: 'OUTPATIENT',
      }),
    });

    expect(JSON.stringify(none.tariff), 'no consultation tariff → no match').toBe(
      JSON.stringify(null),
    );
    expect(JSON.stringify(toCents('0')), 'and zero is detectable, never billed').toBe(
      JSON.stringify(0),
    );
  });

  it('Facility Scoping', async () => {
    /*
     * The facility's rows are the only input the rule ever sees. The
     * query in `resolveTariffForCharge` filters by `facility_id`, and this
     * asserts the filter is still there — a price from another facility
     * is the one failure mode that would be both silent and wrong.
     */
    const source = readFileSync(resolve(process.cwd(), 'src/billing/billing.service.ts'), 'utf8');

    expect(
      source.includes('eq(schema.facilityServiceTariffs.facilityId, facilityId)'),
      'tariff reads are filtered by facility',
    ).toBe(true);

    expect(
      source.includes('eq(schema.facilityServiceTariffs.isActive, true)'),
      'and by the active flag',
    ).toBe(true);

    /*
     * Department scoping keeps a pharmacy row from pricing a blood test.
     */
    expect(
      JSON.stringify(normaliseDepartment('OPD / Outpatient')),
      'the department label and the module id resolve to one bucket',
    ).toBe(JSON.stringify('opd'));

    expect(
      JSON.stringify(departmentsForFamily('LABORATORY')),
      'a laboratory charge is priced from laboratory tariffs only',
    ).toBe(JSON.stringify(['laboratory']));

    expect(
      !departmentsForFamily('LABORATORY').includes('pharmacy'),
      'a pharmacy row cannot price a test',
    ).toBe(true);

    const misfiled = [
      {
        id: 1,
        code: 'PHA-001',
        description: 'Full Blood Count (FBC/CBC)',
        fee: '500.00',
        unit: 'Test',
        department: 'pharmacy',
        billingKey: null,
        isActive: true,
      },
    ];

    const outcome = matchTariff({
      rows: misfiled,
      codes: codesForFamily({ family: 'LABORATORY', name: 'Full Blood Count' }),
      family: 'LABORATORY',
      phrases: phrasesForCharge({
        family: 'LABORATORY',
        serviceName: 'Full Blood Count',
      }),
    });

    expect(JSON.stringify(outcome.tariff), 'a pharmacy row never prices a laboratory test').toBe(
      JSON.stringify(null),
    );
  });

  it('Laboratory Names', async () => {
    const outcome = matchTariff({
      rows: opdTariffs,
      codes: codesForFamily({ family: 'LABORATORY', name: 'Full Blood Count' }),
      family: 'LABORATORY',
      phrases: phrasesForCharge({
        family: 'LABORATORY',
        serviceName: 'Full Blood Count',
      }),
    });

    expect(
      JSON.stringify(outcome.tariff?.code),
      'the ordered test "Full Blood Count" prices from LAB-006',
    ).toBe(JSON.stringify('LAB-006'));
    expect(JSON.stringify(outcome.tariff?.fee), 'at the facility fee of 800').toBe(
      JSON.stringify('800.00'),
    );
    expect(JSON.stringify(outcome.tariff?.unit), 'with its billing unit').toBe(
      JSON.stringify('Test'),
    );

    const rdt = matchTariff({
      rows: opdTariffs,
      codes: codesForFamily({ family: 'LABORATORY', name: 'Malaria RDT' }),
      family: 'LABORATORY',
      phrases: phrasesForCharge({ family: 'LABORATORY', serviceName: 'Malaria RDT' }),
    });

    expect(JSON.stringify(rdt.tariff?.code), 'Malaria RDT prices from LAB-001').toBe(
      JSON.stringify('LAB-001'),
    );
    expect(JSON.stringify(rdt.tariff?.fee), 'at 300').toBe(JSON.stringify('300.00'));
  });

  it('Links Still Win', async () => {
    const linked = opdTariffs.map((row) =>
      row.code === 'OPD-001' ? { ...row, billingKey: ' CONSULTATION ' } : row,
    );

    const outcome = matchTariff({
      rows: linked,
      codes: codesForFamily({ family: 'CONSULTATION', encounterType: 'OUTPATIENT' }),
      serviceKeys: ['CONSULTATION'],
      family: 'CONSULTATION',
      phrases: phrasesForCharge({
        family: 'CONSULTATION',
        encounterType: 'OUTPATIENT',
      }),
    });

    expect(JSON.stringify(outcome.rule), 'an explicit link is used first').toBe(
      JSON.stringify('LINK'),
    );
    expect(JSON.stringify(outcome.tariff?.code), 'and points at the same row').toBe(
      JSON.stringify('OPD-001'),
    );
    expect(
      outcome.rule === 'LINK' && outcome.tariff?.fee === '150.00',
      'the link does not change the amount',
    ).toBe(true);

    /*
     * A stale link to a deactivated row must not fire.
     */
    const staleLink = linked.map((row) =>
      row.code === 'OPD-001' ? { ...row, isActive: false } : row,
    );

    const stale = matchTariff({
      rows: staleLink,
      codes: codesForFamily({ family: 'CONSULTATION', encounterType: 'OUTPATIENT' }),
      serviceKeys: ['CONSULTATION'],
      family: 'CONSULTATION',
      phrases: phrasesForCharge({
        family: 'CONSULTATION',
        encounterType: 'OUTPATIENT',
      }),
    });

    expect(
      JSON.stringify(stale.tariff),
      'a link on a deactivated tariff does not price a visit',
    ).toBe(JSON.stringify(null));
  });

  it('Duplicate Billing Prevention', async () => {
    /*
     * A retry replays the original request. The idempotency key is
     * derived from the clinical source, not from the attempt, so the
     * replay collides with the first line instead of adding a second one.
     */
    const attemptRow = {
      id: 7,
      patientId: 42,
      facilityId: 3,
      encounterId: 99,
      sourceType: 'CONSULTATION',
      sourceId: 99,
      itemType: 'Consultation',
      description: 'Clinical consultation',
      codes: ['CONSULT-OUTPATIENT', 'OUTPATIENT', 'OPD-CONSULT', 'CONSULTATION', 'CONSULT'],
      serviceKeys: ['CONSULTATION'],
      family: 'CONSULTATION',
      serviceName: null,
      encounterType: 'OUTPATIENT',
      aliases: [],
      quantity: 1,
      fallbackUnitPrice: null,
      reason: 'TARIFF_NOT_CONFIGURED',
      detail: 'no tariff',
      codesTried: [],
      status: 'PENDING',
      attempts: 1,
      lastAttemptAt: new Date(),
      resolvedItemId: null,
      resolvedInvoiceId: null,
      resolvedTariffCode: null,
      resolvedUnitPrice: null,
      resolvedAt: null,
      createdAt: new Date(),
    } as unknown as Parameters<typeof toChargeRequest>[0];

    const replay = toChargeRequest(attemptRow, 1);

    expect(
      JSON.stringify(buildIdempotencyKey(replay)),
      'the replay carries the same idempotency key as the original charge',
    ).toBe(JSON.stringify('CONSULTATION:99'));

    expect(
      JSON.stringify(buildIdempotencyKey({ sourceType: 'CONSULTATION', sourceId: 99 })),
      'so a second bill for the same visit is rejected as a duplicate',
    ).toBe(JSON.stringify(buildIdempotencyKey(replay)));
  });

  it('Retry After Fixing The Price List', async () => {
    /*
     * The sequence the operator performs: the visit is recorded and not
     * billed, the tariff is added, the charge is retried.
     */
    const before = matchTariff({
      rows: opdTariffs.filter((row) => !row.code.startsWith('OPD')),
      codes: codesForFamily({ family: 'CONSULTATION', encounterType: 'OUTPATIENT' }),
      family: 'CONSULTATION',
      phrases: phrasesForCharge({
        family: 'CONSULTATION',
        encounterType: 'OUTPATIENT',
      }),
    });

    expect(JSON.stringify(before.tariff), 'nothing is billed before the tariff exists').toBe(
      JSON.stringify(null),
    );

    const after = matchTariff({
      rows: opdTariffs,
      codes: codesForFamily({ family: 'CONSULTATION', encounterType: 'OUTPATIENT' }),
      family: 'CONSULTATION',
      phrases: phrasesForCharge({
        family: 'CONSULTATION',
        encounterType: 'OUTPATIENT',
      }),
    });

    expect(JSON.stringify(after.tariff?.code), 'the retry finds the new price').toBe(
      JSON.stringify('OPD-001'),
    );
    expect(JSON.stringify(after.tariff?.fee), 'at the facility fee').toBe(JSON.stringify('150.00'));

    /*
     * ...and it is recorded. Requirement: a failed attempt is kept and is
     * retryable, which needs the table, the route and the button to exist.
     */
    const app = readFileSync(resolve(process.cwd(), 'src/app.ts'), 'utf8');
    const migration = readFileSync(
      resolve(process.cwd(), 'drizzle/0020_billing_charge_attempts.sql'),
      'utf8',
    );
    const journal = readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8');
    const panel = readFileSync(
      resolve(process.cwd(), 'src/components/modules/FacilityServiceTariffsPanel.tsx'),
      'utf8',
    );

    expect(
      app.includes("'/api/billing/charge-attempts/:id/retry'"),
      'a route retries one charge',
    ).toBe(true);
    expect(
      app.includes("'/api/billing/charge-attempts/retry'"),
      'a route retries everything waiting',
    ).toBe(true);
    /*
     * The wrapper moved to its own module when the maternity routes were
     * extracted; the assertion follows it. `chargeSafely` is the one place a
     * charge is attempted, so this still pins "every charge site records what
     * it could not price".
     */
    const charges = readFileSync(resolve(process.cwd(), 'src/routes/shared/charges.ts'), 'utf8');

    expect(
      charges.includes('chargeAttempts.chargeAndRecord(db, request)'),
      'every charge site records what it could not price',
    ).toBe(true);
    expect(
      app.includes("'/api/billing/tariff-match'"),
      'the screen can ask why a service was not priced',
    ).toBe(true);
    expect(
      migration.includes('CREATE TABLE IF NOT EXISTS "billing_charge_attempts"'),
      'migration 0020 creates the queue',
    ).toBe(true);
    expect(
      migration.includes('billing_charge_attempts_pending_unique'),
      'one open attempt per clinical source',
    ).toBe(true);
    expect(
      !/DROP\s+TABLE/i.test(migration) && !/TRUNCATE/i.test(migration),
      'the migration destroys nothing',
    ).toBe(true);
    expect(journal.includes('0020_billing_charge_attempts'), 'and is recorded in the journal').toBe(
      true,
    );
    expect(
      panel.includes('Charges that could not be priced'),
      'the queue is visible on the tariff screen',
    ).toBe(true);
    expect(panel.includes('Retry all'), 'with a retry action').toBe(true);

    const queue = readFileSync(resolve(process.cwd(), 'src/billing/charge-attempts.ts'), 'utf8');

    expect(
      queue.includes("result.reason !== 'TARIFF_NOT_CONFIGURED'"),
      'only an unpriceable charge is queued — a duplicate is not money owed',
    ).toBe(true);
    expect(
      queue.includes("status: 'BILLED'") &&
        queue.includes("'DUPLICATE'") &&
        queue.includes("'PENDING'"),
      'a retry records which of billed, duplicate or still-waiting happened',
    ).toBe(true);
    expect(
      queue.includes('isMissingAttemptsTable'),
      'a database without migration 0020 degrades instead of failing the visit',
    ).toBe(true);
    expect(
      queue.includes('toChargeRequest(row, input.tenantId)'),
      'the retry replays the stored request, not a rebuilt guess',
    ).toBe(true);
  });

  it('Every Family Has ACode Path', async () => {
    /*
     * Every service on the facility's list needs a way to be priced:
     * either a code the engine tries, or a link the facility can set.
     */
    const families = [
      'CONSULTATION',
      'LABORATORY',
      'RADIOLOGY',
      'PROCEDURE',
      'ADMISSION',
      'BED_DAY',
      'DELIVERY',
      'PHARMACY',
    ] as const;

    for (const family of families) {
      const codes = codesForFamily({ family });

      expect(codes.length > 0, `${family} has at least one code path`).toBe(true);
      expect(
        codes.every((code) => code.trim() !== ''),
        `${family} codes are never empty strings`,
      ).toBe(true);
      expect(JSON.stringify(new Set(codes).size), `${family} does not repeat a code`).toBe(
        JSON.stringify(codes.length),
      );
    }

    expect(
      JSON.stringify(codesForFamily({ family: 'BED_DAY', wardCode: 'ICU' }).slice(0, 2)),
      'a bed-night tries the ward price first',
    ).toBe(JSON.stringify(['BED-ICU', 'WARD-ICU']));

    expect(
      JSON.stringify(codesForFamily({ family: 'BED_DAY', wardCode: 'ICU' })),
      'the family list and the bed-day engine agree',
    ).toBe(JSON.stringify(bedDayTariffCodes('ICU')));

    expect(
      JSON.stringify(codesForFamily({ family: 'BED_DAY' })),
      'including when there is no ward code',
    ).toBe(JSON.stringify(bedDayTariffCodes()));

    expect(
      codesForFamily({ family: 'PHARMACY' }).includes('PHARMACY'),
      'a pharmacy charge has a generic fallback',
    ).toBe(true);
  });

  it('Consultation Phrases', async () => {
    const outpatient = consultationPhrases('OUTPATIENT');

    expect(JSON.stringify(outpatient[0]), 'the most specific phrase is tried first').toBe(
      JSON.stringify('general outpatient consultation'),
    );

    expect(
      !outpatient.includes('follow-up consultation'),
      'and a general visit never asks for the follow-up price',
    ).toBe(true);

    expect(
      JSON.stringify(consultationPhrases('FOLLOW_UP')[0]),
      'a follow-up asks for the follow-up price',
    ).toBe(JSON.stringify('follow-up consultation'));

    expect(
      JSON.stringify(consultationPhrases('follow-up')[0]),
      'the spelling of the encounter type does not matter',
    ).toBe(JSON.stringify(consultationPhrases('FOLLOW_UP')[0]));

    expect(
      JSON.stringify(serviceWords('General outp. consultation')),
      'filler words are dropped, content words are not',
    ).toBe(JSON.stringify(['general', 'outp', 'consultation']));
  });

  it('Explanation Names The Rows', async () => {
    const explanation = explainMatch({
      rows: [
        ...opdTariffs,
        {
          id: 10,
          code: 'OPD-009',
          description: 'Retired consultation price',
          fee: '90.00',
          unit: 'Per visit',
          department: 'opd',
          billingKey: null,
          isActive: false,
        },
      ],
      codes: codesForFamily({ family: 'CONSULTATION', encounterType: 'OUTPATIENT' }),
      serviceKeys: ['CONSULTATION'],
      family: 'CONSULTATION',
      phrases: phrasesForCharge({
        family: 'CONSULTATION',
        encounterType: 'OUTPATIENT',
      }),
    });

    const matched = explanation.rows.find((row) => row.tariff.code === 'OPD-001');
    const retired = explanation.rows.find((row) => row.tariff.code === 'OPD-009');
    const followUp = explanation.rows.find((row) => row.tariff.code === 'OPD-002');

    expect(JSON.stringify(matched?.verdict), 'OPD-001 is reported as the row that matched').toBe(
      JSON.stringify('MATCHED_DESCRIPTION'),
    );
    expect(JSON.stringify(retired?.verdict), 'the retired row is reported inactive').toBe(
      JSON.stringify('INACTIVE'),
    );
    expect(
      JSON.stringify(followUp?.verdict),
      'the follow-up row is reported as not this service',
    ).toBe(JSON.stringify('NO_MATCH'));
  });
});
