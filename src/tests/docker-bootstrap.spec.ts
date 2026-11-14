import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertCleanCheckout,
  isLocalDockerEndpoint,
  parsePublishedPort,
  runDockerBootstrap,
  TEST_COMPOSE_FILE,
} from '../../scripts/test-docker.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/*
 * A checkout the bootstrap will accept.
 *
 * These tests used to pass the repository itself as the bootstrap root, which
 * made them depend on whoever ran them: after `npm run build:server` the
 * directory contains `build/scripts/migrate.js`, and the stale-build guard
 * correctly refuses it, so ten orchestration tests failed for a reason that
 * had nothing to do with orchestration. The script's own guard is tested
 * against a real directory below; the orchestration tests get a checkout they
 * control.
 */
const fixtureRoots: string[] = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function cleanCheckoutRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'jalicare-clean-checkout-'));
  fixtureRoots.push(root);
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, TEST_COMPOSE_FILE), 'synthetic compose file');
  writeFileSync(join(root, 'package-lock.json'), '{}');
  writeFileSync(join(root, 'scripts/migrate.ts'), 'synthetic source');
  return root;
}

type Call = {
  command: string;
  args: string[];
  options: { cwd: string; env: Record<string, string>; mode?: string };
};

function fakeCommands(failAt?: string) {
  const calls: Call[] = [];
  const run = async (command: string, args: string[], options: Call['options']) => {
    calls.push({ command, args, options: { ...options, env: { ...options.env } } });
    const action = args.includes('up')
      ? 'up'
      : args.includes('down')
        ? 'down'
        : args.includes('psql')
          ? 'attestation'
          : command.startsWith('npm')
            ? args.join(' ')
            : '';
    const code = action && action === failAt ? 7 : 0;
    const stdout =
      args[0] === 'context'
        ? 'unix:///var/run/docker.sock\n'
        : args.includes('port')
          ? '127.0.0.1:49123\n'
          : args.includes('psql')
            ? '7539141296746153100\n'
            : '';
    return { code, stdout, stderr: '', signal: null };
  };
  return { calls, run };
}

const inheritedEnv = {
  PATH: process.env.PATH ?? '',
  HOME: '/some/real/home',
  DOCKER_HOST: 'unix:///var/run/docker.sock',
  SQL_HOST: 'production.example.test',
  SQL_ADMIN_PASSWORD: 'not-the-test-password',
  SHA_MODE: 'production',
  SHA_CLIENT_SECRET: 'not-a-test-secret',
  COMPOSE_FILE: 'docker-compose.yml',
  COMPOSE_PROJECT_NAME: 'jalicare',
  NODE_OPTIONS: '--require=some-real-config',
  JALICARE_TEST_PG_SYSTEM_IDENTIFIER: '1',
  HTTP_PROXY: 'http://proxy.example.test:8080',
};
const silent = () => undefined;

describe('fresh Docker test bootstrap', () => {
  it('references the existing test Compose service and migration dispatcher/source', () => {
    expect(packageJson.scripts['test:docker']).toBe('node scripts/test-docker.mjs');
    expect(packageJson.scripts['db:migrate']).toBe('node scripts/run-script.mjs migrate');
    expect(existsSync(join(ROOT, TEST_COMPOSE_FILE))).toBe(true);
    const compose = readFileSync(join(ROOT, TEST_COMPOSE_FILE), 'utf8');
    expect(compose).toMatch(/^\s+db:\s*$/m);
    expect(compose).toContain('image: postgres:16');
    expect(compose).toMatch(/^\s+POSTGRES_PASSWORD:\s*$/m);
    expect(compose).toContain('POSTGRES_DB: jalicare_synthetic_test');
    expect(compose).toContain("'127.0.0.1::5432'");
    expect(compose).toContain('tmpfs:');
    expect(compose).not.toMatch(/^\s*volumes:/m);
    const dispatcher = readFileSync(join(ROOT, 'scripts/run-script.mjs'), 'utf8');
    expect(dispatcher).toMatch(/migrate:\s*['"]scripts\/migrate\.ts['"]/);
    expect(existsSync(join(ROOT, 'scripts/migrate.ts'))).toBe(true);
  });

  it('runs the requested commands in order with an isolated, required test database', async () => {
    const { calls, run } = fakeCommands();
    await runDockerBootstrap({
      root: cleanCheckoutRoot(),
      parentEnv: inheritedEnv,
      run,
      log: silent,
      warn: silent,
    });

    const up = calls.findIndex((call) => call.args.includes('up'));
    const install = calls.findIndex((call) => call.args.join(' ') === 'ci');
    const ready = calls.findIndex((call) => call.args.includes('pg_isready'));
    const attestation = calls.findIndex((call) => call.args.includes('psql'));
    const migrate = calls.findIndex((call) => call.args.join(' ') === 'run db:migrate -- --yes');
    const test = calls.findIndex((call) => call.args.join(' ') === 'test');
    const down = calls.findIndex((call) => call.args.includes('down'));
    expect(
      [up, install, ready, attestation, migrate, test, down].every((index) => index >= 0),
    ).toBe(true);
    expect(up).toBeLessThan(install);
    expect(install).toBeLessThan(ready);
    expect(ready).toBeLessThan(attestation);
    expect(attestation).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(test);
    expect(test).toBeLessThan(down);
    expect(calls[up].args).toContain(TEST_COMPOSE_FILE);
    expect(calls[up].args.slice(-3)).toEqual(['up', '-d', 'db']);
    expect(calls[down].args).toContain('--volumes');

    const env = calls[migrate].options.env;
    expect(env).toMatchObject({
      SQL_HOST: '127.0.0.1',
      SQL_PORT: '49123',
      SQL_DB_NAME: 'jalicare_synthetic_test',
      SQL_ADMIN_USER: 'jalicare_test',
      JALICARE_REQUIRE_DB: '1',
      JALICARE_TEST_PG_SYSTEM_IDENTIFIER: '7539141296746153100',
      SHA_MODE: 'mock',
      DHA_MODE: 'mock',
      DHA_ALLOW_PRODUCTION: 'false',
    });
    expect(env.SQL_ADMIN_PASSWORD).not.toBe(inheritedEnv.SQL_ADMIN_PASSWORD);
    expect(calls[up].options.env.POSTGRES_PASSWORD).toBe(env.SQL_ADMIN_PASSWORD);
    expect(calls[attestation].args).toContain(TEST_COMPOSE_FILE);
    expect(calls[attestation].args[calls[attestation].args.indexOf('-p') + 1]).toBe(
      calls[up].args[calls[up].args.indexOf('-p') + 1],
    );
    expect(calls[attestation].args.join(' ')).not.toContain(env.SQL_ADMIN_PASSWORD);
    expect(env.JALICARE_TEST_PG_SYSTEM_IDENTIFIER).not.toBe(
      inheritedEnv.JALICARE_TEST_PG_SYSTEM_IDENTIFIER,
    );
    expect(env.SHA_CLIENT_SECRET).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.COMPOSE_FILE).toBeUndefined();
    expect(env.HTTP_PROXY).toBeUndefined();
    expect(env.HOME).not.toBe(inheritedEnv.HOME);
    expect(existsSync(env.HOME)).toBe(false); // only the newly created temporary HOME was removed
    expect(calls[install].options.env.HTTP_PROXY).toBe(inheritedEnv.HTTP_PROXY);
    expect(calls[up].options.env.COMPOSE_PROJECT_NAME).toBeUndefined();
  });

  it.each(['up', 'ci', 'attestation', 'run db:migrate -- --yes', 'test', 'down'])(
    'propagates %s failure and cleans up only the unique test project',
    async (failure) => {
      const { calls, run } = fakeCommands(failure);
      await expect(
        runDockerBootstrap({
          root: cleanCheckoutRoot(),
          parentEnv: inheritedEnv,
          run,
          log: silent,
          warn: silent,
        }),
      ).rejects.toMatchObject({ exitCode: 7 });
      const up = calls.find((call) => call.args.includes('up'))!;
      const down = calls.find((call) => call.args.includes('down'))!;
      expect(up.args[up.args.indexOf('-p') + 1]).toMatch(/^jalicare-test-[a-f0-9]{20}$/);
      expect(down.args[down.args.indexOf('-p') + 1]).toBe(up.args[up.args.indexOf('-p') + 1]);
      if (failure !== 'test' && failure !== 'down') {
        expect(calls.some((call) => call.args.join(' ') === 'test')).toBe(false);
      }
      if (failure === 'attestation') {
        expect(calls.some((call) => call.args.join(' ') === 'run db:migrate -- --yes')).toBe(false);
      }
    },
  );

  it('refuses local configuration without altering it', () => {
    const root = mkdtempSync(join(tmpdir(), 'jalicare-bootstrap-spec-'));
    try {
      mkdirSync(join(root, 'scripts'));
      writeFileSync(join(root, TEST_COMPOSE_FILE), 'synthetic');
      writeFileSync(join(root, 'package-lock.json'), '{}');
      writeFileSync(join(root, 'scripts/migrate.ts'), 'synthetic');
      writeFileSync(join(root, '.env.test.local'), 'synthetic configuration');
      expect(() => assertCleanCheckout(root)).toThrow(/fresh checkout/);
      expect(readFileSync(join(root, '.env.test.local'), 'utf8')).toBe('synthetic configuration');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a checkout with a previously built migration script', () => {
    /*
     * The dispatcher prefers `build/scripts/migrate.js` over the source when it
     * exists, so a Docker test run on a checkout that was built for deployment
     * would migrate with whatever that bundle contains. The guard refuses, and
     * this is the test that keeps it refusing — it was untested until a local
     * `npm run build:server` made ten other tests fail and pointed at it.
     */
    const root = cleanCheckoutRoot();
    mkdirSync(join(root, 'build', 'scripts'), { recursive: true });
    writeFileSync(join(root, 'build', 'scripts', 'migrate.js'), 'stale bundle');

    expect(() => assertCleanCheckout(root)).toThrow(/previously built migration script/);
    // And the refusal must not delete the artifact: it is the thing being
    // protected, and the operator may still need it.
    expect(existsSync(join(root, 'build', 'scripts', 'migrate.js'))).toBe(true);
  });

  it('rejects remote Docker and non-loopback published database ports', () => {
    expect(isLocalDockerEndpoint('unix:///var/run/docker.sock')).toBe(true);
    expect(isLocalDockerEndpoint('tcp://127.0.0.1:2375')).toBe(true);
    expect(isLocalDockerEndpoint('ssh://remote.example.test')).toBe(false);
    expect(parsePublishedPort('127.0.0.1:49123\n')).toBe('49123');
    expect(() => parsePublishedPort('0.0.0.0:5432')).toThrow(/refusing to migrate/);
  });

  it('refuses a malformed cluster attestation before migration or tests', async () => {
    const fake = fakeCommands();
    const run = async (command: string, args: string[], options: Call['options']) => {
      const result = await fake.run(command, args, options);
      return args.includes('psql') ? { ...result, stdout: 'not-a-cluster-identifier\n' } : result;
    };
    await expect(
      runDockerBootstrap({
        root: cleanCheckoutRoot(),
        parentEnv: inheritedEnv,
        run,
        log: silent,
        warn: silent,
      }),
    ).rejects.toThrow(/cluster identity was not valid/);
    expect(fake.calls.some((call) => call.args.join(' ') === 'run db:migrate -- --yes')).toBe(
      false,
    );
    expect(fake.calls.some((call) => call.args.join(' ') === 'test')).toBe(false);
    expect(fake.calls.some((call) => call.args.includes('down'))).toBe(true);
  });

  it('does not start a project if its random name already owns Docker resources', async () => {
    const fake = fakeCommands();
    const run = async (command: string, args: string[], options: Call['options']) => {
      const result = await fake.run(command, args, options);
      return args[0] === 'volume' ? { ...result, stdout: 'existing-volume\n' } : result;
    };
    await expect(
      runDockerBootstrap({
        root: cleanCheckoutRoot(),
        parentEnv: inheritedEnv,
        run,
        log: silent,
        warn: silent,
      }),
    ).rejects.toThrow(/already has resources/);
    expect(fake.calls.some((call) => call.args.includes('up'))).toBe(false);
    expect(fake.calls.some((call) => call.args.includes('down'))).toBe(false);
  });

  it('cleans up and never migrates if the new database is not ready', async () => {
    const fake = fakeCommands();
    const run = async (command: string, args: string[], options: Call['options']) => {
      const result = await fake.run(command, args, options);
      return args.includes('pg_isready') ? { ...result, code: 1 } : result;
    };
    await expect(
      runDockerBootstrap({
        root: cleanCheckoutRoot(),
        parentEnv: inheritedEnv,
        run,
        readyAttempts: 2,
        sleep: async () => undefined,
        log: silent,
        warn: silent,
      }),
    ).rejects.toThrow(/did not become ready/);
    expect(fake.calls.some((call) => call.args.includes('down'))).toBe(true);
    expect(fake.calls.some((call) => call.args.includes('db:migrate'))).toBe(false);
  });
});
