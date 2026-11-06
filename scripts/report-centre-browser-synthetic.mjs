import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import PDFParser from 'pdf2json';
import pg from 'pg';
import puppeteer from 'puppeteer-core';

// Additive synthetic fixtures only; this script never resets or migrates a database.
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
) {
  throw new Error(
    'Use BROWSER_SMOKE_SYNTHETIC=YES with a loopback synthetic test database, SQL_ADMIN_USER and CHROME_EXECUTABLE_PATH.',
  );
}
const port = Number(process.env.REPORT_BROWSER_PORT ?? '4319');
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid browser port.');
const base = `http://127.0.0.1:${port}`;
const suffix = randomUUID().slice(0, 8);
const password = randomBytes(32).toString('base64url');
const username = `synthetic_reports_${suffix}`;
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
const env = {
  ...process.env,
  NODE_ENV: 'production',
  HOST: '0.0.0.0',
  PORT: String(port),
  APP_BASE_URL: base,
  SQL_SSL: 'false',
  LOG_LEVEL: 'silent',
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};
let server, browser;
try {
  const tenant = (
    await pool.query("INSERT INTO tenants(name,slug,currency) VALUES($1,$2,'KES') RETURNING id", [
      `Synthetic Browser Tenant ${suffix}`,
      `browser-report-${suffix}`,
    ])
  ).rows[0].id;
  const mods = [
    'analytics',
    'inventory',
    'procurement',
    'opd',
    'inpatient',
    'laboratory',
    'radiology',
    'pharmacy',
    'finance',
    'registration',
    'accounting',
  ];
  const [facility, sibling] = (
    await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,mfl_code,address,county,phone,enabled_modules,timezone) VALUES
    ($1,$2,'Synthetic Reporting Browser Facility',$5,'Synthetic Road','Synthetic County','0000000000',$4::jsonb,'Africa/Nairobi'),
    ($1,$3,'Synthetic Browser Sibling',$6,'Other Synthetic Road','Synthetic County','0000000001',$4::jsonb,'Africa/Nairobi') RETURNING id`,
      [
        tenant,
        `BR-A-${suffix}`,
        `BR-B-${suffix}`,
        JSON.stringify(mods),
        `BR-MFL-A-${suffix}`,
        `BR-MFL-B-${suffix}`,
      ],
    )
  ).rows.map((r) => r.id);
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
  const userId = (
    await pool.query(
      `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES
    ($1,$1,$2,'Synthetic Browser Staff',$3,'ACTIVE',$4,$5) RETURNING id`,
      [username, `${username}@example.test`, hash, tenant, facility],
    )
  ).rows[0].id;
  const role = (
    await pool.query(
      'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
      [tenant, `BR_${suffix}`],
    )
  ).rows[0].id;
  await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [userId, role]);
  for (const code of [
    'reports.read',
    'reports.export',
    'inventory.read',
    'procurement.read',
    'clinical.read',
    'patients.read',
    'inpatient.read',
    'laboratory.read',
    'pharmacy.read',
    'billing.read',
    'billing.update',
    'accounting.read',
    'accounting.reports.export',
    'users.read',
  ]) {
    await pool.query(
      "INSERT INTO permissions(code,name,module) VALUES($1,$1,'synthetic') ON CONFLICT(code) DO NOTHING",
      [code],
    );
    await pool.query(
      'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
      [role, code],
    );
  }
  const limitedUsername = `synthetic_limited_${suffix}`;
  const limitedUser = (
    await pool.query(
      `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
     VALUES($1,$1,$2,'Synthetic Restricted Staff',$3,'ACTIVE',$4,$5) RETURNING id`,
      [limitedUsername, `${limitedUsername}@example.test`, hash, tenant, facility],
    )
  ).rows[0].id;
  const limitedRole = (
    await pool.query(
      'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
      [tenant, `BR_LIMITED_${suffix}`],
    )
  ).rows[0].id;
  await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
    limitedUser,
    limitedRole,
  ]);
  await pool.query(
    "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code IN ('reports.read','inventory.read')",
    [limitedRole],
  );
  const patient = (
    await pool.query(
      `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender,created_at)
    VALUES($1,$2,$3,'Synthetic','BrowserPatient','2000-01-01','Other','2026-04-01 08:00') RETURNING id`,
      [tenant, facility, `BR-MRN-${suffix}`],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender)
     SELECT $1,$2,$3 || n::text,'Synthetic','PagedPatient','2000-01-01','Other' FROM generate_series(1,23) n`,
    [tenant, facility, `BR-PAGE-${suffix}-`],
  );
  const department = (
    await pool.query(
      "INSERT INTO departments(facility_id,name,code) VALUES($1,'Synthetic Browser Department',$2) RETURNING id",
      [facility, `BR-D-${suffix}`],
    )
  ).rows[0].id;
  const practitioner = (
    await pool.query(
      "INSERT INTO practitioners(tenant_id,facility_id,user_id,full_name,department_id) VALUES($1,$2,$3,'Synthetic Browser Staff',$4) RETURNING id",
      [tenant, facility, userId, department],
    )
  ).rows[0].id;
  const encounter = (
    await pool.query(
      `INSERT INTO encounters(tenant_id,facility_id,patient_id,practitioner_id,department_id,encounter_type,status,started_at)
    VALUES($1,$2,$3,$4,$5,'OUTPATIENT','COMPLETED','2026-04-01 08:00') RETURNING id`,
      [tenant, facility, patient, practitioner, department],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description)
     VALUES($1,$2,'ICD-10','Z00.0','Synthetic examination diagnosis')`,
    [encounter, patient],
  );
  const finalizedTariff = (
    await pool.query(
      `INSERT INTO facility_service_tariffs(tenant_id,facility_id,code,description,department,unit,fee)
       VALUES($1,$2,$3,'Synthetic consultation','OPD','Visit','50.00') RETURNING id`,
      [tenant, facility, `BR-TARIFF-${suffix}`],
    )
  ).rows[0].id;
  const finalizedInvoice = (
    await pool.query(
      `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,encounter_id,invoice_number,
        total_amount,paid_amount,balance_amount,credit_balance,status)
       VALUES($1,$2,$3,$4,$5,'100.00','0.00','100.00','0.00','Pending') RETURNING id`,
      [tenant, facility, patient, encounter, `BR-FIN-${suffix}`],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO billing_items(invoice_id,tariff_id,tariff_code,item_type,description,quantity,unit_price,total_amount)
     VALUES($1,$2,$3,'Consultation','Synthetic consultation',2,'50.00','100.00')`,
    [finalizedInvoice, finalizedTariff, `BR-TARIFF-${suffix}`],
  );
  const ward = (
    await pool.query(
      "INSERT INTO wards(facility_id,name,code) VALUES($1,'Synthetic Browser Ward',$2) RETURNING id",
      [facility, `BR-W-${suffix}`],
    )
  ).rows[0].id;
  const [bed1, bed2] = (
    await pool.query("INSERT INTO beds(ward_id,bed_number) VALUES($1,'1'),($1,'2') RETURNING id", [
      ward,
    ])
  ).rows.map((r) => r.id);
  await pool.query(
    `INSERT INTO admissions(tenant_id,facility_id,patient_id,ward_id,bed_id,admission_date,status,discharge_date,discharge_type) VALUES
    ($1,$2,$3,$4,$5,'2026-04-01 08:00','Discharged','2026-04-03 12:00','Home'),
    ($1,$2,$3,$4,$6,'2026-04-04 08:00','Admitted',NULL,NULL)`,
    [tenant, facility, patient, ward, bed1, bed2],
  );
  const item = (
    await pool.query(
      `INSERT INTO inventory_items(facility_id,item_code,name,category,unit,store_location,current_stock) VALUES
    ($1,$2,'Synthetic Browser Item','Supplies','Pieces','Synthetic Store',7) RETURNING id`,
      [facility, `BR-IT-${suffix}`],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity_remaining) VALUES($1,'BR-BATCH','2026-04-30',7)",
    [item],
  );
  const supplier = (
    await pool.query(
      "INSERT INTO suppliers(tenant_id,name) VALUES($1,'Synthetic Browser Supplier') RETURNING id",
      [tenant],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO purchase_orders(tenant_id,facility_id,supplier_id,po_number,total_amount,status,expected_delivery_date) VALUES($1,$2,$3,$4,120,'Approved','2026-04-30')",
    [tenant, facility, supplier, `BR-PO-${suffix}`],
  );
  const browserTest = (
    await pool.query(
      "INSERT INTO lab_tests(facility_id,code,name,category) VALUES($1,$2,'Synthetic Browser Lab Test','Chemistry') RETURNING id",
      [facility, `BR-LT-${suffix}`],
    )
  ).rows[0].id;
  const [browserLabService, browserRadService] = (
    await pool.query(
      `INSERT INTO facility_services(tenant_id,facility_id,code,name,description,department,category,unit) VALUES
     ($1,$2,$3,'Synthetic Browser Lab Service','Synthetic','Laboratory','LABORATORY','Test'),
     ($1,$2,$4,'Synthetic Browser Imaging Service','Synthetic','Radiology','RADIOLOGY','Scan') RETURNING id`,
      [tenant, facility, `BR-LAB-${suffix}`.toUpperCase(), `BR-RAD-${suffix}`.toUpperCase()],
    )
  ).rows.map((row) => row.id);
  await pool.query(
    "INSERT INTO lab_orders(tenant_id,facility_id,patient_id,encounter_id,test_id,facility_service_id,test_name,status,ordered_at) VALUES($1,$2,$3,$4,$5,$6,'Synthetic Browser Test','Ordered','2026-04-01 09:00')",
    [tenant, facility, patient, encounter, browserTest, browserLabService],
  );
  await pool.query(
    `INSERT INTO lab_orders(tenant_id,facility_id,patient_id,test_name,status,ordered_at)
    SELECT $1,$2,$3,'Synthetic Browser Bulk ' || n,'Ordered','2026-04-01 09:00' FROM generate_series(1,30) n`,
    [tenant, facility, patient],
  );
  await pool.query(
    "INSERT INTO radiology_orders(tenant_id,facility_id,patient_id,facility_service_id,modality,procedure_name,status,created_at) VALUES($1,$2,$3,$4,'X-ray','Synthetic Browser Imaging','Requested','2026-04-01 10:00')",
    [tenant, facility, patient, browserRadService],
  );
  await pool.query(
    `INSERT INTO pharmacy_dispensations(tenant_id,facility_id,patient_id,item_id,item_code_snapshot,item_name_snapshot,item_unit_snapshot,batch_number,quantity_dispensed,dispensed_by,dispensed_at)
    VALUES($1,$2,$3,$4,$5,'Synthetic Browser Item','Pieces','BR-BATCH',3,'Synthetic Staff','2026-04-01 11:00')`,
    [tenant, facility, patient, item, `BR-IT-${suffix}`],
  );
  const invoice = (
    await pool.query(
      `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,balance_amount,status,created_at)
    VALUES($1,$2,$3,$4,100.50,'Pending','2026-04-01 08:00') RETURNING id`,
      [tenant, facility, patient, `BR-INV-${suffix}`],
    )
  ).rows[0].id;
  const payment = (
    await pool.query(
      `INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,cashier_name,payment_date)
    VALUES($1,$2,'Cash',120.10,'Synthetic Browser Cashier','2026-04-01 13:00') RETURNING id`,
      [invoice, `BR-REC-${suffix}`],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO billing_refunds(tenant_id,facility_id,invoice_id,payment_id,refund_number,amount,refund_method,reason,manual_confirmation,idempotency_key,request_hash,actor_user_id,created_at)
    VALUES($1,$2,$3,$4,$5,20,'CASH','Synthetic browser',true,$6,'synthetic',$7,'2026-04-01 14:00')`,
    [tenant, facility, invoice, payment, `BR-REF-${suffix}`, `browser-key-${suffix}`, userId],
  );
  const ledgerPeriod = (
    await pool.query(
      `INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date,status)
    VALUES($1,$2,'2026','Synthetic browser period','2026-01-01','2026-12-31','OPEN') RETURNING id`,
      [tenant, facility],
    )
  ).rows[0].id;
  const [cashAccount, revenueAccount] = (
    await pool.query(
      `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance) VALUES
    ($1,$2,'1100','Synthetic Browser Cash','ASSET','SYNTHETIC','DEBIT'),($1,$2,'4000','Synthetic Browser Revenue','REVENUE','SYNTHETIC','CREDIT') RETURNING id`,
      [tenant, facility],
    )
  ).rows.map((row) => row.id);
  // Seed one balanced journal through the normal database integrity triggers.
  const ledgerClient = await pool.connect();
  try {
    await ledgerClient.query('BEGIN');
    const journal = (
      await ledgerClient.query(
        `INSERT INTO journal_entries(tenant_id,facility_id,period_id,journal_number,entry_date,source_type,idempotency_key,request_hash,description,status,total_debit_cents,total_credit_cents,posted_by_user_id)
      VALUES($1,$2,$3,$4,'2026-04-01','MANUAL',$5,'synthetic','Synthetic browser journal','DRAFT',12010,12010,$6) RETURNING id`,
        [tenant, facility, ledgerPeriod, `BR-J-${suffix}`, `browser-ledger-${suffix}`, userId],
      )
    ).rows[0].id;
    await ledgerClient.query(
      `INSERT INTO journal_lines(journal_entry_id,account_id,debit_cents,credit_cents) VALUES($1,$2,12010,0),($1,$3,0,12010)`,
      [journal, cashAccount, revenueAccount],
    );
    await ledgerClient.query("UPDATE journal_entries SET status='POSTED' WHERE id=$1", [journal]);
    await ledgerClient.query('COMMIT');
  } catch (error) {
    await ledgerClient.query('ROLLBACK');
    throw error;
  } finally {
    ledgerClient.release();
  }
  console.log('Synthetic fixtures created.');
  server = spawn('node', ['build/server.js'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Synthetic server startup timed out.')), 25000);
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
      reject(new Error(`Synthetic server exited (${code}).`));
    });
  });
  check((await fetch(`${base}/api/ready`)).status === 200, 'Synthetic server readiness failed.');
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args:
      process.env.BROWSER_NO_SANDBOX === '1'
        ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        : ['--disable-dev-shm-usage'],
    env: Object.fromEntries(
      ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'FONTCONFIG_PATH', 'TMPDIR']
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]]),
    ),
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.name));
  await page.evaluateOnNewDocument(() => {
    window.print = () => {
      window.__syntheticPrintRequested = true;
    };
  });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[placeholder="Username or Email"]');
  await page.type('input[placeholder="Username or Email"]', username);
  await page.type('input[placeholder="Password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('aside button[title="Reporting Centre"]', { timeout: 30000 });
  await page.click('aside button[title="Reporting Centre"]');
  await page.waitForSelector('input[placeholder="Search reports or departments"]');
  const cases = [
    ['stock-goods', 'Inventory by category', 'inventory-category', 'Synthetic Browser Item'],
    ['stock-goods', 'Inventory by store', 'inventory-store', 'Synthetic Browser Item'],
    ['stock-goods', 'LPO summaries', 'purchase-orders', `BR-PO-${suffix}`],
    ['departmental', 'Current inpatient list', 'current-inpatients', 'Synthetic BrowserPatient'],
    ['stock-goods', 'Expiry reports', 'inventory-expiry', 'BR-BATCH'],
    ['departmental', 'OPD attendance', 'outpatient-encounters', 'Synthetic BrowserPatient'],
    ['departmental', 'Admissions', 'inpatient-admissions', 'Synthetic BrowserPatient'],
    ['departmental', 'Discharges', 'inpatient-discharges', 'Synthetic BrowserPatient'],
    ['departmental', 'Test reports', 'laboratory-orders', 'Synthetic Browser Test'],
    ['departmental', 'Imaging requests', 'radiology-requests', 'Synthetic Browser Imaging'],
    ['departmental', 'Dispensing', 'pharmacy-dispensations', 'Synthetic Browser Item'],
    ['financial', 'All-cashier daily summary', 'cashier-receipts', 'Synthetic Browser Cashier'],
    ['financial', 'Refund reports', 'recorded-refunds', `BR-REF-${suffix}`],
    ['financial', 'Patient outstanding balances', 'invoice-balances', `BR-INV-${suffix}`],
    ['records', 'Patient reports', 'patient-registrations', 'Synthetic BrowserPatient'],
    ['records', 'Current inpatient lists', 'current-inpatients', 'Synthetic BrowserPatient'],
    ['records', 'Inpatient discharges', 'inpatient-discharges', 'Synthetic BrowserPatient'],
    ['financial', 'Cashier daily summary', 'cashier-receipts', 'Synthetic Browser Cashier'],
    ['financial', 'Trial balance', 'ledger-trial-movements', 'Synthetic Browser Cash'],
    ['financial', 'Income statement', 'ledger-income', 'Synthetic Browser Revenue'],
    ['financial', 'Balance sheet', 'ledger-balance-sheet', 'Synthetic Browser Cash'],
  ];
  let authHeader = '';
  page.on('request', (request) => {
    if (request.url().includes('/api/reporting/centre/') && request.headers().authorization)
      authHeader = request.headers().authorization;
  });
  async function selectReport(target, category, name) {
    const search = await target.$('input[placeholder="Search reports or departments"]');
    await search.click();
    await target.keyboard.down('Control');
    await target.keyboard.press('KeyA');
    await target.keyboard.up('Control');
    await target.keyboard.press('Backspace');
    await search.type(name);
    await target.waitForFunction(
      (cat, label) =>
        [...document.querySelectorAll(`[data-testid="report-category-${cat}"] button`)].some(
          (button) => button.querySelector('span')?.textContent?.trim() === label,
        ),
      {},
      category,
      name,
    );
    await target.evaluate(
      (cat, label) =>
        [...document.querySelectorAll(`[data-testid="report-category-${cat}"] button`)]
          .find((button) => button.querySelector('span')?.textContent?.trim() === label)
          ?.click(),
      category,
      name,
    );
  }
  async function chooseOption(target, legend, text) {
    await target.waitForFunction(
      (group, value) => {
        const fieldset = [...document.querySelectorAll('fieldset')].find((element) =>
          element.querySelector('legend')?.textContent?.startsWith(group + ' ('),
        );
        return [...(fieldset?.querySelectorAll('label') ?? [])].some(
          (element) =>
            element.textContent.includes(value) &&
            element.querySelector('input[type=radio],input[type=checkbox]'),
        );
      },
      { timeout: 15000 },
      legend,
      text,
    );
    const handle = await target.evaluateHandle(
      (group, value) => {
        const fieldset = [...document.querySelectorAll('fieldset')].find((element) =>
          element.querySelector('legend')?.textContent?.startsWith(group + ' ('),
        );
        return [...fieldset.querySelectorAll('label')]
          .find(
            (element) =>
              element.textContent.includes(value) &&
              element.querySelector('input[type=radio],input[type=checkbox]'),
          )
          .querySelector('input');
      },
      legend,
      text,
    );
    const input = handle.asElement();
    await input.focus();
    await target.keyboard.press('Space');
    check(
      await target.evaluate((element) => element.checked, input),
      `${legend}: keyboard selection failed`,
    );
    await handle.dispose();
  }
  for (const [category, name, engine, expected] of cases) {
    console.log(`Testing ${engine}`);
    await selectReport(page, category, name);
    await page.waitForSelector('form[aria-label="Report filters"]');
    await page.type(
      'form[aria-label="Report filters"] input[placeholder="Enter a search term"]',
      expected,
    );
    const statusByEngine = {
      'inventory-category': 'active',
      'inventory-store': 'active',
      'purchase-orders': 'Approved',
      'outpatient-encounters': 'COMPLETED',
      'laboratory-orders': 'Ordered',
      'radiology-requests': 'Requested',
    };
    if (statusByEngine[engine])
      await page.select('form[aria-label="Report filters"] select', statusByEngine[engine]);
    const dateFields = await page.$$('form[aria-label="Report filters"] input[type="date"]');
    if (dateFields.length) {
      await page.evaluate(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        document
          .querySelectorAll('form[aria-label="Report filters"] input[type="date"]')
          .forEach((input, index, inputs) => {
            setter.call(input, inputs.length === 1 || index === 1 ? '2026-04-30' : '2026-04-01');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          });
      });
    }
    // The list is visible before typing; native radios and checkboxes also work by keyboard.
    const selections = [];
    if (
      [
        'current-inpatients',
        'outpatient-encounters',
        'inpatient-admissions',
        'inpatient-discharges',
        'laboratory-orders',
        'radiology-requests',
        'pharmacy-dispensations',
        'invoice-balances',
        'patient-registrations',
      ].includes(engine)
    )
      selections.push(['Patient', 'Synthetic BrowserPatient']);
    if (['current-inpatients', 'inpatient-admissions', 'inpatient-discharges'].includes(engine)) {
      selections.push(['Ward', 'Synthetic Browser Ward']);
      selections.push(['Bed', engine === 'inpatient-discharges' ? 'Bed 1' : 'Bed 2']);
    }
    if (engine === 'outpatient-encounters')
      selections.push(
        ['Department', 'Synthetic Browser Department'],
        ['Staff', 'Synthetic Browser Staff'],
      );
    if (engine === 'recorded-refunds') selections.push(['Staff', 'Synthetic Browser Staff']);
    if (
      [
        'inventory-category',
        'inventory-store',
        'inventory-expiry',
        'pharmacy-dispensations',
      ].includes(engine)
    )
      selections.push(['Item', 'Synthetic Browser Item']);
    if (engine === 'purchase-orders')
      selections.push(
        ['Supplier', 'Synthetic Browser Supplier'],
        ['Purchase order', `BR-PO-${suffix}`],
      );
    if (engine === 'laboratory-orders')
      selections.push(
        ['Laboratory test', 'Synthetic Browser Lab Test'],
        ['Laboratory service', 'Synthetic Browser Lab Service'],
      );
    if (engine === 'radiology-requests')
      selections.push(['Radiology service', 'Synthetic Browser Imaging Service']);
    if (engine === 'invoice-balances') selections.push(['Invoice', `BR-INV-${suffix}`]);
    if (engine === 'cashier-receipts') selections.push(['Receipt', `BR-REC-${suffix}`]);
    if (['ledger-trial-movements', 'ledger-income', 'ledger-balance-sheet'].includes(engine))
      selections.push([
        'Account',
        engine === 'ledger-income' ? 'Synthetic Browser Revenue' : 'Synthetic Browser Cash',
      ]);
    for (const [label, value] of selections) await chooseOption(page, label, value);
    const generated = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/reporting/centre/${engine}/generate`) &&
        response.request().method() === 'POST',
    );
    await page.evaluate(() =>
      [...document.querySelectorAll('form[aria-label="Report filters"] button')]
        .find((button) => button.textContent.includes('Generate report'))
        ?.click(),
    );
    const generatedResponse = await generated;
    check(
      generatedResponse.status() === 200,
      `${engine}: generate returned ${generatedResponse.status()}`,
    );
    const requestFilters = JSON.parse(generatedResponse.request().postData());
    check(requestFilters.search === expected, `${engine}: browser search was not sent`);
    if (dateFields.length === 1)
      check(
        !requestFilters.from && requestFilters.to === '2026-04-30',
        `${engine}: browser as-of date was not sent`,
      );
    else if (dateFields.length === 2)
      check(
        requestFilters.from === '2026-04-01' && requestFilters.to === '2026-04-30',
        `${engine}: browser date range was not sent`,
      );
    if (statusByEngine[engine])
      check(
        requestFilters.status === statusByEngine[engine],
        `${engine}: browser status was not sent`,
      );
    if (engine === 'outpatient-encounters')
      check(
        requestFilters.patientId === patient &&
          requestFilters.departmentId === department &&
          requestFilters.staffId === userId,
        'Outpatient linked filters were not sent',
      );
    const body = await generatedResponse.json();
    check(
      body.total > 0 && JSON.stringify(body.rows).includes(expected),
      `${engine}: expected fixture not in returned rows`,
    );
    await page.waitForFunction(
      (value) => document.querySelector('#report-centre-print')?.textContent?.includes(value),
      {},
      expected,
    );
    for (const format of ['pdf', 'xlsx', 'csv']) {
      const exported = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/reporting/centre/${engine}/export`) &&
          response.request().postData()?.includes(`"format":"${format}"`),
      );
      await page.evaluate(
        (label) =>
          [...document.querySelectorAll('main[aria-label="Selected report"] button')]
            .find((button) => button.textContent.trim() === label)
            ?.click(),
        format === 'pdf' ? 'PDF' : format === 'xlsx' ? 'Excel' : 'CSV',
      );
      const response = await exported;
      check(response.status() === 200, `${engine}: ${format} returned ${response.status()}`);
      const data = await response.json();
      const bytes = Buffer.from(data.base64, 'base64');
      check(
        format === 'pdf'
          ? bytes.subarray(0, 5).toString() === '%PDF-'
          : format === 'xlsx'
            ? bytes.subarray(0, 2).toString() === 'PK'
            : bytes.toString('utf8').includes(expected),
        `${engine}: invalid ${format} bytes`,
      );
      await page.waitForFunction(
        () =>
          ![...document.querySelectorAll('main[aria-label="Selected report"] button')].find(
            (button) => button.textContent.trim() === 'PDF',
          )?.disabled,
      );
    }
    const printed = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/reporting/centre/${engine}/generate`) &&
        response.request().postData()?.includes('"intent":"print"'),
    );
    await page.evaluate(() =>
      [...document.querySelectorAll('main[aria-label="Selected report"] button')]
        .find((button) => button.textContent.includes('Print page'))
        ?.click(),
    );
    check((await printed).status() === 200, `${engine}: print authorization failed`);
    await page.waitForFunction(
      () =>
        window.__syntheticPrintRequested === true &&
        document.body.classList.contains('print-report-centre'),
    );
    await page.emulateMediaType('print');
    const browserPdf = await page.pdf({ format: 'A4', printBackground: true });
    const parser = new PDFParser(null, true);
    const text = await new Promise((resolve, reject) => {
      parser.on('pdfParser_dataError', reject);
      parser.on('pdfParser_dataReady', () => resolve(parser.getRawTextContent()));
      parser.parseBuffer(Buffer.from(browserPdf));
    });
    parser.destroy();
    // Narrow printable columns may wrap source values across lines.
    const foundPrintedValue = text.replace(/\s+/g, '').includes(expected.replace(/\s+/g, ''));
    if (!foundPrintedValue && process.env.REPORT_BROWSER_DEBUG_DIR) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(`${process.env.REPORT_BROWSER_DEBUG_DIR}/${engine}-print.pdf`, browserPdf);
      await writeFile(`${process.env.REPORT_BROWSER_DEBUG_DIR}/${engine}-print.txt`, text);
    }
    check(foundPrintedValue, `${engine}: print output missing expected source value`);
    await page.emulateMediaType('screen');
    await page.evaluate(() => {
      window.__syntheticPrintRequested = false;
      window.dispatchEvent(new Event('afterprint'));
    });
    console.log(`${engine}: browser selection, generation, PDF, XLSX, CSV and print PASS`);
  }
  // An invoice is opened by choosing a real invoice number, never by entering its database ID.
  await selectReport(page, 'printables', 'Invoices');
  await chooseOption(page, 'Invoice', `BR-INV-${suffix}`);
  const invoiceOpen = page.waitForResponse(
    (response) =>
      response.url().includes(`/invoices/${invoice}/`) && response.request().method() === 'GET',
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('main button')]
      .find((button) => button.textContent.trim() === 'Open invoice')
      ?.click(),
  );
  check(
    (await invoiceOpen).status() === 200,
    'Invoice selection did not open the scoped document workflow.',
  );
  await page.waitForFunction(() =>
    document
      .querySelector('section[aria-label="Finalized invoice"]')
      ?.textContent?.includes('This invoice is not finalized.'),
  );
  check(
    await page.evaluate(() => !document.querySelector('input[inputmode="numeric"]')),
    'Invoice workflow still asks for a numeric ID.',
  );
  console.log('Scoped invoice browse and unfinalized state: PASS');

  // Finalize a separate complete synthetic invoice through the real authorized workflow;
  // never manufacture a finalized snapshot or imply insurer approval.
  check(authHeader.startsWith('Bearer '), 'Authenticated browser session was not observed.');
  const finalized = await page.evaluate(
    async ({ authorization, invoiceId }) => {
      const response = await fetch(`/api/invoices/${invoiceId}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authorization },
        body: JSON.stringify({
          insurerResponsibility: '0.00',
          copayment: '0.00',
          allocationBasis: 'Synthetic self-pay allocation, not insurer approval',
        }),
      });
      const data = await response.json();
      return { status: response.status, error: data.error, replay: data.idempotentReplay };
    },
    { authorization: authHeader, invoiceId: finalizedInvoice },
  );
  check(
    finalized.status === 201 && finalized.replay === false,
    `Synthetic finalization failed: ${finalized.status} ${finalized.error ?? ''}`,
  );
  await chooseOption(page, 'Invoice', `BR-FIN-${suffix}`);
  const finalizedOpen = page.waitForResponse(
    (response) =>
      response.url().includes(`/invoices/${finalizedInvoice}/finalization`) &&
      response.request().method() === 'GET',
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('main button')]
      .find((button) => button.textContent.trim() === 'Open invoice')
      ?.click(),
  );
  check((await finalizedOpen).status() === 200, 'Finalized document could not be opened.');
  await page.waitForFunction(
    (number) =>
      document.querySelector('.invoice-print-area')?.textContent?.includes(number) &&
      document
        .querySelector('.invoice-print-area')
        ?.textContent?.includes('Synthetic consultation'),
    {},
    `BR-FIN-${suffix}`,
  );
  check(
    await page.evaluate(
      () =>
        ![...document.querySelectorAll('section[aria-label="Finalized invoice"] button')].some(
          (button) => button.textContent.trim() === 'Finalize invoice',
        ),
    ),
    'Report-only invoice unexpectedly exposed a finalization action.',
  );
  const invoicePrint = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/invoices/${finalizedInvoice}/print-access`) &&
      response.request().method() === 'POST',
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('section[aria-label="Finalized invoice"] button')]
      .find((button) => button.textContent.trim() === 'Print finalized invoice')
      ?.click(),
  );
  check((await invoicePrint).status() === 200, 'Finalized invoice print was not audited.');
  await page.waitForFunction(
    () =>
      window.__syntheticPrintRequested === true &&
      document.body.classList.contains('print-finalized-invoice'),
  );
  await page.emulateMediaType('print');
  const invoicePdf = await page.pdf({ format: 'A4', printBackground: true });
  const invoiceParser = new PDFParser(null, true);
  const invoiceText = await new Promise((resolve, reject) => {
    invoiceParser.on('pdfParser_dataError', reject);
    invoiceParser.on('pdfParser_dataReady', () => resolve(invoiceParser.getRawTextContent()));
    invoiceParser.parseBuffer(Buffer.from(invoicePdf));
  });
  invoiceParser.destroy();
  check(
    invoiceText.replace(/\s+/g, '').includes(`BR-FIN-${suffix}`.replace(/\s+/g, '')) &&
      invoiceText.replace(/\s+/g, '').includes('Syntheticconsultation'),
    'Finalized invoice print output is missing its recorded reference or service.',
  );
  await page.emulateMediaType('screen');
  await page.evaluate(() => {
    window.__syntheticPrintRequested = false;
    window.dispatchEvent(new Event('afterprint'));
  });
  const printAudits = await pool.query(
    `SELECT count(*)::int AS n FROM patient_record_access_logs
     WHERE patient_id=$1 AND user_id=$2 AND facility_id=$3 AND record_type='FinalizedInvoice' AND record_id=$4 AND action='PRINT'`,
    [patient, userId, facility, finalizedInvoice],
  );
  check(
    printAudits.rows[0].n === 1,
    'Finalized invoice print access was not recorded exactly once.',
  );
  console.log('Finalized invoice selection, immutable snapshot and audited print: PASS');

  // A real patient option list has more than one bounded page.
  await selectReport(page, 'records', 'Patient reports');
  await page.waitForFunction(() => {
    const fieldset = [...document.querySelectorAll('fieldset')].find((element) =>
      element.querySelector('legend')?.textContent?.startsWith('Patient ('),
    );
    return (
      fieldset?.textContent.includes('Options 1–20') &&
      [...fieldset.querySelectorAll('button')].some(
        (button) => button.textContent.trim() === 'Next' && !button.disabled,
      )
    );
  });
  await page.evaluate(() => {
    const fieldset = [...document.querySelectorAll('fieldset')].find((element) =>
      element.querySelector('legend')?.textContent?.startsWith('Patient ('),
    );
    [...fieldset.querySelectorAll('button')]
      .find((button) => button.textContent.trim() === 'Next')
      .click();
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('fieldset')]
      .find((element) => element.querySelector('legend')?.textContent?.startsWith('Patient ('))
      ?.textContent.includes('Options 21–24'),
  );
  console.log('Patient selector pagination: PASS');

  // Exercise real browser pagination, empty-state and API-validation paths on a separate dataset.
  await selectReport(page, 'departmental', 'Test reports');
  await page.waitForSelector('form[aria-label="Report filters"]');
  const filterInput = 'form[aria-label="Report filters"] input[placeholder="Enter a search term"]';
  await page.type(filterInput, 'Synthetic Browser Bulk');
  const firstRequest = page.waitForResponse(
    (response) =>
      response.url().endsWith('/laboratory-orders/generate') &&
      response.request().method() === 'POST',
  );
  await page.click('form[aria-label="Report filters"] button[type="submit"]');
  const firstPage = await (await firstRequest).json();
  check(firstPage.total === 30 && firstPage.rows.length === 25, 'Browser first page is incorrect.');
  await page.waitForFunction(() =>
    document.querySelector('#report-centre-print')?.textContent?.includes('Showing 1–25 of 30'),
  );
  const secondRequest = page.waitForResponse(
    (response) =>
      response.url().endsWith('/laboratory-orders/generate') &&
      response.request().postData()?.includes('"offset":25'),
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('#report-centre-print button')]
      .find((button) => button.textContent.includes('Next'))
      ?.click(),
  );
  const secondPage = await (await secondRequest).json();
  check(
    secondPage.total === 30 && secondPage.rows.length === 5,
    'Browser second page is incorrect.',
  );
  check(
    new Set([...firstPage.rows, ...secondPage.rows].map((row) => row.orderId)).size === 30,
    'Browser pagination duplicated rows.',
  );
  await page.waitForFunction(() =>
    document.querySelector('#report-centre-print')?.textContent?.includes('Showing 26–30 of 30'),
  );
  const reportSearch = await page.$(filterInput);
  await reportSearch.click();
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await reportSearch.type('no-matching-synthetic-record');
  const emptyRequest = page.waitForResponse(
    (response) =>
      response.url().endsWith('/laboratory-orders/generate') &&
      response.request().postData()?.includes('no-matching-synthetic-record'),
  );
  await page.click('form[aria-label="Report filters"] button[type="submit"]');
  check(
    (await (await emptyRequest).json()).total === 0,
    'Browser empty-result count is incorrect.',
  );
  await page.waitForFunction(() =>
    document
      .querySelector('#report-centre-print')
      ?.textContent?.includes('No records match the selected filters.'),
  );
  await page.evaluate(() => {
    const input = document.querySelector('form[aria-label="Report filters"] input[type="date"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
      input,
      '2026-04-01',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const invalidRequest = page.waitForResponse(
    (response) =>
      response.url().endsWith('/laboratory-orders/generate') &&
      response.request().postData()?.includes('"from":"2026-04-01"'),
  );
  await page.click('form[aria-label="Report filters"] button[type="submit"]');
  check((await invalidRequest).status() === 400, 'Incomplete date range should return 400.');
  await page.waitForSelector('[role="alert"]');
  console.log('Browser pagination, empty state and invalid-date error: PASS');

  // A second real login has report/inventory read but no laboratory or export grants.
  const limitedContext = await browser.createBrowserContext();
  const limitedPage = await limitedContext.newPage();
  let limitedAuth = '';
  limitedPage.on('request', (request) => {
    if (request.url().includes('/api/reporting/centre/') && request.headers().authorization)
      limitedAuth = request.headers().authorization;
  });
  await limitedPage.goto(base, { waitUntil: 'networkidle2' });
  await limitedPage.waitForSelector('input[placeholder="Username or Email"]');
  await limitedPage.type('input[placeholder="Username or Email"]', limitedUsername);
  await limitedPage.type('input[placeholder="Password"]', password);
  await limitedPage.click('button[type="submit"]');
  await limitedPage.waitForSelector('aside button[title="Reporting Centre"]', { timeout: 30000 });
  await limitedPage.click('aside button[title="Reporting Centre"]');
  await limitedPage.waitForSelector('input[placeholder="Search reports or departments"]');
  await selectReport(limitedPage, 'departmental', 'Test reports');
  await limitedPage.waitForFunction(() =>
    document
      .querySelector('main[aria-label="Selected report"]')
      ?.textContent?.includes('Permission required'),
  );
  await selectReport(limitedPage, 'stock-goods', 'Inventory by category');
  const limitedGenerate = limitedPage.waitForResponse((response) =>
    response.url().endsWith('/inventory-category/generate'),
  );
  await limitedPage.click('form[aria-label="Report filters"] button[type="submit"]');
  check(
    (await limitedGenerate).status() === 200,
    'Restricted user could not view their permitted inventory report.',
  );
  await limitedPage.waitForFunction(() =>
    document
      .querySelector('main[aria-label="Selected report"]')
      ?.textContent?.includes(
        'Export and print require report and any applicable source-domain export permissions.',
      ),
  );
  check(
    limitedAuth.startsWith('Bearer '),
    'Restricted authenticated browser session was not observed.',
  );
  const restrictedStatuses = await limitedPage.evaluate(
    async ({ authorization, facilityId }) => {
      async function post(path, body) {
        return (
          await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: authorization },
            body: JSON.stringify(body),
          })
        ).status;
      }
      return [
        await post('/api/reporting/centre/laboratory-orders/generate', { facilityId }),
        await post('/api/reporting/centre/inventory-category/export', {
          facilityId,
          format: 'xlsx',
        }),
      ];
    },
    { authorization: limitedAuth, facilityId: facility },
  );
  check(
    restrictedStatuses[0] === 403 && restrictedStatuses[1] === 403,
    'Restricted user was not denied source or export access.',
  );
  await limitedContext.close();
  console.log('Browser source-permission and export-permission restrictions: PASS');

  check(authHeader.startsWith('Bearer '), 'Authenticated browser session was not observed.');
  const scopeStatus = await page.evaluate(
    async ({ headers, facilityId }) => {
      const response = await fetch('/api/reporting/centre/laboratory-orders/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: headers },
        body: JSON.stringify({ facilityId }),
      });
      return response.status;
    },
    { headers: authHeader, facilityId: sibling },
  );
  check(scopeStatus === 403, 'Cross-facility browser request was not denied.');
  await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 1 });
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Tablet page has horizontal document overflow.',
  );
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Mobile page has horizontal document overflow.',
  );
  check(errors.length === 0, `Browser reported ${errors.length} uncaught page error(s).`);
  console.log('Scope denial, tablet/mobile layout, and browser console: PASS');
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
  await pool.end();
}
