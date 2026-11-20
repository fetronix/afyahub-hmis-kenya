/**
 * Syrona Medical Center HMIS — exact money handling for the financial statements.
 *
 * The ledger stores integer cents in `bigint` columns. Statements must never
 * lose a cent to floating point, and a payload stored in `jsonb` cannot hold a
 * `bigint` (JSON.stringify throws). Every amount therefore travels as a
 * signed decimal string of cents and is arithmetic only as `bigint`.
 */

const DECIMAL = /^-?\d{1,15}$/;

/** Parse a cents value that Postgres returned as a string, number or bigint. */
export function cents(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Amount ${value} is not an exact integer number of cents.`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && DECIMAL.test(value.trim())) return BigInt(value.trim());
  throw new Error(`Cannot read "${String(value)}" as an exact amount of cents.`);
}

/** Parse a KES decimal string ("1,234.50" is rejected: commas are ambiguous). */
export function centsFromKes(value: unknown): bigint {
  if (typeof value !== 'string' || !/^-?\d{1,13}(?:\.\d{1,2})?$/.test(value.trim())) {
    throw new Error(`"${String(value)}" is not a signed decimal amount with at most two places.`);
  }
  const text = value.trim();
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -amount : amount;
}

/** The stored form of an amount: a decimal string of cents. */
export function centsString(value: bigint): string {
  return value.toString();
}

export function sumCents(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

export function negateCents(value: bigint): bigint {
  return -value;
}

export function absCents(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** "1234567" → "12,345.67". Used by exports and by the server-rendered PDF. */
export function formatKes(value: bigint, options: { negativeInParens?: boolean } = {}): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = (absolute / 100n).toString();
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = `${grouped}.${fraction}`;
  return negative ? (options.negativeInParens === false ? `-${body}` : `(${body})`) : body;
}

/** "1234567" → "KES 12,345.67". */
export function formatKesLabel(value: bigint): string {
  return `${value < 0n ? '-' : ''}KES ${formatKes(value < 0n ? -value : value, { negativeInParens: false })}`;
}

/**
 * Division for ratios kept as basis points (1% = 100bp), rounded half away
 * from zero. Returns null when the denominator is zero — an undefined ratio is
 * reported as undefined, never as zero.
 */
export function basisPoints(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null;
  const scaled = numerator * 10000n;
  const quotient = scaled / denominator;
  const remainder = scaled % denominator;
  const bump = absCents(remainder) * 2n >= absCents(denominator) ? 1n : 0n;
  const sign = scaled < 0n !== denominator < 0n ? -1n : 1n;
  return Number(quotient + sign * bump);
}
