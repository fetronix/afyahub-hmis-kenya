/**
 * JaliCare HMIS
 * Payment settlement — classifying what a payment did to an invoice
 *
 * Money in a Kenyan facility arrives as cash at the counter, an M-Pesa
 * message on a phone, or a card slip. The counter clerk has two facts
 * they can trust: how much came in, and the transaction code Safaricom
 * printed. Everything else is arithmetic.
 *
 * This module is deliberately free of database imports so both the API
 * and the cashier screen can share one set of rules. A preview in the
 * browser therefore cannot disagree with what the server will do.
 *
 * All amounts are handled as integer cents. Floating point never sees
 * money.
 */

export type PaymentMethodName = 'Cash' | 'M-Pesa' | 'Airtel Money' | 'Card' | 'SHA' | 'Cheque';

/** What the payment did to the invoice it was posted against. */
export type SettlementOutcome = 'FULLY_PAID' | 'BALANCE_REMAINING' | 'OVERPAID';

export interface Settlement {
  invoiceTotalCents: number;
  paidBeforeCents: number;
  balanceBeforeCents: number;
  amountCents: number;
  paidAfterCents: number;
  balanceAfterCents: number;
  /** Money received beyond the invoice total; held as patient credit. */
  creditCents: number;
  outcome: SettlementOutcome;
  /** Invoice status to persist alongside the settlement. */
  invoiceStatus: 'Paid' | 'Partially Paid' | 'Unpaid' | 'Overpaid';
  /** Human sentence for the receipt and the toast. */
  summary: string;
}

const MOBILE_MONEY_METHODS = ['M-Pesa', 'Airtel Money'];

export function isMobileMoney(method: string): boolean {
  return MOBILE_MONEY_METHODS.includes(method.trim());
}

/* ============================================================
   PAYMENT CHANNELS
   ============================================================ */

/**
 * The three ways money reaches a Kenyan facility, plus the two
 * exceptions a counter still has to record honestly.
 *
 * SHA is a payer, not a till: it settles through the claims workflow
 * and writes a payment row with method "SHA". Mobile money is the
 * patient-facing M-Pesa / Airtel rail. Cash is the drawer. Card and
 * anything unrecognised are kept apart rather than folded into cash,
 * because a reconciliation that hides a channel is worse than one
 * that shows an "Other" line.
 */
export type PaymentChannel = 'SHA' | 'MOBILE_MONEY' | 'CASH' | 'CARD' | 'OTHER';

/** Display order of the channel split, payer first. */
export const PAYMENT_CHANNELS: readonly PaymentChannel[] = [
  'SHA',
  'MOBILE_MONEY',
  'CASH',
  'CARD',
  'OTHER',
];

export const PAYMENT_CHANNEL_LABELS: Record<PaymentChannel, string> = {
  SHA: 'SHA',
  MOBILE_MONEY: 'Online mobile money',
  CASH: 'Cash',
  CARD: 'Card',
  OTHER: 'Other',
};

const SHA_METHODS = new Set(['sha', 'shaclaim', 'shaclaims', 'socialhealthauthority']);

const MOBILE_METHODS = new Set([
  'mpesa',
  'mpesacash',
  'airtel',
  'airtelmoney',
  'mtn',
  'mtnmomo',
  'mobilemoney',
  'mobile',
  'online',
  'onlinemobilemoney',
  'onlinepayment',
]);

const CASH_METHODS = new Set(['cash', 'cashpayment', 'cashdrawer']);

const CARD_METHODS = new Set([
  'card',
  'cardpayment',
  'visa',
  'mastercard',
  'debitcard',
  'creditcard',
  'amex',
  'americanexpress',
]);

/**
 * Reduce a stored payment method to one reportable channel.
 *
 * Comparison ignores case, spaces, hyphens and punctuation so
 * "M-Pesa", "MPESA" and "m pesa" are one channel. Anything not
 * recognised stays OTHER and is named in the report, never guessed
 * into SHA or cash.
 */
export function paymentChannel(method: string | null | undefined): PaymentChannel {
  if (typeof method !== 'string') return 'OTHER';

  const compact = method.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (!compact) return 'OTHER';
  if (SHA_METHODS.has(compact)) return 'SHA';
  if (MOBILE_METHODS.has(compact)) return 'MOBILE_MONEY';
  if (CASH_METHODS.has(compact)) return 'CASH';
  if (CARD_METHODS.has(compact)) return 'CARD';

  return 'OTHER';
}

/** Parsed money as signed integer cents, or null when unreadable. */
export function parseMoneyToCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;

  const text = typeof value === 'number' ? String(value) : value.trim();

  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return null;

  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ''] = unsigned.split('.');

  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  if (!Number.isSafeInteger(cents)) return null;

  return negative ? -cents : cents;
}

export function formatCents(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);

  const text = `${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;

  return negative ? `-${text}` : text;
}

/* ============================================================
   TRANSACTION CODES
   ============================================================ */

export interface CodeCheck {
  valid: boolean;
  /** Normalised code: trimmed, uppercase, no spaces. */
  code: string;
  reason: string | null;
}

/*
 * Safaricom M-Pesa confirmations look like QGH4XYZ123 or SGH7X1A2B3:
 * ten characters, two letters first, then letters and digits. The real
 * code is what is printed on the customer's SMS — never something the
 * till generates for itself, because a self-generated code cannot be
 * matched against the M-Pesa statement at reconciliation time.
 */
const MPESA_CODE = /^[A-Z]{2}[A-Z0-9]{8}$/;

/* Airtel Money transaction ids are alphanumeric, length varies by channel. */
const AIRTEL_CODE = /^(?=.*[0-9])[A-Z0-9]{8,16}$/;

export function validateTransactionCode(
  method: string,
  rawCode: string | null | undefined,
): CodeCheck {
  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';

  /*
   * Cash, card and cheque carry no mobile money code at all. Returning
   * "valid" here means the empty-string check below can stay strict.
   */
  if (!isMobileMoney(method)) {
    return { valid: true, code, reason: null };
  }

  if (!code) {
    return {
      valid: false,
      code,
      reason: 'A transaction code is required for mobile money payments.',
    };
  }

  if (/\s/.test(code)) {
    return {
      valid: false,
      code,
      reason: 'The transaction code must not contain spaces.',
    };
  }

  if (code.includes('-') || code.includes('/')) {
    return {
      valid: false,
      code,
      reason:
        'Enter the code from the M-Pesa or Airtel confirmation message, not a reference you made up.',
    };
  }

  if (method.trim() === 'M-Pesa') {
    if (!MPESA_CODE.test(code)) {
      return {
        valid: false,
        code,
        reason: 'An M-Pesa code is 10 characters: two letters followed by eight letters or digits.',
      };
    }

    return { valid: true, code, reason: null };
  }

  if (method.trim() === 'Airtel Money') {
    if (!AIRTEL_CODE.test(code)) {
      return {
        valid: false,
        code,
        reason: 'An Airtel Money code is 8 to 16 letters or digits and contains a digit.',
      };
    }

    return { valid: true, code, reason: null };
  }

  return { valid: true, code, reason: null };
}

/* ============================================================
   SETTLEMENT
   ============================================================ */

/**
 * Work out what a payment does to an invoice.
 *
 * A payment that exactly clears the balance is FULLY_PAID. Anything
 * short leaves BALANCE_REMAINING. Anything over is OVERPAID, and the
 * excess is returned separately as credit rather than being allowed to
 * hide inside a negative balance — a negative balance silently offsets
 * other patients' debts when the facility totals its outstanding money.
 */
export function classifySettlement(input: {
  invoiceTotalCents: number;
  paidBeforeCents: number;
  amountCents: number;
}): Settlement {
  const total = Math.max(0, Math.trunc(input.invoiceTotalCents));
  const paidBefore = Math.max(0, Math.trunc(input.paidBeforeCents));
  const amount = Math.trunc(input.amountCents);

  const paidAfter = paidBefore + amount;
  const balanceBefore = Math.max(0, total - paidBefore);

  const outstanding = total - paidAfter;

  if (outstanding > 0) {
    return {
      invoiceTotalCents: total,
      paidBeforeCents: paidBefore,
      balanceBeforeCents: balanceBefore,
      amountCents: amount,
      paidAfterCents: paidAfter,
      balanceAfterCents: outstanding,
      creditCents: 0,
      outcome: 'BALANCE_REMAINING',
      invoiceStatus: 'Partially Paid',
      summary: `KES ${formatCents(amount)} received. KES ${formatCents(outstanding)} still outstanding.`,
    };
  }

  if (outstanding === 0) {
    return {
      invoiceTotalCents: total,
      paidBeforeCents: paidBefore,
      balanceBeforeCents: balanceBefore,
      amountCents: amount,
      paidAfterCents: paidAfter,
      balanceAfterCents: 0,
      creditCents: 0,
      outcome: 'FULLY_PAID',
      invoiceStatus: 'Paid',
      summary: `KES ${formatCents(amount)} received. Invoice fully paid.`,
    };
  }

  const credit = -outstanding;

  return {
    invoiceTotalCents: total,
    paidBeforeCents: paidBefore,
    balanceBeforeCents: balanceBefore,
    amountCents: amount,
    paidAfterCents: paidAfter,
    balanceAfterCents: 0,
    creditCents: credit,
    outcome: 'OVERPAID',
    invoiceStatus: 'Overpaid',
    summary: `KES ${formatCents(amount)} received. Invoice fully paid with KES ${formatCents(credit)} credit due back to the patient.`,
  };
}

/** Status an invoice should carry when a new charge lands on it. */
export function invoiceStatusAfterCharge(
  totalCents: number,
  paidCents: number,
): 'Paid' | 'Partially Paid' | 'Unpaid' | 'Overpaid' {
  if (totalCents > 0 && paidCents > totalCents) return 'Overpaid';
  if (totalCents > 0 && paidCents === totalCents) return 'Paid';
  if (paidCents > 0) return 'Partially Paid';

  return 'Unpaid';
}
