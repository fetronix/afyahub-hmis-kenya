import { describe, expect, it } from 'vitest';
import {
  queryState,
  requestStates,
  validRequestTransition,
  type RequestState,
} from '../../payment-hub/payment-lifecycle.ts';

describe('payment request lifecycle (provider status is not settlement)', () => {
  it('admits only the explicit transitions, including terminal review on conflict', () => {
    const expected: Record<RequestState, readonly RequestState[]> = {
      INITIATING: ['INITIATING', 'PENDING', 'UNKNOWN'],
      PENDING: ['PENDING', 'PROVIDER_CONFIRMED', 'FAILED', 'REVIEW_REQUIRED'],
      UNKNOWN: ['UNKNOWN', 'PROVIDER_CONFIRMED', 'FAILED', 'REVIEW_REQUIRED'],
      FAILED: ['FAILED', 'REVIEW_REQUIRED'],
      PROVIDER_CONFIRMED: ['PROVIDER_CONFIRMED', 'REVIEW_REQUIRED'],
      REVIEW_REQUIRED: ['REVIEW_REQUIRED'],
    };
    for (const from of requestStates)
      for (const to of requestStates)
        expect(validRequestTransition(from, to), `${from} -> ${to}`).toBe(
          expected[from].includes(to),
        );
  });

  it('keeps reported success and cancellation distinct and preserves terminal evidence', () => {
    expect(
      queryState(
        { status: 'PENDING', resultCode: null },
        { outcome: 'CONFIRMED', resultCode: null },
      ).status,
    ).toBe('REVIEW_REQUIRED');
    expect(
      queryState({ status: 'PENDING', resultCode: null }, { outcome: 'CANCELLED', resultCode: '0' })
        .status,
    ).toBe('REVIEW_REQUIRED');
    expect(
      queryState(
        { status: 'PENDING', resultCode: null },
        { outcome: 'CONFIRMED', resultCode: '0' },
      ),
    ).toEqual({ status: 'PROVIDER_CONFIRMED', resultCode: '0' });
    expect(
      queryState(
        { status: 'PENDING', resultCode: null },
        { outcome: 'CANCELLED', resultCode: '1032' },
      ),
    ).toEqual({ status: 'FAILED', resultCode: '1032' });
    expect(
      queryState(
        { status: 'FAILED', resultCode: '1032' },
        { outcome: 'UNKNOWN', resultCode: '4999' },
      ),
    ).toEqual({ status: 'FAILED', resultCode: '1032' });
    expect(
      queryState(
        { status: 'PROVIDER_CONFIRMED', resultCode: '0' },
        { outcome: 'UNKNOWN', resultCode: null },
      ),
    ).toEqual({ status: 'PROVIDER_CONFIRMED', resultCode: '0' });
    expect(
      queryState(
        { status: 'FAILED', resultCode: '1032' },
        { outcome: 'CONFIRMED', resultCode: '0' },
      ).status,
    ).toBe('REVIEW_REQUIRED');
    expect(
      queryState(
        { status: 'PROVIDER_CONFIRMED', resultCode: '0' },
        { outcome: 'CANCELLED', resultCode: '1032' },
      ).status,
    ).toBe('REVIEW_REQUIRED');
    expect(
      queryState(
        { status: 'PROVIDER_CONFIRMED', resultCode: null },
        { outcome: 'UNKNOWN', resultCode: null },
      ).status,
    ).toBe('REVIEW_REQUIRED');
    expect(() =>
      queryState(
        { status: 'INITIATING', resultCode: null },
        { outcome: 'CONFIRMED', resultCode: '0' },
      ),
    ).toThrow();
  });
});
