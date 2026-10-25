/**
 * Tariff matching — execute the pricing rule, not just read it
 *
 * `tariff-matching.ts` decides which price list row answers a charge. It is
 * pure: rows in, one outcome out. That makes it the highest-value module to
 * exercise directly, because a defect here bills a patient the wrong amount
 * without raising anything.
 *
 * The legacy suite asserts that this file *contains* the right code. This one
 * runs it.
 *
 * The three rules are ordered and mutually exclusive — a link beats a code,
 * a code beats a description — and each test below pins one rung, including
 * the case that matters most: an inactive link must not silently fall
 * through to a different price.
 */

import { describe, expect, it } from 'vitest';

import {
  codesForFamily,
  describeMatch,
  matchTariff,
  type TariffLike,
} from '../../billing/tariff-matching.ts';

function row(overrides: Partial<TariffLike> & { id: number; code: string }): TariffLike {
  return {
    description: null,
    department: 'laboratory',
    fee: '0',
    billingKey: null,
    isActive: true,
    autoBill: true,
    effectiveFrom: null,
    effectiveTo: null,
    ...overrides,
  } as TariffLike;
}

describe('matchTariff — the ladder', () => {
  it('prefers an explicit link over an exact code', () => {
    const linked = row({ id: 1, code: 'LAB-LINKED', billingKey: 'LABORATORY:LAB-CBC', fee: '480' });
    const byCode = row({ id: 2, code: 'LAB-CBC', fee: '500' });

    const outcome = matchTariff({
      rows: [byCode, linked],
      codes: ['LAB-CBC'],
      serviceKeys: ['LABORATORY:LAB-CBC'],
      family: 'LABORATORY',
    });

    expect(outcome.rule).toBe('LINK');
    expect(outcome.tariff?.id).toBe(1);
    expect(outcome.tariff?.fee).toBe('480');
  });

  it('falls back to an exact code when no link applies', () => {
    const outcome = matchTariff({
      rows: [row({ id: 2, code: 'LAB-CBC', fee: '500' })],
      codes: ['LAB-CBC'],
      serviceKeys: ['LABORATORY:LAB-CBC'],
      family: 'LABORATORY',
    });

    expect(outcome.rule).toBe('CODE');
    expect(outcome.tariff?.fee).toBe('500');
  });

  it('is case- and whitespace-insensitive when comparing codes', () => {
    const outcome = matchTariff({
      rows: [row({ id: 3, code: ' lab-cbc ', fee: '500' })],
      codes: ['LAB-CBC'],
    });

    expect(outcome.rule).toBe('CODE');
    expect(outcome.tariff?.id).toBe(3);
  });

  it('matches the facility description only inside the right department', () => {
    const lab = row({
      id: 4,
      code: 'LAB-001',
      description: 'Full blood count',
      department: 'laboratory',
      fee: '500',
    });

    const matched = matchTariff({
      rows: [lab],
      codes: [],
      family: 'LABORATORY',
      phrases: ['Full blood count'],
    });

    expect(matched.rule).toBe('CATALOGUE');
    expect(matched.tariff?.id).toBe(4);

    /* The same description in another department must not answer a lab charge. */
    const elsewhere = matchTariff({
      rows: [{ ...lab, department: 'pharmacy' } as TariffLike],
      codes: [],
      family: 'LABORATORY',
      phrases: ['Full blood count'],
    });

    expect(elsewhere.tariff).toBeNull();
  });

  it('returns no tariff rather than guessing when nothing matches', () => {
    const outcome = matchTariff({
      rows: [row({ id: 5, code: 'RAD-CHEST', department: 'radiology' })],
      codes: ['LAB-CBC'],
      family: 'LABORATORY',
      phrases: [],
    });

    expect(outcome.tariff).toBeNull();
    expect(outcome.rule).toBeNull();
    expect(outcome.triedCodes).toContain('LAB-CBC');
  });

  it('matches an inactive row it is handed — the caller owns that filter', () => {
    /*
     * Recorded deliberately, because it is not what a reader expects.
     *
     * `matchTariff` does not filter `isActive` on the code rung. The
     * guarantee comes from the query that loads the rows
     * (`loadTariffs` in billing.service.ts filters `is_active = true`), so
     * the invariant is real but it lives one layer up.
     *
     * This test exists so that if the query filter is ever removed, the
     * gap is visible here rather than only in production. It asserts the
     * current behaviour and says where the protection is.
     */
    const outcome = matchTariff({
      rows: [row({ id: 6, code: 'LAB-CBC', isActive: false })],
      codes: ['LAB-CBC'],
      family: 'LABORATORY',
    });

    expect(outcome.rule).toBe('CODE');
  });

  it('never matches a link on an inactive row', () => {
    const outcome = matchTariff({
      rows: [
        row({ id: 7, code: 'LAB-A', billingKey: 'LABORATORY:LAB-CBC', isActive: false }),
        row({ id: 8, code: 'OTHER', department: 'radiology' }),
      ],
      codes: [],
      serviceKeys: ['LABORATORY:LAB-CBC'],
      family: 'LABORATORY',
    });

    expect(outcome.tariff).toBeNull();
  });

  it('reports what it tried, so a failure can be explained', () => {
    const outcome = matchTariff({
      rows: [],
      codes: ['LAB-CBC', 'CBC'],
      serviceKeys: ['LABORATORY:LAB-CBC'],
      family: 'LABORATORY',
      phrases: ['Full blood count'],
    });

    expect(outcome.triedCodes).toEqual(['LAB-CBC', 'CBC']);
    expect(outcome.triedPhrases).toEqual(['Full blood count']);
  });
});

describe('codesForFamily', () => {
  it('puts the catalogue code before the name it was derived from', () => {
    const codes = codesForFamily({
      family: 'LABORATORY',
      code: 'LAB-CBC',
      name: 'Full blood count',
    });

    expect(codes[0]).toBe('LAB-CBC');
    expect(codes).toContain('LAB-GENERAL');
  });

  it('offers ward-specific bed rates before the generic day rate', () => {
    const codes = codesForFamily({ family: 'BED_DAY', wardCode: 'icu' });

    expect(codes.slice(0, 2)).toEqual(['BED-ICU', 'WARD-ICU']);
    expect(codes).toContain('BED-DAY');
  });

  it('gives a consultation its encounter type first', () => {
    const codes = codesForFamily({ family: 'CONSULTATION', encounterType: 'Follow-up' });

    expect(codes[0]).toBe('CONSULT-FOLLOW-UP');
    expect(codes).toContain('OPD-CONSULT');
  });
});

describe('describeMatch', () => {
  it('explains a link, a code match and a miss differently', () => {
    const target = row({ id: 9, code: 'LAB-CBC', billingKey: 'LABORATORY:LAB-CBC' });

    expect(
      describeMatch({ tariff: target, rule: 'LINK', triedCodes: [], triedPhrases: [] }),
    ).toMatch(/linked/i);

    expect(
      describeMatch({ tariff: target, rule: 'CODE', triedCodes: [], triedPhrases: [] }),
    ).toMatch(/LAB-CBC/);

    expect(
      describeMatch({ tariff: null, rule: null, triedCodes: ['X'], triedPhrases: [] }),
    ).toBeTruthy();
  });
});
