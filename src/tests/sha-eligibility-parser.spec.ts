import { interpretShaEligibilityPayload as extractedParser } from '../integrations/sha/sha.eligibility-parser.ts';
import { describe, expect, it } from 'vitest';
import { interpretShaEligibilityPayload } from '../integrations/sha/sha.adapter.ts';

describe('eligibility payload interpretation (synthetic)', () => {
  it.each([
    [200, { eligible: true }, 'Eligible', 'CONFIRMED_ELIGIBLE'],
    [200, { eligible: false }, 'Ineligible', 'CONFIRMED_INELIGIBLE'],
    [200, { status: 'PENDING' }, 'Pending', 'CONFIRMED_PENDING'],
    [200, { status: 'IDENTITY_CONFLICT' }, 'Manual review required', 'MANUAL_REVIEW'],
    [200, { eligible: true, isAlive: false }, 'Ineligible', 'CONFIRMED_DECEASED'],
    [200, {}, 'Unable to verify', 'UNPARSEABLE_RESPONSE'],
    [503, { eligible: true }, 'Unable to verify', 'UPSTREAM_ERROR'],
  ] as const)('classifies HTTP %s without guessing', (status, body, outcome, classification) => {
    expect(interpretShaEligibilityPayload(status, body)).toMatchObject({
      outcome,
      responseClassification: classification,
    });
  });
  it('re-exports the same parser from the original public path', () => {
    expect(interpretShaEligibilityPayload).toBe(extractedParser);
  });
});
