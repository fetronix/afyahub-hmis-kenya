import type { ProviderBoundary } from './contracts.ts';

/** Individual boundaries deliberately expose no operations before bank approval. */
export class KcbBuniAdapter implements ProviderBoundary {
  descriptor = {
    key: 'KCB_BUNI',
    implementedCapabilities: [],
    sandboxOnly: true,
    productionReady: false,
    note: 'KCB BUNI API contract and facility permissions not yet verified.',
  } as const;
}
export class NcbaAdapter implements ProviderBoundary {
  descriptor = {
    key: 'NCBA',
    implementedCapabilities: [],
    sandboxOnly: true,
    productionReady: false,
    note: 'NCBA API contract, authentication and sandbox access not yet verified.',
  } as const;
}
export class EquityAdapter implements ProviderBoundary {
  descriptor = {
    key: 'EQUITY',
    implementedCapabilities: [],
    sandboxOnly: true,
    productionReady: false,
    note: 'Equity API contract, authentication and sandbox access not yet verified.',
  } as const;
}
export class UnconfiguredProviderAdapter implements ProviderBoundary {
  descriptor = {
    key: 'UNCONFIGURED',
    implementedCapabilities: [],
    sandboxOnly: true,
    productionReady: false,
    note: 'No provider adapter has been implemented.',
  } as const;
}
