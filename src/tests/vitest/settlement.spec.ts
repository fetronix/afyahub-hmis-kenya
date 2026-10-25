/**
 * Payment settlement — the arithmetic that decides what a payment did
 *
 * `src/billing/settlement.ts` runs on every payment taken at a counter, and
 * its own header says why it has no database import: the cashier screen and
 * the server must apply one set of rules, so a preview cannot disagree with
 * what is stored.
 *
 * Three properties are worth more than the rest:
 *
 *   1. **Money never touches floating point.** Amounts are integer cents.
 *      These tests parse decimal strings and check exact cents, including
 *      the classic 0.1 + 0.2 case.
 *   2. **An overpayment becomes credit, never a negative balance.** The
 *      module documents the reason: a negative balance silently offsets
 *      another patient's debt when the facility totals what it is owed.
 *   3. **A mobile-money code must be the one printed by Safaricom or
 *      Airtel.** A self-made reference cannot be matched against the
 *      statement at reconciliation, so it is rejected with a reason the
 *      clerk can act on.
 *
 * This module is import-free apart from its own types, so these are real
 * executions with no database and no environment. All values are synthetic;
 * no patient or facility data appears anywhere below.
 */

import { describe, expect, it } from 'vitest';

import {
  PAYMENT_CHANNELS,
  classifySettlement,
  formatCents,
  invoiceStatusAfterCharge,
  isMobileMoney,
  parseMoneyToCents,
  paymentChannel,
  validateTransactionCode,
} from '../../billing/settlement.ts';

describe('parseMoneyToCents', () => {
  it('parses whole shillings', () => {
    expect(parseMoneyToCents('1500')).toBe(150_000);
    expect(parseMoneyToCents(1500)).toBe(150_000);
    expect(parseMoneyToCents('0')).toBe(0);
  });

  it('parses one and two decimal places exactly', () => {
    expect(parseMoneyToCents('0.1')).toBe(10);
    expect(parseMoneyToCents('0.05')).toBe(5);
    expect(parseMoneyToCents('12.34')).toBe(1234);
    expect(parseMoneyToCents('12.3')).toBe(1230);
  });

  it('does not accumulate floating-point error', () => {
    // The reason money is stored as integer cents: 0.1 + 0.2 in floats is
    // 0.30000000000000004, which has more than two decimals and is refused
    // rather than silently rounded.
    const a = parseMoneyToCents('0.1');
    const b = parseMoneyToCents('0.2');

    expect(a).toBe(10);
    expect(b).toBe(20);
    expect((a as number) + (b as number)).toBe(30);
    expect(parseMoneyToCents(String(0.1 + 0.2))).toBeNull();
  });

  it('keeps the sign for negative amounts', () => {
    expect(parseMoneyToCents('-1500')).toBe(-150_000);
    expect(parseMoneyToCents('-0.05')).toBe(-5);
    expect(parseMoneyToCents(-5)).toBe(-500);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseMoneyToCents('  100.50  ')).toBe(10_050);
  });

  it('rejects more than two decimal places rather than rounding', () => {
    // Rounding a third decimal silently changes the amount the patient paid.
    expect(parseMoneyToCents('1.234')).toBeNull();
  });

  it('rejects thousands separators', () => {
    expect(parseMoneyToCents('1,000')).toBeNull();
    expect(parseMoneyToCents('1 000')).toBeNull();
  });

  it('rejects text, empty strings and malformed decimals', () => {
    for (const value of ['', '   ', 'abc', 'KES 100', '.5', '5.', '1.2.3', '--1']) {
      expect(parseMoneyToCents(value)).toBeNull();
    }
  });

  it('returns null for absent values', () => {
    expect(parseMoneyToCents(null)).toBeNull();
    expect(parseMoneyToCents(undefined)).toBeNull();
  });

  it('refuses amounts beyond safe integer range', () => {
    expect(parseMoneyToCents('999999999999999999')).toBeNull();
  });
});

describe('formatCents', () => {
  it('always shows two decimals', () => {
    expect(formatCents(0)).toBe('0.00');
    expect(formatCents(5)).toBe('0.05');
    expect(formatCents(50)).toBe('0.50');
    expect(formatCents(10_050)).toBe('100.50');
    expect(formatCents(150_000)).toBe('1500.00');
  });

  it('formats negatives with a leading minus', () => {
    expect(formatCents(-1)).toBe('-0.01');
    expect(formatCents(-10_050)).toBe('-100.50');
  });

  it('round-trips every parse it produces', () => {
    for (const text of ['0', '0.05', '12.34', '1500', '-7.5']) {
      const cents = parseMoneyToCents(text);

      expect(cents).not.toBeNull();
      expect(parseMoneyToCents(formatCents(cents as number))).toBe(cents);
    }
  });
});

describe('isMobileMoney', () => {
  it('recognises the two mobile rails, trimming whitespace', () => {
    expect(isMobileMoney('M-Pesa')).toBe(true);
    expect(isMobileMoney('  M-Pesa  ')).toBe(true);
    expect(isMobileMoney('Airtel Money')).toBe(true);
  });

  it('does not treat cash, card or an unknown method as mobile money', () => {
    expect(isMobileMoney('Cash')).toBe(false);
    expect(isMobileMoney('Card')).toBe(false);
    expect(isMobileMoney('m-pesa')).toBe(false);
    expect(isMobileMoney('')).toBe(false);
  });
});

describe('validateTransactionCode', () => {
  it('does not demand a code for cash, card or cheque', () => {
    for (const method of ['Cash', 'Card', 'Cheque', 'SHA']) {
      const check = validateTransactionCode(method, '');

      expect(check.valid).toBe(true);
      expect(check.reason).toBeNull();
    }
  });

  it('still normalises a code supplied for a non-mobile method', () => {
    expect(validateTransactionCode('Cash', '  abc123 ').code).toBe('ABC123');
  });

  it('requires a code for mobile money', () => {
    const check = validateTransactionCode('M-Pesa', '');

    expect(check.valid).toBe(false);
    expect(check.reason).toMatch(/required/i);
  });

  it('accepts a well-formed M-Pesa code in any case', () => {
    const check = validateTransactionCode('M-Pesa', ' qgh4xyz123 ');

    expect(check.valid).toBe(true);
    expect(check.code).toBe('QGH4XYZ123');
  });

  it('rejects an M-Pesa code of the wrong shape', () => {
    // Too short, too long, or not two leading letters.
    for (const code of ['QGH4XYZ12', 'QGH4XYZ1234', '1GH4XYZ123']) {
      expect(validateTransactionCode('M-Pesa', code).valid).toBe(false);
    }
  });

  it('rejects a made-up reference containing a separator', () => {
    // The rule the module documents: the code must be the one printed on
    // the customer's confirmation, not something the till invented.
    for (const code of ['QGH-4XYZ-123', 'QGH/4XYZ/123']) {
      const check = validateTransactionCode('M-Pesa', code);

      expect(check.valid).toBe(false);
      expect(check.reason).toMatch(/confirmation/i);
    }
  });

  it('rejects a code containing spaces', () => {
    const check = validateTransactionCode('M-Pesa', 'QGH 4XYZ 123');

    expect(check.valid).toBe(false);
    expect(check.reason).toMatch(/spaces/i);
  });

  it('accepts an Airtel code of 8 to 16 characters containing a digit', () => {
    expect(validateTransactionCode('Airtel Money', 'ABC12DEF').valid).toBe(true);
    expect(validateTransactionCode('Airtel Money', 'A'.repeat(15) + '1').valid).toBe(true);
  });

  it('rejects an Airtel code without a digit or of the wrong length', () => {
    expect(validateTransactionCode('Airtel Money', 'ABCDEFGH').valid).toBe(false);
    expect(validateTransactionCode('Airtel Money', 'ABC1').valid).toBe(false);
    expect(validateTransactionCode('Airtel Money', 'A'.repeat(16) + '1').valid).toBe(false);
  });

  it('always returns a normalised code, even when invalid', () => {
    const check = validateTransactionCode('M-Pesa', '  bad code  ');

    expect(check.valid).toBe(false);
    expect(check.code).toBe('BAD CODE');
  });
});

describe('classifySettlement', () => {
  it('marks an exact payment as fully paid with no credit', () => {
    const result = classifySettlement({
      invoiceTotalCents: 10_000,
      paidBeforeCents: 0,
      amountCents: 10_000,
    });

    expect(result.outcome).toBe('FULLY_PAID');
    expect(result.invoiceStatus).toBe('Paid');
    expect(result.balanceAfterCents).toBe(0);
    expect(result.creditCents).toBe(0);
  });

  it('leaves a balance when the payment is short', () => {
    const result = classifySettlement({
      invoiceTotalCents: 10_000,
      paidBeforeCents: 0,
      amountCents: 6_000,
    });

    expect(result.outcome).toBe('BALANCE_REMAINING');
    expect(result.invoiceStatus).toBe('Partially Paid');
    expect(result.balanceAfterCents).toBe(4_000);
    expect(result.creditCents).toBe(0);
  });

  it('turns an overpayment into credit, never a negative balance', () => {
    // The documented safety property: a negative balance would offset
    // another patient's debt in the facility total.
    const result = classifySettlement({
      invoiceTotalCents: 10_000,
      paidBeforeCents: 0,
      amountCents: 12_000,
    });

    expect(result.outcome).toBe('OVERPAID');
    expect(result.invoiceStatus).toBe('Overpaid');
    expect(result.balanceAfterCents).toBe(0);
    expect(result.creditCents).toBe(2_000);
    expect(result.balanceAfterCents).toBeGreaterThanOrEqual(0);
  });

  it('accounts for money already paid before this payment', () => {
    const result = classifySettlement({
      invoiceTotalCents: 10_000,
      paidBeforeCents: 8_000,
      amountCents: 2_000,
    });

    expect(result.outcome).toBe('FULLY_PAID');
    expect(result.balanceBeforeCents).toBe(2_000);
    expect(result.paidAfterCents).toBe(10_000);
  });

  it('never reports a negative balance on any input', () => {
    const cases = [
      { invoiceTotalCents: 0, paidBeforeCents: 0, amountCents: 500 },
      { invoiceTotalCents: 100, paidBeforeCents: 500, amountCents: 0 },
      { invoiceTotalCents: 10_000, paidBeforeCents: 9_999, amountCents: 1 },
      { invoiceTotalCents: 10_000, paidBeforeCents: 0, amountCents: 99_999 },
    ];

    for (const input of cases) {
      const result = classifySettlement(input);

      expect(result.balanceAfterCents).toBeGreaterThanOrEqual(0);
      expect(result.balanceBeforeCents).toBeGreaterThanOrEqual(0);
      expect(result.creditCents).toBeGreaterThanOrEqual(0);
    }
  });

  it('treats a payment against a zero-value invoice as credit', () => {
    const result = classifySettlement({
      invoiceTotalCents: 0,
      paidBeforeCents: 0,
      amountCents: 500,
    });

    expect(result.outcome).toBe('OVERPAID');
    expect(result.creditCents).toBe(500);
  });

  it('truncates fractional cents rather than rounding them', () => {
    const result = classifySettlement({
      invoiceTotalCents: 10_000.9,
      paidBeforeCents: 0,
      amountCents: 10_000.9,
    });

    expect(result.invoiceTotalCents).toBe(10_000);
    expect(result.amountCents).toBe(10_000);
  });

  it('floors a negative invoice total at zero', () => {
    const result = classifySettlement({
      invoiceTotalCents: -500,
      paidBeforeCents: 0,
      amountCents: 0,
    });

    expect(result.invoiceTotalCents).toBe(0);
  });

  it('writes a receipt sentence with the amounts the patient saw', () => {
    const partial = classifySettlement({
      invoiceTotalCents: 10_000,
      paidBeforeCents: 0,
      amountCents: 6_000,
    });

    expect(partial.summary).toContain('KES 60.00');
    expect(partial.summary).toContain('KES 40.00');
  });
});

describe('invoiceStatusAfterCharge', () => {
  it('derives the status from total and paid', () => {
    expect(invoiceStatusAfterCharge(10_000, 0)).toBe('Unpaid');
    expect(invoiceStatusAfterCharge(10_000, 5_000)).toBe('Partially Paid');
    expect(invoiceStatusAfterCharge(10_000, 10_000)).toBe('Paid');
    expect(invoiceStatusAfterCharge(10_000, 12_000)).toBe('Overpaid');
  });

  it('keeps a zero-value invoice with no payment unpaid', () => {
    expect(invoiceStatusAfterCharge(0, 0)).toBe('Unpaid');
  });

  it('does not call a charge on a zero-value invoice "Overpaid"', () => {
    // There is nothing to overpay when the invoice total is zero, so the
    // status falls through to Partially Paid rather than claiming credit.
    expect(invoiceStatusAfterCharge(0, 500)).toBe('Partially Paid');
  });
});

describe('paymentChannel', () => {
  it('classifies each rail', () => {
    expect(paymentChannel('M-Pesa')).toBe('MOBILE_MONEY');
    expect(paymentChannel('Airtel Money')).toBe('MOBILE_MONEY');
    expect(paymentChannel('Cash')).toBe('CASH');
    expect(paymentChannel('Card')).toBe('CARD');
    expect(paymentChannel('SHA')).toBe('SHA');
  });

  it('ignores case, punctuation and surrounding space', () => {
    expect(paymentChannel('  m pesa ')).toBe('MOBILE_MONEY');
    expect(paymentChannel('M-PESA')).toBe('MOBILE_MONEY');
    expect(paymentChannel('airtel-money')).toBe('MOBILE_MONEY');
  });

  it('keeps an unrecognised method visible as OTHER instead of folding it into cash', () => {
    // A reconciliation that hides a channel is worse than one that shows an
    // "Other" line, which is what the module says it is protecting.
    expect(paymentChannel('Cheque')).toBe('OTHER');
    expect(paymentChannel('Bank transfer')).toBe('OTHER');
    expect(paymentChannel('')).toBe('OTHER');
    expect(paymentChannel(null)).toBe('OTHER');
    expect(paymentChannel(undefined)).toBe('OTHER');
  });

  it('publishes a stable order with the payer first', () => {
    expect(PAYMENT_CHANNELS[0]).toBe('SHA');
    expect(PAYMENT_CHANNELS).toHaveLength(5);
  });
});
