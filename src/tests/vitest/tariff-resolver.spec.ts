/**
 * Tariff resolution — what a service costs, and why it costs nothing
 *
 * `src/billing/tariff-resolver.ts` decides the price of every charge the
 * HMIS raises. Its own header records the failure it was written to end: a
 * laboratory order for "Blood" produced no charge, and all of these printed
 * the same useless sentence —
 *
 *   - no row matches at all;
 *   - a row matches but is inactive;
 *   - a row matches but is outside its effective dates;
 *   - a row matches at a different facility;
 *   - a row matches but is meant for manual pricing only;
 *   - two rows match and the first one won by row order.
 *
 * So the properties tested here are not "does it find a price". They are the
 * properties that keep a hospital's bill honest:
 *
 *   1. **The strongest statement wins.** An id-to-id link outranks a family
 *      link, which outranks an approved alias, which outranks a code match,
 *      which outranks guessing from a description.
 *   2. **A lapsed link stops the search.** If the facility linked a service
 *      to a tariff and that tariff is now inactive, expired or zero-priced,
 *      the answer is that failure — *not* some other tariff that happens to
 *      match the same code. Billing a price nobody chose is worse than
 *      billing nothing.
 *   3. **Ambiguity is never resolved by row order.** Two tariffs describing
 *      the same service produce no price at all.
 *   4. **A bed rate cannot price the wrong bed.** A family-wide bed-day link
 *      is a general-ward decision and must not charge an ICU night.
 *   5. **Every failure names its cause and its row**, because the whole
 *      point of the module is that "no tariff matched" is not an answer.
 *
 * `resolveFromRows` is pure: rows are passed in, and `today` is a parameter
 * rather than a clock read, so these are real executions with no PostgreSQL,
 * no environment and no fixtures from a live database. Every code, ward and
 * fee below is invented; no patient, facility or price list is reproduced.
 */

import { describe, expect, it } from 'vitest';

import {
  CATALOGUE_SERVICE_TYPES,
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
  type CatalogueServiceType,
  type ResolvableTariff,
  type ResolutionInput,
  type TariffLink,
} from '../../billing/tariff-resolver.ts';

/* ============================================================
   Fixtures
   ============================================================ */

const TODAY = '2026-10-26';

function tariff(
  over: Partial<ResolvableTariff> & Pick<ResolvableTariff, 'id' | 'code'>,
): ResolvableTariff {
  return {
    description: `Synthetic service ${over.code}`,
    fee: '500.00',
    unit: 'Per test',
    department: 'laboratory',
    isActive: true,
    ...over,
  };
}

function link(over: Partial<TariffLink> & Pick<TariffLink, 'id' | 'tariffId'>): TariffLink {
  return {
    serviceType: 'LAB_TEST',
    serviceId: null,
    autoBill: true,
    isActive: true,
    ...over,
  };
}

function input(over: Partial<ResolutionInput> = {}): ResolutionInput {
  return {
    serviceType: 'LAB_TEST',
    today: TODAY,
    links: [],
    tariffs: [],
    ...over,
  };
}

/* ============================================================
   1. Unit of charge
   ============================================================ */

describe('unitVerdict', () => {
  it('treats a blank or absent unit as missing', () => {
    expect(unitVerdict('LAB_TEST', '')).toBe('MISSING');
    expect(unitVerdict('LAB_TEST', '   ')).toBe('MISSING');
    expect(unitVerdict('LAB_TEST', null)).toBe('MISSING');
    expect(unitVerdict('LAB_TEST', undefined)).toBe('MISSING');
  });

  it('accepts the units a laboratory actually uses', () => {
    expect(unitVerdict('LAB_TEST', 'Per test')).toBe('OK');
    expect(unitVerdict('LAB_TEST', 'Per specimen')).toBe('OK');
    expect(unitVerdict('LAB_TEST', 'Each')).toBe('OK');
  });

  it('refuses to price a laboratory test per day or per night', () => {
    /*
     * A lab test priced "per day" multiplies a single test by a length of
     * stay. The invoice would still add up; it would just be wrong.
     */
    expect(unitVerdict('LAB_TEST', 'Per day')).toBe('INCOMPATIBLE');
    expect(unitVerdict('LAB_TEST', 'per night')).toBe('INCOMPATIBLE');
    expect(unitVerdict('LAB_TEST', 'day')).toBe('INCOMPATIBLE');
    expect(unitVerdict('LAB_TEST', 'Per admission')).toBe('INCOMPATIBLE');
  });

  it('refuses to price an admission or a bed-night as a recurring charge', () => {
    /* An admission fee is charged once, whatever the row is called. */
    expect(unitVerdict('ADMISSION', 'Per night')).toBe('INCOMPATIBLE');
    expect(unitVerdict('ADMISSION', 'Per bed')).toBe('INCOMPATIBLE');

    /* And a bed-night is not the admission fee, repeated. */
    expect(unitVerdict('BED_DAY', 'Per admission')).toBe('INCOMPATIBLE');
    expect(unitVerdict('BED_DAY', 'Per procedure')).toBe('INCOMPATIBLE');
    expect(unitVerdict('BED_DAY', 'Per night')).toBe('OK');
  });

  it('is case-insensitive about the prohibition', () => {
    expect(unitVerdict('LAB_TEST', 'PER DAY')).toBe('INCOMPATIBLE');
    expect(unitVerdict('BED_DAY', 'PER   ADMISSION')).toBe('INCOMPATIBLE');
  });

  it('never rejects a unit that is natural for its own service type', () => {
    /*
     * The prohibitions above are regexes, and an over-broad one would block
     * the legitimate unit — a laboratory charging "Per test" is correct, and
     * refusing it would stop every laboratory charge in the facility.
     */
    const natural: Record<CatalogueServiceType, string> = {
      LAB_TEST: 'Per test',
      CONSULTATION: 'Per visit',
      RADIOLOGY: 'Per image',
      PROCEDURE: 'Per procedure',
      PHARMACY: 'Per item',
      ADMISSION: 'Per admission',
      BED_DAY: 'Per night',
      DELIVERY: 'Per delivery',
    };

    for (const type of CATALOGUE_SERVICE_TYPES) {
      expect(unitVerdict(type, natural[type]), type).toBe('OK');
    }
  });
});

/* ============================================================
   2. Effective dates
   ============================================================ */

describe('dateVerdict', () => {
  it('accepts a row with no period at all', () => {
    expect(dateVerdict(null, null, TODAY)).toBe('OK');
    expect(dateVerdict(undefined, undefined, TODAY)).toBe('OK');
    expect(dateVerdict('', '', TODAY)).toBe('OK');
  });

  it('treats both ends of the period as inclusive', () => {
    /* A price that "ends on 26 October" is still the price on 26 October. */
    expect(dateVerdict('2026-10-26', '2026-10-26', TODAY)).toBe('OK');
    expect(dateVerdict('2026-01-01', '2026-10-26', TODAY)).toBe('OK');
    expect(dateVerdict('2026-10-26', '2026-12-31', TODAY)).toBe('OK');
  });

  it('reports a period that has ended', () => {
    expect(dateVerdict(null, '2026-10-25', TODAY)).toBe('EXPIRED');
    expect(dateVerdict('2026-01-01', '2026-01-31', TODAY)).toBe('EXPIRED');
  });

  it('reports a period that has not started', () => {
    expect(dateVerdict('2026-10-27', null, TODAY)).toBe('NOT_YET_EFFECTIVE');
    expect(dateVerdict('2027-01-01', '2027-12-31', TODAY)).toBe('NOT_YET_EFFECTIVE');
  });

  it('compares calendar dates, ignoring a time component', () => {
    /* The column may arrive as a timestamp; the date is what matters. */
    expect(dateVerdict('2026-10-26T00:00:00.000Z', null, TODAY)).toBe('OK');
    expect(dateVerdict(null, '2026-10-26T23:59:59.000Z', TODAY)).toBe('OK');
  });

  it('reports expiry before a future start when both are wrong', () => {
    /* Cannot happen in a sane price list, but the answer must be one of the
     * two verdicts rather than a third state the caller cannot handle. */
    expect(dateVerdict('2027-01-01', '2026-01-01', TODAY)).toBe('EXPIRED');
  });
});

describe('todayKey', () => {
  it('formats a local calendar date as YYYY-MM-DD', () => {
    /* Constructed with local components: effective dates are calendar facts,
     * not UTC ones, and a charge taken at 21:00 in Nairobi must not be
     * judged against yesterday. */
    expect(todayKey(new Date(2026, 9, 26))).toBe('2026-10-26');
    expect(todayKey(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(todayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('zero-pads so the value sorts lexicographically', () => {
    const early = todayKey(new Date(2026, 0, 5));
    const late = todayKey(new Date(2026, 10, 5));

    expect(early).toBe('2026-01-05');
    expect(early < late).toBe(true);
  });
});

/* ============================================================
   3. Catalogue types and diagnostics
   ============================================================ */

describe('catalogue service types', () => {
  it('recognises only the declared types', () => {
    for (const type of CATALOGUE_SERVICE_TYPES) {
      expect(isCatalogueServiceType(type)).toBe(true);
    }

    expect(isCatalogueServiceType('lab_test')).toBe(false);
    expect(isCatalogueServiceType('DRUG')).toBe(false);
    expect(isCatalogueServiceType('')).toBe(false);
    expect(isCatalogueServiceType(null)).toBe(false);
    expect(isCatalogueServiceType(42)).toBe(false);
  });

  it('maps LAB_TEST onto the LABORATORY billing family and passes others through', () => {
    expect(familyForServiceType('LAB_TEST')).toBe('LABORATORY');
    expect(familyForServiceType('BED_DAY')).toBe('BED_DAY');
    expect(familyForServiceType('CONSULTATION')).toBe('CONSULTATION');
  });
});

describe('failure diagnostics', () => {
  it('gives every failure code a human label', () => {
    const codes = [
      'NO_TARIFF',
      'NOT_LINKED',
      'INACTIVE',
      'EXPIRED',
      'NOT_YET_EFFECTIVE',
      'AUTOMATIC_BILLING_DISABLED',
      'AMBIGUOUS',
      'UNIT_INCOMPATIBLE',
      'NO_UNIT',
      'ZERO_PRICE',
    ] as const;

    for (const code of codes) {
      expect(failureLabel(code)).toBeTruthy();
      /* Never the raw enum: the screen shows this text to an administrator. */
      expect(failureLabel(code)).not.toBe(code);
    }
  });

  it('separates "the facility must configure this" from "someone must fix a row"', () => {
    expect(needsConfiguration('NO_TARIFF')).toBe(true);
    expect(needsConfiguration('INACTIVE')).toBe(true);
    expect(needsConfiguration('AMBIGUOUS')).toBe(true);

    /* A unit or price mistake is a data error, not an unconfigured service. */
    expect(needsConfiguration('UNIT_INCOMPATIBLE')).toBe(false);
    expect(needsConfiguration('ZERO_PRICE')).toBe(false);

    for (const code of CONFIGURATION_FAILURES) {
      expect(needsConfiguration(code)).toBe(true);
    }
  });

  it('detects a database that predates the link table or its columns', () => {
    /* The resolver must still run on a facility that has not applied the
     * migrations, rather than crashing every charge. */
    expect(isMissingSchemaObject({ code: '42P01' })).toBe(true); // undefined_table
    expect(isMissingSchemaObject({ code: '42703' })).toBe(true); // undefined_column
    expect(isMissingSchemaObject({ code: '23505' })).toBe(false); // unique_violation
    expect(isMissingSchemaObject(new Error('boom'))).toBe(false);
    expect(isMissingSchemaObject(null)).toBe(false);
    expect(isMissingSchemaObject(undefined)).toBe(false);
    expect(isMissingSchemaObject('42P01')).toBe(false);
  });
});

/* ============================================================
   4. Precedence
   ============================================================ */

describe('resolution precedence', () => {
  const byLink = tariff({ id: 1, code: 'LAB-LINKED', fee: '700.00' });
  const byFamily = tariff({ id: 2, code: 'LAB-FAMILY', fee: '600.00' });
  const byAlias = tariff({
    id: 3,
    code: 'LAB-ALIAS',
    fee: '550.00',
    billingKey: 'LABORATORY:LAB-CBC',
  });
  const byCode = tariff({ id: 4, code: 'LAB-CBC', fee: '500.00' });
  const byDescription = tariff({
    id: 5,
    code: 'LAB-009',
    description: 'Complete blood count',
    fee: '450.00',
  });

  const everything = [byLink, byFamily, byAlias, byCode, byDescription];

  function withAll(): ResolutionInput {
    return input({
      serviceId: 42,
      codes: ['LAB-CBC'],
      serviceKeys: ['LABORATORY:LAB-CBC'],
      family: 'LABORATORY',
      phrases: ['complete blood count'],
      links: [
        link({ id: 100, serviceId: 42, tariffId: 1 }),
        link({ id: 101, serviceId: null, tariffId: 2 }),
      ],
      tariffs: everything,
    });
  }

  it('prefers an explicit service link over everything else', () => {
    const result = resolveFromRows(withAll());

    expect(result.rule).toBe('LINK');
    expect(result.tariff?.id).toBe(1);
    expect(result.linkId).toBe(100);
    expect(result.failure).toBeNull();
  });

  it('prefers a family link over an alias, a code and a description', () => {
    const result = resolveFromRows({ ...withAll(), serviceId: null });

    expect(result.rule).toBe('FAMILY_LINK');
    expect(result.tariff?.id).toBe(2);
    expect(result.linkId).toBe(101);
  });

  it('prefers an approved alias over a code match', () => {
    const result = resolveFromRows({ ...withAll(), serviceId: null, links: [] });

    expect(result.rule).toBe('ALIAS');
    expect(result.tariff?.code).toBe('LAB-ALIAS');
  });

  it('prefers an exact code over a description match', () => {
    const result = resolveFromRows({
      ...withAll(),
      serviceId: null,
      links: [],
      serviceKeys: [],
    });

    expect(result.rule).toBe('CODE');
    expect(result.tariff?.code).toBe('LAB-CBC');
  });

  it('falls back to the description only when nothing better answers', () => {
    const result = resolveFromRows({
      ...withAll(),
      serviceId: null,
      links: [],
      serviceKeys: [],
      codes: [],
    });

    expect(result.rule).toBe('CATALOGUE');
    expect(result.tariff?.code).toBe('LAB-009');
  });

  it('records the code and phrase candidates it tried', () => {
    const result = resolveFromRows({
      ...withAll(),
      serviceId: null,
      links: [],
      serviceKeys: [],
      codes: [],
      phrases: ['nothing matches this', '  '],
      tariffs: [byLink],
    });

    /* The candidates are reported exactly as supplied, blanks included: the
     * configuration screen shows what was asked for, and silently filtering
     * the list would hide a caller that generated an empty phrase. */
    expect(result.codesTried).toStrictEqual([]);
    expect(result.phrasesTried).toStrictEqual(['nothing matches this', '  ']);
    expect(result.failure?.code).toBe('NO_TARIFF');
  });
});

/* ============================================================
   5. A link that cannot be honoured stops the search
   ============================================================ */

describe('a broken link fails closed', () => {
  const lapsed = tariff({ id: 1, code: 'LAB-CBC', isActive: false });
  const healthy = tariff({ id: 2, code: 'LAB-CBC', fee: '900.00' });

  it('does not bill a different tariff when the linked one is inactive', () => {
    /*
     * This is the central safety property. Two active-looking ways to price
     * this service exist — the code rule would happily return tariff 2 — but
     * the facility said "use tariff 1". Silently substituting another price
     * would put a number on an invoice that nobody at the hospital chose.
     */
    const result = resolveFromRows(
      input({
        serviceId: 42,
        codes: ['LAB-CBC'],
        links: [link({ id: 100, serviceId: 42, tariffId: 1 })],
        tariffs: [lapsed, healthy],
      }),
    );

    expect(result.tariff).toBeNull();
    expect(result.rule).toBeNull();
    expect(result.failure?.code).toBe('INACTIVE');
    expect(result.failure?.message).toContain('LAB-CBC');
  });

  it('names the tariff when the link points at a row that no longer exists', () => {
    const result = resolveFromRows(
      input({
        serviceId: 42,
        links: [link({ id: 100, serviceId: 42, tariffId: 999 })],
        tariffs: [healthy],
      }),
    );

    expect(result.failure?.code).toBe('NO_TARIFF');
    expect(result.failure?.message).toContain('no longer exists');
    expect(result.linkId).toBe(100);
  });

  it('reports an expired price period instead of the next row that matches', () => {
    const expired = tariff({
      id: 1,
      code: 'LAB-CBC',
      effectiveFrom: '2025-01-01',
      effectiveTo: '2025-12-31',
    });

    const result = resolveFromRows(
      input({
        serviceId: 42,
        links: [link({ id: 100, serviceId: 42, tariffId: 1 })],
        tariffs: [expired, healthy],
      }),
    );

    expect(result.failure?.code).toBe('EXPIRED');
    expect(result.failure?.message).toContain('2025-12-31');
  });

  it('reports a price period that has not started', () => {
    const future = tariff({
      id: 1,
      code: 'LAB-CBC',
      effectiveFrom: '2027-01-01',
    });

    const result = resolveFromRows(
      input({
        serviceId: 42,
        links: [link({ id: 100, serviceId: 42, tariffId: 1 })],
        tariffs: [future, healthy],
      }),
    );

    expect(result.failure?.code).toBe('NOT_YET_EFFECTIVE');
    expect(result.failure?.message).toContain('2027-01-01');
  });

  it('reports a zero-priced linked tariff rather than billing nothing quietly', () => {
    const free = tariff({ id: 1, code: 'LAB-CBC', fee: '0.00' });

    const result = resolveFromRows(
      input({
        serviceId: 42,
        links: [link({ id: 100, serviceId: 42, tariffId: 1 })],
        tariffs: [free, healthy],
      }),
    );

    expect(result.failure?.code).toBe('ZERO_PRICE');
    expect(result.failure?.candidates).toStrictEqual(['LAB-CBC']);
  });

  it('honours automatic-billing exclusion on the link in AUTO mode only', () => {
    const autoless = link({ id: 100, serviceId: 42, tariffId: 2, autoBill: false });

    const auto = resolveFromRows(input({ serviceId: 42, links: [autoless], tariffs: [healthy] }));

    expect(auto.failure?.code).toBe('AUTOMATIC_BILLING_DISABLED');
    expect(auto.tariff).toBeNull();

    /* A cashier pricing a line by hand is allowed to use it. */
    const manual = resolveFromRows(
      input({ serviceId: 42, links: [autoless], tariffs: [healthy], mode: 'MANUAL' }),
    );

    expect(manual.failure).toBeNull();
    expect(manual.tariff?.id).toBe(2);
  });

  it('honours automatic-billing exclusion on the tariff in AUTO mode only', () => {
    const excluded = tariff({ id: 1, code: 'LAB-CBC', autoBill: false });

    const auto = resolveFromRows(
      input({
        serviceId: 42,
        links: [link({ id: 100, serviceId: 42, tariffId: 1 })],
        tariffs: [excluded],
      }),
    );

    expect(auto.failure?.code).toBe('AUTOMATIC_BILLING_DISABLED');

    const manual = resolveFromRows(
      input({
        serviceId: 42,
        links: [link({ id: 100, serviceId: 42, tariffId: 1 })],
        tariffs: [excluded],
        mode: 'MANUAL',
      }),
    );

    expect(manual.failure).toBeNull();
    expect(manual.tariff?.id).toBe(1);
  });

  it('ignores a deactivated link and lets a weaker rule answer', () => {
    /* A switched-off link is not a statement about price; it is the absence
     * of one. Unlike a link to a lapsed tariff, falling through is correct. */
    const result = resolveFromRows(
      input({
        serviceId: 42,
        codes: ['LAB-CBC'],
        links: [link({ id: 100, serviceId: 42, tariffId: 1, isActive: false })],
        tariffs: [tariff({ id: 1, code: 'LAB-OTHER' }), healthy],
      }),
    );

    expect(result.rule).toBe('CODE');
    expect(result.tariff?.id).toBe(2);
  });

  it('ignores a link that belongs to another service type', () => {
    const result = resolveFromRows(
      input({
        serviceType: 'RADIOLOGY',
        serviceId: 42,
        codes: ['RAD-001'],
        links: [link({ id: 100, serviceType: 'LAB_TEST', serviceId: 42, tariffId: 1 })],
        tariffs: [
          tariff({ id: 1, code: 'LAB-ONLY', department: 'laboratory' }),
          tariff({ id: 2, code: 'RAD-001', department: 'radiology', unit: 'Per image' }),
        ],
      }),
    );

    expect(result.rule).toBe('CODE');
    expect(result.tariff?.code).toBe('RAD-001');
  });

  it('does not treat a link with no service id as an explicit link', () => {
    /* serviceId null is the family-wide statement, so it must report
     * FAMILY_LINK, not LINK, and must not claim a link id. */
    const result = resolveFromRows(
      input({
        links: [link({ id: 101, serviceId: null, tariffId: 2 })],
        tariffs: [healthy],
      }),
    );

    expect(result.rule).toBe('FAMILY_LINK');
    expect(result.linkId).toBe(101);
  });
});

/* ============================================================
   6. A bed rate cannot price the wrong bed
   ============================================================ */

describe('bed-day family links', () => {
  const wardRate = tariff({
    id: 1,
    code: 'IP-001',
    description: 'General ward bed',
    fee: '1500.00',
    unit: 'Per night',
    department: 'inpatient',
  });

  function bedInput(over: Partial<ResolutionInput>): ResolutionInput {
    return input({
      serviceType: 'BED_DAY',
      family: 'BED_DAY',
      serviceId: null,
      links: [link({ id: 101, serviceType: 'BED_DAY', serviceId: null, tariffId: 1 })],
      tariffs: [wardRate],
      ...over,
    });
  }

  it('applies a family-wide bed-day link to a general ward', () => {
    const result = resolveFromRows(bedInput({ wardType: 'General' }));

    expect(result.rule).toBe('FAMILY_LINK');
    expect(result.tariff?.code).toBe('IP-001');
  });

  it('applies it when the facility did not classify the bed', () => {
    expect(resolveFromRows(bedInput({ wardType: null })).rule).toBe('FAMILY_LINK');
    expect(resolveFromRows(bedInput({ wardType: '' })).rule).toBe('FAMILY_LINK');
    expect(resolveFromRows(bedInput({ wardType: 'Normal' })).rule).toBe('FAMILY_LINK');
  });

  it('refuses to bill the general rate for an ICU night', () => {
    /*
     * Billing 1,500 for an ICU night understates the charge and the bed
     * category. Failing with a message that says how to fix it is the only
     * honest outcome.
     */
    const result = resolveFromRows(bedInput({ wardType: 'ICU' }));

    expect(result.tariff).toBeNull();
    expect(result.rule).toBeNull();
    expect(result.failure?.code).toBe('NO_TARIFF');

    const skipped = result.rows.find((row) => row.tariff.id === 1);
    expect(skipped?.note).toContain('family-wide bed-day link');
    expect(skipped?.note).toContain('ICU');
  });

  it('refuses for maternity and paediatric beds too', () => {
    for (const wardType of ['Maternity', 'Paediatric', 'HDU', 'Isolation']) {
      expect(resolveFromRows(bedInput({ wardType })).tariff).toBeNull();
    }
  });

  it('still uses a ward-specific link for a special bed', () => {
    /* The skip applies to the family-wide link only. */
    const result = resolveFromRows(
      bedInput({
        serviceId: 77,
        wardType: 'ICU',
        links: [
          link({ id: 200, serviceType: 'BED_DAY', serviceId: 77, tariffId: 2 }),
          link({ id: 101, serviceType: 'BED_DAY', serviceId: null, tariffId: 1 }),
        ],
        tariffs: [
          wardRate,
          tariff({
            id: 2,
            code: 'IP-007',
            description: 'ICU bed',
            fee: '6000.00',
            unit: 'Per night',
            department: 'inpatient',
          }),
        ],
      }),
    );

    expect(result.rule).toBe('LINK');
    expect(result.tariff?.code).toBe('IP-007');
  });

  it('does not apply the bed rule to a non-bed service type', () => {
    const result = resolveFromRows(
      input({
        serviceType: 'RADIOLOGY',
        family: 'RADIOLOGY',
        wardType: 'ICU',
        links: [link({ id: 101, serviceType: 'RADIOLOGY', serviceId: null, tariffId: 1 })],
        tariffs: [tariff({ id: 1, code: 'RAD-001', department: 'radiology', unit: 'Per image' })],
      }),
    );

    expect(result.rule).toBe('FAMILY_LINK');
  });
});

/* ============================================================
   7. Aliases and codes
   ============================================================ */

describe('aliases', () => {
  it('matches a billing key case-insensitively and trimmed', () => {
    const result = resolveFromRows(
      input({
        serviceKeys: ['  laboratory:lab-cbc  '],
        tariffs: [tariff({ id: 1, code: 'LAB-001', billingKey: 'LABORATORY:LAB-CBC' })],
      }),
    );

    expect(result.rule).toBe('ALIAS');
    expect(result.tariff?.id).toBe(1);
  });

  it('skips an alias whose only tariffs are unusable and explains why', () => {
    const result = resolveFromRows(
      input({
        serviceKeys: ['LABORATORY:LAB-CBC'],
        tariffs: [
          tariff({ id: 1, code: 'LAB-001', billingKey: 'LABORATORY:LAB-CBC', isActive: false }),
        ],
      }),
    );

    expect(result.tariff).toBeNull();
    expect(result.failure?.code).toBe('INACTIVE');
    expect(result.failure?.message).toContain('LAB-001');
  });

  it('prefers a usable row when the same alias appears on several', () => {
    const result = resolveFromRows(
      input({
        serviceKeys: ['LABORATORY:LAB-CBC'],
        tariffs: [
          tariff({ id: 1, code: 'LAB-001', billingKey: 'LABORATORY:LAB-CBC', isActive: false }),
          tariff({ id: 2, code: 'LAB-002', billingKey: 'LABORATORY:LAB-CBC', fee: '650.00' }),
        ],
      }),
    );

    expect(result.rule).toBe('ALIAS');
    expect(result.tariff?.id).toBe(2);
  });

  it('does not let an alias price a zero-rated tariff', () => {
    const result = resolveFromRows(
      input({
        serviceKeys: ['LABORATORY:LAB-CBC'],
        tariffs: [tariff({ id: 1, code: 'LAB-001', billingKey: 'LABORATORY:LAB-CBC', fee: '0' })],
      }),
    );

    expect(result.tariff).toBeNull();
    expect(result.failure?.code).toBe('ZERO_PRICE');
  });

  it('falls through an alias that matches nothing', () => {
    const result = resolveFromRows(
      input({
        serviceKeys: ['LABORATORY:LABCBC'],
        codes: ['LAB-CBC'],
        tariffs: [tariff({ id: 1, code: 'LAB-CBC' })],
      }),
    );

    expect(result.rule).toBe('CODE');
  });
});

describe('exact codes', () => {
  it('matches a code regardless of case and surrounding space', () => {
    const result = resolveFromRows(
      input({
        codes: ['  lab-cbc '],
        tariffs: [tariff({ id: 1, code: 'LAB-CBC' })],
      }),
    );

    expect(result.rule).toBe('CODE');
    expect(result.tariff?.id).toBe(1);
  });

  it('tries the codes in the order given', () => {
    const result = resolveFromRows(
      input({
        codes: ['LAB-FIRST', 'LAB-SECOND'],
        tariffs: [tariff({ id: 1, code: 'LAB-FIRST' }), tariff({ id: 2, code: 'LAB-SECOND' })],
      }),
    );

    expect(result.tariff?.code).toBe('LAB-FIRST');
  });

  it('reports which row matched the code but was rejected, and why', () => {
    const result = resolveFromRows(
      input({
        codes: ['LAB-CBC'],
        tariffs: [tariff({ id: 1, code: 'LAB-CBC', isActive: false })],
      }),
    );

    expect(result.tariff).toBeNull();
    expect(result.failure?.code).toBe('INACTIVE');
    expect(result.failure?.message).toContain('LAB-CBC matches this service');
  });

  it('reports an incompatible unit rather than billing a multiplied test', () => {
    const result = resolveFromRows(
      input({
        codes: ['LAB-CBC'],
        tariffs: [tariff({ id: 1, code: 'LAB-CBC', unit: 'Per day' })],
      }),
    );

    expect(result.failure?.code).toBe('UNIT_INCOMPATIBLE');
    expect(result.failure?.message).toContain('Per day');
  });

  it('ignores blank codes', () => {
    const result = resolveFromRows(
      input({ codes: ['', '   '], tariffs: [tariff({ id: 1, code: 'LAB-CBC' })] }),
    );

    expect(result.failure?.code).toBe('NO_TARIFF');
  });

  it('fails with NO_TARIFF when nothing matches at all', () => {
    const result = resolveFromRows(
      input({ codes: ['LAB-ZZZ'], tariffs: [tariff({ id: 1, code: 'LAB-CBC' })] }),
    );

    expect(result.tariff).toBeNull();
    expect(result.failure?.code).toBe('NO_TARIFF');
    expect(result.failure?.codesTried).toStrictEqual(['LAB-ZZZ']);
  });
});

/* ============================================================
   8. Ambiguity is never resolved by row order
   ============================================================ */

describe('ambiguity', () => {
  const twoIdentical = [
    tariff({ id: 1, code: 'LAB-001', description: 'Malaria RDT', fee: '300.00' }),
    tariff({ id: 2, code: 'LAB-002', description: 'Malaria RDT test', fee: '350.00' }),
  ];

  it('refuses to choose between two tariffs that both describe the service', () => {
    const result = resolveFromRows(
      input({ family: 'LABORATORY', phrases: ['Malaria RDT'], tariffs: twoIdentical }),
    );

    expect(result.tariff).toBeNull();
    expect(result.failure?.code).toBe('AMBIGUOUS');
    expect(result.failure?.candidates).toStrictEqual(['LAB-001', 'LAB-002']);
  });

  it('does not depend on which row comes first', () => {
    const forward = resolveFromRows(
      input({ family: 'LABORATORY', phrases: ['Malaria RDT'], tariffs: twoIdentical }),
    );
    const reverse = resolveFromRows(
      input({
        family: 'LABORATORY',
        phrases: ['Malaria RDT'],
        tariffs: [...twoIdentical].reverse(),
      }),
    );

    expect(forward.failure?.code).toBe(reverse.failure?.code);
    expect(forward.failure?.candidates).toStrictEqual(reverse.failure?.candidates);
  });

  it('marks both candidate rows as the ambiguity on the explanation', () => {
    const result = resolveFromRows(
      input({ family: 'LABORATORY', phrases: ['Malaria RDT'], tariffs: twoIdentical }),
    );

    const ambiguous = result.rows.filter((row) => row.verdict === 'AMBIGUOUS');

    expect(ambiguous).toHaveLength(2);
    expect(ambiguous.every((row) => row.note.includes('ambiguity'))).toBe(true);
  });

  it('resolves when only one tariff describes the service', () => {
    const result = resolveFromRows(
      input({
        family: 'LABORATORY',
        phrases: ['Malaria RDT'],
        tariffs: [
          tariff({ id: 1, code: 'LAB-001', description: 'Malaria RDT', fee: '300.00' }),
          tariff({ id: 2, code: 'LAB-002', description: 'Urinalysis', fee: '200.00' }),
        ],
      }),
    );

    expect(result.rule).toBe('CATALOGUE');
    expect(result.tariff?.code).toBe('LAB-001');
  });

  it('will not match a single vague word', () => {
    /* "Blood" cannot identify one service out of a price list, and matching
     * it would pick a price by accident. */
    const result = resolveFromRows(
      input({
        family: 'LABORATORY',
        phrases: ['Blood'],
        tariffs: [tariff({ id: 1, code: 'LAB-BLOOD', description: 'Blood', fee: '800.00' })],
      }),
    );

    expect(result.tariff).toBeNull();
    expect(result.failure?.code).toBe('NO_TARIFF');
  });

  it('will not match a general consultation phrase against a follow-up', () => {
    /* Charging a follow-up visit at the general rate is the documented bug. */
    const result = resolveFromRows(
      input({
        serviceType: 'CONSULTATION',
        family: 'CONSULTATION',
        phrases: ['Consultation'],
        tariffs: [
          tariff({
            id: 1,
            code: 'OPD-002',
            description: 'Follow-up consultation',
            fee: '150.00',
            unit: 'Per visit',
            department: 'opd',
          }),
        ],
      }),
    );

    expect(result.tariff).toBeNull();
  });

  it('matches a general consultation phrase against a neutral description', () => {
    const result = resolveFromRows(
      input({
        serviceType: 'CONSULTATION',
        family: 'CONSULTATION',
        phrases: ['Consultation'],
        tariffs: [
          tariff({
            id: 1,
            code: 'OPD-001',
            description: 'General consultation',
            fee: '300.00',
            unit: 'Per visit',
            department: 'opd',
          }),
        ],
      }),
    );

    expect(result.rule).toBe('CATALOGUE');
    expect(result.tariff?.code).toBe('OPD-001');
  });
});

/* ============================================================
   9. Every row gets a verdict
   ============================================================ */

describe('explanation rows', () => {
  const rows = [
    tariff({ id: 1, code: 'LAB-CBC', fee: '500.00' }),
    tariff({ id: 2, code: 'LAB-OFF', isActive: false }),
    tariff({ id: 3, code: 'LAB-OLD', effectiveTo: '2025-12-31' }),
    tariff({ id: 4, code: 'LAB-SOON', effectiveFrom: '2027-01-01' }),
    tariff({ id: 5, code: 'LAB-NOUNIT', unit: '' }),
    tariff({ id: 6, code: 'LAB-DAYS', unit: 'Per day' }),
    tariff({ id: 7, code: 'LAB-MANUAL', autoBill: false }),
  ];

  it('marks exactly one row as the price that will be charged', () => {
    const result = resolveFromRows(input({ codes: ['LAB-CBC'], tariffs: rows }));

    const resolved = result.rows.filter((row) => row.verdict.startsWith('RESOLVED_'));

    expect(resolved).toHaveLength(1);
    expect(resolved[0].tariff.code).toBe('LAB-CBC');
    expect(resolved[0].verdict).toBe('RESOLVED_CODE');
    expect(resolved[0].note).toContain('500.00');
  });

  it('gives every rejected row the reason an administrator needs', () => {
    const result = resolveFromRows(input({ codes: ['LAB-CBC'], tariffs: rows }));
    const verdicts = new Map(result.rows.map((row) => [row.tariff.code, row.verdict]));

    expect(verdicts.get('LAB-OFF')).toBe('INACTIVE');
    expect(verdicts.get('LAB-OLD')).toBe('EXPIRED');
    expect(verdicts.get('LAB-SOON')).toBe('NOT_YET_EFFECTIVE');
    expect(verdicts.get('LAB-NOUNIT')).toBe('NO_UNIT');
    expect(verdicts.get('LAB-DAYS')).toBe('UNIT_INCOMPATIBLE');
    expect(verdicts.get('LAB-MANUAL')).toBe('AUTOMATIC_BILLING_DISABLED');
  });

  it('accounts for every row it was given', () => {
    const result = resolveFromRows(input({ codes: ['LAB-CBC'], tariffs: rows }));

    expect(result.rows).toHaveLength(rows.length);
    expect(new Set(result.rows.map((row) => row.tariff.id)).size).toBe(rows.length);
  });

  it('names the inactive row rather than saying nothing matched', () => {
    /*
     * The diagnostic pass re-asks the matcher "which row describes this
     * service" with activity forced on, so the answer can be INACTIVE.
     * It must still judge the stored row — otherwise it would report a
     * usable price — hence the failure code stays INACTIVE.
     */
    const result = resolveFromRows(
      input({
        family: 'LABORATORY',
        phrases: ['malaria rdt'],
        tariffs: [tariff({ id: 1, code: 'LAB-001', description: 'Malaria RDT', isActive: false })],
      }),
    );

    expect(result.tariff).toBeNull();
    expect(result.failure?.code).toBe('INACTIVE');
    expect(result.failure?.message).toContain('LAB-001');
    expect(result.failure?.message).toContain('describes this service');
  });

  it('reports a zero-priced describing row instead of a flat no-match', () => {
    const result = resolveFromRows(
      input({
        family: 'LABORATORY',
        phrases: ['malaria rdt'],
        tariffs: [tariff({ id: 1, code: 'LAB-001', description: 'Malaria RDT', fee: '0.00' })],
      }),
    );

    expect(result.tariff).toBeNull();
    expect(result.failure?.code).toBe('ZERO_PRICE');
    expect(result.failure?.message).toContain('LAB-001');
  });

  it('ignores a row whose code is not a string', () => {
    /*
     * Rows arrive from an untyped query. A code that is not a string cannot
     * equal anything, so it must be skipped rather than coerced — coercing
     * `123` would let a laboratory test be priced by a row number.
     */
    const result = resolveFromRows(
      input({
        codes: ['LAB-CBC'],
        tariffs: [
          { ...tariff({ id: 1, code: 'LAB-CBC' }), code: 123 as unknown as string },
          tariff({ id: 2, code: 'LAB-CBC', fee: '600.00' }),
        ],
      }),
    );

    expect(result.rule).toBe('CODE');
    expect(result.tariff?.id).toBe(2);
  });
});

/* ============================================================
   10. Money
   ============================================================ */

describe('fees that cannot be billed', () => {
  it('treats a non-numeric fee as unbillable rather than free', () => {
    const result = resolveFromRows(
      input({
        codes: ['LAB-CBC'],
        tariffs: [tariff({ id: 1, code: 'LAB-CBC', fee: 'not a number' })],
      }),
    );

    /* A NaN price must never reach an invoice as 0. */
    expect(result.tariff).toBeNull();
  });

  it('treats a negative linked price as unbillable', () => {
    const result = resolveFromRows(
      input({
        serviceId: 42,
        links: [link({ id: 100, serviceId: 42, tariffId: 1 })],
        tariffs: [tariff({ id: 1, code: 'LAB-CBC', fee: '-500.00' })],
      }),
    );

    expect(result.failure?.code).toBe('ZERO_PRICE');
  });

  it('accepts a fractional fee exactly as stored', () => {
    const result = resolveFromRows(
      input({ codes: ['LAB-CBC'], tariffs: [tariff({ id: 1, code: 'LAB-CBC', fee: '1250.75' })] }),
    );

    expect(result.tariff?.fee).toBe('1250.75');
  });
});
