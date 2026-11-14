import { parseMoneyToCents } from '../billing/settlement.ts';

/** Shared advisory and server-side selection; the server must hold ward/bed locks. */
type BedPrice = {
  dailyCharge: string | null;
  dailyChargeReviewRequired: boolean;
  priceRevision: number;
};
type WardPrice = {
  dailyRate: string | null;
  dailyRateConfigured?: boolean;
  dailyRateRevision?: number;
};

export type SelectedBedRate =
  | { rate: string; source: 'BED_OVERRIDE' | 'WARD_DEFAULT'; revision: number; issue: null }
  | { rate: null; source: null; revision: null; issue: { code: string; message: string } };

const unresolved = (message: string): SelectedBedRate => ({
  rate: null,
  source: null,
  revision: null,
  issue: { code: 'BED_RATE_REVIEW_REQUIRED', message },
});
const validRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/**
 * A legacy bed default needing confirmation is not silently replaced by a ward
 * rate. A present but invalid override is also unresolved, not a free service.
 * Only an absent override allows a confirmed ward default to apply.
 */
export function selectBedRate(bed: BedPrice, ward: WardPrice): SelectedBedRate {
  if (bed.dailyChargeReviewRequired)
    return unresolved('The bed override needs explicit price confirmation before billing.');
  if (bed.dailyCharge !== null && bed.dailyCharge !== undefined) {
    if ((parseMoneyToCents(bed.dailyCharge) ?? 0) <= 0 || !validRevision(bed.priceRevision))
      return unresolved('The bed override is invalid; an authorized price review is required.');
    return {
      rate: bed.dailyCharge,
      source: 'BED_OVERRIDE',
      revision: bed.priceRevision,
      issue: null,
    };
  }
  if (
    ward.dailyRateConfigured === true &&
    (parseMoneyToCents(ward.dailyRate) ?? 0) > 0 &&
    validRevision(ward.dailyRateRevision)
  )
    return {
      rate: ward.dailyRate!,
      source: 'WARD_DEFAULT',
      revision: ward.dailyRateRevision,
      issue: null,
    };
  return unresolved(
    'Neither a positive, confirmed bed override nor a confirmed ward default is configured.',
  );
}
