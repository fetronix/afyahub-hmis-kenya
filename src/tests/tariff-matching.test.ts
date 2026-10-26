/**
 * JaliCare HMIS
 * Tariff matching — the facility's own price list
 *
 * These tests are written around one real complaint:
 *
 *   "General outpatient consultation · OPD-001 · 150 · Per visit" exists
 *   on the facility's price list, and every OPD visit still fails with
 *   "No active tariff matched CONSULT-OUTPATIENT, OUTPATIENT,
 *   OPD-CONSULT (+2 more)".
 *
 * They assert the fix at the level where the money is decided, with no
 * database: given these rows and this visit, which tariff is used, at
 * what fee, in what unit — and when the answer is "none", that no
 * amount was invented.
 *
 * Run with: npx tsx src/tests/tariff-matching.test.ts
 */

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
   THE FACILITY'S OWN PRICE LIST
   ============================================================ */

/** Exactly the rows from the complaint, plus the neighbouring ones. */
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

function testOpdConsultationIsPriced(): void {
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

  assert(outcome.tariff !== null, 'the facility consultation is found');
  assertEqual(outcome.tariff?.code, 'OPD-001', 'it is the existing OPD-001 row');
  assertEqual(outcome.tariff?.fee, '150.00', 'and it keeps its 150 fee');
  assertEqual(outcome.tariff?.unit, 'Per visit', 'billed per visit, not per day');
  assertEqual(outcome.rule, 'CATALOGUE', 'matched on the facility description');
  assertEqual(
    toCents(outcome.tariff?.fee ?? '0'),
    15000,
    'the amount that reaches the invoice is 150.00, in cents',
  );

  console.log('  ✓ A visit is priced from OPD-001 at 150.00 Per visit');
}

function testTheCodesThatWereActuallyTried(): void {
  const codes = codesForFamily({
    family: 'CONSULTATION',
    encounterType: 'OUTPATIENT',
  });

  /*
   * The error message the user saw printed the first three of five. The
   * two behind "(+2 more)" are asserted here, because "we tried
   * everything" is only true if the hidden ones are known.
   */
  assertEqual(
    codes,
    ['CONSULT-OUTPATIENT', 'OUTPATIENT', 'OPD-CONSULT', 'CONSULTATION', 'CONSULT'],
    'all five consultation codes, in the order the engine tries them',
  );

  assertEqual(codes.length, 5, 'five candidates, not three');

  console.log('  ✓ The consultation candidate list is fully enumerated');
}

function testMeaningfulDistinctionsSurvive(): void {
  /*
   * Case, spacing and punctuation are not distinctions. "Follow-up" and
   * "general" are: they are 300 and 150 on this very price list.
   */
  assertEqual(
    words('  General   OUTPATIENT  consultation '),
    ['general', 'outpatient', 'consultation'],
    'case and whitespace collapse',
  );

  assertEqual(words('Follow-up'), words('follow up'), 'hyphens are spacing');

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

  assertEqual(
    caseMatch.tariff?.code,
    ' opd-001 ',
    'a lower-case, space-padded stored code is still matched',
  );
  assertEqual(caseMatch.rule, 'CODE', 'by the code rule');

  assertEqual(
    words('Full Blood Count (FBC/CBC)').slice(0, 3),
    ['full', 'blood', 'count'],
    'brackets do not become words',
  );

  assert(
    !words('Follow-up consultation').includes('general'),
    'a follow-up is not a general consultation',
  );

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

  assertEqual(followUp.tariff?.code, 'OPD-002', 'a follow-up prices from OPD-002');
  assertEqual(followUp.tariff?.fee, '300.00', 'at 300, not the 150 general fee');

  console.log('  ✓ Normalisation ignores formatting, not meaning');
}

function testAmbiguityFailsClosed(): void {
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

  assertEqual(outcome.tariff, null, 'two candidates produce no price at all');
  assert(outcome.ambiguity !== undefined, 'they are reported as an ambiguity');
  assertEqual(
    outcome.ambiguity?.codes,
    ['OPD-001', 'OPD-003'],
    'both codes are named so the facility can choose',
  );

  console.log('  ✓ Two tariffs claim the service → nothing is charged');
}

function testInactiveAndMissing(): void {
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

  assertEqual(outcome.tariff, null, 'a deactivated tariff is not used');

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

  assertEqual(none.tariff, null, 'no consultation tariff → no match');
  assertEqual(toCents('0'), 0, 'and zero is detectable, never billed');

  console.log('  ✓ Inactive and missing tariffs bill nothing');
}

function testFacilityScoping(): void {
  /*
   * The facility's rows are the only input the rule ever sees. The
   * query in `resolveTariffForCharge` filters by `facility_id`, and this
   * asserts the filter is still there — a price from another facility
   * is the one failure mode that would be both silent and wrong.
   */
  const source = readFileSync(resolve(process.cwd(), 'src/billing/billing.service.ts'), 'utf8');

  assert(
    source.includes('eq(schema.facilityServiceTariffs.facilityId, facilityId)'),
    'tariff reads are filtered by facility',
  );

  assert(
    source.includes('eq(schema.facilityServiceTariffs.isActive, true)'),
    'and by the active flag',
  );

  /*
   * Department scoping keeps a pharmacy row from pricing a blood test.
   */
  assertEqual(
    normaliseDepartment('OPD / Outpatient'),
    'opd',
    'the department label and the module id resolve to one bucket',
  );

  assertEqual(
    departmentsForFamily('LABORATORY'),
    ['laboratory'],
    'a laboratory charge is priced from laboratory tariffs only',
  );

  assert(
    !departmentsForFamily('LABORATORY').includes('pharmacy'),
    'a pharmacy row cannot price a test',
  );

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

  assertEqual(outcome.tariff, null, 'a pharmacy row never prices a laboratory test');

  console.log('  ✓ Matching stays inside the facility and the department');
}

function testLaboratoryNames(): void {
  const outcome = matchTariff({
    rows: opdTariffs,
    codes: codesForFamily({ family: 'LABORATORY', name: 'Full Blood Count' }),
    family: 'LABORATORY',
    phrases: phrasesForCharge({
      family: 'LABORATORY',
      serviceName: 'Full Blood Count',
    }),
  });

  assertEqual(
    outcome.tariff?.code,
    'LAB-006',
    'the ordered test "Full Blood Count" prices from LAB-006',
  );
  assertEqual(outcome.tariff?.fee, '800.00', 'at the facility fee of 800');
  assertEqual(outcome.tariff?.unit, 'Test', 'with its billing unit');

  const rdt = matchTariff({
    rows: opdTariffs,
    codes: codesForFamily({ family: 'LABORATORY', name: 'Malaria RDT' }),
    family: 'LABORATORY',
    phrases: phrasesForCharge({ family: 'LABORATORY', serviceName: 'Malaria RDT' }),
  });

  assertEqual(rdt.tariff?.code, 'LAB-001', 'Malaria RDT prices from LAB-001');
  assertEqual(rdt.tariff?.fee, '300.00', 'at 300');

  console.log('  ✓ Named tests find their numbered tariffs');
}

function testLinksStillWin(): void {
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

  assertEqual(outcome.rule, 'LINK', 'an explicit link is used first');
  assertEqual(outcome.tariff?.code, 'OPD-001', 'and points at the same row');
  assert(
    outcome.rule === 'LINK' && outcome.tariff?.fee === '150.00',
    'the link does not change the amount',
  );

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

  assertEqual(stale.tariff, null, 'a link on a deactivated tariff does not price a visit');

  console.log('  ✓ A link beats a guess, and a dead link does not fire');
}

function testDuplicateBillingPrevention(): void {
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

  assertEqual(
    buildIdempotencyKey(replay),
    'CONSULTATION:99',
    'the replay carries the same idempotency key as the original charge',
  );

  assertEqual(
    buildIdempotencyKey({ sourceType: 'CONSULTATION', sourceId: 99 }),
    buildIdempotencyKey(replay),
    'so a second bill for the same visit is rejected as a duplicate',
  );

  console.log('  ✓ A retry cannot create a second invoice line');
}

function testRetryAfterFixingThePriceList(): void {
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

  assertEqual(before.tariff, null, 'nothing is billed before the tariff exists');

  const after = matchTariff({
    rows: opdTariffs,
    codes: codesForFamily({ family: 'CONSULTATION', encounterType: 'OUTPATIENT' }),
    family: 'CONSULTATION',
    phrases: phrasesForCharge({
      family: 'CONSULTATION',
      encounterType: 'OUTPATIENT',
    }),
  });

  assertEqual(after.tariff?.code, 'OPD-001', 'the retry finds the new price');
  assertEqual(after.tariff?.fee, '150.00', 'at the facility fee');

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

  assert(app.includes("'/api/billing/charge-attempts/:id/retry'"), 'a route retries one charge');
  assert(
    app.includes("'/api/billing/charge-attempts/retry'"),
    'a route retries everything waiting',
  );
  assert(
    app.includes('chargeAttempts.chargeAndRecord(db, request)'),
    'every charge site records what it could not price',
  );
  assert(
    app.includes("'/api/billing/tariff-match'"),
    'the screen can ask why a service was not priced',
  );
  assert(
    migration.includes('CREATE TABLE IF NOT EXISTS "billing_charge_attempts"'),
    'migration 0020 creates the queue',
  );
  assert(
    migration.includes('billing_charge_attempts_pending_unique'),
    'one open attempt per clinical source',
  );
  assert(
    !/DROP\s+TABLE/i.test(migration) && !/TRUNCATE/i.test(migration),
    'the migration destroys nothing',
  );
  assert(journal.includes('0020_billing_charge_attempts'), 'and is recorded in the journal');
  assert(
    panel.includes('Charges that could not be priced'),
    'the queue is visible on the tariff screen',
  );
  assert(panel.includes('Retry all'), 'with a retry action');

  const queue = readFileSync(resolve(process.cwd(), 'src/billing/charge-attempts.ts'), 'utf8');

  assert(
    queue.includes("result.reason !== 'TARIFF_NOT_CONFIGURED'"),
    'only an unpriceable charge is queued — a duplicate is not money owed',
  );
  assert(
    queue.includes("status: 'BILLED'") &&
      queue.includes("'DUPLICATE'") &&
      queue.includes("'PENDING'"),
    'a retry records which of billed, duplicate or still-waiting happened',
  );
  assert(
    queue.includes('isMissingAttemptsTable'),
    'a database without migration 0020 degrades instead of failing the visit',
  );
  assert(
    queue.includes('toChargeRequest(row, input.tenantId)'),
    'the retry replays the stored request, not a rebuilt guess',
  );

  console.log('  ✓ A failed charge is kept and bills after the price list is fixed');
}

function testEveryFamilyHasACodePath(): void {
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

    assert(codes.length > 0, `${family} has at least one code path`);
    assert(
      codes.every((code) => code.trim() !== ''),
      `${family} codes are never empty strings`,
    );
    assertEqual(new Set(codes).size, codes.length, `${family} does not repeat a code`);
  }

  assertEqual(
    codesForFamily({ family: 'BED_DAY', wardCode: 'ICU' }).slice(0, 2),
    ['BED-ICU', 'WARD-ICU'],
    'a bed-night tries the ward price first',
  );

  assertEqual(
    codesForFamily({ family: 'BED_DAY', wardCode: 'ICU' }),
    bedDayTariffCodes('ICU'),
    'the family list and the bed-day engine agree',
  );

  assertEqual(
    codesForFamily({ family: 'BED_DAY' }),
    bedDayTariffCodes(),
    'including when there is no ward code',
  );

  assert(
    codesForFamily({ family: 'PHARMACY' }).includes('PHARMACY'),
    'a pharmacy charge has a generic fallback',
  );

  console.log('  ✓ Every billing family has a working code path');
}

function testConsultationPhrases(): void {
  const outpatient = consultationPhrases('OUTPATIENT');

  assertEqual(
    outpatient[0],
    'general outpatient consultation',
    'the most specific phrase is tried first',
  );

  assert(
    !outpatient.includes('follow-up consultation'),
    'and a general visit never asks for the follow-up price',
  );

  assertEqual(
    consultationPhrases('FOLLOW_UP')[0],
    'follow-up consultation',
    'a follow-up asks for the follow-up price',
  );

  assertEqual(
    consultationPhrases('follow-up')[0],
    consultationPhrases('FOLLOW_UP')[0],
    'the spelling of the encounter type does not matter',
  );

  assertEqual(
    serviceWords('General outp. consultation'),
    ['general', 'outp', 'consultation'],
    'filler words are dropped, content words are not',
  );

  console.log('  ✓ Visit type selects the right description, not the nearest one');
}

function testExplanationNamesTheRows(): void {
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

  assertEqual(
    matched?.verdict,
    'MATCHED_DESCRIPTION',
    'OPD-001 is reported as the row that matched',
  );
  assertEqual(retired?.verdict, 'INACTIVE', 'the retired row is reported inactive');
  assertEqual(followUp?.verdict, 'NO_MATCH', 'the follow-up row is reported as not this service');

  console.log('  ✓ The screen can name the facility’s own rows');
}

/* ============================================================
   RUNNER
   ============================================================ */

function run(): void {
  console.log('');
  console.log('==============================================');
  console.log('TARIFF MATCHING TESTS');
  console.log('==============================================');
  console.log('');

  testOpdConsultationIsPriced();
  testTheCodesThatWereActuallyTried();
  testMeaningfulDistinctionsSurvive();
  testAmbiguityFailsClosed();
  testInactiveAndMissing();
  testFacilityScoping();
  testLaboratoryNames();
  testLinksStillWin();
  testDuplicateBillingPrevention();
  testRetryAfterFixingThePriceList();
  testEveryFamilyHasACodePath();
  testConsultationPhrases();
  testExplanationNamesTheRows();

  console.log('');
  console.log('==============================================');
  console.log(`TARIFF MATCHING TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('TARIFF MATCHING TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
