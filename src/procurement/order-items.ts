/** Shared exact-decimal calculation. Amounts are KES; no prices or taxes are inferred. */
export class OrderInputError extends Error {}

export interface OrderItemInput {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

export interface CalculatedOrderItem extends OrderItemInput {
  lineTotal: string;
}

const MAX_CENTS = 999_999_999_999n; // purchase_orders.total_amount numeric(12,2)

export function hasControlCharacters(value: string, allowWhitespace = false): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return (
      code === 127 ||
      (code < 32 && !(allowWhitespace && (code === 9 || code === 10 || code === 13)))
    );
  });
}

function decimal(value: unknown, scale: number, label: string): bigint {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new OrderInputError(`${label} must be a decimal number.`);
  }
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || match[1].length > 10 || (match[2]?.length ?? 0) > scale) {
    throw new OrderInputError(
      `${label} must be a non-negative number with at most ${scale} decimal places.`,
    );
  }
  return BigInt(match[1]) * 10n ** BigInt(scale) + BigInt((match[2] ?? '').padEnd(scale, '0'));
}

function format(value: bigint, scale: number): string {
  const padded = value.toString().padStart(scale + 1, '0');
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

export function validateAmount(value: unknown): string {
  const cents = decimal(value, 2, 'Amount');
  if (cents > MAX_CENTS) throw new OrderInputError('Amount exceeds the supported maximum.');
  return format(cents, 2);
}

export function calculateOrderItems(value: unknown): {
  items: CalculatedOrderItem[];
  total: string;
} {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new OrderInputError('Enter between 1 and 100 order lines.');
  }
  let total = 0n;
  const items = value.map((raw: unknown, index: number) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new OrderInputError(`Line ${index + 1} is invalid.`);
    }
    const item = raw as Record<string, unknown>;
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    const unit = typeof item.unit === 'string' ? item.unit.trim() : '';
    if (!description || description.length > 500 || hasControlCharacters(description)) {
      throw new OrderInputError(`Line ${index + 1} needs a description of up to 500 characters.`);
    }
    if (!unit || unit.length > 50 || hasControlCharacters(unit)) {
      throw new OrderInputError(`Line ${index + 1} needs a unit of up to 50 characters.`);
    }
    const quantity = decimal(item.quantity, 3, `Line ${index + 1} quantity`);
    const price = decimal(item.unitPrice, 2, `Line ${index + 1} unit price`);
    if (quantity <= 0n || quantity > 999_999_999_999n) {
      throw new OrderInputError(
        `Line ${index + 1} quantity must be greater than zero and within the supported range.`,
      );
    }
    if (price > MAX_CENTS) throw new OrderInputError(`Line ${index + 1} unit price is too large.`);
    // Round each extended line half-up to the nearest cent, then sum the lines.
    const line = (quantity * price + 500n) / 1000n;
    total += line;
    if (line > MAX_CENTS || total > MAX_CENTS)
      throw new OrderInputError('Order total exceeds the supported maximum.');
    return {
      description,
      unit,
      quantity: format(quantity, 3),
      unitPrice: format(price, 2),
      lineTotal: format(line, 2),
    };
  });
  return { items, total: format(total, 2) };
}

export function optionalOrderText(value: unknown, label: string, maximum: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (
    typeof value !== 'string' ||
    value.trim().length > maximum ||
    hasControlCharacters(value, true)
  ) {
    throw new OrderInputError(`${label} must be text of at most ${maximum} characters.`);
  }
  return value.trim() || null;
}

export function orderDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new OrderInputError('Expected delivery date must be a valid date.');
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    value.startsWith('0000-') ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new OrderInputError('Expected delivery date must be a valid date.');
  }
  return value;
}

/** Explicit quoted adjustments; no tax rates, shipping, discounts or prices are inferred. */
export function calculateOrder(
  value: unknown,
  charges: { taxAmount?: unknown; shippingAmount?: unknown; discountAmount?: unknown },
) {
  const result = calculateOrderItems(value);
  const subtotal = decimal(result.total, 2, 'Subtotal');
  const tax = decimal(charges.taxAmount ?? '0', 2, 'Tax');
  const shipping = decimal(charges.shippingAmount ?? '0', 2, 'Shipping');
  const discount = decimal(charges.discountAmount ?? '0', 2, 'Discount');
  if (tax > MAX_CENTS || shipping > MAX_CENTS || discount > MAX_CENTS)
    throw new OrderInputError('An adjustment exceeds the supported maximum.');
  if (discount > subtotal + tax + shipping)
    throw new OrderInputError('Discount cannot exceed subtotal plus tax and shipping.');
  const total = subtotal + tax + shipping - discount;
  if (total > MAX_CENTS) throw new OrderInputError('Order total exceeds the supported maximum.');
  return {
    items: result.items,
    subtotal: result.total,
    taxAmount: format(tax, 2),
    shippingAmount: format(shipping, 2),
    discountAmount: format(discount, 2),
    total: format(total, 2),
  };
}
