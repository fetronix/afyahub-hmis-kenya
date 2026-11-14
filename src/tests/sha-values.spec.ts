import { describe, expect, it } from 'vitest';
import { asObj, normalizeIsoDate, readNumMoney, readStr } from '../integrations/sha/sha.values.ts';

describe('shared SHA response readers', () => {
  it('keeps object, string, money and date normalization used by the original adapter', () => {
    expect(asObj([])).toBeNull();
    expect(asObj(null)).toBeNull();
    expect(asObj({ x: 1 })).toEqual({ x: 1 });
    expect(readStr({ first: ' ', second: '  synthetic  ' }, 'first', 'second')).toBe('synthetic');
    expect(readStr({}, 'missing')).toBeNull();
    expect(readNumMoney(12)).toBe('12.00');
    expect(readNumMoney('12.345')).toBe('12.35');
    expect(readNumMoney('not-money')).toBeNull();
    expect(normalizeIsoDate('2026-10-29T00:00:00Z')).toBe('2026-10-29');
    expect(normalizeIsoDate('not-a-date')).toBeNull();
  });
});
