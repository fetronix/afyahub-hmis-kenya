/**
 * Recorded cash receipts, totalled in exact cents.
 *
 * The Reporting Centre's revenue card subtracts refunds from payments. That
 * arithmetic is kept here, away from SQL and away from the browser, so it can
 * be tested against hand-computed amounts: a float would drift, and a silent
 * conversion of an unreadable value to zero would turn "we do not know" into
 * "nothing was received".
 */
import { centsToMoney, moneyToCents } from '../dashboard/money.ts';

export interface ReceiptRow {
  /** Inclusive calendar day, YYYY-MM-DD. */
  day: string;
  /** Exact decimal amount as the database returned it; null means "not recorded". */
  amount: string | null;
}

export interface NetReceipts {
  /** Payments received, before refunds. */
  gross: string;
  /** Refunds recorded against those payments. */
  refunded: string;
  /** `gross - refunded`; negative only when refunds exceed the receipts in scope. */
  net: string;
  /** Net cents per day, in source order, for the daily chart. A missing day is absent, not zero. */
  byDay: Map<string, bigint>;
}

/** The rows cannot be totalled without a human looking at them. */
export class ReceiptReviewRequired extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptReviewRequired';
  }
}

function cents(row: ReceiptRow, what: string): bigint {
  try {
    return moneyToCents(row.amount ?? '0');
  } catch {
    throw new ReceiptReviewRequired(`${what} could not be read as a monetary amount.`);
  }
}

export function netReceipts(
  payments: readonly ReceiptRow[],
  refunds: readonly ReceiptRow[],
): NetReceipts {
  let gross = 0n;
  let returned = 0n;
  const byDay = new Map<string, bigint>();

  for (const row of payments) {
    const value = cents(row, 'A recorded receipt');
    if (value < 0n)
      throw new ReceiptReviewRequired(
        'A recorded receipt has a negative amount and requires review.',
      );
    gross += value;
    byDay.set(row.day, (byDay.get(row.day) ?? 0n) + value);
  }

  for (const row of refunds) {
    const value = cents(row, 'A recorded refund');
    if (value < 0n)
      throw new ReceiptReviewRequired(
        'A recorded refund has a negative amount and requires review.',
      );
    returned += value;
    byDay.set(row.day, (byDay.get(row.day) ?? 0n) - value);
  }

  return {
    gross: centsToMoney(gross),
    refunded: centsToMoney(returned),
    net: centsToMoney(gross - returned),
    byDay,
  };
}
