/**
 * JaliCare HMIS — fixed-asset depreciation, pure functions.
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
