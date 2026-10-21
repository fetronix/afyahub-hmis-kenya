/**
 * JaliCare HMIS
 * Payment settlement — mobile money capture and overpayment handling
 *
 * What a clerk knows when the phone buzzes is two things: how much came
 * in, and the code Safaricom printed. These tests pin what the system
 * does with them.
 *
 * The rules being protected:
 *
 *   1. Money is integer cents. 0.1 + 0.2 is 30 cents, not 0.30000000000000004.
 *   2. A payment that clears the balance says so; one that leaves a
 *      balance says so; one that overpays says so.
 *   3. Overpayment is surfaced, never absorbed into a negative balance.
 *   4. A transaction code is a real code from the customer's message, not
 *      something the till invented.
 *   5. The same M-Pesa code cannot be receipted twice.
 *
 * Run with: npx tsx src/tests/payments.test.ts
 */

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

let checks = 0;

function assert(condition: boolean, label: string): void {
  checks += 1;

  if (!condition) {
    throw new Error(`FAILED: ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(
    actual === expected,
    `${label} (expected ${String(expected)}, got ${String(actual)})`,
  );
}

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

/* ============================================================
   1. MONEY PARSING
   ============================================================ */

function testMoneyParsing(): void {
  assertEqual(parseMoneyToCents('100'), 10_000, 'whole shillings');
  assertEqual(parseMoneyToCents('100.50'), 10_050, 'shillings and cents');
  assertEqual(parseMoneyToCents('0.05'), 5, 'five cents');
  assertEqual(parseMoneyToCents('.50'), null, 'a bare decimal is rejected');
  assertEqual(parseMoneyToCents('100.555'), null, 'three decimals rejected');
  assertEqual(parseMoneyToCents('1,000'), null, 'thousands separators rejected');
  assertEqual(parseMoneyToCents('KES 100'), null, 'currency prefix rejected');
  assertEqual(parseMoneyToCents(''), null, 'empty rejected');
  assertEqual(parseMoneyToCents(null), null, 'null rejected');
  assertEqual(parseMoneyToCents(-100), -10_000, 'negatives parse (and are refused later)');

  assertEqual(formatCents(10_000), '100.00', 'cents format with two decimals');
  assertEqual(formatCents(5), '0.05', 'five cents formats as 0.05');
  assertEqual(formatCents(-250), '-2.50', 'negatives format with sign');

  /* The classic float trap: 0.1 + 0.2 must be exactly 30 cents. */
  const tenth = parseMoneyToCents('0.10') ?? 0;
  const fifth = parseMoneyToCents('0.20') ?? 0;
  assertEqual(tenth + fifth, 30, '0.10 + 0.20 is exactly 30 cents');
}

/* ============================================================
   2. SETTLEMENT CLASSIFICATION
   ============================================================ */

function testSettlement(): void {
  /* Bill 1,200. Pay the whole thing. */
  const exact = classifySettlement({
    invoiceTotalCents: 120_000,
    paidBeforeCents: 0,
    amountCents: 120_000,
  });

  assertEqual(exact.outcome, 'FULLY_PAID', 'exact payment is fully paid');
  assertEqual(exact.balanceAfterCents, 0, 'nothing left owing');
  assertEqual(exact.creditCents, 0, 'no credit');
  assertEqual(exact.invoiceStatus, 'Paid', 'invoice marked Paid');

  /* Bill 1,200. Pay 500. */
  const partial = classifySettlement({
    invoiceTotalCents: 120_000,
    paidBeforeCents: 0,
    amountCents: 50_000,
  });

  assertEqual(partial.outcome, 'BALANCE_REMAINING', 'short payment leaves a balance');
  assertEqual(partial.balanceAfterCents, 70_000, '700 still owing');
  assertEqual(partial.invoiceStatus, 'Partially Paid', 'invoice marked Partially Paid');
  assert(partial.summary.includes('700.00'), 'summary states the remaining balance');

  /* Bill 1,200. Pay 1,500. */
  const over = classifySettlement({
    invoiceTotalCents: 120_000,
    paidBeforeCents: 0,
    amountCents: 150_000,
  });

  assertEqual(over.outcome, 'OVERPAID', 'overshoot is overpaid');
  assertEqual(over.creditCents, 30_000, '300 comes back as credit');
  assertEqual(over.balanceAfterCents, 0, 'balance does not go negative');
  assertEqual(over.invoiceStatus, 'Overpaid', 'invoice marked Overpaid');

  /* Finishing a partially paid invoice. */
  const remaining = classifySettlement({
    invoiceTotalCents: 120_000,
    paidBeforeCents: 70_000,
    amountCents: 50_000,
  });

  assertEqual(remaining.outcome, 'FULLY_PAID', 'clearing the balance is fully paid');
  assertEqual(remaining.balanceBeforeCents, 50_000, 'balance before is 500');

  /* One shilling over is still an overpayment, not "close enough". */
  const oneOver = classifySettlement({
    invoiceTotalCents: 10_000,
    paidBeforeCents: 0,
    amountCents: 10_100,
  });

  assertEqual(oneOver.outcome, 'OVERPAID', 'one shilling over is still overpaid');
  assertEqual(oneOver.creditCents, 100, 'credit is one shilling');

  /* Zero-value invoice: any payment is credit. */
  const empty = classifySettlement({
    invoiceTotalCents: 0,
    paidBeforeCents: 0,
    amountCents: 5_000,
  });

  assertEqual(empty.outcome, 'OVERPAID', 'paying a zero bill is credit');
  assertEqual(empty.creditCents, 5_000, 'the whole payment is credit');
}

function testChargeStatus(): void {
  assertEqual(invoiceStatusAfterCharge(10_000, 0), 'Unpaid', 'a new charge is unpaid');
  assertEqual(invoiceStatusAfterCharge(10_000, 4_000), 'Partially Paid', 'part paid');
  assertEqual(invoiceStatusAfterCharge(10_000, 10_000), 'Paid', 'exactly paid');
  assertEqual(invoiceStatusAfterCharge(10_000, 12_000), 'Overpaid', 'paid beyond the total');

  /*
   * A zero-value invoice is not "Paid" — nothing has been billed, so it
   * must not read as settled.
   */
  assertEqual(invoiceStatusAfterCharge(0, 0), 'Unpaid', 'a zero bill is not Paid');
}

/* ============================================================
   3. TRANSACTION CODES
   ============================================================ */

function testTransactionCodes(): void {
  assert(isMobileMoney('M-Pesa'), 'M-Pesa is mobile money');
  assert(isMobileMoney('Airtel Money'), 'Airtel is mobile money');
  assert(!isMobileMoney('Cash'), 'cash is not mobile money');
  assert(!isMobileMoney('Card'), 'card is not mobile money');

  /* Real M-Pesa shape: two letters, then eight alphanumerics. */
  assert(validateTransactionCode('M-Pesa', 'QGH4XYZ123').valid, 'a real M-Pesa code passes');
  assert(validateTransactionCode('M-Pesa', 'sgh7x1a2b3').valid, 'lowercase is accepted');
  assertEqual(
    validateTransactionCode('M-Pesa', 'sgh7x1a2b3').code,
    'SGH7X1A2B3',
    'codes are normalised to uppercase',
  );

  /* The till must not invent a code. */
  assert(
    !validateTransactionCode('M-Pesa', 'MPESA-ABC123').valid,
    'an invented MPESA- prefixed reference is rejected',
  );
  assert(
    !validateTransactionCode('M-Pesa', 'REF-123').valid,
    'a made-up reference with dashes is rejected',
  );
  assert(!validateTransactionCode('M-Pesa', '').valid, 'an empty code is rejected');
  assert(!validateTransactionCode('M-Pesa', 'QGH4 XYZ123').valid, 'spaces are rejected');
  assert(
    !validateTransactionCode('M-Pesa', 'QGH4XYZ12').valid,
    'a 9-character code is rejected',
  );
  assert(
    !validateTransactionCode('M-Pesa', 'QGH4XYZ1234').valid,
    'an 11-character code is rejected',
  );
  assert(
    !validateTransactionCode('M-Pesa', '1GH4XYZ123').valid,
    'a code not starting with two letters is rejected',
  );

  assert(
    validateTransactionCode('Airtel Money', 'MP1234567890').valid,
    'an Airtel code passes',
  );
  assert(
    !validateTransactionCode('Airtel Money', 'ABCDEFGH').valid,
    'an Airtel code with no digit is rejected',
  );

  /* Cash carries no code, and asking for one is a mistake. */
  assert(validateTransactionCode('Cash', '').valid, 'cash needs no code');
}

/* ============================================================
   4. WIRING
   ============================================================ */

function testWiring(): void {
  const app = readRepoFile('src/app.ts');

  const postIndex = app.indexOf("'/api/billing/payments',");
  assert(postIndex > -1, 'the payment route is registered');

  const postWindow = app.slice(postIndex, postIndex + 1200);
  assert(
    postWindow.includes("requirePermission('billing.payments.record')"),
    'posting a payment requires billing.payments.record',
  );
  assert(
    postWindow.includes('recordSettledPayment'),
    'the route uses the settlement service',
  );

  const ledgerIndex = app.indexOf("'/api/billing/payments',", postIndex + 1);
  assert(ledgerIndex > -1, 'a payment ledger route exists for reconciliation');
  assert(
    app.slice(ledgerIndex, ledgerIndex + 900).includes('getPaymentLedgerScoped'),
    'the ledger uses the scoped service',
  );

  const schema = readRepoFile('src/db/schema.ts');
  assert(schema.includes("transactionCode: text('transaction_code')"), 'payments store a transaction code');
  assert(schema.includes("settlementStatus: text('settlement_status')"), 'payments store the settlement outcome');
  assert(schema.includes("creditBalance: numeric("), 'invoices carry a credit balance');

  const migration = readRepoFile('drizzle/0010_mobile_money_settlement.sql');
  assert(
    migration.includes('billing_payments_transaction_code_unique'),
    'the migration adds the duplicate-code index',
  );
  assert(migration.includes('billing_receipt_seq'), 'the migration adds the receipt sequence');
  assert(
    migration.includes('lower("transaction_code")'),
    'codes are compared case-insensitively',
  );
  assert(
    migration.includes('WHERE "transaction_code" IS NOT NULL'),
    'the index is partial so cash payments are unaffected',
  );

  /* No BOM anywhere in the migration files: it broke 0008 once. */
  const journal = JSON.parse(readRepoFile('drizzle/meta/_journal.json')) as {
    entries: Array<{ tag: string }>;
  };

  for (const entry of journal.entries) {
    const sql = readFileSync(resolve(process.cwd(), 'drizzle', `${entry.tag}.sql`), 'utf8');
    assert(
      sql.charCodeAt(0) !== 0xfeff,
      `${entry.tag} must not start with a UTF-8 BOM`,
    );
  }

  const ui = readRepoFile('src/components/modules/BillingCashierModule.tsx');
  assert(ui.includes('validateTransactionCode'), 'the cashier screen validates the code');
  assert(ui.includes('classifySettlement'), 'the cashier screen previews the outcome');
  assert(
    !ui.includes('Simulate STK'),
    'the fake STK-push button is gone',
  );
  assert(
    !ui.includes('MPESA-${Math.random()'),
    'the till no longer invents M-Pesa references',
  );
}

/* ============================================================
   RUN
   ============================================================ */

function run(): void {
  console.log('');
  console.log('PAYMENT SETTLEMENT TESTS');
  console.log('==============================================');

  testMoneyParsing();
  console.log('  1. Money is parsed and formatted in cents');

  testSettlement();
  console.log('  2. Fully paid, balance remaining and overpaid are distinguished');

  testChargeStatus();
  console.log('  3. Invoice status follows the money');

  testTransactionCodes();
  console.log('  4. Transaction codes must be real codes');

  testWiring();
  console.log('  5. Routes, schema and screens are wired');

  console.log('');
  console.log('==============================================');
  console.log(`PAYMENT SETTLEMENT TESTS PASSED (${checks} assertions)`);
  console.log('==============================================');
  console.log('');
}

try {
  run();
} catch (error) {
  console.error('');
  console.error('==============================================');
  console.error('PAYMENT SETTLEMENT TESTS FAILED');
  console.error('==============================================');
  console.error(error);
  process.exit(1);
}
