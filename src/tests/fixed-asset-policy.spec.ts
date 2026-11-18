/**
 * Depreciation policy — commencement conventions, pro-rata and life-cycle edges.
 *
 * Every expectation below is written from the arithmetic in the requirement,
 * not from the implementation: KES 1,200,000 over 10 years is KES 10,000 a
 * month, and the only question a convention answers is which months receive it.
 */

import { describe, expect, it } from 'vitest';

import {
  addPeriods,
  annualRateBpsForLife,
  depreciationBaseDate,
  daysInPeriod,
  eligibleDays,
  financialYearOf,
  firstChargePeriod,
  periodDepreciation,
  projectSchedule,
  usefulLifeMonthsForRate,
} from '../assets/depreciation.ts';

const KES = (cents: bigint | number) => BigInt(cents) * 100n;

/** KES 1,200,000, no residual, 10-year life — the requirement's worked example. */
const base = {
  acquisitionCostCents: 1_200_000n * 100n,
  salvageValueCents: 0n,
  usefulLifeMonths: 120,
};

const charge = (args: {
  period: string;
  inServiceDate: string;
  convention: 'FULL_MONTH' | 'FOLLOWING_MONTH' | 'DAILY_PRORATA';
  accumulated?: bigint;
  cost?: bigint;
  salvage?: bigint;
}) =>
  periodDepreciation({
    acquisitionCostCents: args.cost ?? base.acquisitionCostCents,
    salvageValueCents: args.salvage ?? base.salvageValueCents,
    usefulLifeMonths: 120,
    accumulatedDepreciationCents: args.accumulated ?? 0n,
    period: args.period,
    inServiceDate: args.inServiceDate,
    convention: args.convention,
  });

describe('depreciation convention: full month of service', () => {
  it('charges KES 10,000 in the month the asset is placed in service', () => {
    const november = charge({
      period: '2026-11',
      inServiceDate: '2026-11-01',
      convention: 'FULL_MONTH',
    });
    expect(november.chargeCents).toBe(KES(10_000));
    expect(november.inService).toBe(true);
    expect(november.daysInService).toBe(30);
  });

  it('charges the following month too, so November and December both receive 10,000', () => {
    const december = charge({
      period: '2026-12',
      inServiceDate: '2026-11-01',
      convention: 'FULL_MONTH',
      accumulated: KES(10_000),
    });
    expect(december.chargeCents).toBe(KES(10_000));
  });

  it('charges a full month even when the asset arrives on the last day', () => {
    const november = charge({
      period: '2026-11',
      inServiceDate: '2026-11-30',
      convention: 'FULL_MONTH',
    });
    expect(november.chargeCents).toBe(KES(10_000));
  });

  it('charges nothing before the asset is in service', () => {
    const october = charge({
      period: '2026-10',
      inServiceDate: '2026-11-01',
      convention: 'FULL_MONTH',
    });
    expect(october.chargeCents).toBe(0n);
    expect(october.inService).toBe(false);
  });
});

describe('depreciation convention: following month', () => {
  it('charges nothing in November and 10,000 in December', () => {
    const november = charge({
      period: '2026-11',
      inServiceDate: '2026-11-01',
      convention: 'FOLLOWING_MONTH',
    });
    expect(november.chargeCents).toBe(0n);
    expect(november.inService).toBe(false);

    const december = charge({
      period: '2026-12',
      inServiceDate: '2026-11-01',
      convention: 'FOLLOWING_MONTH',
    });
    expect(december.chargeCents).toBe(KES(10_000));
  });

  it('starts in January when the asset is placed in service in December', () => {
    expect(firstChargePeriod('2026-12-15', 'FOLLOWING_MONTH')).toBe('2027-01');
  });
});

describe('depreciation convention: daily pro-rata', () => {
  it('charges 21 of 30 days for an asset placed in service on 10 November', () => {
    const november = charge({
      period: '2026-11',
      inServiceDate: '2026-11-10',
      convention: 'DAILY_PRORATA',
    });
    // 10,000 × 21/30 = 7,000
    expect(november.chargeCents).toBe(KES(7_000));
    expect(november.daysInService).toBe(21);
    expect(november.periodDays).toBe(30);
  });

  it('charges a full month from the second month onward', () => {
    const december = charge({
      period: '2026-12',
      inServiceDate: '2026-11-10',
      convention: 'DAILY_PRORATA',
      accumulated: KES(7_000),
    });
    // Remaining 1,193,000 over 119 months = 10,025.21 → 10,025.21 rounds to 10,025.21 cents-exact
    expect(december.chargeCents).toBe(1_002_521n);
    expect(december.daysInService).toBe(31);
  });

  it('counts 30 days in June and 28 in February', () => {
    expect(eligibleDays('2026-06', '2026-06-01', 'DAILY_PRORATA').periodDays).toBe(30);
    expect(eligibleDays('2026-02', '2026-02-01', 'DAILY_PRORATA').periodDays).toBe(28);
    expect(eligibleDays('2028-02', '2028-02-01', 'DAILY_PRORATA').periodDays).toBe(29);
  });

  it('charges one day when the asset arrives on the last day of the month', () => {
    const november = charge({
      period: '2026-11',
      inServiceDate: '2026-11-30',
      convention: 'DAILY_PRORATA',
    });
    // 10,000 × 1/30 = 333.33 → 333.33 in cents
    expect(november.chargeCents).toBe(33_333n);
    expect(november.daysInService).toBe(1);
  });
});

describe('depreciation arithmetic and the residual floor', () => {
  it('spreads a residual-value asset over the depreciable base only', () => {
    const cost = KES(1_200_000);
    const salvage = KES(200_000);
    const november = periodDepreciation({
      acquisitionCostCents: cost,
      salvageValueCents: salvage,
      usefulLifeMonths: 120,
      accumulatedDepreciationCents: 0n,
      period: '2026-11',
      inServiceDate: '2026-11-01',
      convention: 'FULL_MONTH',
    });
    // (1,200,000 - 200,000) / 120 = 8,333.33
    expect(november.chargeCents).toBe(833_333n);
    expect(november.netBookValueAfterCents).toBe(cost - 833_333n);
  });

  it('clears the depreciable base exactly by the end of the useful life', () => {
    const schedule = projectSchedule({
      ...base,
      inServiceDate: '2026-11-01',
      convention: 'FULL_MONTH',
      fromPeriod: '2026-11',
      months: 120,
    });
    const total = schedule.reduce((sum, row) => sum + row.chargeCents, 0n);
    expect(total).toBe(base.acquisitionCostCents);
    expect(schedule.at(-1)!.closingAccumulatedCents).toBe(base.acquisitionCostCents);
    expect(schedule.at(-1)!.closingBookValueCents).toBe(0n);
  });

  it('clears the depreciable base exactly under daily pro-rata too', () => {
    const schedule = projectSchedule({
      ...base,
      inServiceDate: '2026-11-10',
      convention: 'DAILY_PRORATA',
      fromPeriod: '2026-11',
      months: 120,
    });
    const total = schedule.reduce((sum, row) => sum + row.chargeCents, 0n);
    expect(total).toBe(base.acquisitionCostCents);
  });

  it('never depreciates below the residual value', () => {
    const cost = KES(1_200_000);
    const salvage = KES(120_000);
    const nearEnd = cost - salvage - 1n; // one cent of depreciable base left
    const last = periodDepreciation({
      acquisitionCostCents: cost,
      salvageValueCents: salvage,
      usefulLifeMonths: 120,
      accumulatedDepreciationCents: nearEnd,
      period: '2036-10',
      inServiceDate: '2026-11-01',
      convention: 'FULL_MONTH',
    });
    expect(last.chargeCents).toBe(1n);
    expect(last.netBookValueAfterCents).toBe(salvage);
    expect(last.fullyDepreciated).toBe(true);
  });

  it('charges nothing once the asset is fully depreciated', () => {
    const fully = periodDepreciation({
      acquisitionCostCents: base.acquisitionCostCents,
      salvageValueCents: 0n,
      usefulLifeMonths: 120,
      accumulatedDepreciationCents: base.acquisitionCostCents,
      period: '2036-11',
      inServiceDate: '2026-11-01',
      convention: 'FULL_MONTH',
    });
    expect(fully.chargeCents).toBe(0n);
    expect(fully.fullyDepreciated).toBe(true);
  });

  it('re-spreads the remaining base after an impairment-style basis reduction', () => {
    // An impairment cut the basis to 600,000 with 500,000 already charged, so
    // 100,000 remains over the 20 months left of the life: 5,000 a month.
    const charge = periodDepreciation({
      acquisitionCostCents: KES(600_000),
      salvageValueCents: 0n,
      usefulLifeMonths: 120,
      accumulatedDepreciationCents: KES(500_000),
      period: '2027-06',
      inServiceDate: '2026-11-01',
      convention: 'FULL_MONTH',
    });
    expect(charge.chargeCents).toBe(KES(5_000));
    expect(charge.netBookValueAfterCents).toBe(KES(95_000));
  });

  it('caps the last charge at the remaining base rather than overshooting it', () => {
    const last = periodDepreciation({
      acquisitionCostCents: KES(600_000),
      salvageValueCents: 0n,
      usefulLifeMonths: 120,
      accumulatedDepreciationCents: KES(600_000) - 10n,
      period: '2027-06',
      inServiceDate: '2026-11-01',
      convention: 'FULL_MONTH',
    });
    expect(last.chargeCents).toBe(10n);
    expect(last.netBookValueAfterCents).toBe(0n);
  });
});

describe('depreciation timing helpers', () => {
  it('prefers the placed-in-service date over the acquisition date', () => {
    expect(depreciationBaseDate('2026-10-20', '2026-11-01')).toEqual({
      date: '2026-11-01',
      source: 'PLACED_IN_SERVICE',
    });
    expect(depreciationBaseDate('2026-10-20')).toEqual({
      date: '2026-10-20',
      source: 'ACQUISITION',
    });
  });

  it('maps a 10-year life to 10% and back without drift', () => {
    expect(annualRateBpsForLife(120)).toBe(1000);
    expect(usefulLifeMonthsForRate(1000)).toBe(120);
    expect(annualRateBpsForLife(60)).toBe(2000);
  });

  it('adds months across a year boundary', () => {
    expect(addPeriods('2026-11', 2)).toBe('2027-01');
    expect(addPeriods('2026-01', -1)).toBe('2025-12');
    expect(daysInPeriod('2028-02')).toBe(29);
  });

  it('derives the Kenyan financial year that contains a period', () => {
    expect(financialYearOf('2026-11', 7)).toEqual({
      label: 'FY 2026/27',
      startPeriod: '2026-07',
      endPeriod: '2027-06',
    });
    expect(financialYearOf('2026-03', 7).label).toBe('FY 2025/26');
  });
});
