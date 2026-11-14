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

    // The approved dashboard direction uses a deeper hospital-blue action ramp;
    // the navy frame and orange brand accent remain part of the identity.
    expect(/--color-brand-500:\s*#2c78f6;/i.test(css), 'The bright blue token').toBe(true);
    expect(/--color-brand-600:\s*#075cf1;/i.test(css), 'The middle blue token').toBe(true);
    expect(/--color-brand-700:\s*#0756d6;/i.test(css), 'The primary-action blue').toBe(true);
    expect(/--color-navy-900:\s*#0b2f46;/i.test(css), 'The navy brand frame').toBe(true);
    expect(/--color-ember-500:\s*#f97316;/i.test(css), 'The orange brand accent').toBe(true);

    // White primary-action text must remain readable against the actual token,
    // rather than assuming that every blue step has sufficient contrast.
    const luminance = (hex: string) => {
      const channels = hex.match(/.{2}/g)!.map((part) => {
        const value = parseInt(part, 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const primary = css.match(/--color-brand-700:\s*#([0-9a-f]{6});/i)![1];
    expect(
      1.05 / (luminance(primary) + 0.05),
      'White on primary meets WCAG AA for normal text',
    ).toBeGreaterThanOrEqual(4.5);
    for (const selector of ['.btn-primary', '.btn-accent', '.ui-button-primary']) {
      const rule = css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)));
      expect(
        rule.includes('bg-brand-700') && rule.includes('text-white'),
        `${selector} uses the tested pair`,
      ).toBe(true);
    }

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
