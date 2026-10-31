import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  kenyaToday,
  makeBuckets,
  parseCalendarDate,
  previousRange,
  rangeForPreset,
  validateRange,
} from '../../dashboard/date-range.ts';
import { centsToMoney, moneyToCents } from '../../dashboard/money.ts';
import { percentChange, formatMoney } from '../../components/dashboard/Charts.tsx';

describe('dashboard calendar ranges', () => {
  it('uses Kenya calendar time and complete Monday–Sunday/month presets', () => {
    expect(kenyaToday(new Date('2026-03-01T21:30:00Z'))).toBe('2026-03-02');
    expect(rangeForPreset('today', '2024-02-29')).toEqual({
      start: '2024-02-29',
      end: '2024-02-29',
    });
    expect(rangeForPreset('yesterday', '2024-03-01')).toEqual({
      start: '2024-02-29',
      end: '2024-02-29',
    });
    expect(rangeForPreset('week', '2024-03-03')).toEqual({
      start: '2024-02-26',
      end: '2024-03-03',
    });
    expect(rangeForPreset('month', '2024-02-09')).toEqual({
      start: '2024-02-01',
      end: '2024-02-29',
    });
    expect(rangeForPreset('previousMonth', '2025-01-08')).toEqual({
      start: '2024-12-01',
      end: '2024-12-31',
    });
    expect(addCalendarDays('2024-12-31', 1)).toBe('2025-01-01');
  });
  it('rejects invalid, reversed, oversized, or malformed ranges', () => {
    expect(parseCalendarDate('2023-02-29')).toBeNull();
    expect(parseCalendarDate('2024-13-01')).toBeNull();
    expect(validateRange('2024-03-02', '2024-03-01')).toBeNull();
    expect(validateRange('2024-01-01', '2025-01-01')).toBeNull();
    expect(validateRange('2024-01-01', '2024-12-31')).not.toBeNull();
    expect(validateRange(['2024-01-01'], '2024-01-03')).toBeNull();
  });
  it('compares an immediately preceding equal-length inclusive period', () => {
    expect(previousRange({ start: '2024-03-01', end: '2024-03-31' })).toEqual({
      start: '2024-01-30',
      end: '2024-02-29',
    });
    expect(previousRange({ start: '2025-01-01', end: '2025-01-01' })).toEqual({
      start: '2024-12-31',
      end: '2024-12-31',
    });
  });
  it('makes contiguous nonoverlapping buckets covering the entire range', () => {
    const buckets = makeBuckets({ start: '2024-02-26', end: '2024-03-08' });
    expect(buckets.length).toBeLessThanOrEqual(6);
    expect(buckets[0].start).toBe('2024-02-26');
    expect(buckets.at(-1)?.end).toBe('2024-03-08');
    for (let i = 1; i < buckets.length; i++)
      expect(addCalendarDays(buckets[i - 1].end, 1)).toBe(buckets[i].start);
  });
});

describe('dashboard financial formatting', () => {
  it('keeps arithmetic exact above JavaScript safe integers', () => {
    expect(centsToMoney(moneyToCents('9007199254740993123.47') - moneyToCents('0.27'))).toBe(
      '9007199254740993123.20',
    );
    expect(formatMoney('-1234.50')).toBe('−KES 1,234.50');
    expect(() => moneyToCents('NaN')).toThrow();
    expect(() => moneyToCents('1.005')).toThrow();
  });
  it('never fabricates a percentage for zero or negative baselines', () => {
    expect(percentChange(0, 0)).toBeNull();
    expect(percentChange('100.00', '0.00')).toBeNull();
    expect(percentChange('20.00', '-1.00')).toBeNull();
    expect(percentChange('10.00', '8.00')).toBe('+25.0%');
    expect(percentChange(2, 4)).toBe('−50.0%');
  });
});
