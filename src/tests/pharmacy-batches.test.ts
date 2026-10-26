/**
 * JaliCare HMIS
 * Pharmacy stock — expiry and FEFO allocation
 *
 * Expiry control is the difference between a pharmacy and a cupboard.
 * These tests pin the rules that decide which physical box leaves the
 * shelf, and they run without a database:
 *
 *   1. Only real ISO dates are accepted (2026-02-31 is not a date).
 *   2. A batch expiring today is still dispensable; yesterday's is not.
 *   3. FEFO: earliest expiry first, stable when two lots share a date.
 *   4. Expired lots are never allocated, but are reported separately so
 *      the error message can distinguish "we have none" from "ours are
 *      all out of date".
 *   5. A request larger than usable stock leaves a shortfall and does
 *      not partially commit at the planning stage.
 *   6. Stock valuation is done in cents, not floats.
 *
 * Run with: npx tsx src/tests/pharmacy-batches.test.ts
 */

import {
  daysUntilExpiry,
  expiryStatus,
  isUsable,
  parseIsoDate,
  planFefo,
  stockValueCents,
  todayKey,
  type BatchLot,
} from '../inventory/inventory-contracts.ts';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(actual === expected, `${label} (expected ${String(expected)}, got ${String(actual)})`);
}

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

const TODAY = '2026-10-21';

function lot(
  id: number,
  batchNumber: string,
  expiryDate: string,
  quantityRemaining: number,
): BatchLot {
  return { id, batchNumber, expiryDate, quantityRemaining };
}

/* ============================================================
   1. DATE PARSING
   ============================================================ */

function testDateParsing(): void {
  assert(parseIsoDate('2026-10-21') !== null, 'a plain ISO date parses');
  assert(parseIsoDate('2024-02-29') !== null, 'a leap day parses in a leap year');

  /* Date would roll these forward; a batch must never gain shelf life. */
  assertEqual(parseIsoDate('2026-02-31'), null, '31 February is rejected');
  assertEqual(parseIsoDate('2026-02-29'), null, '29 February in a non-leap year is rejected');
  assertEqual(parseIsoDate('2026-13-01'), null, 'month 13 is rejected');
  assertEqual(parseIsoDate('2026-00-10'), null, 'month 0 is rejected');
  assertEqual(parseIsoDate('2026-10-00'), null, 'day 0 is rejected');
  assertEqual(parseIsoDate('21/10/2026'), null, 'day-first format is rejected');
  assertEqual(parseIsoDate('2026-10-21T00:00:00Z'), null, 'timestamps are rejected');
  assertEqual(parseIsoDate(''), null, 'empty string is rejected');
  assertEqual(parseIsoDate(null), null, 'null is rejected');
  assertEqual(parseIsoDate(undefined), null, 'undefined is rejected');

  assertEqual(todayKey(new Date(2026, 0, 5)), '2026-01-05', 'todayKey pads');
}

/* ============================================================
   2. EXPIRY STATUS
   ============================================================ */

function testExpiryStatus(): void {
  assertEqual(daysUntilExpiry('2026-10-21', TODAY), 0, 'today is 0 days away');
  assertEqual(daysUntilExpiry('2026-10-31', TODAY), 10, '10 days');
  assertEqual(daysUntilExpiry('2026-10-20', TODAY), -1, 'yesterday is -1');
  assertEqual(daysUntilExpiry('not-a-date', TODAY), null, 'garbage is null');

  /*
   * The expiry date is the last usable day, so stock expiring today is
   * still dispensed — it is "Expiring", not "Expired".
   */
  assertEqual(expiryStatus('2026-10-21', TODAY), 'Expiring', 'expiring today is usable');
  assertEqual(expiryStatus('2026-10-20', TODAY), 'Expired', 'expired yesterday');
  assertEqual(expiryStatus('2026-11-20', TODAY), 'Expiring', '30 days out is inside the window');
  assertEqual(expiryStatus('2026-11-21', TODAY), 'OK', '31 days out is outside the window');
  assertEqual(expiryStatus('2027-10-21', TODAY), 'OK', 'a year out is OK');
  assertEqual(expiryStatus('2026-10-21', TODAY, 0), 'Expiring', 'a zero horizon still flags today');
  assertEqual(expiryStatus('2026-10-22', TODAY, 0), 'OK', 'a zero horizon excludes tomorrow');

  assert(isUsable('2026-10-21', TODAY), 'usable on its expiry date');
  assert(!isUsable('2026-10-20', TODAY), 'not usable the day after expiry');
  assert(!isUsable('rubbish', TODAY), 'an unreadable expiry is treated as expired');
}

/* ============================================================
   3. FEFO
   ============================================================ */

function testFefoOrdering(): void {
  const lots = [
    lot(1, 'LATE', '2027-06-30', 100),
    lot(2, 'SOON', '2026-11-01', 40),
    lot(3, 'MIDDLE', '2027-01-15', 60),
  ];

  const plan = planFefo(lots, 50, TODAY);

  assertEqual(plan.allocations.length, 2, 'a 50-unit draw spans two lots');
  assertEqual(plan.allocations[0].batchNumber, 'SOON', 'earliest expiry is drawn first');
  assertEqual(plan.allocations[0].quantity, 40, 'the whole near-expiry lot is taken');
  assertEqual(plan.allocations[1].batchNumber, 'MIDDLE', 'the next earliest follows');
  assertEqual(plan.allocations[1].quantity, 10, 'only the remainder is taken');
  assertEqual(plan.allocated, 50, 'the full request is covered');
  assertEqual(plan.shortfall, 0, 'no shortfall');
  assertEqual(plan.usableUnits, 200, 'usable stock is reported');

  /* Nothing is taken from the far-dated lot while nearer stock exists. */
  assert(
    !plan.allocations.some((allocation) => allocation.batchNumber === 'LATE'),
    'the furthest expiry is untouched',
  );
}

function testFefoTiesAndEdges(): void {
  /* Same expiry date: the lower id wins, so the result is deterministic. */
  const tied = planFefo([lot(9, 'B', '2026-12-01', 5), lot(4, 'A', '2026-12-01', 5)], 5, TODAY);

  assertEqual(tied.allocations[0].batchNumber, 'A', 'ties break on the lower batch id');

  /* Exact-fit, single-lot draw. */
  const exact = planFefo([lot(1, 'ONLY', '2026-12-01', 25)], 25, TODAY);
  assertEqual(exact.shortfall, 0, 'an exact fit is complete');
  assertEqual(exact.allocations.length, 1, 'one lot is enough');

  /* Empty and zero-quantity lots are ignored. */
  assertEqual(planFefo([], 5, TODAY).shortfall, 5, 'no lots means full shortfall');
  assertEqual(
    planFefo([lot(1, 'EMPTY', '2026-12-01', 0)], 5, TODAY).shortfall,
    5,
    'empty lots are not allocated from',
  );

  /* A non-positive request allocates nothing. */
  const zero = planFefo([lot(1, 'A', '2026-12-01', 100)], 0, TODAY);
  assertEqual(zero.allocated, 0, 'zero quantity allocates nothing');
  assertEqual(zero.allocations.length, 0, 'zero quantity returns no allocations');

  const negative = planFefo([lot(1, 'A', '2026-12-01', 100)], -5, TODAY);
  assertEqual(negative.allocated, 0, 'a negative quantity allocates nothing');
}

/* ============================================================
   4. EXPIRED STOCK IS NEVER DISPENSED
   ============================================================ */

function testExpiredExcluded(): void {
  const lots = [
    lot(1, 'EXPIRED-A', '2026-09-01', 500),
    lot(2, 'EXPIRED-B', '2026-10-20', 200),
    lot(3, 'GOOD', '2026-12-01', 30),
  ];

  const plan = planFefo(lots, 30, TODAY);

  assertEqual(plan.allocations.length, 1, 'only the usable lot is drawn');
  assertEqual(
    plan.allocations[0].batchNumber,
    'GOOD',
    'the expired lots are skipped and the good one used',
  );
  assertEqual(plan.expiredUnits, 700, 'expired units are reported');
  assertEqual(plan.usableUnits, 30, 'only usable stock counts toward availability');
  assertEqual(plan.shortfall, 0, 'the usable stock covers the request');

  /*
   * A request the usable stock cannot meet must fail rather than quietly
   * handing over expired tablets.
   */
  const short = planFefo(lots, 31, TODAY);
  assertEqual(short.shortfall, 1, 'one unit short');
  assertEqual(short.allocated, 30, 'the planner reports what it could take');
  assertEqual(short.expiredUnits, 700, 'expired stock is still surfaced');
}

/* ============================================================
   5. STOCK VALUE
   ============================================================ */

function testStockValue(): void {
  assertEqual(stockValueCents([]), 0, 'no lots is worth nothing');

  assertEqual(
    stockValueCents([{ quantityRemaining: 3, costPerUnit: '0.10' }]),
    30,
    'three units at ten cents is thirty cents',
  );

  /* 0.1 + 0.2 in floats is 0.30000000000000004; in cents it is 30. */
  assertEqual(
    stockValueCents([
      { quantityRemaining: 1, costPerUnit: '0.10' },
      { quantityRemaining: 1, costPerUnit: '0.20' },
    ]),
    30,
    'cents avoid the floating point trap',
  );

  assertEqual(
    stockValueCents([
      { quantityRemaining: 10, costPerUnit: '12.50' },
      { quantityRemaining: 4, costPerUnit: 5 },
    ]),
    10 * 1250 + 4 * 500,
    'mixed string and numeric costs',
  );

  assertEqual(
    stockValueCents([{ quantityRemaining: -5, costPerUnit: '10' }]),
    0,
    'negative quantities are ignored',
  );

  assertEqual(
    stockValueCents([{ quantityRemaining: 5, costPerUnit: null }]),
    0,
    'a missing cost is zero',
  );
}

/* ============================================================
   6. WIRING
   ============================================================ */

function testRouteWiring(): void {
  const app = readRepoFile('src/app.ts');

  assert(
    app.includes("app.use('/api/inventory', requireFacilityModule('inventory'))"),
    'inventory routes are gated by the inventory facility module',
  );

  for (const [route, permission] of [
    ['/api/inventory/batches', 'inventory.read'],
    ['/api/inventory/expiry-summary', 'inventory.read'],
    ['/api/inventory/:id/batches', 'inventory.manage'],
  ] as const) {
    const index = app.indexOf(`'${route}'`);
    assert(index > -1, `${route} is registered`);

    const window = app.slice(index, index + 260);
    assert(
      window.includes(`requirePermission('${permission}')`),
      `${route} requires ${permission}`,
    );
  }

  /* Dispensing must go through the FEFO service, not the old blind update. */
  const dispenseIndex = app.indexOf("'/api/pharmacy/dispense'");
  const dispenseBody = app.slice(dispenseIndex, dispenseIndex + 1500);

  assert(dispenseBody.includes('dispenseFefoScoped'), 'dispensing uses the FEFO service');
  assert(
    !dispenseBody.includes('queries.dispenseMedication'),
    'dispensing no longer uses the non-transactional stock update',
  );

  /* The analytics summary feeds the dashboard expiry alert. */
  assert(app.includes('expiringStockAlerts'), 'analytics summary reports expiring batches');
}

function testServiceWiring(): void {
  const service = readRepoFile('src/inventory/inventory.service.ts');

  assert(service.includes(".for('update')"), 'batch rows are locked while dispensing');
  assert(
    service.includes('INSUFFICIENT_STOCK'),
    'the service refuses a draw larger than usable stock',
  );
  assert(
    service.includes('inventory_batches') || service.includes('inventoryBatches'),
    'the service reads inventory_batches',
  );

  const client = readRepoFile('src/api/client.ts');
  assert(client.includes('getInventoryBatches'), 'client exposes batch listing');
  assert(client.includes('getExpirySummary'), 'client exposes the expiry summary');
  assert(client.includes('receiveBatch'), 'client can receive a batch');

  const inventoryUi = readRepoFile('src/components/modules/InventoryModule.tsx');
  assert(inventoryUi.includes('Batches & Expiry'), 'inventory screen has a batches tab');
  assert(!inventoryUi.includes('&amp;'), 'no HTML entities leak into rendered text');
  assert(inventoryUi.includes('Receive Batch'), 'inventory screen can receive a batch');
  assert(inventoryUi.includes('expiredUnits'), 'inventory screen shows expired units');

  const pharmacyUi = readRepoFile('src/components/modules/PharmacyModule.tsx');
  assert(pharmacyUi.includes('FEFO'), 'pharmacy screen explains FEFO');
  assert(
    pharmacyUi.includes('excluded from dispensing'),
    'pharmacy screen warns when expired stock exists',
  );
}

/* ============================================================
   RUN
   ============================================================ */

function run(): void {
  console.log('');
  console.log('PHARMACY BATCH TESTS');
  console.log('==============================================');

  testDateParsing();
  console.log('  1. Only real ISO dates are accepted');

  testExpiryStatus();
  console.log('  2. Expiry status respects the last-usable-day rule');

  testFefoOrdering();
  console.log('  3. FEFO draws the earliest expiry first');

  testFefoTiesAndEdges();
  console.log('  4. Ties, exact fits and empty lots behave');

  testExpiredExcluded();
  console.log('  5. Expired stock is never allocated');

  testStockValue();
  console.log('  6. Stock value is computed in cents');

  testRouteWiring();
  console.log('  7. Batch routes are guarded and dispense uses FEFO');

  testServiceWiring();
  console.log('  8. Client and screens are wired to batches');

  console.log('');
  console.log('==============================================');
  console.log(`PHARMACY BATCH TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('PHARMACY BATCH TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
