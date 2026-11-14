/**
 * Durable, reviewed receipt/refund-to-ledger recovery.
 *
 * The immutable billing source IS the work item. Its receipt/refund, invoice
 * update and audit are committed together by billing; the view derives the
 * accounting status from that source and immutable source-linked journals.
 * No provider event is accepted or declared verified here. A sandbox query is
 * not a receipt. Existing manual receipts are attestations, not provider proof.
 */
import { pool } from '../db/index.ts';
import { AccountingIntegrityError, type AccountingScope } from './accounting.service.ts';
import { postBillingSourceScoped } from './billing-posting.service.ts';

const sourceTypes = ['BILLING_PAYMENT', 'BILLING_REFUND'] as const;
type SettlementSource = (typeof sourceTypes)[number];

function sourceIdentity(rawType: unknown, rawId: unknown): { type: SettlementSource; id: number } {
  if (typeof rawType !== 'string' || !sourceTypes.includes(rawType as SettlementSource))
    throw new AccountingIntegrityError('UNSUPPORTED_SOURCE', 'Choose a receipt or refund source.');
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new AccountingIntegrityError('INVALID_SOURCE', 'Source ID must be a positive integer.');
  return { type: rawType as SettlementSource, id };
}

function positiveLimit(value: unknown, fallback = 25): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 50)
    throw new AccountingIntegrityError('INVALID_PAGE', 'Page size must be between 1 and 50.');
  return n;
}

export async function listSettlementSourcesScoped(
  scope: AccountingScope,
  input: { afterType?: unknown; afterId?: unknown; limit?: unknown; state?: unknown },
) {
  const limit = positiveLimit(input.limit);
  const state = input.state ?? 'UNRESOLVED';
  if (state !== 'UNRESOLVED' && state !== 'ALL')
    throw new AccountingIntegrityError('INVALID_STATE_FILTER', 'Choose unresolved or all sources.');
  const afterType = input.afterType ?? '';
  const afterId = input.afterId === undefined || input.afterId === '' ? 0 : Number(input.afterId);
  if (
    (afterType !== '' && !sourceTypes.includes(afterType as SettlementSource)) ||
    !Number.isSafeInteger(afterId) ||
    afterId < 0 ||
    (afterType === '' && afterId !== 0) ||
    (afterType !== '' && afterId === 0)
  )
    throw new AccountingIntegrityError('INVALID_PAGE', 'Invalid settlement page cursor.');
  const result = await pool.query(
    `SELECT source_type AS "sourceType",source_id AS "sourceId",payment_id AS "paymentId",
       invoice_id AS "invoiceId",amount::text AS "amountKes",record_number AS "recordNumber",
       method,created_at AS "createdAt",party,status,review_code AS "reviewCode",
       journal_id AS "journalId",journal_number AS "journalNumber",reversal_journal_id AS "reversalJournalId"
     FROM accounting_payment_settlement_status
     WHERE tenant_id=$1 AND facility_id=$2
       AND ($3::text='ALL' OR status IN ('SUCCESS_AWAITING_SETTLEMENT','RECONCILIATION_REQUIRED','REVERSED'))
       AND (source_type,source_id)>($4::text,$5::integer)
     ORDER BY source_type,source_id LIMIT $6`,
    [scope.tenantId, scope.facilityId, state, afterType, afterId, limit + 1],
  );
  const hasMore = result.rows.length > limit;
  const sources = result.rows.slice(0, limit);
  const last = sources.at(-1);
  return {
    sources,
    next: hasMore && last ? { afterType: last.sourceType, afterId: last.sourceId } : null,
    notice:
      'Local receipt and refund accounting status only. A receipt is not authenticated provider evidence; a manual refund is not proof of transfer. Reversed journals require controlled review.',
  };
}

export async function listSettlementAccountsScoped(
  scope: AccountingScope,
  input: { search?: unknown; afterId?: unknown; limit?: unknown },
) {
  const limit = positiveLimit(input.limit);
  const search = input.search === undefined ? '' : input.search;
  const afterId = input.afterId === undefined || input.afterId === '' ? 0 : Number(input.afterId);
  if (typeof search !== 'string' || search.trim().length > 80)
    throw new AccountingIntegrityError('INVALID_SEARCH', 'Search must be at most 80 characters.');
  if (!Number.isSafeInteger(afterId) || afterId < 0)
    throw new AccountingIntegrityError('INVALID_PAGE', 'Invalid account page cursor.');
  const result = await pool.query(
    `SELECT id,account_code AS "accountCode",account_name AS "accountName",account_type AS "accountType"
     FROM chart_of_accounts WHERE tenant_id=$1 AND facility_id=$2 AND is_active=true
       AND account_type IN ('ASSET','LIABILITY') AND id>$3
       AND ($4='' OR account_code ILIKE '%' || $4 || '%' OR account_name ILIKE '%' || $4 || '%')
     ORDER BY id LIMIT $5`,
    [scope.tenantId, scope.facilityId, afterId, search.trim(), limit + 1],
  );
  const hasMore = result.rows.length > limit;
  const accounts = result.rows.slice(0, limit);
  return { accounts, nextAfterId: hasMore ? accounts.at(-1)?.id : null };
}

/**
 * An attempt is audited before any posting. Failure logging contains only an
 * internal error code, never request text, account selections or SQL errors.
 * Existing source uniqueness and the stable server-derived key serialize retries
 * even when different browsers or processes retry after an unknown response.
 */
export async function retrySettlementSourceScoped(
  scope: AccountingScope,
  rawType: unknown,
  rawId: unknown,
  input: Record<string, unknown>,
) {
  const { type, id } = sourceIdentity(rawType, rawId);
  const source = await pool.query(
    `SELECT source_id FROM accounting_payment_settlement_status
     WHERE tenant_id=$1 AND facility_id=$2 AND source_type=$3 AND source_id=$4`,
    [scope.tenantId, scope.facilityId, type, id],
  );
  if (!source.rows.length)
    throw new AccountingIntegrityError(
      'SOURCE_NOT_FOUND',
      'Billing source not found in this facility.',
      404,
    );
  const audit = async (action: 'ATTEMPT' | 'FAILED', code?: string) => {
    await pool.query(
      `INSERT INTO audit_logs(tenant_id,facility_id,user_id,action,resource,resource_id,details)
       VALUES($1,$2,$3,$4,'accounting_payment_settlement',$5,$6)`,
      [
        scope.tenantId,
        scope.facilityId,
        String(scope.actorUserId),
        action,
        String(id),
        JSON.stringify({ sourceType: type, ...(code ? { code } : {}) }),
      ],
    );
  };
  // Fail closed if an attempt cannot be audited. The source remains discoverable.
  await audit('ATTEMPT');
  try {
    return await postBillingSourceScoped(scope, type, id, {
      ...input,
      idempotencyKey: `settlement-retry:v1:${type}:${id}`,
    });
  } catch (error) {
    const code =
      error instanceof AccountingIntegrityError && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)
        ? error.code
        : 'POSTING_OPERATION_FAILED';
    // If this write fails, propagate the audit failure rather than silently
    // declaring success; the source and any committed journal remain queryable.
    await audit('FAILED', code);
    throw error;
  }
}
