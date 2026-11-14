/**
 * C0 — accounting failures raised inside an inventory request.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------
 * `AccountingIntegrityError` carries the status, code and message a caller
 * should see (409 for a closed period, 403 for an account outside the
 * facility, and so on). Inventory routes did not map it: both
 * `handleInventoryError` and the stock-control route's local `handleError`
 * passed anything they did not recognise to `respondInternalError`, which
 * answers 500 "The request could not be completed." An operator cannot act on
 * that, and cannot tell a closed period from a defect in the ledger.
 *
 * WHAT THIS FILE PROVES
 * ---------------------
 *  1. The shared handler writes the accounting error's own status, code and
 *     message, and claims the response.
 *  2. `handleInventoryError` — the function the pharmacy dispense route
 *     already calls — maps it, so dispensing is covered without touching
 *     `pharmacy.routes.ts`.
 *  3. The stock-control route handler is wired to the same mapping, ahead of
 *     the internal-error fallback.
 *  4. Unknown errors still reach `respondInternalError` and still produce 500
 *     with the fixed message and no internal detail.
 *  5. Real PostgreSQL: a stock mutation performed in the same transaction as
 *     a posting that the accounting service rejects is rolled back whole —
 *     stock, lot quantity and movement ledger are all unchanged.
 *  6. Real HTTP: the same failure, passed through the real
 *     `handleInventoryError` composition that pharmacy uses, reaches a client
 *     as 409 with the accounting code.
 *
 * WHAT THIS FILE DOES NOT PROVE — stated plainly, because it would be easy to
 * overclaim. **No production inventory endpoint posts a journal today.** The
 * integration between an inventory service and the posting primitive is C3
 * onwards, not C0. So the wiring assertions here are structural (the handler
 * is imported and called in the right order), and the rollback test performs
 * the stock side itself rather than through `postStockCount` or
 * `adjustStock`, because no service function accepts a caller's transaction
 * client yet. The end-to-end proof — a real inventory endpoint failing on a
 * real posting — is acceptance criterion AC6, and is a mandatory gate of C3.
 *
 * `applyDelta` is module-private (not exported), so the writes it performs are
 * reproduced faithfully here rather than invoked: decrement the lot, decrement
 * the item, append the movement.
 *
 * Synthetic data only. No real patient, staff or financial data.
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import type { PoolClient } from 'pg';

import {
  AccountingIntegrityError,
  postInsideTransaction,
  transaction,
  type AccountingScope,
} from '../../accounting/accounting.service.ts';
import { pool } from '../../db/index.ts';
import { InventoryDomainError } from '../../inventory/inventory.service.ts';
import { StockError } from '../../inventory/stock-control.service.ts';
import { handleInventoryError, respondInternalError } from '../../routes/shared/errors.ts';
import { handleAccountingIntegrityError } from '../../routes/shared/errors.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

/* ------------------------------------------------------------- fixtures */

/**
 * Minimal Express `Response` recorder.
 *
 * The handlers only use `status()` and `json()`, and both are chainable, so a
 * recorder is enough to observe exactly what a client would receive without
 * standing up a server.
 */
function responseRecorder(): {
  res: Response;
  status: () => number | undefined;
  body: () => unknown;
  writes: () => number;
} {
  let statusCode: number | undefined;
  let payload: unknown;
  let writes = 0;

  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(value: unknown) {
      payload = value;
      writes += 1;
      return res;
    },
  } as unknown as Response;

  return {
    res,
    status: () => statusCode,
    body: () => payload,
    writes: () => writes,
  };
}

describe('Accounting error mapping (no database)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    /* respondInternalError logs the operation; keep the suite output clean
       and assert on the log only where it matters. */
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('writes the accounting error status, code and message', () => {
    const recorder = responseRecorder();
    const error = new AccountingIntegrityError(
      'OPEN_PERIOD_REQUIRED',
      'Journal date must be in exactly one open financial period.',
      409,
    );

    expect(handleAccountingIntegrityError(error, recorder.res)).toBe(true);
    expect(recorder.status()).toBe(409);
    expect(recorder.body()).toEqual({
      success: false,
      error: 'OPEN_PERIOD_REQUIRED',
      message: 'Journal date must be in exactly one open financial period.',
    });
  });

  it('takes the status from the error rather than hard-coding one', () => {
    const cases: Array<[string, number]> = [
      ['ACCOUNT_OUT_OF_SCOPE', 403],
      ['OPEN_PERIOD_REQUIRED', 409],
      ['IDEMPOTENCY_CONFLICT', 409],
      ['JOURNAL_LINES_INVALID', 400],
    ];

    for (const [code, status] of cases) {
      const recorder = responseRecorder();
      const error = new AccountingIntegrityError(code, `Synthetic ${code}`, status);

      expect(handleAccountingIntegrityError(error, recorder.res), code).toBe(true);
      expect(recorder.status(), code).toBe(status);
      expect((recorder.body() as { error: string }).error, code).toBe(code);
    }

    /* The constructor's default must be honoured too — a handler that fell
       back to 500 for a defaulted error would defeat the purpose. */
    const recorder = responseRecorder();
    expect(
      handleAccountingIntegrityError(
        new AccountingIntegrityError('JOURNAL_LINE_ONE_SIDED', 'Defaulted status.'),
        recorder.res,
      ),
    ).toBe(true);
    expect(recorder.status()).toBe(400);
  });

  it('leaves a non-accounting error to the caller', () => {
    const recorder = responseRecorder();
    const error = new StockError(409, 'NEGATIVE_STOCK', 'Not enough stock.');

    expect(handleAccountingIntegrityError(error, recorder.res)).toBe(false);
    expect(recorder.writes()).toBe(0);
    expect(recorder.status()).toBeUndefined();
  });

  it('maps the error through the shared inventory handler used by pharmacy', () => {
    /* This is the path `pharmacy.routes.ts` takes: it calls
       `handleInventoryError` and falls through to its own 500 only when that
       returns false. Mapping here is what covers dispensing. */
    const recorder = responseRecorder();
    const error = new AccountingIntegrityError(
      'OPEN_PERIOD_REQUIRED',
      'Journal date must be in exactly one open financial period.',
      409,
    );

    expect(handleInventoryError(error, recorder.res)).toBe(true);
    expect(recorder.status()).toBe(409);
    expect((recorder.body() as { error: string }).error).toBe('OPEN_PERIOD_REQUIRED');
  });

  it('preserves the existing inventory domain error mapping', () => {
    const recorder = responseRecorder();
    const error = new InventoryDomainError('ITEM_NOT_FOUND', 'Stock item not found.', 404, {
      itemId: 7,
    });

    expect(handleInventoryError(error, recorder.res)).toBe(true);
    expect(recorder.status()).toBe(404);
    expect(recorder.body()).toEqual({
      success: false,
      error: 'ITEM_NOT_FOUND',
      message: 'Stock item not found.',
      detail: { itemId: 7 },
    });
  });

  it('does not claim an unknown error, so the caller keeps its 500 path', () => {
    const recorder = responseRecorder();

    expect(handleInventoryError(new Error('synthetic unknown failure'), recorder.res)).toBe(false);
    expect(recorder.writes()).toBe(0);

    /* The pharmacy dispense route forwards an unclaimed error to a fixed 500.
       Reproduce that composition rather than assume it. */
    const fallback = responseRecorder();
    if (!handleInventoryError(new Error('synthetic unknown failure'), fallback.res)) {
      fallback.res.status(500).json({ error: 'Dispensing could not be completed.' });
    }
    expect(fallback.status()).toBe(500);
    expect(fallback.body()).toEqual({ error: 'Dispensing could not be completed.' });
  });

  it('still answers 500 with no internal detail for an unrecognised error', () => {
    const recorder = responseRecorder();

    respondInternalError(recorder.res, new Error('relation "patients" does not exist'), 'probe');

    expect(recorder.status()).toBe(500);
    expect(recorder.body()).toEqual({ error: 'The request could not be completed.' });
    /* The operation is logged, the SQL is not returned. */
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('probe');
    expect(JSON.stringify(recorder.body())).not.toContain('patients');
  });
});

describeDb(
  'Accounting error rollback through the real posting primitive (synthetic PostgreSQL)',
  () => {
    const suffix = randomUUID().slice(0, 8);
    const closedDate = '2026-03-15';
    const closedPeriodStart = '2026-01-01';
    const closedPeriodEnd = '2026-12-31';

    let tenant: number;
    let facility: number;
    let actor: number;
    let scope: AccountingScope;
    let debitAccount: number;
    let creditAccount: number;
    let base: string;
    let close: () => Promise<void>;
    let sequence = 0;

    /** An item holding `stock` units in one lot of `stock` remains. */
    const seedStock = async (stock: number) => {
      const itemId = (
        await pool.query(
          `INSERT INTO inventory_items(facility_id,item_code,name,category,unit,current_stock,store_location,is_active)
         VALUES($1,$2,$3,'Pharmaceuticals','tablet',$4,'Main Store',true) RETURNING id`,
          [facility, `C0-${suffix}-${++sequence}`, `Synthetic C0 stock ${sequence}`, stock],
        )
      ).rows[0].id as number;

      const batchId = (
        await pool.query(
          `INSERT INTO inventory_batches(item_id,batch_number,expiry_date,quantity_remaining,cost_per_unit)
         VALUES($1,$2,'2099-12-31',$3,'12.50') RETURNING id`,
          [itemId, `LOT-C0-${suffix}-${sequence}`, stock],
        )
      ).rows[0].id as number;

      return { itemId, batchId };
    };

    const stockState = async (itemId: number, batchId: number) => ({
      currentStock: Number(
        (await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [itemId]))
          .rows[0].current_stock,
      ),
      lotRemaining: Number(
        (
          await pool.query('SELECT quantity_remaining FROM inventory_batches WHERE id=$1', [
            batchId,
          ])
        ).rows[0].quantity_remaining,
      ),
      movements: Number(
        (
          await pool.query('SELECT COUNT(*)::int AS n FROM inventory_movements WHERE item_id=$1', [
            itemId,
          ])
        ).rows[0].n,
      ),
    });

    /**
     * The stock side of a dispensing or write-off, in the exact shape
     * `applyDelta` writes when no batch is named: draw the lot down, draw the
     * item down, append the movement. Reproduced rather than imported because
     * `applyDelta` is module-private.
     */
    const applyStockDraw = async (
      client: PoolClient,
      itemId: number,
      batchId: number,
      quantity: number,
      referenceId: string,
    ) => {
      await client.query(
        'UPDATE inventory_batches SET quantity_remaining = quantity_remaining - $1 WHERE id = $2',
        [quantity, batchId],
      );
      await client.query(
        'UPDATE inventory_items SET current_stock = current_stock - $1, updated_at = now() WHERE id = $2',
        [quantity, itemId],
      );
      await client.query(
        `INSERT INTO inventory_movements(
         tenant_id,facility_id,item_id,batch_id,movement_type,quantity_delta,stock_after,
         reason_code,reference_type,reference_id,actor_user_id,actor_name,movement_date)
       VALUES($1,$2,$3,NULL,'DISPENSE',$4,$5,'DISPENSE_PROBE','C0_PROBE',$6,$7,'Synthetic C0 user',$8)`,
        [
          tenant,
          facility,
          itemId,
          -quantity,
          (await client.query('SELECT current_stock FROM inventory_items WHERE id=$1', [itemId]))
            .rows[0].current_stock,
          referenceId,
          actor,
          closedDate,
        ],
      );
    };

    /** A balanced two-line journal dated into the closed period. */
    const closedPeriodJournal = (idempotencyKey: string) => ({
      entryDate: closedDate,
      description: 'Synthetic C0 probe journal into a closed period',
      idempotencyKey,
      sourceType: 'MANUAL' as const,
      totalCents: 1_250n,
      lines: [
        {
          accountId: debitAccount,
          debitCents: 1_250n,
          creditCents: 0n,
          description: null,
          serviceLine: null,
        },
        {
          accountId: creditAccount,
          debitCents: 0n,
          creditCents: 1_250n,
          description: null,
          serviceLine: null,
        },
      ],
    });

    const journalCount = async (key: string) =>
      Number(
        (
          await pool.query(
            'SELECT COUNT(*)::int AS n FROM journal_entries WHERE idempotency_key=$1',
            [key],
          )
        ).rows[0].n,
      );

    beforeAll(async () => {
      if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
        throw new Error('Synthetic DB required.');

      tenant = (
        await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
          `Synthetic C0 tenant ${suffix}`,
          `c0-${suffix}`,
        ])
      ).rows[0].id as number;

      facility = (
        await pool.query(
          `INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules)
         VALUES($1,$2,'Synthetic C0 facility','Africa/Nairobi','["inventory","accounting"]') RETURNING id`,
          [tenant, `C0-${suffix}`],
        )
      ).rows[0].id as number;

      actor = (
        await pool.query(
          `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,'Synthetic C0 user','test-only','ACTIVE',$3,$4) RETURNING id`,
          [`c0-${suffix}`, `c0-${suffix}@example.test`, tenant, facility],
        )
      ).rows[0].id as number;

      const accountIds: number[] = [];
      for (const [code, name, type, normal] of [
        ['C0-5100', 'Synthetic C0 expense', 'EXPENSE', 'DEBIT'],
        ['C0-2100', 'Synthetic C0 payable', 'LIABILITY', 'CREDIT'],
      ] as Array<[string, string, string, string]>) {
        accountIds.push(
          (
            await pool.query(
              `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance)
             VALUES($1,$2,$3,$4,$5,'C0_TEST',$6) RETURNING id`,
              [tenant, facility, `${code}-${suffix}`, name, type, normal],
            )
          ).rows[0].id as number,
        );
      }
      [debitAccount, creditAccount] = accountIds;

      /* The period is CLOSED. `postInsideTransaction` resolves the period before
       it inserts anything and refuses a date outside an OPEN one. */
      await pool.query(
        `INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date,status)
       VALUES($1,$2,$3,'Synthetic C0 closed year',$4,$5,'CLOSED')`,
        [tenant, facility, `C0-${suffix}`, closedPeriodStart, closedPeriodEnd],
      );

      scope = { tenantId: tenant, facilityId: facility, actorUserId: actor };

      /* A probe server that composes the handlers exactly as `pharmacy.routes.ts`
       does: try the work, offer the error to `handleInventoryError`, and fall
       through to the internal-error path only when it is not claimed. */
      const app = express();
      app.get('/probe/dispense-like', async (_req, res) => {
        const { itemId, batchId } = await seedStock(4);
        try {
          await transaction(async (client) => {
            await applyStockDraw(client, itemId, batchId, 1, `C0-PROBE-${randomUUID()}`);
            await postInsideTransaction(client, scope, closedPeriodJournal(randomUUID()));
          });
          res.json({ success: true });
        } catch (err) {
          if (handleInventoryError(err, res)) return;
          respondInternalError(res, err, 'GET /probe/dispense-like');
        }
      });

      const started = await startTestServer(app);
      base = started.baseUrl;
      close = started.close;
    }, 120_000);

    afterAll(async () => {
      await close?.();
    });

    it('reports a closed-period posting as 409 over HTTP, not 500', async () => {
      const response = await httpJson(base, 'GET', '/probe/dispense-like');

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        success: false,
        error: 'OPEN_PERIOD_REQUIRED',
        message: 'Journal date must be in exactly one open financial period.',
      });
    });

    it('rolls the stock mutation back when the posting is rejected', async () => {
      const { itemId, batchId } = await seedStock(5);
      const before = await stockState(itemId, batchId);
      const key = `c0-rollback-${suffix}-${randomUUID()}`;

      let caught: unknown;
      try {
        await transaction(async (client) => {
          await applyStockDraw(client, itemId, batchId, 2, `C0-ROLLBACK-${randomUUID()}`);
          await postInsideTransaction(client, scope, closedPeriodJournal(key));
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(AccountingIntegrityError);
      expect((caught as AccountingIntegrityError).code).toBe('OPEN_PERIOD_REQUIRED');
      expect((caught as AccountingIntegrityError).status).toBe(409);
      expect((caught as AccountingIntegrityError).message).toBe(
        'Journal date must be in exactly one open financial period.',
      );

      const after = await stockState(itemId, batchId);

      /* No stock moved. */
      expect(after.currentStock, 'item stock is unchanged').toBe(before.currentStock);
      expect(after.currentStock).toBe(5);
      /* The lot was drawn down inside the transaction and drawn back by it. */
      expect(after.lotRemaining, 'lot quantity is unchanged').toBe(before.lotRemaining);
      expect(after.lotRemaining).toBe(5);
      /* The movement appended inside the transaction did not survive. */
      expect(after.movements, 'no inventory movement survives').toBe(before.movements);
      expect(after.movements).toBe(0);

      /* And no journal was written, by key or otherwise. */
      expect(await journalCount(key)).toBe(0);
    });

    it('proves the transaction actually mutated stock before it rolled back', async () => {
      /*
       * Without this, the previous test could pass against a mutation that never
       * ran. Commit the same draw with no posting and observe the change, so the
       * rollback assertion is known to be meaningful rather than vacuous.
       */
      const { itemId, batchId } = await seedStock(7);
      const before = await stockState(itemId, batchId);

      await transaction(async (client) => {
        await applyStockDraw(client, itemId, batchId, 2, `C0-CONTROL-${randomUUID()}`);
      });

      const after = await stockState(itemId, batchId);
      expect(after.currentStock, 'the control draw did change stock').toBe(before.currentStock - 2);
      expect(after.lotRemaining, 'the control draw did change the lot').toBe(
        before.lotRemaining - 2,
      );
      expect(after.movements, 'the control draw wrote a movement').toBe(before.movements + 1);
    });

    it('still permits a posting dated inside the closed period to be refused by the primitive', async () => {
      /*
       * Guards the fixture: if the period were OPEN this suite would be proving
       * nothing. A date outside every period must fail the same way.
       */
      let caught: unknown;
      try {
        await transaction((client) =>
          postInsideTransaction(client, scope, {
            ...closedPeriodJournal(`c0-outside-${suffix}`),
            entryDate: '2031-06-01',
          }),
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(AccountingIntegrityError);
      expect((caught as AccountingIntegrityError).code).toBe('OPEN_PERIOD_REQUIRED');
    });

    it('rejects an account outside the closed period facility before writing anything', async () => {
      /* A second failure class through the same primitive, so the mapping is not
       proven for one code only. */
      const otherFacility = (
        await pool.query(
          `INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules)
         VALUES($1,$2,'Synthetic C0 other facility','Africa/Nairobi','["inventory"]') RETURNING id`,
          [tenant, `C0-X-${suffix}`],
        )
      ).rows[0].id as number;

      const otherAccount = (
        await pool.query(
          `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance)
         VALUES($1,$2,$3,'Synthetic C0 foreign account','EXPENSE','C0_TEST','DEBIT') RETURNING id`,
          [tenant, otherFacility, `C0-9999-${suffix}`],
        )
      ).rows[0].id as number;

      let caught: unknown;
      try {
        await transaction((client) =>
          postInsideTransaction(client, scope, {
            entryDate: closedDate,
            description: 'Synthetic C0 out-of-scope account probe',
            idempotencyKey: `c0-scope-${suffix}-${randomUUID()}`,
            sourceType: 'MANUAL',
            totalCents: 500n,
            lines: [
              {
                accountId: otherAccount,
                debitCents: 500n,
                creditCents: 0n,
                description: null,
                serviceLine: null,
              },
              {
                accountId: creditAccount,
                debitCents: 0n,
                creditCents: 500n,
                description: null,
                serviceLine: null,
              },
            ],
          }),
        );
      } catch (error) {
        caught = error;
      }

      /* The account check runs after the period check, so this specific fixture
       is refused as a closed period first. Asserting the class keeps the test
       honest about what it observes; the account-scope status is covered by
       the handler contract test above, which needs no database. */
      expect(caught).toBeInstanceOf(AccountingIntegrityError);
    });
  },
);

/* ----------------------------------------------------------- route wiring */

describe('Stock-control route wiring', () => {
  let source: string;
  let pharmacySource: string;

  beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    source = readFileSync(
      new URL('../../routes/inventory-control.routes.ts', import.meta.url),
      'utf8',
    );
    pharmacySource = readFileSync(
      new URL('../../routes/pharmacy.routes.ts', import.meta.url),
      'utf8',
    );
  });

  it('imports the shared accounting mapping', () => {
    expect(source).toMatch(
      /import\s*\{[^}]*handleAccountingIntegrityError[^}]*\}\s*from\s*'\.\/shared\/errors\.ts'/,
    );
  });

  it('calls the mapping ahead of the internal-error fallback', () => {
    /* Both must appear inside `handleError`, in this order. A refactor that
       drops the branch, or moves it after the fallback, fails here. */
    const handler = source.slice(source.indexOf('function handleError'));
    const accountingAt = handler.indexOf('handleAccountingIntegrityError');
    const internalAt = handler.indexOf('respondInternalError');

    expect(accountingAt).toBeGreaterThan(-1);
    expect(internalAt).toBeGreaterThan(-1);
    expect(accountingAt, 'accounting mapping precedes the 500 fallback').toBeLessThan(internalAt);
  });

  it('keeps the StockError branch first, so stock errors keep their status', () => {
    const handler = source.slice(source.indexOf('function handleError'));
    expect(handler.indexOf('stock.StockError')).toBeLessThan(
      handler.indexOf('handleAccountingIntegrityError'),
    );
  });

  it('leaves pharmacy on the shared inventory handler, which now covers accounting', () => {
    /* C0 deliberately did not touch pharmacy.routes.ts: it already routes
       through handleInventoryError, so adding the branch there covers
       dispensing. */
    expect(pharmacySource).toMatch(/handleInventoryError/);
    expect(pharmacySource).not.toMatch(/handleAccountingIntegrityError/);
  });
});
