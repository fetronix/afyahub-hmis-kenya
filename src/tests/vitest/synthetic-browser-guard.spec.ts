import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const scripts = [
  resolve('scripts/synthetic-browser-smoke.mjs'),
  resolve('scripts/dashboard-browser-synthetic.mjs'),
];
const safeEnv = {
  ...process.env,
  BROWSER_SMOKE_SYNTHETIC: 'YES',
  SQL_HOST: '127.0.0.1',
  SQL_DB_NAME: 'jalicare_browser_test',
  SQL_ADMIN_USER: 'synthetic',
  SQL_ADMIN_PASSWORD: '',
  CHROME_EXECUTABLE_PATH: '/does-not-exist',
};

describe('Synthetic browser harness database guard', () => {
  for (const script of scripts)
    for (const [description, override] of [
      ['missing explicit acknowledgement', { BROWSER_SMOKE_SYNTHETIC: '' }],
      ['remote database host', { SQL_HOST: 'remote.example.test' }],
      ['non-synthetic database name', { SQL_DB_NAME: 'hospital' }],
    ] as const) {
      it(`${script.split('/').at(-1)} refuses ${description} before fixture creation`, () => {
        const result = spawnSync(process.execPath, [script], {
          env: { ...safeEnv, ...override },
          encoding: 'utf8',
          timeout: 10_000,
        });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('Use BROWSER_SMOKE_SYNTHETIC=YES');
        expect(result.stdout).not.toContain('Synthetic isolated fixture');
      });
    }
});
