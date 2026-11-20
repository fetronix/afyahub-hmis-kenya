/**
 * Syrona Medical Center HMIS — fixed-asset depreciation, pure functions.
 *
 * Rules encoded here:
 *
 *  1. Money is integer cents. A monthly charge is rounded half-up once, and
 *     the final month is whatever remains, so the schedule never exceeds the
 *     depreciable amount and never leaves a stray cent.
 *  2. Depreciation stops at the salvage value. An asset whose net book value
 *     already equals salvage produces no charge.
 *  3. The charge starts in the acquisition month. A facility that wants a
 *     different convention must configure it explicitly rather than inheriting
 *     an undocumented rule from this file.
 *  4. Nothing is assumed about Kenyan tax depreciation: this is book
 *     depreciation from the facility's own useful life.
 */

export class DepreciationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DepreciationError';
  }
}

export interface DepreciationInput {
  acquisitionCostCents: bigint;
  salvageValueCents: bigint;
  usefulLifeMonths: number;
  accumulatedDepreciationCents: bigint;
}

export interface DepreciationResult {
  /** Charge for one month, capped by the remaining depreciable balance. */
  chargeCents: bigint;
  /** Accumulated depreciation after the charge. */
  accumulatedAfterCents: bigint;
  netBookValueAfterCents: bigint;
  /** True when this charge is the last one for the asset. */
  fullyDepreciated: boolean;
}

export function monthlyDepreciation(input: DepreciationInput): DepreciationResult {
  const { acquisitionCostCents, salvageValueCents, usefulLifeMonths } = input;
  const accumulated = input.accumulatedDepreciationCents;

  if (acquisitionCostCents < 0n)
    throw new DepreciationError('INVALID_COST', 'Acquisition cost cannot be negative.');
  if (salvageValueCents < 0n || salvageValueCents > acquisitionCostCents)
    throw new DepreciationError(
      'INVALID_SALVAGE',
      'Salvage value must be between zero and the acquisition cost.',
    );
  if (!Number.isInteger(usefulLifeMonths) || usefulLifeMonths < 1 || usefulLifeMonths > 600)
    throw new DepreciationError(
      'INVALID_LIFE',
      'Useful life must be a whole number of months between 1 and 600.',
    );
  if (accumulated < 0n || accumulated > acquisitionCostCents - salvageValueCents)
    throw new DepreciationError(
      'INVALID_ACCUMULATED',
      'Accumulated depreciation is outside the depreciable amount.',
    );

  const depreciable = acquisitionCostCents - salvageValueCents;
  const remaining = depreciable - accumulated;
  if (remaining <= 0n)
    return {
      chargeCents: 0n,
      accumulatedAfterCents: accumulated,
      netBookValueAfterCents: acquisitionCostCents - accumulated,
      fullyDepreciated: true,
    };

  const months = BigInt(usefulLifeMonths);
  /*
   * Spread the *remaining* depreciable balance over the *remaining* months.
   * Dividing the original cost by the original life on every call would push
   * rounding residue into a final one-cent charge; deriving elapsed months
   * from the accumulated balance keeps each charge even and clears the
   * balance exactly in the last month.
   */
  const elapsed = Number((accumulated * months + depreciable / 2n) / depreciable);
  const monthsLeft = BigInt(Math.max(1, usefulLifeMonths - elapsed));
  const scheduled = (remaining + monthsLeft / 2n) / monthsLeft;
  const charge = scheduled > remaining ? remaining : scheduled;
  const accumulatedAfter = accumulated + charge;

  return {
    chargeCents: charge,
    accumulatedAfterCents: accumulatedAfter,
    netBookValueAfterCents: acquisitionCostCents - accumulatedAfter,
    fullyDepreciated: accumulatedAfter >= depreciable,
  };
}

/** `YYYY-MM` → whether a date falls in that accounting month. */
export function periodOf(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate))
    throw new DepreciationError('INVALID_DATE', 'A date must be YYYY-MM-DD.');
  return isoDate.slice(0, 7);
}

/**
 * Months elapsed between two `YYYY-MM` periods, inclusive of both. Used only
 * to explain a schedule in the UI; the service derives charges from stored
 * movement rows, not from elapsed time, so a missed month never silently
 * compounds into a double charge.
 */
export function monthsBetween(fromPeriod: string, toPeriod: string): number {
  const parse = (period: string) => {
    const match = /^(\d{4})-(\d{2})$/.exec(period);
    if (!match) throw new DepreciationError('INVALID_PERIOD', 'A period must be YYYY-MM.');
    return Number(match[1]) * 12 + Number(match[2]);
  };
  return parse(toPeriod) - parse(fromPeriod) + 1;
}

/** One row of the depreciation preview, as the API serialises it. */
export type PreviewChargeRow = { alreadyPosted: boolean; chargeCents: string };

/**
 * Sum the charges a period will actually post.
 *
 * The API serialises integer cents as a string, so a caller that goes through
 * KES formatting first (cents → KES → cents) inflates the total by 100×. This
 * helper keeps the sum in cents and skips rows that are already posted.
 */
export function totalPendingChargeCents(rows: readonly PreviewChargeRow[]): number {
  return rows.reduce((sum, row) => {
    if (row.alreadyPosted) return sum;
    const cents = Number(row.chargeCents);
    if (!Number.isFinite(cents) || !Number.isInteger(cents))
      throw new DepreciationError('INVALID_CENTS', 'A preview charge must be integer cents.');
    return sum + cents;
  }, 0);
}

/* ============================================================
   COMMENCEMENT CONVENTIONS AND PERIOD CHARGES
   ============================================================ */

/**
 * How the month an asset enters service is treated.
 *
 * The choice is a facility policy, not a constant: an accountant who charges a
 * full month for an asset bought on the 28th and one who charges nothing for it
 * are both describing a real practice. The service reads the convention from
 * `fixed_asset_settings` (or the asset's own override) and records which one
 * produced each charge, so a schedule can always be explained.
 */
export type CommencementConvention = 'FULL_MONTH' | 'FOLLOWING_MONTH' | 'DAILY_PRORATA';

export const COMMENCEMENT_CONVENTIONS: readonly CommencementConvention[] = Object.freeze([
  'FULL_MONTH',
  'FOLLOWING_MONTH',
  'DAILY_PRORATA',
]);

export const COMMENCEMENT_LABELS: Readonly<Record<CommencementConvention, string>> = Object.freeze({
  FULL_MONTH: 'Full month of service (depreciate the month placed in service)',
  FOLLOWING_MONTH: 'Following month (depreciation starts the next calendar month)',
  DAILY_PRORATA: 'Daily pro-rata (charge the days actually in service)',
});

export function isCommencementConvention(value: unknown): value is CommencementConvention {
  return (
    typeof value === 'string' && (COMMENCEMENT_CONVENTIONS as readonly string[]).includes(value)
  );
}

export function normaliseConvention(
  value: unknown,
  fallback: CommencementConvention,
): CommencementConvention {
  return isCommencementConvention(value) ? value : fallback;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertIsoDate(value: string, label: string): string {
  if (!ISO_DATE.test(value))
    throw new DepreciationError('INVALID_DATE', `${label} must be a date in YYYY-MM-DD form.`);
  return value;
}

function assertPeriod(value: string): string {
  if (!PERIOD_PATTERN.test(value))
    throw new DepreciationError('INVALID_PERIOD', 'A period must be YYYY-MM.');
  return value;
}

/** Calendar days in the month a `YYYY-MM` period names. */
export function daysInPeriod(period: string): number {
  assertPeriod(period);
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Add calendar months to a `YYYY-MM` period without crossing into invalid dates. */
export function addPeriods(period: string, months: number): string {
  assertPeriod(period);
  const [year, month] = period.split('-').map(Number);
  const zeroBased = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(zeroBased / 12);
  const nextMonth = (zeroBased % 12) + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`;
}

/**
 * The date depreciation follows: the placed-in-service date when one is
 * recorded, otherwise the acquisition date. The caller reports which was used,
 * because "we depreciated from the invoice date" is a different statement from
 * "we depreciated from commissioning".
 */
export function depreciationBaseDate(
  acquisitionDate: string,
  placedInServiceDate?: string | null,
): { date: string; source: 'PLACED_IN_SERVICE' | 'ACQUISITION' } {
  assertIsoDate(acquisitionDate, 'Acquisition date');
  if (placedInServiceDate) {
    assertIsoDate(placedInServiceDate, 'Date placed in service');
    return { date: placedInServiceDate, source: 'PLACED_IN_SERVICE' };
  }
  return { date: acquisitionDate, source: 'ACQUISITION' };
}

/** The first period that receives a charge under a convention. */
export function firstChargePeriod(
  inServiceDate: string,
  convention: CommencementConvention,
): string {
  assertIsoDate(inServiceDate, 'Date placed in service');
  const period = inServiceDate.slice(0, 7);
  return convention === 'FOLLOWING_MONTH' ? addPeriods(period, 1) : period;
}

/**
 * Days in the period for which the asset was in service, and the length of the
 * period. Under `FULL_MONTH` the first period counts in full even when the asset
 * arrived on the last day; that is the convention, and the schedule says so.
 */
export function eligibleDays(
  period: string,
  inServiceDate: string,
  convention: CommencementConvention,
): { daysInService: number; periodDays: number; isFirstPeriod: boolean } {
  assertPeriod(period);
  const start = firstChargePeriod(inServiceDate, convention);
  const periodDays = daysInPeriod(period);
  if (period < start) return { daysInService: 0, periodDays, isFirstPeriod: false };
  const isFirstPeriod = period === start;
  if (!isFirstPeriod) return { daysInService: periodDays, periodDays, isFirstPeriod };
  if (convention !== 'DAILY_PRORATA')
    return { daysInService: periodDays, periodDays, isFirstPeriod };
  const dayOfMonth = Number(inServiceDate.slice(8, 10));
  return { daysInService: Math.max(0, periodDays - dayOfMonth + 1), periodDays, isFirstPeriod };
}

export interface PeriodDepreciationInput extends DepreciationInput {
  /** Accounting month, `YYYY-MM`. */
  period: string;
  /** Date the asset entered service (`YYYY-MM-DD`). */
  inServiceDate: string;
  convention: CommencementConvention;
}

export interface PeriodDepreciationResult extends DepreciationResult {
  daysInService: number;
  periodDays: number;
  isFirstPeriod: boolean;
  /** False when the period is before depreciation begins. */
  inService: boolean;
}

/**
 * The charge for one accounting period.
 *
 * Full-month and following-month charges come straight from the month
 * scheduler, which spreads the *remaining* balance over the *remaining* months
 * and therefore absorbs rounding and any impairment adjustment. Daily pro-rata
 * scales the first charge by the days actually in service; every later month
 * then spreads the remainder, so the asset still clears exactly by the end of
 * its life.
 */
export function periodDepreciation(input: PeriodDepreciationInput): PeriodDepreciationResult {
  const { daysInService, periodDays, isFirstPeriod } = eligibleDays(
    input.period,
    input.inServiceDate,
    input.convention,
  );
  if (daysInService === 0)
    return {
      chargeCents: 0n,
      accumulatedAfterCents: input.accumulatedDepreciationCents,
      netBookValueAfterCents: input.acquisitionCostCents - input.accumulatedDepreciationCents,
      fullyDepreciated:
        input.accumulatedDepreciationCents >= input.acquisitionCostCents - input.salvageValueCents,
      daysInService,
      periodDays,
      isFirstPeriod,
      inService: false,
    };

  const scheduled = monthlyDepreciation({
    acquisitionCostCents: input.acquisitionCostCents,
    salvageValueCents: input.salvageValueCents,
    usefulLifeMonths: input.usefulLifeMonths,
    accumulatedDepreciationCents: input.accumulatedDepreciationCents,
  });

  if (input.convention !== 'DAILY_PRORATA' || !isFirstPeriod || daysInService >= periodDays) {
    return { ...scheduled, daysInService, periodDays, isFirstPeriod, inService: true };
  }

  const remaining =
    input.acquisitionCostCents - input.salvageValueCents - input.accumulatedDepreciationCents;
  const days = BigInt(daysInService);
  const total = BigInt(periodDays);
  const prorated = (scheduled.chargeCents * days + total / 2n) / total;
  const charge = prorated > remaining ? remaining : prorated;
  const accumulatedAfter = input.accumulatedDepreciationCents + charge;
  return {
    chargeCents: charge,
    accumulatedAfterCents: accumulatedAfter,
    netBookValueAfterCents: input.acquisitionCostCents - accumulatedAfter,
    fullyDepreciated: accumulatedAfter >= input.acquisitionCostCents - input.salvageValueCents,
    daysInService,
    periodDays,
    isFirstPeriod,
    inService: true,
  };
}

/** Annual rate in basis points implied by a useful life, e.g. 120 months → 1000 bps. */
export function annualRateBpsForLife(usefulLifeMonths: number): number {
  if (!Number.isInteger(usefulLifeMonths) || usefulLifeMonths < 1 || usefulLifeMonths > 600)
    throw new DepreciationError('INVALID_LIFE', 'Useful life must be between 1 and 600 months.');
  return Math.round((12 * 10_000) / usefulLifeMonths);
}

/** Useful life implied by an annual rate in basis points, e.g. 1000 bps → 120 months. */
export function usefulLifeMonthsForRate(annualRateBps: number): number {
  if (!Number.isInteger(annualRateBps) || annualRateBps < 1 || annualRateBps > 10_000)
    throw new DepreciationError(
      'INVALID_RATE',
      'Annual rate must be between 1 and 10000 basis points.',
    );
  return Math.round((12 * 10_000) / annualRateBps);
}

export interface ScheduleRow {
  period: string;
  openingAccumulatedCents: bigint;
  chargeCents: bigint;
  closingAccumulatedCents: bigint;
  openingBookValueCents: bigint;
  closingBookValueCents: bigint;
  daysInService: number;
  periodDays: number;
  fullyDepreciated: boolean;
}

/**
 * A forward schedule, used by the preview, the reports and the tests. It applies
 * exactly the same period rule as posting, so a schedule is a statement about
 * what would be posted rather than a second, decorative calculation.
 */
export function projectSchedule(input: {
  acquisitionCostCents: bigint;
  salvageValueCents: bigint;
  usefulLifeMonths: number;
  accumulatedDepreciationCents?: bigint;
  inServiceDate: string;
  convention: CommencementConvention;
  fromPeriod: string;
  months: number;
}): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let accumulated = input.accumulatedDepreciationCents ?? 0n;
  for (let index = 0; index < input.months; index += 1) {
    const period = addPeriods(input.fromPeriod, index);
    const result = periodDepreciation({
      acquisitionCostCents: input.acquisitionCostCents,
      salvageValueCents: input.salvageValueCents,
      usefulLifeMonths: input.usefulLifeMonths,
      accumulatedDepreciationCents: accumulated,
      period,
      inServiceDate: input.inServiceDate,
      convention: input.convention,
    });
    const opening = accumulated;
    accumulated = result.accumulatedAfterCents;
    rows.push({
      period,
      openingAccumulatedCents: opening,
      chargeCents: result.chargeCents,
      closingAccumulatedCents: accumulated,
      openingBookValueCents: input.acquisitionCostCents - opening,
      closingBookValueCents: result.netBookValueAfterCents,
      daysInService: result.daysInService,
      periodDays: result.periodDays,
      fullyDepreciated: result.fullyDepreciated,
    });
  }
  return rows;
}

/** The financial year that contains a period, given the facility's start month. */
export function financialYearOf(
  period: string,
  startMonth: number,
): { label: string; startPeriod: string; endPeriod: string } {
  assertPeriod(period);
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12)
    throw new DepreciationError('INVALID_MONTH', 'A financial-year start month must be 1–12.');
  const [year, month] = period.split('-').map(Number);
  const startYear = month >= startMonth ? year : year - 1;
  const startPeriod = `${String(startYear).padStart(4, '0')}-${String(startMonth).padStart(2, '0')}`;
  return {
    label: `FY ${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`,
    startPeriod,
    endPeriod: addPeriods(startPeriod, 11),
  };
}
