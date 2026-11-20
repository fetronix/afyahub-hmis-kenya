import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

export type SearchableOption = {
  value: string;
  label: string;
  /** Shown under the label in the list, and after it in the closed control. */
  description?: string;
  disabled?: boolean;
  /** Group heading, e.g. a department name. */
  group?: string;
};

/**
 * A single-select combobox with type-to-filter.
 *
 * Built here rather than pulled in as a dependency: the module already ships its
 * own control set, and a department list is short enough that filtering in the
 * browser is enough. The value stored is the option's `value` — for departments
 * that is the database id, never the name.
 *
 * Keyboard: Down/Up move, Enter chooses, Escape closes, Home/End jump.
 */
export function SearchableSelect({
  id,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyMessage = 'No options',
  loading = false,
  error = null,
  disabled = false,
  required = false,
  describedBy,
  ariaLabelledBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  required?: boolean;
  describedBy?: string;
  ariaLabelledBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = `${id}-listbox`;
  const selected = options.find((option) => option.value === value) ?? null;

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(term) ||
        (option.description ?? '').toLowerCase().includes(term) ||
        (option.group ?? '').toLowerCase().includes(term),
    );
  }, [options, query]);

  /*
   * Opening resets the cursor and the query. Done in the click/keyboard handler
   * rather than an effect so the panel never renders once with stale state.
   */
  const openPanel = () => {
    setQuery('');
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    /* scrollIntoView is absent in jsdom and in some embedded webviews. */
    node?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open, filtered.length]);

  const choose = (option: SearchableOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openPanel();
      return;
    }
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!filtered.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + filtered.length) % filtered.length);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActive(Math.max(0, filtered.length - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered[active];
      if (option) choose(option);
    }
  };

  const message = loading
    ? 'Loading…'
    : error
      ? error
      : options.length === 0
        ? emptyMessage
        : filtered.length === 0
          ? `No match for “${query.trim()}”`
          : null;

  return (
    <div className="ui-combobox" ref={rootRef}>
      <button
        id={id}
        type="button"
        className="ui-select ui-combobox-trigger"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-required={required || undefined}
        aria-describedby={describedBy}
        aria-labelledby={ariaLabelledBy}
        aria-invalid={error ? true : undefined}
        disabled={disabled || loading}
        onClick={() => (open ? setOpen(false) : openPanel())}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? 'truncate text-left' : 'truncate text-left text-slate-400'}>
          {loading ? 'Loading departments…' : (selected?.label ?? placeholder)}
        </span>
        <ChevronDown size={15} aria-hidden />
      </button>

      {open && (
        <div className="ui-combobox-panel">
          <div className="ui-combobox-search">
            <Search size={14} aria-hidden />
            <input
              ref={searchRef}
              type="text"
              value={query}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              aria-controls={listId}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          {message ? (
            <p className="ui-combobox-message" role={error ? 'alert' : undefined}>
              {message}
            </p>
          ) : (
            <ul id={listId} role="listbox" ref={listRef} className="ui-combobox-list">
              {filtered.map((option, index) => (
                <li
                  key={option.value}
                  role="option"
                  data-index={index}
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled || undefined}
                  className={[
                    'ui-combobox-option',
                    index === active ? 'is-active' : '',
                    option.value === value ? 'is-selected' : '',
                    option.disabled ? 'is-disabled' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                >
                  <span className="truncate">{option.label}</span>
                  {option.description ? (
                    <span className="ui-combobox-option-meta">{option.description}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Keeps ids predictable where a caller needs to reference the control by id. */
export function useSearchableId(prefix: string) {
  const generated = useId().replace(/[:]/g, '');
  return `${prefix}-${generated}`;
}
