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
const expectedCluster = process.env.JALICARE_TEST_PG_SYSTEM_IDENTIFIER ?? '';
const expectedDataDirectory = process.env.BROWSER_SMOKE_PG_DATA_DIRECTORY ?? '';
const fixturesOnly = process.env.REPORT_FIXTURES_ONLY === 'YES';
if (
  process.env.BROWSER_SMOKE_SYNTHETIC !== 'YES' ||
  !['127.0.0.1', 'localhost', '::1'].includes(host) ||
  !/(?:(?:synthetic|browser).*test|test.*(?:synthetic|browser))/i.test(database) ||
  !process.env.SQL_ADMIN_USER ||
  !/^[0-9]{1,20}$/.test(expectedCluster) ||
  !expectedDataDirectory ||
  (!fixturesOnly && !executablePath)
) {
  throw new Error(
    'An independently attested loopback synthetic test database, cluster identifier and data directory are required; the browser journey also requires CHROME_EXECUTABLE_PATH.',
  );
}
const port = Number(process.env.REPORT_BROWSER_PORT ?? '4319');
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid browser port.');
const base = `http://127.0.0.1:${port}`;
const suffix = randomUUID().slice(0, 8);
const password = randomBytes(32).toString('base64url');
const reviewerPassword = randomBytes(32).toString('base64url');
const limitedPassword = randomBytes(32).toString('base64url');
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
  // A loopback host and a test-looking name alone are not evidence of isolation.
  // The caller must obtain these values independently from the newly provisioned cluster.
  const identity = (
    await pool.query(`SELECT current_database() AS name,inet_server_addr()::text AS address,
      current_setting('data_directory') AS directory,current_setting('TimeZone') AS timezone,
      current_setting('server_version') AS version,system_identifier::text AS cluster,
      (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrations FROM pg_control_system()`)
  ).rows[0];
  check(
    identity?.name === database &&
      ['127.0.0.1/32', '127.0.0.1', '::1/128', '::1'].includes(identity.address) &&
      identity.directory === expectedDataDirectory &&
      identity.cluster === expectedCluster &&
      identity.timezone === 'UTC' &&
      identity.version.startsWith('16.15') &&
      identity.migrations === 73,
    'The synthetic database identity, directory or UTC timezone was not independently attested.',
  );
  const empty = (
    await pool.query(`SELECT
      (SELECT count(*)::int FROM tenants) AS tenants,
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM patients) AS patients,
      (SELECT count(*)::int FROM encounters) AS encounters,
      (SELECT count(*)::int FROM diagnoses) AS diagnoses`)
  ).rows[0];
  check(
    Object.values(empty).every((count) => count === 0),
    'The synthetic fixture database was not empty before setup.',
  );
  console.log('Independent synthetic database identity and empty baseline: PASS');
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
  const foreignTenant = (
    await pool.query("INSERT INTO tenants(name,slug,currency) VALUES($1,$2,'KES') RETURNING id", [
      `Synthetic Browser Foreign Tenant ${suffix}`,
      `browser-foreign-${suffix}`,
    ])
  ).rows[0].id;
  const foreignFacility = (
    await pool.query(
      `INSERT INTO facilities(tenant_id,code,name,enabled_modules,timezone)
       VALUES($1,$2,'Synthetic Foreign Facility',$3::jsonb,'Africa/Nairobi') RETURNING id`,
      [foreignTenant, `BR-C-${suffix}`, JSON.stringify(mods)],
    )
  ).rows[0].id;
  const hashPassword = (value) =>
    argon2.hash(value, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
  const hash = await hashPassword(password);
  const reviewerHash = await hashPassword(reviewerPassword);
  const limitedHash = await hashPassword(limitedPassword);
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
    'procurement.create',
    'procurement.approve',
    'clinical.read',
    'clinical.create',
    'patients.read',
    'inpatient.read',
    'laboratory.read',
    'pharmacy.read',
    'pharmacy.dispense',
    'billing.read',
    'billing.update',
    'billing.payments.record',
    'billing.refunds.record',
    'billing.refunds.approve',
    'accounting.read',
    'accounting.coa.manage',
    'accounting.expenses.request',
    'accounting.expenses.approve',
    'accounting.journals.post',
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
  // Purchase orders, expense posting and refunds require a distinct role-backed reviewer.
  const reviewerUsername = `synthetic_independent_reviewer_${suffix}`;
  const reviewer = (
    await pool.query(
      `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
       VALUES($1,$1,$2,'Synthetic Independent Reviewer',$3,'ACTIVE',$4,$5) RETURNING id`,
      [reviewerUsername, `${reviewerUsername}@example.test`, reviewerHash, tenant, facility],
    )
  ).rows[0].id;
  const reviewerRole = (
    await pool.query(
      'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
      [tenant, `BR_REVIEWER_${suffix}`],
    )
  ).rows[0].id;
  await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
    reviewer,
    reviewerRole,
  ]);
  await pool.query(
    `INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code IN
     ('billing.read','billing.refunds.approve','procurement.read','procurement.approve',
      'accounting.read','accounting.expenses.approve','accounting.journals.post')`,
    [reviewerRole],
  );
  const limitedUsername = `synthetic_limited_${suffix}`;
  const limitedUser = (
    await pool.query(
      `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
     VALUES($1,$1,$2,'Synthetic Restricted Staff',$3,'ACTIVE',$4,$5) RETURNING id`,
      [limitedUsername, `${limitedUsername}@example.test`, limitedHash, tenant, facility],
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
  // A second active encounter is only an anchor for the real prescription workflow;
  // the historical completed encounter above is used only for report rendering.
  const dispensingEncounter = (
    await pool.query(
      `INSERT INTO encounters(tenant_id,facility_id,patient_id,practitioner_id,department_id,encounter_type,status)
       VALUES($1,$2,$3,$4,$5,'OUTPATIENT','ACTIVE') RETURNING id`,
      [tenant, facility, patient, practitioner, department],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO diagnoses(encounter_id,patient_id,coding_system,icd10_code,icd10_description)
     VALUES($1,$2,'ICD-10','Z00.0','Synthetic examination diagnosis')`,
    [dispensingEncounter, patient],
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
      `INSERT INTO inventory_items(facility_id,item_code,name,category,unit,store_location,current_stock,selling_price,unit_cost) VALUES
    ($1,$2,'Synthetic Browser Item','Pharmaceuticals','Tablets','Synthetic Store',7,'7.50',NULL) RETURNING id`,
      [facility, `BR-IT-${suffix}`],
    )
  ).rows[0].id;
  // Synthetic opening stock, not a simulated receipt, procurement completion or valuation.
  await pool.query(
    "INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity_remaining,cost_per_unit) VALUES($1,'BR-BATCH','2099-12-31',7,NULL)",
    [item],
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
  console.log('Synthetic report reference fixtures created.');
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

  // Use real authenticated services, not manufactured approvals, for the
  // refund report fixture. Manual recording does not move external money.
  async function api(method, path, token, body) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  }
  async function login(identifier, secret) {
    const result = await api('POST', '/api/auth/login', null, { identifier, password: secret });
    check(result.status === 200 && result.data.sessionToken, 'Synthetic fixture login failed.');
    return result.data.sessionToken;
  }
  const requesterToken = await login(username, password);
  const reviewerToken = await login(reviewerUsername, reviewerPassword);
  const limitedToken = await login(limitedUsername, limitedPassword);
  async function expectStatus(method, path, token, body, status, label) {
    const result = await api(method, path, token, body);
    check(
      result.status === status,
      `${label}: expected HTTP ${status}, received ${result.status} (${result.data?.error ?? 'no error code'}).`,
    );
    return result.data;
  }
  const today = (await pool.query('SELECT current_date::text AS date')).rows[0].date;

  // Procurement: create a supplier and a pending, itemized order; a different
  // authorized person approves the exact revision. Approval is not receipt.
  const createdSupplier = await expectStatus(
    'POST',
    '/api/suppliers',
    requesterToken,
    { facilityId: facility, name: 'Synthetic Browser Supplier' },
    201,
    'Synthetic supplier creation',
  );
  const supplier = createdSupplier.id;
  check(Number.isSafeInteger(supplier), 'Synthetic supplier ID missing.');
  const orderInput = {
    facilityId: facility,
    supplierId: supplier,
    poNumber: `BR-PO-${suffix}`,
    expectedDeliveryDate: '2099-12-31',
    description: 'Synthetic report fixture order',
    items: [
      { description: 'Synthetic supplies', quantity: '2', unit: 'Pieces', unitPrice: '60.00' },
    ],
  };
  await expectStatus(
    'POST',
    '/api/purchase-orders',
    null,
    orderInput,
    401,
    'Unauthenticated order',
  );
  await expectStatus(
    'POST',
    '/api/purchase-orders',
    limitedToken,
    orderInput,
    403,
    'Order permission',
  );
  for (const target of [sibling, foreignFacility]) {
    await expectStatus(
      'POST',
      '/api/purchase-orders',
      requesterToken,
      { ...orderInput, facilityId: target },
      403,
      'Order facility/tenant scope',
    );
  }
  const order = await expectStatus(
    'POST',
    '/api/purchase-orders',
    requesterToken,
    orderInput,
    201,
    'Order creation',
  );
  check(
    order.status === 'Pending Approval' &&
      order.revision === 1 &&
      order.createdByUserId === userId &&
      order.totalAmount === '120.00',
    'Synthetic order was not a server-calculated pending order attributed to its creator.',
  );
  const orderAction = { facilityId: facility, expectedRevision: 1 };
  const selfOrder = await expectStatus(
    'POST',
    `/api/purchase-orders/${order.id}/approve`,
    requesterToken,
    orderAction,
    403,
    'Order self-approval',
  );
  check(
    selfOrder.error === 'SELF_APPROVAL_FORBIDDEN',
    'Order self-approval did not fail for independence.',
  );
  await expectStatus(
    'POST',
    `/api/purchase-orders/${order.id}/approve`,
    limitedToken,
    orderAction,
    403,
    'Order approval permission',
  );
  const approvedOrder = await expectStatus(
    'POST',
    `/api/purchase-orders/${order.id}/approve`,
    reviewerToken,
    orderAction,
    200,
    'Independent order approval',
  );
  check(
    approvedOrder.status === 'Approved' && approvedOrder.revision === 2,
    'Order approval or revision missing.',
  );
  await expectStatus(
    'POST',
    `/api/purchase-orders/${order.id}/approve`,
    reviewerToken,
    orderAction,
    409,
    'Duplicate order approval',
  );
  const duplicateOrder = await expectStatus(
    'POST',
    '/api/purchase-orders',
    requesterToken,
    orderInput,
    409,
    'Duplicate order number',
  );
  check(
    duplicateOrder.error === 'PURCHASE_ORDER_NUMBER_IN_USE',
    'Duplicate order number did not fail closed.',
  );
  const orderEvents = (
    await pool.query(
      'SELECT event_type,actor_user_id FROM purchase_order_events WHERE purchase_order_id=$1 ORDER BY id',
      [order.id],
    )
  ).rows;
  const orderAudits = (
    await pool.query(
      "SELECT action,user_id FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND resource='PurchaseOrder' AND resource_id=$3 ORDER BY id",
      [tenant, facility, String(order.id)],
    )
  ).rows;
  const orderSideEffects = (
    await pool.query(
      `SELECT (SELECT count(*)::int FROM purchase_orders WHERE tenant_id=$1 AND facility_id=$2 AND po_number=$3) AS orders,
            (SELECT count(*)::int FROM supplier_invoices WHERE purchase_order_id=$4) AS invoices,
            (SELECT current_stock FROM inventory_items WHERE id=$5) AS stock`,
      [tenant, facility, orderInput.poNumber, order.id, item],
    )
  ).rows[0];
  check(
    orderEvents.length === 2 &&
      orderEvents[0].event_type === 'CREATED' &&
      orderEvents[0].actor_user_id === userId &&
      orderEvents[1].event_type === 'APPROVE' &&
      orderEvents[1].actor_user_id === reviewer &&
      orderAudits.length === 2 &&
      orderAudits[0].action === 'CREATE' &&
      orderAudits[0].user_id === String(userId) &&
      orderAudits[1].action === 'APPROVE' &&
      orderAudits[1].user_id === String(reviewer) &&
      orderSideEffects.orders === 1 &&
      orderSideEffects.invoices === 0 &&
      orderSideEffects.stock === 7,
    'Purchase order actors, duplicate protection, audit or non-receipt invariants failed.',
  );
  console.log('Authenticated order, independent approval, scope, duplicate and audit checks: PASS');

  // Prescription alone must not deduct stock or create an invoice. Dispensing
  // uses the real FEFO and inventory-price snapshots and creates the billable source.
  const prescriptionInput = {
    encounterId: dispensingEncounter,
    patientId: patient,
    drugName: 'Synthetic Browser Item',
    dosage: 'Synthetic',
    frequency: 'Synthetic',
    duration: 'Synthetic',
    quantity: 3,
  };
  await expectStatus(
    'POST',
    '/api/medications',
    limitedToken,
    prescriptionInput,
    403,
    'Prescription permission',
  );
  const prescription = await expectStatus(
    'POST',
    '/api/medications',
    requesterToken,
    prescriptionInput,
    201,
    'Prescription creation',
  );
  const beforeDispensing = (
    await pool.query(
      `SELECT (SELECT current_stock FROM inventory_items WHERE id=$1) AS stock,
            (SELECT quantity_remaining FROM inventory_batches WHERE item_id=$1 AND batch_number='BR-BATCH') AS batch,
            (SELECT count(*)::int FROM billing_invoices WHERE encounter_id=$2) AS invoices`,
      [item, dispensingEncounter],
    )
  ).rows[0];
  check(
    beforeDispensing.stock === 7 && beforeDispensing.batch === 7 && beforeDispensing.invoices === 0,
    'A prescription alone changed stock or created an invoice.',
  );
  const dispenseInput = {
    facilityId: facility,
    patientId: patient,
    prescriptionId: prescription.id,
    itemId: item,
    quantityDispensed: 3,
    idempotencyKey: `browser-dispense-${suffix}`,
    // Neither the operator nor the price may be taken from untrusted input.
    dispensedBy: 'Synthetic forged operator',
    unitPrice: '999.00',
  };
  await expectStatus(
    'POST',
    '/api/pharmacy/dispense',
    limitedToken,
    dispenseInput,
    403,
    'Dispensing permission',
  );
  for (const target of [sibling, foreignFacility]) {
    await expectStatus(
      'POST',
      '/api/pharmacy/dispense',
      requesterToken,
      { ...dispenseInput, facilityId: target },
      403,
      'Dispensing facility/tenant scope',
    );
  }
  const dispensed = await expectStatus(
    'POST',
    '/api/pharmacy/dispense',
    requesterToken,
    dispenseInput,
    201,
    'Real pharmacy dispensing',
  );
  check(
    dispensed.id &&
      dispensed.replayed === false &&
      dispensed.stockTracking === 'FEFO' &&
      dispensed.stockAfter === 4 &&
      dispensed.billing?.charged === true &&
      dispensed.billing.totalAmount === '22.50' &&
      dispensed.billing.invoiceId &&
      dispensed.billing.invoiceNumber,
    'Dispensing did not create the expected inventory-priced invoice source.',
  );
  const dispensedAgain = await expectStatus(
    'POST',
    '/api/pharmacy/dispense',
    requesterToken,
    dispenseInput,
    201,
    'Dispensing replay',
  );
  check(
    dispensedAgain.replayed === true && dispensedAgain.id === dispensed.id,
    'Dispensing replay created a different event.',
  );
  const dispenseConflict = await expectStatus(
    'POST',
    '/api/pharmacy/dispense',
    requesterToken,
    { ...dispenseInput, quantityDispensed: 2 },
    409,
    'Changed dispensing replay',
  );
  check(
    dispenseConflict.error === 'IDEMPOTENCY_CONFLICT',
    'Changed dispensing replay was not rejected.',
  );
  const invoice = dispensed.billing.invoiceId;
  const invoiceNumber = dispensed.billing.invoiceNumber;
  const pharmacyEvidence = (
    await pool.query(
      `SELECT d.id,d.tenant_id,d.facility_id,d.patient_id,d.prescription_id,d.item_id,d.quantity_dispensed,
            d.dispensed_by,d.selling_price_snapshot::text AS price,to_char(d.dispensed_at,'YYYY-MM-DD') AS date,
            i.current_stock,b.quantity_remaining,m.status,
            (SELECT count(*)::int FROM pharmacy_dispensations WHERE prescription_id=d.prescription_id) AS dispensations,
            (SELECT count(*)::int FROM pharmacy_dispense_requests WHERE dispensation_id=d.id) AS requests,
            (SELECT sum(quantity)::int FROM pharmacy_dispense_allocations WHERE dispensation_id=d.id) AS allocated,
            (SELECT count(*)::int FROM billing_items WHERE source_type='PHARMACY' AND source_id=d.id) AS charges,
            (SELECT count(*)::int FROM audit_logs WHERE tenant_id=$2 AND facility_id=$3 AND user_id=$4
             AND resource='PharmacyDispensation' AND resource_id=d.id::text AND action='CREATE') AS audits
     FROM pharmacy_dispensations d JOIN inventory_items i ON i.id=d.item_id
     JOIN inventory_batches b ON b.item_id=i.id AND b.batch_number='BR-BATCH'
     JOIN medications m ON m.id=d.prescription_id WHERE d.id=$1`,
      [dispensed.id, tenant, facility, String(userId)],
    )
  ).rows[0];
  const pharmacyLine = (
    await pool.query(
      `SELECT invoice_id,inventory_item_id,prescription_id,quantity,unit_price::text,total_amount::text
     FROM billing_items WHERE source_type='PHARMACY' AND source_id=$1`,
      [dispensed.id],
    )
  ).rows[0];
  check(
    pharmacyEvidence?.tenant_id === tenant &&
      pharmacyEvidence.facility_id === facility &&
      pharmacyEvidence.patient_id === patient &&
      pharmacyEvidence.prescription_id === prescription.id &&
      pharmacyEvidence.item_id === item &&
      pharmacyEvidence.quantity_dispensed === 3 &&
      pharmacyEvidence.dispensed_by === 'Synthetic Browser Staff' &&
      pharmacyEvidence.price === '7.50' &&
      pharmacyEvidence.current_stock === 4 &&
      pharmacyEvidence.quantity_remaining === 4 &&
      pharmacyEvidence.status === 'Dispensed' &&
      pharmacyEvidence.dispensations === 1 &&
      pharmacyEvidence.requests === 1 &&
      pharmacyEvidence.allocated === 3 &&
      pharmacyEvidence.charges === 1 &&
      pharmacyEvidence.audits === 1 &&
      pharmacyEvidence.date &&
      pharmacyLine?.invoice_id === invoice &&
      pharmacyLine.inventory_item_id === item &&
      pharmacyLine.prescription_id === prescription.id &&
      pharmacyLine.quantity === 3 &&
      pharmacyLine.unit_price === '7.50' &&
      pharmacyLine.total_amount === '22.50',
    'Dispensing, stock, actor, audit, source and inventory-priced invoice did not reconcile.',
  );
  console.log('Prescription, FEFO dispensing, replay, audit and invoice reconciliation: PASS');

  // Record a manual synthetic receipt against the actual dispensation invoice.
  // This is not a provider transaction, bank settlement, or posted ledger entry.
  const paymentInput = {
    facilityId: facility,
    invoiceId: invoice,
    amount: '22.50',
    paymentMethod: 'Cash',
    idempotencyKey: `browser-receipt-${suffix}`,
  };
  await expectStatus(
    'POST',
    '/api/billing/payments',
    limitedToken,
    paymentInput,
    403,
    'Payment permission',
  );
  for (const target of [sibling, foreignFacility]) {
    await expectStatus(
      'POST',
      '/api/billing/payments',
      requesterToken,
      { ...paymentInput, facilityId: target },
      403,
      'Payment facility/tenant scope',
    );
  }
  const paid = {
    data: await expectStatus(
      'POST',
      '/api/billing/payments',
      requesterToken,
      paymentInput,
      201,
      'Payment recording',
    ),
  };
  check(
    paid.data.payment?.id && paid.data.idempotentReplay === false,
    'Synthetic receipt recording failed.',
  );
  const paidAgain = await expectStatus(
    'POST',
    '/api/billing/payments',
    requesterToken,
    paymentInput,
    200,
    'Payment replay',
  );
  check(
    paidAgain.idempotentReplay === true && paidAgain.payment.id === paid.data.payment.id,
    'Payment replay created a different receipt.',
  );
  const paymentConflict = await expectStatus(
    'POST',
    '/api/billing/payments',
    requesterToken,
    { ...paymentInput, amount: '20.00' },
    409,
    'Changed payment replay',
  );
  check(
    paymentConflict.error === 'PAYMENT_IDEMPOTENCY_CONFLICT',
    'Changed payment replay was not rejected.',
  );
  const receiptFixture = (
    await pool.query(
      `SELECT p.receipt_number AS number,to_char(p.payment_date,'YYYY-MM-DD') AS date,p.amount::text,
            p.cashier_name,r.actor_user_id,
            (SELECT count(*)::int FROM billing_payments WHERE invoice_id=$2) AS receipts,
            (SELECT count(*)::int FROM audit_logs WHERE tenant_id=$3 AND facility_id=$4 AND user_id=$5
             AND resource='Payment' AND resource_id=p.id::text AND action='CREATE') AS audits
     FROM billing_payments p JOIN billing_payment_requests r ON r.payment_id=p.id
     WHERE p.id=$1 AND r.tenant_id=$3 AND r.facility_id=$4`,
      [paid.data.payment.id, invoice, tenant, facility, String(userId)],
    )
  ).rows[0];
  check(
    receiptFixture?.number &&
      receiptFixture.date &&
      receiptFixture.amount === '22.50' &&
      receiptFixture.cashier_name === 'Synthetic Browser Staff' &&
      receiptFixture.actor_user_id === userId &&
      receiptFixture.receipts === 1 &&
      receiptFixture.audits === 1,
    'Payment identity, scope, audit or duplicate protection did not reconcile.',
  );
  console.log('Authorized receipt, scope, replay and actor audit: PASS');
  const refundInput = {
    facilityId: facility,
    invoiceId: invoice,
    paymentId: paid.data.payment.id,
    amount: '5.00',
    refundMethod: 'CASH',
    reason: 'Synthetic browser refund',
    idempotencyKey: `browser-refund-${suffix}`,
  };
  await expectStatus(
    'POST',
    '/api/billing/refund-requests',
    limitedToken,
    refundInput,
    403,
    'Refund request permission',
  );
  for (const target of [sibling, foreignFacility]) {
    await expectStatus(
      'POST',
      '/api/billing/refund-requests',
      requesterToken,
      { ...refundInput, facilityId: target },
      403,
      'Refund facility/tenant scope',
    );
  }
  const requested = await api('POST', '/api/billing/refund-requests', requesterToken, refundInput);
  check(requested.status === 201 && requested.data.request?.id, 'Synthetic refund request failed.');
  const reviewPage = await api(
    'GET',
    `/api/billing/refund-requests?facilityId=${facility}&invoiceId=${invoice}`,
    reviewerToken,
  );
  const review = reviewPage.data.requests?.find((entry) => entry.id === requested.data.request.id);
  check(
    reviewPage.status === 200 && review?.reviewHash && !review.issue,
    'Synthetic refund is not eligible for independent review.',
  );
  const refundDecision = {
    facilityId: facility,
    decision: 'APPROVE',
    reviewHash: review.reviewHash,
    notes: 'Independent synthetic browser review',
  };
  const selfRefund = await expectStatus(
    'POST',
    `/api/billing/refund-requests/${review.id}/decision`,
    requesterToken,
    refundDecision,
    403,
    'Refund self-approval',
  );
  check(
    selfRefund.error === 'SELF_REFUND_APPROVAL_FORBIDDEN',
    'Refund self-approval did not fail for independence.',
  );
  await expectStatus(
    'POST',
    '/api/billing/refunds',
    requesterToken,
    { ...refundInput, manualConfirmation: true },
    409,
    'Unapproved refund',
  );
  const decision = await api(
    'POST',
    `/api/billing/refund-requests/${review.id}/decision`,
    reviewerToken,
    refundDecision,
  );
  check(decision.status === 201 && decision.data.status === 'APPROVED', 'Synthetic review failed.');
  const recorded = await api('POST', '/api/billing/refunds', requesterToken, {
    ...refundInput,
    manualConfirmation: true,
  });
  check(
    recorded.status === 201 &&
      recorded.data.refund?.id &&
      recorded.data.accounting === 'NOT_POSTED',
    'Synthetic manual refund recording failed.',
  );
  const refundReplay = await expectStatus(
    'POST',
    '/api/billing/refunds',
    requesterToken,
    { ...refundInput, manualConfirmation: true },
    200,
    'Refund replay',
  );
  check(
    refundReplay.replayed === true && refundReplay.refund.id === recorded.data.refund.id,
    'Refund replay created a different record.',
  );
  const refundFixture = (
    await pool.query(
      `SELECT r.refund_number AS number,to_char(r.created_at,'YYYY-MM-DD') AS date,r.amount::text,
              r.actor_user_id,q.requested_by_user_id,q.reviewed_by_user_id,q.status,
              i.total_amount::text AS total,i.paid_amount::text AS paid,i.balance_amount::text AS balance,
              (SELECT count(*)::int FROM billing_refunds WHERE invoice_id=i.id) AS refunds,
              (SELECT count(*)::int FROM audit_logs WHERE tenant_id=$2 AND facility_id=$3 AND user_id=$4
               AND resource='RefundReceipt' AND resource_id=r.id::text AND action='CREATE') AS audits
       FROM billing_refunds r JOIN billing_refund_requests q ON q.settled_refund_id=r.id
       JOIN billing_invoices i ON i.id=r.invoice_id
       WHERE r.id=$1 AND r.tenant_id=$2 AND r.facility_id=$3`,
      [recorded.data.refund.id, tenant, facility, String(userId)],
    )
  ).rows[0];
  const refundAudits = (
    await pool.query(
      "SELECT action,user_id FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND resource='RefundRequest' AND resource_id=$3 ORDER BY id",
      [tenant, facility, String(review.id)],
    )
  ).rows;
  check(
    refundAudits.length === 3 &&
      refundAudits[0].action === 'REQUEST' &&
      refundAudits[0].user_id === String(userId) &&
      refundAudits[1].action === 'APPROVE' &&
      refundAudits[1].user_id === String(reviewer) &&
      refundAudits[2].action === 'SETTLE' &&
      refundAudits[2].user_id === String(userId),
    'Refund request and independent review actors were not audited.',
  );
  check(
    refundFixture?.number &&
      refundFixture.date &&
      refundFixture.amount === '5.00' &&
      refundFixture.actor_user_id === userId &&
      refundFixture.requested_by_user_id === userId &&
      refundFixture.reviewed_by_user_id === reviewer &&
      refundFixture.status === 'SETTLED' &&
      refundFixture.total === '22.50' &&
      refundFixture.paid === '17.50' &&
      refundFixture.balance === '5.00' &&
      refundFixture.refunds === 1 &&
      refundFixture.audits === 1,
    'Refund actors, audit, replay or invoice balances did not reconcile.',
  );
  console.log('Independent synthetic refund review, replay and manual recording: PASS');

  // An independent expense request is a supported journal source. Accounts
  // and an open period are synthetic configuration, not financial mappings or
  // opening balances. Posting this expense establishes a payable, not payment.
  async function createAccount(code, name, type, balance) {
    const response = await expectStatus(
      'POST',
      '/api/accounting/accounts',
      requesterToken,
      {
        facilityId: facility,
        accountCode: code,
        accountName: name,
        accountType: type,
        subType: 'SYNTHETIC',
        normalBalance: balance,
      },
      201,
      'Synthetic account configuration',
    );
    check(response.account?.id, 'Synthetic account configuration is missing an ID.');
    return response.account.id;
  }
  const expenseAccount = await createAccount(
    '5000',
    'Synthetic Browser Expense',
    'EXPENSE',
    'DEBIT',
  );
  const payableAccount = await createAccount(
    '2000',
    'Synthetic Browser Payable',
    'LIABILITY',
    'CREDIT',
  );
  await expectStatus(
    'POST',
    '/api/accounting/periods',
    requesterToken,
    {
      facilityId: facility,
      periodCode: `BR-${suffix}`,
      name: 'Synthetic browser day',
      startDate: today,
      endDate: today,
    },
    201,
    'Synthetic open accounting period',
  );
  const expenseInput = {
    facilityId: facility,
    expenseAccountId: expenseAccount,
    payableAccountId: payableAccount,
    amountKes: '120.10',
    incurredDate: today,
    payeeName: 'Synthetic Browser Expense Payee',
    category: 'Synthetic expense',
    description: 'Synthetic independently reviewed payable',
    idempotencyKey: `browser-expense-${suffix}`,
  };
  await expectStatus(
    'POST',
    '/api/accounting/expenses',
    limitedToken,
    expenseInput,
    403,
    'Expense permission',
  );
  for (const target of [sibling, foreignFacility]) {
    await expectStatus(
      'POST',
      '/api/accounting/expenses',
      requesterToken,
      { ...expenseInput, facilityId: target },
      403,
      'Expense facility/tenant scope',
    );
  }
  const expense = await expectStatus(
    'POST',
    '/api/accounting/expenses',
    requesterToken,
    expenseInput,
    201,
    'Expense request',
  );
  check(
    expense.expenseId && expense.idempotentReplay === false && expense.documentsVerified === false,
    'Expense request evidence missing.',
  );
  const expenseReplay = await expectStatus(
    'POST',
    '/api/accounting/expenses',
    requesterToken,
    expenseInput,
    200,
    'Expense request replay',
  );
  check(
    expenseReplay.idempotentReplay === true && expenseReplay.expenseId === expense.expenseId,
    'Expense replay created a different request.',
  );
  const expenseConflict = await expectStatus(
    'POST',
    '/api/accounting/expenses',
    requesterToken,
    { ...expenseInput, amountKes: '121.00' },
    409,
    'Changed expense replay',
  );
  check(
    expenseConflict.error === 'IDEMPOTENCY_CONFLICT',
    'Changed expense replay was not rejected.',
  );
  const expensePage = await expectStatus(
    'GET',
    `/api/accounting/expenses?facilityId=${facility}&search=${expense.expenseId}`,
    reviewerToken,
    undefined,
    200,
    'Expense review',
  );
  const expenseReview = expensePage.expenses?.find((row) => row.id === expense.expenseId);
  check(
    expenseReview?.reviewHash &&
      !expenseReview.reviewIssue &&
      expenseReview.requestedByUserId === userId,
    'Expense review evidence missing.',
  );
  const approvalInput = {
    facilityId: facility,
    reviewHash: expenseReview.reviewHash,
    notes: 'Independent synthetic expense review',
  };
  const selfExpense = await expectStatus(
    'POST',
    `/api/accounting/expenses/${expense.expenseId}/approve-and-post`,
    requesterToken,
    approvalInput,
    403,
    'Expense self-approval',
  );
  check(
    selfExpense.error === 'SELF_APPROVAL_FORBIDDEN',
    'Expense self-approval did not fail for independence.',
  );
  await expectStatus(
    'POST',
    `/api/accounting/expenses/${expense.expenseId}/approve-and-post`,
    limitedToken,
    approvalInput,
    403,
    'Expense posting permission',
  );
  for (const target of [sibling, foreignFacility]) {
    await expectStatus(
      'POST',
      `/api/accounting/expenses/${expense.expenseId}/approve-and-post`,
      reviewerToken,
      { ...approvalInput, facilityId: target },
      403,
      'Expense posting facility/tenant scope',
    );
  }
  const postedExpense = await expectStatus(
    'POST',
    `/api/accounting/expenses/${expense.expenseId}/approve-and-post`,
    reviewerToken,
    approvalInput,
    201,
    'Independent expense approval and posting',
  );
  check(
    postedExpense.journalId &&
      postedExpense.idempotentReplay === false &&
      postedExpense.paymentRecorded === false,
    'Expense posting did not preserve payable semantics.',
  );
  const postedAgain = await expectStatus(
    'POST',
    `/api/accounting/expenses/${expense.expenseId}/approve-and-post`,
    reviewerToken,
    approvalInput,
    200,
    'Expense posting replay',
  );
  check(
    postedAgain.idempotentReplay === true &&
      postedAgain.journalId === postedExpense.journalId &&
      postedAgain.paymentRecorded === false,
    'Expense posting replay created a different journal.',
  );
  const journal = (
    await pool.query(
      `SELECT e.status,e.requested_by_user_id,e.reviewed_by_user_id,e.posted_journal_id,
            j.source_type,j.source_id,j.status AS journal_status,j.posted_by_user_id,
            j.total_debit_cents::text AS debit,j.total_credit_cents::text AS credit,
            (SELECT count(*)::int FROM journal_entries x WHERE x.tenant_id=e.tenant_id AND x.facility_id=e.facility_id
             AND x.source_type='EXPENSE_REQUEST' AND x.source_id=e.id::text) AS journals
     FROM expense_requests e JOIN journal_entries j ON j.id=e.posted_journal_id AND j.tenant_id=e.tenant_id AND j.facility_id=e.facility_id
     WHERE e.id=$1 AND e.tenant_id=$2 AND e.facility_id=$3`,
      [expense.expenseId, tenant, facility],
    )
  ).rows[0];
  const lines = (
    await pool.query(
      'SELECT account_id,debit_cents::text AS debit,credit_cents::text AS credit FROM journal_lines WHERE journal_entry_id=$1 ORDER BY id',
      [postedExpense.journalId],
    )
  ).rows;
  const expenseAudits = (
    await pool.query(
      "SELECT action,user_id,details FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND resource='expense_request' AND resource_id=$3 ORDER BY id",
      [tenant, facility, String(expense.expenseId)],
    )
  ).rows;
  check(
    journal?.status === 'POSTED' &&
      journal.requested_by_user_id === userId &&
      journal.reviewed_by_user_id === reviewer &&
      journal.posted_journal_id === postedExpense.journalId &&
      journal.posted_by_user_id === reviewer &&
      journal.source_type === 'EXPENSE_REQUEST' &&
      journal.source_id === String(expense.expenseId) &&
      journal.journal_status === 'POSTED' &&
      journal.debit === '12010' &&
      journal.credit === '12010' &&
      journal.journals === 1 &&
      lines.length === 2 &&
      lines[0].account_id === expenseAccount &&
      lines[0].debit === '12010' &&
      lines[0].credit === '0' &&
      lines[1].account_id === payableAccount &&
      lines[1].debit === '0' &&
      lines[1].credit === '12010' &&
      expenseAudits.length === 3 &&
      expenseAudits[0].action === 'REQUEST' &&
      expenseAudits[0].user_id === String(userId) &&
      expenseAudits[1].action === 'APPROVE' &&
      expenseAudits[1].user_id === String(reviewer) &&
      JSON.parse(expenseAudits[1].details).reviewHash === expenseReview.reviewHash &&
      expenseAudits[2].action === 'POST' &&
      expenseAudits[2].user_id === String(reviewer),
    'Expense source, independent reviewers, journal, balance, audit or replay did not reconcile.',
  );
  const allMovements = await expectStatus(
    'POST',
    '/api/reporting/centre/ledger-trial-movements/generate',
    requesterToken,
    { facilityId: facility, from: today, to: today },
    200,
    'Unfiltered journal movement report',
  );
  check(
    allMovements.total === 2 &&
      allMovements.summaries?.length === 2 &&
      allMovements.summaries[0].value === '120.10' &&
      allMovements.summaries[1].value === '120.10',
    'Unfiltered report debit and credit totals did not reconcile to the balanced source journal.',
  );
  const invoiceFixture = (
    await pool.query(
      "SELECT invoice_number AS number,to_char(created_at,'YYYY-MM-DD') AS date FROM billing_invoices WHERE id=$1 AND tenant_id=$2 AND facility_id=$3",
      [invoice, tenant, facility],
    )
  ).rows[0];
  check(
    invoiceFixture?.number === invoiceNumber && invoiceFixture.date,
    'Dispensing invoice source missing.',
  );
  console.log(
    'Independent expense payable, balanced source-linked journal, audit and report totals: PASS',
  );
  console.log('Controlled synthetic fixture checks: PASS (no external transaction or settlement)');

  if (!fixturesOnly) {
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
      [
        'departmental',
        'Diagnosis reports',
        'outpatient-diagnoses',
        'Synthetic examination diagnosis',
      ],
      [
        'records',
        'OPD diagnosis reports',
        'outpatient-diagnoses',
        'Synthetic examination diagnosis',
      ],
      ['departmental', 'Admissions', 'inpatient-admissions', 'Synthetic BrowserPatient'],
      ['departmental', 'Discharges', 'inpatient-discharges', 'Synthetic BrowserPatient'],
      ['departmental', 'Test reports', 'laboratory-orders', 'Synthetic Browser Test'],
      ['departmental', 'Imaging requests', 'radiology-requests', 'Synthetic Browser Imaging'],
      ['departmental', 'Dispensing', 'pharmacy-dispensations', 'Synthetic Browser Item'],
      ['financial', 'All-cashier daily summary', 'cashier-receipts', 'Synthetic Browser Staff'],
      ['financial', 'Refund reports', 'recorded-refunds', refundFixture.number],
      ['financial', 'Patient outstanding balances', 'invoice-balances', invoiceNumber],
      ['records', 'Patient reports', 'patient-registrations', 'Synthetic BrowserPatient'],
      ['records', 'Current inpatient lists', 'current-inpatients', 'Synthetic BrowserPatient'],
      ['records', 'Inpatient discharges', 'inpatient-discharges', 'Synthetic BrowserPatient'],
      ['financial', 'Cashier daily summary', 'cashier-receipts', 'Synthetic Browser Staff'],
      ['financial', 'Trial balance', 'ledger-trial-movements', 'Synthetic Browser Expense'],
      ['financial', 'Income statement', 'ledger-income', 'Synthetic Browser Expense'],
      ['financial', 'Balance sheet', 'ledger-balance-sheet', 'Synthetic Browser Payable'],
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
        'outpatient-diagnoses': 'COMPLETED',
        'laboratory-orders': 'Ordered',
        'radiology-requests': 'Requested',
      };
      if (statusByEngine[engine])
        await page.select('form[aria-label="Report filters"] select', statusByEngine[engine]);
      const dateFields = await page.$$('form[aria-label="Report filters"] input[type="date"]');
      // Controlled events retain their real dates. The expiry and expected-delivery
      // examples use a future synthetic date; historical report-only rows use April.
      const sourceDates = {
        'inventory-expiry': '2099-12-31',
        'purchase-orders': '2099-12-31',
        'pharmacy-dispensations': pharmacyEvidence.date,
        'cashier-receipts': receiptFixture.date,
        'recorded-refunds': refundFixture.date,
        'invoice-balances': invoiceFixture.date,
        'ledger-trial-movements': today,
        'ledger-income': today,
        'ledger-balance-sheet': today,
      };
      const from = sourceDates[engine] ?? '2026-04-01';
      const to = sourceDates[engine] ?? '2026-04-30';
      if (dateFields.length) {
        await page.evaluate(
          ({ from, to }) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            document
              .querySelectorAll('form[aria-label="Report filters"] input[type="date"]')
              .forEach((input, index, inputs) => {
                setter.call(input, inputs.length === 1 || index === 1 ? to : from);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
              });
          },
          { from, to },
        );
      }
      // The list is visible before typing; native radios and checkboxes also work by keyboard.
      const selections = [];
      if (
        [
          'current-inpatients',
          'outpatient-encounters',
          'outpatient-diagnoses',
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
      if (engine === 'outpatient-diagnoses')
        selections.push(['Department', 'Synthetic Browser Department']);
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
      if (engine === 'invoice-balances') selections.push(['Invoice', invoiceNumber]);
      if (engine === 'cashier-receipts') selections.push(['Receipt', receiptFixture.number]);
      if (['ledger-trial-movements', 'ledger-income', 'ledger-balance-sheet'].includes(engine))
        selections.push([
          'Account',
          engine === 'ledger-balance-sheet'
            ? 'Synthetic Browser Payable'
            : 'Synthetic Browser Expense',
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
          !requestFilters.from && requestFilters.to === to,
          `${engine}: browser as-of date was not sent`,
        );
      else if (dateFields.length === 2)
        check(
          requestFilters.from === from && requestFilters.to === to,
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
      if (engine === 'outpatient-diagnoses')
        check(
          requestFilters.patientId === patient && requestFilters.departmentId === department,
          'Diagnosis register linked filters were not sent',
        );
      const body = await generatedResponse.json();
      check(
        body.total > 0 && JSON.stringify(body.rows).includes(expected),
        `${engine}: expected fixture not in returned rows`,
      );
      // Compare each controlled-event report with the persisted, scoped source
      // checked above; a 200 response or a matching label is not reconciliation.
      if (engine === 'purchase-orders') {
        const row = body.rows[0];
        check(
          body.total === 1 &&
            row.number === orderInput.poNumber &&
            row.status === 'Approved' &&
            row.orderAmount === '120.00',
          'Purchase order report did not reconcile to the independently approved order.',
        );
      }
      if (engine === 'pharmacy-dispensations') {
        const row = body.rows[0];
        check(
          body.total === 1 &&
            row.dispensationId === dispensed.id &&
            row.quantity === 3 &&
            row.itemCode === `BR-IT-${suffix}` &&
            row.batch === 'BR-BATCH',
          'Dispensing report did not reconcile to the recorded event and allocation.',
        );
      }
      if (engine === 'cashier-receipts') {
        const row = body.rows[0];
        check(
          body.total === 1 &&
            row.cashier === receiptFixture.cashier_name &&
            row.receiptCount === 1 &&
            row.amount === '22.50' &&
            row.unknownAmounts === 0,
          'Receipt report did not reconcile to the recorded gross receipt.',
        );
      }
      if (engine === 'recorded-refunds') {
        const row = body.rows[0];
        check(
          body.total === 1 &&
            row.number === refundFixture.number &&
            row.invoice === invoiceNumber &&
            row.amount === '5.00' &&
            row.actorId === userId,
          'Refund report did not reconcile to the manually recorded, independently approved refund.',
        );
      }
      if (engine === 'invoice-balances') {
        check(
          body.total === 1 &&
            body.rows[0].invoice === invoiceNumber &&
            body.rows[0].balance === '5.00',
          'Invoice balance report did not reconcile to its receipt and refund.',
        );
      }
      if (['ledger-trial-movements', 'ledger-income', 'ledger-balance-sheet'].includes(engine)) {
        const row = body.rows[0];
        check(
          body.total === 1 &&
            (engine === 'ledger-balance-sheet'
              ? row.account === 'Synthetic Browser Payable' &&
                row.type === 'LIABILITY' &&
                row.normalAmount === '120.10'
              : row.account === 'Synthetic Browser Expense' &&
                row.type === 'EXPENSE' &&
                row.debits === '120.10' &&
                row.credits === '0.00' &&
                row.normalAmount === '120.10'),
          'Filtered ledger report did not reconcile to the posted expense journal.',
        );
      }
      if (engine === 'outpatient-diagnoses') {
        const source = (
          await pool.query(
            `SELECT e.id AS encounter_id,e.patient_id,e.status,d.id AS diagnosis_id,
                  d.icd10_code,d.icd10_description
           FROM encounters e JOIN diagnoses d ON d.encounter_id=e.id AND d.patient_id=e.patient_id
           WHERE e.id=$1 AND e.tenant_id=$2 AND e.facility_id=$3`,
            [encounter, tenant, facility],
          )
        ).rows;
        check(
          source.length === 1 &&
            source[0].patient_id === patient &&
            body.total === 1 &&
            body.rows.length === 1 &&
            body.rows[0].encounterId === source[0].encounter_id &&
            body.rows[0].diagnosisId === source[0].diagnosis_id &&
            body.rows[0].legacyIcd10Code === source[0].icd10_code &&
            body.rows[0].legacyIcd10Description === source[0].icd10_description &&
            body.rows[0].encounterStatus === source[0].status,
          'Diagnosis browser response did not reconcile with its synthetic PostgreSQL source.',
        );
      }
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
      if (engine === 'outpatient-diagnoses') {
        const reportAudit = (
          await pool.query(
            `SELECT count(*) FILTER (WHERE action='VIEW')::int AS views,
                  count(*) FILTER (WHERE action='PRINT_REQUEST')::int AS prints,
                  count(*) FILTER (WHERE action='EXPORT_REQUEST')::int AS exports
           FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND user_id=$3
             AND resource='report_centre' AND resource_id='outpatient-diagnoses'`,
            [tenant, facility, String(userId)],
          )
        ).rows[0];
        const patientAudit = (
          await pool.query(
            `SELECT count(*) FILTER (WHERE action='VIEW')::int AS views,
                  count(*) FILTER (WHERE action='PRINT')::int AS prints,
                  count(*) FILTER (WHERE action='EXPORT')::int AS exports
           FROM patient_record_access_logs WHERE tenant_id=$1 AND facility_id=$2 AND user_id=$3
             AND patient_id=$4 AND record_type='REPORT_CENTRE' AND purpose='outpatient-diagnoses'`,
            [tenant, facility, userId, patient],
          )
        ).rows[0];
        check(
          [reportAudit, patientAudit].every(
            (row) => row.views >= 1 && row.prints >= 1 && row.exports >= 3,
          ),
          'Diagnosis view, print and export audits did not persist.',
        );
        console.log('Diagnosis browser → source and request/patient audits: PASS');
      }
      console.log(`${engine}: browser selection, generation, PDF, XLSX, CSV and print PASS`);
    }
    // An invoice is opened by choosing a real invoice number, never by entering its database ID.
    await selectReport(page, 'printables', 'Invoices');
    await chooseOption(page, 'Invoice', invoiceNumber);
    const invoiceOpen = page.waitForResponse(
      (response) =>
        response.url().includes(`/invoices/${invoice}/`) && response.request().method() === 'GET',
    );
    await page.evaluate(() =>
      [...document.querySelectorAll('main button')]
        .find((button) => button.textContent.trim() === 'Open invoice')
        ?.click(),
    );
    const unfinalizedResponse = await invoiceOpen;
    const unfinalizedView = await unfinalizedResponse.json();
    check(
      unfinalizedResponse.status() === 200 &&
        new URL(unfinalizedResponse.url()).searchParams.get('facilityId') === String(facility) &&
        unfinalizedView.finalized === false,
      'Invoice selection did not open the scoped unfinalized document workflow.',
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

    // Finalize the source-linked pharmacy invoice through the real authorized workflow;
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
      { authorization: authHeader, invoiceId: invoice },
    );
    check(
      finalized.status === 201 && finalized.replay === false,
      `Synthetic finalization failed: ${finalized.status} ${finalized.error ?? ''}`,
    );
    await chooseOption(page, 'Invoice', invoiceNumber);
    const finalizedOpen = page.waitForResponse(
      (response) =>
        response.url().includes(`/invoices/${invoice}/finalization`) &&
        response.request().method() === 'GET',
    );
    await page.evaluate(() =>
      [...document.querySelectorAll('main button')]
        .find((button) => button.textContent.trim() === 'Open invoice')
        ?.click(),
    );
    const finalizedResponse = await finalizedOpen;
    const finalizedView = await finalizedResponse.json();
    const finalizedLine = finalizedView.snapshot?.items?.[0];
    check(
      finalizedResponse.status() === 200 &&
        new URL(finalizedResponse.url()).searchParams.get('facilityId') === String(facility) &&
        finalizedView.finalized === true &&
        finalizedView.voided === false &&
        finalizedView.snapshot?.invoice?.number === invoiceNumber &&
        finalizedView.snapshot?.items?.length === 1 &&
        finalizedLine?.priceSource === 'INVENTORY_SNAPSHOT' &&
        finalizedLine.quantity === 3 &&
        finalizedLine.unitPrice === '7.50' &&
        finalizedLine.total === '22.50' &&
        finalizedView.financial?.reconciled === true &&
        finalizedView.financial.invoiceBalance === '5.00',
      'Finalized document, inventory-priced line or reconciled balance was incorrect.',
    );
    await page.waitForFunction(
      (number) => {
        const field = [...document.querySelectorAll('fieldset')].find((element) =>
          element.querySelector('legend')?.textContent?.startsWith('Invoice ('),
        );
        const selected = [...(field?.querySelectorAll('label') ?? [])].find((element) =>
          element.textContent.includes(number),
        );
        const text = document.querySelector('.invoice-print-area')?.textContent ?? '';
        return (
          selected?.querySelector('input[type=radio]')?.checked &&
          text.includes(number) &&
          text.includes('Synthetic Browser Item') &&
          text.includes('KES 22.50') &&
          text.includes('Invoice balance: KES 5.00') &&
          text.includes('Finalized:')
        );
      },
      {},
      invoiceNumber,
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
        response.url().endsWith(`/invoices/${invoice}/print-access`) &&
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
      invoiceText.replace(/\s+/g, '').includes(invoiceNumber.replace(/\s+/g, '')) &&
        invoiceText.replace(/\s+/g, '').includes('SyntheticBrowserItem'),
      'Finalized invoice print output is missing its recorded reference or service.',
    );
    await page.emulateMediaType('screen');
    await page.evaluate(() => {
      window.__syntheticPrintRequested = false;
      window.dispatchEvent(new Event('afterprint'));
    });
    const invoiceEvidence = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM billing_invoices WHERE encounter_id=$5) AS invoices,
         (SELECT count(*)::int FROM billing_items WHERE invoice_id=$4 AND source_type='PHARMACY') AS charges,
         (SELECT count(*)::int FROM billing_invoice_finalizations WHERE invoice_id=$4) AS finalizations,
         (SELECT count(*)::int FROM audit_logs WHERE tenant_id=$6 AND facility_id=$3 AND resource='Invoice' AND resource_id=$4::text AND action='FINALIZE' AND user_id=$7) AS finalization_audits,
         (SELECT count(*)::int FROM patient_record_access_logs WHERE patient_id=$1 AND user_id=$2 AND facility_id=$3 AND record_type='FinalizedInvoice' AND record_id=$4 AND action='VIEW') AS views,
         (SELECT count(*)::int FROM patient_record_access_logs WHERE patient_id=$1 AND user_id=$2 AND facility_id=$3 AND record_type='FinalizedInvoice' AND record_id=$4 AND action='PRINT') AS prints`,
      [patient, userId, facility, invoice, dispensingEncounter, tenant, String(userId)],
    );
    const evidence = invoiceEvidence.rows[0];
    check(
      evidence.invoices === 1 &&
        evidence.charges === 1 &&
        evidence.finalizations === 1 &&
        evidence.finalization_audits === 1 &&
        evidence.views === 1 &&
        evidence.prints === 1,
      'Invoice, charge, finalization or view/print audit counts were incorrect.',
    );
    console.log(
      'Finalized invoice same-selection reload, snapshot, reconciliation and audited print: PASS',
    );

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
    const filterInput =
      'form[aria-label="Report filters"] input[placeholder="Enter a search term"]';
    await page.type(filterInput, 'Synthetic Browser Bulk');
    const firstRequest = page.waitForResponse(
      (response) =>
        response.url().endsWith('/laboratory-orders/generate') &&
        response.request().method() === 'POST',
    );
    await page.click('form[aria-label="Report filters"] button[type="submit"]');
    const firstPage = await (await firstRequest).json();
    check(
      firstPage.total === 30 && firstPage.rows.length === 25,
      'Browser first page is incorrect.',
    );
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
    await limitedPage.type('input[placeholder="Password"]', limitedPassword);
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
  }
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
  await pool.end();
}
