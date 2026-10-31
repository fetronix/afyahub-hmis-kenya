import React, { useId, useRef } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';

const join = (...classes: Array<string | undefined>) => classes.filter(Boolean).join(' ');
type ButtonProps = React.ComponentPropsWithRef<'button'>;

export function PrimaryButton({ className, type = 'button', ...props }: ButtonProps) {
  return (
    <button {...props} type={type} className={join('ui-button ui-button-primary', className)} />
  );
}
export function SecondaryButton({ className, type = 'button', ...props }: ButtonProps) {
  return (
    <button {...props} type={type} className={join('ui-button ui-button-secondary', className)} />
  );
}
export function IconButton({
  className,
  type = 'button',
  ...props
}: ButtonProps & { 'aria-label': string }) {
  return <button {...props} type={type} className={join('ui-button ui-icon-button', className)} />;
}

export function SearchBar({
  className,
  'aria-label': label,
  ...props
}: React.ComponentPropsWithoutRef<'input'> & { 'aria-label': string }) {
  return (
    <div className={join('ui-search', className)}>
      <Search aria-hidden="true" size={17} />
      <input {...props} type="search" aria-label={label} />
    </div>
  );
}

/** Connect a label, help and validation message to a native field without owning its state. */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  children,
  className = '',
}: {
  label: React.ReactNode;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const field = React.isValidElement<{
    'aria-describedby'?: string;
    'aria-invalid'?: boolean | 'true' | 'false';
  }>(children)
    ? React.cloneElement(children, {
        'aria-describedby':
          [
            children.props['aria-describedby'],
            hint && `${htmlFor}-hint`,
            error && `${htmlFor}-error`,
          ]
            .filter(Boolean)
            .join(' ') || undefined,
        ...(error ? { 'aria-invalid': true as const } : {}),
      })
    : children;
  return (
    <div className={`ui-form-field ${className}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {field}
      {hint && (
        <p id={`${htmlFor}-hint`} className="ui-field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="ui-field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export type TabItem = { id: string; label: React.ReactNode; disabled?: boolean };
/** Controlled tabs with roving focus; callers own the active panel and business state. */
export function Tabs({
  items,
  value,
  onChange,
  label,
  idPrefix,
  className = '',
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  idPrefix?: string;
  className?: string;
}) {
  const generatedId = useId();
  const id = idPrefix ?? generatedId;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (index: number, direction: number) => {
    for (let count = 1; count <= items.length; count++) {
      const next = (index + direction * count + items.length) % items.length;
      if (!items[next]?.disabled) {
        onChange(items[next].id);
        refs.current[next]?.focus();
        break;
      }
    }
  };
  return (
    <div className={`ui-tabs ${className}`} role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="button"
          role="tab"
          id={`${id}-tab-${item.id}`}
          aria-controls={`${id}-panel-${item.id}`}
          aria-selected={value === item.id}
          tabIndex={value === item.id ? 0 : -1}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
              event.preventDefault();
              move(index, event.key === 'ArrowRight' ? 1 : -1);
            }
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function Pagination({
  offset,
  limit,
  total,
  onPageChange,
  label = 'results',
}: {
  offset: number;
  limit: number;
  total: number;
  onPageChange: (offset: number) => void;
  label?: string;
}) {
  return (
    <nav className="ui-pagination" aria-label={`${label} pagination`}>
      <span>
        Showing {total === 0 ? '0' : `${offset + 1}–${Math.min(offset + limit, total)}`} of {total}
      </span>
      <div>
        <IconButton
          aria-label={`Previous ${label}`}
          disabled={offset <= 0}
          onClick={() => onPageChange(Math.max(0, offset - limit))}
        >
          <ChevronLeft size={16} />
        </IconButton>
        <IconButton
          aria-label={`Next ${label}`}
          disabled={offset + limit >= total}
          onClick={() => onPageChange(offset + limit)}
        >
          <ChevronRight size={16} />
        </IconButton>
      </div>
    </nav>
  );
}
