/**
 * JaliCare HMIS
 * Billing engine — pure-logic tests
 *
 * These cover the failure modes that quietly corrupt a bill:
 * floating-point money drift, duplicate charges on replay, and
 * off-by-one bed-night counts. No database required.
 *
 * Run with: npx tsx src/tests/billing-engine.test.ts
 */

import {
  bedDayDates,
  bedDayTariffCodes,
  buildIdempotencyKey,
  fromCents,
  pickTariffForCodes,
  toCents,
} from '../billing/billing.service.ts';
import {
  labTariffCodeCandidates,
  normaliseTariffCode,
  procedureTariffCodeCandidates,
} from '../billing/tariff-codes.ts';

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(
    actual === expected,
    `${label} — expected ${String(expected)}, got ${String(actual)}`,
  );
}

/* ============================================================
   1. MONEY
   ============================================================ */

function testMoney(): void {
  assertEqual(toCents('1500.00'), 150000, 'KES 1500.00 is 150000 cents');
  assertEqual(toCents('0.01'), 1, 'one cent');
  assertEqual(toCents(250.5), 25050, 'numeric input');
  assertEqual(toCents(null), 0, 'null is zero');
  assertEqual(toCents(''), 0, 'empty string is zero');
  assertEqual(toCents('not-a-number'), 0, 'garbage is zero, not NaN');

  /*
   * The classic float bug: 0.1 + 0.2 !== 0.3.
   * Cents arithmetic must survive it.
   */
  const sum = toCents('0.10') + toCents('0.20');
  assertEqual(fromCents(sum), '0.30', '0.10 + 0.20 is exactly 0.30');

  // 19.99 * 3 would be 59.97000000000001 in floats.
  assertEqual(
    fromCents(toCents('19.99') * 3),
    '59.97',
    '19.99 × 3 is exactly 59.97',
  );

  assertEqual(fromCents(0), '0.00', 'zero formats with two decimals');
  assertEqual(fromCents(5), '0.05', 'single-cent formatting');
  assertEqual(fromCents(100000), '1000.00', 'thousands');

  console.log('  ✓ Money arithmetic passed');
}

/* ============================================================
   2. IDEMPOTENCY
   ============================================================ */

function testIdempotency(): void {
  const lab = buildIdempotencyKey({
    sourceType: 'LAB_ORDER',
    sourceId: 42,
  });

  assertEqual(lab, 'LAB_ORDER:42', 'lab order key');

  // Same event twice must produce the same key, or it double-bills.
  assertEqual(
    buildIdempotencyKey({ sourceType: 'LAB_ORDER', sourceId: 42 }),
    lab,
    'replaying the same event yields an identical key',
  );

  // Different events must never collide.
  assert(
    buildIdempotencyKey({ sourceType: 'LAB_ORDER', sourceId: 43 }) !== lab,
    'a different order id produces a different key',
  );

  assert(
    buildIdempotencyKey({ sourceType: 'PROCEDURE', sourceId: 42 }) !== lab,
    'a different source type produces a different key',
  );

  const night = buildIdempotencyKey({
    sourceType: 'BED_DAY',
    sourceId: 7,
    idempotencySuffix: '2026-10-21',
  });

  assertEqual(night, 'BED_DAY:7:2026-10-21', 'bed-night key includes the date');

  assert(
    night !==
      buildIdempotencyKey({
        sourceType: 'BED_DAY',
        sourceId: 7,
        idempotencySuffix: '2026-10-22',
      }),
    'consecutive nights are billed separately',
  );

  console.log('  ✓ Idempotency keys passed');
}

/* ============================================================
   3. BED-DAY COUNTING
   ============================================================ */

function testBedDays(): void {
  // Same-day admission and discharge still occupies one night.
  assertEqual(
    bedDayDates('2026-10-21 08:00', '2026-10-21 18:00').length,
    1,
    'a same-day stay bills one night',
  );

  // 21st to 23rd inclusive = 3 nights.
  const stay = bedDayDates('2026-10-21 09:00', '2026-10-23 11:00');

  assertEqual(stay.length, 3, 'a 3-day stay bills 3 nights');
  assertEqual(stay[0], '2026-10-21', 'first night is the admission date');
  assertEqual(stay[2], '2026-10-23', 'last night is the discharge date');

  // Date-only formats must parse.
  assertEqual(
    bedDayDates('2026-10-21', '2026-10-22').length,
    2,
    'date-only strings bill two nights',
  );

  // Slash-separated dates from older imports.
  assert(
    bedDayDates('2026/10/21', '2026/10/22').length >= 1,
    'slash-separated dates parse instead of throwing',
  );

  // Garbage must not throw or loop forever.
  assertEqual(
    bedDayDates('', '2026-10-22').length,
    0,
    'an unparseable admission date yields no charges',
  );

  // A missing discharge date accrues up to today, never an infinite loop.
  const open = bedDayDates('2026-10-21', null);
  assert(open.length >= 1 && open.length <= 400, 'open stay is bounded');

  console.log('  ✓ Bed-day counting passed');
}

/* ============================================================
   4. TARIFF CODE PRECEDENCE
   ============================================================ */

function testTariffCodes(): void {
  const icu = bedDayTariffCodes('ICU');

  assertEqual(icu[0], 'BED-ICU', 'ward-specific code is tried first');
  assertEqual(icu[1], 'WARD-ICU', 'second candidate is the WARD- prefix');
  assert(icu.includes('BED-DAY'), 'generic day rate is a fallback');
  assert(
    icu.indexOf('BED-DAY') > icu.indexOf('BED-ICU'),
    'generic fallback ranks below the ward-specific rate',
  );

  const generic = bedDayTariffCodes(null);
  assertEqual(generic[0], 'BED-DAY', 'no ward falls straight to BED-DAY');

  // Punctuation and case must not produce a code nobody can type.
  assertEqual(
    bedDayTariffCodes('icu unit-2')[0],
    'BED-ICU-UNIT-2',
    'ward codes are normalised',
  );

  console.log('  ✓ Tariff code precedence passed');
}

/* ============================================================
   5. TARIFF MATCHING
   ============================================================ */

function testTariffMatching(): void {
  const row = (code: string, fee = '500.00') => ({
    id: 1,
    code,
    description: code,
    fee,
    unit: 'Service',
  });

  const consultation = ['OPD-CONSULT', 'CONSULTATION', 'CONSULT'];

  assertEqual(
    pickTariffForCodes([row('CONSULT')], consultation)?.code,
    'CONSULT',
    'a generic consultation tariff prices a visit',
  );

  /*
   * Priority order is the caller's, not the database's. If both exist,
   * the more specific code wins however the rows come back.
   */
  assertEqual(
    pickTariffForCodes(
      [row('CONSULT'), row('OPD-CONSULT')],
      consultation,
    )?.code,
    'OPD-CONSULT',
    'OPD-CONSULT beats CONSULT regardless of row order',
  );

  /*
   * The silent-billing bug: a code saved in lower case used to match
   * nothing, so the visit started and no invoice line appeared.
   */
  assertEqual(
    pickTariffForCodes([row('opd-consult')], consultation)?.code,
    'opd-consult',
    'case does not hide a configured tariff',
  );

  assertEqual(
    pickTariffForCodes([row(' Consultation ')], consultation)?.code,
    ' Consultation ',
    'a padded code still matches after trimming',
  );

  /*
   * An exact-case row is preferred within one priority, so a duplicate
   * created before the write side uppercased does not shadow the row the
   * configuration screen wrote.
   */
  const exact = pickTariffForCodes(
    [row('consult'), row('CONSULT')],
    consultation,
  );
  assertEqual(exact?.code, 'CONSULT', 'exact case wins over a case variant');

  assertEqual(
    pickTariffForCodes([], consultation),
    null,
    'no rows is null, not an error',
  );
  assertEqual(
    pickTariffForCodes([row('SOMETHING-ELSE')], consultation),
    null,
    'an unrelated code does not price a consultation',
  );
  assertEqual(
    pickTariffForCodes([row('CONSULT')], []) ,
    null,
    'no candidates is null',
  );

  console.log('  ✓ Tariff matching passed');
}

/* ============================================================
   6. LABORATORY CODES
   ============================================================ */

function testLabCodes(): void {
  assertEqual(
    normaliseTariffCode('Full Blood Count (CBC/FBC 5-Part Diff)'),
    'FULL-BLOOD-COUNT-CBC-FBC-5-PART-DIFF',
    'a long test name becomes a typeable code',
  );
  assertEqual(
    normaliseTariffCode('  '),
    '',
    'blank text is no code at all',
  );

  /*
   * The reported bug: the catalogue shows `LAB-CBC`, the facility prices
   * `LAB-CBC`, and billing used to look only for the long name.
   */
  const cbc = labTariffCodeCandidates({
    code: 'LAB-CBC',
    name: 'Full Blood Count (CBC/FBC 5-Part Diff)',
  });

  assertEqual(cbc[0], 'LAB-CBC', 'the catalogue code is tried first');
  assertEqual(cbc[1], 'CBC', 'the bare code is tried second');

  assert(
    cbc.includes('LAB-FULL-BLOOD-COUNT-CBC-FBC-5-PART-DIFF'),
    'the name-derived code is still tried',
  );
  assert(cbc.includes('LAB-GENERAL'), 'the generic laboratory code is tried');
  assertEqual(
    new Set(cbc).size,
    cbc.length,
    'no candidate is repeated',
  );

  const bare = labTariffCodeCandidates({ code: 'CBC', name: 'Full Blood Count' });
  assertEqual(bare[0], 'CBC', 'a bare catalogue code is kept as typed');
  assertEqual(bare[1], 'LAB-CBC', 'and its prefixed form is tried too');

  const noCode = labTariffCodeCandidates({ code: null, name: 'Malaria RDT' });
  assertEqual(
    noCode[0],
    'LAB-MALARIA-RDT',
    'free text with no catalogue code still produces a code',
  );
  assertEqual(
    noCode[noCode.length - 1],
    'LABORATORY',
    'the last resort is the generic laboratory code',
  );

  const lowercase = labTariffCodeCandidates({ code: ' lab-cbc ', name: '' });
  assertEqual(lowercase[0], 'LAB-CBC', 'case and padding are normalised');

  /*
   * End to end, without a database: the candidates a lab order produces
   * must match a tariff priced from the catalogue code.
   */
  const priced = pickTariffForCodes(
    [{ id: 7, code: 'LAB-CBC', description: 'Full blood count', fee: '1200.00', unit: 'Test' }],
    cbc,
  );
  assertEqual(priced?.fee, '1200.00', 'a LAB-CBC tariff prices a CBC order');

  /*
   * A generic tariff prices every test, which is the fallback a facility
   * uses when it does not want to price 40 tests one by one.
   */
  const generic = pickTariffForCodes(
    [{ id: 8, code: 'LAB-GENERAL', description: 'Laboratory', fee: '600.00', unit: 'Test' }],
    labTariffCodeCandidates({ code: 'LAB-RFT', name: 'Renal Function Tests' }),
  );
  assertEqual(generic?.code, 'LAB-GENERAL', 'LAB-GENERAL prices any test');

  /*
   * Procedures carry their own code too, so the same rule applies.
   */
  const proc = procedureTariffCodeCandidates({
    code: 'PROC-004',
    name: 'Wound dressing',
  });
  assertEqual(proc[0], 'PROC-004', 'a procedure code is tried first');
  assertEqual(proc[1], '004', 'and without its prefix');
  assert(proc.includes('PROC-WOUND-DRESSING'), 'the name-derived code is kept');
  assert(proc.includes('PROC-GENERAL'), 'the generic procedure code is kept');

  console.log('  ✓ Laboratory code candidates passed');
}

/* ============================================================
   RUNNER
   ============================================================ */

function run(): void {
  console.log('');
  console.log('==============================================');
  console.log('BILLING ENGINE TESTS');
  console.log('==============================================');
  console.log('');

  testMoney();
  testIdempotency();
  testBedDays();
  testTariffCodes();
  testTariffMatching();
  testLabCodes();

  console.log('');
  console.log('==============================================');
  console.log(`BILLING TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('BILLING TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
