import {
  AccountingIntegrityError,
  requireIsoDate,
  transaction,
  type AccountingScope,
} from './accounting.service.ts';

/**
 * Billing subledger to general-ledger tie-out.
 *
 * Two independent questions are answered from one read-only snapshot:
 *
 *  1. Bridge to GL: does every reviewed billing posting (`accounting_billing_postings`)
 *     sit in the accounts and amounts that its own classification claims?
 *  2. Subledger to GL: does the posted ledger agree with what the billing tables say
 *     patients and insurers actually owe, what has been received, and what has been
 *     recognized as revenue?
 *
 * A difference is never netted away or called immaterial here. It is reported next to
 * the journals or sources that explain it, so an operator can act on it.
 */

type Role =
  'PATIENT_RECEIVABLE' | 'INSURER_RECEIVABLE' | 'REVENUE' | 'SETTLEMENT' | 'CREDIT_LIABILITY';

const ROLES: Role[] = [
  'PATIENT_RECEIVABLE',
  'INSURER_RECEIVABLE',
  'REVENUE',
  'SETTLEMENT',
  'CREDIT_LIABILITY',
];

type Classification = {
  patientReceivableAccountId?: number | null;
  insurerReceivableAccountId?: number | null;
  revenueAccountId?: number | null;
  settlementAccountId?: number | null;
  receivableAccountId?: number | null;
  liabilityAccountId?: number | null;
};

type PostingRow = {
  id: number;
  sourceType: string;
  sourceId: number;
  invoiceId: number;
  party: string | null;
  journalId: number;
  amountCents: string;
  receivableCents: string;
  liabilityCents: string;
  classification: Classification;
  status: string;
  entryDate: string;
  reversalDate: string | null;
};

const MAX_EXCEPTIONS = 50;

function big(value: string | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  return BigInt(value);
}

/** KES decimal text strictly to integer cents. Never silently rounds. */
function kesToCents(value: string | null | undefined): bigint {
  const text = String(value ?? '0').trim();
  if (!/^-?(0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(text))
    throw new AccountingIntegrityError('INVALID_AMOUNT', 'Invalid KES amount in billing data.');
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -cents : cents;
}

/** Signed KES text for a debit-positive bigint balance. Never passed back to a parser. */
function kes(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100n;
  const cents = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${cents}`;
}

function receivableRole(party: string | null): Role {
  return party === 'INSURER' ? 'INSURER_RECEIVABLE' : 'PATIENT_RECEIVABLE';
}

/** Roles one reviewed posting is expected to move, derived only from its own bridge row. */
function expectedByRole(row: PostingRow, split: { patient: bigint; insurer: bigint }) {
  const amount = big(row.amountCents);
  const receivable = big(row.receivableCents);
  const liability = big(row.liabilityCents);
  const out: Partial<Record<Role, bigint>> = {};
  const add = (role: Role, value: bigint) => {
    if (value === 0n) return;
    out[role] = (out[role] ?? 0n) + value;
  };
  if (row.sourceType === 'BILLING_INVOICE') {
    // Dr patient/insurer receivable for the finalized responsibility split, Cr revenue.
    add('PATIENT_RECEIVABLE', split.patient);
    add('INSURER_RECEIVABLE', split.insurer);
    add('REVENUE', -amount);
  } else if (row.sourceType === 'BILLING_PAYMENT') {
    // Dr settlement, Cr receivable and any overpayment liability.
    add('SETTLEMENT', amount);
    add(receivableRole(row.party), -receivable);
    add('CREDIT_LIABILITY', -liability);
  } else if (row.sourceType === 'BILLING_REFUND') {
    // Dr receivable and liability restored, Cr settlement.
    add('SETTLEMENT', -amount);
    add(receivableRole(row.party), receivable);
    add('CREDIT_LIABILITY', liability);
  }
  return out;
}

/** The GL account ids a posting's classification claims for each role. */
function accountRolesFor(row: PostingRow): Array<{ role: Role; accountId: number }> {
  const c = row.classification ?? {};
  const pairs: Array<{ role: Role; accountId: number | null | undefined }> = [];
  if (row.sourceType === 'BILLING_INVOICE') {
    pairs.push({ role: 'PATIENT_RECEIVABLE', accountId: c.patientReceivableAccountId });
    pairs.push({ role: 'INSURER_RECEIVABLE', accountId: c.insurerReceivableAccountId });
    pairs.push({ role: 'REVENUE', accountId: c.revenueAccountId });
  } else {
    pairs.push({ role: receivableRole(row.party), accountId: c.receivableAccountId });
    pairs.push({ role: 'SETTLEMENT', accountId: c.settlementAccountId });
    pairs.push({ role: 'CREDIT_LIABILITY', accountId: c.liabilityAccountId });
  }
  return pairs.filter((pair): pair is { role: Role; accountId: number } =>
    Number.isSafeInteger(pair.accountId),
  );
}

function clamp(value: bigint, low: bigint, high: bigint) {
  return value < low ? low : value > high ? high : value;
}

export async function reconcileBillingLedgerScoped(
  scope: AccountingScope,
  input: { endDate: unknown; startDate?: unknown; limit?: unknown },
) {
  const endDate = requireIsoDate(input.endDate);
  const startDate =
    input.startDate === undefined || input.startDate === null || input.startDate === ''
      ? null
      : requireIsoDate(input.startDate);
  if (startDate && startDate > endDate)
    throw new AccountingIntegrityError('INVALID_RANGE', 'Start date must not be after end date.');
  const limit = input.limit === undefined ? MAX_EXCEPTIONS : Number(input.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new AccountingIntegrityError('INVALID_PAGINATION', 'Use a page size between 1 and 200.');

  return transaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const postingColumns = `p.id, p.source_type AS "sourceType", p.source_id AS "sourceId",
      p.invoice_id AS "invoiceId", p.party, p.journal_id AS "journalId",
      p.amount_cents::text AS "amountCents",
      p.receivable_cents::text AS "receivableCents",
      p.liability_cents::text AS "liabilityCents",
      p.classification, j.status, j.entry_date::date::text AS "entryDate",
      (SELECT min(r.entry_date)::date::text FROM journal_entries r
         WHERE r.reversal_of_journal_id = j.id AND r.status = 'POSTED'
           AND r.entry_date::date <= $3::date) AS "reversalDate"`;

    // ---- 1. Reviewed bridge rows, and the journal each one created -----------
    const postings = (
      await tx.query<PostingRow>(
        `SELECT ${postingColumns}
         FROM accounting_billing_postings p JOIN journal_entries j ON j.id = p.journal_id
         WHERE p.tenant_id = $1 AND p.facility_id = $2 AND j.entry_date::date <= $3::date
         ORDER BY p.id`,
        [scope.tenantId, scope.facilityId, endDate],
      )
    ).rows;

    const reversedAsOf = new Set<number>();
    for (const row of postings) if (row.reversalDate) reversedAsOf.add(row.journalId);

    // Every account any bridge row in this facility has ever named, mapped to its role.
    const allPostings = (
      await tx.query<PostingRow>(
        `SELECT id, source_type AS "sourceType", source_id AS "sourceId",
           invoice_id AS "invoiceId", party, journal_id AS "journalId",
           '0' AS "amountCents", '0' AS "receivableCents", '0' AS "liabilityCents",
           classification
         FROM accounting_billing_postings WHERE tenant_id = $1 AND facility_id = $2`,
        [scope.tenantId, scope.facilityId],
      )
    ).rows;
    const roleAccounts = new Map<Role, Set<number>>(ROLES.map((role) => [role, new Set<number>()]));
    for (const row of allPostings)
      for (const { role, accountId } of accountRolesFor(row))
        roleAccounts.get(role)!.add(accountId);
    const controlAccountIds = [...new Set([...roleAccounts.values()].flatMap((set) => [...set]))];

    // ---- 2. Finalized responsibility split per bridged invoice ---------------
    const invoiceSplits = new Map<number, { patient: bigint; insurer: bigint }>();
    if (allPostings.length) {
      const { rows } = await tx.query<{
        invoiceId: number;
        patient: string;
        insurer: string;
      }>(
        `SELECT invoice_id AS "invoiceId", patient_responsibility::text AS patient,
           insurer_responsibility::text AS insurer
         FROM billing_invoice_finalizations WHERE tenant_id = $1 AND facility_id = $2`,
        [scope.tenantId, scope.facilityId],
      );
      for (const row of rows)
        invoiceSplits.set(row.invoiceId, {
          patient: kesToCents(row.patient),
          insurer: kesToCents(row.insurer),
        });
    }

    // ---- 3. What the ledger actually holds on those control accounts ---------
    const glByAccount = new Map<number, bigint>();
    if (controlAccountIds.length) {
      const { rows } = await tx.query<{ accountId: number; net: string }>(
        `SELECT l.account_id AS "accountId",
           COALESCE(sum(l.debit_cents - l.credit_cents), 0)::text AS net
         FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_entry_id
         WHERE j.tenant_id = $1 AND j.facility_id = $2 AND j.status = 'POSTED'
           AND j.entry_date::date <= $3::date AND l.account_id = ANY($4::int[])
         GROUP BY l.account_id`,
        [scope.tenantId, scope.facilityId, endDate, controlAccountIds],
      );
      for (const row of rows) glByAccount.set(row.accountId, big(row.net));
    }
    const accountMeta = controlAccountIds.length
      ? (
          await tx.query<{ id: number; code: string; name: string }>(
            `SELECT id, account_code AS code, account_name AS name
             FROM chart_of_accounts WHERE tenant_id = $1 AND facility_id = $2 AND id = ANY($3::int[])
             ORDER BY account_code`,
            [scope.tenantId, scope.facilityId, controlAccountIds],
          )
        ).rows
      : [];
    const metaById = new Map(accountMeta.map((row) => [row.id, row]));

    // ---- 4. What the bridge says those accounts should hold ------------------
    const effective = postings.filter((row) => !reversedAsOf.has(row.journalId));
    const bridgeByRole = new Map<Role, bigint>(ROLES.map((role) => [role, 0n]));
    for (const row of effective)
      for (const [role, value] of Object.entries(
        expectedByRole(row, invoiceSplits.get(row.invoiceId) ?? { patient: 0n, insurer: 0n }),
      ) as Array<[Role, bigint]>)
        bridgeByRole.set(role, (bridgeByRole.get(role) ?? 0n) + value);

    // ---- 5. Journals touching control accounts with no reviewed bridge row ---
    const unexplainedJournals = controlAccountIds.length
      ? (
          await tx.query<{
            journalId: number;
            journalNumber: string;
            entryDate: string;
            sourceType: string;
            sourceId: string | null;
            net: string;
            debit: string;
            accountIds: number[];
          }>(
            `SELECT j.id AS "journalId", j.journal_number AS "journalNumber",
               j.entry_date::date::text AS "entryDate", j.source_type AS "sourceType",
               j.source_id AS "sourceId",
               COALESCE(sum(l.debit_cents - l.credit_cents), 0)::text AS net,
               COALESCE(sum(l.debit_cents), 0)::text AS debit,
               array_agg(DISTINCT l.account_id ORDER BY l.account_id) AS "accountIds"
             FROM journal_entries j JOIN journal_lines l ON l.journal_entry_id = j.id
             WHERE j.tenant_id = $1 AND j.facility_id = $2 AND j.status = 'POSTED'
               AND j.entry_date::date <= $3::date AND l.account_id = ANY($4::int[])
               AND NOT EXISTS (SELECT 1 FROM accounting_billing_postings p WHERE p.journal_id = j.id)
               -- A reversal only undoes an earlier posting; it is reflected in the
               -- as-of balances and is not itself new unbridged activity. A fully
               -- reversed journal no longer affects the as-of balance either.
               AND j.reversal_of_journal_id IS NULL
               AND NOT EXISTS (SELECT 1 FROM journal_entries r
                 WHERE r.reversal_of_journal_id = j.id AND r.status = 'POSTED')
             GROUP BY j.id, j.journal_number, j.entry_date, j.source_type, j.source_id
             ORDER BY j.id LIMIT $5`,
            [scope.tenantId, scope.facilityId, endDate, controlAccountIds, limit],
          )
        ).rows
      : [];

    // ---- 6. The billing subledger itself, as of the same date ----------------
    const invoiceTotals = (
      await tx.query<{
        invoices: number;
        total: string;
        patient: string;
        insurer: string;
        balance: string;
        credit: string;
      }>(
        `SELECT count(*)::int AS invoices,
           COALESCE(sum(i.total_amount), 0)::text AS total,
           COALESCE(sum(f.patient_responsibility), 0)::text AS patient,
           COALESCE(sum(f.insurer_responsibility), 0)::text AS insurer,
           COALESCE(sum(i.balance_amount), 0)::text AS balance,
           COALESCE(sum(i.credit_balance), 0)::text AS credit
         FROM billing_invoices i
         JOIN billing_invoice_finalizations f ON f.invoice_id = i.id
           AND f.tenant_id = i.tenant_id AND f.facility_id = i.facility_id
         WHERE i.tenant_id = $1 AND i.facility_id = $2 AND i.status <> 'Void'
           AND i.voided_at IS NULL AND f.finalized_at::date <= $3::date`,
        [scope.tenantId, scope.facilityId, endDate],
      )
    ).rows[0];

    const receipts = (
      await tx.query<{ party: string | null; net: string }>(
        `SELECT a.party AS party, COALESCE(sum(p.amount), 0)::text AS net
         FROM billing_payments p
         JOIN billing_invoices i ON i.id = p.invoice_id
         LEFT JOIN billing_payment_attributions a ON a.payment_id = p.id
           AND a.invoice_id = p.invoice_id AND a.tenant_id = $1 AND a.facility_id = $2
         WHERE i.tenant_id = $1 AND i.facility_id = $2 AND p.payment_date::date <= $3::date
         GROUP BY a.party`,
        [scope.tenantId, scope.facilityId, endDate],
      )
    ).rows;

    const refunds = (
      await tx.query<{ party: string | null; net: string }>(
        `SELECT a.party AS party, COALESCE(sum(r.amount), 0)::text AS net
         FROM billing_refunds r
         LEFT JOIN billing_payment_attributions a ON a.payment_id = r.payment_id
           AND a.invoice_id = r.invoice_id AND a.tenant_id = $1 AND a.facility_id = $2
         WHERE r.tenant_id = $1 AND r.facility_id = $2 AND r.created_at::date <= $3::date
         GROUP BY a.party`,
        [scope.tenantId, scope.facilityId, endDate],
      )
    ).rows;

    const sumFor = (
      rows: Array<{ party: string | null; net: string }>,
      party: 'PATIENT' | 'INSURER',
    ) =>
      rows.filter((row) => row.party === party).reduce((sum, row) => sum + kesToCents(row.net), 0n);
    const receiptPatient = sumFor(receipts, 'PATIENT');
    const receiptInsurer = sumFor(receipts, 'INSURER');
    const refundPatient = sumFor(refunds, 'PATIENT');
    const refundInsurer = sumFor(refunds, 'INSURER');
    const unattributedReceipts = receipts
      .filter((row) => row.party === null)
      .reduce((sum, row) => sum + kesToCents(row.net), 0n);
    const receiptTotal = receipts.reduce((sum, row) => sum + kesToCents(row.net), 0n);
    const refundTotal = refunds.reduce((sum, row) => sum + kesToCents(row.net), 0n);

    const patientResponsibility = kesToCents(invoiceTotals.patient);
    const insurerResponsibility = kesToCents(invoiceTotals.insurer);
    const invoiceTotal = kesToCents(invoiceTotals.total);
    const netPaidPatient = receiptPatient - refundPatient;
    const netPaidInsurer = receiptInsurer - refundInsurer;
    // Outstanding debt is the responsibility not yet settled by that party; anything
    // paid beyond it is a credit the facility owes back, not a negative receivable.
    const patientOutstanding =
      patientResponsibility - clamp(netPaidPatient, 0n, patientResponsibility);
    const insurerOutstanding =
      insurerResponsibility - clamp(netPaidInsurer, 0n, insurerResponsibility);
    const creditLiability =
      (netPaidPatient > patientResponsibility ? netPaidPatient - patientResponsibility : 0n) +
      (netPaidInsurer > insurerResponsibility ? netPaidInsurer - insurerResponsibility : 0n);

    const subledgerByRole: Record<Role, bigint> = {
      PATIENT_RECEIVABLE: patientOutstanding,
      INSURER_RECEIVABLE: insurerOutstanding,
      REVENUE: -invoiceTotal,
      SETTLEMENT: receiptTotal - refundTotal,
      CREDIT_LIABILITY: -creditLiability,
    };

    // ---- 7. Billing sources that never reached the ledger -------------------
    const unpostedInvoices = (
      await tx.query<{
        invoiceId: number;
        invoiceNumber: string;
        total: string;
        entry: string;
        patient: string;
        insurer: string;
      }>(
        `SELECT i.id AS "invoiceId", i.invoice_number AS "invoiceNumber",
           i.total_amount::text AS total, f.finalized_at::date::text AS entry,
           f.patient_responsibility::text AS patient,
           f.insurer_responsibility::text AS insurer
         FROM billing_invoices i
         JOIN billing_invoice_finalizations f ON f.invoice_id = i.id
           AND f.tenant_id = i.tenant_id AND f.facility_id = i.facility_id
         WHERE i.tenant_id = $1 AND i.facility_id = $2 AND i.status <> 'Void' AND i.voided_at IS NULL
           AND f.finalized_at::date <= $3::date
           AND NOT EXISTS (SELECT 1 FROM accounting_billing_postings p
             WHERE p.tenant_id = $1 AND p.facility_id = $2
               AND p.source_type = 'BILLING_INVOICE' AND p.source_id = i.id)
           AND NOT EXISTS (SELECT 1 FROM journal_entries e
             WHERE e.tenant_id = $1 AND e.facility_id = $2 AND e.source_type = 'BILLING_ITEM'
               AND e.source_id IN (SELECT id::text FROM billing_items WHERE invoice_id = i.id))
         ORDER BY i.id LIMIT $4`,
        [scope.tenantId, scope.facilityId, endDate, limit],
      )
    ).rows;

    const unpostedReceipts = (
      await tx.query<{
        paymentId: number;
        invoiceId: number;
        amount: string;
        party: string | null;
      }>(
        `SELECT p.id AS "paymentId", p.invoice_id AS "invoiceId", p.amount::text AS amount,
           a.party
         FROM billing_payments p JOIN billing_invoices i ON i.id = p.invoice_id
         LEFT JOIN billing_payment_attributions a ON a.payment_id = p.id
           AND a.invoice_id = p.invoice_id AND a.tenant_id = $1 AND a.facility_id = $2
         WHERE i.tenant_id = $1 AND i.facility_id = $2 AND p.payment_date::date <= $3::date
           AND NOT EXISTS (SELECT 1 FROM accounting_billing_postings x
             WHERE x.tenant_id = $1 AND x.facility_id = $2
               AND x.source_type = 'BILLING_PAYMENT' AND x.source_id = p.id)
         ORDER BY p.id LIMIT $4`,
        [scope.tenantId, scope.facilityId, endDate, limit],
      )
    ).rows;

    const unpostedRefunds = (
      await tx.query<{ refundId: number; invoiceId: number; amount: string }>(
        `SELECT r.id AS "refundId", r.invoice_id AS "invoiceId", r.amount::text AS amount
         FROM billing_refunds r
         WHERE r.tenant_id = $1 AND r.facility_id = $2 AND r.created_at::date <= $3::date
           AND NOT EXISTS (SELECT 1 FROM accounting_billing_postings x
             WHERE x.tenant_id = $1 AND x.facility_id = $2
               AND x.source_type = 'BILLING_REFUND' AND x.source_id = r.id)
         ORDER BY r.id LIMIT $4`,
        [scope.tenantId, scope.facilityId, endDate, limit],
      )
    ).rows;

    const unpostedInvoiceCents = unpostedInvoices.reduce(
      (sum, row) => sum + kesToCents(row.total),
      0n,
    );
    const unpostedInvoicePatientCents = unpostedInvoices.reduce(
      (sum, row) => sum + kesToCents(row.patient),
      0n,
    );
    const unpostedInvoiceInsurerCents = unpostedInvoices.reduce(
      (sum, row) => sum + kesToCents(row.insurer),
      0n,
    );
    const unpostedReceiptCents = unpostedReceipts.reduce(
      (sum, row) => sum + kesToCents(row.amount),
      0n,
    );
    const unpostedReceiptForCents = (party: string | null) =>
      unpostedReceipts
        .filter((row) => row.party === party)
        .reduce((sum, row) => sum + kesToCents(row.amount), 0n);
    const unpostedReceiptPatientCents = unpostedReceiptForCents('PATIENT');
    const unpostedReceiptInsurerCents = unpostedReceiptForCents('INSURER');
    const unpostedReceiptUnattributedCents = unpostedReceiptForCents(null);
    const unpostedRefundCents = unpostedRefunds.reduce(
      (sum, row) => sum + kesToCents(row.amount),
      0n,
    );

    // ---- 8. Bridge rows whose journal does not match the bridge row ----------
    const journalIds = effective.map((row) => row.journalId);
    const journalLines = new Map<number, Map<number, bigint>>();
    if (journalIds.length) {
      const { rows } = await tx.query<{ journalId: number; accountId: number; net: string }>(
        `SELECT l.journal_entry_id AS "journalId", l.account_id AS "accountId",
           COALESCE(sum(l.debit_cents - l.credit_cents), 0)::text AS net
         FROM journal_lines l WHERE l.journal_entry_id = ANY($1::int[])
         GROUP BY l.journal_entry_id, l.account_id`,
        [journalIds],
      );
      for (const row of rows) {
        const accounts = journalLines.get(row.journalId) ?? new Map<number, bigint>();
        accounts.set(row.accountId, big(row.net));
        journalLines.set(row.journalId, accounts);
      }
    }
    const bridgeMismatches: Array<{
      postingId: number;
      sourceType: string;
      sourceId: number;
      journalId: number;
      role: Role;
      expectedKes: string;
      journalKes: string;
      differenceKes: string;
    }> = [];
    for (const row of effective) {
      const expected = expectedByRole(
        row,
        invoiceSplits.get(row.invoiceId) ?? { patient: 0n, insurer: 0n },
      );
      const lines = journalLines.get(row.journalId) ?? new Map<number, bigint>();
      for (const { role, accountId } of accountRolesFor(row)) {
        const wanted = expected[role] ?? 0n;
        if (wanted === 0n) continue;
        const actual = lines.get(accountId) ?? 0n;
        if (actual !== wanted)
          bridgeMismatches.push({
            postingId: row.id,
            sourceType: row.sourceType,
            sourceId: row.sourceId,
            journalId: row.journalId,
            role,
            expectedKes: kes(wanted),
            journalKes: kes(actual),
            differenceKes: kes(actual - wanted),
          });
      }
    }

    // ---- 9. Tie-out rows -----------------------------------------------------
    const tieOut = ROLES.map((role) => {
      const accountIds = [...(roleAccounts.get(role) ?? new Set<number>())].sort((a, b) => a - b);
      const lines = accountIds.map((id) => ({
        accountId: id,
        accountCode: metaById.get(id)?.code ?? null,
        accountName: metaById.get(id)?.name ?? null,
        balanceCents: glByAccount.get(id) ?? 0n,
      }));
      const ledger = lines.reduce((sum, account) => sum + account.balanceCents, 0n);
      const bridge = bridgeByRole.get(role) ?? 0n;
      const subledger = subledgerByRole[role];
      const bridgeDifference = ledger - bridge;
      const subledgerDifference = ledger - subledger;
      const backlog = (() => {
        switch (role) {
          case 'REVENUE':
            return unpostedInvoiceCents;
          case 'SETTLEMENT':
            return unpostedReceiptCents - unpostedRefundCents;
          // A finalized invoice raises the subledger receivable the ledger has not
          // posted yet; a recorded receipt lowers it. Both are explained backlog.
          case 'PATIENT_RECEIVABLE':
            return unpostedReceiptPatientCents - unpostedInvoicePatientCents;
          case 'INSURER_RECEIVABLE':
            return unpostedReceiptInsurerCents - unpostedInvoiceInsurerCents;
          case 'CREDIT_LIABILITY':
            return 0n;
        }
      })();
      const status =
        accountIds.length === 0 && subledger === 0n && bridge === 0n
          ? 'NOT_CONFIGURED'
          : subledgerDifference === 0n && bridgeDifference === 0n
            ? 'TIED'
            : bridgeDifference === 0n && subledgerDifference === backlog
              ? 'POSTING_BACKLOG'
              : 'UNEXPLAINED';
      return {
        control: role,
        accounts: lines.map((line) => ({
          accountId: line.accountId,
          accountCode: line.accountCode,
          accountName: line.accountName,
          balanceKes: kes(line.balanceCents),
        })),
        ledgerKes: kes(ledger),
        bridgeKes: kes(bridge),
        subledgerKes: kes(subledger),
        bridgeDifferenceKes: kes(bridgeDifference),
        subledgerDifferenceKes: kes(subledgerDifference),
        status,
      };
    });

    const unexplainedJournalsShaped = unexplainedJournals.map((row) => ({
      journalId: row.journalId,
      journalNumber: row.journalNumber,
      entryDate: row.entryDate,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      accountIds: row.accountIds,
      netKes: kes(big(row.net)),
      debitKes: kes(big(row.debit)),
    }));
    const unexplained = tieOut.filter((row) => row.status === 'UNEXPLAINED').length;

    return {
      asOf: endDate,
      periodStart: startDate,
      tieOut,
      bridge: {
        postings: postings.length,
        reversedAsOf: reversedAsOf.size,
        effective: effective.length,
        mismatches: bridgeMismatches.slice(0, limit),
        mismatchCount: bridgeMismatches.length,
      },
      subledger: {
        finalizedInvoices: invoiceTotals.invoices,
        finalizedInvoiceTotalKes: kes(invoiceTotal),
        patientResponsibilityKes: kes(patientResponsibility),
        insurerResponsibilityKes: kes(insurerResponsibility),
        invoiceBalanceKes: kes(kesToCents(invoiceTotals.balance)),
        invoiceCreditKes: kes(kesToCents(invoiceTotals.credit)),
        receiptsKes: kes(receiptTotal),
        refundsKes: kes(refundTotal),
        unattributedReceiptsKes: kes(unattributedReceipts),
        patientOutstandingKes: kes(patientOutstanding),
        insurerOutstandingKes: kes(insurerOutstanding),
        creditLiabilityKes: kes(creditLiability),
      },
      exceptions: {
        unpostedInvoices: unpostedInvoices.map((row) => ({
          invoiceId: row.invoiceId,
          invoiceNumber: row.invoiceNumber,
          finalizedDate: row.entry,
          totalKes: row.total,
          patientResponsibilityKes: row.patient,
          insurerResponsibilityKes: row.insurer,
        })),
        unpostedInvoiceKes: kes(unpostedInvoiceCents),
        unpostedInvoicePatientKes: kes(unpostedInvoicePatientCents),
        unpostedInvoiceInsurerKes: kes(unpostedInvoiceInsurerCents),
        unpostedReceipts: unpostedReceipts.map((row) => ({
          paymentId: row.paymentId,
          invoiceId: row.invoiceId,
          amountKes: row.amount,
          party: row.party,
        })),
        unpostedReceiptKes: kes(unpostedReceiptCents),
        unattributedReceiptKes: kes(unpostedReceiptUnattributedCents),
        unpostedRefunds: unpostedRefunds.map((row) => ({
          refundId: row.refundId,
          invoiceId: row.invoiceId,
          amountKes: row.amount,
        })),
        unpostedRefundKes: kes(unpostedRefundCents),
        unexplainedJournals: unexplainedJournalsShaped,
        unexplainedJournalCount: unexplainedJournalsShaped.length,
      },
      summary: {
        controlsTied: tieOut.filter((row) => row.status === 'TIED').length,
        controlsWithBacklog: tieOut.filter((row) => row.status === 'POSTING_BACKLOG').length,
        controlsUnexplained: unexplained,
        bridgeMismatchCount: bridgeMismatches.length,
        reconciled: unexplained === 0 && bridgeMismatches.length === 0,
      },
      limitations: {
        scope: 'FACILITY_SCOPED_SINGLE_SNAPSHOT',
        lineLevelPostings: 'NOT_RECONCILED',
        openingBalances: 'NOT_VERIFIED',
        bankSettlement: 'NOT_RECONCILED',
        notice:
          'Compares posted double-entry journals with the reviewed billing bridge and the billing subledger as of one date. It does not prove bank settlement, insurer payment, opening balances, line-level journal postings, tax or statutory treatment. Only journals dated on or before the as-of date in this facility are included.',
      },
    };
  });
}
