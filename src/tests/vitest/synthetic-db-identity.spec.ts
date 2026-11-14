import { describe, expect, it } from 'vitest';
import {
  assertSyntheticDatabaseIdentity,
  assertSyntheticTarget,
  type SyntheticDatabaseIdentity,
  type SyntheticDatabaseTarget,
} from './support/synthetic-db-identity.ts';

const target: SyntheticDatabaseTarget = {
  host: '127.0.0.1',
  name: 'jalicare_synthetic_test',
};
const local: SyntheticDatabaseIdentity = {
  name: target.name,
  address: '127.0.0.1/32',
  clusterIdentifier: '7539141296746153100',
};

describe('synthetic PostgreSQL fixture guard', () => {
  it('requires both a synthetic test name and a loopback client endpoint before connecting', () => {
    expect(() => assertSyntheticTarget(target)).not.toThrow();
    for (const bad of [
      { ...target, name: 'jalicare_test' },
      { ...target, name: 'production' },
      { ...target, host: 'postgres.example.test' },
      { ...target, host: '0.0.0.0' },
      { ...target, host: '' },
    ])
      expect(() => assertSyntheticTarget(bad)).toThrow();
  });

  it('accepts the selected database on loopback, and rejects mismatched names or absent addresses', () => {
    expect(() => assertSyntheticDatabaseIdentity(target, local)).not.toThrow();
    expect(() =>
      assertSyntheticDatabaseIdentity(target, { ...local, address: '::1/128' }),
    ).not.toThrow();
    expect(() => assertSyntheticDatabaseIdentity(target, { ...local, name: 'other' })).toThrow();
    expect(() => assertSyntheticDatabaseIdentity(target, { ...local, address: null })).toThrow();
  });

  it('requires an exact cluster attestation for private container port forwards', () => {
    const forwarded = { ...local, address: '172.18.0.2/32' };
    const attested = { ...target, containerClusterIdentifier: local.clusterIdentifier };
    expect(() => assertSyntheticDatabaseIdentity(attested, forwarded)).not.toThrow();
    expect(() => assertSyntheticDatabaseIdentity(target, forwarded)).toThrow();
    expect(() =>
      assertSyntheticDatabaseIdentity(
        { ...attested, containerClusterIdentifier: '123' },
        forwarded,
      ),
    ).toThrow();
    expect(() =>
      assertSyntheticDatabaseIdentity(
        { ...attested, containerClusterIdentifier: 'not-a-postgres-id' },
        forwarded,
      ),
    ).toThrow();
    expect(() =>
      assertSyntheticDatabaseIdentity(attested, { ...forwarded, address: '8.8.8.8/32' }),
    ).toThrow();
    expect(() =>
      assertSyntheticDatabaseIdentity(attested, { ...forwarded, address: '172.32.0.2/32' }),
    ).toThrow();
    expect(() =>
      assertSyntheticDatabaseIdentity(attested, { ...forwarded, address: '172.999.0.2/32' }),
    ).toThrow();
    expect(() =>
      assertSyntheticDatabaseIdentity(attested, { ...forwarded, address: '172.18.0.2/0' }),
    ).toThrow();
  });
});
