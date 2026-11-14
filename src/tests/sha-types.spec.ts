import { describe, expect, expectTypeOf, it } from 'vitest';
import * as publicAdapter from '../integrations/sha/sha.adapter.ts';
import type * as contracts from '../integrations/sha/sha.types.ts';
import type * as gatewayContracts from '../integrations/sha/sha.gateway-types.ts';
import type * as publicContracts from '../integrations/sha/sha.adapter.ts';

describe('public SHA contracts', () => {
  it('keeps the runtime exports and type contracts at the original path', () => {
    expect(Object.keys(publicAdapter).sort()).toEqual([
      'ShaGatewayAdapter',
      'defaultShaGatewayAdapter',
      'interpretShaEligibilityPayload',
      'mapToHieIdentificationType',
    ]);
    expectTypeOf<publicContracts.EligibilityGatewayRequest>().toEqualTypeOf<contracts.EligibilityGatewayRequest>();
    expectTypeOf<publicContracts.EligibilityGatewayResult>().toEqualTypeOf<contracts.EligibilityGatewayResult>();
    expectTypeOf<publicContracts.HieBenefitsLookupResult>().toEqualTypeOf<contracts.HieBenefitsLookupResult>();
    expectTypeOf<publicContracts.HieUtilizationLookupResult>().toEqualTypeOf<contracts.HieUtilizationLookupResult>();
    expectTypeOf<publicContracts.PayerGatewayAdapter>().toEqualTypeOf<gatewayContracts.PayerGatewayAdapter>();
    expectTypeOf<publicContracts.ShaGatewayAdapterOptions>().toEqualTypeOf<gatewayContracts.ShaGatewayAdapterOptions>();
    expect(publicAdapter.defaultShaGatewayAdapter).toBeInstanceOf(publicAdapter.ShaGatewayAdapter);
  });
});
