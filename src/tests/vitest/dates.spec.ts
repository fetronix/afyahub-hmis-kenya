/**
 * Clinical date arithmetic
 *
 * `src/utils/dates.ts` decides how long a patient stayed in a ward. Two
 * things are charged or reported from that number: the bed-day charge and
 * the average length of stay. If the parser reads `admission_date` one way
 * and the report reads it another, the invoice and the ward board disagree
 * about the same patient — which is the kind of discrepancy a facility
 * cannot explain to an auditor.
 *
 * The module is import-free (no database, no environment), so this is
 * behavioural coverage of logic that runs in production, not a source-text
 * check. Every case below is a format the module's own header says exists in
 * the stored data.
 *
 * Instants are built with `Date.UTC` and read back with getUTC*, so the
 * suite does not change meaning on a machine in another timezone. The two
 * local-time functions are tested through the local calendar, which is what
 * they are defined to return.
 */

import { describe, expect, it } from 'vitest';

import {
  daysBetween,
  formatDateKey,
  mean,
  median,
  parseLooseDate,
  roundDays,
} from '../../utils/dates.ts';

describe('parseLooseDate', () => {
  it('reads the canonical YYYY-MM-DD form', () => {
    const parsed = parseLooseDate('2026-03-14');

    expect(parsed).not.toBeNull();
    expect(parsed!.toISOString()).toBe('2026-03-14T00:00:00.000Z');
  });

  it('reads YYYY-MM-DD HH:mm, which engines disagree about', () => {
    const parsed = parseLooseDate('2026-03-14 09:30');

    expect(parsed).not.toBeNull();
    expect(Number.isNaN(parsed!.getTime())).toBe(false);
    expect(parsed!.getUTCFullYear()).toBe(2026);
  });

  it('reads slash-separated dates, the format older rows were written in', () => {
    const parsed = parseLooseDate('2026/03/14');

    expect(parsed).not.toBeNull();
    expect(parsed!.toISOString()).toBe('2026-03-14T00:00:00.000Z');
  });

  it('surrounding whitespace does not change the result', () => {
    expect(parseLooseDate('  2026-03-14  ')?.toISOString()).toBe('2026-03-14T00:00:00.000Z');
  });

  it('returns null instead of an Invalid Date for a missing value', () => {
    // A ward list must skip a bad row, not crash on it.
    expect(parseLooseDate(null)).toBeNull();
    expect(parseLooseDate(undefined)).toBeNull();
    expect(parseLooseDate('')).toBeNull();
    expect(parseLooseDate('   ')).toBeNull();
  });

  it('returns null for text that is not a date', () => {
    expect(parseLooseDate('not-a-date')).toBeNull();
    expect(parseLooseDate('UNKNOWN')).toBeNull();
  });

  it('never returns an Invalid Date — the contract callers rely on', () => {
    const inputs = ['2026-03-14', '2026-03-14 09:30', '2026/03/14', 'garbage', '', '0000-00-00'];

    for (const input of inputs) {
      const parsed = parseLooseDate(input);

      if (parsed !== null) {
        expect(Number.isNaN(parsed.getTime())).toBe(false);
      }
    }
  });
});

describe('daysBetween', () => {
  const start = new Date(Date.UTC(2026, 0, 10, 8, 0));

  it('counts whole days, so a 30-hour stay is one night', () => {
    const end = new Date(start.getTime() + 30 * 3_600_000);

    expect(daysBetween(start, end)).toBe(1);
  });

  it('counts a 47-hour stay as one day and a 49-hour stay as two', () => {
    expect(daysBetween(start, new Date(start.getTime() + 47 * 3_600_000))).toBe(1);
    expect(daysBetween(start, new Date(start.getTime() + 49 * 3_600_000))).toBe(2);
  });

  it('is zero for the same instant', () => {
    expect(daysBetween(start, start)).toBe(0);
  });

  it('floors a reversed range at zero rather than returning negative days', () => {
    const earlier = new Date(start.getTime() - 5 * 86_400_000);

    // A discharge date before the admission date is a data-entry error. A
    // negative stay would subtract money from an invoice.
    expect(daysBetween(start, earlier)).toBe(0);
  });

  it('returns zero for an unparseable instant', () => {
    expect(daysBetween(start, new Date(Number.NaN))).toBe(0);
  });
});

describe('formatDateKey', () => {
  it('zero-pads month and day', () => {
    expect(formatDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(formatDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('does not pad the year and does not shift the calendar day', () => {
    // Built in local time and read in local time, so the key is the same day
    // the user sees — no UTC rollover for late-evening instants.
    expect(formatDateKey(new Date(2026, 6, 1, 23, 59))).toBe('2026-07-01');
  });

  it('sorts lexicographically in chronological order', () => {
    const keys = [
      formatDateKey(new Date(2026, 11, 31)),
      formatDateKey(new Date(2026, 0, 2)),
      formatDateKey(new Date(2026, 0, 10)),
    ].sort();

    expect(keys).toEqual(['2026-01-02', '2026-01-10', '2026-12-31']);
  });
});

describe('roundDays', () => {
  it('keeps one decimal place for averages', () => {
    expect(roundDays(1.24)).toBe(1.2);
    expect(roundDays(1.25)).toBe(1.3);
    expect(roundDays(3)).toBe(3);
  });

  it('rounds halves away from the lower value, as Math.round does', () => {
    expect(roundDays(2.25)).toBe(2.3);
    expect(roundDays(-1.25)).toBe(-1.2);
  });
});

describe('median', () => {
  it('returns the middle of an odd-length list', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values of an even-length list', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('returns null for an empty list rather than zero', () => {
    // Zero would report a ward with no discharges as "0 days average",
    // which looks like a measurement instead of an absence of one.
    expect(median([])).toBeNull();
  });

  it("does not mutate the caller's array", () => {
    const values = [3, 1, 2];

    median(values);

    expect(values).toEqual([3, 1, 2]);
  });

  it('handles a single value', () => {
    expect(median([7])).toBe(7);
  });
});

describe('mean', () => {
  it('averages a list', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });

  it('returns null for an empty list', () => {
    expect(mean([])).toBeNull();
  });

  it('keeps float precision rather than rounding early', () => {
    expect(mean([1, 2])).toBe(1.5);
  });
});
