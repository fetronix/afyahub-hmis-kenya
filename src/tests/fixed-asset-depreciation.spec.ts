/**
 * Fixed-asset depreciation — pure unit tests.
 *
 * These assert arithmetic and refusal rules only. No Kenyan tax rule is
 * encoded here; useful life is a facility decision.
 */

import { describe, expect, it } from 'vitest';

import {
  DepreciationError,
  monthlyDepreciation,
  monthsBetween,
  periodOf,
  totalPendingChargeCents,
} from '../assets/depreciation.ts';
import { formatCents } from '../billing/settlement.ts';

const base = {
  acquisitionCostCents: 12_000_000n,
  salvageValueCents: 1_200_000n,
  usefulLifeMonths: 12,
  accumulatedDepreciationCents: 0n,
};

describe('monthlyDepreciation', () => {
  it('spreads the depreciable amount evenly over the useful life', () => {
    const result = monthlyDepreciation(base);
    expect(result.chargeCents).toBe(900_000n);
    expect(result.accumulatedAfterCents).toBe(900_000n);
    expect(result.netBookValueAfterCents).toBe(11_100_000n);
    expect(result.fullyDepreciated).toBe(false);
  });

  it('rounds half up once per month and takes the remainder in the last month', () => {
    const inputs = { acquisitionCostCents: 10_000n, salvageValueCents: 0n, usefulLifeMonths: 3 };
    const first = monthlyDepreciation({ ...inputs, accumulatedDepreciationCents: 0n });
    expect(first.chargeCents).toBe(3_333n);
    const second = monthlyDepreciation({
      ...inputs,
      accumulatedDepreciationCents: first.accumulatedAfterCents,
    });
    const last = monthlyDepreciation({
      ...inputs,
      accumulatedDepreciationCents: second.accumulatedAfterCents,
    });
    // Rounding is spread across the life; every charge is within a cent of even
    // and the final month clears the balance exactly.
    expect(second.chargeCents + last.chargeCents).toBe(10_000n - first.chargeCents);
    expect(last.chargeCents).toBeGreaterThan(0n);
    expect(last.accumulatedAfterCents).toBe(10_000n);
    expect(last.netBookValueAfterCents).toBe(0n);
    expect(last.fullyDepreciated).toBe(true);
    expect(first.chargeCents + second.chargeCents + last.chargeCents).toBe(10_000n);
  });

  it('never depreciates below salvage value', () => {
    const result = monthlyDepreciation({
      ...base,
      accumulatedDepreciationCents: 10_800_000n,
    });
    expect(result.chargeCents).toBe(0n);
    expect(result.netBookValueAfterCents).toBe(1_200_000n);
    expect(result.fullyDepreciated).toBe(true);
  });

  it('caps a final charge at the remaining depreciable balance', () => {
    const result = monthlyDepreciation({
      ...base,
      accumulatedDepreciationCents: 10_700_000n,
    });
    expect(result.chargeCents).toBe(100_000n);
    expect(result.netBookValueAfterCents).toBe(1_200_000n);
    expect(result.fullyDepreciated).toBe(true);
  });

  it('refuses salvage above cost', () => {
    expect(() => monthlyDepreciation({ ...base, salvageValueCents: 12_000_001n })).toThrow(
      DepreciationError,
    );
  });

  it('refuses an accumulated balance beyond the depreciable amount', () => {
    expect(() =>
      monthlyDepreciation({ ...base, accumulatedDepreciationCents: 10_800_001n }),
    ).toThrow(DepreciationError);
  });

  it('refuses a non-positive or excessive useful life', () => {
    for (const life of [0, -1, 601, 1.5]) {
      expect(() => monthlyDepreciation({ ...base, usefulLifeMonths: life })).toThrow(
        DepreciationError,
      );
      expect(() => monthlyDepreciation({ ...base, usefulLifeMonths: life })).toThrow(
        /useful life/i,
      );
    }
  });

  it('refuses a negative cost', () => {
    expect(() => monthlyDepreciation({ ...base, acquisitionCostCents: -1n })).toThrow(
      DepreciationError,
    );
  });
});

describe('period helpers', () => {
  it('derives the accounting month from a date', () => {
    expect(periodOf('2026-11-09')).toBe('2026-11');
  });

  it('rejects anything that is not an ISO date', () => {
    expect(() => periodOf('09/11/2026')).toThrow(DepreciationError);
  });

  it('counts months inclusively across a year boundary', () => {
    expect(monthsBetween('2026-11', '2027-02')).toBe(4);
    expect(monthsBetween('2026-11', '2026-11')).toBe(1);
  });
});

describe('depreciation preview totals', () => {
  it('sums integer cents without inflating the total', () => {
    const rows = [
      { alreadyPosted: false, chargeCents: '133333' },
      { alreadyPosted: false, chargeCents: '1800000' },
    ];
    // 1,333.33 + 18,000.00 = 19,333.33, i.e. 1,933,333 cents.
    expect(totalPendingChargeCents(rows)).toBe(1_933_333);
    expect(formatCents(totalPendingChargeCents(rows))).toBe('19333.33');
  });

  it('excludes rows that were already posted', () => {
    const rows = [
      { alreadyPosted: true, chargeCents: '500000' },
      { alreadyPosted: false, chargeCents: '250000' },
    ];
    expect(totalPendingChargeCents(rows)).toBe(250_000);
  });

  it('returns zero for an empty preview', () => {
    expect(totalPendingChargeCents([])).toBe(0);
  });

  it('rejects non-integer cents so a KES amount cannot leak into the sum', () => {
    expect(() =>
      totalPendingChargeCents([{ alreadyPosted: false, chargeCents: '1333.33' }]),
    ).toThrow(DepreciationError);
  });
});
