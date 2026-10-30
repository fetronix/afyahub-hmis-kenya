#!/usr/bin/env node
/**
 * Run the complete test suite against a new, disposable Compose database.
 * This deliberately does not use the deployment Compose project or .env.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TEST_COMPOSE_FILE = 'docker-compose.test.yml';
const TEST_DB = 'jalicare_test';

// Never pass application, payer, database, Node, npm or COMPOSE_* settings
// through from the caller. Docker settings are used only by the Docker CLI.
const SYSTEM_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'USERPROFILE',
  'XDG_RUNTIME_DIR',
]);
const DOCKER_KEYS = new Set([
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_CERT_PATH',
  'DOCKER_TLS_VERIFY',
]);
const NETWORK_KEYS = new Set([
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
]);

function copyAllowed(env, keys) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key, value]) => value !== undefined && keys.has(key.toUpperCase()),
    ),
  );
}

function systemEnvironment(env) {
  const result = copyAllowed(env, SYSTEM_KEYS);
  // `npm run` prepends node_modules/.bin before invoking this script. Resolve
  // Docker and npm from the system instead of a pre-existing project binary.
  for (const key of Object.keys(result)) {
    if (key.toUpperCase() === 'PATH') {
      result[key] = result[key]
        .split(delimiter)
        .filter((entry) => !/[\\/]node_modules[\\/]\.bin[\\/]?$/i.test(entry))
        .join(delimiter);
    }
  }
  return result;
}

export function assertCleanCheckout(root) {
  const localConfig = readdirSync(root).filter((name) => {
    const lower = name.toLowerCase();
    return (lower === '.env' || lower.startsWith('.env.')) && lower !== '.env.example';
  });
  if (localConfig.length || existsSync(join(root, '.npmrc'))) {
    throw new Error(
      'Use a fresh checkout without .env files or a project .npmrc; do not move or delete your existing configuration.',
    );
  }
  // The migration dispatcher otherwise prefers a potentially stale build.
  if (existsSync(join(root, 'build', 'scripts', 'migrate.js'))) {
    throw new Error('Use a fresh checkout without a previously built migration script.');
  }
  for (const name of [TEST_COMPOSE_FILE, 'package-lock.json', 'scripts/migrate.ts']) {
    if (!existsSync(join(root, name)))
      throw new Error(`Required checkout file is missing: ${name}`);
  }
}

export function isLocalDockerEndpoint(endpoint) {
  if (/^(unix|npipe):\/\//i.test(endpoint)) return true;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'tcp:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function parsePublishedPort(output) {
  const match = /^127\.0\.0\.1:(\d{1,5})$/.exec(output.trim());
  const port = Number(match?.[1]);
  if (!match || port < 1 || port > 65535) {
    throw new Error(
      'Compose did not report one loopback-only PostgreSQL port; refusing to migrate.',
    );
  }
  return String(port);
}

function runChild(command, args, { cwd, env, mode = 'inherit' }) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio:
        mode === 'capture' ? ['ignore', 'pipe', 'pipe'] : mode === 'quiet' ? 'ignore' : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (data) => (stdout += data));
    child.stderr?.on('data', (data) => (stderr += data));
    child.on('error', reject);
    child.on('close', (code, signal) => resolveResult({ code: code ?? 1, signal, stdout, stderr }));
  });
}

class CommandFailure extends Error {
  constructor(label, code) {
    super(`${label} failed with exit code ${code}.`);
    this.exitCode = code || 1;
  }
}

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

/** The injectable command runner lets the safety and failure paths be tested without Docker. */
export async function runDockerBootstrap({
  root = ROOT,
  parentEnv = process.env,
  run = runChild,
  sleep = wait,
  readyAttempts = 120,
  log = console.log,
  warn = console.error,
} = {}) {
  assertCleanCheckout(root);
  if (parentEnv.DOCKER_HOST && !isLocalDockerEndpoint(parentEnv.DOCKER_HOST)) {
    throw new Error('test:docker requires a local Docker daemon, not a remote DOCKER_HOST.');
  }

  const system = systemEnvironment(parentEnv);
  const dockerEnv = {
    ...system,
    ...copyAllowed(parentEnv, DOCKER_KEYS),
    ...copyAllowed(parentEnv, NETWORK_KEYS),
  };
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const exec = (command, args, env, mode = 'inherit') =>
    run(command, args, { cwd: root, env, mode });
  const checked = async (command, args, env, label, mode) => {
    const result = await exec(command, args, env, mode);
    if (result.code !== 0) throw new CommandFailure(label, result.code);
    return result;
  };

  try {
    await checked('docker', ['compose', 'version'], dockerEnv, 'Docker Compose');
  } catch (error) {
    throw new Error(`Docker with the Compose V2 plugin is required: ${error.message}`);
  }
  const context = await checked(
    'docker',
    ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
    dockerEnv,
    'Docker context inspection',
    'capture',
  );
  if (!isLocalDockerEndpoint(context.stdout.trim())) {
    throw new Error('test:docker requires a local Docker context, not a remote daemon.');
  }
  await checked(
    'docker',
    ['info', '--format', '{{.ServerVersion}}'],
    dockerEnv,
    'Docker daemon',
    'capture',
  );

  // Every run gets a new project, password, encryption key and private HOME.
  const project = `jalicare-test-${randomBytes(10).toString('hex')}`;
  const label = `label=com.docker.compose.project=${project}`;
  for (const args of [
    ['ps', '--all', '--quiet', '--filter', label],
    ['network', 'ls', '--quiet', '--filter', label],
    ['volume', 'ls', '--quiet', '--filter', label],
  ]) {
    const existing = await checked(
      'docker',
      args,
      dockerEnv,
      'Docker project isolation',
      'capture',
    );
    if (existing.stdout.trim()) {
      throw new Error(
        'The randomly named test project already has resources; no changes were made.',
      );
    }
  }
  const password = randomBytes(24).toString('hex');
  const home = mkdtempSync(join(tmpdir(), 'jalicare-test-'));
  const composeEnv = { ...dockerEnv, JALICARE_TEST_DB_PASSWORD: password };
  const testEnv = {
    ...system,
    HOME: home,
    USERPROFILE: home,
    npm_config_userconfig: join(home, 'user.npmrc'),
    npm_config_globalconfig: join(home, 'global.npmrc'),
    NODE_ENV: 'test',
    JALICARE_REQUIRE_DB: '1',
    SQL_HOST: '127.0.0.1',
    SQL_DB_NAME: TEST_DB,
    SQL_ADMIN_USER: TEST_DB,
    SQL_ADMIN_PASSWORD: password,
    SQL_SSL: 'false',
    SQL_SSL_REJECT_UNAUTHORIZED: 'true',
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    DHA_MODE: 'mock',
    DHA_ALLOW_PRODUCTION: 'false',
    SHA_MODE: 'mock',
    SHA_ALLOW_PRODUCTION: 'false',
    APP_BASE_URL: 'http://localhost:3000',
    TRUST_PROXY: 'false',
    TZ: 'Africa/Nairobi',
    DEFAULT_TIMEZONE: 'Africa/Nairobi',
  };
  const installEnv = { ...testEnv, ...copyAllowed(parentEnv, NETWORK_KEYS) };
  const compose = ['compose', '-f', TEST_COMPOSE_FILE, '-p', project];
  log(`[test:docker] Isolated Compose project: ${project}`);
  // Compose still interpolates POSTGRES_PASSWORD for `down`. This harmless
  // placeholder is sufficient for cleanup; it is not the database password.
  const cleanupEnv =
    process.platform === 'win32'
      ? "$env:JALICARE_TEST_DB_PASSWORD='cleanup-only'; "
      : 'JALICARE_TEST_DB_PASSWORD=cleanup-only ';
  log(
    `[test:docker] If interrupted, clean up with: ${cleanupEnv}docker ${compose.join(' ')} down --volumes --remove-orphans`,
  );

  let failure;
  try {
    await checked('docker', [...compose, 'up', '-d', 'db'], composeEnv, 'Starting test database');
    await checked(npmCommand, ['ci'], installEnv, 'npm ci');

    let ready = false;
    for (let attempt = 0; attempt < readyAttempts; attempt++) {
      const result = await exec(
        'docker',
        [
          ...compose,
          'exec',
          '-T',
          'db',
          'pg_isready',
          '-h',
          '127.0.0.1',
          '-U',
          TEST_DB,
          '-d',
          TEST_DB,
        ],
        composeEnv,
        'quiet',
      );
      if (result.code === 0) {
        ready = true;
        break;
      }
      if (attempt + 1 < readyAttempts) await sleep(1_000);
    }
    if (!ready) throw new Error('The isolated PostgreSQL service did not become ready.');

    const address = await checked(
      'docker',
      [...compose, 'port', 'db', '5432'],
      composeEnv,
      'Compose port',
      'capture',
    );
    testEnv.SQL_PORT = parsePublishedPort(address.stdout);
    await checked(npmCommand, ['run', 'db:migrate', '--', '--yes'], testEnv, 'Database migrations');
    await checked(npmCommand, ['test'], testEnv, 'npm test');
  } catch (error) {
    failure = error;
  } finally {
    try {
      await checked(
        'docker',
        [...compose, 'down', '--volumes', '--remove-orphans'],
        composeEnv,
        'Compose cleanup',
      );
    } catch (error) {
      if (!failure) failure = error;
      else warn(`[test:docker] Cleanup failed: ${error.message}`);
    }
    try {
      rmSync(home, { recursive: true, force: true });
    } catch (error) {
      if (!failure) failure = error;
      else warn(`[test:docker] Could not remove the temporary test HOME: ${error.message}`);
    }
  }
  if (failure) throw failure;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runDockerBootstrap().catch((error) => {
    console.error(`[test:docker] ${error.message}`);
    process.exitCode = error.exitCode ?? 1;
  });
}
