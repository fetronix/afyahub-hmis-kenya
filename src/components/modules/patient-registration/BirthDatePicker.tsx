import React, { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { formatDateKey } from '../../../utils/dates.ts';

type PickerStage = 'year' | 'month' | 'day';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const YEARS_PER_PAGE = 120;
const pad2 = (value: number) => String(value).padStart(2, '0');

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function dateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

function parseDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

function validationMessage(value: string): string {
  if (!value) return ''; // The input's existing required constraint handles an empty value.
  if (!parseDate(value)) return 'Enter a valid date in YYYY-MM-DD format.';
  if (value > formatDateKey(new Date())) return 'Date of birth cannot be in the future.';
  return '';
}

/** Day of week for a calendar date. Never converts the chosen date into an instant. */
function firstWeekday(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, 1);
  return date.getUTCDay();
}

interface Props {
  value: string;
  onChange: (value: string) => void;
}

/** Registration-only date-of-birth field; values remain calendar-date strings. */
export const BirthDatePicker: React.FC<Props> = ({ value, onChange }) => {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusChoices = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [stage, setStage] = useState<PickerStage>('year');
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [pageEnd, setPageEnd] = useState(() => new Date().getFullYear());
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [touched, setTouched] = useState(false);

  const today = new Date();
  const todayKey = formatDateKey(today);
  const parsed = parseDate(value);
  const selectedDate = parsed && value <= todayKey ? parsed : null;
  const error = validationMessage(value);
  const showError = touched && Boolean(error);
  const pageStart = Math.max(1, pageEnd - YEARS_PER_PAGE + 1);
  const years = Array.from({ length: pageEnd - pageStart + 1 }, (_, index) => pageEnd - index);

  useEffect(() => {
    inputRef.current?.setCustomValidity(validationMessage(value));
  }, [value]);

  useEffect(() => {
    if (!isOpen) return;
    const dismissOutside = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
    };
  }, [isOpen]);

  // Keep the selected year visible when opening on an existing date, without
  // stealing focus from someone who wants to type in the field.
  useEffect(() => {
    if (isOpen && stage === 'year') {
      rootRef.current
        ?.querySelector<HTMLButtonElement>('[data-date-choice][tabindex="0"]')
        ?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [isOpen, stage, pageEnd]);

  // Move focus between stages for keyboard users, but do not steal it when
  // opening by clicking the editable input: the user may want to type.
  useEffect(() => {
    if (!isOpen || !focusChoices.current) return;
    focusChoices.current = false;
    rootRef.current?.querySelector<HTMLButtonElement>('[data-date-choice][tabindex="0"]')?.focus();
  }, [isOpen, stage, pageEnd, year, month, focusedIndex]);

  const openPicker = (focusGrid: boolean) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const selected = parseDate(value);
    const selectedYear = selected && value <= formatDateKey(now) ? selected.year : currentYear;
    const end =
      selectedYear >= currentYear - YEARS_PER_PAGE + 1
        ? currentYear
        : Math.min(currentYear, selectedYear + YEARS_PER_PAGE - 1);
    setPageEnd(end);
    setFocusedIndex(end - selectedYear);
    setYear(selected && value <= formatDateKey(now) ? selected.year : null);
    setMonth(selected && value <= formatDateKey(now) ? selected.month : null);
    setStage('year');
    focusChoices.current = focusGrid;
    setIsOpen(true);
  };

  const closePicker = (restoreFocus = false) => {
    setIsOpen(false);
    if (restoreFocus) inputRef.current?.focus();
  };

  const chooseYear = (chosen: number) => {
    setYear(chosen);
    setFocusedIndex(selectedDate?.year === chosen ? selectedDate.month - 1 : 0);
    focusChoices.current = true;
    setStage('month');
  };

  const chooseMonth = (chosen: number) => {
    setMonth(chosen);
    setFocusedIndex(
      selectedDate?.year === year && selectedDate.month === chosen ? selectedDate.day - 1 : 0,
    );
    focusChoices.current = true;
    setStage('day');
  };

  const chooseDay = (chosen: number) => {
    if (year === null || month === null) return;
    const selected = dateKey(year, month, chosen);
    // Recheck the local date in case the picker was left open over midnight.
    if (selected > formatDateKey(new Date())) return;
    inputRef.current?.setCustomValidity('');
    onChange(selected);
    setTouched(false);
    closePicker(true);
  };

  const changeYearPage = (end: number) => {
    setPageEnd(end);
    setFocusedIndex(0);
    focusChoices.current = true;
  };

  const changeStage = (next: PickerStage) => {
    if (next === 'year') {
      const selectedYear = year ?? today.getFullYear();
      const end =
        selectedYear >= today.getFullYear() - YEARS_PER_PAGE + 1
          ? today.getFullYear()
          : Math.min(today.getFullYear(), selectedYear + YEARS_PER_PAGE - 1);
      setPageEnd(end);
      setFocusedIndex(end - selectedYear);
    } else {
      setFocusedIndex((month ?? 1) - 1);
    }
    focusChoices.current = true;
    setStage(next);
  };

  // Roving focus makes even a long year list usable without 120 Tab presses.
  const handleGridKeys = (
    event: React.KeyboardEvent<HTMLDivElement>,
    columns: number,
    offset = 0,
  ) => {
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-date-choice]'),
    );
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    let target: number;
    switch (event.key) {
      case 'ArrowRight':
        target = current + 1;
        break;
      case 'ArrowLeft':
        target = current - 1;
        break;
      case 'ArrowDown':
        target = current + columns;
        break;
      case 'ArrowUp':
        target = current - columns;
        break;
      case 'Home':
        target = Math.max(0, current - ((current + offset) % columns));
        break;
      case 'End':
        target = Math.min(
          buttons.length - 1,
          current + columns - 1 - ((current + offset) % columns),
        );
        break;
      default:
        return;
    }
    event.preventDefault();
    const step = target >= current ? 1 : -1;
    while (target >= 0 && target < buttons.length && buttons[target].disabled) target += step;
    if (target >= 0 && target < buttons.length) buttons[target].focus();
  };

  const choiceClass =
    'min-h-10 rounded-md text-sm font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent';
  const heading =
    stage === 'year' ? 'Select year' : stage === 'month' ? 'Select month' : 'Select day';
  const weekdayOffset = year !== null && month !== null ? firstWeekday(year, month) : 0;

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isOpen) {
          event.preventDefault();
          event.stopPropagation();
          closePicker(true);
        }
      }}
    >
      <label htmlFor={`${id}-input`} className="block text-slate-700 font-medium mb-1">
        Date of Birth *
      </label>
      <div className="relative">
        <input
          id={`${id}-input`}
          ref={inputRef}
          type="text"
          required
          maxLength={10}
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            event.currentTarget.setCustomValidity(validationMessage(next));
            onChange(next);
          }}
          onClick={() => {
            if (!isOpen) openPicker(false);
          }}
          onBlur={() => setTouched(true)}
          onInvalid={() => setTouched(true)}
          onKeyDown={(event) => {
            if (event.altKey && event.key === 'ArrowDown') {
              event.preventDefault();
              if (!isOpen) {
                openPicker(true);
              } else {
                rootRef.current
                  ?.querySelector<HTMLButtonElement>('[data-date-choice][tabindex="0"]')
                  ?.focus();
              }
            }
          }}
          placeholder="YYYY-MM-DD"
          aria-describedby={`${id}-hint${showError ? ` ${id}-error` : ''}`}
          aria-invalid={showError || undefined}
          role="combobox"
          aria-autocomplete="none"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-controls={isOpen ? `${id}-picker` : undefined}
          className="w-full px-3 py-2 pr-12 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
        />
        <button
          type="button"
          aria-label={isOpen ? 'Close date of birth picker' : 'Open date of birth picker'}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-controls={isOpen ? `${id}-picker` : undefined}
          onClick={() => (isOpen ? closePicker() : openPicker(true))}
          className="absolute inset-y-0 right-0 flex min-w-11 items-center justify-center rounded-r-md text-blue-700 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          <CalendarDays aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <p id={`${id}-hint`} className="mt-1 text-[11px] text-slate-500">
        Type YYYY-MM-DD or choose a date. Future dates are not allowed. Press Alt+Down to use the
        picker with a keyboard.
      </p>
      {showError && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-rose-700">
          {error}
        </p>
      )}

      {isOpen && (
        <div
          id={`${id}-picker`}
          role="dialog"
          aria-labelledby={`${id}-heading`}
          className="absolute left-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-3rem))] rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <h3 id={`${id}-heading`} aria-live="polite" className="text-sm font-bold text-blue-900">
              {heading}
            </h3>
            <button
              type="button"
              aria-label="Dismiss date picker"
              onClick={() => closePicker(true)}
              className="flex h-10 w-10 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          <p id={`${id}-keyboard-hint`} className="sr-only">
            Use arrow keys to move through the choices, Enter or Space to select, and Escape to
            close.
          </p>

          {stage === 'year' && (
            <>
              <div className="my-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  aria-label="Earlier years"
                  disabled={pageStart === 1}
                  onClick={() => changeYearPage(pageStart - 1)}
                  className="flex min-h-10 items-center rounded-md px-2 text-blue-700 hover:bg-blue-50 disabled:text-slate-300"
                >
                  <ChevronLeft aria-hidden="true" className="h-4 w-4" /> Earlier
                </button>
                <span className="font-semibold text-slate-600">
                  {pageStart}–{pageEnd}
                </span>
                <button
                  type="button"
                  aria-label="Later years"
                  disabled={pageEnd >= today.getFullYear()}
                  onClick={() =>
                    changeYearPage(Math.min(today.getFullYear(), pageEnd + YEARS_PER_PAGE))
                  }
                  className="flex min-h-10 items-center rounded-md px-2 text-blue-700 hover:bg-blue-50 disabled:text-slate-300"
                >
                  Later <ChevronRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
              <label className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-slate-600">
                Jump to decade
                <select
                  aria-label="Jump to decade"
                  value={Math.floor((years[focusedIndex] ?? pageEnd) / 10) * 10}
                  onChange={(event) => {
                    const targetYear = Math.min(pageEnd, Number(event.target.value) + 9);
                    setFocusedIndex(pageEnd - targetYear);
                    focusChoices.current = true;
                  }}
                  className="min-h-10 rounded-md border border-slate-200 bg-white px-2 text-slate-700 focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  {Array.from(
                    { length: Math.floor(pageEnd / 10) - Math.floor(pageStart / 10) + 1 },
                    (_, index) => Math.floor(pageEnd / 10) * 10 - index * 10,
                  ).map((decade) => (
                    <option key={decade} value={decade}>
                      {Math.max(pageStart, decade)}–{Math.min(pageEnd, decade + 9)}
                    </option>
                  ))}
                </select>
              </label>
              <div
                role="group"
                aria-label="Years"
                aria-describedby={`${id}-keyboard-hint`}
                onKeyDown={(event) => handleGridKeys(event, 4)}
                className="grid max-h-56 grid-cols-4 gap-1 overflow-y-auto overscroll-contain"
              >
                {years.map((choice, index) => (
                  <button
                    key={choice}
                    type="button"
                    data-date-choice
                    tabIndex={index === focusedIndex ? 0 : -1}
                    onFocus={() => setFocusedIndex(index)}
                    onClick={() => chooseYear(choice)}
                    className={`${choiceClass} ${selectedDate?.year === choice ? 'bg-orange-100 text-orange-900' : ''}`}
                  >
                    {choice}
                  </button>
                ))}
              </div>
            </>
          )}

          {stage === 'month' && year !== null && (
            <>
              <div className="my-2 flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-700">{year}</span>
                <button
                  type="button"
                  onClick={() => changeStage('year')}
                  className="min-h-10 px-2 font-semibold text-blue-700 hover:underline focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  Change year
                </button>
              </div>
              <div
                role="group"
                aria-label={`Months in ${year}`}
                aria-describedby={`${id}-keyboard-hint`}
                onKeyDown={(event) => handleGridKeys(event, 3)}
                className="grid grid-cols-3 gap-1"
              >
                {MONTHS.map((name, index) => (
                  <button
                    key={name}
                    type="button"
                    data-date-choice
                    tabIndex={index === focusedIndex ? 0 : -1}
                    onFocus={() => setFocusedIndex(index)}
                    onClick={() => chooseMonth(index + 1)}
                    disabled={year === today.getFullYear() && index > today.getMonth()}
                    className={`${choiceClass} ${selectedDate?.year === year && selectedDate.month === index + 1 ? 'bg-orange-100 text-orange-900' : ''}`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </>
          )}

          {stage === 'day' && year !== null && month !== null && (
            <>
              <div className="my-2 flex flex-wrap items-center justify-between gap-1 text-sm">
                <span className="font-semibold text-slate-700">
                  {MONTHS[month - 1]} {year}
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => changeStage('year')}
                    className="min-h-10 px-2 font-semibold text-blue-700 hover:underline focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    Change year
                  </button>
                  <button
                    type="button"
                    onClick={() => changeStage('month')}
                    className="min-h-10 px-2 font-semibold text-blue-700 hover:underline focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    Change month
                  </button>
                </div>
              </div>
              <div
                className="grid grid-cols-7 text-center text-[11px] font-semibold text-slate-500"
                aria-hidden="true"
              >
                {WEEKDAYS.map((weekday) => (
                  <span key={weekday}>{weekday}</span>
                ))}
              </div>
              <div
                role="group"
                aria-label={`Days in ${MONTHS[month - 1]} ${year}`}
                aria-describedby={`${id}-keyboard-hint`}
                onKeyDown={(event) => handleGridKeys(event, 7, weekdayOffset)}
                className="grid grid-cols-7 gap-1"
              >
                {Array.from({ length: weekdayOffset }, (_, index) => (
                  <span key={`blank-${index}`} />
                ))}
                {Array.from({ length: daysInMonth(year, month) }, (_, index) => {
                  const day = index + 1;
                  const key = dateKey(year, month, day);
                  return (
                    <button
                      key={day}
                      type="button"
                      data-date-choice
                      tabIndex={index === focusedIndex ? 0 : -1}
                      onFocus={() => setFocusedIndex(index)}
                      onClick={() => chooseDay(day)}
                      disabled={key > todayKey}
                      aria-label={`${day} ${MONTHS[month - 1]} ${year}`}
                      aria-current={key === value ? 'date' : undefined}
                      className={`${choiceClass} ${key === value ? 'bg-orange-100 text-orange-900' : ''}`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
