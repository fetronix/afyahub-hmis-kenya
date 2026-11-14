/** Planning-only fixed-point arithmetic. Never posts inventory, orders or journals. */
export class PlanningError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  code: string,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new PlanningError(code, message, status);
}
export function text(value: unknown, label: string, max = 250): string {
  assert(
    typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max,
    'INVALID_TEXT',
    `${label} is required (maximum ${max} characters).`,
  );
  return value.trim();
}
export function id(value: unknown): number {
  const n = Number(value);
  assert(
    Number.isSafeInteger(n) && n > 0,
    'INVALID_ID',
    'A positive integer ID/version is required.',
  );
  return n;
}
export function fixed(value: unknown, scale = 2, label = 'Value'): bigint {
  assert(
    typeof value === 'string' || typeof value === 'number',
    'INVALID_NUMBER',
    `${label} must be a non-negative decimal.`,
  );
  const s = String(value).trim();
  assert(
    new RegExp(`^\\d{1,10}(?:\\.\\d{1,${scale}})?$`).test(s),
    'INVALID_NUMBER',
    `${label} must be non-negative with at most ${scale} decimal places.`,
  );
  const [whole, fraction = ''] = s.split('.');
  const n = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0'));
  assert(n <= 9_000_000_000_000n, 'NUMBER_TOO_LARGE', `${label} is too large.`);
  return n;
}
export function decimal(value: bigint | string, scale = 2): string {
  const n = BigInt(value),
    unit = 10n ** BigInt(scale);
  return `${n / unit}.${String(n % unit).padStart(scale, '0')}`;
}
export const rounded = (numerator: bigint, denominator: bigint) =>
  (numerator + denominator / 2n) / denominator;
export function inflation(value: unknown): number {
  const bp = fixed(value, 2, 'Inflation percentage');
  assert(bp <= 100000n, 'INVALID_INFLATION', 'Inflation must be between 0 and 1000 percent.');
  return Number(bp);
}
export function adjusted(base: bigint, bp: number): bigint {
  return rounded(base * BigInt(10000 + bp), 10000n);
}
export function monthAmount(price: bigint, quantity: bigint | null): bigint | null {
  if (quantity === null) return null;
  const amount = rounded(price * quantity, 1000n);
  assert(
    amount <= 9_000_000_000_000_000_000n,
    'AMOUNT_TOO_LARGE',
    'Projected amount exceeds supported financial precision.',
  );
  return amount;
}

export function year(value: unknown): number {
  const y = Number(value);
  assert(
    Number.isInteger(y) && y >= 2000 && y <= 2200,
    'INVALID_YEAR',
    'Choose a year from 2000 to 2200.',
  );
  return y;
}
export function quantities(value: unknown): Array<bigint | null> {
  assert(
    Array.isArray(value) && value.length === 12,
    'INVALID_MONTHS',
    'Provide exactly twelve quantities; blank is null, not zero.',
  );
  return value.map((v) => (v === null || v === '' ? null : fixed(v, 3, 'Monthly quantity')));
}
export type UniformInput = {
  description: string;
  categoryId: number;
  existingBalance: string;
  buyingCost: string;
  staffCount: number;
  quantityPerStaff: string;
  contributionPercent: string;
  balanceRule: 'SUBTRACT' | 'IGNORE';
  sourceWorksheet?: string;
  sourceRow?: number;
  sourceFormula?: string;
};
export function uniformCalculation(input: UniformInput) {
  const balance = fixed(input.existingBalance, 3, 'Existing balance'),
    cost = fixed(input.buyingCost, 2, 'Buying cost'),
    perStaff = fixed(input.quantityPerStaff, 3, 'Quantity per staff'),
    contribution = fixed(input.contributionPercent, 2, 'Contribution percentage');
  assert(
    Number.isInteger(input.staffCount) && input.staffCount >= 0 && input.staffCount <= 1000000,
    'INVALID_STAFF',
    'Staff projection must be a non-negative integer.',
  );
  assert(
    contribution <= 10000n,
    'INVALID_CONTRIBUTION',
    'Contribution must be from 0 to 100 percent.',
  );
  assert(
    ['SUBTRACT', 'IGNORE'].includes(input.balanceRule),
    'BALANCE_RULE_REQUIRED',
    'Explicitly select whether existing units offset projected purchases.',
  );
  const projected = BigInt(input.staffCount) * perStaff,
    purchase =
      input.balanceRule === 'SUBTRACT'
        ? projected > balance
          ? projected - balance
          : 0n
        : projected;
  assert(
    projected <= 9_000_000_000_000_000n,
    'QUANTITY_TOO_LARGE',
    'Uniform projection exceeds supported quantity precision.',
  );
  const gross = monthAmount(cost, purchase)!,
    staffContribution = rounded(gross * contribution, 10000n),
    total = gross - staffContribution;
  return {
    balance: decimal(balance, 3),
    buyingCostCents: cost.toString(),
    staffCount: input.staffCount,
    quantityPerStaff: decimal(perStaff, 3),
    projectedQuantity: decimal(projected, 3),
    purchaseQuantity: decimal(purchase, 3),
    contributionBp: Number(contribution),
    grossCents: gross.toString(),
    contributionCents: staffContribution.toString(),
    totalCents: total.toString(),
    balanceRule: input.balanceRule,
  };
}
