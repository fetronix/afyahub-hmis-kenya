import { describe, expect, it } from 'vitest';
import { selectBedRate } from '../inpatient/bed-rate.ts';

const ward = { dailyRate: '800.00', dailyRateConfigured: true, dailyRateRevision: 3 };
const bed = { dailyCharge: null, dailyChargeReviewRequired: false, priceRevision: 4 };

describe('inpatient bed override and ward default', () => {
  it('uses the bed override ahead of a confirmed ward default', () => {
    expect(selectBedRate({ ...bed, dailyCharge: '1250.00' }, ward)).toEqual({
      rate: '1250.00',
      source: 'BED_OVERRIDE',
      revision: 4,
      issue: null,
    });
  });

  it('uses the confirmed ward default only when the override is absent', () => {
    expect(selectBedRate(bed, ward)).toEqual({
      rate: '800.00',
      source: 'WARD_DEFAULT',
      revision: 3,
      issue: null,
    });
  });

  it.each([
    ['unconfirmed legacy ward', bed, { ...ward, dailyRateConfigured: false }],
    ['missing ward', bed, { dailyRate: null, dailyRateConfigured: false, dailyRateRevision: 1 }],
    ['zero ward', bed, { ...ward, dailyRate: '0.00' }],
    ['unknown ward revision', bed, { ...ward, dailyRateRevision: undefined }],
    [
      'unconfirmed legacy bed',
      { ...bed, dailyCharge: '1500.00', dailyChargeReviewRequired: true },
      ward,
    ],
    ['zero bed override', { ...bed, dailyCharge: '0.00' }, ward],
    ['invalid bed revision', { ...bed, dailyCharge: '900.00', priceRevision: 0 }, ward],
  ])(
    'flags %s instead of silently falling back or charging zero',
    (_name, candidateBed, candidateWard) => {
      expect(selectBedRate(candidateBed, candidateWard)).toMatchObject({
        rate: null,
        source: null,
        revision: null,
        issue: { code: 'BED_RATE_REVIEW_REQUIRED' },
      });
    },
  );
});
