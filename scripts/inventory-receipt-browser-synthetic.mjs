import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import pg from 'pg';
import puppeteer from 'puppeteer-core';

// Synthetic fixtures only: never migrate, reset, delete or contact a provider.
const root = fileURLToPath(new URL('..', import.meta.url));
const database = process.env.SQL_DB_NAME ?? '';
const host = process.env.SQL_HOST ?? '';
const executablePath = process.env.CHROME_EXECUTABLE_PATH ?? '';
if (
  process.env.BROWSER_SMOKE_SYNTHETIC !== 'YES' ||
  host !== '127.0.0.1' ||
  !/^jalicare_p5_synthetic_test_[a-f0-9]{10}$/.test(database) ||
  !process.env.JALICARE_TEST_PG_SYSTEM_IDENTIFIER ||
  !process.env.BROWSER_SMOKE_PG_DATA_DIRECTORY ||
  !executablePath
)
  throw new Error(
    'An independently attested synthetic database and private Chromium are required.',
  );
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const pool = new pg.Pool({
  host,
  port: Number(process.env.SQL_PORT),
  database,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD,
  ssl: false,
});
const suffix = randomUUID().slice(0, 8);
const secret = randomBytes(32).toString('base64url');
const limitedSecret = randomBytes(32).toString('base64url');
let server,
  browser,
  phase = 'attestation';
try {
  const identity = (
    await pool.query(`SELECT current_database() AS name,inet_server_addr()::text AS address,
    current_setting('data_directory') AS directory,(pg_control_system()).system_identifier::text AS cluster,
    (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrations`)
  ).rows[0];
  check(
    identity.name === database &&
      ['127.0.0.1/32', '127.0.0.1'].includes(identity.address) &&
      identity.directory === process.env.BROWSER_SMOKE_PG_DATA_DIRECTORY &&
      identity.cluster === process.env.JALICARE_TEST_PG_SYSTEM_IDENTIFIER &&
      identity.migrations === 74,
    'Synthetic database identity mismatch.',
  );
  phase = 'synthetic fixtures';
  const tenant = (
    await pool.query(
      "INSERT INTO tenants(name,slug,timezone) VALUES('Synthetic receipt browser tenant',$1,'Africa/Nairobi') RETURNING id",
      [`receipt-browser-${suffix}`],
    )
  ).rows[0].id;
  const facility = (
    await pool.query(
      "INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules) VALUES($1,$2,'Synthetic receipt browser facility','Africa/Nairobi','[\"inventory\"]') RETURNING id",
      [tenant, `RB-${suffix}`],
    )
  ).rows[0].id;
  const item = (
    await pool.query(
      "INSERT INTO inventory_items(facility_id,item_code,name,unit,current_stock,reorder_level,is_active) VALUES($1,$2,'Synthetic receipt browser item','Unit',0,1,true) RETURNING id",
      [facility, `RB-ITEM-${suffix}`],
    )
  ).rows[0].id;
  for (const permission of ['inventory.read', 'inventory.manage'])
    await pool.query(
      "INSERT INTO permissions(code,name,module) VALUES($1,$1,'inventory') ON CONFLICT(code) DO NOTHING",
      [permission],
    );
  async function actor(name, password, permissions) {
    const username = `receipt-browser-${name}-${suffix}`;
    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
    const id = (
      await pool.query(
        "INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$1,$2,'Synthetic receipt browser user',$3,'ACTIVE',$4,$5) RETURNING id",
        [username, `${username}@example.test`, hash, tenant, facility],
      )
    ).rows[0].id;
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenant, `RECEIPT_BROWSER_${name}_${suffix}`],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
    for (const code of permissions)
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, code],
      );
    return { id, username };
  }
  const manager = await actor('manager', secret, ['inventory.read', 'inventory.manage']);
  const limited = await actor('limited', limitedSecret, ['inventory.read']);
  const port = await new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const value = socket.address().port;
      socket.close((error) => (error ? reject(error) : resolve(value)));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  phase = 'server startup';
  server = spawn('node', ['build/server.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: String(port),
      APP_BASE_URL: base,
      SQL_SSL: 'false',
      TZ: 'Africa/Nairobi',
      DEFAULT_TIMEZONE: 'Africa/Nairobi',
      DHA_MODE: 'mock',
      DHA_ALLOW_PRODUCTION: 'false',
      FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Synthetic server startup timeout')), 30000);
    server.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('listening on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on('data', () => {});
    server.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Synthetic server exited during startup'));
    });
  });
  check((await fetch(`${base}/api/ready`)).status === 200, 'Synthetic server not ready.');
  phase = 'browser login';
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  async function login(target, username, password) {
    await target.goto(base, { waitUntil: 'networkidle2' });
    await target.waitForSelector('input[placeholder="Username or Email"]');
    await target.type('input[placeholder="Username or Email"]', username);
    await target.type('input[placeholder="Password"]', password);
    await target.click('button[type="submit"]');
    await target.waitForSelector('aside button[title="Inventory & Batches"]', { timeout: 30000 });
    await target.click('aside button[title="Inventory & Batches"]');
    await target.waitForFunction(() =>
      document.body.textContent.includes('Synthetic receipt browser item'),
    );
  }
  await login(page, manager.username, secret);
  const captured = [];
  let interceptionFailure = false;
  let mode = 'forward-and-lose';
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !request.url().endsWith(`/inventory/${item}/batches`)) {
      void request.continue();
      return;
    }
    void (async () => {
      const body = request.postData();
      const authorization = request.headers().authorization;
      const attempt = { body, authorization, mode, forwardedStatus: null };
      captured.push(attempt);
      if (mode === 'normal') return request.continue();
      if (mode === 'forward-and-lose') {
        const response = await fetch(request.url(), {
          method: 'POST',
          headers: { authorization, 'content-type': 'application/json' },
          body,
        });
        attempt.forwardedStatus = response.status;
        await response.text();
      }
      return request.respond({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'SYNTHETIC_TRANSPORT_LOSS',
          message: 'Synthetic response lost.',
        }),
      });
    })().catch(() => {
      interceptionFailure = true;
      if (!request.isInterceptResolutionHandled()) void request.abort();
    });
  });
  async function clickText(text) {
    const clicked = await page.evaluate((expected) => {
      const button = [...document.querySelectorAll('button')].find(
        (candidate) => candidate.textContent.trim() === expected && !candidate.disabled,
      );
      if (!button) return false;
      button.click();
      return true;
    }, text);
    check(clicked, `Synthetic browser button unavailable: ${text}`);
  }
  async function fillReceipt(batchNumber, quantity) {
    await clickText('Receive Batch');
    await page.waitForSelector('#inventory-field-13');
    await page.select('#inventory-field-13', String(item));
    await page.type('#inventory-field-14', batchNumber);
    await page.$eval('#inventory-field-15', (input) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
        input,
        '2099-12-31',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.type('#inventory-field-16', String(quantity));
    await page.type('#inventory-field-17', '7.50');
  }
  async function waitForUnconfirmed() {
    await page.waitForFunction(
      () =>
        document
          .querySelector('[role="dialog"]')
          ?.textContent.includes('Receipt result is unconfirmed.') &&
        [...document.querySelectorAll('button')].some(
          (button) => button.textContent.trim() === 'Receive Stock' && !button.disabled,
        ),
    );
    check(!interceptionFailure, 'Synthetic transport interception failed.');
  }
  const storageName = `jalicare:inventory:receipt:${manager.id}:${facility}`;
  const stock = async () =>
    (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [item])).rows[0]
      .current_stock;
  const receiptRows = async () =>
    (
      await pool.query(
        'SELECT id,state,received_quantity FROM inventory_receipt_requests WHERE facility_id=$1 ORDER BY id',
        [facility],
      )
    ).rows;

  phase = 'lost response and same-key retry';
  await fillReceipt(`RB-LOT-A-${suffix}`, 3);
  await clickText('Receive Stock');
  await waitForUnconfirmed();
  check(
    captured[0]?.forwardedStatus === 201 && (await stock()) === 3,
    'Synthetic first receipt did not commit.',
  );
  const retained = await page.evaluate(
    (name) => JSON.parse(localStorage.getItem(name)),
    storageName,
  );
  check(
    Object.keys(retained).sort().join(',') === 'fingerprint,idempotencyKey,itemId',
    'Unexpected browser recovery data.',
  );
  mode = 'normal';
  const replay = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/inventory/${item}/batches`),
  );
  await clickText('Receive Stock');
  check((await replay).status() === 200, 'Same-key replay was not confirmed.');
  await page.waitForFunction((name) => localStorage.getItem(name) === null, {}, storageName);
  await page.waitForFunction(() => !document.querySelector('#inventory-field-13'));
  check(
    captured.length >= 2 &&
      JSON.parse(captured[0].body).idempotencyKey === JSON.parse(captured[1].body).idempotencyKey,
    'Retry identity changed.',
  );
  check(
    (await stock()) === 3 && (await receiptRows()).length === 1,
    'Same-key retry changed stock twice.',
  );

  phase = 'lost response and status recovery';
  mode = 'forward-and-lose';
  await fillReceipt(`RB-LOT-B-${suffix}`, 2);
  await clickText('Receive Stock');
  await waitForUnconfirmed();
  check(captured.at(-1)?.forwardedStatus === 201, 'Second synthetic receipt did not commit.');
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('aside button[title="Inventory & Batches"]');
  await page.click('aside button[title="Inventory & Batches"]');
  await page.waitForFunction(() =>
    document.body.textContent.includes('unconfirmed receipt identity'),
  );
  await clickText('Check receipt status');
  await page.waitForFunction((name) => localStorage.getItem(name) === null, {}, storageName);
  await page.waitForFunction(
    () => !document.body.textContent.includes('unconfirmed receipt identity'),
  );
  check(
    (await stock()) === 5 && (await receiptRows()).length === 2,
    'Status recovery changed stock.',
  );

  phase = 'cancel before a delayed request';
  mode = 'lose-before-send';
  await fillReceipt(`RB-LOT-C-${suffix}`, 4);
  await clickText('Receive Stock');
  await waitForUnconfirmed();
  const delayed = captured.at(-1);
  await page.click('button[aria-label="Close Receive Stock into a Batch"]');
  await page.type('label input[maxlength="500"]', 'Synthetic delayed request review');
  await clickText('Close retry identity');
  await page.waitForFunction((name) => localStorage.getItem(name) === null, {}, storageName);
  const lateResponse = await fetch(`${base}/api/inventory/${item}/batches`, {
    method: 'POST',
    headers: { authorization: delayed.authorization, 'content-type': 'application/json' },
    body: delayed.body,
  });
  const lateBody = await lateResponse.json();
  check(
    lateResponse.status === 409 && lateBody.error === 'IDEMPOTENCY_CANCELLED',
    'Delayed request was not fenced.',
  );
  const rows = await receiptRows();
  check(
    (await stock()) === 5 &&
      rows.length === 3 &&
      rows.filter((row) => row.state === 'RECORDED').length === 2 &&
      rows.filter((row) => row.state === 'CANCELLED').length === 1,
    'Receipt or cancellation evidence differs.',
  );
  const audit = (
    await pool.query(
      "SELECT resource,action,count(*)::int AS n FROM audit_logs WHERE facility_id=$1 AND resource IN ('InventoryBatchReceipt','InventoryReceiptRetry') GROUP BY resource,action",
      [facility],
    )
  ).rows;
  check(
    audit.some(
      (r) => r.resource === 'InventoryBatchReceipt' && r.action === 'CREATE' && r.n === 2,
    ) &&
      audit.some(
        (r) => r.resource === 'InventoryReceiptRetry' && r.action === 'CANCEL' && r.n === 1,
      ),
    'Receipt audit evidence differs.',
  );
  check(
    (
      await pool.query('SELECT count(*)::int AS n FROM journal_entries WHERE facility_id=$1', [
        facility,
      ])
    ).rows[0].n === 0,
    'Receipt unexpectedly created a journal.',
  );

  phase = 'restricted browser';
  const context = await browser.createBrowserContext();
  const restricted = await context.newPage();
  let restrictedAuth = '';
  restricted.on('request', (request) => {
    if (request.headers().authorization) restrictedAuth = request.headers().authorization;
  });
  await restricted.setViewport({ width: 1440, height: 900 });
  await login(restricted, limited.username, limitedSecret);
  check(
    await restricted.evaluate(() =>
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent.trim() === 'Receive Batch' && button.disabled,
      ),
    ),
    'Read-only user could receive stock.',
  );
  check(restrictedAuth.startsWith('Bearer '), 'Restricted browser session was not observed.');
  const restrictedStatuses = await restricted.evaluate(
    async ({ authorization, key, itemId, body }) => {
      const headers = { authorization, 'content-type': 'application/json' };
      const status = await fetch(`/api/inventory/receipts/${encodeURIComponent(key)}`, { headers });
      const cancel = await fetch(`/api/inventory/receipts/${encodeURIComponent(key)}/cancel`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: 'Synthetic restricted attempt' }),
      });
      const receive = await fetch(`/api/inventory/${itemId}/batches`, {
        method: 'POST',
        headers,
        body,
      });
      return [status.status, cancel.status, receive.status];
    },
    {
      authorization: restrictedAuth,
      key: JSON.parse(delayed.body).idempotencyKey,
      itemId: item,
      body: delayed.body,
    },
  );
  check(
    restrictedStatuses.every((status) => status === 403),
    'Read-only receipt endpoints did not deny access.',
  );
  await context.close();
  console.log(
    'Synthetic Chromium receipt journey passed: same-key replay, reload/status recovery, cancellation fence, stock/audit reconciliation, no journal, and read-only UI/API.',
  );
} catch (error) {
  console.error(
    `Synthetic receipt browser journey failed during ${phase}: ${error instanceof Error ? error.message : 'unexpected error'}`,
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 10000);
      server.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  await pool.end();
}
