import React, { useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
} from 'lucide-react';

import {
  useHmis,
  type AppNotification,
  type NotificationTone,
} from '../context/HmisContext.tsx';

/*
 * The tone is the honest part of a notification: a refused save should
 * not wear a green tick. Every existing `showToast(message)` call
 * arrives here as `info`, which claims nothing.
 */
const TONES: Record<
  NotificationTone,
  {
    label: string;
    icon: React.ElementType;
    accent: string;
    tile: string;
  }
> = {
  info: {
    label: 'Notification',
    icon: Info,
    accent: 'bg-brand-500',
    tile: 'bg-brand-50 text-brand-700',
  },
  success: {
    label: 'Saved',
    icon: CheckCircle2,
    accent: 'bg-emerald-500',
    tile: 'bg-emerald-50 text-emerald-700',
  },
  warning: {
    label: 'Check this',
    icon: AlertTriangle,
    accent: 'bg-amber-500',
    tile: 'bg-amber-50 text-amber-700',
  },
  error: {
    label: 'Did not go through',
    icon: XCircle,
    accent: 'bg-rose-500',
    tile: 'bg-rose-50 text-rose-700',
  },
};

const NotificationRow: React.FC<{
  notification: AppNotification;
  index: number;
  onDismiss: (id: number) => void;
}> = ({ notification, index, onDismiss }) => {
  const tone = TONES[notification.tone];
  const Icon = tone.icon;

  return (
    <li
      className="notification-item flex items-start gap-3 px-5 py-3.5"
      style={{ animationDelay: `${Math.min(index, 4) * 45}ms` }}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.tile}`}
      >
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted">
          {tone.label}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-ink">
          {notification.message}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onDismiss(notification.id)}
        aria-label={`Dismiss notification: ${notification.message}`}
        className="mt-0.5 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-ink"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
};

/*
 * One centred dialog for every notification in the queue.
 *
 * Deliberately **not** modal: the backdrop is a light wash with
 * `pointer-events-none`, so a message cannot trap an operator mid
 * workflow for five seconds. Escape and the Dismiss button close the
 * whole queue; each row has its own close control.
 *
 * The animation lives in `index.css` (`.notification-dialog`,
 * `.notification-item`, `.notification-scrim`) and is disabled under
 * `prefers-reduced-motion`.
 */
export const NotificationDialog: React.FC = () => {
  const {
    notifications,
    dismissNotification,
    dismissAllNotifications,
  } = useHmis();

  useEffect(() => {
    if (notifications.length === 0) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismissAllNotifications();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [notifications.length, dismissAllNotifications]);

  if (notifications.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[95] flex items-center justify-center px-4 py-6">
      <div
        aria-hidden="true"
        className="notification-scrim pointer-events-none absolute inset-0 bg-navy-950/20 backdrop-blur-[2px]"
      />

      <section
        role="status"
        aria-live="polite"
        aria-label="Notifications"
        className="notification-dialog pointer-events-auto relative w-full max-w-md overflow-hidden rounded-2xl border border-hair bg-surface shadow-lift"
      >
        <div className={`h-1 w-full ${TONES[notifications[0].tone].accent}`} />

        <div className="flex items-center justify-between gap-3 border-b border-hair px-5 py-3">
          <p className="eyebrow">Notifications</p>

          <div className="flex items-center gap-2">
            {notifications.length > 1 && (
              <span className="chip font-mono">{notifications.length}</span>
            )}

            <button
              type="button"
              onClick={dismissAllNotifications}
              aria-label="Dismiss all notifications"
              className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <ul className="max-h-[60vh] divide-y divide-hair overflow-y-auto">
          {notifications.map((notification, index) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              index={index}
              onDismiss={dismissNotification}
            />
          ))}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t border-hair px-5 py-2.5">
          <p className="text-2xs text-muted">
            This closes on its own. Escape also dismisses it.
          </p>

          <button type="button" onClick={dismissAllNotifications} className="btn-quiet">
            Dismiss
          </button>
        </div>
      </section>
    </div>
  );
};

export default NotificationDialog;
