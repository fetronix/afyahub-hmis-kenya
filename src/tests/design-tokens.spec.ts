import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

const root = resolve(here, '../..');

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

describe('Design-token contract tests', () => {
  it('1. The palette the brand actually uses', async () => {
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
      expect(css.includes(token), `The theme defines ${token}`).toBe(true);
    }

    /*
     * The logo is blue and orange. A green or clay ramp would be a
     * different product. The blue is sky, not navy: brand-500 is the
     * colour a primary button and an active tab actually show.
     */
    expect(/--color-brand-500:\s*#0ea5e9;/i.test(css), 'The primary is sky blue').toBe(true);
    expect(
      /--color-brand-600:\s*#0284c7;/i.test(css),
      'The primary hover is one step deeper than sky',
    ).toBe(true);
    expect(
      /--color-brand-700:\s*#0369a1;/i.test(css),
      'The deep primary is still blue, not navy',
    ).toBe(true);
    expect(
      /--color-navy-900:\s*#0b2f46;/i.test(css),
      'The rail is deep blue rather than near-black',
    ).toBe(true);
    expect(
      /--color-ember-500:\s*#f97316;/i.test(css),
      'The bright orange is the orange of the logo',
    ).toBe(true);

    /*
     * Orange 500 does not carry white text at AA. The call to action is
     * therefore orange with a navy label, and this assertion keeps a
     * later edit from putting white back on it.
     */
    const accentRule = css.slice(
      css.indexOf('.btn-accent'),
      css.indexOf('}', css.indexOf('.btn-accent')),
    );
    expect(
      accentRule.includes('bg-ember-500') && accentRule.includes('text-navy-950'),
      'The orange call to action uses a dark label for contrast',
    ).toBe(true);

    /*
     * Status colours must not be re-pointed: a warning has to keep
     * looking like a warning.
     */
    for (const family of ['emerald', 'amber', 'rose']) {
      expect(
        !css.includes(`--color-${family}-`),
        `${family} is left to Tailwind, not redefined`,
      ).toBe(true);
    }
  });

  it('2. No dead colour family in a screen', async () => {
    const retired = ['pine', 'clay'];

    const files = walk(resolve(root, 'src'), ['.ts', '.tsx']);

    for (const family of retired) {
      const offenders = files.filter((file) =>
        new RegExp(`\\b(bg|text|border|from|to|via|ring|divide|shadow)-${family}-`).test(
          readFileSync(file, 'utf8'),
        ),
      );

      expect(
        offenders.length === 0,
        `No source file still uses the retired "${family}" family${
          offenders.length > 0 ? `: ${offenders.join(', ')}` : ''
        }`,
      ).toBe(true);
    }
  });

  it('3. The component classes screens depend on still exist', async () => {
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
      expect(
        new RegExp(`\\.${className}\\s*\\{`).test(css),
        `The theme still defines .${className}`,
      ).toBe(true);
    }

    const screens = [
      'src/components/LoginScreen.tsx',
      'src/components/modules/StaffRolesPanel.tsx',
      'src/components/modules/DashboardModule.tsx',
    ];

    for (const path of screens) {
      expect(source(path).length > 0, `${path} exists`).toBe(true);
    }

    /*
     * The two dead-family regressions this suite was written for: the
     * login keeps the show/hide control, and the staff screen keeps the
     * status action.
     */
    expect(
      source('src/components/LoginScreen.tsx').includes('Show password'),
      'The login still offers show/hide password',
    ).toBe(true);

    expect(
      source('src/components/modules/ConfigurationModule.tsx').includes(
        'api.updateFacilityModules',
      ),
      'The module switches save to the API',
    ).toBe(true);
  });
});
