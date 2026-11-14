import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import {
  rangeForPreset,
  validateRange,
  type DashboardRange,
  type DatePreset,
} from '../../dashboard/date-range.ts';

export function formatShortDate(value: string, year = false): string {
  const [y, m, d] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(year ? { year: 'numeric' } : {}),
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

const presets: Array<{ id: Exclude<DatePreset, 'custom'>; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'previousMonth', label: 'Previous month' },
];

export const DateFilter: React.FC<{
  value: DashboardRange;
  preset: DatePreset;
  today?: string;
  onChange: (range: DashboardRange, preset: DatePreset) => void;
}> = ({ value, preset, today, onChange }) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        root.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);
  const [start, setStart] = useState(value.start);
  const [end, setEnd] = useState(value.end);
  const [error, setError] = useState('');
  const openMenu = () => {
    setStart(value.start);
    setEnd(value.end);
    setError('');
    setOpen(!open);
  };
  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={openMenu}
        aria-label="Select dashboard date range"
        aria-expanded={open}
        className="flex h-10 items-center gap-2 rounded-lg border border-[#dbe3ef] bg-white px-3 text-[12px] font-semibold text-[#243856] shadow-[0_1px_3px_rgba(20,40,70,.04)] hover:border-[#b4c8e7]"
      >
        <CalendarDays className="h-4 w-4 text-[#516b91]" />
        <span>
          {formatShortDate(value.start, true)} – {formatShortDate(value.end, true)}
        </span>
        <ChevronDown className="ml-1 h-4 w-4 text-[#6c7f9a]" />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-[min(330px,calc(100vw-2rem))] rounded-xl border border-[#dce5f0] bg-white p-3 shadow-[0_16px_40px_rgba(13,33,68,.16)]">
          <p className="px-2 pb-2 pt-1 text-[11px] font-bold uppercase tracking-wider text-[#8695aa]">
            Choose a date range
          </p>
          <div className="grid grid-cols-2 gap-1">
            {presets.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  onChange(rangeForPreset(item.id, today), item.id);
                  setOpen(false);
                }}
                className={`rounded-lg px-3 py-2 text-left text-xs font-medium hover:bg-[#edf4ff] ${preset === item.id ? 'bg-[#edf4ff] text-[#075cf1]' : 'text-[#344760]'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-3 border-t border-[#edf0f5] pt-3">
            <p className="mb-2 text-xs font-semibold text-[#354a67]">Custom range</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-[#71819a]">
                From
                <input
                  aria-label="Custom start date"
                  type="date"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[#dce4ef] px-2 py-2 text-xs text-[#233856]"
                />
              </label>
              <label className="text-[10px] text-[#71819a]">
                To
                <input
                  aria-label="Custom end date"
                  type="date"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[#dce4ef] px-2 py-2 text-xs text-[#233856]"
                />
              </label>
            </div>
            {error && (
              <p role="alert" className="mt-2 text-xs text-rose-700">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                const range = validateRange(start, end);
                if (!range) {
                  setError('Choose valid dates in order, up to 366 days.');
                  return;
                }
                onChange(range, 'custom');
                setOpen(false);
              }}
              className="mt-3 w-full rounded-lg bg-[#075cf1] px-3 py-2 text-xs font-bold text-white hover:bg-[#064bd0]"
            >
              Apply dates
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/** Shared name for the existing validated, facility-date-aware range control. */
export const DateRangePicker = DateFilter;
