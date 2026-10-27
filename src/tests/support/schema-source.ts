/**
 * The schema, as one searchable string
 *
 * WHY THIS EXISTS
 *
 * Twelve legacy suites assert that `src/db/schema.ts` contains a given
 * string — a table name, an index name, a column default. That worked while
 * the schema was one file. It is being split into domain modules, so a
 * definition can now live in the barrel or in any file under
 * `src/db/schema/`, and reading only the barrel fails the moment a table
 * moves.
 *
 * The first extraction (tenancy) broke `facility-modules.test.ts` for
 * exactly that reason. Patching each suite as its tables move would mean
 * touching a dozen files across a dozen commits, each one a chance to weaken
 * an assertion carelessly. This helper fixes the class of problem once.
 *
 * WHAT IT DOES NOT DO
 *
 * These are still text assertions. They prove a declaration exists, not that
 * it behaves. `npm run test:unit` is where behaviour is tested, and the
 * eventual answer is to replace these with executed assertions — see
 * `docs/testing/KNOWN-GAPS.md`. This helper keeps them honest in the
 * meantime rather than letting them rot into false failures.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `src/tests/support/` → repository root. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * The barrel plus every domain module, concatenated.
 *
 * Order is barrel-first, then modules alphabetically, so the result is
 * deterministic across platforms — a test that passes on one machine passes
 * on another.
 */
export function schemaSource(): string {
  let text = readFileSync(resolve(ROOT, 'src/db/schema.ts'), 'utf8');

  const modulesDir = resolve(ROOT, 'src/db/schema');

  let modules: string[] = [];

  try {
    modules = readdirSync(modulesDir)
      .filter((file) => file.endsWith('.ts'))
      .sort();
  } catch {
    /* No modules yet: the barrel is the whole schema. */
    return text;
  }

  for (const file of modules) {
    text += `\n${readFileSync(resolve(modulesDir, file), 'utf8')}`;
  }

  return text;
}

/**
 * One domain module, as a searchable string.
 *
 * `schemaSource()` concatenates the barrel and every module, which is right
 * for "does this declaration exist anywhere". It is wrong for "assert
 * something about the block of tables that starts at `export const X`": a
 * slice needs both ends to come from the same file, and the barrel is
 * concatenated first, so a boundary marker in the barrel resolves *before*
 * the table it is meant to follow.
 *
 * This reads one module on its own. The name is the file stem — `maternity`,
 * `billing`, `platform` — matching `src/db/schema/<name>.ts`.
 */
export function schemaModule(name: string): string {
  return readFileSync(resolve(ROOT, `src/db/schema/${name}.ts`), 'utf8');
}

/**
 * The query barrel plus every `src/db/queries/*.ts` module, concatenated.
 *
 * Same reason as `schemaSource()`: a query function can now live in the
 * barrel or in any module beside it, and a suite that reads only the barrel
 * fails the moment the function it asserts on moves.
 *
 * What this still is: a text assertion. It proves a call site exists, not
 * that it does the right thing. The behavioural specs are the ones that
 * run the query.
 */
export function queriesSource(): string {
  let text = readFileSync(resolve(ROOT, 'src/db/queries.ts'), 'utf8');

  const modulesDir = resolve(ROOT, 'src/db/queries');

  let modules: string[] = [];

  try {
    modules = readdirSync(modulesDir)
      .filter((file) => file.endsWith('.ts'))
      .sort();
  } catch {
    return text;
  }

  for (const file of modules) {
    text += `\n${readFileSync(resolve(modulesDir, file), 'utf8')}`;
  }

  return text;
}

/**
 * One function's source, from its declaration to its closing brace.
 *
 * `queriesSource()` concatenates modules, so slicing to the *next*
 * `export async function` can run past the end of a file and pick up a
 * neighbouring function's body. That turns a negative assertion into a
 * silent pass. Brace matching keeps the slice inside the function.
 */
export function functionBody(source: string, name: string): string {
  const patterns = [`export async function ${name}(`, `export function ${name}(`];

  let start = -1;

  for (const pattern of patterns) {
    start = source.indexOf(pattern);
    if (start !== -1) break;
  }

  if (start === -1) return '';

  let depth = 0;
  let opened = false;

  for (let i = start; i < source.length; i += 1) {
    const char = source[i];

    if (char === '{') {
      depth += 1;
      opened = true;
    } else if (char === '}') {
      depth -= 1;
      if (opened && depth === 0) return source.slice(start, i + 1);
    }
  }

  return source.slice(start);
}

/**
 * The server shell plus every route module, concatenated.
 *
 * `src/app.ts` used to register every route inline. The routes now live in
 * `src/routes/domains/` and are mounted by `src/routes/index.ts`, so "is this
 * route registered?" is a question about the pair, not about one file.
 *
 * This is still a text assertion. It proves a route is declared; the specs
 * that actually issue a request are the ones that prove it works.
 */
export function appSource(options: { stripComments?: boolean } = {}): string {
  const files = ['src/app.ts', 'src/routes/index.ts'];

  const domainsDir = resolve(ROOT, 'src/routes/domains');

  try {
    for (const file of readdirSync(domainsDir)
      .filter((f) => f.endsWith('.ts'))
      .sort()) {
      files.push(`src/routes/domains/${file}`);
    }
  } catch {
    /* No domains directory: app.ts is self-contained. */
  }

  const text = files.map((file) => readFileSync(resolve(ROOT, file), 'utf8')).join('\n');

  /*
   * Some suites assert that a phrase is *absent*. A phrase in a comment is
   * not a call site, so those suites strip comments first - the same thing
   * they did with their own `code()` helper before the routes moved.
   */
  if (options.stripComments) {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }

  return text;
}
