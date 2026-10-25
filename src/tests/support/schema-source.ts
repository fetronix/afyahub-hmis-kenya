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
