/**
 * The deployment guide describes settings the software must actually read.
 *
 * Found the hard way: `docs/deployment/truehost-cpanel.md` §5 told operators to
 * set `DEFAULT_TIMEZONE`, and nothing in the application ever read it. The
 * instruction was harmless-looking and wrong, which is the worst kind — a
 * deployment that looks configured and prints the wrong time.
 *
 * This suite parses the environment table out of the guide and fails when a
 * documented variable is read by no code. Exceptions are named one by one, with
 * the reason, so adding a variable to the guide is a decision rather than a
 * typo.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const GUIDE = 'docs/deployment/truehost-cpanel.md';

/**
 * Variables that are legitimately not read by our own code.
 *
 * Keyed by name, because a positional allowlist silently allows the wrong
 * thing once the guide is reordered.
 */
const NOT_READ_BY_US: Record<string, string> = {
  // Intentionally empty: every variable in §5 is read by the application.
  // The test below fails if an entry is added for a variable that is, in
  // fact, read — that is how this list stops being a place to hide gaps.
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * How a variable can be read:
 *
 *   process.env.SQL_HOST          direct lookup
 *   process.env['SQL_HOST']       bracket lookup
 *   booleanFlag('SQL_SSL', false) passed to a helper that reads process.env
 *   env.APP_BASE_URL              off a locally-built config object
 *   read('DHA_MODE')              the integrations' own helper
 *
 * The last three are why "find `process.env.X`" is not enough: this codebase
 * deliberately funnels most environment access through helpers that take the
 * name as an argument, so a literal-name search is the only honest check.
 */
function isReadSomewhere(name: string, corpus: string): boolean {
  const propertyAccess = new RegExp(`\\.${name}\\b`);
  const literal = new RegExp(`['"\`]${name}['"\`]`);
  return propertyAccess.test(corpus) || literal.test(corpus);
}

/** All non-test source, concatenated. */
function sourceCorpus(): string {
  const files = [
    ...walk(resolve(ROOT, 'src')),
    ...walk(resolve(ROOT, 'scripts')),
    resolve(ROOT, 'server.ts'),
  ].filter((file) => !file.includes(`${join('src', 'tests')}`));

  return files.map((file) => readFileSync(file, 'utf8')).join('\n');
}

/** The rows of the §5 environment table: `| \`NAME\` | value |`. */
function documentedEnvNames(): string[] {
  const guide = readFileSync(resolve(ROOT, GUIDE), 'utf8');
  const section = guide.slice(guide.indexOf('## 5. Environment variables'), guide.indexOf('## 6.'));
  const names: string[] = [];

  for (const line of section.split('\n')) {
    const match = line.match(/^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|/);
    if (match) names.push(match[1]);
  }

  return names;
}

describe('deployment guide environment contract', () => {
  it('lists environment variables at all', () => {
    // Guards the parser: a reformatted table that yields nothing would make
    // every assertion below vacuously true.
    const names = documentedEnvNames();
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(names).toContain('SQL_HOST');
    expect(names).toContain('DEFAULT_TIMEZONE');
  });

  it('only documents variables the software reads', () => {
    const corpus = sourceCorpus();
    const documented = documentedEnvNames();

    const unread = documented.filter(
      (name) => !isReadSomewhere(name, corpus) && !(name in NOT_READ_BY_US),
    );
    expect(unread, `documented but read by nothing: ${unread.join(', ')}`).toEqual([]);
  });

  it('keeps the exception list honest', () => {
    const corpus = sourceCorpus();
    const documented = documentedEnvNames();

    // An exception for a variable that is no longer documented, or that is in
    // fact read, is stale scaffolding that hides the next real gap.
    for (const name of Object.keys(NOT_READ_BY_US)) {
      const stillNeeded = documented.includes(name) && !isReadSomewhere(name, corpus);
      if (!stillNeeded) {
        throw new Error(
          `NOT_READ_BY_US lists ${name}, but it is ${documented.includes(name) ? 'now read by the application' : 'no longer documented'}. Remove the exception.`,
        );
      }
    }
  });

  it('documents the timezone setting as something that takes effect', () => {
    const guide = readFileSync(resolve(ROOT, GUIDE), 'utf8');
    // The exact claim that was false before `src/config/timezone.ts` existed.
    expect(guide).toContain('applied at startup to `process.env.TZ`');
    expect(guide).toMatch(/rejected with a warning/);
  });

  it('names an npm script that exists for every command it tells operators to run', () => {
    const guide = readFileSync(resolve(ROOT, GUIDE), 'utf8');
    const scripts = Object.keys(
      JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).scripts as Record<
        string,
        string
      >,
    );
    const invoked = new Set([...guide.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)].map((m) => m[1]));

    expect(invoked.size).toBeGreaterThan(0);
    expect([...invoked].filter((name) => !scripts.includes(name))).toEqual([]);
  });
});
