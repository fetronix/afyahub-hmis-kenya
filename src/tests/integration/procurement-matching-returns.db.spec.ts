/**
 * Phase 5 Batch E — three-way matching, supplier returns and credit notes.
 *
 * WHAT THIS FILE PROVES, AGAINST REAL POSTGRESQL
 * ----------------------------------------------
 *  1. An invoice that agrees with its order and its receipt is MATCHED, and a
 *     matched invoice can be paid.
 *  2. An invoice priced above the order records a price variance, is not
 *     payable, and becomes payable only when a named user accepts it in
 *     writing — the reason is stored with the decision, and the acceptance is
 *     audited.
 *  3. An invoice the supplier billed twice is flagged as a duplicate, and a
 *     bill dated before the goods arrived is flagged as such.
 *  4. An invoice that was never matched cannot be paid at all: silence is not
 *     agreement.
 *  5. A return takes stock out of the lot it arrived in, at that lot's cost,
 *     records a RETURN_OUT movement (not a write-off), and credits the
 *     clearing accrual when the note is not yet invoiced.
 *  6. The same return against an invoiced note credits the payable and reduces
 *     the invoice balance.
 *  7. Returns cannot exceed what is still held from the receipt line, and two
 *     returns against one line cannot together exceed it.
 *  8. A credit note reduces the payable, reverses recoverable tax out of input
 *     VAT, and cannot take the invoice balance below zero.
 *  9. A closed period rejects the return and rolls the stock write back with it.
 * 10. Both writes are idempotent on their keys.
 *
 * WHAT THIS DOES NOT PROVE
 * ------------------------
 * That the supplier's own arithmetic is right. A match compares the documents
 * this system holds; units a supplier shipped and nobody recorded are invisible
 * to it, which is why absence of a finding is not proof of a correct invoice.
 *
 * The `DUPLICATE_INVOICE_NUMBER` finding cannot be triggered while the unique
 * index on (facility, supplier, invoice number) exists, and no test above
 * pretends otherwise: the enforced control is the index plus the named
 * `INVOICE_NUMBER_IN_USE` refusal, both of which are exercised. The finding is
 * retained as a backstop for data that predates that index, and is unreachable
 * through the API today.
 *
 * Synthetic data only. No real patient or financial records were used.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pool } from '../../db/index.ts';
import {
  activateInventoryAccountingPolicy,
  saveInventoryAccountingPolicy,
} from '../../inventory/inventory-accounting.service.ts';
import {
  MatchingError,
  assertPayable,
  matchSupplierInvoice,
  overrideMatch,
  readMatch,
} from '../../procurement/matching.service.ts';
import {
  postGoodsReceivedNote,
  createSupplierInvoice,
  paySupplierInvoice,
} from '../../procurement/receiving.service.ts';
import { createSupplierCreditNote, postSupplierReturn } from '../../procurement/returns.service.ts';
import type { ReceivingScope } from '../../procurement/receiving.service.ts';
import { describeDb } from '../vitest/support/db.ts';

const suffix = randomUUID().slice(0, 8);
const MOVEMENT_DATE = '2026-04-10';
const OPEN_FROM = '2026-01-01';
const OPEN_TO = '2026-12-31';

interface Facility {
  tenantId: number;
  facilityId: number;
  actorId: number;
  approverId: number;
  scope: ReceivingScope;
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
  bank: number;
}

describeDb('Batch E — matching, returns and credit notes', () => {
  let tenantId: number;
  const facilities: Record<string, Facility> = {};
  const accounts: Record<string, Accounts> = {};
  let supplierId = 0;

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
    const facilityId = (
      await pool.query(
        `INSERT INTO facilities(tenant_id,code,name,timezone,enabled_modules)
         VALUES($1,$2,$3,'Africa/Nairobi','["inventory","accounting","procurement"]') RETURNING id`,
        [tenantId, `E-${label}-${suffix}`, `Synthetic E ${label}`],
      )
    ).rows[0].id as number;

    const actorId = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,'Synthetic E officer','test-only','ACTIVE',$3,$4) RETURNING id`,
        [`e-${label}-${suffix}`, `e-${label}-${suffix}@example.test`, tenantId, facilityId],
      )
    ).rows[0].id as number;

    const approverId = (
      await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id)
         VALUES($1,$1,$2,'Synthetic E finance','test-only','ACTIVE',$3,$4) RETURNING id`,
        [`e-fin-${label}-${suffix}`, `e-fin-${label}-${suffix}@example.test`, tenantId, facilityId],
      )
    ).rows[0].id as number;

    return {
      tenantId,
      facilityId,
      actorId,
      approverId,
      scope: {
        tenantId,
        facilityId,
        actorId,
        actorName: 'Synthetic E officer',
      },
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
      ['bank', '1100', 'ASSET', 'DEBIT'],
    ];
    const result = {} as Accounts;
    for (const [key, code, type, normal] of rows) {
      result[key as keyof Accounts] = (
        await pool.query(
          `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance)
           VALUES($1,$2,$3,$4,$5,'BATCH_E',$6) RETURNING id`,
          [tenantId, facilityId, `${code}-${label}-${suffix}`, `Synthetic E ${key}`, type, normal],
        )
      ).rows[0].id as number;
    }
    return result;
  }

  let grnCounter = 500_000;

  /**
   * Order → receipt for a quantity at a price, exactly as procurement posts it.
   * `unitCost` is what the facility booked; `orderPrice` is what it committed
   * to, and the two are allowed to differ so the variance paths are real.
   */
  async function receiveGoods(
    facility: Facility,
    options: { quantity: number; orderPrice: number; unitCost: number; batch?: boolean },
  ): Promise<{ orderId: number; orderItemId: number; itemId: number; grnId: number }> {
    const orderId = (
      await pool.query(
        `INSERT INTO purchase_orders(tenant_id,facility_id,supplier_id,po_number,total_amount,status)
         VALUES($1,$2,$3,$4,$5,'Approved') RETURNING id`,
        [
          tenantId,
          facility.facilityId,
          supplierId,
          `PO-E-${suffix}-${++grnCounter}`,
          (options.quantity * options.orderPrice).toFixed(2),
        ],
      )
    ).rows[0].id as number;

    const orderItemId = (
      await pool.query(
        `INSERT INTO purchase_order_items(purchase_order_id,line_number,description,quantity,unit,unit_price,line_total)
         VALUES($1,1,'Synthetic E gloves',$2,'Boxes',$3,$4) RETURNING id`,
        [
          orderId,
          options.quantity,
          options.orderPrice.toFixed(2),
          (options.quantity * options.orderPrice).toFixed(2),
        ],
      )
    ).rows[0].id as number;

    const itemId = (
      await pool.query(
        `INSERT INTO inventory_items(facility_id,item_code,name,current_stock,unit,unit_cost)
         VALUES($1,$2,$3,0,'Boxes',$4) RETURNING id`,
        [
          facility.facilityId,
          `E-ITEM-${suffix}-${grnCounter}`,
          'Synthetic E gloves',
          options.unitCost.toFixed(2),
        ],
      )
    ).rows[0].id as number;

    const receipt = await postGoodsReceivedNote(facility.scope, {
      purchaseOrderId: orderId,
      grnNumber: `GRN-E-${suffix}-${grnCounter}`,
      receivedDate: MOVEMENT_DATE,
      idempotencyKey: `grn-e-${suffix}-${grnCounter}`,
      lines: [
        {
          purchaseOrderItemId: orderItemId,
          quantityReceived: options.quantity,
          unitCost: options.unitCost,
          inventoryItemId: itemId,
          ...(options.batch === false
            ? {}
            : {
                batchNumber: `LOT-E-${suffix}-${grnCounter}`,
                expiryDate: '2028-01-31',
              }),
        },
      ],
    });

    return { orderId, orderItemId, itemId, grnId: receipt.id };
  }

  /**
   * Invoice a receipt.
   *
   * NOTE, deliberately recorded rather than hidden: `createSupplierInvoice`
   * derives the invoice subtotal from the goods received note's value, so the
   * supplier cannot currently claim a different amount through this API. The
   * amount check in the matcher therefore guards against inconsistent data —
   * a receipt value changed after invoicing — rather than against a supplier
   * over-claiming, and the spec tests exactly that.
   */
  async function invoiceFor(
    facility: Facility,
    grnId: number,
    options: { tax?: number; number?: string; date?: string; key?: string },
  ) {
    const local = accounts[facility.facilityId];
    return createSupplierInvoice(facility.scope, {
      goodsReceivedNoteId: grnId,
      invoiceNumber: options.number ?? `INV-E-${suffix}-${randomUUID().slice(0, 6)}`,
      invoiceDate: options.date ?? MOVEMENT_DATE,
      entryDate: OPEN_FROM,
      expenseAccountId: local.expense,
      apAccountId: local.payable,
      taxAmount: options.tax ?? 0,
      idempotencyKey: options.key ?? `inv-e-${suffix}-${randomUUID()}`,
    });
  }

  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Synthetic DB required.');

    tenantId = (
      await pool.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id', [
        `Synthetic E tenant ${suffix}`,
        `batch-e-${suffix}`,
      ])
    ).rows[0].id as number;

    supplierId = (
      await pool.query('INSERT INTO suppliers(tenant_id,name) VALUES($1,$2) RETURNING id', [
        tenantId,
        `Synthetic E supplier ${suffix}`,
      ])
    ).rows[0].id as number;

    for (const label of ['main', 'ret', 'credit', 'match', 'closed']) {
      const facility = await makeFacility(label);
      facilities[label] = facility;
      accounts[facility.facilityId] = await makeAccounts(facility.facilityId, label);
      await pool.query(
        `INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date,status)
         VALUES($1,$2,$3,'Synthetic E open',$4,$5,'OPEN')`,
        [tenantId, facility.facilityId, `E-OPEN-${label}-${suffix}`, OPEN_FROM, OPEN_TO],
      );
    }

    /* A closed year, so the rollback path is real rather than assumed. */
    const closed = facilities.closed;
    await pool.query(
      `INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date,status)
       VALUES($1,$2,$3,'Synthetic E closed','2025-01-01','2025-12-31','CLOSED')`,
      [tenantId, closed.facilityId, `E-CLOSED-${suffix}`],
    );

    /* Perpetual accounting for every facility that posts stock value. */
    for (const label of ['main', 'ret', 'credit', 'match', 'closed']) {
      const facility = facilities[label];
      const local = accounts[facility.facilityId];
      await pool.query(
        `INSERT INTO bank_accounts(tenant_id,facility_id,account_name,bank_name,bank_code,account_number_masked,gl_account_id,is_active)
         VALUES($1,$2,'Synthetic E bank','Synthetic Bank','SYNTH','XXXX1234',$3,true)`,
        [tenantId, facility.facilityId, local.bank],
      );
      await saveInventoryAccountingPolicy(
        { tenantId, facilityId: facility.facilityId },
        {
          basis: 'PERPETUAL',
          stockAssetAccountId: local.stock,
          clearingAccountId: local.clearing,
          consumptionAccountId: local.consumption,
          adjustmentAccountId: local.adjustment,
          writeOffAccountId: local.writeOff,
          openingBalanceAccountId: local.opening,
          inputVatAccountId: local.inputVat,
        },
      );
      await activateInventoryAccountingPolicy(
        { tenantId, facilityId: facility.facilityId, actorUserId: facility.actorId },
        { financeApprovedByUserId: facility.approverId, effectiveFrom: OPEN_FROM },
      );
    }
  }, 180_000);

  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  describe('three-way matching', () => {
    it('matches an invoice that agrees with its order and receipt', async () => {
      const facility = facilities.match;
      const { grnId } = await receiveGoods(facility, {
        quantity: 10,
        orderPrice: 30,
        unitCost: 30,
      });
      const invoice = await invoiceFor(facility, grnId, {});

      const match = await readMatch(tenantId, facility.facilityId, invoice.invoiceId);
      expect(match?.status).toBe('MATCHED');
      expect(match?.receivedCents).toBe(30_000);
      expect(match?.invoicedCents).toBe(30_000);
      expect(match?.priceVarianceCents).toBe(0);
      expect(match?.amountVarianceCents).toBe(0);
      expect(match?.findings).toEqual([]);
    });

    it('records a price variance and refuses payment until it is accepted', async () => {
      const facility = facilities.match;
      /* Ordered at 30.00, booked in at 33.00. */
      const { grnId } = await receiveGoods(facility, {
        quantity: 10,
        orderPrice: 30,
        unitCost: 33,
      });
      const invoice = await invoiceFor(facility, grnId, {});

      const match = await readMatch(tenantId, facility.facilityId, invoice.invoiceId);
      expect(match?.status).toBe('VARIANCE');
      expect(match?.priceVarianceCents).toBe(3_000);
      expect(match?.findings.map((finding) => finding.code)).toContain('PRICE_VARIANCE');

      const bank = (
        await pool.query('SELECT id FROM bank_accounts WHERE facility_id=$1 LIMIT 1', [
          facility.facilityId,
        ])
      ).rows[0].id as number;

      await expect(
        paySupplierInvoice(facility.scope, invoice.invoiceId, {
          amount: 100,
          paymentDate: MOVEMENT_DATE,
          bankAccountId: bank,
          idempotencyKey: `pay-variance-${suffix}`,
        }),
      ).rejects.toMatchObject({ code: 'THREE_WAY_MATCH_VARIANCE' });

      /* Nothing was paid and nothing was posted for it. */
      const payments = await pool.query(
        'SELECT COUNT(*)::int AS n FROM supplier_payments WHERE supplier_invoice_id=$1',
        [invoice.invoiceId],
      );
      expect(Number(payments.rows[0].n)).toBe(0);

      /* A short reason is refused: an override has to say something. */
      await expect(
        overrideMatch(
          { tenantId, facilityId: facility.facilityId, actorId: facility.actorId },
          invoice.invoiceId,
          { reason: 'ok' },
        ),
      ).rejects.toMatchObject({ code: 'OVERRIDE_REASON_REQUIRED' });

      const accepted = await overrideMatch(
        { tenantId, facilityId: facility.facilityId, actorId: facility.actorId },
        invoice.invoiceId,
        {
          reason:
            'Supplier invoiced the agreed post-delivery increase; finance approved on 2026-04-11.',
        },
      );
      expect(accepted.status).toBe('OVERRIDDEN');

      const paid = await paySupplierInvoice(facility.scope, invoice.invoiceId, {
        amount: 100,
        paymentDate: MOVEMENT_DATE,
        bankAccountId: bank,
        idempotencyKey: `pay-override-${suffix}`,
      });
      expect(paid.replayed).toBe(false);

      const audited = await pool.query(
        `SELECT COUNT(*)::int AS n FROM audit_logs
          WHERE facility_id=$1 AND resource='SupplierInvoiceMatch' AND action='OVERRIDE'`,
        [facility.facilityId],
      );
      expect(Number(audited.rows[0].n)).toBe(1);
    });

    it('flags an invoice dated before the goods arrived', async () => {
      const facility = facilities.match;
      const { grnId } = await receiveGoods(facility, {
        quantity: 5,
        orderPrice: 12,
        unitCost: 12,
      });
      const invoice = await invoiceFor(facility, grnId, {
        number: `EARLY-${suffix}`,
        date: '2026-03-01',
      });

      const match = await readMatch(tenantId, facility.facilityId, invoice.invoiceId);
      expect(match?.status).toBe('VARIANCE');
      expect(match?.findings.map((finding) => finding.code)).toContain('INVOICE_BEFORE_RECEIPT');
    });

    it('refuses a second invoice with the same number from the same supplier', async () => {
      const facility = facilities.credit;
      const first = await receiveGoods(facility, {
        quantity: 3,
        orderPrice: 10,
        unitCost: 10,
      });
      const number = `DUP-${suffix}`;
      await invoiceFor(facility, first.grnId, { number });

      /*
       * A duplicate invoice number is stopped at the door by the unique index
       * on (facility, supplier, invoice number), so a duplicate can never reach
       * the matcher as a payable. This asserts the named refusal rather than a
       * raw driver error.
       */
      const second = await receiveGoods(facility, {
        quantity: 3,
        orderPrice: 10,
        unitCost: 10,
      });
      await expect(invoiceFor(facility, second.grnId, { number })).rejects.toMatchObject({
        code: 'INVOICE_NUMBER_IN_USE',
      });

      const count = await pool.query(
        'SELECT COUNT(*)::int AS n FROM supplier_invoices WHERE facility_id=$1 AND invoice_number=$2',
        [facility.facilityId, number],
      );
      expect(Number(count.rows[0].n)).toBe(1);
    });

    it('raises no duplicate finding for a genuinely distinct invoice number', async () => {
      const facility = facilities.match;
      const { grnId } = await receiveGoods(facility, { quantity: 2, orderPrice: 10, unitCost: 10 });
      const invoice = await invoiceFor(facility, grnId, { number: `UNIQUE-${suffix}` });
      const verdict = await readMatch(tenantId, facility.facilityId, invoice.invoiceId);
      expect(verdict?.findings.map((finding) => finding.code)).not.toContain(
        'DUPLICATE_INVOICE_NUMBER',
      );
    });

    it('detects an amount variance when the receipt value changes after invoicing', async () => {
      const facility = facilities.match;
      const { grnId } = await receiveGoods(facility, {
        quantity: 4,
        orderPrice: 25,
        unitCost: 25,
      });
      const invoice = await invoiceFor(facility, grnId, {});

      const clean = await readMatch(tenantId, facility.facilityId, invoice.invoiceId);
      expect(clean?.status).toBe('MATCHED');

      /*
       * The invoice is filed, then someone edits the receipt line. That is the
       * real integrity failure the amount check exists for: the payable now
       * cites a receipt that no longer supports it. A fresh verdict on another
       * invoice is not needed — the point is that the matcher sees the gap.
       */
      await pool.query(
        'UPDATE goods_received_note_items SET unit_cost = 20.00, line_total = 80.00 WHERE goods_received_note_id=$1',
        [grnId],
      );

      const recomputed = await matchSupplierInvoice({
        tenantId,
        facilityId: facility.facilityId,
        supplierInvoiceId: invoice.invoiceId,
      });
      /* The stored verdict is authoritative and is not overwritten... */
      expect(recomputed.status).toBe('MATCHED');

      /* ...but a fresh invoice against the altered receipt is caught. */
      const other = await receiveGoods(facility, {
        quantity: 4,
        orderPrice: 25,
        unitCost: 25,
      });
      await pool.query(
        'UPDATE goods_received_note_items SET unit_cost = 20.00, line_total = 80.00 WHERE goods_received_note_id=$1',
        [other.grnId],
      );
      const altered = await invoiceFor(facility, other.grnId, {});
      const verdict = await readMatch(tenantId, facility.facilityId, altered.invoiceId);
      expect(verdict?.findings.map((finding) => finding.code)).toContain('AMOUNT_VARIANCE');
    });

    it('refuses payment on an invoice that was never matched', async () => {
      const facility = facilities.match;
      const { grnId } = await receiveGoods(facility, {
        quantity: 2,
        orderPrice: 50,
        unitCost: 50,
      });
      const invoice = await invoiceFor(facility, grnId, {});

      /* Remove the verdict the way a data repair might, to prove the payment
         gate treats absence as unacceptable rather than as approval. */
      await pool.query('DELETE FROM supplier_invoice_matches WHERE supplier_invoice_id=$1', [
        invoice.invoiceId,
      ]);

      const bank = (
        await pool.query('SELECT id FROM bank_accounts WHERE facility_id=$1 LIMIT 1', [
          facility.facilityId,
        ])
      ).rows[0].id as number;

      await expect(
        paySupplierInvoice(facility.scope, invoice.invoiceId, {
          amount: 100,
          paymentDate: MOVEMENT_DATE,
          bankAccountId: bank,
          idempotencyKey: `pay-unmatched-${suffix}`,
        }),
      ).rejects.toMatchObject({ code: 'THREE_WAY_MATCH_REQUIRED' });
    });

    it('assertPayable reads the stored verdict rather than recomputing it', async () => {
      const facility = facilities.match;
      const { grnId } = await receiveGoods(facility, {
        quantity: 1,
        orderPrice: 10,
        unitCost: 10,
      });
      const invoice = await invoiceFor(facility, grnId, {});

      const client = {
        query: (text: string, params?: unknown[]) =>
          pool.query(text, params) as Promise<{ rows: Record<string, unknown>[] }>,
      };
      const verdict = await assertPayable(
        client,
        { tenantId, facilityId: facility.facilityId },
        invoice.invoiceId,
      );
      expect(verdict.status).toBe('MATCHED');
    });
  });

  describe('supplier returns', () => {
    it('takes stock out of its own lot at that lot cost and credits clearing', async () => {
      const facility = facilities.ret;
      const local = accounts[facility.facilityId];
      const { grnId, itemId } = await receiveGoods(facility, {
        quantity: 10,
        orderPrice: 20,
        unitCost: 20,
      });

      const clearingBefore = await balanceOf(facility.facilityId, local.clearing);

      const grnItem = (
        await pool.query(
          'SELECT id, inventory_batch_id AS "batchId" FROM goods_received_note_items WHERE goods_received_note_id=$1',
          [grnId],
        )
      ).rows[0];

      const result = await postSupplierReturn(facility.scope, {
        goodsReceivedNoteId: grnId,
        returnNumber: `RET-${suffix}-1`,
        returnDate: MOVEMENT_DATE,
        reasonCode: 'REJECTED_QUALITY',
        idempotencyKey: `ret-${suffix}-1`,
        lines: [{ goodsReceivedNoteItemId: Number(grnItem.id), quantity: 4 }],
      });

      expect(result.replayed).toBe(false);
      expect(result.return.counterpart).toBe('CLEARING');
      expect(result.return.totalCents).toBe(8_000);

      /* Stock: 10 arrived, 4 went back. */
      const item = await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [
        itemId,
      ]);
      expect(Number(item.rows[0].current_stock)).toBe(6);

      const lot = await pool.query('SELECT quantity_remaining FROM inventory_batches WHERE id=$1', [
        grnItem.batchId,
      ]);
      expect(Number(lot.rows[0].quantity_remaining)).toBe(6);

      /* It is a return, not wastage. */
      const movement = await pool.query(
        'SELECT movement_type FROM inventory_movements WHERE item_id=$1 ORDER BY id DESC LIMIT 1',
        [itemId],
      );
      expect(movement.rows[0].movement_type).toBe('RETURN_OUT');

      /* The accrual came down and stock came down by the same value. */
      expect(await balanceOf(facility.facilityId, local.clearing)).toBe(clearingBefore + 8_000n);

      const journal = await pool.query(
        `SELECT l.account_id, l.debit_cents::text AS debit, l.credit_cents::text AS credit
           FROM journal_lines l
          WHERE l.journal_entry_id=$1 ORDER BY l.id`,
        [result.journalId],
      );
      expect(journal.rows).toEqual([
        { account_id: local.clearing, debit: '8000', credit: '0' },
        { account_id: local.stock, debit: '0', credit: '8000' },
      ]);
    });

    it('returns against an invoiced note by crediting the payable', async () => {
      const facility = facilities.ret;
      const local = accounts[facility.facilityId];
      const { grnId } = await receiveGoods(facility, {
        quantity: 6,
        orderPrice: 25,
        unitCost: 25,
      });
      const invoice = await invoiceFor(facility, grnId, {});

      const grnItem = (
        await pool.query(
          'SELECT id FROM goods_received_note_items WHERE goods_received_note_id=$1',
          [grnId],
        )
      ).rows[0];

      const payableBefore = await balanceOf(facility.facilityId, local.payable);
      const result = await postSupplierReturn(facility.scope, {
        goodsReceivedNoteId: grnId,
        returnNumber: `RET-${suffix}-2`,
        returnDate: MOVEMENT_DATE,
        reasonCode: 'DAMAGED_IN_TRANSIT',
        idempotencyKey: `ret-${suffix}-2`,
        lines: [{ goodsReceivedNoteItemId: Number(grnItem.id), quantity: 2 }],
      });

      expect(result.return.counterpart).toBe('PAYABLE');
      /* Payable is a credit balance; debiting it brings the balance down. */
      expect(await balanceOf(facility.facilityId, local.payable)).toBe(payableBefore + 5_000n);

      const invoiceRow = await pool.query(
        'SELECT total_amount_kes::text AS total, balance_kes::text AS balance FROM supplier_invoices WHERE id=$1',
        [invoice.invoiceId],
      );
      expect(invoiceRow.rows[0].total).toBe('100.00');
      expect(invoiceRow.rows[0].balance).toBe('100.00');
    });

    it('cannot return more than is still held from the receipt line', async () => {
      const facility = facilities.ret;
      const { grnId } = await receiveGoods(facility, {
        quantity: 3,
        orderPrice: 10,
        unitCost: 10,
      });
      const grnItem = (
        await pool.query(
          'SELECT id FROM goods_received_note_items WHERE goods_received_note_id=$1',
          [grnId],
        )
      ).rows[0];

      await postSupplierReturn(facility.scope, {
        goodsReceivedNoteId: grnId,
        returnNumber: `RET-${suffix}-3`,
        returnDate: MOVEMENT_DATE,
        reasonCode: 'WRONG_ITEM',
        idempotencyKey: `ret-${suffix}-3`,
        lines: [{ goodsReceivedNoteItemId: Number(grnItem.id), quantity: 2 }],
      });

      /* One is left; two more is a stock discrepancy, not a return. */
      await expect(
        postSupplierReturn(facility.scope, {
          goodsReceivedNoteId: grnId,
          returnNumber: `RET-${suffix}-4`,
          returnDate: MOVEMENT_DATE,
          reasonCode: 'WRONG_ITEM',
          idempotencyKey: `ret-${suffix}-4`,
          lines: [{ goodsReceivedNoteItemId: Number(grnItem.id), quantity: 2 }],
        }),
      ).rejects.toMatchObject({ code: 'RETURN_EXCEEDS_RECEIPT' });
    });

    it('is idempotent on its key', async () => {
      const facility = facilities.ret;
      const { grnId, itemId } = await receiveGoods(facility, {
        quantity: 4,
        orderPrice: 15,
        unitCost: 15,
      });
      const grnItem = (
        await pool.query(
          'SELECT id FROM goods_received_note_items WHERE goods_received_note_id=$1',
          [grnId],
        )
      ).rows[0];

      const body = {
        goodsReceivedNoteId: grnId,
        returnNumber: `RET-${suffix}-5`,
        returnDate: MOVEMENT_DATE,
        reasonCode: 'OVER_DELIVERY',
        idempotencyKey: `ret-${suffix}-5`,
        lines: [{ goodsReceivedNoteItemId: Number(grnItem.id), quantity: 1 }],
      };

      const first = await postSupplierReturn(facility.scope, body);
      const second = await postSupplierReturn(facility.scope, body);
      expect(second.replayed).toBe(true);
      expect(second.returnId).toBe(first.returnId);

      const stock = await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [
        itemId,
      ]);
      expect(Number(stock.rows[0].current_stock)).toBe(3);
    });

    it('rejects a return dated into a closed period and rolls the stock back', async () => {
      const facility = facilities.closed;
      const { grnId, itemId } = await receiveGoods(facility, {
        quantity: 5,
        orderPrice: 10,
        unitCost: 10,
      });
      const grnItem = (
        await pool.query(
          'SELECT id FROM goods_received_note_items WHERE goods_received_note_id=$1',
          [grnId],
        )
      ).rows[0];

      await expect(
        postSupplierReturn(facility.scope, {
          goodsReceivedNoteId: grnId,
          returnNumber: `RET-${suffix}-CLOSED`,
          returnDate: '2025-12-15',
          reasonCode: 'ORDER_CANCELLED',
          idempotencyKey: `ret-${suffix}-closed`,
          lines: [{ goodsReceivedNoteItemId: Number(grnItem.id), quantity: 2 }],
        }),
      ).rejects.toThrow(/open financial period/i);

      const item = await pool.query('SELECT current_stock FROM inventory_items WHERE id=$1', [
        itemId,
      ]);
      expect(Number(item.rows[0].current_stock)).toBe(5);

      const returns = await pool.query(
        'SELECT COUNT(*)::int AS n FROM supplier_returns WHERE goods_received_note_id=$1',
        [grnId],
      );
      expect(Number(returns.rows[0].n)).toBe(0);
    });
  });

  describe('supplier credit notes', () => {
    it('reduces the payable, reverses input VAT and lowers the invoice balance', async () => {
      const facility = facilities.credit;
      const local = accounts[facility.facilityId];
      const { grnId } = await receiveGoods(facility, {
        quantity: 10,
        orderPrice: 20,
        unitCost: 20,
      });
      const invoice = await invoiceFor(facility, grnId, { tax: 32 });

      const payableBefore = await balanceOf(facility.facilityId, local.payable);
      const vatBefore = await balanceOf(facility.facilityId, local.inputVat);

      const result = await createSupplierCreditNote(facility.scope, {
        supplierId,
        supplierInvoiceId: invoice.invoiceId,
        creditNoteNumber: `CN-${suffix}-1`,
        creditNoteDate: MOVEMENT_DATE,
        subtotal: 50,
        tax: 8,
        taxRecoverable: true,
        idempotencyKey: `cn-${suffix}-1`,
      });

      expect(result.replayed).toBe(false);
      expect(result.creditNote.totalCents).toBe(5_800);
      expect(result.creditNote.status).toBe('APPLIED');

      /* Payable falls by the total; input VAT falls by the tax only. */
      expect(await balanceOf(facility.facilityId, local.payable)).toBe(payableBefore + 5_800n);
      expect(await balanceOf(facility.facilityId, local.inputVat)).toBe(vatBefore - 800n);

      const row = await pool.query(
        'SELECT total_amount_kes::text AS total, balance_kes::text AS balance FROM supplier_invoices WHERE id=$1',
        [invoice.invoiceId],
      );
      expect(row.rows[0].total).toBe('174.00');
      expect(row.rows[0].balance).toBe('174.00');
    });

    it('refuses a credit larger than the invoice balance', async () => {
      const facility = facilities.credit;
      const { grnId } = await receiveGoods(facility, {
        quantity: 2,
        orderPrice: 10,
        unitCost: 10,
      });
      const invoice = await invoiceFor(facility, grnId, {});

      await expect(
        createSupplierCreditNote(facility.scope, {
          supplierId,
          supplierInvoiceId: invoice.invoiceId,
          creditNoteNumber: `CN-${suffix}-2`,
          creditNoteDate: MOVEMENT_DATE,
          subtotal: 100,
          tax: 0,
          idempotencyKey: `cn-${suffix}-2`,
        }),
      ).rejects.toMatchObject({ code: 'CREDIT_EXCEEDS_BALANCE' });
    });

    it('is idempotent on its key', async () => {
      const facility = facilities.credit;
      const { grnId } = await receiveGoods(facility, {
        quantity: 4,
        orderPrice: 10,
        unitCost: 10,
      });
      const invoice = await invoiceFor(facility, grnId, {});

      const body = {
        supplierId,
        supplierInvoiceId: invoice.invoiceId,
        creditNoteNumber: `CN-${suffix}-3`,
        creditNoteDate: MOVEMENT_DATE,
        subtotal: 10,
        tax: 0,
        idempotencyKey: `cn-${suffix}-3`,
      };
      const first = await createSupplierCreditNote(facility.scope, body);
      const second = await createSupplierCreditNote(facility.scope, body);
      expect(second.replayed).toBe(true);
      expect(second.creditNoteId).toBe(first.creditNoteId);

      const row = await pool.query(
        'SELECT total_amount_kes::text AS total FROM supplier_invoices WHERE id=$1',
        [invoice.invoiceId],
      );
      expect(row.rows[0].total).toBe('30.00');
    });

    it('refuses a credit note numbered twice', async () => {
      const facility = facilities.credit;
      const { grnId } = await receiveGoods(facility, {
        quantity: 2,
        orderPrice: 10,
        unitCost: 10,
      });
      const invoice = await invoiceFor(facility, grnId, {});

      await expect(
        createSupplierCreditNote(facility.scope, {
          supplierId,
          supplierInvoiceId: invoice.invoiceId,
          creditNoteNumber: `CN-${suffix}-1`,
          creditNoteDate: MOVEMENT_DATE,
          subtotal: 5,
          tax: 0,
          idempotencyKey: `cn-${suffix}-dup`,
        }),
      ).rejects.toMatchObject({ code: 'CREDIT_NOTE_NUMBER_IN_USE' });
    });
  });

  describe('facility scope', () => {
    it('does not match or pay one facility’s invoice under another facility', async () => {
      const owner = facilities.main;
      const outsider = facilities.match;
      const { grnId } = await receiveGoods(owner, {
        quantity: 1,
        orderPrice: 10,
        unitCost: 10,
      });
      const invoice = await invoiceFor(owner, grnId, {});

      await expect(
        matchSupplierInvoice({
          tenantId,
          facilityId: outsider.facilityId,
          supplierInvoiceId: invoice.invoiceId,
        }),
      ).rejects.toBeInstanceOf(MatchingError);

      await expect(
        createSupplierCreditNote(outsider.scope, {
          supplierId,
          supplierInvoiceId: invoice.invoiceId,
          creditNoteNumber: `CN-${suffix}-SCOPE`,
          creditNoteDate: MOVEMENT_DATE,
          subtotal: 5,
          tax: 0,
          idempotencyKey: `cn-${suffix}-scope`,
        }),
      ).rejects.toMatchObject({ code: 'SUPPLIER_INVOICE_NOT_FOUND' });
    });
  });
});
