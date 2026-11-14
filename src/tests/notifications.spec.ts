import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { maternityModuleSource } from './support/schema-source.ts';

const here = dirname(fileURLToPath(import.meta.url));

const root = resolve(here, '../..');

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

const context = source('src/context/HmisContext.tsx');

function numericConstant(name: string): number {
  const match = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(context);

  if (!match) {
    throw new Error(`FAILED: ${name} is not a numeric constant`);
  }

  return Number(match[1]);
}

const NOTIFICATION_LIFETIME_MS = numericConstant('NOTIFICATION_LIFETIME_MS');

const NOTIFICATION_QUEUE_LIMIT = numericConstant('NOTIFICATION_QUEUE_LIMIT');

const dialog = source('src/components/NotificationDialog.tsx');

const app = source('src/App.tsx');

const css = source('src/index.css');

describe('Notification dialog — contract tests', () => {
  it('1. The queue lives in one place', async () => {
    expect(
      NOTIFICATION_LIFETIME_MS >= 4000 && NOTIFICATION_LIFETIME_MS <= 8000,
      'A notification stays long enough to read and short enough to ignore',
    ).toBe(true);

    expect(
      NOTIFICATION_QUEUE_LIMIT >= 3 && NOTIFICATION_QUEUE_LIMIT <= 6,
      'The queue is bounded',
    ).toBe(true);

    expect(
      context.includes('notifications: AppNotification[]'),
      'The provider exposes a list, not one overwritten string',
    ).toBe(true);

    expect(
      !/\btoastMessage\b/.test(context),
      'The single toast string is gone from the provider',
    ).toBe(true);

    expect(
      context.includes('notificationTimers') && context.includes('clearTimeout'),
      'Each notification owns its timer',
    ).toBe(true);

    expect(
      context.includes("const tone = options?.tone ?? 'info'"),
      'A caller that says nothing gets a neutral tone, not a green tick',
    ).toBe(true);

    expect(
      context.includes('dismissNotification') && context.includes('dismissAllNotifications'),
      'Both one and all can be dismissed',
    ).toBe(true);

    expect(
      context.includes('window.clearTimeout(timer)') &&
        context.includes('notificationTimers.current.clear()'),
      'Timers are cleared on dismissal and on unmount',
    ).toBe(true);
  });

  it('2. The dialog is centred, animated and dismissible', async () => {
    expect(
      /fixed inset-0[^"]*flex items-center justify-center/.test(dialog),
      'The dialog is centred on the viewport',
    ).toBe(true);

    expect(
      dialog.includes('pointer-events-none fixed inset-0'),
      'The backdrop does not trap the operator mid-workflow',
    ).toBe(true);

    expect(
      dialog.includes('role="status"') && dialog.includes('aria-live="polite"'),
      'A screen reader is told about the message without an alarm',
    ).toBe(true);

    expect(dialog.includes("event.key === 'Escape'"), 'Escape closes the queue').toBe(true);

    expect(dialog.includes('Dismiss all notifications'), 'There is a labelled close control').toBe(
      true,
    );

    expect(
      dialog.includes('notification-dialog') &&
        dialog.includes('notification-item') &&
        dialog.includes('notification-scrim'),
      'The card, its rows and its wash each animate',
    ).toBe(true);

    expect(
      dialog.includes('info: {') &&
        dialog.includes('success: {') &&
        dialog.includes('warning: {') &&
        dialog.includes('error: {'),
      'Four tones, each with its own word and colour',
    ).toBe(true);

    expect(dialog.includes('Did not go through'), 'A failure is labelled as a failure').toBe(true);

    expect(
      dialog.includes('This closes on its own'),
      'The screen says the message is temporary',
    ).toBe(true);
  });

  it('3. It is the only notification surface', async () => {
    expect(app.includes('<NotificationDialog />'), 'App renders the dialog').toBe(true);

    expect(!app.includes('Toast Notification Banner'), 'The old bottom-right banner is gone').toBe(
      true,
    );

    expect(!app.includes('toastMessage'), 'App no longer reads the single toast string').toBe(true);

    const moduleFiles = [
      'src/components/modules/DashboardModule.tsx',
      'src/components/modules/MaternityModule.tsx',
      'src/components/modules/ConfigurationModule.tsx',
    ];

    for (const path of moduleFiles) {
      const content =
        path === 'src/components/modules/MaternityModule.tsx'
          ? maternityModuleSource()
          : source(path);
      expect(
        !/fixed bottom-\d+ right-\d+[^"]*z-\d+/.test(content),
        `${path} does not draw its own toast`,
      ).toBe(true);
    }
  });

  it('4. Motion is optional', async () => {
    expect(
      css.includes('@keyframes jali-notification-dialog'),
      'The dialog has a named entrance animation',
    ).toBe(true);

    expect(
      /\.notification-dialog\s*\{\s*animation:\s*jali-notification-dialog/.test(css),
      'The entrance animation is applied to the card',
    ).toBe(true);

    expect(
      css.includes('prefers-reduced-motion: reduce'),
      'The stylesheet knows the operating-system setting',
    ).toBe(true);

    const reduced = css.slice(css.indexOf('prefers-reduced-motion: reduce'));

    expect(
      reduced.includes('.notification-dialog') && reduced.includes('animation: none'),
      'Reduced motion removes the animation rather than shrinking it',
    ).toBe(true);

    expect(
      /260ms/.test(css),
      'The entrance is short enough to read as feedback, not a transition',
    ).toBe(true);
  });
});
