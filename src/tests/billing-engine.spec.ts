import {
  bedDayDates,
  bedDayTariffCodes,
  buildIdempotencyKey,
  fromCents,
  pickTariffForCodes,
  toCents,
} from '../billing/billing.service.ts';
import {
  billingServiceKeys,
  buildBillingKey,
  isValidBillingKey,
  labTariffCodeCandidates,
  normaliseTariffCode,
  procedureTariffCodeCandidates,
} from '../billing/tariff-codes.ts';

import { describe, expect, it } from 'vitest';

describe('Billing engine — pure-logic tests', () => {
  it('1. MONEY', async () => {
    expect(toCents('1500.00'), 'KES 1500.00 is 150000 cents').toBe(150000);
    expect(toCents('0.01'), 'one cent').toBe(1);
    expect(toCents(250.5), 'numeric input').toBe(25050);
    expect(toCents(null), 'null is zero').toBe(0);
    expect(toCents(''), 'empty string is zero').toBe(0);
    expect(toCents('not-a-number'), 'garbage is zero, not NaN').toBe(0);

    /*
     * The classic float bug: 0.1 + 0.2 !== 0.3.
     * Cents arithmetic must survive it.
     */
    const sum = toCents('0.10') + toCents('0.20');
    expect(fromCents(sum), '0.10 + 0.20 is exactly 0.30').toBe('0.30');

    // 19.99 * 3 would be 59.97000000000001 in floats.
    expect(fromCents(toCents('19.99') * 3), '19.99 × 3 is exactly 59.97').toBe('59.97');

    expect(fromCents(0), 'zero formats with two decimals').toBe('0.00');
    expect(fromCents(5), 'single-cent formatting').toBe('0.05');
    expect(fromCents(100000), 'thousands').toBe('1000.00');
  });

  it('2. IDEMPOTENCY', async () => {
    const lab = buildIdempotencyKey({
      sourceType: 'LAB_ORDER',
      sourceId: 42,
    });

    expect(lab, 'lab order key').toBe('LAB_ORDER:42');

    // Same event twice must produce the same key, or it double-bills.
    expect(
      buildIdempotencyKey({ sourceType: 'LAB_ORDER', sourceId: 42 }),
      'replaying the same event yields an identical key',
    ).toBe(lab);

    // Different events must never collide.
    expect(
      buildIdempotencyKey({ sourceType: 'LAB_ORDER', sourceId: 43 }) !== lab,
      'a different order id produces a different key',
    ).toBe(true);

    expect(
      buildIdempotencyKey({ sourceType: 'PROCEDURE', sourceId: 42 }) !== lab,
      'a different source type produces a different key',
    ).toBe(true);

    const night = buildIdempotencyKey({
      sourceType: 'BED_DAY',
      sourceId: 7,
      idempotencySuffix: '2026-10-21',
    });

    expect(night, 'bed-night key includes the date').toBe('BED_DAY:7:2026-10-21');

    expect(
      night !==
        buildIdempotencyKey({
          sourceType: 'BED_DAY',
          sourceId: 7,
          idempotencySuffix: '2026-10-22',
        }),
      'consecutive nights are billed separately',
    ).toBe(true);
  });

  it('3. BED-DAY COUNTING', async () => {
    // Same-day admission and discharge still occupies one night.
    expect(
      bedDayDates('2026-10-21 08:00', '2026-10-21 18:00').length,
      'a same-day stay bills one night',
    ).toBe(1);

    // 21st to 23rd inclusive = 3 nights.
    const stay = bedDayDates('2026-10-21 09:00', '2026-10-23 11:00');

    expect(stay.length, 'a 3-day stay bills 3 nights').toBe(3);
    expect(stay[0], 'first night is the admission date').toBe('2026-10-21');
    expect(stay[2], 'last night is the discharge date').toBe('2026-10-23');

    // Date-only formats must parse.
    expect(
      bedDayDates('2026-10-21', '2026-10-22').length,
      'date-only strings bill two nights',
    ).toBe(2);

    // Slash-separated dates from older imports.
    expect(
      bedDayDates('2026/10/21', '2026/10/22').length >= 1,
      'slash-separated dates parse instead of throwing',
    ).toBe(true);

    // Garbage must not throw or loop forever.
    expect(
      bedDayDates('', '2026-10-22').length,
      'an unparseable admission date yields no charges',
    ).toBe(0);

    // A missing discharge date accrues up to today, never an infinite loop.
    const open = bedDayDates('2026-10-21', null);
    expect(open.length >= 1 && open.length <= 400, 'open stay is bounded').toBe(true);
  });

  it('4. TARIFF CODE PRECEDENCE', async () => {
    const icu = bedDayTariffCodes('ICU');

    expect(icu[0], 'ward-specific code is tried first').toBe('BED-ICU');
    expect(icu[1], 'second candidate is the WARD- prefix').toBe('WARD-ICU');
    expect(icu.includes('BED-DAY'), 'generic day rate is a fallback').toBe(true);
    expect(
      icu.indexOf('BED-DAY') > icu.indexOf('BED-ICU'),
      'generic fallback ranks below the ward-specific rate',
    ).toBe(true);

    const generic = bedDayTariffCodes(null);
    expect(generic[0], 'no ward falls straight to BED-DAY').toBe('BED-DAY');

    // Punctuation and case must not produce a code nobody can type.
    expect(bedDayTariffCodes('icu unit-2')[0], 'ward codes are normalised').toBe('BED-ICU-UNIT-2');
  });

  it('5. TARIFF MATCHING', async () => {
    const row = (code: string, fee = '500.00') => ({
      id: 1,
      code,
      description: code,
      fee,
      unit: 'Service',
    });

    const consultation = ['OPD-CONSULT', 'CONSULTATION', 'CONSULT'];

    expect(
      pickTariffForCodes([row('CONSULT')], consultation)?.code,
      'a generic consultation tariff prices a visit',
    ).toBe('CONSULT');

    /*
     * Priority order is the caller's, not the database's. If both exist,
     * the more specific code wins however the rows come back.
     */
    expect(
      pickTariffForCodes([row('CONSULT'), row('OPD-CONSULT')], consultation)?.code,
      'OPD-CONSULT beats CONSULT regardless of row order',
    ).toBe('OPD-CONSULT');

    /*
     * The silent-billing bug: a code saved in lower case used to match
     * nothing, so the visit started and no invoice line appeared.
     */
    expect(
      pickTariffForCodes([row('opd-consult')], consultation)?.code,
      'case does not hide a configured tariff',
    ).toBe('opd-consult');

    expect(
      pickTariffForCodes([row(' Consultation ')], consultation)?.code,
      'a padded code still matches after trimming',
    ).toBe(' Consultation ');

    /*
     * An exact-case row is preferred within one priority, so a duplicate
     * created before the write side uppercased does not shadow the row the
     * configuration screen wrote.
     */
    const exact = pickTariffForCodes([row('consult'), row('CONSULT')], consultation);
    expect(exact?.code, 'exact case wins over a case variant').toBe('CONSULT');

    expect(pickTariffForCodes([], consultation), 'no rows is null, not an error').toBe(null);
    expect(
      pickTariffForCodes([row('SOMETHING-ELSE')], consultation),
      'an unrelated code does not price a consultation',
    ).toBe(null);
    expect(pickTariffForCodes([row('CONSULT')], []), 'no candidates is null').toBe(null);
  });

  it('6. LABORATORY CODES', async () => {
    expect(
      normaliseTariffCode('Full Blood Count (CBC/FBC 5-Part Diff)'),
      'a long test name becomes a typeable code',
    ).toBe('FULL-BLOOD-COUNT-CBC-FBC-5-PART-DIFF');
    expect(normaliseTariffCode('  '), 'blank text is no code at all').toBe('');

    /*
     * The reported bug: the catalogue shows `LAB-CBC`, the facility prices
     * `LAB-CBC`, and billing used to look only for the long name.
     */
    const cbc = labTariffCodeCandidates({
      code: 'LAB-CBC',
      name: 'Full Blood Count (CBC/FBC 5-Part Diff)',
    });

    expect(cbc[0], 'the catalogue code is tried first').toBe('LAB-CBC');
    expect(cbc[1], 'the bare code is tried second').toBe('CBC');

    expect(
      cbc.includes('LAB-FULL-BLOOD-COUNT-CBC-FBC-5-PART-DIFF'),
      'the name-derived code is still tried',
    ).toBe(true);
    expect(cbc.includes('LAB-GENERAL'), 'the generic laboratory code is tried').toBe(true);
    expect(new Set(cbc).size, 'no candidate is repeated').toBe(cbc.length);

    const bare = labTariffCodeCandidates({ code: 'CBC', name: 'Full Blood Count' });
    expect(bare[0], 'a bare catalogue code is kept as typed').toBe('CBC');
    expect(bare[1], 'and its prefixed form is tried too').toBe('LAB-CBC');

    const noCode = labTariffCodeCandidates({ code: null, name: 'Malaria RDT' });
    expect(noCode[0], 'free text with no catalogue code still produces a code').toBe(
      'LAB-MALARIA-RDT',
    );
    expect(noCode[noCode.length - 1], 'the last resort is the generic laboratory code').toBe(
      'LABORATORY',
    );

    const lowercase = labTariffCodeCandidates({ code: ' lab-cbc ', name: '' });
    expect(lowercase[0], 'case and padding are normalised').toBe('LAB-CBC');

    /*
     * End to end, without a database: the candidates a lab order produces
     * must match a tariff priced from the catalogue code.
     */
    const priced = pickTariffForCodes(
      [{ id: 7, code: 'LAB-CBC', description: 'Full blood count', fee: '1200.00', unit: 'Test' }],
      cbc,
    );
    expect(priced?.fee, 'a LAB-CBC tariff prices a CBC order').toBe('1200.00');

    /*
     * A generic tariff prices every test, which is the fallback a facility
     * uses when it does not want to price 40 tests one by one.
     */
    const generic = pickTariffForCodes(
      [{ id: 8, code: 'LAB-GENERAL', description: 'Laboratory', fee: '600.00', unit: 'Test' }],
      labTariffCodeCandidates({ code: 'LAB-RFT', name: 'Renal Function Tests' }),
    );
    expect(generic?.code, 'LAB-GENERAL prices any test').toBe('LAB-GENERAL');

    /*
     * Procedures carry their own code too, so the same rule applies.
     */
    const proc = procedureTariffCodeCandidates({
      code: 'PROC-004',
      name: 'Wound dressing',
    });
    expect(proc[0], 'a procedure code is tried first').toBe('PROC-004');
    expect(proc[1], 'and without its prefix').toBe('004');
    expect(proc.includes('PROC-WOUND-DRESSING'), 'the name-derived code is kept').toBe(true);
    expect(proc.includes('PROC-GENERAL'), 'the generic procedure code is kept').toBe(true);
  });

  it('7. BILLING LINKS', async () => {
    /*
     * The reported bug: the facility numbered its price list OPD-001 and
     * the engine looked for OPD-CONSULT, so a 150 consultation billed
     * nothing. The link is how that is resolved without guessing between
     * OPD-001 (150) and OPD-002 (300).
     */
    expect(buildBillingKey('CONSULTATION'), 'a family with no detail is a bare key').toBe(
      'CONSULTATION',
    );
    expect(buildBillingKey('laboratory', 'lab-cbc'), 'the family and detail are normalised').toBe(
      'LABORATORY:LAB-CBC',
    );
    expect(
      buildBillingKey('RADIOLOGY', 'Obstetric ultrasound'),
      'a study name becomes a stable key',
    ).toBe('RADIOLOGY:OBSTETRIC-ULTRASOUND');
    expect(buildBillingKey('', ''), 'no family, no key').toBe(null);
    expect(buildBillingKey('CONSULT', ''), 'an unknown family is refused rather than stored').toBe(
      null,
    );

    expect(isValidBillingKey('CONSULTATION'), 'a bare key is valid').toBe(true);
    expect(isValidBillingKey('LABORATORY:LAB-CBC'), 'a key with a detail is valid').toBe(true);
    expect(!isValidBillingKey('CONSULTATION:'), 'an empty detail is not').toBe(true);
    expect(!isValidBillingKey('BOGUS'), 'an unknown family is not').toBe(true);
    expect(!isValidBillingKey('LABORATORY:with space'), 'an unnormalised detail is not').toBe(true);
    expect(!isValidBillingKey(null), 'null is not a key').toBe(true);

    /*
     * Order matters: the specific key must be tried before the generic one,
     * or a facility with both a per-test price and a fallback would always
     * get the fallback.
     */
    const labKeys = billingServiceKeys('LABORATORY', ['LAB-CBC', 'Full blood count']);

    expect(labKeys[0], 'the code is tried first').toBe('LABORATORY:LAB-CBC');
    expect(labKeys[1], 'then the normalised name').toBe('LABORATORY:FULL-BLOOD-COUNT');
    expect(labKeys[labKeys.length - 1], 'the fallback is last').toBe('LABORATORY');
    expect(new Set(labKeys).size, 'no key is repeated').toBe(labKeys.length);

    const consultKeys = billingServiceKeys('CONSULTATION');
    expect(consultKeys.length, 'a consultation has one key').toBe(1);
    expect(consultKeys[0], 'and it is the bare family').toBe('CONSULTATION');

    /*
     * A duplicated detail must not produce a duplicate key.
     */
    const doubled = billingServiceKeys('LABORATORY', ['LAB-CBC', 'lab-cbc']);
    expect(doubled.length, 'a repeated detail collapses to one key').toBe(2);
  });
});
