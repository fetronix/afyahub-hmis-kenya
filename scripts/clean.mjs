/**
 * JaliCare HMIS
 * Remove build output.
 *
 * A shell one-liner (`rm -rf dist build`) does not run in cmd.exe on
 * Windows, where the deployment build is made. This does the same thing
 * on every platform, and refuses to delete anything outside the project
 * directory.
 */

import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/*
 * `server.js` at the root is what an older build wrote; the current one
 * writes build/server.js. Removing it keeps a stale copy from being
 * started by a cPanel setting that still points at it. `server.ts`
 * (the source) is untouched.
 */
for (const name of ['dist', 'build', 'server.js']) {
  const target = resolve(ROOT, name);

  if (dirname(target) !== ROOT) {
    console.error(`Refusing to delete outside the project: ${target}`);
    process.exit(1);
  }

  await rm(target, { recursive: true, force: true });
  console.log(`Cleaned ${name}`);
}
