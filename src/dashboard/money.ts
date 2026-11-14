/** Exact decimal handling for dashboard totals. Never round money with floating point. */
export function moneyToCents(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error('Invalid recorded monetary amount');
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] === '-' ? -cents : cents;
}
export function centsToMoney(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
