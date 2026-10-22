import React, { useEffect, useState } from 'react';

/**
 * Live countdown to a stock batch's expiry.
 *
 * `inventory_batches.expiry_date` is a calendar date, and the day it
 * names is the last day the batch may be used — a batch expiring today
 * is still dispensable. The countdown therefore runs to the end of that
 * local day, which is the same rule `expiryStatus()` applies on the
 * server, so the screen and the dispensing engine cannot disagree about
 * whether a lot has expired.
 *
 * The clock is local: a facility in Nairobi should not see a batch
 * expire at 03:00 because the server stored the date in UTC.
 */

export interface ExpiryCountdownParts {
  /** True once the expiry day has passed. */
  expired: boolean;
  /** Whole days left, floored; 0 on the last day. */
  days: number;
  hours: number;
  minutes: number;
}

/**
 * Local end-of-day for a YYYY-MM-DD expiry date.
 * Rejects a malformed date instead of letting Date roll it over.
 */
export function expiryDeadline(expiryDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((expiryDate ?? '').trim());

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  /* Local midnight, then the last millisecond of that day. */
  const deadline = new Date(year, month - 1, day, 23, 59, 59, 999);

  if (
    Number.isNaN(deadline.getTime()) ||
    deadline.getFullYear() !== year ||
    deadline.getMonth() !== month - 1 ||
    deadline.getDate() !== day
  ) {
    return null;
  }

  /* A date the calendar does not have must not become a countdown. */
  return deadline;
}

export function countdownTo(
  expiryDate: string,
  now: Date = new Date(),
): ExpiryCountdownParts | null {
  const deadline = expiryDeadline(expiryDate);

  if (!deadline) return null;

  const remaining = deadline.getTime() - now.getTime();

  if (remaining < 0) {
    return { expired: true, days: 0, hours: 0, minutes: 0 };
  }

  const minutes = Math.floor(remaining / 60_000);

  return {
    expired: false,
    days: Math.floor(minutes / (60 * 24)),
    hours: Math.floor((minutes % (60 * 24)) / 60),
    minutes: minutes % 60,
  };
}

/** Colour class shared by the table chip and the dashboard alert. */
export function expiryToneClass(days: number, expired: boolean): string {
  if (expired || days < 0) return 'text-rose-700';
  if (days <= 3) return 'text-rose-600';
  if (days <= 10) return 'text-amber-700';
  return 'text-slate-600';
}

const pad = (value: number) => String(value).padStart(2, '0');

const ExpiryCountdown: React.FC<{
  expiryDate: string;
  /** Show "3d 04h" instead of "3d 04h 12m". */
  short?: boolean;
  className?: string;
  /** Re-render cadence in milliseconds. One minute by default. */
  tickMs?: number;
}> = ({ expiryDate, short = false, className = '', tickMs = 60_000 }) => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), tickMs);

    return () => window.clearInterval(timer);
  }, [tickMs]);

  const parts = countdownTo(expiryDate, now);

  if (!parts) {
    return (
      <span className={`font-mono text-2xs text-slate-400 ${className}`}>
        no expiry recorded
      </span>
    );
  }

  if (parts.expired) {
    return (
      <span
        className={`font-mono text-2xs font-semibold text-rose-700 ${className}`}
        title={`Expired after ${expiryDate}`}
      >
        expired
      </span>
    );
  }

  const tone = expiryToneClass(parts.days, parts.expired);

  return (
    <span
      className={`font-mono text-2xs tabular-nums ${tone} ${className}`}
      title={`Usable until the end of ${expiryDate}`}
    >
      {parts.days}d {pad(parts.hours)}h
      {short ? '' : ` ${pad(parts.minutes)}m`} left
    </span>
  );
};

export default ExpiryCountdown;
