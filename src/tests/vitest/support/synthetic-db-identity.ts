/**
 * Guard synthetic fixtures without trusting a database name alone.
 * A Docker port forward reaches a private container address even when the
 * client connects to loopback. In that case the harness must attest the
 * freshly started container's PostgreSQL cluster identifier, obtained from
 * inside that exact container before migrations or test fixtures run.
 */
export interface SyntheticDatabaseTarget {
  host: string;
  name: string;
  containerClusterIdentifier?: string;
}

export interface SyntheticDatabaseIdentity {
  name: string;
  address: string | null;
  clusterIdentifier: string;
}

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
const loopbackAddresses = new Set(['127.0.0.1', '::1']);

export function assertSyntheticTarget(target: SyntheticDatabaseTarget): void {
  if (!/synthetic.*test|test.*synthetic/i.test(target.name) || !loopbackHosts.has(target.host)) {
    throw new Error('An isolated loopback synthetic test database is required.');
  }
}

function privateContainerAddress(raw: string): boolean {
  const parts = raw.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9][0-9]{0,2})$/.test(part))) {
    return false;
  }
  const bytes = parts.map(Number);
  if (bytes.some((part) => part > 255)) return false;
  return (
    bytes[0] === 10 ||
    (bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31) ||
    (bytes[0] === 192 && bytes[1] === 168)
  );
}

export function assertSyntheticDatabaseIdentity(
  target: SyntheticDatabaseTarget,
  identity: SyntheticDatabaseIdentity,
): void {
  assertSyntheticTarget(target);
  if (identity.name !== target.name || !identity.address) {
    throw new Error('The selected synthetic test database identity does not match.');
  }
  const [address, prefix, ...extra] = identity.address.split('/');
  const expectedPrefix = address.includes(':') ? '128' : '32';
  if (extra.length || (prefix !== undefined && prefix !== expectedPrefix)) {
    throw new Error('The selected synthetic test database address is invalid.');
  }
  if (loopbackAddresses.has(address)) return;
  const attested = target.containerClusterIdentifier;
  if (
    !privateContainerAddress(address) ||
    !attested ||
    !/^[0-9]{1,20}$/.test(attested) ||
    identity.clusterIdentifier !== attested
  ) {
    throw new Error('The synthetic test database is not an attested local container.');
  }
}
