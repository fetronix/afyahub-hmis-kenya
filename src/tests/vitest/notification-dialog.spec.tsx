// @vitest-environment jsdom
/**
 * NotificationDialog — the queue every save, refusal and warning lands in
 *
 * The component is the operator-facing end of `showToast`. Three things
 * about it are worth a test rather than a screenshot:
 *
 *   1. **The tone is the honest part.** A refused save must not wear the
 *      green "Saved" label. The mapping from tone to visible label is
 *      asserted, because a mislabelled error tells a nurse the record was
 *      stored when it was not.
 *   2. **Nothing renders when the queue is empty.** A permanent empty scrim
 *      over a clinical workflow would block pointer events on the page
 *      behind it.
 *   3. **It must never trap an operator.** Escape and both dismiss controls
 *      close the queue, and the dialog is `pointer-events-none` so the page
 *      underneath stays usable.
 *
 * `useHmis` is mocked at the module boundary, which is the real seam: the
 * component reads a queue and calls two dismiss functions, nothing more.
 * No provider, no context plumbing, no network.
 *
 * Messages below are synthetic.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppNotification } from '../../context/HmisContext.tsx';

const dismissNotification = vi.fn();
const dismissAllNotifications = vi.fn();

const state: { notifications: AppNotification[] } = { notifications: [] };

vi.mock('../../context/HmisContext.tsx', () => ({
  useHmis: () => ({
    notifications: state.notifications,
    dismissNotification,
    dismissAllNotifications,
  }),
}));

const { NotificationDialog } = await import('../../components/NotificationDialog.tsx');

function notify(id: number, message: string, tone: AppNotification['tone']): AppNotification {
  // createdAt is part of the queue's shape but not of what this component
  // renders; a fixed value keeps the fixtures deterministic.
  return { id, message, tone, createdAt: 1_700_000_000_000 };
}

beforeEach(() => {
  state.notifications = [];
  dismissNotification.mockClear();
  dismissAllNotifications.mockClear();
});

describe('NotificationDialog — empty queue', () => {
  it('renders nothing at all when there is nothing to show', () => {
    const { container } = render(<NotificationDialog />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('NotificationDialog — tones', () => {
  const cases: Array<[AppNotification['tone'], string]> = [
    ['info', 'Notification'],
    ['success', 'Saved'],
    ['warning', 'Check this'],
    ['error', 'Did not go through'],
  ];

  it.each(cases)('labels a %s notification "%s"', (tone, label) => {
    state.notifications = [notify(1, 'Synthetic message', tone)];

    render(<NotificationDialog />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText('Synthetic message')).toBeInTheDocument();
  });

  it('does not label a failure as saved', () => {
    // The specific regression worth naming: a refused save wearing the
    // success label.
    state.notifications = [notify(1, 'Could not save the encounter', 'error')];

    render(<NotificationDialog />);

    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(screen.getByText('Did not go through')).toBeInTheDocument();
  });
});

describe('NotificationDialog — the queue', () => {
  it('shows several messages at once', () => {
    state.notifications = [
      notify(1, 'First synthetic message', 'info'),
      notify(2, 'Second synthetic message', 'success'),
    ];

    render(<NotificationDialog />);

    expect(screen.getByText('First synthetic message')).toBeInTheDocument();
    expect(screen.getByText('Second synthetic message')).toBeInTheDocument();
  });

  it('shows a count chip only when more than one is queued', () => {
    state.notifications = [notify(1, 'Only one', 'info')];
    const { unmount } = render(<NotificationDialog />);

    expect(screen.queryByText('1')).not.toBeInTheDocument();

    unmount();
    state.notifications = [notify(1, 'One', 'info'), notify(2, 'Two', 'info')];

    render(<NotificationDialog />);

    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

describe('NotificationDialog — dismissal', () => {
  it('dismisses a single row by its own control', () => {
    state.notifications = [
      notify(1, 'First synthetic message', 'info'),
      notify(2, 'Second synthetic message', 'warning'),
    ];

    render(<NotificationDialog />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Dismiss notification: First synthetic message',
      }),
    );

    expect(dismissNotification).toHaveBeenCalledWith(1);
    expect(dismissAllNotifications).not.toHaveBeenCalled();
  });

  it('dismisses the whole queue from the header control', () => {
    state.notifications = [notify(1, 'Synthetic message', 'info')];

    render(<NotificationDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss all notifications' }));

    expect(dismissAllNotifications).toHaveBeenCalledTimes(1);
  });

  it('dismisses the whole queue from the footer button', () => {
    state.notifications = [notify(1, 'Synthetic message', 'error')];

    render(<NotificationDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(dismissAllNotifications).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    state.notifications = [notify(1, 'Synthetic message', 'warning')];

    render(<NotificationDialog />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(dismissAllNotifications).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys, so typing does not dismiss a warning', () => {
    state.notifications = [notify(1, 'Synthetic message', 'warning')];

    render(<NotificationDialog />);

    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'a' });

    expect(dismissAllNotifications).not.toHaveBeenCalled();
  });

  it('removes the Escape listener when it unmounts', () => {
    state.notifications = [notify(1, 'Synthetic message', 'info')];

    const { unmount } = render(<NotificationDialog />);
    unmount();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(dismissAllNotifications).not.toHaveBeenCalled();
  });
});

describe('NotificationDialog — accessibility', () => {
  it('announces politely as a labelled status region', () => {
    state.notifications = [notify(1, 'Synthetic message', 'info')];

    render(<NotificationDialog />);

    const region = screen.getByRole('status', { name: 'Notifications' });

    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('gives every dismiss control an accessible name', () => {
    state.notifications = [
      notify(1, 'First synthetic message', 'info'),
      notify(2, 'Second synthetic message', 'error'),
    ];

    render(<NotificationDialog />);

    // Each row names the message it dismisses, so a screen-reader user with
    // two controls hears which one does what.
    expect(
      screen.getByRole('button', {
        name: 'Dismiss notification: Second synthetic message',
      }),
    ).toBeInTheDocument();
  });

  it('marks the decorative scrim as hidden from assistive technology', () => {
    state.notifications = [notify(1, 'Synthetic message', 'info')];

    const { container } = render(<NotificationDialog />);

    expect(container.querySelector('.notification-scrim')).toHaveAttribute('aria-hidden', 'true');
  });
});
