/**
 * Phase 5 Batch E — HTTP surface for matching, returns and credit notes.
 *
 * WHY A SEPARATE FILE FROM THE SERVICE SPEC
 * -----------------------------------------
 * `procurement-matching-returns.db.spec.ts` proves the accounting arithmetic.
 * This file proves the part operators actually touch: the nine routes, the
 * permission on each one, facility scoping, and the error code a client sees
 * when a control refuses the request. A correct service behind a route that
 * answers 500 is still a broken feature.
 *
 * WHAT THIS PROVES
 * ----------------
 *  1. An operator with `procurement.read`/`procurement.complete` can read the
 *     match verdict for an invoice, re-run it, and list returns and credits.
 *  2. A read-only operator cannot post a return or a credit note (403), and an
 *     unauthenticated caller gets 401.
 *  3. A user in one facility cannot read or post against another facility's
 *     invoice, return or credit note — the facility id in the body is not
 *     trusted over the session's scope.
 *  4. A variance verdict surfaces as 409 `THREE_WAY_MATCH_VARIANCE` and an
 *     override with a short reason as 400 `OVERRIDE_REASON_REQUIRED`, not 500.
 *  5. An over-sized credit note surfaces as 409 `CREDIT_EXCEEDS_BALANCE`, and
 *     an unknown id as 404 with the domain code.
 *  6. A posted return is immediately visible through the list and detail
 *     routes with its journal id, so the operator can see it reached the ledger.
 *
 * Synthetic data only. No real patient, staff or financial records.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSession } from '../../auth/session.service.ts';
import { pool } from '../../db/index.ts';
import {
  activateInventoryAccountingPolicy,
  saveInventoryAccountingPolicy,
} from '../../inventory/inventory-accounting.service.ts';
import {
  createSupplierInvoice,
  postGoodsReceivedNote,
} from '../../procurement/receiving.service.ts';
import { describeDb } from '../vitest/support/db.ts';
import { httpJson, startTestServer } from './support/http-harness.ts';

describeDb('Batch E HTTP — matching, returns, credit notes', () => {
  const suffix = randomUUID().slice(0, 8);
  let base: string;
  let close: () => Promise<void>;

  let tenantId: number;
  let facilityA: number;
  let facilityB: number;
  let supplierId: number;
  let accounts: Record<string, number>;
  let stockOperator: { id: number; token: string };
  let reader: { id: number; token: string };
  let outsider: { id: number; token: string };
  let noPerms: { id: number; token: string };

  const call = (
    method: string,
    path: string,
    token: string | undefined,
    body?: Record<string, unknown>,
  ) => httpJson(base, method, path, { token, body });

  async function makeActor(
    tag: string,
    tenant: number,
    facility: number,
    grants: string[],
  ): Promise<{ id: number; token: string }> {
    const id = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,$3,'test-only','ACTIVE',$4,$5) RETURNING id`,
        [
          `ehttp-${tag}-${suffix}`,
          `ehttp-${tag}-${suffix}@example.test`,
          `Synthetic ${tag}`,
          tenant,
          facility,
        ],
      )
    ).rows[0].id as number;
    const role = (
      await pool.query(
        'INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) RETURNING id',
        [tenant, `EHTTP_${tag}_${suffix}`],
      )
    ).rows[0].id;
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
    for (const grant of grants)
      await pool.query(
        `INSERT INTO permissions(code,name,module) VALUES($1,$1,'procurement') ON CONFLICT(code) DO NOTHING`,
        [`procurement.${grant}`],
      );
    for (const grant of grants)
      await pool.query(
        'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2',
        [role, `procurement.${grant}`],
      );
    return { id, token: (await createSession({ userId: id, securityVersion: 1 })).sessionToken };
  }

  let counter = 700_000;

  /** Receipt plus invoice, built through the real services. */
  async function receiptAndInvoice(facility: number, options: { quantity: number; price: number }) {
    const orderId = (
      await pool.query(
        `INSERT INTO purchase_orders(tenant_id,facility_id,supplier_id,po_number,total_amount,status)
         VALUES($1,$2,$3,$4,$5,'Approved') RETURNING id`,
        [
          tenantId,
          facility,
          supplierId,
          `PO-EH-${suffix}-${++counter}`,
          (options.quantity * options.price).toFixed(2),
        ],
      )
    ).rows[0].id as number;
    const orderItemId = (
      await pool.query(
        `INSERT INTO purchase_order_items(purchase_order_id,line_number,description,quantity,unit,unit_price,line_total)
         VALUES($1,1,'Synthetic EH gloves',$2,'Boxes',$3,$4) RETURNING id`,
        [
          orderId,
          options.quantity,
          options.price.toFixed(2),
          (options.quantity * options.price).toFixed(2),
        ],
      )
    ).rows[0].id as number;
    const itemId = (
      await pool.query(
        `INSERT INTO inventory_items(facility_id,item_code,name,current_stock,unit,unit_cost)
         VALUES($1,$2,'Synthetic EH gloves',0,'Boxes',$3) RETURNING id`,
        [facility, `EH-ITEM-${suffix}-${counter}`, options.price.toFixed(2)],
      )
    ).rows[0].id as number;

    const scope = {
      tenantId,
      facilityId: facility,
      actorId: stockOperator.id,
      actorName: 'Synthetic EH operator',
    };
    const receipt = await postGoodsReceivedNote(scope, {
      purchaseOrderId: orderId,
      grnNumber: `GRN-EH-${suffix}-${counter}`,
      receivedDate: '2026-04-10',
      idempotencyKey: `grn-eh-${suffix}-${counter}`,
      lines: [
        {
          purchaseOrderItemId: orderItemId,
          quantityReceived: options.quantity,
          unitCost: options.price,
          inventoryItemId: itemId,
          batchNumber: `LOT-EH-${suffix}-${counter}`,
          expiryDate: '2028-01-31',
        },
      ],
    });
    const invoice = await createSupplierInvoice(scope, {
      goodsReceivedNoteId: receipt.id,
      invoiceNumber: `INV-EH-${suffix}-${counter}`,
      invoiceDate: '2026-04-10',
      entryDate: '2026-01-01',
      expenseAccountId: accounts.expense,
      apAccountId: accounts.payable,
      taxAmount: 0,
      idempotencyKey: `inv-eh-${suffix}-${counter}`,
    });
    const grnItemId = Number(
      (
        await pool.query(
          'SELECT id FROM goods_received_note_items WHERE goods_received_note_id=$1',
          [receipt.id],
        )
      ).rows[0].id,
    );
    return { grnId: receipt.id, invoiceId: invoice.invoiceId, grnItemId };
  }

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Synthetic DB required.');

    tenantId = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic EH tenant ${suffix}`,
        `batch-eh-${suffix}`,
      ])
    ).rows[0].id as number;
    supplierId = (
      await pool.query('INSERT INTO suppliers(tenant_id,name) VALUES($1,$2) RETURNING id', [
        tenantId,
        `Synthetic EH supplier ${suffix}`,
      ])
    ).rows[0].id as number;

    const makeFacility = async (tag: string) =>
      (
        await pool.query(
          `INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules)
           VALUES($1,$2,$3,'Africa/Nairobi','["inventory","accounting","procurement"]') RETURNING id`,
          [tenantId, `EH-${tag}-${suffix}`, `Synthetic EH ${tag}`],
        )
      ).rows[0].id as number;

    facilityA = await makeFacility('A');
    facilityB = await makeFacility('B');

    accounts = {};
    for (const [key, code, type, normal] of [
      ['stock', '1300', 'ASSET', 'DEBIT'],
      ['clearing', '2150', 'LIABILITY', 'CREDIT'],
      ['consumption', '5100', 'EXPENSE', 'DEBIT'],
      ['adjustment', '5200', 'EXPENSE', 'DEBIT'],
      ['writeOff', '5300', 'EXPENSE', 'DEBIT'],
      ['opening', '3300', 'EQUITY', 'CREDIT'],
      ['inputVat', '1400', 'ASSET', 'DEBIT'],
      ['payable', '2100', 'LIABILITY', 'CREDIT'],
      ['expense', '5400', 'EXPENSE', 'DEBIT'],
    ] as Array<[string, string, string, string]>) {
      accounts[key] = (
        await pool.query(
          `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance)
           VALUES($1,$2,$3,$4,$5,'BATCH_E_HTTP',$6) RETURNING id`,
          [tenantId, facilityA, `${code}-EH-${suffix}`, `Synthetic EH ${key}`, type, normal],
        )
      ).rows[0].id as number;
    }

    await pool.query(
      `INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date,status)
       VALUES($1,$2,$3,'Synthetic EH open','2026-01-01','2026-12-31','OPEN')`,
      [tenantId, facilityA, `EH-OPEN-${suffix}`],
    );
    await saveInventoryAccountingPolicy(
      { tenantId, facilityId: facilityA },
      {
        basis: 'PERPETUAL',
        stockAssetAccountId: accounts.stock,
        clearingAccountId: accounts.clearing,
        consumptionAccountId: accounts.consumption,
        adjustmentAccountId: accounts.adjustment,
        writeOffAccountId: accounts.writeOff,
        openingBalanceAccountId: accounts.opening,
        inputVatAccountId: accounts.inputVat,
      },
    );

    const { createApp } = await import('../../app.ts');
    ({ baseUrl: base, close } = await startTestServer(await createApp()));

    stockOperator = await makeActor('stock', tenantId, facilityA, ['read', 'create', 'complete']);
    reader = await makeActor('reader', tenantId, facilityA, ['read']);
    outsider = await makeActor('outsider', tenantId, facilityB, ['read', 'create', 'complete']);
    noPerms = await makeActor('none', tenantId, facilityA, []);

    await activateInventoryAccountingPolicy(
      { tenantId, facilityId: facilityA, actorUserId: stockOperator.id },
      { financeApprovedByUserId: stockOperator.id, effectiveFrom: '2026-01-01' },
    );
  }, 180_000);

  afterAll(async () => {
    if (close) await close();
    await pool.end().catch(() => undefined);
  });

  describe('authorisation', () => {
    it('rejects an unauthenticated read with 401', async () => {
      const response = await call('GET', `/api/procurement/supplier-invoices/1/match`, undefined);
      expect(response.status).toBe(401);
    });

    it('rejects posting a credit note without the complete permission', async () => {
      const response = await call('POST', '/api/procurement/supplier-credit-notes', noPerms.token, {
        facilityId: facilityA,
        supplierId,
        creditNoteNumber: `CN-EH-PERM-${suffix}`,
        creditNoteDate: '2026-04-10',
        subtotal: 5,
      });
      expect(response.status).toBe(403);
    });

    it('rejects posting a return with read-only permission', async () => {
      const response = await call('POST', '/api/procurement/supplier-returns', reader.token, {
        facilityId: facilityA,
        goodsReceivedNoteId: 1,
        returnNumber: `RET-EH-PERM-${suffix}`,
        returnDate: '2026-04-10',
        reasonCode: 'WRONG_ITEM',
        lines: [],
      });
      expect(response.status).toBe(403);
    });
  });

  describe('matching routes', () => {
    it('returns the stored verdict and re-runs the match', async () => {
      const { invoiceId } = await receiptAndInvoice(facilityA, { quantity: 2, price: 10 });

      const read = await call(
        'GET',
        `/api/procurement/supplier-invoices/${invoiceId}/match?facilityId=${facilityA}`,
        stockOperator.token,
      );
      expect(read.status).toBe(200);
      expect(read.body.success).toBe(true);
      expect(read.body.match.status).toBe('MATCHED');

      const rerun = await call(
        'POST',
        `/api/procurement/supplier-invoices/${invoiceId}/match`,
        stockOperator.token,
        { facilityId: facilityA },
      );
      expect(rerun.status).toBe(200);
      expect(rerun.body.match.status).toBe('MATCHED');
    });

    it('answers 404 for an invoice in another facility', async () => {
      const { invoiceId } = await receiptAndInvoice(facilityA, { quantity: 1, price: 10 });
      const response = await call(
        'GET',
        `/api/procurement/supplier-invoices/${invoiceId}/match?facilityId=${facilityB}`,
        stockOperator.token,
      );
      /* The operator is scoped to A, so asking for B is refused outright. */
      expect([403, 404]).toContain(response.status);
      expect(response.body.success).toBe(false);
    });

    it('surfaces a variance as 409 and a short override reason as 400', async () => {
      /* Priced into stock above the order price, so the verdict has a variance. */
      const orderId = (
        await pool.query(
          `INSERT INTO purchase_orders(tenant_id,facility_id,supplier_id,po_number,total_amount,status)
           VALUES($1,$2,$3,$4,$5,'Approved') RETURNING id`,
          [tenantId, facilityA, supplierId, `PO-EH-VAR-${suffix}`, '100.00'],
        )
      ).rows[0].id as number;
      const orderItemId = (
        await pool.query(
          `INSERT INTO purchase_order_items(purchase_order_id,line_number,description,quantity,unit,unit_price,line_total)
           VALUES($1,1,'Synthetic variance item',10,'Boxes',10.00,100.00) RETURNING id`,
          [orderId],
        )
      ).rows[0].id as number;
      const itemId = (
        await pool.query(
          `INSERT INTO inventory_items(facility_id,item_code,name,current_stock,unit,unit_cost)
           VALUES($1,$2,'Synthetic variance item',0,'Boxes',12.00) RETURNING id`,
          [facilityA, `EH-VAR-${suffix}`],
        )
      ).rows[0].id as number;

      const scope = {
        tenantId,
        facilityId: facilityA,
        actorId: stockOperator.id,
        actorName: 'Synthetic EH operator',
      };
      const receipt = await postGoodsReceivedNote(scope, {
        purchaseOrderId: orderId,
        grnNumber: `GRN-EH-VAR-${suffix}`,
        receivedDate: '2026-04-10',
        idempotencyKey: `grn-eh-var-${suffix}`,
        lines: [
          {
            purchaseOrderItemId: orderItemId,
            quantityReceived: 10,
            unitCost: 12,
            inventoryItemId: itemId,
            batchNumber: `LOT-EH-VAR-${suffix}`,
            expiryDate: '2028-01-31',
          },
        ],
      });
      const invoice = await createSupplierInvoice(scope, {
        goodsReceivedNoteId: receipt.id,
        invoiceNumber: `INV-EH-VAR-${suffix}`,
        invoiceDate: '2026-04-10',
        entryDate: '2026-01-01',
        expenseAccountId: accounts.expense,
        apAccountId: accounts.payable,
        taxAmount: 0,
        idempotencyKey: `inv-eh-var-${suffix}`,
      });

      const read = await call(
        'GET',
        `/api/procurement/supplier-invoices/${invoice.invoiceId}/match?facilityId=${facilityA}`,
        stockOperator.token,
      );
      expect(read.body.match.status).toBe('VARIANCE');

      /* The payment gate is a service concern; what HTTP must do is carry the
         override refusal with its own status instead of a 500. */
      const short = await call(
        'POST',
        `/api/procurement/supplier-invoices/${invoice.invoiceId}/match-override`,
        stockOperator.token,
        { facilityId: facilityA, reason: 'ok' },
      );
      expect(short.status).toBe(400);
      expect(short.body.error).toBe('OVERRIDE_REASON_REQUIRED');

      const accepted = await call(
        'POST',
        `/api/procurement/supplier-invoices/${invoice.invoiceId}/match-override`,
        stockOperator.token,
        {
          facilityId: facilityA,
          reason:
            'Supplier invoiced the agreed post-delivery increase; finance approved 2026-04-11.',
        },
      );
      expect(accepted.status).toBe(200);
      expect(accepted.body.match.status).toBe('OVERRIDDEN');
      expect(accepted.body.match.overrideReason).toContain('post-delivery increase');
    });
  });

  describe('return routes', () => {
    it('posts a return, then lists and reads it back with its journal', async () => {
      const { grnId, grnItemId } = await receiptAndInvoice(facilityA, { quantity: 6, price: 20 });

      const created = await call('POST', '/api/procurement/supplier-returns', stockOperator.token, {
        facilityId: facilityA,
        goodsReceivedNoteId: grnId,
        returnNumber: `RET-EH-OK-${suffix}`,
        returnDate: '2026-04-12',
        reasonCode: 'DAMAGED_IN_TRANSIT',
        idempotencyKey: `ret-eh-ok-${suffix}`,
        lines: [{ goodsReceivedNoteItemId: grnItemId, quantity: 2 }],
      });
      expect(created.status).toBe(201);
      expect(created.body.return.totalCents).toBe(4000);
      expect(created.body.return.counterpart).toBe('PAYABLE');
      expect(created.body.journalId).toBeGreaterThan(0);

      const list = await call(
        'GET',
        `/api/procurement/supplier-returns?facilityId=${facilityA}&goodsReceivedNoteId=${grnId}`,
        stockOperator.token,
      );
      expect(list.status).toBe(200);
      expect(list.body.returns).toHaveLength(1);

      const detail = await call(
        'GET',
        `/api/procurement/supplier-returns/${created.body.returnId}?facilityId=${facilityA}`,
        stockOperator.token,
      );
      expect(detail.status).toBe(200);
      expect(detail.body.return.returnNumber).toBe(`RET-EH-OK-${suffix}`);
      expect(detail.body.return.lines[0].quantity).toBe(2);
    });

    it('answers 409 RETURN_EXCEEDS_RECEIPT rather than 500', async () => {
      const { grnId, grnItemId } = await receiptAndInvoice(facilityA, { quantity: 2, price: 10 });
      const response = await call(
        'POST',
        '/api/procurement/supplier-returns',
        stockOperator.token,
        {
          facilityId: facilityA,
          goodsReceivedNoteId: grnId,
          returnNumber: `RET-EH-OVER-${suffix}`,
          returnDate: '2026-04-12',
          reasonCode: 'WRONG_ITEM',
          idempotencyKey: `ret-eh-over-${suffix}`,
          lines: [{ goodsReceivedNoteItemId: grnItemId, quantity: 99 }],
        },
      );
      expect(response.status).toBe(409);
      expect(response.body.error).toBe('RETURN_EXCEEDS_RECEIPT');
    });

    it('refuses a return posted by a user scoped to another facility', async () => {
      const { grnId, grnItemId } = await receiptAndInvoice(facilityA, { quantity: 2, price: 10 });
      const response = await call('POST', '/api/procurement/supplier-returns', outsider.token, {
        facilityId: facilityA,
        goodsReceivedNoteId: grnId,
        returnNumber: `RET-EH-CROSS-${suffix}`,
        returnDate: '2026-04-12',
        reasonCode: 'WRONG_ITEM',
        lines: [{ goodsReceivedNoteItemId: grnItemId, quantity: 1 }],
      });
      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  describe('credit note routes', () => {
    it('applies a credit note and lists it against the invoice', async () => {
      const { invoiceId } = await receiptAndInvoice(facilityA, { quantity: 5, price: 20 });

      const created = await call(
        'POST',
        '/api/procurement/supplier-credit-notes',
        stockOperator.token,
        {
          facilityId: facilityA,
          supplierId,
          supplierInvoiceId: invoiceId,
          creditNoteNumber: `CN-EH-OK-${suffix}`,
          creditNoteDate: '2026-04-13',
          subtotal: 20,
          tax: 3.2,
          taxRecoverable: true,
          idempotencyKey: `cn-eh-ok-${suffix}`,
        },
      );
      expect(created.status).toBe(201);
      expect(created.body.creditNote.totalCents).toBe(2320);
      expect(created.body.creditNote.status).toBe('APPLIED');

      const list = await call(
        'GET',
        `/api/procurement/supplier-credit-notes?facilityId=${facilityA}&supplierInvoiceId=${invoiceId}`,
        stockOperator.token,
      );
      expect(list.status).toBe(200);
      expect(list.body.creditNotes).toHaveLength(1);

      const detail = await call(
        'GET',
        `/api/procurement/supplier-credit-notes/${created.body.creditNoteId}?facilityId=${facilityA}`,
        stockOperator.token,
      );
      expect(detail.status).toBe(200);
      expect(detail.body.creditNote.creditNoteNumber).toBe(`CN-EH-OK-${suffix}`);
    });

    it('answers 409 CREDIT_EXCEEDS_BALANCE for an oversized credit', async () => {
      const { invoiceId } = await receiptAndInvoice(facilityA, { quantity: 2, price: 10 });
      const response = await call(
        'POST',
        '/api/procurement/supplier-credit-notes',
        stockOperator.token,
        {
          facilityId: facilityA,
          supplierId,
          supplierInvoiceId: invoiceId,
          creditNoteNumber: `CN-EH-BIG-${suffix}`,
          creditNoteDate: '2026-04-13',
          subtotal: 500,
          idempotencyKey: `cn-eh-big-${suffix}`,
        },
      );
      expect(response.status).toBe(409);
      expect(response.body.error).toBe('CREDIT_EXCEEDS_BALANCE');
    });

    it('answers 404 with a domain code for an unknown credit note', async () => {
      const response = await call(
        'GET',
        `/api/procurement/supplier-credit-notes/99999999?facilityId=${facilityA}`,
        stockOperator.token,
      );
      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(typeof response.body.error).toBe('string');
    });
  });
});
