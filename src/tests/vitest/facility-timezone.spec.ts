import { describe, expect, it } from 'vitest';
import { calendarDateInZone, validTimezone, welcomeInZone } from '../../dashboard/timezone.ts';
import { daysUntilExpiry } from '../../inventory/inventory-contracts.ts';
import { updateFacilitySchema } from '../../validation/schemas/facility.schema.ts';

describe('facility calendar and timezone configuration', () => {
  it('uses the chosen facility timezone across midnight rather than server or browser local time', () => {
    const instant = new Date('2026-10-31T11:30:00Z');
    expect(calendarDateInZone('Pacific/Kiritimati', instant)).toBe('2026-11-01');
    expect(calendarDateInZone('Africa/Nairobi', instant)).toBe('2026-10-31');
    expect(daysUntilExpiry('2026-11-01', calendarDateInZone('Pacific/Kiritimati', instant))).toBe(
      0,
    );
    expect(daysUntilExpiry('2026-11-01', calendarDateInZone('Africa/Nairobi', instant))).toBe(1);
    expect(welcomeInZone('Pacific/Kiritimati', instant)?.greeting).toBe('Good morning');
    expect(welcomeInZone('Africa/Nairobi', instant)?.greeting).toBe('Good afternoon');
  });
  it('rejects missing or invalid zones and supports an explicit inherited setting', () => {
    expect(validTimezone('Not/AZone')).toBe(false);
    expect(validTimezone('')).toBe(false);
    expect(() => calendarDateInZone('Not/AZone')).toThrow();
    expect(updateFacilitySchema.safeParse({ timezone: 'Not/AZone' }).success).toBe(false);
    expect(updateFacilitySchema.parse({ timezone: 'Africa/Nairobi' })).toEqual({
      timezone: 'Africa/Nairobi',
    });
    expect(updateFacilitySchema.parse({ timezone: null })).toEqual({ timezone: null });
  });
});
