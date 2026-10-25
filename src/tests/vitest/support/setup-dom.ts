/**
 * Vitest setup — DOM matchers
 *
 * Loaded for every spec, but only acts when a DOM exists. The React specs
 * opt into jsdom with `// @vitest-environment jsdom`; server specs stay in
 * node, and importing Testing Library there would throw because `document`
 * is undefined.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

if (typeof document !== 'undefined') {
  afterEach(() => {
    cleanup();
  });
}
