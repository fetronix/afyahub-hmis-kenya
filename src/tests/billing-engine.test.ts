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
  toCents,
} from '../billing/billing.service.ts';

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
