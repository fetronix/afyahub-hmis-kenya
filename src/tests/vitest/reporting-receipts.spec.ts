/**
 * The revenue card's arithmetic, tested away from SQL.
 *
 * A dashboard total is a claim about money. These cases pin the exact cents:
 * adding shillings as floats, or turning an unreadable amount into `0`, would
 * both produce a confident number that is wrong.
 */
import { describe, expect, it } from 'vitest';
import { netReceipts, ReceiptReviewRequired } from '../../reporting/receipts.ts';

const payments = (rows: Array<[string, string | null]>) =>
  rows.map(([day, amount]) => ({ day, amount }));
const refunds = (rows: Array<[string, string | null]>) =>
  rows.map(([day, amount]) => ({ day, amount }));

describe('recorded receipts', () => {
  it('adds and subtracts exact cents without floating-point drift', () => {
    const totals = netReceipts(
      payments([
        ['2026-04-01', '0.10'],
        ['2026-04-01', '0.20'],
        ['2026-04-02', '1000.00'],
      ]),
      refunds([['2026-04-03', '0.30']]),
    );
    expect(totals.gross).toBe('1000.30');
    expect(totals.refunded).toBe('0.30');
    expect(totals.net).toBe('1000.00');
    expect(totals.byDay.get('2026-04-01')).toBe(30n);
    expect(totals.byDay.get('2026-04-03')).toBe(-30n);
  });

  it('keeps a refund-only day negative so the chart shows the reversal', () => {
    const totals = netReceipts(
      payments([['2026-04-01', '500.00']]),
      refunds([
        ['2026-04-01', '100.00'],
        ['2026-04-02', '50.00'],
      ]),
    );
    expect(totals.net).toBe('350.00');
    expect(totals.byDay.get('2026-04-01')).toBe(40000n);
    expect(totals.byDay.get('2026-04-02')).toBe(-5000n);
  });

  it('reports a true zero when the period has no receipts, and never invents days', () => {
    const totals = netReceipts(payments([]), refunds([]));
    expect(totals).toMatchObject({ gross: '0.00', refunded: '0.00', net: '0.00' });
    expect(totals.byDay.size).toBe(0);
  });

  it('totals large amounts exactly', () => {
    const totals = netReceipts(
      payments([
        ['2026-04-01', '99999999.99'],
        ['2026-04-01', '0.01'],
      ]),
      refunds([]),
    );
    expect(totals.net).toBe('100000000.00');
  });

  it('refuses a negative or unreadable receipt instead of quietly totalling it', () => {
    expect(() => netReceipts(payments([['2026-04-01', '-5.00']]), refunds([]))).toThrow(
      ReceiptReviewRequired,
    );
    expect(() => netReceipts(payments([['2026-04-01', 'not-a-number']]), refunds([]))).toThrow(
      ReceiptReviewRequired,
    );
    expect(() => netReceipts(payments([]), refunds([['2026-04-01', '-1.00']]))).toThrow(
      /requires review/,
    );
  });
});
