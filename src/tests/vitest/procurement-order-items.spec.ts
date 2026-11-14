import { describe, expect, it } from 'vitest';
import {
  calculateOrder,
  calculateOrderItems,
  orderDate,
  validateAmount,
} from '../../procurement/order-items.ts';

describe('purchase order exact-decimal calculations', () => {
  it('rounds each fractional line half-up, then applies explicit adjustments', () => {
    const result = calculateOrder(
      [
        { description: 'Synthetic', quantity: '1.5', unit: 'box', unitPrice: '10.01' },
        { description: 'Other', quantity: '2', unit: 'unit', unitPrice: '2.25' },
      ],
      { taxAmount: '2', shippingAmount: '1.25', discountAmount: '0.50' },
    );
    expect(result).toMatchObject({
      subtotal: '19.52',
      total: '22.27',
      items: [{ lineTotal: '15.02' }, { lineTotal: '4.50' }],
    });
  });
  it('does not use floating point for the smallest amounts', () => {
    expect(
      calculateOrderItems([
        { description: 'Item', quantity: '0.500', unit: 'kg', unitPrice: '0.01' },
      ]).total,
    ).toBe('0.01');
    expect(validateAmount('9999999999.99')).toBe('9999999999.99');
  });
  it.each([
    ['-1', '1'],
    ['0', '1'],
    ['1.0001', '1'],
    ['NaN', '1'],
    ['1', '1.001'],
    ['1', '-1'],
    ['1000000000', '1'],
    ['999999999.999', '9999999999.99'],
  ])('rejects invalid or overflowing quantity %s and price %s', (quantity, unitPrice) => {
    expect(() =>
      calculateOrderItems([{ description: 'Item', quantity, unit: 'unit', unitPrice }]),
    ).toThrow();
  });
  it('rejects discount larger than the quoted total and impossible dates', () => {
    expect(() =>
      calculateOrder([{ description: 'x', quantity: '1', unit: 'u', unitPrice: '1' }], {
        discountAmount: '2',
      }),
    ).toThrow();
    expect(() => orderDate('2027-02-30')).toThrow();
    expect(() => orderDate('0000-01-01')).toThrow();
    expect(orderDate('2028-02-29')).toBe('2028-02-29');
  });
});
