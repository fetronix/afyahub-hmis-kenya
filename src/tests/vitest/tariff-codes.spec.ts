/**
 * Tariff code vocabulary — migrated from src/tests/tariff-matching.test.ts
 *
 * This is the first suite moved to Vitest, and it is a genuine migration
 * rather than a parallel copy: the assertions below are the same claims the
 * legacy file makes about `buildBillingKey`, `isValidBillingKey` and
 * `billingServiceKeys`, expressed with `expect` so failures report a diff.
 *
 * The legacy suite stays in `npm test` until every one of its assertions has
 * been carried across — a half-migrated suite that exists in both places
 * would double-count coverage and hide whatever the other half checks.
 *
 * `tariff-codes.ts` is deliberately import-free (no database, no env), which
 * is why it is a safe first move.
 */

import { describe, expect, it } from 'vitest';

import {
  BILLING_FAMILIES,
  billingServiceKeys,
  buildBillingKey,
  isValidBillingKey,
  normaliseBillingDetail,
  normaliseTariffCode,
} from '../../billing/tariff-codes.ts';

describe('normaliseTariffCode', () => {
  it('upper-cases and hyphenates free text', () => {
    expect(normaliseTariffCode('Wound dressing')).toBe('WOUND-DRESSING');
    expect(normaliseTariffCode('Chest X-ray')).toBe('CHEST-X-RAY');
  });

  it('collapses punctuation runs instead of emitting empty segments', () => {
    expect(normaliseTariffCode('Full Blood Count (CBC/FBC 5-Part Diff)')).toBe(
      'FULL-BLOOD-COUNT-CBC-FBC-5-PART-DIFF',
    );
  });

  it('trims leading and trailing separators', () => {
    expect(normaliseTariffCode('  -- Lab CBC --  ')).toBe('LAB-CBC');
  });

  it('returns an empty string for nothing, rather than the word "null"', () => {
    expect(normaliseTariffCode(null)).toBe('');
    expect(normaliseTariffCode(undefined)).toBe('');
    expect(normaliseTariffCode('   ')).toBe('');
  });
});

describe('billing keys', () => {
  it('accepts every published family on its own', () => {
    for (const family of BILLING_FAMILIES) {
      expect(isValidBillingKey(family.key)).toBe(true);
      expect(buildBillingKey(family.key)).toBe(family.key);
    }
  });

  it('appends a normalised detail after a colon', () => {
    expect(buildBillingKey('LABORATORY', 'Lab-CBC')).toBe('LABORATORY:LAB-CBC');
    expect(normaliseBillingDetail('Obstetric ultrasound')).toBe('OBSTETRIC-ULTRASOUND');
  });

  it('rejects a family the engine does not know', () => {
    expect(buildBillingKey('DENTISTRY')).toBeNull();
    expect(isValidBillingKey('DENTISTRY')).toBe(false);
  });

  it('rejects an empty or malformed key', () => {
    expect(isValidBillingKey('')).toBe(false);
    expect(isValidBillingKey(null)).toBe(false);
    expect(isValidBillingKey(':LAB-CBC')).toBe(false);
    expect(isValidBillingKey('LABORATORY:')).toBe(false);
    expect(isValidBillingKey('LABORATORY: lower-case')).toBe(false);
  });

  it('accepts a detail with the characters a code really uses', () => {
    expect(isValidBillingKey('LABORATORY:LAB-CBC')).toBe(true);
    expect(isValidBillingKey('RADIOLOGY:CHEST-X-RAY')).toBe(true);
    expect(isValidBillingKey('PROCEDURE:PROC/004')).toBe(true);
  });
});

describe('billingServiceKeys', () => {
  it('tries the most specific key first, then the family', () => {
    expect(billingServiceKeys('LABORATORY', ['LAB-CBC'])).toEqual([
      'LABORATORY:LAB-CBC',
      'LABORATORY',
    ]);
  });

  it('always ends with the bare family so a family-wide price still applies', () => {
    const keys = billingServiceKeys('RADIOLOGY', ['CHEST-X-RAY', 'CHEST']);

    expect(keys.at(-1)).toBe('RADIOLOGY');
    expect(keys).toEqual(['RADIOLOGY:CHEST-X-RAY', 'RADIOLOGY:CHEST', 'RADIOLOGY']);
  });

  it('de-duplicates and drops entries that had no detail to add', () => {
    expect(billingServiceKeys('PROCEDURE', [null, '', 'WOUND-DRESSING', 'WOUND-DRESSING'])).toEqual([
      'PROCEDURE:WOUND-DRESSING',
      'PROCEDURE',
    ]);
  });

  it('still produces the family when no detail is given', () => {
    expect(billingServiceKeys('CONSULTATION')).toEqual(['CONSULTATION']);
    expect(billingServiceKeys('CONSULTATION', [])).toEqual(['CONSULTATION']);
  });
});
