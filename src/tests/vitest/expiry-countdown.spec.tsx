// @vitest-environment jsdom
/**
 * ExpiryCountdown — first React component test
 *
 * Added with Vitest + Testing Library. The component carries the rule that
 * a batch is dispensable through the end of its expiry day, and the same
 * rule is applied server-side by `expiryStatus()`. A screen and an engine
 * that disagree about expiry is how expired stock gets dispensed, so the
 * boundary is asserted directly rather than inferred from a screenshot.
 *
 * Time is injected: `countdownTo` takes `now`, and the component's tick is
 * configurable. Nothing here waits on a real clock, so the test cannot flake
 * on a slow CI machine.
 */

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ExpiryCountdown, {
  countdownTo,
  expiryDeadline,
  expiryToneClass,
} from '../../components/ExpiryCountdown.tsx';

describe('expiryDeadline', () => {
  it('resolves to the last millisecond of the named local day', () => {
    const deadline = expiryDeadline('2026-03-14');

    expect(deadline).not.toBeNull();
    expect(deadline!.getFullYear()).toBe(2026);
    expect(deadline!.getMonth()).toBe(2);
    expect(deadline!.getDate()).toBe(14);
    expect(deadline!.getHours()).toBe(23);
    expect(deadline!.getMinutes()).toBe(59);
  });

  it('rejects a date the calendar does not have', () => {
    expect(expiryDeadline('2026-02-30')).toBeNull();
    expect(expiryDeadline('2026-13-01')).toBeNull();
  });

  it('rejects anything that is not YYYY-MM-DD', () => {
    expect(expiryDeadline('')).toBeNull();
    expect(expiryDeadline('14/03/2026')).toBeNull();
    expect(expiryDeadline('2026-3-4')).toBeNull();
  });
});

describe('countdownTo', () => {
  it('treats the expiry day itself as usable', () => {
    const earlyOnTheDay = new Date(2026, 2, 14, 0, 0, 0);
    const parts = countdownTo('2026-03-14', earlyOnTheDay);

    expect(parts).not.toBeNull();
    expect(parts!.expired).toBe(false);
    expect(parts!.days).toBe(0);
  });

  it('reports expired only after the day has ended', () => {
    const justAfter = new Date(2026, 2, 15, 0, 0, 1);
    const parts = countdownTo('2026-03-14', justAfter);

    expect(parts!.expired).toBe(true);
    expect(parts!.days).toBe(0);
  });

  it('breaks the remainder into days, hours and minutes', () => {
    const now = new Date(2026, 2, 10, 12, 0, 0);
    const parts = countdownTo('2026-03-14', now);

    /* 10 Mar 12:00 -> 14 Mar 23:59:59.999 is 4d 11h 59m. */
    expect(parts!.days).toBe(4);
    expect(parts!.hours).toBe(11);
    expect(parts!.minutes).toBe(59);
  });

  it('returns null rather than a countdown for a bad date', () => {
    expect(countdownTo('not-a-date')).toBeNull();
  });
});

describe('expiryToneClass', () => {
  it('escalates the colour as the date approaches', () => {
    expect(expiryToneClass(0, true)).toBe('text-rose-700');
    expect(expiryToneClass(2, false)).toBe('text-rose-600');
    expect(expiryToneClass(7, false)).toBe('text-amber-700');
    expect(expiryToneClass(30, false)).toBe('text-slate-600');
  });
});

describe('<ExpiryCountdown />', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the remaining time for a batch in date', () => {
    render(<ExpiryCountdown expiryDate="2026-03-14" />);

    expect(screen.getByTitle(/usable until the end of 2026-03-14/i)).toBeInTheDocument();
    expect(screen.getByText(/4d/)).toBeInTheDocument();
  });

  it('renders an expired marker once the day has passed', () => {
    render(<ExpiryCountdown expiryDate="2026-03-01" />);

    expect(screen.getByTitle(/expired after 2026-03-01/i)).toBeInTheDocument();
  });

  it('says so when no expiry was recorded, instead of showing 0d', () => {
    render(<ExpiryCountdown expiryDate="" />);

    expect(screen.getByText(/no expiry recorded/i)).toBeInTheDocument();
  });

  it('advances as the injected timer ticks', async () => {
    const { container } = render(<ExpiryCountdown expiryDate="2026-03-10" tickMs={1_000} />);

    const before = container.textContent;

    await vi.advanceTimersByTimeAsync(60_000);

    /* Same day, so the label is allowed to be equal — it must not crash or
       go stale into a wrong day. Advancing a day must change it. */
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);

    expect(container.textContent).not.toBe(before);
  });
});
