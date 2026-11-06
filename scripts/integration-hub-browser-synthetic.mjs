import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import https from 'node:https';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import pg from 'pg';
import puppeteer from 'puppeteer-core';

// Additive synthetic fixtures only. No database reset, migration or provider call.
const root = fileURLToPath(new URL('..', import.meta.url));
const host = process.env.SQL_HOST ?? '';
const database = process.env.SQL_DB_NAME ?? '';
const executablePath = process.env.CHROME_EXECUTABLE_PATH ?? '';
if (
  process.env.BROWSER_SMOKE_SYNTHETIC !== 'YES' ||
  !['127.0.0.1', 'localhost', '::1'].includes(host) ||
  !/(?:(?:synthetic|browser).*test|test.*(?:synthetic|browser))/i.test(database) ||
  !process.env.SQL_ADMIN_USER ||
  !executablePath
)
  throw new Error('Use a loopback synthetic test database and BROWSER_SMOKE_SYNTHETIC=YES.');
const proxyPort = Number(process.env.INTEGRATION_BROWSER_PORT ?? '4327');
const backendPort = proxyPort + 1;
if (!Number.isInteger(proxyPort) || proxyPort < 1024 || backendPort > 65535)
  throw new Error('Invalid browser port.');
const origin = `https://127.0.0.1:${proxyPort}`;
const suffix = randomUUID().slice(0, 8);
const username = `synthetic_integration_${suffix}`;
const password = randomBytes(32).toString('base64url');
const credentials = {
  consumerKey: `synthetic-key-${suffix}`,
  consumerSecret: `synthetic-secret-${suffix}`,
  passkey: `synthetic-passkey-${suffix}`,
  shortcode: '654321',
  transactionType: 'CustomerPayBillOnline',
};
const pool = new pg.Pool({
  host,
  port: Number(process.env.SQL_PORT ?? 5432),
  database,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD ?? '',
});
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
let tempDir, proxy, server, browser;
try {
  const identity = await pool.query('SELECT current_database() AS db, current_user AS db_user');
  check(
    identity.rows[0].db === database && identity.rows[0].db_user === process.env.SQL_ADMIN_USER,
    'Synthetic database identity mismatch.',
  );
  const provider = await pool.query(
    `SELECT p.id FROM payment_provider_definitions p JOIN payment_provider_environments e ON e.provider_id=p.id AND e.environment='SANDBOX' AND e.is_available WHERE p.code='MPESA_DARAJA' AND p.status='ACTIVE'`,
  );
  check(
    provider.rowCount === 1,
    'Synthetic database requires the existing sandbox provider definition.',
  );
  const tenant = (
    await pool.query(`INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id`, [
      `Synthetic Integration Tenant ${suffix}`,
      `synthetic-integrations-${suffix}`,
    ])
  ).rows[0].id;
  const facilities = (
    await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,enabled_modules) VALUES($1,$2,'Synthetic Integration Facility',$4::jsonb),($1,$3,'Synthetic Integration Sibling',$4::jsonb) RETURNING id`,
      [
        tenant,
        `HUB-A-${suffix}`,
        `HUB-B-${suffix}`,
        JSON.stringify(['finance', 'insurance', 'configuration']),
      ],
    )
  ).rows;
  const facility = facilities[0].id,
    sibling = facilities[1].id;
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
  const user = (
    await pool.query(
      `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic Integration Admin',$3,'ACTIVE',$4,$5) RETURNING id`,
      [username, `${username}@example.test`, hash, tenant, facility],
    )
  ).rows[0].id;
  const role = (
    await pool.query(
      `INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id`,
      [tenant, 'FACILITY_ADMIN'],
    )
  ).rows[0].id;
  await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
  for (const code of [
    'payment_hub.catalogue.read',
    'payment_hub.facility.manage',
    'payment_hub.credentials.manage',
    'payer_hub.catalogue.read',
    'payer_hub.facility.manage',
  ]) {
    await pool.query(
      `INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING`,
      [code],
    );
    await pool.query(
      `INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2`,
      [role, code],
    );
  }
  await pool.query(
    `INSERT INTO payment_provider_assignments(provider_id,tenant_id,facility_id,is_allowed,updated_by_user_id) VALUES($1,$2,$3,true,$4)`,
    [provider.rows[0].id, tenant, facility, user],
  );

  // Production-mode app behind a local TLS termination proxy. The self-signed
  // certificate is synthetic and Chromium ignores its trust chain ONLY here.
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'jalicare-synthetic-tls-'));
  const keyFile = path.join(tempDir, 'key.pem'),
    certFile = path.join(tempDir, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyFile,
      '-out',
      certFile,
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
    ],
    { stdio: 'ignore' },
  );
  server = spawn('node', ['build/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(backendPort),
      APP_BASE_URL: origin,
      TRUST_PROXY: 'true',
      SQL_SSL: 'false',
      LOG_LEVEL: 'silent',
      FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      PAYMENT_HUB_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      PAYMENT_HUB_ACTIVE_VAULT_KEY_ID: 'BROWSER01',
      PAYMENT_HUB_VAULT_KEY_BROWSER01: randomBytes(32).toString('base64'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(
      () => reject(new Error('Synthetic backend startup timed out.')),
      25000,
    );
    server.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('listening on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on('data', (chunk) => {
      output += chunk;
    });
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Synthetic backend exited (${code}).`));
    });
  });
  proxy = https.createServer(
    { key: await readFile(keyFile), cert: await readFile(certFile) },
    (req, res) => {
      const headers = {
        ...req.headers,
        'x-forwarded-proto': 'https',
        'x-forwarded-host': req.headers.host,
      };
      const upstream = http.request(
        { hostname: '127.0.0.1', port: backendPort, method: req.method, path: req.url, headers },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        },
      );
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    },
  );
  await new Promise((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(proxyPort, '127.0.0.1', resolve);
  });
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      ...(process.env.BROWSER_NO_SANDBOX === '1'
        ? ['--no-sandbox', '--disable-setuid-sandbox']
        : []),
      '--disable-dev-shm-usage',
      '--ignore-certificate-errors',
    ],
    env: Object.fromEntries(
      ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'FONTCONFIG_PATH', 'TMPDIR']
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]]),
    ),
  });
  const page = await browser.newPage();
  const errors = [];
  let auth = '';
  page.on('pageerror', (error) => errors.push(error.name));
  page.on('request', (request) => {
    if (request.url().includes('/api/payment-hub/facility/') && request.headers().authorization)
      auth = request.headers().authorization;
  });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(origin, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[placeholder="Username or Email"]');
  await page.type('input[placeholder="Username or Email"]', username);
  await page.type('input[placeholder="Password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('aside button[title="System Configuration"]', { timeout: 30000 });
  await page.click('aside button[title="System Configuration"]');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (item) => item.textContent.trim() === 'Integration Hub',
    ),
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .find((item) => item.textContent.trim() === 'Integration Hub')
      .click(),
  );
  try {
    await page.waitForFunction(
      () =>
        document
          .querySelector('[aria-label="Facility Integration Hub"]')
          ?.textContent?.includes('Safaricom M-Pesa'),
      { timeout: 20000 },
    );
  } catch (error) {
    // This script accepts only a synthetic database. Report the visible state,
    // never password/input values, to make an authorization or loading failure actionable.
    const state = await page.evaluate(() => ({
      title: document.title,
      headings: [...document.querySelectorAll('h1,h2,h3')]
        .map((h) => h.textContent.trim())
        .slice(0, 15),
      alerts: [...document.querySelectorAll('[role="alert"]')]
        .map((e) => e.textContent.trim())
        .slice(0, 5),
      hasHub: Boolean(document.querySelector('[aria-label="Facility Integration Hub"]')),
      text: document.body.textContent.replace(/\s+/g, ' ').trim().slice(0, 1200),
    }));
    throw new Error(`Synthetic integration hub did not load: ${JSON.stringify(state)}`, {
      cause: error,
    });
  }
  await page.waitForFunction(() => document.body.textContent.includes('Jubilee Health Insurance'), {
    timeout: 15000,
  });
  check(
    await page.evaluate(() => document.body.textContent.includes('Synthetic Integration Facility')),
    'Facility context missing from the marketplace.',
  );
  const clickText = async (selector, text) => {
    const result = await page.evaluate(
      (sel, value) => {
        const element = [...document.querySelectorAll(sel)].find(
          (item) => item.textContent.trim() === value,
        );
        if (!element || ('disabled' in element && element.disabled)) return false;
        element.click();
        return true;
      },
      selector,
      text,
    );
    check(result, `Missing control: ${text}`);
  };
  await clickText('button', 'Mobile money');
  await page.waitForFunction(() => document.body.textContent.includes('Safaricom M-Pesa'));
  await clickText('summary', 'Configure an environment and capabilities');
  for (const label of ['PAYMENT_COLLECTION', 'HEALTH']) {
    const selected = await page.evaluate((value) => {
      const input = [...document.querySelectorAll('label')]
        .find((item) => item.textContent.trim() === value)
        ?.querySelector('input[type="checkbox"]');
      if (!input) return false;
      input.click();
      return true;
    }, label);
    check(selected, `Missing implemented capability: ${label}`);
  }
  await clickText('button', 'Save environment');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('summary')].some((s) =>
        s.textContent.includes('Add or replace Daraja sandbox credentials'),
      ),
    { timeout: 15000 },
  );
  await clickText('summary', 'Add or replace Daraja sandbox credentials');
  for (const [label, value] of [
    ['Consumer key', credentials.consumerKey],
    ['Consumer secret', credentials.consumerSecret],
    ['STK passkey', credentials.passkey],
    ['Sandbox shortcode', credentials.shortcode],
  ]) {
    const handle = await page.evaluateHandle(
      (name) =>
        [...document.querySelectorAll('label')]
          .find((item) => item.textContent.trim() === name)
          ?.querySelector('input'),
      label,
    );
    check(await handle.asElement(), `Missing credential field: ${label}`);
    await handle.asElement().type(value);
    await handle.dispose();
  }
  const transactionSelect = await page.evaluateHandle(() =>
    [...document.querySelectorAll('label')]
      .find((item) => item.textContent.includes('Authorized transaction type'))
      ?.querySelector('select'),
  );
  await transactionSelect.asElement().select(credentials.transactionType);
  await transactionSelect.dispose();
  const saveResponse = page.waitForResponse(
    (response) => response.url().includes('/credentials') && response.request().method() === 'PUT',
  );
  await clickText('button', 'Save encrypted sandbox credentials');
  const savedResponse = await saveResponse;
  check(savedResponse.status() === 200, 'Synthetic HTTPS credential save failed.');
  const savedBody = JSON.stringify(await savedResponse.json());
  for (const value of Object.values(credentials))
    check(!savedBody.includes(value), 'Credential returned by save API.');
  await page.waitForFunction(
    () => document.body.textContent.includes('Credentials saved encrypted.'),
    { timeout: 15000 },
  );
  const row = (
    await pool.query(
      `SELECT s.integration_id,s.encrypted_value,s.credential_source,i.is_enabled,i.connection_status FROM facility_payment_secrets s JOIN facility_payment_integrations i ON i.id=s.integration_id WHERE s.tenant_id=$1 AND s.facility_id=$2`,
      [tenant, facility],
    )
  ).rows[0];
  check(
    row?.credential_source === 'VAULT' &&
      row.encrypted_value.startsWith('v2.BROWSER01.') &&
      !row.is_enabled &&
      row.connection_status === 'NOT_TESTED',
    'Vault persistence or honest sandbox status failed.',
  );
  for (const value of Object.values(credentials))
    check(!row.encrypted_value.includes(value), 'Credential material was not encrypted.');
  const reencryptResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/credentials/reencrypt') && response.request().method() === 'POST',
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (b) => b.textContent.trim() === 'Re-encrypt with active vault key' && !b.disabled,
    ),
  );
  await clickText('button', 'Re-encrypt with active vault key');
  check((await reencryptResponse).status() === 200, 'Synthetic re-encryption failed.');
  const after = (
    await pool.query(
      'SELECT encrypted_value FROM facility_payment_secrets WHERE integration_id=$1',
      [row.integration_id],
    )
  ).rows[0].encrypted_value;
  check(
    after !== row.encrypted_value && after.startsWith('v2.BROWSER01.'),
    'Re-encryption did not persist new ciphertext.',
  );
  // Local revocation is a real authenticated browser action. It does not revoke
  // provider-side credentials or cancel provider requests already in flight.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (b) => b.textContent.trim() === 'Revoke stored credentials' && !b.disabled,
    ),
  );
  page.once('dialog', (dialog) => void dialog.accept());
  const revokeResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/credentials/revoke') && response.request().method() === 'POST',
  );
  await clickText('button', 'Revoke stored credentials');
  const revoked = await revokeResponse;
  check(revoked.status() === 200, 'Synthetic revocation failed.');
  const revokedBody = JSON.stringify(await revoked.json());
  for (const value of Object.values(credentials))
    check(!revokedBody.includes(value), 'Credential returned by revoke API.');
  await page.waitForFunction(
    () => document.body.textContent.includes('Credentials revoked and integration disabled.'),
    { timeout: 15000 },
  );
  const revokedRow = (
    await pool.query(
      `SELECT s.revoked_at,i.is_enabled,i.connection_status FROM facility_payment_secrets s
    JOIN facility_payment_integrations i ON i.id=s.integration_id WHERE s.integration_id=$1`,
      [row.integration_id],
    )
  ).rows[0];
  check(
    revokedRow.revoked_at &&
      !revokedRow.is_enabled &&
      revokedRow.connection_status === 'NOT_TESTED',
    'Revocation was not persisted safely.',
  );
  await page.waitForFunction(() => document.body.textContent.includes('Credentials revoked'));
  const opened = await page.evaluate(
    () =>
      [...document.querySelectorAll('summary')].find(
        (item) => item.textContent.trim() === 'Add or replace Daraja sandbox credentials',
      )?.parentElement?.open,
  );
  if (!opened) await clickText('summary', 'Add or replace Daraja sandbox credentials');
  const replacement = {
    ...credentials,
    consumerSecret: `${credentials.consumerSecret}-rotated`,
    passkey: `${credentials.passkey}-rotated`,
  };
  for (const [label, value] of [
    ['Consumer key', replacement.consumerKey],
    ['Consumer secret', replacement.consumerSecret],
    ['STK passkey', replacement.passkey],
    ['Sandbox shortcode', replacement.shortcode],
  ]) {
    const field = await page.evaluateHandle(
      (name) =>
        [...document.querySelectorAll('label')]
          .find((item) => item.textContent.trim() === name)
          ?.querySelector('input'),
      label,
    );
    check(await field.asElement(), `Missing replacement field: ${label}`);
    await field.asElement().type(value);
    await field.dispose();
  }
  const selectAgain = await page.evaluateHandle(() =>
    [...document.querySelectorAll('label')]
      .find((item) => item.textContent.includes('Authorized transaction type'))
      ?.querySelector('select'),
  );
  await selectAgain.asElement().select(replacement.transactionType);
  await selectAgain.dispose();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (b) => b.textContent.trim() === 'Save encrypted sandbox credentials' && !b.disabled,
    ),
  );
  const replaceResponse = page.waitForResponse(
    (response) => response.url().endsWith('/credentials') && response.request().method() === 'PUT',
  );
  await clickText('button', 'Save encrypted sandbox credentials');
  const replaced = await replaceResponse;
  check(replaced.status() === 200, 'Synthetic credential replacement failed.');
  const replacedBody = JSON.stringify(await replaced.json());
  for (const value of Object.values(replacement))
    check(!replacedBody.includes(value), 'Credential returned by replacement API.');
  await page.waitForFunction(
    () => document.body.textContent.includes('Credentials saved encrypted.'),
    { timeout: 15000 },
  );
  const finalRow = (
    await pool.query(
      `SELECT s.revoked_at,s.encrypted_value,i.is_enabled,i.connection_status FROM facility_payment_secrets s
    JOIN facility_payment_integrations i ON i.id=s.integration_id WHERE s.integration_id=$1`,
      [row.integration_id],
    )
  ).rows[0];
  check(
    !finalRow.revoked_at &&
      finalRow.encrypted_value !== after &&
      !finalRow.is_enabled &&
      finalRow.connection_status === 'NOT_TESTED',
    'Replacement did not reset security state.',
  );
  for (const value of Object.values(replacement))
    check(!finalRow.encrypted_value.includes(value), 'Replacement was not encrypted.');
  await clickText('button', 'View configuration activity');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Configuration audit history"]')
        ?.textContent.includes('ROTATE_KEY') &&
      document
        .querySelector('[aria-label="Configuration audit history"]')
        ?.textContent.includes('REVOKE'),
    { timeout: 15000 },
  );
  const rendered = await page.evaluate(() => document.body.textContent);
  for (const value of [...Object.values(credentials), ...Object.values(replacement)])
    check(!rendered.includes(value), 'Credential material was rendered after save or replacement.');
  check(auth.startsWith('Bearer '), 'Genuine authenticated browser session was not observed.');
  const denied = await page.evaluate(
    async ({ token, other }) =>
      (
        await fetch(`/api/payment-hub/facility/catalogue?facilityId=${other}`, {
          headers: { Authorization: token },
        })
      ).status,
    { token: auth, other: sibling },
  );
  check(denied === 403, 'Cross-facility catalogue was not denied.');
  await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 1 });
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Tablet page overflows horizontally.',
  );
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Mobile page overflows horizontally.',
  );
  check(errors.length === 0, `Browser reported ${errors.length} uncaught page error(s).`);
  console.log(
    'Synthetic HTTPS browser: marketplace, scoped configuration, encrypted credential save, re-encryption, revocation, replacement, audit, cross-facility denial and responsive layout PASS.',
  );
  console.log('Provider OAuth, STK, callbacks and production were NOT contacted or verified.');
} finally {
  if (browser) await browser.close();
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
  if (server) server.kill('SIGTERM');
  await pool.end();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
}
