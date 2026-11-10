/**
 * Synthetic procurement journey (development only).
 *
 * Exercises the real HTTP endpoints end to end:
 *   requisition → approval (with self-approval refusal) → purchase order
 *   → goods received note (with over-receipt refusal) → supplier invoice
 *   → part payment → over-payment refusal → settlement → ledger check.
 *
 * Requires the synthetic procurement fixture, a running app and a synthetic
 * database. It never touches production data and prints no passwords.
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
for (const key of ['SYNTH_PROCUREMENT_PASSWORD', 'SYNTH_PROCUREMENT_APPROVER_PASSWORD']) {
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
const resultsFile = '/tmp/procurement-journey-report.json';

const pool = new pg.Pool({
  host: process.env.SQL_HOST,
  port: Number(process.env.SQL_PORT),
  database,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD,
  ssl: false,
});

try {
  const requester = await login('synthetic.procurement', process.env.SYNTH_PROCUREMENT_PASSWORD);
  const approver = await login(
    'synthetic.procurement.approver',
    process.env.SYNTH_PROCUREMENT_APPROVER_PASSWORD,
  );
  const facilityId = approver.body.user.facilityId;
  record('Synthetic accounts sign in', true, `facility ${facilityId}`);

  // Resolve the fixture's posting accounts from the facility chart rather than
  // hard-coding ids that a fresh database will not reproduce.
  const chart = await call(approver, 'GET', `/api/accounting/accounts?facilityId=${facilityId}`);
  const expenses = (chart.body?.accounts ?? []).filter((a) => a.accountType === 'EXPENSE');
  const payables = (chart.body?.accounts ?? []).filter((a) => a.accountType === 'LIABILITY');
  const accounts = { expense: expenses[0]?.id, payable: payables[0]?.id };
  record(
    'The chart of accounts is readable for posting',
    Boolean(accounts.expense && accounts.payable),
    `${expenses.length} expense, ${payables.length} liability`,
  );

  // ---- Requisition ------------------------------------------------------
  const created = await call(requester, 'POST', '/api/procurement/requisitions', {
    requisitionNumber: `REQ-JOURNEY-${stamp}`,
    requestDate: '2026-11-05',
    neededBy: '2026-11-30',
    department: 'Clinical services',
    justification: 'Synthetic restock requested by the journey script. Not a real purchase.',
    items: [
      {
        description: 'Synthetic examination gloves',
        quantity: '10',
        unit: 'box',
        estimatedUnitPrice: '1200.00',
      },
      {
        description: 'Synthetic sharps containers',
        quantity: '20',
        unit: 'unit',
        estimatedUnitPrice: '600.00',
      },
    ],
  });
  record(
    'Requisition is created as a draft',
    created.status === 201 && created.body.status === 'DRAFT',
  );
  const requisitionId = created.body.id;
  record(
    'Requisition total is computed from its lines',
    String(created.body.estimatedTotalKes) === '24000.00',
    `KES ${created.body.estimatedTotalKes}`,
  );

  const submitted = await call(
    requester,
    'POST',
    `/api/procurement/requisitions/${requisitionId}/submit`,
  );
  record(
    'Requester submits the requisition',
    submitted.status === 200 && submitted.body.status === 'SUBMITTED',
  );

  const selfApprove = await call(
    requester,
    'POST',
    `/api/procurement/requisitions/${requisitionId}/approve`,
  );
  record(
    'The requester cannot approve their own request',
    selfApprove.status === 403 &&
      ['REQUISITION_SELF_APPROVAL', 'FORBIDDEN'].includes(selfApprove.body?.error),
    `${selfApprove.status} ${selfApprove.body?.error ?? ''}`,
  );

  const approved = await call(
    approver,
    'POST',
    `/api/procurement/requisitions/${requisitionId}/approve`,
    { note: 'Synthetic approval by an independent approver.' },
  );
  record(
    'An independent approver approves',
    approved.status === 200 && approved.body.status === 'APPROVED',
  );

  const converted = await call(
    approver,
    'POST',
    `/api/procurement/requisitions/${requisitionId}/convert`,
    { supplierId: 1 },
  );
  record(
    'Approved requisition becomes a purchase order',
    converted.status === 200 && Number(converted.body.purchaseOrderId) > 0,
    `order ${converted.body?.purchaseOrderId}`,
  );
  const convertedOrderId = converted.body.purchaseOrderId;

  const convertedAgain = await call(
    approver,
    'POST',
    `/api/procurement/requisitions/${requisitionId}/convert`,
    { supplierId: 1 },
  );
  record(
    'A retried conversion reuses the same order',
    convertedAgain.status === 200 &&
      convertedAgain.body.purchaseOrderId === convertedOrderId &&
      convertedAgain.body.idempotentReplay === true,
  );

  const orderDetail = await call(approver, 'GET', `/api/purchase-orders/${convertedOrderId}`);
  record(
    'The purchase order awaits approval, not auto-approved',
    orderDetail.status === 200 && orderDetail.body.status === 'Pending Approval',
    orderDetail.body?.status,
  );

  // The purchase-order API is optimistic: approval must name the revision the
  // approver reviewed, so a concurrent edit cannot be silently overwritten.
  const orderApproval = await call(
    approver,
    'POST',
    `/api/purchase-orders/${convertedOrderId}/approve`,
    { expectedRevision: orderDetail.body.revision },
  );
  record(
    'The converted order can be approved',
    orderApproval.status === 200 &&
      ['Approved', 'APPROVED'].includes(
        String(orderApproval.body?.status ?? orderApproval.body?.order?.status),
      ),
    `status ${orderApproval.body?.status ?? orderApproval.body?.order?.status}`,
  );

  // ---- Goods received ---------------------------------------------------
  const outstanding = await call(
    approver,
    'GET',
    `/api/procurement/purchase-orders/${convertedOrderId}/outstanding`,
  );
  record(
    'Outstanding order lines are reported',
    outstanding.status === 200 &&
      outstanding.body.lines.every((line) => line.outstandingQuantity >= 0),
    `${outstanding.body?.lines?.length ?? 0} line(s)`,
  );
  const lines = outstanding.body.lines;

  const grnNumber = `GRN-JOURNEY-${stamp}`;
  const receipt = await call(approver, 'POST', '/api/procurement/goods-received', {
    purchaseOrderId: convertedOrderId,
    grnNumber,
    receivedDate: '2026-11-06',
    idempotencyKey: `grn:${convertedOrderId}:${grnNumber}`,
    notes: 'Synthetic delivery recorded by the journey script.',
    lines: lines.map((line, index) => ({
      purchaseOrderItemId: line.id,
      quantityReceived: index === 0 ? '6' : '5',
      unitCost: line.unitPrice,
    })),
  });
  record(
    'Goods received note posts and leaves the order partially received',
    receipt.status === 201 && receipt.body.status === 'Partially Received',
    `status ${receipt.body?.status}`,
  );
  const grnId = receipt.body.id;

  const overReceipt = await call(approver, 'POST', '/api/procurement/goods-received', {
    purchaseOrderId: convertedOrderId,
    grnNumber: `GRN-OVER-${stamp}`,
    receivedDate: '2026-11-06',
    idempotencyKey: `grn-over:${convertedOrderId}:${stamp}`,
    lines: [
      { purchaseOrderItemId: lines[0].id, quantityReceived: '999', unitCost: lines[0].unitPrice },
    ],
  });
  record(
    'Receiving more than outstanding is refused',
    overReceipt.status === 409 && overReceipt.body.error === 'OVER_RECEIPT',
    `${overReceipt.status} ${overReceipt.body?.error ?? ''}`,
  );

  const replay = await call(approver, 'POST', '/api/procurement/goods-received', {
    purchaseOrderId: convertedOrderId,
    grnNumber,
    receivedDate: '2026-11-06',
    idempotencyKey: `grn:${convertedOrderId}:${grnNumber}`,
    lines: lines.map((line, index) => ({
      purchaseOrderItemId: line.id,
      quantityReceived: index === 0 ? '6' : '5',
      unitCost: line.unitPrice,
    })),
  });
  record(
    'A repeated receipt with the same GRN reuses the note',
    replay.status === 201 && replay.body.id === grnId && replay.body.replayed === true,
  );

  // ---- Invoice and payment ---------------------------------------------
  const invoiceNumber = `SINV-${stamp}`;
  const invoice = await call(approver, 'POST', '/api/procurement/supplier-invoices', {
    goodsReceivedNoteId: grnId,
    invoiceNumber,
    invoiceDate: '2026-11-07',
    dueDate: '2026-12-07',
    expenseAccountId: accounts.expense,
    apAccountId: accounts.payable,
    taxAmount: '240.00',
    idempotencyKey: `invoice:${grnId}`,
  });
  record(
    'Supplier invoice posts against the note',
    invoice.status === 201 && invoice.body.invoice.status === 'POSTED',
    `invoice ${invoice.body?.invoiceId}`,
  );
  const invoiceId = invoice.body.invoiceId;
  record(
    'Invoice carries goods value plus tax as its balance',
    Math.round(Number(invoice.body.invoice.balanceKes) * 100) ===
      Math.round(Number(receipt.body.note.inventoryValueKes) * 100) + 24000,
    `balance KES ${invoice.body.invoice.balanceKes}`,
  );

  const banks = await call(approver, 'GET', `/api/accounting/bank?facilityId=${facilityId}`);
  const bankAccount = banks.body?.accounts?.[0];
  record('A synthetic bank account is available', Boolean(bankAccount), bankAccount?.accountName);

  const partPayment = await call(
    approver,
    'POST',
    `/api/procurement/supplier-invoices/${invoiceId}/payments`,
    {
      amount: '10000.00',
      paymentDate: '2026-11-08',
      bankAccountId: bankAccount.id,
      paymentMethod: 'BANK',
      paymentReference: `SYNTH-${stamp}`,
      idempotencyKey: `pay-part:${invoiceId}`,
    },
  );
  record(
    'A part payment leaves the invoice partially paid',
    partPayment.status === 201 && partPayment.body.invoice.status === 'PARTIALLY_PAID',
    `balance KES ${partPayment.body?.invoice?.balanceKes}`,
  );

  const overPayment = await call(
    approver,
    'POST',
    `/api/procurement/supplier-invoices/${invoiceId}/payments`,
    {
      amount: '999999.00',
      paymentDate: '2026-11-08',
      bankAccountId: bankAccount.id,
      idempotencyKey: `pay-over:${invoiceId}`,
    },
  );
  record(
    'A payment above the invoice balance is refused',
    overPayment.status === 409 && overPayment.body.error === 'PAYMENT_EXCEEDS_BALANCE',
    `${overPayment.status} ${overPayment.body?.error ?? ''}`,
  );

  const paymentReplay = await call(
    approver,
    'POST',
    `/api/procurement/supplier-invoices/${invoiceId}/payments`,
    {
      amount: '10000.00',
      paymentDate: '2026-11-08',
      bankAccountId: bankAccount.id,
      paymentMethod: 'BANK',
      idempotencyKey: `pay-part:${invoiceId}`,
    },
  );
  record(
    'A repeated payment key does not pay twice',
    paymentReplay.status === 201 && paymentReplay.body.replayed === true,
  );

  const balance = Math.round(Number(partPayment.body.invoice.balanceKes) * 100) / 100;
  const finalPayment = await call(
    approver,
    'POST',
    `/api/procurement/supplier-invoices/${invoiceId}/payments`,
    {
      amount: balance.toFixed(2),
      paymentDate: '2026-11-09',
      bankAccountId: bankAccount.id,
      paymentMethod: 'BANK',
      idempotencyKey: `pay-final:${invoiceId}`,
    },
  );
  record(
    'The remaining balance settles the invoice',
    finalPayment.status === 201 &&
      finalPayment.body.invoice.status === 'PAID' &&
      Math.round(Number(finalPayment.body.invoice.balanceKes) * 100) === 0,
    `balance KES ${finalPayment.body?.invoice?.balanceKes}`,
  );

  // ---- Ledger -----------------------------------------------------------
  const ledger = await pool.query(
    `SELECT je.id, je.journal_number, je.status,
            COALESCE(SUM(jl.debit_cents),0)::text AS debit,
            COALESCE(SUM(jl.credit_cents),0)::text AS credit
       FROM journal_entries je
       JOIN journal_lines jl ON jl.journal_entry_id = je.id
      WHERE je.facility_id = $1 AND je.source_type = 'PROCUREMENT'
      GROUP BY je.id, je.journal_number, je.status`,
    [facilityId],
  );
  const unbalanced = ledger.rows.filter(
    (row) => row.debit !== row.credit || row.status !== 'POSTED',
  );
  record(
    'Every procurement journal posts and balances',
    ledger.rows.length >= 3 && unbalanced.length === 0,
    `${ledger.rows.length} journal(s)`,
  );

  // Scope the payable check to this invoice's own journals: a facility may hold
  // other open invoices, and those are not evidence about this settlement.
  const invoiceJournalId = Number(invoice.body.invoice.postedJournalId);
  const paymentJournals = [
    Number(partPayment.body.journalId),
    Number(finalPayment.body.journalId),
  ].filter(Boolean);
  const ap = await pool.query(
    `SELECT COALESCE(SUM(jl.debit_cents),0)::text AS debit, COALESCE(SUM(jl.credit_cents),0)::text AS credit
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE je.facility_id = $1 AND jl.account_id = $2 AND je.status = 'POSTED'
        AND jl.journal_entry_id = ANY($3::int[])`,
    [facilityId, accounts.payable, [invoiceJournalId, ...paymentJournals]],
  );
  record(
    'Accounts payable nets to zero after full payment',
    ap.rows[0].debit === ap.rows[0].credit && ap.rows[0].credit !== '0',
    `debit ${ap.rows[0].debit} vs credit ${ap.rows[0].credit}`,
  );

  const invoiceRow = await pool.query(
    'SELECT paid_amount_kes AS paid, balance_kes AS balance, status FROM supplier_invoices WHERE id = $1',
    [invoiceId],
  );
  record(
    'The invoice row records the settled balance',
    invoiceRow.rows[0].status === 'PAID' &&
      Math.round(Number(invoiceRow.rows[0].balance) * 100) === 0,
    `${invoiceRow.rows[0].status} · paid ${invoiceRow.rows[0].paid}`,
  );
} catch (error) {
  record('Journey completed without an exception', false, error.message);
} finally {
  await pool.end().catch(() => undefined);
}

const passed = results.filter((entry) => entry.passed).length;
const failed = results.length - passed;
console.log('\n---------------------------------------------');
console.log(`Assertions: ${passed} passed, ${failed} failed`);
const { writeFileSync } = await import('node:fs');
writeFileSync(
  resultsFile,
  JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
);
console.log(`Report written to ${resultsFile}`);
process.exitCode = failed ? 1 : 0;
