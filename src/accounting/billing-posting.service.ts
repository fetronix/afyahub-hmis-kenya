/**
 * Reviewed, source-linked billing journals. Nothing here transfers money or
 * establishes payer acceptance. A facility accountant must explicitly choose
 * the accounts; this module never creates a chart of accounts or a tariff.
 * Source creation is deliberately separate, so unposted events remain visible.
 */
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/index.ts';
import {
  AccountingIntegrityError,
  centsToKes,
  parseKesToCents,
  postInsideTransaction,
  requiredText,
  requireIsoDate,
  transaction,
  type AccountingScope,
  type JournalLine,
} from './accounting.service.ts';

type SourceType = 'BILLING_INVOICE' | 'BILLING_PAYMENT' | 'BILLING_REFUND';
type Party = 'PATIENT' | 'INSURER';
type Classification = {
  patientReceivableAccountId?: number | null;
  insurerReceivableAccountId?: number | null;
  revenueAccountId?: number | null;
  settlementAccountId?: number | null;
  receivableAccountId?: number | null;
  liabilityAccountId?: number | null;
};

function accountId(value: unknown, name: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new AccountingIntegrityError('INVALID_ACCOUNT', `${name} must be an account ID.`);
  return id;
}

function need(id: number | null | undefined, role: string): number {
  if (!id) throw new AccountingIntegrityError('ACCOUNT_REQUIRED', `Select a ${role} account.`);
  return id;
}

async function checkAccounts(
  client: PoolClient,
  scope: AccountingScope,
  roles: Array<{ id: number; type: 'ASSET' | 'LIABILITY' | 'REVENUE' }>,
) {
  const ids = [...new Set(roles.map((role) => role.id))].sort((a, b) => a - b);
  const result = await client.query<{ id: number; account_type: string }>(
    `SELECT id,account_type FROM chart_of_accounts
     WHERE tenant_id=$1 AND facility_id=$2 AND is_active=true AND id=ANY($3::int[])
     ORDER BY id FOR SHARE`,
    [scope.tenantId, scope.facilityId, ids],
  );
  if (result.rows.length !== ids.length)
    throw new AccountingIntegrityError(
      'ACCOUNT_OUT_OF_SCOPE',
      'Every selected account must be active and in this facility.',
      403,
    );
  for (const role of roles) {
    if (result.rows.find((row) => row.id === role.id)?.account_type !== role.type)
      throw new AccountingIntegrityError(
        'ACCOUNT_CLASSIFICATION_INVALID',
        `A selected account must be classified as ${role.type}.`,
        409,
      );
  }
}

function line(
  accountId: number,
  debitCents: bigint,
  creditCents: bigint,
  description: string,
): JournalLine {
  return { accountId, debitCents, creditCents, description, serviceLine: null };
}

/**
 * Posts a finalized invoice, an attributed receipt, or a manual refund. The
 * invoice and its finalized split must be posted first. Receipt allocations use
 * the posted receivable remaining and put any excess in the selected liability
 * account. Refund allocation is explicitly reviewed against that receipt.
 */
export async function postBillingSourceScoped(
  scope: AccountingScope,
  rawSourceType: unknown,
  rawSourceId: unknown,
  input: Record<string, unknown>,
) {
  const sourceType = rawSourceType as SourceType;
  if (!['BILLING_INVOICE', 'BILLING_PAYMENT', 'BILLING_REFUND'].includes(sourceType))
    throw new AccountingIntegrityError(
      'UNSUPPORTED_SOURCE',
      'Choose an invoice, receipt, or refund source.',
    );
  const sourceId = Number(rawSourceId);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0)
    throw new AccountingIntegrityError('INVALID_SOURCE', 'Source ID must be a positive integer.');
  const entryDate = requireIsoDate(input.entryDate);
  const description = requiredText(input.description, 'Posting description', 500);
  const idempotencyKey = requiredText(input.idempotencyKey, 'Idempotency key', 128);
  const selection = {
    patientReceivableAccountId: accountId(input.patientReceivableAccountId, 'Patient receivable'),
    insurerReceivableAccountId: accountId(input.insurerReceivableAccountId, 'Insurer receivable'),
    revenueAccountId: accountId(input.revenueAccountId, 'Revenue'),
    settlementAccountId: accountId(input.settlementAccountId, 'Settlement'),
    liabilityAccountId: accountId(input.liabilityAccountId, 'Credit liability'),
    receivableRefundCents:
      sourceType === 'BILLING_REFUND'
        ? parseKesToCents(input.receivableRefundKes).toString()
        : null,
  };
  const hash = createHash('sha256')
    .update(JSON.stringify({ sourceType, sourceId, entryDate, description, selection }))
    .digest('hex');

  return transaction(async (client) => {
    // Resolve the invoice without exposing another facility's source. Lock the
    // invoice before the payment, matching billing, attribution and refund paths.
    let invoiceId: number;
    if (sourceType === 'BILLING_INVOICE') invoiceId = sourceId;
    else {
      const source =
        sourceType === 'BILLING_PAYMENT'
          ? await client.query(
              `SELECT p.invoice_id FROM billing_payments p JOIN billing_invoices i ON i.id=p.invoice_id
            WHERE p.id=$1 AND i.tenant_id=$2 AND i.facility_id=$3`,
              [sourceId, scope.tenantId, scope.facilityId],
            )
          : await client.query(
              `SELECT r.invoice_id FROM billing_refunds r
            WHERE r.id=$1 AND r.tenant_id=$2 AND r.facility_id=$3`,
              [sourceId, scope.tenantId, scope.facilityId],
            );
      if (!source.rows.length)
        throw new AccountingIntegrityError(
          'SOURCE_NOT_FOUND',
          'Billing source not found in this facility.',
          404,
        );
      invoiceId = source.rows[0].invoice_id;
    }
    const invoiceResult = await client.query(
      `SELECT i.id,i.voided_at,i.status,i.total_amount::text AS total,
      f.patient_responsibility::text AS patient, f.insurer_responsibility::text AS insurer,
      f.finalized_at::date::text AS finalized_date
      FROM billing_invoices i LEFT JOIN billing_invoice_finalizations f ON f.invoice_id=i.id
        AND f.tenant_id=i.tenant_id AND f.facility_id=i.facility_id
      WHERE i.id=$1 AND i.tenant_id=$2 AND i.facility_id=$3 FOR UPDATE OF i`,
      [invoiceId, scope.tenantId, scope.facilityId],
    );
    if (!invoiceResult.rows.length)
      throw new AccountingIntegrityError(
        'SOURCE_NOT_FOUND',
        'Billing source not found in this facility.',
        404,
      );
    const invoice = invoiceResult.rows[0];

    // Replay does not depend on today's period, account configuration, or a
    // later reversal. A replay is explicitly identified and never reposted.
    const prior = await client.query(
      `SELECT p.journal_id,p.request_hash,p.party,p.amount_cents::text,p.receivable_cents::text,p.liability_cents::text,j.journal_number,j.idempotency_key,
      EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_journal_id=j.id AND r.status='POSTED') AS reversed
      FROM accounting_billing_postings p JOIN journal_entries j ON j.id=p.journal_id
      WHERE p.tenant_id=$1 AND p.facility_id=$2 AND p.source_type=$3 AND p.source_id=$4`,
      [scope.tenantId, scope.facilityId, sourceType, sourceId],
    );
    if (prior.rows.length) {
      const row = prior.rows[0];
      if (row.idempotency_key !== idempotencyKey || row.request_hash !== hash)
        throw new AccountingIntegrityError(
          'SOURCE_ALREADY_POSTED',
          'This source already has a journal. Review it and use a controlled reversal if necessary.',
          409,
        );
      return {
        journal: { id: row.journal_id, journalNumber: row.journal_number, status: 'POSTED' },
        idempotentReplay: true,
        reversed: row.reversed,
        allocation: {
          party: row.party as Party | null,
          amountKes: centsToKes(BigInt(row.amount_cents)),
          receivableKes: centsToKes(BigInt(row.receivable_cents)),
          liabilityKes: centsToKes(BigInt(row.liability_cents)),
        },
      };
    }
    const untracked = await client.query(
      `SELECT id FROM journal_entries WHERE tenant_id=$1 AND facility_id=$2 AND source_type=$3 AND source_id=$4`,
      [scope.tenantId, scope.facilityId, sourceType, String(sourceId)],
    );
    if (untracked.rows.length)
      throw new AccountingIntegrityError(
        'UNTRACKED_SOURCE_JOURNAL',
        'A source-linked journal already exists outside the reviewed bridge; investigate before posting.',
        409,
      );
    if (!invoice.finalized_date || invoice.voided_at || invoice.status === 'Void')
      throw new AccountingIntegrityError(
        'FINALIZED_INVOICE_REQUIRED',
        'An active finalized invoice is required for billing journal posting.',
        409,
      );
    const patient = parseKesToCents(invoice.patient);
    const insurer = parseKesToCents(invoice.insurer);
    const total = parseKesToCents(invoice.total);
    if (total <= 0n || patient + insurer !== total)
      throw new AccountingIntegrityError(
        'INVOICE_ALLOCATION_MISMATCH',
        'Invoice amount and finalized responsibility split require review.',
        409,
      );

    let amount: bigint;
    let receivable: bigint;
    let liability = 0n;
    let paymentId: number | null = null;
    let party: Party | null = null;
    let classification: Classification;
    const lines: JournalLine[] = [];
    if (sourceType === 'BILLING_INVOICE') {
      const priorItemJournals = await client.query(
        `SELECT j.id FROM billing_items b JOIN journal_entries j
        ON j.tenant_id=$1 AND j.facility_id=$2 AND j.source_type='BILLING_ITEM' AND j.source_id=b.id::text
        WHERE b.invoice_id=$3 LIMIT 1`,
        [scope.tenantId, scope.facilityId, invoiceId],
      );
      if (priorItemJournals.rows.length)
        throw new AccountingIntegrityError(
          'ITEM_JOURNAL_REVIEW_REQUIRED',
          'Existing line-level journals require review before posting the whole invoice.',
          409,
        );
      if (entryDate < invoice.finalized_date)
        throw new AccountingIntegrityError(
          'POSTING_BEFORE_SOURCE',
          'Posting date cannot precede finalization.',
          409,
        );
      amount = total;
      receivable = total;
      const patientAccount =
        patient > 0n ? need(selection.patientReceivableAccountId, 'patient receivable') : null;
      const insurerAccount =
        insurer > 0n ? need(selection.insurerReceivableAccountId, 'insurer receivable') : null;
      const revenueAccount = need(selection.revenueAccountId, 'revenue');
      const roles: Array<{ id: number; type: 'ASSET' | 'LIABILITY' | 'REVENUE' }> = [
        { id: revenueAccount, type: 'REVENUE' },
      ];
      if (patientAccount) {
        roles.push({ id: patientAccount, type: 'ASSET' });
        lines.push(line(patientAccount, patient, 0n, 'Patient receivable'));
      }
      if (insurerAccount) {
        roles.push({ id: insurerAccount, type: 'ASSET' });
        lines.push(line(insurerAccount, insurer, 0n, 'Insurer receivable'));
      }
      await checkAccounts(client, scope, roles);
      lines.push(line(revenueAccount, 0n, amount, 'Recognized billing revenue'));
      classification = {
        patientReceivableAccountId: patientAccount,
        insurerReceivableAccountId: insurerAccount,
        revenueAccountId: revenueAccount,
      };
    } else {
      const parent = await client.query(
        `SELECT p.classification,p.journal_id,j.entry_date::text AS entry_date,
        EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_journal_id=j.id AND r.status='POSTED') AS reversed
        FROM accounting_billing_postings p JOIN journal_entries j ON j.id=p.journal_id
        WHERE p.tenant_id=$1 AND p.facility_id=$2 AND p.source_type='BILLING_INVOICE' AND p.source_id=$3`,
        [scope.tenantId, scope.facilityId, invoiceId],
      );
      if (!parent.rows.length || parent.rows[0].reversed)
        throw new AccountingIntegrityError(
          'ACTIVE_INVOICE_POSTING_REQUIRED',
          'Post the finalized invoice before posting a receipt or refund.',
          409,
        );
      const invoiceClassification = parent.rows[0].classification as Classification;
      // Allocate in recorded source order: otherwise a later receipt could be
      // classified as receivable while an earlier refund is still unposted.
      // Reversed/untracked predecessors require review, not silent netting.
      const predecessor = await client.query(
        `WITH events AS (
        SELECT 'BILLING_PAYMENT'::text AS kind, p.id, p.created_at, 0 AS rank
        FROM billing_payments p WHERE p.invoice_id=$1
        UNION ALL
        SELECT 'BILLING_REFUND'::text, r.id, r.created_at, 1
        FROM billing_refunds r WHERE r.invoice_id=$1 AND r.tenant_id=$2 AND r.facility_id=$3
      ), target AS (SELECT * FROM events WHERE kind=$4 AND id=$5)
      SELECT e.kind,e.id FROM events e CROSS JOIN target t
      WHERE (e.created_at,e.rank,e.id) < (t.created_at,t.rank,t.id)
        AND NOT EXISTS (SELECT 1 FROM accounting_billing_postings p
          WHERE p.tenant_id=$2 AND p.facility_id=$3 AND p.source_type=e.kind AND p.source_id=e.id
            AND NOT EXISTS (SELECT 1 FROM journal_entries rev WHERE rev.reversal_of_journal_id=p.journal_id AND rev.status='POSTED'))
      ORDER BY e.created_at,e.rank,e.id LIMIT 1`,
        [invoiceId, scope.tenantId, scope.facilityId, sourceType, sourceId],
      );
      if (predecessor.rows.length)
        throw new AccountingIntegrityError(
          'PREVIOUS_SOURCE_POSTING_REQUIRED',
          'Earlier receipts and refunds must be actively posted or reviewed first.',
          409,
        );
      if (entryDate < parent.rows[0].entry_date)
        throw new AccountingIntegrityError(
          'POSTING_BEFORE_PARENT',
          'Posting date cannot precede the invoice journal.',
          409,
        );
      let sourceDate: string;
      if (sourceType === 'BILLING_PAYMENT') {
        const result = await client.query(
          `SELECT p.id,p.amount::text AS amount,p.payment_date::date::text AS source_date,a.party
          FROM billing_payments p LEFT JOIN billing_payment_attributions a ON a.payment_id=p.id
            AND a.invoice_id=p.invoice_id AND a.tenant_id=$2 AND a.facility_id=$3
          WHERE p.id=$1 AND p.invoice_id=$4 FOR UPDATE OF p`,
          [sourceId, scope.tenantId, scope.facilityId, invoiceId],
        );
        if (!result.rows.length)
          throw new AccountingIntegrityError('SOURCE_NOT_FOUND', 'Receipt not found.', 404);
        const receipt = result.rows[0];
        if (!['PATIENT', 'INSURER'].includes(receipt.party))
          throw new AccountingIntegrityError(
            'PAYMENT_ATTRIBUTION_REQUIRED',
            'Attribute the receipt to the patient or insurer before posting.',
            409,
          );
        amount = parseKesToCents(receipt.amount);
        sourceDate = receipt.source_date;
        paymentId = receipt.id;
        party = receipt.party;
        const allocated = await client.query(
          `SELECT COALESCE(sum(CASE WHEN p.source_type='BILLING_PAYMENT' THEN p.receivable_cents ELSE -p.receivable_cents END),0)::text AS allocated
          FROM accounting_billing_postings p WHERE p.tenant_id=$1 AND p.facility_id=$2 AND p.invoice_id=$3 AND p.party=$4
            AND p.source_type IN ('BILLING_PAYMENT','BILLING_REFUND')
            AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_journal_id=p.journal_id AND r.status='POSTED')`,
          [scope.tenantId, scope.facilityId, invoiceId, party],
        );
        const alreadyApplied = BigInt(allocated.rows[0].allocated);
        const responsibility = party === 'PATIENT' ? patient : insurer;
        if (alreadyApplied < 0n || alreadyApplied > responsibility)
          throw new AccountingIntegrityError(
            'RECEIVABLE_ALLOCATION_MISMATCH',
            'Posted receivable allocations require review.',
            409,
          );
        const remaining = responsibility - alreadyApplied;
        receivable = amount < remaining ? amount : remaining;
        liability = amount - receivable;
        const receivableAccount =
          party === 'PATIENT'
            ? invoiceClassification.patientReceivableAccountId
            : invoiceClassification.insurerReceivableAccountId;
        const settlement = need(selection.settlementAccountId, 'settlement');
        const liabilityAccount =
          liability > 0n ? need(selection.liabilityAccountId, 'credit liability') : null;
        const roles: Array<{ id: number; type: 'ASSET' | 'LIABILITY' | 'REVENUE' }> = [
          { id: settlement, type: 'ASSET' },
        ];
        if (receivable > 0n) {
          const account = need(receivableAccount, 'receivable');
          if (account === settlement)
            throw new AccountingIntegrityError(
              'SAME_ACCOUNT',
              'Settlement and receivable must be different accounts.',
              409,
            );
          roles.push({ id: account, type: 'ASSET' });
          lines.push(line(account, 0n, receivable, `${party} receivable settlement`));
        }
        if (liabilityAccount) {
          roles.push({ id: liabilityAccount, type: 'LIABILITY' });
          lines.push(line(liabilityAccount, 0n, liability, `${party} credit liability`));
        }
        await checkAccounts(client, scope, roles);
        lines.unshift(line(settlement, amount, 0n, 'Recorded receipt / clearing'));
        classification = {
          settlementAccountId: settlement,
          receivableAccountId: receivableAccount ?? null,
          liabilityAccountId: liabilityAccount,
        };
      } else {
        const result = await client.query(
          `SELECT r.payment_id,r.amount::text AS amount,r.created_at::date::text AS source_date,a.party
          FROM billing_refunds r LEFT JOIN billing_payment_attributions a ON a.payment_id=r.payment_id
            AND a.invoice_id=r.invoice_id AND a.tenant_id=r.tenant_id AND a.facility_id=r.facility_id
          WHERE r.id=$1 AND r.invoice_id=$2 AND r.tenant_id=$3 AND r.facility_id=$4`,
          [sourceId, invoiceId, scope.tenantId, scope.facilityId],
        );
        if (!result.rows.length)
          throw new AccountingIntegrityError('SOURCE_NOT_FOUND', 'Refund not found.', 404);
        const refund = result.rows[0];
        if (!['PATIENT', 'INSURER'].includes(refund.party))
          throw new AccountingIntegrityError(
            'PAYMENT_ATTRIBUTION_REQUIRED',
            'Attribute the original receipt before posting its refund.',
            409,
          );
        amount = parseKesToCents(refund.amount);
        sourceDate = refund.source_date;
        paymentId = refund.payment_id;
        party = refund.party;
        await client.query(
          'SELECT id FROM billing_payments WHERE id=$1 AND invoice_id=$2 FOR UPDATE',
          [paymentId, invoiceId],
        );
        const original = await client.query(
          `SELECT p.receivable_cents::text,p.liability_cents::text,p.classification,j.entry_date::text AS entry_date,
          EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_journal_id=j.id AND r.status='POSTED') AS reversed
          FROM accounting_billing_postings p JOIN journal_entries j ON j.id=p.journal_id
          WHERE p.tenant_id=$1 AND p.facility_id=$2 AND p.source_type='BILLING_PAYMENT' AND p.source_id=$3`,
          [scope.tenantId, scope.facilityId, paymentId],
        );
        if (!original.rows.length || original.rows[0].reversed)
          throw new AccountingIntegrityError(
            'ACTIVE_RECEIPT_POSTING_REQUIRED',
            'Post the original receipt before posting its refund.',
            409,
          );
        const receipt = original.rows[0];
        if (entryDate < receipt.entry_date)
          throw new AccountingIntegrityError(
            'POSTING_BEFORE_PARENT',
            'Posting date cannot precede the receipt journal.',
            409,
          );
        const already = await client.query(
          `SELECT COALESCE(sum(p.receivable_cents),0)::text AS receivable,COALESCE(sum(p.liability_cents),0)::text AS liability
          FROM accounting_billing_postings p WHERE p.tenant_id=$1 AND p.facility_id=$2 AND p.source_type='BILLING_REFUND' AND p.payment_id=$3
            AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_journal_id=p.journal_id AND r.status='POSTED')`,
          [scope.tenantId, scope.facilityId, paymentId],
        );
        receivable = BigInt(selection.receivableRefundCents!);
        if (receivable > amount)
          throw new AccountingIntegrityError(
            'REFUND_ALLOCATION_INVALID',
            'Receivable restoration cannot exceed the refund.',
            409,
          );
        liability = amount - receivable;
        if (
          receivable + BigInt(already.rows[0].receivable) > BigInt(receipt.receivable_cents) ||
          liability + BigInt(already.rows[0].liability) > BigInt(receipt.liability_cents)
        )
          throw new AccountingIntegrityError(
            'REFUND_ALLOCATION_INVALID',
            'Refund allocation exceeds the original receipt posting.',
            409,
          );
        const previous = receipt.classification as Classification;
        const settlement = need(selection.settlementAccountId, 'settlement');
        const roles: Array<{ id: number; type: 'ASSET' | 'LIABILITY' | 'REVENUE' }> = [
          { id: settlement, type: 'ASSET' },
        ];
        if (receivable > 0n) {
          const account = need(previous.receivableAccountId, 'original receivable');
          if (account === settlement)
            throw new AccountingIntegrityError(
              'SAME_ACCOUNT',
              'Settlement and receivable must be different accounts.',
              409,
            );
          roles.push({ id: account, type: 'ASSET' });
          lines.push(line(account, receivable, 0n, `${party} receivable restored`));
        }
        if (liability > 0n) {
          const account = need(previous.liabilityAccountId, 'original credit liability');
          roles.push({ id: account, type: 'LIABILITY' });
          lines.push(line(account, liability, 0n, `${party} credit returned`));
        }
        await checkAccounts(client, scope, roles);
        lines.push(line(settlement, 0n, amount, 'Recorded manual refund / clearing'));
        classification = {
          settlementAccountId: settlement,
          receivableAccountId: previous.receivableAccountId ?? null,
          liabilityAccountId: previous.liabilityAccountId ?? null,
        };
      }
      if (entryDate < sourceDate)
        throw new AccountingIntegrityError(
          'POSTING_BEFORE_SOURCE',
          'Posting date cannot precede the source transaction.',
          409,
        );
      if (amount <= 0n)
        throw new AccountingIntegrityError(
          'INVALID_AMOUNT',
          'Source amount must be positive.',
          409,
        );
    }
    const posted = await postInsideTransaction(client, scope, {
      entryDate,
      description,
      idempotencyKey,
      sourceType,
      sourceId: String(sourceId),
      lines,
      totalCents: amount,
    });
    if (posted.idempotentReplay)
      throw new AccountingIntegrityError(
        'UNTRACKED_SOURCE_JOURNAL',
        'Journal replay has no billing source link; investigate before posting.',
        409,
      );
    await client.query(
      `INSERT INTO accounting_billing_postings
      (tenant_id,facility_id,source_type,source_id,invoice_id,payment_id,journal_id,party,amount_cents,receivable_cents,liability_cents,classification,request_hash,actor_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`,
      [
        scope.tenantId,
        scope.facilityId,
        sourceType,
        sourceId,
        invoiceId,
        paymentId,
        posted.journal.id,
        party,
        amount.toString(),
        receivable.toString(),
        liability.toString(),
        JSON.stringify(classification),
        hash,
        scope.actorUserId,
      ],
    );
    return {
      ...posted,
      reversed: false,
      allocation: {
        party,
        amountKes: centsToKes(amount),
        receivableKes: centsToKes(receivable),
        liabilityKes: centsToKes(liability),
      },
    };
  });
}

/** A not-found status is only a snapshot; a delayed request may still arrive. */
export async function getBillingSourcePostingScoped(
  scope: AccountingScope,
  rawSourceType: unknown,
  rawSourceId: unknown,
) {
  const type = String(rawSourceType);
  const id = Number(rawSourceId);
  if (
    !['BILLING_INVOICE', 'BILLING_PAYMENT', 'BILLING_REFUND'].includes(type) ||
    !Number.isSafeInteger(id) ||
    id <= 0
  ) {
    throw new AccountingIntegrityError(
      'INVALID_SOURCE',
      'Choose a valid billing source and positive ID.',
    );
  }
  const result = await pool.query(
    `SELECT p.journal_id,j.journal_number,j.entry_date::text AS entry_date,
    p.party,p.amount_cents::text,p.receivable_cents::text,p.liability_cents::text,p.classification,
    EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_journal_id=j.id AND r.status='POSTED') AS reversed
    FROM accounting_billing_postings p JOIN journal_entries j ON j.id=p.journal_id
    WHERE p.tenant_id=$1 AND p.facility_id=$2 AND p.source_type=$3 AND p.source_id=$4`,
    [scope.tenantId, scope.facilityId, type, id],
  );
  if (!result.rows.length) return { status: 'NOT_FOUND' as const };
  const row = result.rows[0];
  return {
    status: 'RECORDED' as const,
    journalId: row.journal_id,
    journalNumber: row.journal_number,
    entryDate: row.entry_date,
    reversed: row.reversed as boolean,
    party: row.party as Party | null,
    amountKes: centsToKes(BigInt(row.amount_cents)),
    receivableKes: centsToKes(BigInt(row.receivable_cents)),
    liabilityKes: centsToKes(BigInt(row.liability_cents)),
    classification: row.classification as Classification,
  };
}
