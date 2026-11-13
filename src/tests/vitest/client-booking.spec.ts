import { describe, expect, it } from 'vitest';
import {
  checkBookingRateLimit,
  normalizeBookingPhone,
  resetBookingRateLimits,
} from '../../booking/website-booking.service.ts';

describe('website booking primitives', () => {
  it('normalizes Kenyan numbers and rejects malformed input', () => {
    expect(normalizeBookingPhone('0712 345 678')).toBe('+254712345678');
    expect(normalizeBookingPhone('+254712345678')).toBe('+254712345678');
    expect(() => normalizeBookingPhone('abc')).toThrow();
  });
  it('limits a client without sharing its bucket with another client', () => {
    resetBookingRateLimits();
    expect(checkBookingRateLimit(1, 2, 100_000)).toBe(true);
    expect(checkBookingRateLimit(1, 2, 100_001)).toBe(true);
    expect(checkBookingRateLimit(1, 2, 100_002)).toBe(false);
    expect(checkBookingRateLimit(2, 2, 100_002)).toBe(true);
    expect(checkBookingRateLimit(1, 2, 160_001)).toBe(true);
  });
});
