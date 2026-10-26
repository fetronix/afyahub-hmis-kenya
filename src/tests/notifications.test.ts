/**
 * JaliCare HMIS
 * Notification dialog — contract tests
 *
 * The previous notification was a single string rendered bottom-right.
 * Two messages raised inside four seconds fought over one timer, and
 * the banner always wore a green tick — including when the message was
 * "Could not save the module list."
 *
 * The dialog is centred, animated, and queued. These checks keep the
 * parts that matter from drifting: one surface, every message shown,
 * a tone that is not invented, an escape route, and motion that
 * respects the operating system's setting.
 *
 * Run with: npx tsx src/tests/notifications.test.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

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

/* ============================================================
   1. The queue lives in one place
   ============================================================ */

function testQueue(): void {
  assert(
    NOTIFICATION_LIFETIME_MS >= 4000 && NOTIFICATION_LIFETIME_MS <= 8000,
    'A notification stays long enough to read and short enough to ignore',
  );

  assert(NOTIFICATION_QUEUE_LIMIT >= 3 && NOTIFICATION_QUEUE_LIMIT <= 6, 'The queue is bounded');

  assert(
    context.includes('notifications: AppNotification[]'),
    'The provider exposes a list, not one overwritten string',
  );

  assert(!/\btoastMessage\b/.test(context), 'The single toast string is gone from the provider');

  assert(
    context.includes('notificationTimers') && context.includes('clearTimeout'),
    'Each notification owns its timer',
  );

  assert(
    context.includes("const tone = options?.tone ?? 'info'"),
    'A caller that says nothing gets a neutral tone, not a green tick',
  );

  assert(
    context.includes('dismissNotification') && context.includes('dismissAllNotifications'),
    'Both one and all can be dismissed',
  );

  assert(
    context.includes('window.clearTimeout(timer)') &&
      context.includes('notificationTimers.current.clear()'),
    'Timers are cleared on dismissal and on unmount',
  );
}

/* ============================================================
   2. The dialog is centred, animated and dismissible
   ============================================================ */

function testDialog(): void {
  assert(
    /fixed inset-0[^"]*flex items-center justify-center/.test(dialog),
    'The dialog is centred on the viewport',
  );

  assert(
    dialog.includes('pointer-events-none fixed inset-0'),
    'The backdrop does not trap the operator mid-workflow',
  );

  assert(
    dialog.includes('role="status"') && dialog.includes('aria-live="polite"'),
    'A screen reader is told about the message without an alarm',
  );

  assert(dialog.includes("event.key === 'Escape'"), 'Escape closes the queue');

  assert(dialog.includes('Dismiss all notifications'), 'There is a labelled close control');

  assert(
    dialog.includes('notification-dialog') &&
      dialog.includes('notification-item') &&
      dialog.includes('notification-scrim'),
    'The card, its rows and its wash each animate',
  );

  assert(
    dialog.includes('info: {') &&
      dialog.includes('success: {') &&
      dialog.includes('warning: {') &&
      dialog.includes('error: {'),
    'Four tones, each with its own word and colour',
  );

  assert(dialog.includes('Did not go through'), 'A failure is labelled as a failure');

  assert(dialog.includes('This closes on its own'), 'The screen says the message is temporary');
}

/* ============================================================
   3. It is the only notification surface
   ============================================================ */

function testSingleSurface(): void {
  assert(app.includes('<NotificationDialog />'), 'App renders the dialog');

  assert(!app.includes('Toast Notification Banner'), 'The old bottom-right banner is gone');

  assert(!app.includes('toastMessage'), 'App no longer reads the single toast string');

  const moduleFiles = [
    'src/components/modules/DashboardModule.tsx',
    'src/components/modules/MaternityModule.tsx',
    'src/components/modules/ConfigurationModule.tsx',
  ];

  for (const path of moduleFiles) {
    assert(
      !/fixed bottom-\d+ right-\d+[^"]*z-\d+/.test(source(path)),
      `${path} does not draw its own toast`,
    );
  }
}

/* ============================================================
   4. Motion is optional
   ============================================================ */

function testMotion(): void {
  assert(
    css.includes('@keyframes jali-notification-dialog'),
    'The dialog has a named entrance animation',
  );

  assert(
    /\.notification-dialog\s*\{\s*animation:\s*jali-notification-dialog/.test(css),
    'The entrance animation is applied to the card',
  );

  assert(
    css.includes('prefers-reduced-motion: reduce'),
    'The stylesheet knows the operating-system setting',
  );

  const reduced = css.slice(css.indexOf('prefers-reduced-motion: reduce'));

  assert(
    reduced.includes('.notification-dialog') && reduced.includes('animation: none'),
    'Reduced motion removes the animation rather than shrinking it',
  );

  assert(/260ms/.test(css), 'The entrance is short enough to read as feedback, not a transition');
}

/* ============================================================
   RUN
   ============================================================ */

function run(): void {
  console.log('');
  console.log('==============================================');
  console.log('NOTIFICATION DIALOG — CONTRACT TESTS');
  console.log('==============================================');

  testQueue();
  console.log('  1. One queue, one timer per message, a neutral default tone');
  testDialog();
  console.log('  2. Centred, animated, labelled, dismissible with Escape');
  testSingleSurface();
  console.log('  3. App renders the only notification surface');
  testMotion();
  console.log('  4. Motion is removed for prefers-reduced-motion');

  console.log('');
  console.log('==============================================');
  console.log(`NOTIFICATION TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('NOTIFICATION TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
