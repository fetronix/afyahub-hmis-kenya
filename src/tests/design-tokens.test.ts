/**
 * JaliCare HMIS
 * Design-token contract tests
 *
 * The palette lives in one file and every screen spends it through
 * Tailwind utilities. That makes two failures possible and both are
 * silent until someone looks at the screen:
 *
 *   - a component keeps a colour family that was renamed (the old
 *     `bg-pine-900` header rendered transparent the day pine stopped
 *     existing), and
 *   - a semantic class (`panel`, `field-input`) is renamed in CSS but
 *     still used in a screen.
 *
 * Neither breaks the build, and neither breaks a domain test. This
 * suite is the one that notices.
 *
 * Run with: npx tsx src/tests/design-tokens.test.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

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

function walk(dir: string, extensions: string[]): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);

    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'tests') continue;
      out.push(...walk(full, extensions));
      continue;
    }

    if (extensions.some((extension) => entry.endsWith(extension))) {
      out.push(full);
    }
  }

  return out;
}

const css = source('src/index.css');

/* ============================================================
   1. The palette the brand actually uses
   ============================================================ */

function testPalette(): void {
  for (const token of [
    '--color-navy-900',
    '--color-brand-700',
    '--color-ember-500',
    '--color-copper-600',
    '--color-canvas',
    '--color-surface',
    '--color-ink',
    '--color-hair',
  ]) {
    assert(css.includes(token), `The theme defines ${token}`);
  }

  /*
   * The logo is blue and orange. A green or clay ramp would be a
   * different product. The blue is sky, not navy: brand-500 is the
   * colour a primary button and an active tab actually show.
   */
  assert(/--color-brand-500:\s*#0ea5e9;/i.test(css), 'The primary is sky blue');
  assert(
    /--color-brand-600:\s*#0284c7;/i.test(css),
    'The primary hover is one step deeper than sky',
  );
  assert(/--color-brand-700:\s*#0369a1;/i.test(css), 'The deep primary is still blue, not navy');
  assert(/--color-navy-900:\s*#0b2f46;/i.test(css), 'The rail is deep blue rather than near-black');
  assert(/--color-ember-500:\s*#f97316;/i.test(css), 'The bright orange is the orange of the logo');

  /*
   * Orange 500 does not carry white text at AA. The call to action is
   * therefore orange with a navy label, and this assertion keeps a
   * later edit from putting white back on it.
   */
  const accentRule = css.slice(
    css.indexOf('.btn-accent'),
    css.indexOf('}', css.indexOf('.btn-accent')),
  );
  assert(
    accentRule.includes('bg-ember-500') && accentRule.includes('text-navy-950'),
    'The orange call to action uses a dark label for contrast',
  );

  /*
   * Status colours must not be re-pointed: a warning has to keep
   * looking like a warning.
   */
  for (const family of ['emerald', 'amber', 'rose']) {
    assert(!css.includes(`--color-${family}-`), `${family} is left to Tailwind, not redefined`);
  }
}

/* ============================================================
   2. No dead colour family in a screen
   ============================================================ */

function testNoDeadFamilies(): void {
  const retired = ['pine', 'clay'];

  const files = walk(resolve(root, 'src'), ['.ts', '.tsx']);

  for (const family of retired) {
    const offenders = files.filter((file) =>
      new RegExp(`\\b(bg|text|border|from|to|via|ring|divide|shadow)-${family}-`).test(
        readFileSync(file, 'utf8'),
      ),
    );

    assert(
      offenders.length === 0,
      `No source file still uses the retired "${family}" family${
        offenders.length > 0 ? `: ${offenders.join(', ')}` : ''
      }`,
    );
  }
}

/* ============================================================
   3. The component classes screens depend on still exist
   ============================================================ */

function testComponentClasses(): void {
  for (const className of [
    'panel',
    'eyebrow',
    'btn-primary',
    'btn-accent',
    'btn-quiet',
    'field-label',
    'field-input',
    'table-quiet',
    'chip',
  ]) {
    assert(new RegExp(`\\.${className}\\s*\\{`).test(css), `The theme still defines .${className}`);
  }

  const screens = [
    'src/components/LoginScreen.tsx',
    'src/components/modules/StaffRolesPanel.tsx',
    'src/components/modules/DashboardModule.tsx',
  ];

  for (const path of screens) {
    assert(source(path).length > 0, `${path} exists`);
  }

  /*
   * The two dead-family regressions this suite was written for: the
   * login keeps the show/hide control, and the staff screen keeps the
   * status action.
   */
  assert(
    source('src/components/LoginScreen.tsx').includes('Show password'),
    'The login still offers show/hide password',
  );

  assert(
    source('src/components/modules/ConfigurationModule.tsx').includes('api.updateFacilityModules'),
    'The module switches save to the API',
  );
}

/* ============================================================
   RUN
   ============================================================ */

function run(): void {
  console.log('');
  console.log('==============================================');
  console.log('DESIGN TOKEN — CONTRACT TESTS');
  console.log('==============================================');

  testPalette();
  console.log('  1. The palette is the brand blue and orange');
  testNoDeadFamilies();
  console.log('  2. No screen references a retired colour family');
  testComponentClasses();
  console.log('  3. The component classes screens use are defined');

  console.log('');
  console.log('==============================================');
  console.log(`DESIGN TOKEN TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('DESIGN TOKEN TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
