import React from 'react';
import { centsToMoney, moneyToCents } from '../../dashboard/money.ts';
import type { DashboardRange } from '../../dashboard/date-range.ts';
import { formatShortDate } from './DateFilter.tsx';

const palette = ['#075cf1', '#08ad60', '#793cf0', '#ff8614', '#14a9b9', '#bfcbe0'];

export function formatMoney(value: string, currency = 'KES'): string {
  try {
    const cents = moneyToCents(value);
    const absolute = cents < 0n ? -cents : cents;
    const amount = (absolute / 100n).toLocaleString('en-KE');
    const decimal = absolute % 100n ? `.${String(absolute % 100n).padStart(2, '0')}` : '';
    return `${cents < 0n ? '−' : ''}${currency} ${amount}${decimal}`;
  } catch {
    return 'Unavailable';
  }
}

export function percentChange(current: string | number, previous: string | number): string | null {
  try {
    const a = typeof current === 'number' ? BigInt(current) : moneyToCents(current);
    const b = typeof previous === 'number' ? BigInt(previous) : moneyToCents(previous);
    if (b <= 0n) return null;
    const tenths = ((a - b) * 1000n) / b;
    const abs = tenths < 0n ? -tenths : tenths;
    return `${tenths < 0n ? '−' : '+'}${abs / 10n}.${abs % 10n}%`;
  } catch {
    return null;
  }
}

function labelForBucket(bucket: DashboardRange): string {
  return bucket.start === bucket.end
    ? formatShortDate(bucket.start)
    : `${formatShortDate(bucket.start)}–${formatShortDate(bucket.end)}`;
}

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000)
    return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export const Sparkline: React.FC<{ values: number[] }> = ({ values }) => {
  if (values.length < 2 || values.some((v) => !Number.isFinite(v))) return null;
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values),
    span = max - min;
  const points = values
    .map(
      (value, index) =>
        `${(index / (values.length - 1)) * 100},${27 - ((value - min) / span) * 23}`,
    )
    .join(' ');
  return (
    <svg viewBox="0 0 100 30" className="h-8 w-24" aria-hidden="true" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke="rgba(255,255,255,.7)"
        strokeWidth="1.4"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

export const ReceiptsChart: React.FC<{ points: Array<DashboardRange & { net: string }> }> = ({
  points,
}) => {
  const values = points.map((point) => Number(point.net));
  if (
    !points.length ||
    values.some(
      (value) => !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 100,
    )
  )
    return <p className="dashboard-empty">Chart unavailable for these amounts.</p>;
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values),
    span = max - min || 1;
  const x = (index: number) =>
    43 + (points.length === 1 ? 145 : (index * 290) / (points.length - 1));
  const y = (value: number) => 18 + ((max - value) / span) * 104;
  const coords = values.map((value, index) => `${x(index)},${y(value)}`);
  const line = coords.join(' ');
  const fill = `${x(0)},122 ${line} ${x(points.length - 1)},122`;
  return (
    <div className="mt-3">
      <svg
        viewBox="0 0 350 151"
        className="h-[145px] w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Recorded net receipts over the selected date range"
      >
        <defs>
          <linearGradient id="receipts-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#1161ed" stopOpacity=".22" />
            <stop offset="100%" stopColor="#1161ed" stopOpacity=".015" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((row) => {
          const value = max - (span * row) / 3;
          const pos = 18 + (row * 104) / 3;
          return (
            <g key={row}>
              <line x1="43" y1={pos} x2="336" y2={pos} stroke="#e9eef5" />
              <text x="37" y={pos + 3} textAnchor="end" fill="#71839d" fontSize="9">
                {compact(value)}
              </text>
            </g>
          );
        })}
        <polygon points={fill} fill="url(#receipts-area)" />
        <polyline
          points={line}
          fill="none"
          stroke="#075cf1"
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {values.map((value, index) => (
          <g key={points[index].start}>
            <circle
              cx={x(index)}
              cy={y(value)}
              r="3.1"
              fill="white"
              stroke="#075cf1"
              strokeWidth="2"
            />
            <text x={x(index)} y="143" textAnchor="middle" fill="#60728e" fontSize="8.5">
              {formatShortDate(points[index].start)}
            </text>
          </g>
        ))}
      </svg>
      <details className="mt-1 text-[10px] text-[#6e809a]">
        <summary className="cursor-pointer">View chart values</summary>
        <ul className="mt-1 space-y-1">
          {points.map((point) => (
            <li key={point.start}>
              {labelForBucket(point)}: {formatMoney(point.net)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
};

export const CategoriesChart: React.FC<{
  categories: Array<{ label: string; amount: string }>;
}> = ({ categories }) => {
  let items: Array<{ label: string; cents: bigint }>;
  try {
    items = categories.map((item) => ({ label: item.label, cents: moneyToCents(item.amount) }));
  } catch {
    return <p className="dashboard-empty">Service amounts need review.</p>;
  }
  if (items.some((item) => item.cents < 0n))
    return (
      <p className="dashboard-empty">Negative service adjustments need review before charting.</p>
    );
  items = items.filter((item) => item.cents > 0n);
  if (items.length > 6)
    items = [
      ...items.slice(0, 5),
      { label: 'Other', cents: items.slice(5).reduce((sum, item) => sum + item.cents, 0n) },
    ];
  const total = items.reduce((sum, item) => sum + item.cents, 0n);
  if (!total) return <p className="dashboard-empty">No billed service lines in this period.</p>;
  const radius = 63,
    circumference = 2 * Math.PI * radius;
  const dashFor = (cents: bigint) =>
    circumference * (Number((cents * 1_000_000n) / total) / 1_000_000);
  return (
    <div className="category-chart mt-4 flex items-center gap-2">
      <svg
        viewBox="0 0 170 170"
        className="w-[48%] max-w-[185px] shrink-0"
        role="img"
        aria-label="Billed service line amounts by recorded item type"
      >
        <circle cx="85" cy="85" r={radius} fill="none" stroke="#edf1f7" strokeWidth="23" />
        {items.map((item, index) => {
          const dash = dashFor(item.cents);
          const offset = items
            .slice(0, index)
            .reduce((sum, earlier) => sum + dashFor(earlier.cents), 0);
          return (
            <circle
              key={`${item.label}-${index}`}
              cx="85"
              cy="85"
              r={radius}
              fill="none"
              stroke={palette[index]}
              strokeWidth="23"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 85 85)"
            />
          );
        })}
        <text x="85" y="75" textAnchor="middle" fill="#69809d" fontSize="10">
          Billed lines
        </text>
        <text x="85" y="93" textAnchor="middle" fill="#102343" fontSize="13" fontWeight="700">
          {compact(Number(centsToMoney(total)))}
        </text>
        <text x="85" y="108" textAnchor="middle" fill="#69809d" fontSize="9">
          KES
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-2.5">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-2 text-[10px]">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: palette[index] }}
            />
            <span className="min-w-0 flex-1 truncate text-[#344760]" title={item.label}>
              {item.label}
            </span>
            <span className="shrink-0 font-semibold text-[#203452]">
              {Number((item.cents * 1000n) / total) / 10}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const FlowChart: React.FC<{
  points: Array<DashboardRange & { registered: number; returning: number }>;
}> = ({ points }) => {
  const max = Math.max(1, ...points.flatMap((point) => [point.registered, point.returning]));
  const barArea = 275,
    width = Math.min(18, barArea / Math.max(points.length, 1) / 3);
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-end gap-4 text-[10px] text-[#526782]">
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#075cf1]" />
          New registrations
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#08ad60]" />
          Returning patients
        </span>
      </div>
      <svg
        viewBox="0 0 350 155"
        className="h-[145px] w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="New registrations and distinct returning patients with encounters"
      >
        {[0, 1, 2, 3].map((row) => {
          const pos = 15 + (row * 105) / 3;
          return (
            <g key={row}>
              <line x1="42" y1={pos} x2="335" y2={pos} stroke="#e9eef5" />
              <text x="36" y={pos + 3} textAnchor="end" fill="#71839d" fontSize="9">
                {compact(max * (1 - row / 3))}
              </text>
            </g>
          );
        })}
        {points.map((point, index) => {
          const center = 50 + ((index + 0.5) * barArea) / Math.max(points.length, 1);
          const h1 = (point.registered / max) * 105,
            h2 = (point.returning / max) * 105;
          return (
            <g key={point.start}>
              <rect
                x={center - width - 2}
                y={120 - h1}
                width={width}
                height={h1}
                rx="2"
                fill="#075cf1"
              />
              <rect x={center + 2} y={120 - h2} width={width} height={h2} rx="2" fill="#08ad60" />
              <text x={center} y="143" textAnchor="middle" fill="#60728e" fontSize="8">
                {formatShortDate(point.start)}
              </text>
            </g>
          );
        })}
      </svg>
      <details className="mt-1 text-[10px] text-[#6e809a]">
        <summary className="cursor-pointer">View chart values</summary>
        <ul className="mt-1 space-y-1">
          {points.map((point) => (
            <li key={point.start}>
              {labelForBucket(point)}: {point.registered} registered, {point.returning} returning
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
};
