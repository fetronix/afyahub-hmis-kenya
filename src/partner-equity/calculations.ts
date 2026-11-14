import {
  equityRows,
  inputKeys,
  originalNames,
  type EquityModel,
  type Partner,
  type RowKey,
} from './model.ts';
export function requireValue(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export function cents(value: unknown): bigint {
  requireValue(
    typeof value === 'string' && /^-?\d{1,10}(?:\.\d{1,2})?$/.test(value),
    'Use a signed decimal amount with at most two decimal places, no commas.',
  );
  const negative = value.startsWith('-'),
    [whole, fraction = ''] = value.replace('-', '').split('.');
  return BigInt(whole + fraction.padEnd(2, '0')) * (negative ? -1n : 1n);
}
export function fixed(value: bigint): string {
  return `${value < 0 ? '-' : ''}${(value < 0 ? -value : value) / 100n}.${((value < 0 ? -value : value) % 100n).toString().padStart(2, '0')}`;
}
export function round(n: bigint, d = 1n): bigint {
  requireValue(d !== 0n, 'Zero denominator requires review.');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const sign = n < 0n ? -1n : 1n;
  n = n < 0n ? -n : n;
  const result = sign * (n / d + ((n % d) * 2n >= d ? 1n : 0n));
  requireValue(
    result <= 900000000000000n && result >= -900000000000000n,
    'Calculated amount exceeds safe export precision; review inputs.',
  );
  return result;
}
export function validDate(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v
  );
}
export function validatePartner(raw: unknown): Partner {
  requireValue(raw && typeof raw === 'object', 'Invalid partner.');
  const p = raw as Partner;
  requireValue(
    typeof p.id === 'string' && /^(original-[1-5]|partner-[a-zA-Z0-9-]{8,50})$/.test(p.id),
    'Invalid partner identifier.',
  );
  requireValue(
    typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 150,
    'Partner name is required (up to 150 characters).',
  );
  requireValue(
    (validDate(p.admittedOn) || (p.original && p.admittedOn === null)) &&
      (p.departedOn === null ||
        (validDate(p.departedOn) && (!p.admittedOn || p.departedOn >= p.admittedOn))),
    'Use valid admission/departure dates in chronological order.',
  );
  requireValue(
    typeof p.active === 'boolean' &&
      typeof p.original === 'boolean' &&
      Number.isInteger(p.order) &&
      p.order >= 0 &&
      p.order <= 999,
    'Invalid partner state/order.',
  );
  requireValue(
    p.active || p.departedOn !== null,
    'Archiving requires an effective departure date.',
  );
  requireValue(
    p.original === p.id.startsWith('original-'),
    'Original partner identity is immutable.',
  );
  if (p.original)
    requireValue(
      p.name === originalNames[Number(p.id.slice(-1)) - 1] &&
        p.order === Number(p.id.slice(-1)) - 1,
      'Original source partner names and order are immutable; record corrections through a reviewed source revision.',
    );
  else
    requireValue(
      p.order >= 5,
      'Additional partners must follow the original five source partners.',
    );
  return {
    id: p.id,
    name: p.name.trim(),
    admittedOn: p.admittedOn,
    departedOn: p.departedOn,
    active: p.active,
    order: p.order,
    original: p.original,
  };
}
export function validateEquity(raw: unknown): EquityModel {
  requireValue(raw && typeof raw === 'object', 'Invalid statement.');
  const m = raw as EquityModel;
  requireValue(
    m.schemaVersion === 1 &&
      Array.isArray(m.partners) &&
      m.partners.length >= 5 &&
      m.partners.length <= 30,
    'Statements require the five original partners and at most 30 partners.',
  );
  cents(m.netResult);
  const partners = m.partners.map(validatePartner);
  requireValue(new Set(partners.map((p) => p.id)).size === partners.length, 'Duplicate partner.');
  for (let i = 1; i <= 5; i++)
    requireValue(
      partners.some((p) => p.id === `original-${i}`),
      'Original partners cannot be removed.',
    );
  requireValue(
    m.inputs && typeof m.inputs === 'object' && Object.keys(m.inputs).length === partners.length,
    'Inputs must match the statement partner snapshot.',
  );
  const inputs: EquityModel['inputs'] = {};
  for (const p of partners) {
    const v = m.inputs[p.id];
    requireValue(
      v && typeof v === 'object' && Object.keys(v).length === inputKeys.length,
      'All eight input rows must be represented.',
    );
    inputs[p.id] = { ...v };
    for (const k of inputKeys) {
      requireValue(
        v[k] === null || typeof v[k] === 'string',
        'Missing values must remain explicit nulls.',
      );
      if (v[k] !== null) cents(v[k]);
    }
  }
  return { schemaVersion: 1, netResult: m.netResult, partners, inputs };
}
export type EquityResult = {
  cells: Record<RowKey, Record<string, string | null>>;
  totals: Record<RowKey, string | null>;
  issues: string[];
  rounding: {
    allocationCents: string;
    closingCents: string;
    ownershipBasisPoints: string;
    sharingBasisPoints: string;
  };
  exactAllocationDifference: string;
  exactClosingDifference: string;
  unspecified: number;
};
/** Fixed BigInt rational arithmetic only; no expression evaluation, eval or spreadsheet execution. */
export function calculateEquity(raw: EquityModel): EquityResult {
  const m = validateEquity(raw),
    cells = Object.fromEntries(equityRows.map((r) => [r.id, {}])) as EquityResult['cells'],
    totals = {} as EquityResult['totals'];
  let beforeTotal = 0n,
    openingTotal = 0n,
    movementTotal = 0n,
    unspecified = 0;
  const before: Record<string, bigint> = {},
    afterMovement: Record<string, bigint> = {};
  for (const k of inputKeys) {
    let sum = 0n;
    for (const p of m.partners) {
      const value = m.inputs[p.id][k];
      cells[k][p.id] = value === null ? null : fixed(cents(value));
      if (value === null) unspecified++;
      sum += value === null ? 0n : cents(value);
    }
    totals[k] = m.partners.every((p) => m.inputs[p.id][k] === null) ? null : fixed(sum);
  }
  for (const p of m.partners) {
    const input = m.inputs[p.id];
    const val = (k: (typeof inputKeys)[number]) => (input[k] === null ? 0n : cents(input[k]));
    before[p.id] = val('opening') + val('capital') + val('interest') + val('salary');
    afterMovement[p.id] = val('drawings') + val('tax') + val('revaluation') + val('adjustments');
    beforeTotal += before[p.id];
    openingTotal += val('opening');
    movementTotal += val('capital') + val('interest') + val('salary') + afterMovement[p.id];
    cells.before[p.id] = fixed(before[p.id]);
  }
  const net = cents(m.netResult),
    closingTotal = beforeTotal + net + Object.values(afterMovement).reduce((a, b) => a + b, 0n),
    issues: string[] = [];
  if (beforeTotal === 0n)
    issues.push(
      'Profit-sharing denominator is zero. Allocation is undefined; review before approval.',
    );
  if (closingTotal === 0n)
    issues.push('Ownership denominator is zero. Ownership is undefined; review before approval.');
  let displayedAlloc = 0n,
    displayedClosing = 0n,
    displayedOwnership = 0n,
    displayedSharing = 0n;
  for (const p of m.partners) {
    if (beforeTotal === 0n) {
      for (const k of ['sharing', 'allocation', 'after', 'closing', 'ownership'] as const)
        cells[k][p.id] = null;
      continue;
    }
    const allocationNumerator = net * before[p.id],
      afterNumerator = before[p.id] * beforeTotal + allocationNumerator,
      closingNumerator = afterNumerator + afterMovement[p.id] * beforeTotal;
    const allocation = round(allocationNumerator, beforeTotal),
      closing = round(closingNumerator, beforeTotal);
    cells.sharing[p.id] = fixed(round(before[p.id] * 10000n, beforeTotal));
    cells.allocation[p.id] = fixed(allocation);
    cells.after[p.id] = fixed(round(afterNumerator, beforeTotal));
    cells.closing[p.id] = fixed(closing);
    cells.ownership[p.id] =
      closingTotal === 0n
        ? null
        : fixed(round(closingNumerator * 10000n, beforeTotal * closingTotal));
    displayedSharing += cents(cells.sharing[p.id]);
    displayedAlloc += allocation;
    displayedClosing += closing;
    if (cells.ownership[p.id] !== null) displayedOwnership += cents(cells.ownership[p.id]);
  }
  totals.before = fixed(beforeTotal);
  totals.sharing = beforeTotal === 0n ? null : '100.00';
  totals.allocation = beforeTotal === 0n ? null : fixed(net);
  totals.after = beforeTotal === 0n ? null : fixed(beforeTotal + net);
  totals.closing = beforeTotal === 0n ? null : fixed(closingTotal);
  totals.ownership = beforeTotal === 0n || closingTotal === 0n ? null : '100.00';
  return {
    cells,
    totals,
    issues,
    rounding: {
      sharingBasisPoints: beforeTotal === 0n ? 'undefined' : String(displayedSharing - 10000n),
      allocationCents: beforeTotal === 0n ? 'undefined' : String(displayedAlloc - net),
      closingCents: beforeTotal === 0n ? 'undefined' : String(displayedClosing - closingTotal),
      ownershipBasisPoints:
        beforeTotal === 0n || closingTotal === 0n
          ? 'undefined'
          : String(displayedOwnership - 10000n),
    },
    exactAllocationDifference: beforeTotal === 0n ? 'undefined' : '0.00',
    exactClosingDifference:
      beforeTotal === 0n ? 'undefined' : fixed(closingTotal - openingTotal - movementTotal - net),
    unspecified,
  };
}
