import React from 'react';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { SecondaryButton } from './controls.tsx';

export type SemanticTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';
export function StatusBadge({
  tone = 'neutral',
  children,
}: {
  tone?: SemanticTone;
  children: React.ReactNode;
}) {
  return <span className={`ui-status ui-tone-${tone}`}>{children}</span>;
}
export function AlertBanner({
  tone = 'info',
  children,
  className = '',
}: {
  tone?: SemanticTone;
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === 'error' ? AlertCircle : tone === 'warning' ? AlertTriangle : Info;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`ui-alert ui-tone-${tone} ${className}`}
    >
      <Icon aria-hidden="true" size={18} />
      <div>{children}</div>
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="ui-empty">
      <p>{title}</p>
      {description && <div>{description}</div>}
      {action}
    </div>
  );
}
export function LoadingSkeleton({
  label = 'Loading',
  rows = 3,
}: {
  label?: string;
  rows?: number;
}) {
  return (
    <div role="status" aria-label={label} className="ui-skeleton">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <AlertBanner tone="error">
      <p>{message}</p>
      {onRetry && (
        <SecondaryButton onClick={onRetry} className="mt-2">
          Try again
        </SecondaryButton>
      )}
    </AlertBanner>
  );
}
