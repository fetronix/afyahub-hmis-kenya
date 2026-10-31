import React from 'react';
import { ChevronRight } from 'lucide-react';

/** Shared module heading. Children keep module-specific titles, context and actions. */
export function PageHeader({
  children,
  className = '',
  ...props
}: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div {...props} className={`ui-page-header ${className}`}>
      {children}
    </div>
  );
}

export interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
}

export function PageBreadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="ui-breadcrumbs">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {index > 0 && <ChevronRight aria-hidden="true" size={14} />}
            {item.onClick && index < items.length - 1 ? (
              <button type="button" onClick={item.onClick}>
                {item.label}
              </button>
            ) : (
              <span aria-current={index === items.length - 1 ? 'page' : undefined}>
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function SummaryCard({
  children,
  className = '',
  ...props
}: React.ComponentPropsWithoutRef<'article'>) {
  return (
    <article {...props} className={`ui-summary-card ${className}`}>
      {children}
    </article>
  );
}

export function StatCard({
  label,
  value,
  detail,
  icon,
  action,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <SummaryCard className="ui-stat-card">
      <div>
        <p className="ui-stat-label">{label}</p>
        <p className="ui-stat-value">{value}</p>
        {detail && <p className="ui-stat-detail">{detail}</p>}
        {action}
      </div>
      {icon && (
        <span className="ui-stat-icon" aria-hidden="true">
          {icon}
        </span>
      )}
    </SummaryCard>
  );
}

/** Only adds a scroll container. Native table semantics, attributes and rows remain unchanged. */
export function DataTable({
  children,
  className = '',
  ...props
}: React.ComponentPropsWithoutRef<'table'>) {
  return (
    <div className="ui-table-scroll" role="region" aria-label="Scrollable data table" tabIndex={0}>
      <table {...props} className={`ui-data-table ${className}`}>
        {children}
      </table>
    </div>
  );
}

export function FilterToolbar({
  children,
  className = '',
  ...props
}: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div {...props} className={`ui-filter-toolbar ${className}`}>
      {children}
    </div>
  );
}
