import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classifySettlement,
  formatCents,
  invoiceStatusAfterCharge,
  isMobileMoney,
  parseMoneyToCents,
  validateTransactionCode,
} from '../billing/settlement.ts';
import { schemaSource } from './support/schema-source.ts';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('Payment settlement — mobile money capture and overpayment handling', () => {
  it('1. MONEY PARSING', async () => {
    expect(parseMoneyToCents('100'), 'whole shillings').toBe(10_000);
    expect(parseMoneyToCents('100.50'), 'shillings and cents').toBe(10_050);
    expect(parseMoneyToCents('0.05'), 'five cents').toBe(5);
    expect(parseMoneyToCents('.50'), 'a bare decimal is rejected').toBe(null);
    expect(parseMoneyToCents('100.555'), 'three decimals rejected').toBe(null);
    expect(parseMoneyToCents('1,000'), 'thousands separators rejected').toBe(null);
    expect(parseMoneyToCents('KES 100'), 'currency prefix rejected').toBe(null);
    expect(parseMoneyToCents(''), 'empty rejected').toBe(null);
    expect(parseMoneyToCents(null), 'null rejected').toBe(null);
    expect(parseMoneyToCents(-100), 'negatives parse (and are refused later)').toBe(-10_000);

    expect(formatCents(10_000), 'cents format with two decimals').toBe('100.00');
    expect(formatCents(5), 'five cents formats as 0.05').toBe('0.05');
    expect(formatCents(-250), 'negatives format with sign').toBe('-2.50');

    /* The classic float trap: 0.1 + 0.2 must be exactly 30 cents. */
    const tenth = parseMoneyToCents('0.10') ?? 0;
    const fifth = parseMoneyToCents('0.20') ?? 0;
    expect(tenth + fifth, '0.10 + 0.20 is exactly 30 cents').toBe(30);
  });

  it('2. SETTLEMENT CLASSIFICATION', async () => {
    /* Bill 1,200. Pay the whole thing. */
    const exact = classifySettlement({
      invoiceTotalCents: 120_000,
      paidBeforeCents: 0,
      amountCents: 120_000,
    });

    expect(exact.outcome, 'exact payment is fully paid').toBe('FULLY_PAID');
    expect(exact.balanceAfterCents, 'nothing left owing').toBe(0);
    expect(exact.creditCents, 'no credit').toBe(0);
    expect(exact.invoiceStatus, 'invoice marked Paid').toBe('Paid');

    /* Bill 1,200. Pay 500. */
    const partial = classifySettlement({
      invoiceTotalCents: 120_000,
      paidBeforeCents: 0,
      amountCents: 50_000,
    });

    expect(partial.outcome, 'short payment leaves a balance').toBe('BALANCE_REMAINING');
    expect(partial.balanceAfterCents, '700 still owing').toBe(70_000);
    expect(partial.invoiceStatus, 'invoice marked Partially Paid').toBe('Partially Paid');
    expect(partial.summary.includes('700.00'), 'summary states the remaining balance').toBe(true);

    /* Bill 1,200. Pay 1,500. */
    const over = classifySettlement({
      invoiceTotalCents: 120_000,
      paidBeforeCents: 0,
      amountCents: 150_000,
    });

    expect(over.outcome, 'overshoot is overpaid').toBe('OVERPAID');
    expect(over.creditCents, '300 comes back as credit').toBe(30_000);
    expect(over.balanceAfterCents, 'balance does not go negative').toBe(0);
    expect(over.invoiceStatus, 'invoice marked Overpaid').toBe('Overpaid');

    /* Finishing a partially paid invoice. */
    const remaining = classifySettlement({
      invoiceTotalCents: 120_000,
      paidBeforeCents: 70_000,
      amountCents: 50_000,
    });

    expect(remaining.outcome, 'clearing the balance is fully paid').toBe('FULLY_PAID');
    expect(remaining.balanceBeforeCents, 'balance before is 500').toBe(50_000);

    /* One shilling over is still an overpayment, not "close enough". */
    const oneOver = classifySettlement({
      invoiceTotalCents: 10_000,
      paidBeforeCents: 0,
      amountCents: 10_100,
    });

    expect(oneOver.outcome, 'one shilling over is still overpaid').toBe('OVERPAID');
    expect(oneOver.creditCents, 'credit is one shilling').toBe(100);

    /* Zero-value invoice: any payment is credit. */
    const empty = classifySettlement({
      invoiceTotalCents: 0,
      paidBeforeCents: 0,
      amountCents: 5_000,
    });

    expect(empty.outcome, 'paying a zero bill is credit').toBe('OVERPAID');
    expect(empty.creditCents, 'the whole payment is credit').toBe(5_000);
  });

  it('Charge Status', async () => {
    expect(invoiceStatusAfterCharge(10_000, 0), 'a new charge is unpaid').toBe('Unpaid');
    expect(invoiceStatusAfterCharge(10_000, 4_000), 'part paid').toBe('Partially Paid');
    expect(invoiceStatusAfterCharge(10_000, 10_000), 'exactly paid').toBe('Paid');
    expect(invoiceStatusAfterCharge(10_000, 12_000), 'paid beyond the total').toBe('Overpaid');

    /*
     * A zero-value invoice is not "Paid" — nothing has been billed, so it
     * must not read as settled.
     */
    expect(invoiceStatusAfterCharge(0, 0), 'a zero bill is not Paid').toBe('Unpaid');
  });

  it('3. TRANSACTION CODES', async () => {
    expect(isMobileMoney('M-Pesa'), 'M-Pesa is mobile money').toBe(true);
    expect(isMobileMoney('Airtel Money'), 'Airtel is mobile money').toBe(true);
    expect(!isMobileMoney('Cash'), 'cash is not mobile money').toBe(true);
    expect(!isMobileMoney('Card'), 'card is not mobile money').toBe(true);

    /* Real M-Pesa shape: two letters, then eight alphanumerics. */
    expect(validateTransactionCode('M-Pesa', 'QGH4XYZ123').valid, 'a real M-Pesa code passes').toBe(
      true,
    );
    expect(validateTransactionCode('M-Pesa', 'sgh7x1a2b3').valid, 'lowercase is accepted').toBe(
      true,
    );
    expect(
      validateTransactionCode('M-Pesa', 'sgh7x1a2b3').code,
      'codes are normalised to uppercase',
    ).toBe('SGH7X1A2B3');

    /* The till must not invent a code. */
    expect(
      !validateTransactionCode('M-Pesa', 'MPESA-ABC123').valid,
      'an invented MPESA- prefixed reference is rejected',
    ).toBe(true);
    expect(
      !validateTransactionCode('M-Pesa', 'REF-123').valid,
      'a made-up reference with dashes is rejected',
    ).toBe(true);
    expect(!validateTransactionCode('M-Pesa', '').valid, 'an empty code is rejected').toBe(true);
    expect(!validateTransactionCode('M-Pesa', 'QGH4 XYZ123').valid, 'spaces are rejected').toBe(
      true,
    );
    expect(
      !validateTransactionCode('M-Pesa', 'QGH4XYZ12').valid,
      'a 9-character code is rejected',
    ).toBe(true);
    expect(
      !validateTransactionCode('M-Pesa', 'QGH4XYZ1234').valid,
      'an 11-character code is rejected',
    ).toBe(true);
    expect(
      !validateTransactionCode('M-Pesa', '1GH4XYZ123').valid,
      'a code not starting with two letters is rejected',
    ).toBe(true);

    expect(
      validateTransactionCode('Airtel Money', 'MP1234567890').valid,
      'an Airtel code passes',
    ).toBe(true);
    expect(
      !validateTransactionCode('Airtel Money', 'ABCDEFGH').valid,
      'an Airtel code with no digit is rejected',
    ).toBe(true);

    /* Cash carries no code, and asking for one is a mistake. */
    expect(validateTransactionCode('Cash', '').valid, 'cash needs no code').toBe(true);
  });

  it('4. WIRING', async () => {
    const app = readRepoFile('src/app.ts');

    const postIndex = app.indexOf("'/api/billing/payments',");
    expect(postIndex > -1, 'the payment route is registered').toBe(true);

    const postWindow = app.slice(postIndex, postIndex + 1200);
    expect(
      postWindow.includes("requirePermission('billing.payments.record')"),
      'posting a payment requires billing.payments.record',
    ).toBe(true);
    expect(
      postWindow.includes('recordSettledPayment'),
      'the route uses the settlement service',
    ).toBe(true);

    const ledgerIndex = app.indexOf("'/api/billing/payments',", postIndex + 1);
    expect(ledgerIndex > -1, 'a payment ledger route exists for reconciliation').toBe(true);
    expect(
      app.slice(ledgerIndex, ledgerIndex + 900).includes('getPaymentLedgerScoped'),
      'the ledger uses the scoped service',
    ).toBe(true);

    const schema = schemaSource();
    expect(
      schema.includes("transactionCode: text('transaction_code')"),
      'payments store a transaction code',
    ).toBe(true);
    expect(
      schema.includes("settlementStatus: text('settlement_status')"),
      'payments store the settlement outcome',
    ).toBe(true);
    expect(schema.includes('creditBalance: numeric('), 'invoices carry a credit balance').toBe(
      true,
    );

    const migration = readRepoFile('drizzle/0010_mobile_money_settlement.sql');
    expect(
      migration.includes('billing_payments_transaction_code_unique'),
      'the migration adds the duplicate-code index',
    ).toBe(true);
    expect(
      migration.includes('billing_receipt_seq'),
      'the migration adds the receipt sequence',
    ).toBe(true);
    expect(
      migration.includes('lower("transaction_code")'),
      'codes are compared case-insensitively',
    ).toBe(true);
    expect(
      migration.includes('WHERE "transaction_code" IS NOT NULL'),
      'the index is partial so cash payments are unaffected',
    ).toBe(true);

    /* No BOM anywhere in the migration files: it broke 0008 once. */
    const journal = JSON.parse(readRepoFile('drizzle/meta/_journal.json')) as {
      entries: Array<{ tag: string }>;
    };

    for (const entry of journal.entries) {
      const sql = readFileSync(resolve(process.cwd(), 'drizzle', `${entry.tag}.sql`), 'utf8');
      expect(sql.charCodeAt(0) !== 0xfeff, `${entry.tag} must not start with a UTF-8 BOM`).toBe(
        true,
      );
    }

    const ui = readRepoFile('src/components/modules/BillingCashierModule.tsx');
    expect(ui.includes('validateTransactionCode'), 'the cashier screen validates the code').toBe(
      true,
    );
    expect(ui.includes('classifySettlement'), 'the cashier screen previews the outcome').toBe(true);
    expect(!ui.includes('Simulate STK'), 'the fake STK-push button is gone').toBe(true);
    expect(
      !ui.includes('MPESA-${Math.random()'),
      'the till no longer invents M-Pesa references',
    ).toBe(true);
  });
});
