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

import { describe, expect, it } from 'vitest';
import { appSource } from './support/schema-source.ts';

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

describe('Pharmacy stock — expiry and FEFO allocation', () => {
  it('1. DATE PARSING', async () => {
    expect(parseIsoDate('2026-10-21') !== null, 'a plain ISO date parses').toBe(true);
    expect(parseIsoDate('2024-02-29') !== null, 'a leap day parses in a leap year').toBe(true);

    /* Date would roll these forward; a batch must never gain shelf life. */
    expect(parseIsoDate('2026-02-31'), '31 February is rejected').toBe(null);
    expect(parseIsoDate('2026-02-29'), '29 February in a non-leap year is rejected').toBe(null);
    expect(parseIsoDate('2026-13-01'), 'month 13 is rejected').toBe(null);
    expect(parseIsoDate('2026-00-10'), 'month 0 is rejected').toBe(null);
    expect(parseIsoDate('2026-10-00'), 'day 0 is rejected').toBe(null);
    expect(parseIsoDate('21/10/2026'), 'day-first format is rejected').toBe(null);
    expect(parseIsoDate('2026-10-21T00:00:00Z'), 'timestamps are rejected').toBe(null);
    expect(parseIsoDate(''), 'empty string is rejected').toBe(null);
    expect(parseIsoDate(null), 'null is rejected').toBe(null);
    expect(parseIsoDate(undefined), 'undefined is rejected').toBe(null);

    expect(todayKey(new Date(2026, 0, 5)), 'todayKey pads').toBe('2026-01-05');
  });

  it('2. EXPIRY STATUS', async () => {
    expect(daysUntilExpiry('2026-10-21', TODAY), 'today is 0 days away').toBe(0);
    expect(daysUntilExpiry('2026-10-31', TODAY), '10 days').toBe(10);
    expect(daysUntilExpiry('2026-10-20', TODAY), 'yesterday is -1').toBe(-1);
    expect(daysUntilExpiry('not-a-date', TODAY), 'garbage is null').toBe(null);

    /*
     * The expiry date is the last usable day, so stock expiring today is
     * still dispensed — it is "Expiring", not "Expired".
     */
    expect(expiryStatus('2026-10-21', TODAY), 'expiring today is usable').toBe('Expiring');
    expect(expiryStatus('2026-10-20', TODAY), 'expired yesterday').toBe('Expired');
    expect(expiryStatus('2026-11-20', TODAY), '30 days out is inside the window').toBe('Expiring');
    expect(expiryStatus('2026-11-21', TODAY), '31 days out is outside the window').toBe('OK');
    expect(expiryStatus('2027-10-21', TODAY), 'a year out is OK').toBe('OK');
    expect(expiryStatus('2026-10-21', TODAY, 0), 'a zero horizon still flags today').toBe(
      'Expiring',
    );
    expect(expiryStatus('2026-10-22', TODAY, 0), 'a zero horizon excludes tomorrow').toBe('OK');

    expect(isUsable('2026-10-21', TODAY), 'usable on its expiry date').toBe(true);
    expect(!isUsable('2026-10-20', TODAY), 'not usable the day after expiry').toBe(true);
    expect(!isUsable('rubbish', TODAY), 'an unreadable expiry is treated as expired').toBe(true);
  });

  it('3. FEFO', async () => {
    const lots = [
      lot(1, 'LATE', '2027-06-30', 100),
      lot(2, 'SOON', '2026-11-01', 40),
      lot(3, 'MIDDLE', '2027-01-15', 60),
    ];

    const plan = planFefo(lots, 50, TODAY);

    expect(plan.allocations.length, 'a 50-unit draw spans two lots').toBe(2);
    expect(plan.allocations[0].batchNumber, 'earliest expiry is drawn first').toBe('SOON');
    expect(plan.allocations[0].quantity, 'the whole near-expiry lot is taken').toBe(40);
    expect(plan.allocations[1].batchNumber, 'the next earliest follows').toBe('MIDDLE');
    expect(plan.allocations[1].quantity, 'only the remainder is taken').toBe(10);
    expect(plan.allocated, 'the full request is covered').toBe(50);
    expect(plan.shortfall, 'no shortfall').toBe(0);
    expect(plan.usableUnits, 'usable stock is reported').toBe(200);

    /* Nothing is taken from the far-dated lot while nearer stock exists. */
    expect(
      !plan.allocations.some((allocation) => allocation.batchNumber === 'LATE'),
      'the furthest expiry is untouched',
    ).toBe(true);
  });

  it('Fefo Ties And Edges', async () => {
    /* Same expiry date: the lower id wins, so the result is deterministic. */
    const tied = planFefo([lot(9, 'B', '2026-12-01', 5), lot(4, 'A', '2026-12-01', 5)], 5, TODAY);

    expect(tied.allocations[0].batchNumber, 'ties break on the lower batch id').toBe('A');

    /* Exact-fit, single-lot draw. */
    const exact = planFefo([lot(1, 'ONLY', '2026-12-01', 25)], 25, TODAY);
    expect(exact.shortfall, 'an exact fit is complete').toBe(0);
    expect(exact.allocations.length, 'one lot is enough').toBe(1);

    /* Empty and zero-quantity lots are ignored. */
    expect(planFefo([], 5, TODAY).shortfall, 'no lots means full shortfall').toBe(5);
    expect(
      planFefo([lot(1, 'EMPTY', '2026-12-01', 0)], 5, TODAY).shortfall,
      'empty lots are not allocated from',
    ).toBe(5);

    /* A non-positive request allocates nothing. */
    const zero = planFefo([lot(1, 'A', '2026-12-01', 100)], 0, TODAY);
    expect(zero.allocated, 'zero quantity allocates nothing').toBe(0);
    expect(zero.allocations.length, 'zero quantity returns no allocations').toBe(0);

    const negative = planFefo([lot(1, 'A', '2026-12-01', 100)], -5, TODAY);
    expect(negative.allocated, 'a negative quantity allocates nothing').toBe(0);
  });

  it('4. EXPIRED STOCK IS NEVER DISPENSED', async () => {
    const lots = [
      lot(1, 'EXPIRED-A', '2026-09-01', 500),
      lot(2, 'EXPIRED-B', '2026-10-20', 200),
      lot(3, 'GOOD', '2026-12-01', 30),
    ];

    const plan = planFefo(lots, 30, TODAY);

    expect(plan.allocations.length, 'only the usable lot is drawn').toBe(1);
    expect(
      plan.allocations[0].batchNumber,
      'the expired lots are skipped and the good one used',
    ).toBe('GOOD');
    expect(plan.expiredUnits, 'expired units are reported').toBe(700);
    expect(plan.usableUnits, 'only usable stock counts toward availability').toBe(30);
    expect(plan.shortfall, 'the usable stock covers the request').toBe(0);

    /*
     * A request the usable stock cannot meet must fail rather than quietly
     * handing over expired tablets.
     */
    const short = planFefo(lots, 31, TODAY);
    expect(short.shortfall, 'one unit short').toBe(1);
    expect(short.allocated, 'the planner reports what it could take').toBe(30);
    expect(short.expiredUnits, 'expired stock is still surfaced').toBe(700);
  });

  it('5. STOCK VALUE', async () => {
    expect(stockValueCents([]), 'no lots is worth nothing').toBe(0);

    expect(
      stockValueCents([{ quantityRemaining: 3, costPerUnit: '0.10' }]),
      'three units at ten cents is thirty cents',
    ).toBe(30);

    /* 0.1 + 0.2 in floats is 0.30000000000000004; in cents it is 30. */
    expect(
      stockValueCents([
        { quantityRemaining: 1, costPerUnit: '0.10' },
        { quantityRemaining: 1, costPerUnit: '0.20' },
      ]),
      'cents avoid the floating point trap',
    ).toBe(30);

    expect(
      stockValueCents([
        { quantityRemaining: 10, costPerUnit: '12.50' },
        { quantityRemaining: 4, costPerUnit: 5 },
      ]),
      'mixed string and numeric costs',
    ).toBe(10 * 1250 + 4 * 500);

    expect(
      stockValueCents([{ quantityRemaining: -5, costPerUnit: '10' }]),
      'negative quantities are ignored',
    ).toBe(0);

    expect(
      stockValueCents([{ quantityRemaining: 5, costPerUnit: null }]),
      'a missing cost is zero',
    ).toBe(0);
  });

  it('6. WIRING', async () => {
    const app = appSource();
    const pharmacy = readRepoFile('src/routes/pharmacy.routes.ts');
    const wiring = readRepoFile('src/routes/index.ts');

    /*
     * The mount lines live in src/routes/index.ts now. That router is
     * mounted at '/api' by app.ts, so the prefix is relative here - the
     * assertion still pins the same gate to the same public path.
     */

    expect(
      wiring.includes("api.use('/inventory', requireFacilityModule('inventory'))"),
      'inventory routes are gated by the inventory facility module',
    ).toBe(true);

    for (const [route, permission] of [
      ['/api/inventory/batches', 'inventory.read'],
      ['/api/inventory/expiry-summary', 'inventory.read'],
      ['/api/inventory/:id/batches', 'inventory.manage'],
    ] as const) {
      const index = pharmacy.indexOf(`'${route}'`);
      expect(index > -1, `${route} is registered`).toBe(true);

      const window = pharmacy.slice(index, index + 260);
      expect(
        window.includes(`requirePermission('${permission}')`),
        `${route} requires ${permission}`,
      ).toBe(true);
    }

    /* Dispensing must go through the FEFO service, not the old blind update. */
    const dispenseIndex = pharmacy.indexOf("'/api/pharmacy/dispense'");
    expect(dispenseIndex > -1, 'the dispense route is in the pharmacy router').toBe(true);
    const dispenseBody = pharmacy.slice(dispenseIndex, dispenseIndex + 1500);

    expect(dispenseBody.includes('dispenseFefoScoped'), 'dispensing uses the FEFO service').toBe(
      true,
    );
    expect(
      !dispenseBody.includes('queries.dispenseMedication'),
      'dispensing no longer uses the non-transactional stock update',
    ).toBe(true);

    /* The analytics summary feeds the dashboard expiry alert. */
    expect(app.includes('expiringStockAlerts'), 'analytics summary reports expiring batches').toBe(
      true,
    );
  });

  it('Service Wiring', async () => {
    const service = readRepoFile('src/inventory/inventory.service.ts');

    expect(service.includes(".for('update')"), 'batch rows are locked while dispensing').toBe(true);
    expect(
      service.includes('INSUFFICIENT_STOCK'),
      'the service refuses a draw larger than usable stock',
    ).toBe(true);
    expect(
      service.includes('inventory_batches') || service.includes('inventoryBatches'),
      'the service reads inventory_batches',
    ).toBe(true);

    const client = readRepoFile('src/api/client.ts');
    expect(client.includes('getInventoryBatches'), 'client exposes batch listing').toBe(true);
    expect(client.includes('getExpirySummary'), 'client exposes the expiry summary').toBe(true);
    expect(client.includes('receiveBatch'), 'client can receive a batch').toBe(true);

    const inventoryUi = readRepoFile('src/components/modules/InventoryModule.tsx');
    expect(inventoryUi.includes('Batches & Expiry'), 'inventory screen has a batches tab').toBe(
      true,
    );
    expect(!inventoryUi.includes('&amp;'), 'no HTML entities leak into rendered text').toBe(true);
    expect(inventoryUi.includes('Receive Batch'), 'inventory screen can receive a batch').toBe(
      true,
    );
    expect(inventoryUi.includes('expiredUnits'), 'inventory screen shows expired units').toBe(true);

    const pharmacyUi = readRepoFile('src/components/modules/PharmacyModule.tsx');
    expect(pharmacyUi.includes('FEFO'), 'pharmacy screen explains FEFO').toBe(true);
    expect(
      pharmacyUi.includes('excluded from dispensing'),
      'pharmacy screen warns when expired stock exists',
    ).toBe(true);
  });
});
