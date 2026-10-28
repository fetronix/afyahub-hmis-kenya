import type { ProviderBoundary } from './contracts.ts';
import {
  KcbBuniAdapter,
  NcbaAdapter,
  EquityAdapter,
  UnconfiguredProviderAdapter,
} from './banks.ts';
import { DarajaSandboxAdapter, validateDarajaCredentials } from './daraja.ts';

export function providerBoundary(
  key: string,
  credentials?: Record<string, string>,
): ProviderBoundary {
  switch (key) {
    case 'KCB_BUNI':
      return new KcbBuniAdapter();
    case 'NCBA':
      return new NcbaAdapter();
    case 'EQUITY':
      return new EquityAdapter();
    case 'MPESA_DARAJA':
      // Descriptor discovery does not require or inspect credentials.
      if (!credentials)
        return {
          descriptor: {
            key,
            implementedCapabilities: [
              'PAYMENT_COLLECTION',
              'PAYMENT_STATUS',
              'NOTIFICATIONS',
              'HEALTH',
            ],
            sandboxOnly: true,
            productionReady: false,
            note: 'Sandbox reference implementation; callback is an unverified hint. Production use is blocked.',
          },
          notifications: { authenticity: 'UNVERIFIED_HINT' },
        };
      return new DarajaSandboxAdapter(validateDarajaCredentials(credentials));
    default:
      return new UnconfiguredProviderAdapter();
  }
}
