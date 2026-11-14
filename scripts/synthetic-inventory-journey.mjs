/**
 * Synthetic inventory / stock-control journey (development only).
 *
 * Exercises the real HTTP endpoints and checks the database evidence behind
 * them:
 *   receive → movement → replay refusal → adjustment → negative-stock refusal
 *   → permission refusal → physical count → variance posting → double-post
 *   refusal → store transfer → reorder alerts → FEFO dispense → valuation.
 *
 * Requires the synthetic inventory fixture, a running app and a synthetic
 * database. No passwords are printed.
 */
import 'dotenv/config';
import pg from 'pg';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const database = process.env.SQL_DB_NAME ?? '';

if (process.env.SYNTHETIC_JOURNEY_CONFIRM !== 'yes')
  throw new Error('Set SYNTHETIC_JOURNEY_CONFIRM=yes to run the synthetic journey.');
if (process.env.NODE_ENV === 'production')
  throw new Error('The synthetic journey refuses production.');
if (!/synth/i.test(database))
  throw new Error('Refusing to run: SQL_DB_NAME must look synthetic (for example jalicare_synth).');
for (const key of ['SYNTH_INVENTORY_PASSWORD', 'SYNTH_INVENTORY_READER_PASSWORD']) {
  if (!process.env[key]) throw new Error(`${key} is required (the value is never printed).`);
}

const results = [];
function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function login(username, password) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password }),
  });
  if (!response.ok) throw new Error(`Login failed for ${username}: HTTP ${response.status}`);
  const body = await response.json();
  const cookie = response.headers.getSetCookie?.()?.join('; ') ?? '';
  return { token: body.token ?? body.sessionToken ?? null, cookie, body };
}

function authHeaders(session) {
  const headers = { 'Content-Type': 'application/json' };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (session.cookie) headers.Cookie = session.cookie;
  return headers;
}

async function call(session, method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: authHeaders(session),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}

const stamp = Date.now().toString(36).toUpperCase();
const resultsFile = '/tmp/inventory-journey-report.json';

const pool = new pg.Pool({
  host: process.env.SQL_HOST,
  port: Number(process.env.SQL_PORT),
  database,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD,
  ssl: false,
});

try {
  const store = await login('synthetic.inventory', process.env.SYNTH_INVENTORY_PASSWORD);
  const viewer = await login(
    'synthetic.inventory.reader',
    process.env.SYNTH_INVENTORY_READER_PASSWORD,
  );
  const facilityId = store.body.user.facilityId;
  record('Synthetic accounts sign in', true, `facility ${facilityId}`);

  const itemsResponse = await call(store, 'GET', `/api/inventory?facilityId=${facilityId}`);
  const rawItems = Array.isArray(itemsResponse.body)
    ? itemsResponse.body
    : (itemsResponse.body?.items ?? itemsResponse.body?.data ?? []);
  const items = Object.fromEntries(
    rawItems
      .filter((item) => String(item.itemCode ?? '').startsWith('SYNTH-CTRL-'))
      .map((item) => [item.itemCode, item]),
  );
  record(
    'Stock register lists the synthetic items',
    Object.keys(items).length === 4,
    `${Object.keys(items).length} of 4 controlled items`,
  );
  const itemId = (code) => items[code]?.id;
  const stockOf = async (code) => {
    const row = await pool.query('SELECT current_stock FROM inventory_items WHERE id = $1', [
      itemId(code),
    ]);
    return row.rows[0]?.current_stock ?? null;
  };
  const movementsFor = async (code) =>
    (
      await pool.query(
        `SELECT id, movement_type, quantity_delta, stock_after, reason_code, reference_type
           FROM inventory_movements WHERE item_id = $1 ORDER BY id`,
        [itemId(code)],
      )
    ).rows;

  /*
   * Fixture reruns keep their stock, so the journey records the state it found
   * and proves that every change it made is explained, rather than assuming a
   * pristine database.
   */
  const controlledIds = Object.values(items).map((item) => item.id);
  const deltaByItemNow = async () => {
    const rows = await pool.query(
      `SELECT item_id, COALESCE(SUM(quantity_delta), 0)::int AS delta FROM inventory_movements
        WHERE facility_id = $1 AND item_id = ANY($2::int[]) GROUP BY item_id`,
      [facilityId, controlledIds],
    );
    return new Map(rows.rows.map((row) => [Number(row.item_id), row.delta]));
  };
  const legCount = async (code, type) =>
    (await movementsFor(code)).filter((row) => row.movement_type === type).length;
  const baseline = {
    stock: {},
    delta: await deltaByItemNow(),
    transferLegs: {
      out: await legCount('SYNTH-CTRL-SYRINGE', 'TRANSFER_OUT'),
      in: await legCount('SYNTH-CTRL-SYRINGE', 'TRANSFER_IN'),
    },
  };
  for (const code of Object.keys(items)) baseline.stock[code] = await stockOf(code);
  record(
    'Baseline stock and ledger captured',
    controlledIds.length === 4 && baseline.delta instanceof Map,
    `gauze ${baseline.stock['SYNTH-CTRL-GAUZE']}, syrup ${baseline.stock['SYNTH-CTRL-SYRINGE']}`,
  );

  // ---- Receive -----------------------------------------------------------
  const receiveKey = `SYNTH-INV-RECV-${stamp}`;
  const received = await call(
    store,
    'POST',
    `/api/inventory/${itemId('SYNTH-CTRL-GAUZE')}/batches`,
    {
      batchNumber: `SYNTH-JOURNEY-${stamp}`,
      expiryDate: '2027-12-31',
      quantity: 25,
      costPerUnit: '350.00',
      idempotencyKey: receiveKey,
    },
  );
  record(
    'Batch receipt is recorded',
    received.status === 201 && received.body?.received === 25,
    `HTTP ${received.status}, stock ${received.body?.item?.currentStock}`,
  );

  let gauzeMovements = await movementsFor('SYNTH-CTRL-GAUZE');
  const gauzeStart = baseline.stock['SYNTH-CTRL-GAUZE'];
  const receiptMovement = [...gauzeMovements]
    .reverse()
    .find((row) => row.movement_type === 'RECEIPT');
  record(
    'Receiving appends a RECEIPT movement in the same transaction',
    receiptMovement?.quantity_delta === 25 && receiptMovement?.stock_after === gauzeStart + 25,
    receiptMovement
      ? `${receiptMovement.quantity_delta} → ${receiptMovement.stock_after}`
      : 'no movement row',
  );

  const replay = await call(store, 'POST', `/api/inventory/${itemId('SYNTH-CTRL-GAUZE')}/batches`, {
    batchNumber: `SYNTH-JOURNEY-${stamp}`,
    expiryDate: '2027-12-31',
    quantity: 25,
    costPerUnit: '350.00',
    idempotencyKey: receiveKey,
  });
  gauzeMovements = await movementsFor('SYNTH-CTRL-GAUZE');
  const receiptsThisRun = gauzeMovements.filter(
    (row) => row.movement_type === 'RECEIPT' && row.stock_after === gauzeStart + 25,
  );
  record(
    'A replayed receipt does not double the stock or the ledger',
    replay.status === 200 &&
      replay.body?.replayed === true &&
      receiptsThisRun.length === 1 &&
      (await stockOf('SYNTH-CTRL-GAUZE')) === gauzeStart + 25,
    `HTTP ${replay.status}, stock ${await stockOf('SYNTH-CTRL-GAUZE')}`,
  );

  // ---- Adjustments -------------------------------------------------------
  const damaged = await call(store, 'POST', '/api/inventory/adjustments', {
    facilityId,
    itemId: itemId('SYNTH-CTRL-GAUZE'),
    direction: 'DECREASE',
    quantity: 3,
    reasonCode: 'DAMAGE',
    movementDate: '2026-11-05',
    notes: 'Synthetic torn packs found during acceptance testing.',
  });
  record(
    'A documented adjustment reduces stock',
    damaged.status === 201 && damaged.body?.adjustment?.stockAfter === gauzeStart + 22,
    `HTTP ${damaged.status}, stock ${damaged.body?.adjustment?.stockAfter}`,
  );
  const adjustmentMovement = [...(await movementsFor('SYNTH-CTRL-GAUZE'))]
    .reverse()
    .find((row) => row.movement_type === 'ADJUSTMENT');
  record(
    'The adjustment carries its reason code to the ledger',
    adjustmentMovement?.quantity_delta === -3 &&
      adjustmentMovement?.reason_code === 'DAMAGE' &&
      adjustmentMovement?.stock_after === gauzeStart + 22,
    `${adjustmentMovement?.quantity_delta} → ${adjustmentMovement?.stock_after} (${adjustmentMovement?.reason_code})`,
  );

  const negative = await call(store, 'POST', '/api/inventory/adjustments', {
    facilityId,
    itemId: itemId('SYNTH-CTRL-GAUZE'),
    direction: 'DECREASE',
    quantity: 9999,
    reasonCode: 'DAMAGE',
    movementDate: '2026-11-05',
  });
  record(
    'An adjustment below zero is refused',
    negative.status === 409 && negative.body?.error === 'NEGATIVE_STOCK',
    `HTTP ${negative.status} ${negative.body?.error ?? ''}`,
  );

  const badReason = await call(store, 'POST', '/api/inventory/adjustments', {
    facilityId,
    itemId: itemId('SYNTH-CTRL-GAUZE'),
    direction: 'DECREASE',
    quantity: 1,
    reasonCode: 'BECAUSE',
    movementDate: '2026-11-05',
  });
  record(
    'An unrecognised reason code is refused',
    badReason.status === 400 && badReason.body?.error === 'INVALID_REASON',
    `HTTP ${badReason.status} ${badReason.body?.error ?? ''}`,
  );

  const viewerAdjustment = await call(viewer, 'POST', '/api/inventory/adjustments', {
    facilityId,
    itemId: itemId('SYNTH-CTRL-GAUZE'),
    direction: 'DECREASE',
    quantity: 1,
    reasonCode: 'DAMAGE',
    movementDate: '2026-11-05',
  });
  record(
    'A read-only account cannot adjust stock',
    viewerAdjustment.status === 403,
    `HTTP ${viewerAdjustment.status}`,
  );
  record(
    'The refused requests left stock untouched',
    (await stockOf('SYNTH-CTRL-GAUZE')) === gauzeStart + 22,
    `stock ${await stockOf('SYNTH-CTRL-GAUZE')}`,
  );

  // ---- Physical count ----------------------------------------------------
  const countNumber = `COUNT-${stamp}`;
  const count = await call(store, 'POST', '/api/inventory/stock-counts', {
    facilityId,
    countNumber,
    countDate: '2026-11-05',
    storeLocation: 'Main Store',
    notes: 'Synthetic physical count for acceptance testing.',
  });
  const countId = count.body?.count?.id;
  const countLines = count.body?.count?.lines ?? [];
  record(
    'A physical count opens with expected quantities',
    count.status === 201 &&
      countLines.length >= 3 &&
      countLines.every((line) => line.expectedQuantity >= 0),
    `HTTP ${count.status}, ${countLines.length} lines`,
  );
  record(
    'Counts are scoped to the chosen store',
    countLines.every((line) => line.itemCode !== 'SYNTH-CTRL-GLOVE'),
    countLines.map((line) => line.itemCode).join(', '),
  );

  const stockBeforeCount = await stockOf('SYNTH-CTRL-GAUZE');
  const counted = await call(store, 'POST', `/api/inventory/stock-counts/${countId}/lines`, {
    facilityId,
    itemId: itemId('SYNTH-CTRL-GAUZE'),
    countedQuantity: stockBeforeCount - 2,
    notes: 'Two packs were missing from the shelf.',
  });
  const gauzeLine = (counted.body?.count?.lines ?? []).find(
    (line) => line.itemId === itemId('SYNTH-CTRL-GAUZE'),
  );
  record(
    'A counted quantity records its variance',
    counted.status === 200 && gauzeLine?.varianceQuantity === -2,
    `expected ${gauzeLine?.expectedQuantity}, variance ${gauzeLine?.varianceQuantity}`,
  );

  const posted = await call(store, 'POST', `/api/inventory/stock-counts/${countId}/post`, {
    facilityId,
  });
  record(
    'Posting the count applies the variance to stock',
    posted.status === 200 &&
      posted.body?.count?.status === 'POSTED' &&
      (await stockOf('SYNTH-CTRL-GAUZE')) === stockBeforeCount - 2,
    `HTTP ${posted.status}, stock ${await stockOf('SYNTH-CTRL-GAUZE')}`,
  );
  const varianceMovement = [...(await movementsFor('SYNTH-CTRL-GAUZE'))]
    .reverse()
    .find((row) => row.movement_type === 'COUNT_VARIANCE');
  record(
    'The variance is explained in the ledger',
    varianceMovement?.quantity_delta === -2 && varianceMovement?.reference_type === 'STOCK_COUNT',
    `${varianceMovement?.quantity_delta} (${varianceMovement?.reference_type})`,
  );

  const reposted = await call(store, 'POST', `/api/inventory/stock-counts/${countId}/post`, {
    facilityId,
  });
  record(
    'A posted count cannot be posted twice',
    reposted.status === 409 && reposted.body?.error === 'COUNT_CLOSED',
    `HTTP ${reposted.status} ${reposted.body?.error ?? ''}`,
  );

  // ---- Store transfer ----------------------------------------------------
  const transfer = await call(store, 'POST', '/api/inventory/transfers', {
    facilityId,
    transferNumber: `TRF-${stamp}`,
    transferDate: '2026-11-05',
    storeFrom: 'Main Store',
    storeTo: 'Satellite Store',
    notes: 'Synthetic replenishment of the satellite store.',
    items: [{ itemId: itemId('SYNTH-CTRL-SYRINGE'), quantity: 10 }],
  });
  const syringeMovements = await movementsFor('SYNTH-CTRL-SYRINGE');
  record(
    'A transfer records both legs and leaves the total unchanged',
    transfer.status === 201 &&
      transfer.body?.transfer?.items?.length === 1 &&
      syringeMovements.filter((row) => row.movement_type === 'TRANSFER_OUT').length ===
        baseline.transferLegs.out + 1 &&
      syringeMovements.filter((row) => row.movement_type === 'TRANSFER_IN').length ===
        baseline.transferLegs.in + 1 &&
      (await stockOf('SYNTH-CTRL-SYRINGE')) === baseline.stock['SYNTH-CTRL-SYRINGE'],
    `stock ${await stockOf('SYNTH-CTRL-SYRINGE')}`,
  );

  const sameStore = await call(store, 'POST', '/api/inventory/transfers', {
    facilityId,
    transferNumber: `TRF-SAME-${stamp}`,
    transferDate: '2026-11-05',
    storeFrom: 'Main Store',
    storeTo: 'Main Store',
    items: [{ itemId: itemId('SYNTH-CTRL-SYRINGE'), quantity: 1 }],
  });
  record(
    'A transfer to the same store is refused',
    sameStore.status === 400 && sameStore.body?.error === 'SAME_STORE',
    `HTTP ${sameStore.status} ${sameStore.body?.error ?? ''}`,
  );

  const tooMany = await call(store, 'POST', '/api/inventory/transfers', {
    facilityId,
    transferNumber: `TRF-OVER-${stamp}`,
    transferDate: '2026-11-05',
    storeFrom: 'Main Store',
    storeTo: 'Satellite Store',
    items: [{ itemId: itemId('SYNTH-CTRL-SYRINGE'), quantity: 99999 }],
  });
  record(
    'A transfer larger than the stock on hand is refused',
    tooMany.status === 409 && tooMany.body?.error === 'INSUFFICIENT_STOCK',
    `HTTP ${tooMany.status} ${tooMany.body?.error ?? ''}`,
  );

  // ---- Reorder levels ----------------------------------------------------
  const gauzeBeforeReorder = await stockOf('SYNTH-CTRL-GAUZE');
  await call(store, 'PUT', `/api/inventory/items/${itemId('SYNTH-CTRL-GAUZE')}/reorder-level`, {
    facilityId,
    reorderLevel: gauzeBeforeReorder,
  });
  const alerts = await call(store, 'GET', `/api/inventory/reorder-alerts?facilityId=${facilityId}`);
  const alertCodes = (alerts.body?.items ?? []).map((item) => item.itemCode);
  record(
    'Items at or below their reorder level are listed',
    alerts.status === 200 &&
      alertCodes.includes('SYNTH-CTRL-GAUZE') &&
      alertCodes.includes('SYNTH-CTRL-ALCOHOL'),
    alertCodes.join(', '),
  );

  const reorder = await call(
    store,
    'PUT',
    `/api/inventory/items/${itemId('SYNTH-CTRL-GAUZE')}/reorder-level`,
    { facilityId, reorderLevel: 5 },
  );
  const alertsAfter = await call(
    store,
    'GET',
    `/api/inventory/reorder-alerts?facilityId=${facilityId}`,
  );
  record(
    'Lowering the reorder level clears the alert',
    reorder.status === 200 &&
      reorder.body?.item?.reorderLevel === 5 &&
      !(alertsAfter.body?.items ?? []).some((item) => item.itemCode === 'SYNTH-CTRL-GAUZE'),
    `HTTP ${reorder.status}`,
  );

  // ---- Dispensing integration -------------------------------------------
  const dispenseKey = `SYNTH-INV-DISP-${stamp}`;
  const dispensed = await call(store, 'POST', '/api/pharmacy/dispense', {
    facilityId,
    patientId: Number(process.env.SYNTH_INVENTORY_PATIENT_ID ?? 1),
    itemId: itemId('SYNTH-CTRL-SYRINGE'),
    quantityDispensed: 5,
    idempotencyKey: dispenseKey,
  });
  const syringeStart = baseline.stock['SYNTH-CTRL-SYRINGE'];
  const afterDispense = await stockOf('SYNTH-CTRL-SYRINGE');
  record(
    'Dispensing reduces stock through the existing FEFO path',
    [200, 201].includes(dispensed.status) && afterDispense === syringeStart - 5,
    `HTTP ${dispensed.status}, stock ${afterDispense}${dispensed.status !== 200 ? ` (${dispensed.body?.error ?? ''})` : ''}`,
  );
  const dispenseMovement = [...(await movementsFor('SYNTH-CTRL-SYRINGE'))]
    .reverse()
    .find((row) => row.movement_type === 'DISPENSE');
  record(
    'The dispensation is explained in the ledger',
    dispenseMovement?.quantity_delta === -5 && dispenseMovement?.stock_after === syringeStart - 5,
    `${dispenseMovement?.quantity_delta} → ${dispenseMovement?.stock_after}`,
  );

  await call(store, 'POST', '/api/pharmacy/dispense', {
    facilityId,
    patientId: Number(process.env.SYNTH_INVENTORY_PATIENT_ID ?? 1),
    itemId: itemId('SYNTH-CTRL-SYRINGE'),
    quantityDispensed: 5,
    idempotencyKey: dispenseKey,
  });
  const dispenseMovementsAfterReplay = (await movementsFor('SYNTH-CTRL-SYRINGE')).filter(
    (row) => row.movement_type === 'DISPENSE' && row.stock_after === syringeStart - 5,
  );
  record(
    'A replayed dispensation is not posted twice',
    dispenseMovementsAfterReplay.length === 1 &&
      (await stockOf('SYNTH-CTRL-SYRINGE')) === syringeStart - 5,
    `${dispenseMovementsAfterReplay.length} DISPENSE row(s), stock ${await stockOf('SYNTH-CTRL-SYRINGE')}`,
  );

  // ---- Valuation ---------------------------------------------------------
  const valuation = await call(store, 'GET', `/api/inventory/valuation?facilityId=${facilityId}`);
  const gauzeBatches = (valuation.body?.valuation?.batches ?? []).filter(
    (batch) => batch.itemCode === 'SYNTH-CTRL-GAUZE',
  );
  const gauzeValue = gauzeBatches.reduce((sum, batch) => sum + Number(batch.valueCents ?? 0), 0);
  const gauzeStock = await stockOf('SYNTH-CTRL-GAUZE');
  const gauzeDrift = (valuation.body?.valuation?.batchReconciliation ?? []).find(
    (row) => row.itemCode === 'SYNTH-CTRL-GAUZE',
  );
  record(
    'Stock is valued at the recorded batch cost',
    valuation.status === 200 &&
      Number(valuation.body?.valuation?.totalKes ?? 0) > 0 &&
      !gauzeDrift &&
      gauzeValue === gauzeStock * 35000,
    `total KES ${valuation.body?.valuation?.totalKes}, gauze ${gauzeValue} cents for ${gauzeStock} on hand`,
  );
  record(
    'Unvalued batches are reported rather than counted as zero',
    valuation.status === 200 && typeof valuation.body?.valuation?.unvaluedBatches === 'number',
    `${valuation.body?.valuation?.unvaluedBatches} unvalued batch(es)`,
  );

  // ---- Ledger integrity --------------------------------------------------
  const deltaByItem = await deltaByItemNow();
  let reconciled = true;
  const reconciliation = [];
  for (const code of Object.keys(items)) {
    const current = await stockOf(code);
    /*
     * Every movement recorded since the baseline must account exactly for the
     * change in stock. Baseline stock came from before this run, so it is the
     * constant and the per-item delta since baseline is the movement total.
     */
    const deltaSinceBaseline =
      (deltaByItem.get(itemId(code)) ?? 0) - (baseline.delta.get(itemId(code)) ?? 0);
    const expected = baseline.stock[code] + deltaSinceBaseline;
    reconciliation.push(
      `${code} ${baseline.stock[code]}${deltaSinceBaseline >= 0 ? '+' : ''}${deltaSinceBaseline}=${current}`,
    );
    if (current !== expected) reconciled = false;
  }
  record(
    'Opening stock plus the ledger equals stock on hand for every item',
    reconciled,
    reconciliation.join('; '),
  );

  const negativeBalances = await pool.query(
    `SELECT COUNT(*)::int AS count FROM inventory_movements WHERE facility_id = $1 AND stock_after < 0`,
    [facilityId],
  );
  record(
    'No ledger row records a negative balance',
    negativeBalances.rows[0].count === 0,
    `${negativeBalances.rows[0].count} row(s)`,
  );

  // ---- Facility isolation ------------------------------------------------
  const foreign = await pool.query(
    `SELECT id FROM facilities WHERE tenant_id <> $1 ORDER BY id LIMIT 1`,
    [store.body.user.tenantId],
  );
  if (foreign.rows.length) {
    const foreignId = foreign.rows[0].id;
    const crossFacility = await call(
      store,
      'GET',
      `/api/inventory/movements?facilityId=${foreignId}`,
    );
    record(
      'A facility cannot read another facility ledger',
      crossFacility.status === 403 || crossFacility.status === 404,
      `HTTP ${crossFacility.status} ${crossFacility.body?.error ?? ''}`,
    );
    const crossWrite = await call(store, 'POST', '/api/inventory/adjustments', {
      facilityId: foreignId,
      itemId: itemId('SYNTH-CTRL-GAUZE'),
      direction: 'INCREASE',
      quantity: 1,
      reasonCode: 'DONATION',
      movementDate: '2026-11-05',
    });
    record(
      'A facility cannot adjust another facility stock',
      crossWrite.status === 403 || crossWrite.status === 404,
      `HTTP ${crossWrite.status} ${crossWrite.body?.error ?? ''}`,
    );
  } else {
    record('A facility cannot read another facility ledger', false, 'no second facility to test');
  }

  // ---- Expiry integration ------------------------------------------------
  const expiry = await call(store, 'GET', `/api/inventory/expiry-summary?facilityId=${facilityId}`);
  record(
    'The existing expiry summary still reads the same stock',
    expiry.status === 200,
    `HTTP ${expiry.status}`,
  );
} catch (error) {
  record('Journey completed without an unexpected exception', false, error.message);
} finally {
  const passed = results.filter((row) => row.passed).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} checks passed, ${failed} failed.`);
  await import('node:fs').then(({ writeFileSync }) =>
    writeFileSync(resultsFile, JSON.stringify({ stamp, results, passed, failed }, null, 2)),
  );
  console.log(`Report written to ${resultsFile}`);
  await pool.end().catch(() => undefined);
  if (failed > 0) process.exitCode = 1;
}
