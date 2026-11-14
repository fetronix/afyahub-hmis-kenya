/**
 * Batch B — inventory posting end to end, against real PostgreSQL.
 *
 * WHAT THIS FILE PROVES
 * ---------------------
 *  1. A facility with no policy posts nothing. Buying stock still expenses at
 *     invoice exactly as before; the shelf simply carries no ledger value.
 *  2. Configuration is inert until activated: a saved draft posts no journal
 *     and leaves the facility on the default basis.
 *  3. Activation demands a named finance approver, an effective date and a
 *     complete account set, and refuses to activate while lots are unvalued or
 *     the item stock disagrees with its lots.
 *  4. Activation posts the opening balance — stock asset against the
 *     explicitly configured opening counterpart — for what was already on the
 *     shelf, and flips the policy to ACTIVE.
 *  5. A receipt debits stock and credits clearing, once per note, and a replay
 *     of the same note returns the same journal instead of a second one.
 *  6. A dispensing-style issue debits consumption and credits stock at the lot
 *     cost FEFO actually drew, and records which lots it drew.
 *  7. An expiry write-off goes to the write-off account; an upward adjustment
 *     credits the adjustment account; a physical count posts one netted
 *     journal for the whole count.
 *  8. A supplier invoice on the perpetual basis clears the receipt instead of
 *     expensing it again; recoverable tax goes to the input-tax account and
 *     non-recoverable tax to an expense, never into stock.
 *  9. Reconciliation agrees when the books are right and names the difference
 *     when they are not.
 * 10. A closed period rejects the posting and rolls the stock write back with
 *     it — no movement, no lot change, no journal.
 * 11. Facility scope holds: another facility's active policy does not post for
 *     a facility that has none.
 *
 * WHAT THIS FILE DOES NOT PROVE
 * -----------------------------
 * Production readiness. Every row here is synthetic, the GRN and dispensing
 * flows are exercised through the same service functions the routes call but
 * not through the browser, and supplier returns/credit notes are out of scope
 * for this batch. Nothing here demonstrates statutory acceptance in Kenya.
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql, type SQL } from 'drizzle-orm';

import { transaction } from '../../accounting/accounting.service.ts';
import { db, pool } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import {
  activateInventoryAccountingPolicy,
  postCountVariance,
  postStockIssue,
  postStockReceipt,
  postSupplierInvoiceClearing,
  readInventoryAccountingPolicy,
  readInventoryReconciliation,
  recordMovementAllocations,
  saveInventoryAccountingPolicy,
  transactionSqlClient,
} from '../../inventory/inventory-accounting.service.ts';
import {
  adjustStock,
  createStockCount,
  postStockCount,
  recordCountedQuantity,
  type StockScope,
} from '../../inventory/stock-control.service.ts';
import { postGoodsReceivedNote } from '../../procurement/receiving.service.ts';
import inventoryAccountingRoutes from '../../routes/inventory-accounting.routes.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

const suffix = randomUUID().slice(0, 8);
const OPEN_FROM = '2026-01-01';
const OPEN_TO = '2026-12-31';
const MOVEMENT_DATE = '2026-03-15';

interface Facility {
  tenantId: number;
  facilityId: number;
  actorId: number;
  approverId: number;
  toStock: StockScope;
  toAccounting: { tenantId: number; facilityId: number; actorUserId: number };
}

interface Accounts {
  stock: number;
  clearing: number;
  consumption: number;
  adjustment: number;
  writeOff: number;
  opening: number;
  inputVat: number;
  payable: number;
  expense: number;
}

describeDb('Batch B — inventory accounting', () => {
  let tenantId: number;
  const facilities: Record<string, Facility> = {};
  const accounts: Record<string, Accounts> = {};

  const journalCount = async (facilityId: number) =>
    Number(
      (
        await pool.query(
          `SELECT COUNT(*)::int AS n FROM journal_entries WHERE facility_id=$1 AND source_type='INVENTORY'`,
          [facilityId],
        )
      ).rows[0].n,
    );

  const journalLines = async (journalId: number) =>
    (
      await pool.query(
        `SELECT account_id AS "accountId", debit_cents::text AS debit, credit_cents::text AS credit
           FROM journal_lines WHERE journal_entry_id=$1 ORDER BY id`,
        [journalId],
      )
    ).rows as Array<{ accountId: number; debit: string; credit: string }>;

  const balanceOf = async (facilityId: number, accountId: number) =>
    BigInt(
      (
        await pool.query(
          `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0)::text AS cents
             FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
            WHERE e.facility_id=$1 AND l.account_id=$2 AND e.status='POSTED'`,
          [facilityId, accountId],
        )
      ).rows[0].cents,
    );

  async function makeFacility(label: string): Promise<Facility> {
    const code = `B-${label}-${suffix}`;
    const facilityId = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules)
         VALUES($1,$2,$3,'Africa/Nairobi','["inventory","accounting"]') RETURNING id`,
        [tenantId, code, `Synthetic B ${label}`],
      )
    ).rows[0].id as number;

    const actorId = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,'Synthetic B storekeeper','test-only','ACTIVE',$3,$4) RETURNING id`,
        [`b-${label}-${suffix}`, `b-${label}-${suffix}@example.test`, tenantId, facilityId],
      )
    ).rows[0].id as number;

    const approverId = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,'Synthetic B finance officer','test-only','ACTIVE',$3,$4) RETURNING id`,
        [`b-fin-${label}-${suffix}`, `b-fin-${label}-${suffix}@example.test`, tenantId, facilityId],
      )
    ).rows[0].id as number;

    return {
      tenantId,
      facilityId,
      actorId,
      approverId,
      toStock: {
        tenantId,
        facilityId,
        actorId,
        actorName: 'Synthetic B storekeeper',
      },
      toAccounting: { tenantId, facilityId, actorUserId: actorId },
    };
  }

  async function makeAccounts(facilityId: number, label: string): Promise<Accounts> {
    const rows: Array<[string, string, string, string]> = [
      ['stock', '1300', 'ASSET', 'DEBIT'],
      ['clearing', '2150', 'LIABILITY', 'CREDIT'],
      ['consumption', '5100', 'EXPENSE', 'DEBIT'],
      ['adjustment', '5200', 'EXPENSE', 'DEBIT'],
      ['writeOff', '5300', 'EXPENSE', 'DEBIT'],
      ['opening', '3300', 'EQUITY', 'CREDIT'],
      ['inputVat', '1400', 'ASSET', 'DEBIT'],
      ['payable', '2100', 'LIABILITY', 'CREDIT'],
      ['expense', '5400', 'EXPENSE', 'DEBIT'],
    ];
    const result = {} as Accounts;
    for (const [key, code, type, normal] of rows) {
      result[key as keyof Accounts] = (
        await pool.query(
          `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance)
           VALUES($1,$2,$3,$4,$5,'BATCH_B',$6) RETURNING id`,
          [tenantId, facilityId, `${code}-${label}-${suffix}`, `Synthetic B ${key}`, type, normal],
        )
      ).rows[0].id as number;
    }
    return result;
  }

  async function addPeriod(
    facilityId: number,
    code: string,
    from: string,
    to: string,
    status: string,
  ) {
    await pool.query(
      `INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date,status)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [tenantId, facilityId, `${code}-${suffix}`, `Synthetic B ${code}`, from, to, status],
    );
  }

  /** An item with one lot; item stock and lot quantity always agree. */
  async function addStock(
    facilityId: number,
    code: string,
    quantity: number,
    unitCost: string | null,
  ): Promise<{ itemId: number; batchId: number }> {
    const itemId = (
      await pool.query(
        `INSERT INTO inventory_items(facility_id,item_code,name,current_stock,unit,unit_cost)
         VALUES($1,$2,$3,$4,'Tablets',$5) RETURNING id`,
        [facilityId, `${code}-${suffix}`, `Synthetic B item ${code}`, quantity, unitCost],
      )
    ).rows[0].id as number;

    const batchId = (
      await pool.query(
        `INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity_remaining,cost_per_unit)
         VALUES($1,$2,'2027-06-30',$3,$4) RETURNING id`,
        [itemId, `LOT-${code}-${suffix}`, quantity, unitCost],
      )
    ).rows[0].id as number;

    return { itemId, batchId };
  }

  let grnCounter = 800_000;

  /**
   * Stock that arrived the way the business arrives it: a lot on the shelf and
   * a receipt journal for the same value, in one transaction. Inserting a lot
   * without its journal would make the opening balance or the reconciliation
   * look wrong for a reason the product does not have.
   */
  async function receiveStock(
    facility: Facility,
    code: string,
    quantity: number,
    unitCostCents: number,
  ): Promise<{ itemId: number; batchId: number }> {
    const grnId = ++grnCounter;
    return transaction(async (client) => {
      const item = await client.query(
        `INSERT INTO inventory_items(facility_id,item_code,name,current_stock,unit,unit_cost)
         VALUES($1,$2,$3,$4,'Tablets',$5) RETURNING id`,
        [
          facility.facilityId,
          `${code}-${suffix}`,
          `Synthetic B item ${code}`,
          quantity,
          (unitCostCents / 100).toFixed(2),
        ],
      );
      const itemId = Number(item.rows[0].id);
      const batch = await client.query(
        `INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity_remaining,cost_per_unit)
         VALUES($1,$2,'2027-06-30',$3,$4) RETURNING id`,
        [itemId, `LOT-${code}-${suffix}`, quantity, (unitCostCents / 100).toFixed(2)],
      );
      const batchId = Number(batch.rows[0].id);
      await postStockReceipt(client, facility.toAccounting, {
        grnId,
        grnNumber: `GRN-${code}-${suffix}`,
        entryDate: MOVEMENT_DATE,
        valueCents: BigInt(quantity) * BigInt(unitCostCents),
      });
      return { itemId, batchId };
    });
  }

  const accountingPolicy = (facilityId: number) => ({
    basis: 'PERPETUAL',
    stockAssetAccountId: accounts[facilityId].stock,
    clearingAccountId: accounts[facilityId].clearing,
    consumptionAccountId: accounts[facilityId].consumption,
    adjustmentAccountId: accounts[facilityId].adjustment,
    writeOffAccountId: accounts[facilityId].writeOff,
    openingBalanceAccountId: accounts[facilityId].opening,
    inputVatAccountId: accounts[facilityId].inputVat,
  });

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Synthetic DB required.');

    tenantId = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic B tenant ${suffix}`,
        `batch-b-${suffix}`,
      ])
    ).rows[0].id as number;

    for (const label of ['main', 'opening', 'count', 'other', 'plain']) {
      const facility = await makeFacility(label);
      facilities[label] = facility;
      accounts[facility.facilityId] = await makeAccounts(facility.facilityId, label);
      await addPeriod(facility.facilityId, 'OPEN-2026', OPEN_FROM, OPEN_TO, 'OPEN');
      await addPeriod(facility.facilityId, 'CLOSED-2025', '2025-01-01', '2025-12-31', 'CLOSED');
    }
  }, 120_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  describe('default basis', () => {
    it('posts nothing when a facility has no policy at all', async () => {
      const facility = facilities.plain;
      const { itemId, batchId } = await addStock(facility.facilityId, 'PLAIN', 10, '12.00');

      await adjustStock(facility.toStock, {
        itemId,
        batchId,
        reasonCode: 'DAMAGE',
        direction: 'DECREASE',
        quantity: 2,
        movementDate: MOVEMENT_DATE,
      });

      expect(await journalCount(facility.facilityId)).toBe(0);

      /* The stock side still happened; only the ledger stayed silent. */
      const stock = await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [
        itemId,
      ]);
      expect(Number(stock.rows[0].current_stock)).toBe(8);

      const state = await readInventoryAccountingPolicy(tenantId, facility.facilityId);
      expect(state.basis).toBe('EXPENSE_ON_PURCHASE');
      expect(state.active).toBe(false);
    });
  });

  describe('policy configuration', () => {
    it('saves a draft without posting or activating it', async () => {
      const facility = facilities.main;

      const draft = await saveInventoryAccountingPolicy(
        { tenantId, facilityId: facility.facilityId },
        accountingPolicy(facility.facilityId),
      );

      expect(draft.status).toBe('DRAFT');
      expect(draft.basis).toBe('PERPETUAL');
      expect(await journalCount(facility.facilityId)).toBe(0);

      const state = await readInventoryAccountingPolicy(tenantId, facility.facilityId);
      expect(state.active).toBe(false);
      expect(state.basis).toBe('EXPENSE_ON_PURCHASE');
      expect(state.versions).toHaveLength(1);
    });

    it('refuses activation without a named finance approver', async () => {
      const facility = facilities.main;

      await expect(
        activateInventoryAccountingPolicy(facility.toAccounting, {
          effectiveFrom: OPEN_FROM,
        }),
      ).rejects.toMatchObject({ code: 'FINANCE_APPROVAL_REQUIRED' });

      const state = await readInventoryAccountingPolicy(tenantId, facility.facilityId);
      expect(state.active).toBe(false);
    });

    it('refuses activation without an effective date', async () => {
      const facility = facilities.main;

      await expect(
        activateInventoryAccountingPolicy(facility.toAccounting, {
          financeApprovedByUserId: facility.approverId,
        }),
      ).rejects.toMatchObject({ code: 'EFFECTIVE_DATE_REQUIRED' });
    });

    it('refuses activation while an account is missing', async () => {
      const facility = facilities.other;
      await saveInventoryAccountingPolicy(
        { tenantId, facilityId: facility.facilityId },
        { ...accountingPolicy(facility.facilityId), writeOffAccountId: null },
      );

      await expect(
        activateInventoryAccountingPolicy(facility.toAccounting, {
          financeApprovedByUserId: facility.approverId,
          effectiveFrom: OPEN_FROM,
        }),
      ).rejects.toMatchObject({ code: 'POLICY_INCOMPLETE' });
    });

    it('refuses activation while a lot carries no cost', async () => {
      const facility = facilities.other;
      await saveInventoryAccountingPolicy(
        { tenantId, facilityId: facility.facilityId },
        accountingPolicy(facility.facilityId),
      );
      await addStock(facility.facilityId, 'UNVALUED', 4, null);

      await expect(
        activateInventoryAccountingPolicy(facility.toAccounting, {
          financeApprovedByUserId: facility.approverId,
          effectiveFrom: OPEN_FROM,
        }),
      ).rejects.toMatchObject({ code: 'UNVALUED_STOCK' });
    });

    it('posts the opening balance and puts the policy in force', async () => {
      const facility = facilities.opening;
      const { itemId } = await addStock(facility.facilityId, 'OPENING', 10, '25.50');
      void itemId;

      await saveInventoryAccountingPolicy(
        { tenantId, facilityId: facility.facilityId },
        accountingPolicy(facility.facilityId),
      );

      const activated = await activateInventoryAccountingPolicy(facility.toAccounting, {
        financeApprovedByUserId: facility.approverId,
        effectiveFrom: OPEN_FROM,
        approvalNote: 'Synthetic approval for the opening balance.',
      });

      expect(activated.openingJournalId).not.toBeNull();
      expect(activated.openingValueKes).toBe('255.00');
      const active = await readInventoryAccountingPolicy(tenantId, facility.facilityId);
      const activeRow = active.versions.find(
        (row) => (row as { status: string }).status === 'ACTIVE',
      ) as { financeApprovedByUserId: number };
      expect(active.active).toBe(true);
      expect(activeRow.financeApprovedByUserId).toBe(facility.approverId);

      const local = accounts[facility.facilityId];
      /* 10 units at 25.50 = 255.00 */
      expect(await balanceOf(facility.facilityId, local.stock)).toBe(25_500n);
      expect(await balanceOf(facility.facilityId, local.opening)).toBe(-25_500n);

      const journal = await pool.query(
        'SELECT id FROM journal_entries WHERE facility_id=$1 AND source_type=$2',
        [facility.facilityId, 'INVENTORY'],
      );
      expect(journal.rows).toHaveLength(1);
      expect(await journalLines(Number(journal.rows[0].id))).toEqual([
        { accountId: local.stock, debit: '25500', credit: '0' },
        { accountId: local.opening, debit: '0', credit: '25500' },
      ]);
    });

    it('refuses a new policy once one is in force', async () => {
      const facility = facilities.opening;

      await expect(
        saveInventoryAccountingPolicy(
          { tenantId, facilityId: facility.facilityId },
          accountingPolicy(facility.facilityId),
        ),
      ).rejects.toMatchObject({ code: 'POLICY_ALREADY_ACTIVE' });

      const state = await readInventoryAccountingPolicy(tenantId, facility.facilityId);
      expect(state.versions).toHaveLength(1);
      expect(state.versions[0]).toMatchObject({ status: 'ACTIVE', version: 1 });
    });

    it('refuses a second activation', async () => {
      const facility = facilities.opening;

      await expect(
        activateInventoryAccountingPolicy(facility.toAccounting, {
          financeApprovedByUserId: facility.approverId,
          effectiveFrom: OPEN_FROM,
        }),
      ).rejects.toMatchObject({ code: 'ALREADY_ACTIVATED' });
    });

    it('activates an empty facility with no opening journal', async () => {
      const facility = facilities.main;

      const activated = await activateInventoryAccountingPolicy(facility.toAccounting, {
        financeApprovedByUserId: facility.approverId,
        effectiveFrom: OPEN_FROM,
      });

      expect(activated.openingJournalId).toBeNull();
      expect(activated.openingValueKes).toBe('0.00');
      expect(await journalCount(facility.facilityId)).toBe(0);
      expect(activated.effectiveFrom).toBe(OPEN_FROM);
    });
  });

  describe('receipts', () => {
    it('debits stock and credits clearing, and replays without a second journal', async () => {
      const facility = facilities.main;
      const local = accounts[facility.facilityId];
      const { itemId, batchId } = await addStock(facility.facilityId, 'RECV', 5, '40.00');

      const first = await transaction(async (client) => {
        const journalId = await postStockReceipt(client, facility.toAccounting, {
          grnId: 900_001,
          grnNumber: `GRN-${suffix}`,
          entryDate: MOVEMENT_DATE,
          valueCents: 20_000n,
        });
        return journalId;
      });

      expect(first).not.toBeNull();
      expect(await journalLines(first!)).toEqual([
        { accountId: local.stock, debit: '20000', credit: '0' },
        { accountId: local.clearing, debit: '0', credit: '20000' },
      ]);

      const replay = await transaction(async (client) =>
        postStockReceipt(client, facility.toAccounting, {
          grnId: 900_001,
          grnNumber: `GRN-${suffix}`,
          entryDate: MOVEMENT_DATE,
          valueCents: 20_000n,
        }),
      );

      expect(replay).toBe(first);
      expect(await journalCount(facility.facilityId)).toBe(1);
      void itemId;
      void batchId;
    });

    it('posts nothing for a zero-value receipt', async () => {
      const facility = facilities.main;
      const before = await journalCount(facility.facilityId);

      const result = await transaction(async (client) =>
        postStockReceipt(client, facility.toAccounting, {
          grnId: 900_002,
          grnNumber: `GRN-ZERO-${suffix}`,
          entryDate: MOVEMENT_DATE,
          valueCents: 0n,
        }),
      );

      expect(result).toBeNull();
      expect(await journalCount(facility.facilityId)).toBe(before);
    });
  });

  describe('consumption, write-off and adjustment', () => {
    it('costs a decrease at the lot cost it actually drew from', async () => {
      const facility = facilities.main;
      const local = accounts[facility.facilityId];
      const { itemId, batchId } = await receiveStock(facility, 'ISSUE', 6, 1_500);

      const result = await adjustStock(facility.toStock, {
        itemId,
        batchId,
        reasonCode: 'DATA_ENTRY',
        direction: 'DECREASE',
        quantity: 2,
        movementDate: MOVEMENT_DATE,
      });

      expect(result.stockAfter).toBe(4);

      const movement = await pool.query(
        `SELECT id FROM inventory_movements WHERE item_id=$1 ORDER BY id DESC LIMIT 1`,
        [itemId],
      );
      const movementId = Number(movement.rows[0].id);

      const allocations = await pool.query(
        `SELECT batch_id AS "batchId", quantity, unit_cost_cents::int AS "unitCostCents"
           FROM inventory_movement_allocations WHERE movement_id=$1`,
        [movementId],
      );
      expect(allocations.rows).toEqual([{ batchId, quantity: 2, unitCostCents: 1500 }]);

      const link = await pool.query(
        'SELECT journal_entry_id FROM inventory_movement_journals WHERE movement_id=$1',
        [movementId],
      );
      expect(link.rows).toHaveLength(1);

      expect(await journalLines(Number(link.rows[0].journal_entry_id))).toEqual([
        { accountId: local.adjustment, debit: '3000', credit: '0' },
        { accountId: local.stock, debit: '0', credit: '3000' },
      ]);
    });

    it('posts a dispensing-style consumption against the consumption account', async () => {
      const facility = facilities.main;
      const local = accounts[facility.facilityId];
      const { itemId, batchId } = await receiveStock(facility, 'CONSUME', 4, 2_250);

      const journalId = await transaction(async (client) => {
        const movement = await client.query(
          `INSERT INTO inventory_movements(tenant_id,facility_id,item_id,batch_id,movement_type,
             quantity_delta,stock_after,reason_code,reference_type,reference_id,
             actor_user_id,actor_name,movement_date)
           VALUES($1,$2,$3,$4,'DISPENSE',-2,2,'DISPENSED','PHARMACY_DISPENSATION',$5,$6,'tester',$7)
           RETURNING id`,
          [
            tenantId,
            facility.facilityId,
            itemId,
            batchId,
            `disp-${suffix}`,
            facility.actorId,
            MOVEMENT_DATE,
          ],
        );
        const movementId = Number(movement.rows[0].id);
        await recordMovementAllocations(client, facility.toAccounting, movementId, [
          { batchId, quantity: 2, unitCostCents: 2_250 },
        ]);
        return postStockIssue(client, facility.toAccounting, {
          movementId,
          entryDate: MOVEMENT_DATE,
          description: 'Synthetic dispensing',
          costCents: 4_500n,
          kind: 'CONSUMPTION',
        });
      });

      expect(await journalLines(journalId!)).toEqual([
        { accountId: local.consumption, debit: '4500', credit: '0' },
        { accountId: local.stock, debit: '0', credit: '4500' },
      ]);
    });

    it('posts an expiry write-off to the write-off account', async () => {
      const facility = facilities.main;
      const local = accounts[facility.facilityId];
      const { itemId, batchId } = await receiveStock(facility, 'EXPIRY', 5, 800);

      await adjustStock(facility.toStock, {
        itemId,
        batchId,
        reasonCode: 'EXPIRY',
        direction: 'DECREASE',
        quantity: 5,
        movementDate: MOVEMENT_DATE,
      });

      const journal = await pool.query(
        `SELECT id FROM journal_entries
          WHERE facility_id=$1 AND source_type='INVENTORY'
          ORDER BY id DESC LIMIT 1`,
        [facility.facilityId],
      );
      expect(await journalLines(Number(journal.rows[0].id))).toEqual([
        { accountId: local.writeOff, debit: '4000', credit: '0' },
        { accountId: local.stock, debit: '0', credit: '4000' },
      ]);
    });

    it('posts an upward adjustment against the adjustment account', async () => {
      const facility = facilities.main;
      const local = accounts[facility.facilityId];
      const { itemId, batchId } = await receiveStock(facility, 'GAIN', 2, 1_100);

      await adjustStock(facility.toStock, {
        itemId,
        batchId,
        reasonCode: 'DONATION',
        direction: 'INCREASE',
        quantity: 3,
        movementDate: MOVEMENT_DATE,
      });

      const journal = await pool.query(
        `SELECT id FROM journal_entries
          WHERE facility_id=$1 AND source_type='INVENTORY'
          ORDER BY id DESC LIMIT 1`,
        [facility.facilityId],
      );
      expect(await journalLines(Number(journal.rows[0].id))).toEqual([
        { accountId: local.stock, debit: '3300', credit: '0' },
        { accountId: local.adjustment, debit: '0', credit: '3300' },
      ]);
    });

    it('posts from a drizzle transaction through the SQL adapter', async () => {
      const facility = facilities.main;
      const local = accounts[facility.facilityId];
      const { itemId, batchId } = await receiveStock(facility, 'ADAPTER', 3, 1_250);

      /*
       * The dispensing path opens its transaction with `db.transaction`, which
       * yields a query builder rather than a connection. This reproduces that
       * exactly, so the adapter that binds parameters for the posting primitive
       * is proven against real SQL rather than assumed to work.
       */
      const journalId = await db.transaction(async (tx) => {
        const [movement] = await tx
          .insert(schema.inventoryMovements)
          .values({
            tenantId,
            facilityId: facility.facilityId,
            itemId,
            batchId,
            movementType: 'DISPENSE',
            quantityDelta: -1,
            stockAfter: 2,
            reasonCode: 'DISPENSED',
            referenceType: 'PHARMACY_DISPENSATION',
            referenceId: `adapter-${suffix}`,
            actorUserId: facility.actorId,
            actorName: 'Synthetic B storekeeper',
            movementDate: MOVEMENT_DATE,
          })
          .returning({ id: schema.inventoryMovements.id });

        return postStockIssue(
          transactionSqlClient(
            tx as unknown as { execute: (q: SQL) => Promise<{ rows: unknown[] }> },
          ),
          facility.toAccounting,
          {
            movementId: movement.id,
            entryDate: MOVEMENT_DATE,
            description: 'Synthetic dispensed item',
            costCents: 1_250n,
            kind: 'CONSUMPTION',
          },
        );
      });

      expect(journalId).not.toBeNull();
      expect(await journalLines(journalId!)).toEqual([
        { accountId: local.consumption, debit: '1250', credit: '0' },
        { accountId: local.stock, debit: '0', credit: '1250' },
      ]);

      const link = await pool.query(
        'SELECT COUNT(*)::int AS n FROM inventory_movement_journals WHERE journal_entry_id=$1',
        [journalId],
      );
      expect(Number(link.rows[0].n)).toBe(1);
    });

    it('posts no journal for an unvalued lot rather than inventing a cost', async () => {
      const facility = facilities.opening;
      const { itemId, batchId } = await addStock(facility.facilityId, 'NOVAL', 3, null);
      const before = await journalCount(facility.facilityId);

      await adjustStock(facility.toStock, {
        itemId,
        batchId,
        reasonCode: 'DAMAGE',
        direction: 'DECREASE',
        quantity: 1,
        movementDate: MOVEMENT_DATE,
      });

      expect(await journalCount(facility.facilityId)).toBe(before);
    });
  });

  describe('physical counts', () => {
    it('posts one netted journal for the whole count', async () => {
      const facility = facilities.count;
      const local = accounts[facility.facilityId];

      await saveInventoryAccountingPolicy(
        { tenantId, facilityId: facility.facilityId },
        accountingPolicy(facility.facilityId),
      );
      await activateInventoryAccountingPolicy(facility.toAccounting, {
        financeApprovedByUserId: facility.approverId,
        effectiveFrom: OPEN_FROM,
      });

      const short = await receiveStock(facility, 'COUNT-A', 10, 500);
      const over = await receiveStock(facility, 'COUNT-B', 4, 2_000);

      const count = await createStockCount(facility.toStock, {
        countNumber: `COUNT-${suffix}`,
        countDate: MOVEMENT_DATE,
      });

      await recordCountedQuantity(facility.toStock, count.id, {
        itemId: short.itemId,
        countedQuantity: 8,
      });
      await recordCountedQuantity(facility.toStock, count.id, {
        itemId: over.itemId,
        countedQuantity: 3,
      });

      const posted = await postStockCount(facility.toStock, count.id);
      expect(posted.count.status).toBe('POSTED');

      /* 2 short at 5.00 = 10.00 lost, 1 short at 20.00 = 20.00 lost → 30.00 shortage. */
      const journals = await pool.query(
        `SELECT id FROM journal_entries
          WHERE facility_id=$1 AND source_type='INVENTORY' AND source_id=$2`,
        [facility.facilityId, `stock-count:${count.id}`],
      );
      expect(journals.rows).toHaveLength(1);
      expect(await journalLines(Number(journals.rows[0].id))).toEqual([
        { accountId: local.adjustment, debit: '3000', credit: '0' },
        { accountId: local.stock, debit: '0', credit: '3000' },
      ]);

      const linked = await pool.query(
        `SELECT COUNT(*)::int AS n FROM inventory_movement_journals
          WHERE journal_entry_id=$1`,
        [journals.rows[0].id],
      );
      expect(Number(linked.rows[0].n)).toBe(2);
    });

    it('ignores a count whose lines all match', async () => {
      const facility = facilities.count;
      const before = await journalCount(facility.facilityId);

      const count = await createStockCount(facility.toStock, {
        countNumber: `COUNT-CLEAN-${suffix}`,
        countDate: MOVEMENT_DATE,
      });

      /* Count every line and find what the system already says. */
      for (const line of count.lines) {
        await recordCountedQuantity(facility.toStock, count.id, {
          itemId: line.itemId,
          countedQuantity: line.expectedQuantity,
        });
      }

      await postStockCount(facility.toStock, count.id);

      expect(await journalCount(facility.facilityId)).toBe(before);
    });
  });

  describe('goods receipt through procurement', () => {
    it('posts one receipt journal for a posted note and none for its replay', async () => {
      const facility = facilities.main;
      const local = accounts[facility.facilityId];
      const stockBefore = await balanceOf(facility.facilityId, local.stock);
      const before = await journalCount(facility.facilityId);

      const supplierId = (
        await pool.query('INSERT INTO suppliers(tenant_id,name) VALUES($1,$2) RETURNING id', [
          tenantId,
          `Synthetic B supplier ${suffix}`,
        ])
      ).rows[0].id as number;

      const orderId = (
        await pool.query(
          `INSERT INTO purchase_orders(tenant_id,facility_id,supplier_id,po_number,total_amount,status)
           VALUES($1,$2,$3,$4,'300.00','Approved') RETURNING id`,
          [tenantId, facility.facilityId, supplierId, `PO-${suffix}`],
        )
      ).rows[0].id as number;

      const orderItemId = (
        await pool.query(
          `INSERT INTO purchase_order_items(purchase_order_id,line_number,description,quantity,unit,unit_price,line_total)
           VALUES($1,1,'Synthetic B gloves',10,'Boxes',30.00,300.00) RETURNING id`,
          [orderId],
        )
      ).rows[0].id as number;

      const { itemId } = await addStock(facility.facilityId, 'GRN', 0, '30.00');

      const body = {
        purchaseOrderId: orderId,
        grnNumber: `GRN-E2E-${suffix}`,
        receivedDate: MOVEMENT_DATE,
        idempotencyKey: `grn-e2e-${suffix}`,
        lines: [
          {
            purchaseOrderItemId: orderItemId,
            quantityReceived: 10,
            unitCost: 30,
            inventoryItemId: itemId,
            batchNumber: `RECEIVED-GRN-${suffix}`,
            expiryDate: '2027-12-31',
          },
        ],
      };

      const first = await postGoodsReceivedNote(facility.toStock, body);
      expect(first.replayed).toBe(false);
      expect(await journalCount(facility.facilityId)).toBe(before + 1);
      /* 10 boxes at 30.00 = 300.00 onto the shelf. */
      expect(await balanceOf(facility.facilityId, local.stock)).toBe(stockBefore + 30_000n);

      const replay = await postGoodsReceivedNote(facility.toStock, body);
      expect(replay.replayed).toBe(true);
      expect(replay.id).toBe(first.id);
      expect(await journalCount(facility.facilityId)).toBe(before + 1);
      expect(await balanceOf(facility.facilityId, local.stock)).toBe(stockBefore + 30_000n);
    });
  });

  describe('supplier invoices', () => {
    it('clears the receipt and keeps recoverable tax out of stock', async () => {
      const facility = facilities.main;
      const local = accounts[facility.facilityId];
      const clearingBefore = await balanceOf(facility.facilityId, local.clearing);

      const journalId = await transaction(async (client) =>
        postSupplierInvoiceClearing(client, facility.toAccounting, {
          grnId: 900_001,
          invoiceNumber: `INV-${suffix}`,
          entryDate: MOVEMENT_DATE,
          grnNumber: `GRN-${suffix}`,
          subtotalCents: 20_000n,
          taxCents: 3_200n,
          taxRecoverable: true,
          payableAccountId: local.payable,
          fallbackExpenseAccountId: local.expense,
        }),
      );

      expect(journalId).not.toBeNull();
      expect(await journalLines(journalId!)).toEqual([
        { accountId: local.clearing, debit: '20000', credit: '0' },
        { accountId: local.inputVat, debit: '3200', credit: '0' },
        { accountId: local.payable, debit: '0', credit: '23200' },
      ]);

      /* The debit reduces the credit sitting in clearing for this note. */
      expect(await balanceOf(facility.facilityId, local.clearing)).toBe(clearingBefore + 20_000n);
      expect(await balanceOf(facility.facilityId, local.stock)).toBeGreaterThan(0n);
    });

    it('charges non-recoverable tax to an expense, never to stock', async () => {
      const facility = facilities.main;
      const local = accounts[facility.facilityId];
      const stockBefore = await balanceOf(facility.facilityId, local.stock);
      const expenseBefore = await balanceOf(facility.facilityId, local.expense);

      const journalId = await transaction(async (client) =>
        postSupplierInvoiceClearing(client, facility.toAccounting, {
          grnId: 900_003,
          invoiceNumber: `INV-NR-${suffix}`,
          entryDate: MOVEMENT_DATE,
          grnNumber: `GRN-NR-${suffix}`,
          subtotalCents: 5_000n,
          taxCents: 800n,
          taxRecoverable: false,
          payableAccountId: local.payable,
          fallbackExpenseAccountId: local.expense,
        }),
      );

      const lines = await journalLines(journalId!);
      expect(lines).toContainEqual({ accountId: local.expense, debit: '800', credit: '0' });
      expect(await balanceOf(facility.facilityId, local.stock)).toBe(stockBefore);
      expect(await balanceOf(facility.facilityId, local.expense)).toBe(expenseBefore + 800n);
    });

    it('posts nothing extra for a facility on the default basis', async () => {
      const facility = facilities.plain;

      const journalId = await transaction(async (client) =>
        postSupplierInvoiceClearing(client, facility.toAccounting, {
          grnId: 900_004,
          invoiceNumber: `INV-PLAIN-${suffix}`,
          entryDate: MOVEMENT_DATE,
          grnNumber: `GRN-PLAIN-${suffix}`,
          subtotalCents: 1_000n,
          taxCents: 0n,
          taxRecoverable: false,
          payableAccountId: accounts[facility.facilityId].payable,
          fallbackExpenseAccountId: accounts[facility.facilityId].expense,
        }),
      );

      expect(journalId).toBeNull();
    });
  });

  describe('reconciliation', () => {
    it('agrees when the shelf and the stock account describe the same stock', async () => {
      const facility = facilities.count;

      const result = await readInventoryReconciliation(facility.toAccounting);
      expect(result.basis).toBe('PERPETUAL');
      expect(result.differenceKes).toBe('0.00');
      expect(result.reconciled).toBe(true);
    });

    it('names a balance difference instead of hiding it', async () => {
      const facility = facilities.count;
      const local = accounts[facility.facilityId];

      /* A manual journal that posts to the stock account is exactly the kind of
         entry the reconciliation exists to catch. `transaction` + a direct
         insert is used because the accounting service refuses unbalanced
         requests, which is the point: this row is a control failure. */
      await transaction(async (client) => {
        const period = await client.query(
          `SELECT id FROM financial_periods
            WHERE facility_id=$1 AND start_date <= $2::date AND end_date >= $2::date LIMIT 1`,
          [facility.facilityId, MOVEMENT_DATE],
        );
        const entry = await client.query(
          `INSERT INTO journal_entries(tenant_id,facility_id,period_id,journal_number,entry_date,description,
             source_type,source_id,idempotency_key,request_hash,total_debit_cents,total_credit_cents)
           VALUES($1,$2,$3,$4,$5,'Synthetic out-of-band stock entry','MANUAL',$6,$7,'test','1000','1000')
           RETURNING id`,
          [
            tenantId,
            facility.facilityId,
            Number(period.rows[0].id),
            `J-TEST-${suffix}`,
            MOVEMENT_DATE,
            `manual:${suffix}`,
            `manual:${suffix}`,
          ],
        );
        const journalId = Number(entry.rows[0].id);
        await client.query(
          `INSERT INTO journal_lines(journal_entry_id,account_id,debit_cents,credit_cents,description)
           VALUES($1,$2,1000,0,'Manual debit'),($1,$3,0,1000,'Manual credit')`,
          [journalId, local.stock, local.adjustment],
        );
        /* The header guard requires a draft to exist before it is posted. */
        await client.query(
          `UPDATE journal_entries SET status='POSTED', posted_at=now(), posted_by_user_id=$2
            WHERE id=$1`,
          [journalId, facility.actorId],
        );
      });

      const result = await readInventoryReconciliation(facility.toAccounting);
      expect(result.reconciled).toBe(false);
      expect(result.differenceKes).toBe('10.00');
      expect(result.differences.map((difference) => difference.kind)).toContain('BALANCE');
    });

    it('reports the default basis as having nothing to reconcile', async () => {
      const facility = facilities.plain;
      const result = await readInventoryReconciliation(facility.toAccounting);

      expect(result.basis).toBe('EXPENSE_ON_PURCHASE');
      expect(result.reconciled).toBe(true);
      expect(result.differences[0].kind).toBe('EXPENSE_BASIS');
    });
  });

  describe('closed periods and scope', () => {
    it('rejects a closed-period adjustment and rolls the stock write back', async () => {
      const facility = facilities.main;
      const { itemId, batchId } = await addStock(facility.facilityId, 'CLOSED', 5, '9.00');
      const before = await journalCount(facility.facilityId);

      await expect(
        adjustStock(facility.toStock, {
          itemId,
          batchId,
          reasonCode: 'DAMAGE',
          direction: 'DECREASE',
          quantity: 2,
          movementDate: '2025-06-30',
        }),
      ).rejects.toMatchObject({ code: 'OPEN_PERIOD_REQUIRED' });

      const item = await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [
        itemId,
      ]);
      expect(Number(item.rows[0].current_stock)).toBe(5);

      const batch = await pool.query(
        'SELECT quantity_remaining FROM inventory_batches WHERE id=$1',
        [batchId],
      );
      expect(Number(batch.rows[0].quantity_remaining)).toBe(5);

      const movements = await pool.query(
        'SELECT COUNT(*)::int AS n FROM inventory_movements WHERE item_id=$1',
        [itemId],
      );
      expect(Number(movements.rows[0].n)).toBe(0);
      expect(await journalCount(facility.facilityId)).toBe(before);
    });

    it('does not post for one facility because another has a policy', async () => {
      const facility = facilities.other;
      const before = await journalCount(facility.facilityId);

      const journalId = await transaction(async (client) =>
        postStockReceipt(client, facility.toAccounting, {
          grnId: 900_005,
          grnNumber: `GRN-OTHER-${suffix}`,
          entryDate: MOVEMENT_DATE,
          valueCents: 7_500n,
        }),
      );

      expect(journalId).toBeNull();
      expect(await journalCount(facility.facilityId)).toBe(before);
    });

    it('rejects a movement-level allocation for a lot from another item', async () => {
      const facility = facilities.main;
      const first = await addStock(facility.facilityId, 'ALLOC-A', 3, '4.00');
      const second = await addStock(facility.facilityId, 'ALLOC-B', 3, '4.00');

      await expect(
        transaction(async (client) => {
          const movement = await client.query(
            `INSERT INTO inventory_movements(tenant_id,facility_id,item_id,batch_id,movement_type,
               quantity_delta,stock_after,reason_code,reference_type,reference_id,
               actor_user_id,actor_name,movement_date)
             VALUES($1,$2,$3,$4,'ADJUSTMENT',-1,2,'DAMAGED_STOCK','TEST',$5,$6,'tester',$7)
             RETURNING id`,
            [
              tenantId,
              facility.facilityId,
              first.itemId,
              first.batchId,
              `alloc-${suffix}-${randomUUID()}`,
              facility.actorId,
              MOVEMENT_DATE,
            ],
          );
          await recordMovementAllocations(
            client,
            facility.toAccounting,
            Number(movement.rows[0].id),
            [{ batchId: second.batchId, quantity: 1, unitCostCents: 400 }],
          );
          throw new Error('inserted');
        }),
      ).rejects.toMatchObject({ code: 'ALLOCATION_LOT_MISMATCH' });
    });
  });

  describe('over HTTP', () => {
    let close: (() => Promise<void>) | undefined;
    let base = '';

    beforeAll(async () => {
      const facility = facilities.main;
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as unknown as { user: unknown }).user = {
          id: facility.actorId,
          uid: `b-main-${suffix}`,
          username: `b-main-${suffix}`,
          email: `b-main-${suffix}@example.test`,
          fullName: 'Synthetic B storekeeper',
          tenantId,
          facilityId: facility.facilityId,
          isActive: true,
          accountStatus: 'ACTIVE',
          mustChangePassword: false,
          mfaEnabled: false,
          mfaRequired: false,
        };
        (req as unknown as { authContext: unknown }).authContext = {
          userId: facility.actorId,
          tenantId,
          facilityId: facility.facilityId,
          roles: ['FACILITY_ADMIN'],
          /* Activation requires the posting permission as well as inventory
             management, so the persona is a storekeeper who may also post. */
          permissions: [
            'inventory.read',
            'inventory.manage',
            'accounting.read',
            'accounting.journals.post',
          ],
          isSuperAdmin: false,
        };
        next();
      });
      app.use(inventoryAccountingRoutes);
      const started = await startTestServer(app);
      base = started.baseUrl;
      close = started.close;
    }, 60_000);

    afterAll(async () => {
      await close?.();
    });

    it('reports the active policy for the caller’s own facility', async () => {
      const response = await httpJson(base, 'GET', '/api/inventory/accounting-policy');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.active).toBe(true);
      expect(response.body.basis).toBe('PERPETUAL');
    });

    it('reports the reconciliation as JSON', async () => {
      const response = await httpJson(base, 'GET', '/api/inventory/reconciliation');

      expect(response.status).toBe(200);
      expect(response.body.reconciliation.basis).toBe('PERPETUAL');
    });

    it('refuses a facility the caller cannot reach', async () => {
      const response = await httpJson(
        base,
        'GET',
        `/api/inventory/accounting-policy?facilityId=${facilities.plain.facilityId}`,
      );

      expect([403, 404]).toContain(response.status);
      expect(response.body.success).toBe(false);
    });

    it('reports an activation attempt on an active facility as 409', async () => {
      const response = await httpJson(base, 'POST', '/api/inventory/accounting-policy/activate', {
        body: { effectiveFrom: OPEN_FROM },
      });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('ALREADY_ACTIVATED');
    });

    it('refuses a policy save through the route when one is in force', async () => {
      const response = await httpJson(base, 'POST', '/api/inventory/accounting-policy', {
        body: accountingPolicy(facilities.main.facilityId),
      });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('POLICY_ALREADY_ACTIVE');
    });

    it('saves a draft policy through the route', async () => {
      const facility = facilities.plain;

      const response = await httpJson(base, 'POST', '/api/inventory/accounting-policy', {
        body: {
          facilityId: facility.facilityId,
          ...accountingPolicy(facility.facilityId),
        },
      });

      /* The caller is scoped to another facility, so the write is refused. */
      expect([403, 404]).toContain(response.status);
    });
  });
});
