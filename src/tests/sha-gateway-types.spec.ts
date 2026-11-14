import { describe, expectTypeOf, it } from 'vitest';
import type {
  BundleGatewayRequest,
  BundleGatewayResult,
  ClaimStatusGatewayResult,
  PayerGatewayAdapter,
  ShaGatewayAdapterOptions,
} from '../integrations/sha/sha.gateway-types.ts';
import type * as Public from '../integrations/sha/sha.adapter.ts';

describe('gateway type contracts', () => {
  it('keeps bundle, status, options and adapter types available from the public facade', () => {
    expectTypeOf<Public.BundleGatewayRequest>().toEqualTypeOf<BundleGatewayRequest>();
    expectTypeOf<Public.BundleGatewayResult>().toEqualTypeOf<BundleGatewayResult>();
    expectTypeOf<Public.ClaimStatusGatewayResult>().toEqualTypeOf<ClaimStatusGatewayResult>();
    expectTypeOf<Public.PayerGatewayAdapter>().toEqualTypeOf<PayerGatewayAdapter>();
    expectTypeOf<Public.ShaGatewayAdapterOptions>().toEqualTypeOf<ShaGatewayAdapterOptions>();
  });
});
