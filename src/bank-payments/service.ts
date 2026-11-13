import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { pool } from '../db/index.ts';
import type { AuthorizationContext } from '../auth/authorization.types.ts';
import { getFacilityByIdScoped } from '../db/queries.ts';
import { resolveFacilityScope } from '../auth/scope.service.ts';
import { requireIsoDate, parseKesToCents, centsToKes } from '../accounting/accounting.service.ts';
import { encryptFacilitySecret } from '../payment-hub/secrets.ts';
import {
  BankPaymentError,
  requireBankPermission,
  requireBankAdministrator,
  assertIndependent,
  bankReference,
} from './policy.ts';

const positiveId = z.number().int().positive();
const text = (n: number) => z.string().trim().min(1).max(n);
export const submitBankPaymentSchema = z
  .object({
    facilityId: positiveId,
    bankAccountId: positiveId,
    invoiceId: positiveId,
    amountKes: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/),
    currency: z.literal('KES'),
    bankReference: text(100),
    paymentDate: text(10),
    payerParty: z.enum(['PATIENT', 'INSURER']),
    idempotencyKey: text(128).regex(/^[A-Za-z0-9._:-]{8,128}$/),
  })
  .strict();
export const accountSchema = z
  .object({
    facilityId: positiveId,
    accountName: text(160),
    bankCode: text(80),
    bankName: text(160),
    branchName: text(160),
    currency: z.literal('KES'),
    glAccountId: positiveId,
    accountIdentifier: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9 -]{4,50}$/)
      .optional(),
    isActive: z.boolean(),
    provider: z.enum(['MANUAL', 'KCB_BUNI', 'EQUITY', 'NCBA', 'COOP']),
    environment: z.literal('MANUAL'),
  })
  .strict();
export const verifySchema = z
  .object({
    facilityId: positiveId,
    statementTransactionId: positiveId,
    notes: text(1000),
    attested: z.literal(true),
  })
  .strict();
export const reasonSchema = z.object({ facilityId: positiveId, reason: text(1000) }).strict();
export const facilitySchema = z.object({ facilityId: positiveId }).strict();

export async function bankScope(context: AuthorizationContext, requested: number) {
  if (context.isSuperAdmin || !context.tenantId || !context.facilityId) {
    throw new BankPaymentError('FACILITY_REQUIRED', 'A facility finance account is required.', 403);
  }
  const facilityId = resolveFacilityScope(context, requested);
  const facility = await getFacilityByIdScoped(context, facilityId);
  if (
    !facility ||
    !Array.isArray(facility.enabledModules) ||
    !facility.enabledModules.includes('finance')
  ) {
    throw new BankPaymentError(
      'FINANCE_UNAVAILABLE',
      'Finance is unavailable for this facility.',
      403,
    );
  }
  return { tenantId: facility.tenantId, facilityId, actorUserId: context.userId };
}
type Scope = Awaited<ReturnType<typeof bankScope>>;
async function transaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
export async function bankAudit(
  c: PoolClient,
  s: Scope,
  action: string,
  id: number,
  record = true,
  safeDetails: Record<string, unknown> = {},
) {
  if (record)
    await c.query(
      'INSERT INTO bank_payment_events(bank_payment_id,tenant_id,facility_id,actor_user_id,action) VALUES($1,$2,$3,$4,$5)',
      [id, s.tenantId, s.facilityId, s.actorUserId, action],
    );
  await c.query(
    'INSERT INTO audit_logs(tenant_id,facility_id,user_id,action,resource,resource_id,details) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      s.tenantId,
      s.facilityId,
      String(s.actorUserId),
      action,
      record ? 'bank_payment' : 'bank_configuration',
      String(id),
      JSON.stringify({ source: 'CONTROLLED_MANUAL_BANK', ...safeDetails }),
    ],
  );
}
export async function bankPolicy(context: AuthorizationContext, facilityId: number) {
  if (
    !context.permissions.some((p) =>
      ['billing.read', 'bank_payments.read', 'bank_payments.configure'].includes(p),
    )
  )
    throw new BankPaymentError('BANK_PERMISSION_DENIED', 'Finance access required.', 403);
  const s = await bankScope(context, facilityId);
  const r = await pool.query(
    'SELECT bank_only FROM facility_bank_payment_policies WHERE facility_id=$1 AND tenant_id=$2',
    [s.facilityId, s.tenantId],
  );
  return {
    bankOnly: r.rows.length > 0,
    configured: r.rows.length > 0,
    mode: 'CONTROLLED_MANUAL',
    apiInitiationAvailable: false,
  };
}
export async function enableBankOnly(context: AuthorizationContext, facilityId: number) {
  requireBankAdministrator(context);
  const s = await bankScope(context, facilityId);
  return transaction(async (c) => {
    const accounts = await c.query(
      "SELECT a.id FROM bank_accounts a JOIN bank_account_identifiers k ON k.bank_account_id=a.id WHERE a.tenant_id=$1 AND a.facility_id=$2 AND a.is_active=true AND a.currency='KES' FOR SHARE OF a",
      [s.tenantId, s.facilityId],
    );
    if (!accounts.rows.length)
      throw new BankPaymentError(
        'BANK_ACCOUNT_REQUIRED',
        'Configure an active KES receiving account before enabling bank-only payments.',
      );
    await c.query(
      'INSERT INTO facility_bank_payment_policies(facility_id,tenant_id,enabled_by_user_id) VALUES($1,$2,$3) ON CONFLICT(facility_id) DO NOTHING',
      [s.facilityId, s.tenantId, s.actorUserId],
    );
    await bankAudit(c, s, 'ENABLE_BANK_ONLY', s.facilityId, false);
    return { bankOnly: true };
  });
}
export async function saveBankAccount(
  context: AuthorizationContext,
  raw: unknown,
  accountId?: number,
) {
  requireBankAdministrator(context);
  const input = accountSchema.parse(raw),
    s = await bankScope(context, input.facilityId);
  return transaction(async (c) => {
    const gl = await c.query(
      "SELECT id FROM chart_of_accounts WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 AND account_type='ASSET' AND normal_balance='DEBIT' AND is_active=true FOR SHARE",
      [input.glAccountId, s.tenantId, s.facilityId],
    );
    if (!gl.rows.length)
      throw new BankPaymentError(
        'INVALID_BANK_GL_ACCOUNT',
        'Choose an active debit-normal asset account in this facility.',
      );
    let id = accountId;
    if (id) {
      const prior = await c.query(
        'SELECT gl_account_id,bank_code FROM bank_accounts WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
        [id, s.tenantId, s.facilityId],
      );
      if (!prior.rows.length)
        throw new BankPaymentError('BANK_ACCOUNT_NOT_FOUND', 'Bank account not found.', 404);
      const history = await c.query(
        'SELECT id FROM bank_transactions WHERE bank_account_id=$1 UNION ALL SELECT id FROM bank_payment_records WHERE bank_account_id=$1 LIMIT 1',
        [id],
      );
      if (
        history.rows.length &&
        (input.accountIdentifier || prior.rows[0].bank_code !== input.bankCode)
      )
        throw new BankPaymentError(
          'BANK_IDENTITY_IMMUTABLE',
          'An account with financial history cannot change receiving identity. Create a new account.',
          409,
        );
      if (prior.rows[0].gl_account_id !== input.glAccountId)
        throw new BankPaymentError(
          'BANK_GL_IMMUTABLE',
          'Create another bank account rather than changing its ledger identity.',
          409,
        );
      await c.query(
        'UPDATE bank_accounts SET account_name=$1,bank_code=$2,bank_name=$3,branch_name=$4,is_active=$5,connector_config=$6 WHERE id=$7',
        [
          input.accountName,
          input.bankCode,
          input.bankName,
          input.branchName,
          input.isActive,
          JSON.stringify({ provider: input.provider, environment: 'MANUAL' }),
          id,
        ],
      );
    } else {
      if (!input.accountIdentifier)
        throw new BankPaymentError(
          'ACCOUNT_IDENTIFIER_REQUIRED',
          'An authorized bank account identifier is required.',
        );
      const r = await c.query(
        "INSERT INTO bank_accounts(tenant_id,facility_id,account_name,bank_code,bank_name,branch_name,currency,gl_account_id,is_active,connector_mode,connector_config) VALUES($1,$2,$3,$4,$5,$6,'KES',$7,$8,'STATEMENT_IMPORT_ONLY',$9) RETURNING id",
        [
          s.tenantId,
          s.facilityId,
          input.accountName,
          input.bankCode,
          input.bankName,
          input.branchName,
          input.glAccountId,
          input.isActive,
          JSON.stringify({ provider: input.provider, environment: 'MANUAL' }),
        ],
      );
      id = r.rows[0].id as number;
    }
    if (input.accountIdentifier) {
      // Negative AAD identifier is a separate namespace from positive integration IDs.
      const encrypted = encryptFacilitySecret(
        { tenantId: s.tenantId, facilityId: s.facilityId, integrationId: -id },
        { bankAccountIdentifier: input.accountIdentifier },
      );
      await c.query(
        'INSERT INTO bank_account_identifiers(bank_account_id,tenant_id,facility_id,encrypted_identifier) VALUES($1,$2,$3,$4) ON CONFLICT(bank_account_id) DO UPDATE SET encrypted_identifier=excluded.encrypted_identifier,updated_at=now()',
        [id, s.tenantId, s.facilityId, encrypted],
      );
      await c.query('UPDATE bank_accounts SET account_number_masked=$1 WHERE id=$2', [
        `****${input.accountIdentifier.slice(-4)}`,
        id,
      ]);
    }
    await bankAudit(c, s, accountId ? 'UPDATE_BANK_ACCOUNT' : 'CREATE_BANK_ACCOUNT', id, false, {
      accountName: input.accountName,
      bankCode: input.bankCode,
      bankName: input.bankName,
      branchName: input.branchName,
      currency: 'KES',
      glAccountId: input.glAccountId,
      isActive: input.isActive,
      provider: input.provider,
      environment: 'MANUAL',
      identifierChanged: !!input.accountIdentifier,
    });
    return { id };
  });
}
export async function listBankPayments(context: AuthorizationContext, facilityId: number) {
  requireBankPermission(context, 'bank_payments.read');
  const s = await bankScope(context, facilityId);
  const [accounts, invoices, payments, events] = await Promise.all([
    pool.query(
      `SELECT id,account_name AS "accountName",bank_name AS "bankName",bank_code AS "bankCode",branch_name AS "branchName",currency,account_number_masked AS "accountNumberMasked",gl_account_id AS "glAccountId",is_active AS "isActive",CASE WHEN connector_config->>'provider' IN ('KCB_BUNI','EQUITY','NCBA','COOP') THEN connector_config->>'provider' ELSE 'MANUAL' END AS provider FROM bank_accounts WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id`,
      [s.tenantId, s.facilityId],
    ),
    pool.query(
      `SELECT id,invoice_number AS "invoiceNumber",balance_amount::text AS "balanceAmount" FROM billing_invoices WHERE tenant_id=$1 AND facility_id=$2 AND voided_at IS NULL AND status<>'Void' AND balance_amount>0 AND finalized_at IS NOT NULL ORDER BY id DESC LIMIT 200`,
      [s.tenantId, s.facilityId],
    ),
    pool.query(
      `SELECT b.id,b.invoice_id AS "invoiceId",i.invoice_number AS "invoiceNumber",b.bank_account_id AS "bankAccountId",b.amount_kes::text AS "amountKes",b.bank_reference AS "bankReference",b.payment_date::text AS "paymentDate",b.payer_party AS "payerParty",b.status,b.submitted_by_user_id AS "submittedByUserId",b.verified_by_user_id AS "verifiedByUserId",b.approved_by_user_id AS "approvedByUserId",b.statement_transaction_id AS "statementTransactionId",b.billing_payment_id AS "billingPaymentId",p.receipt_number AS "receiptNumber",COALESCE((SELECT sum(r.amount) FROM billing_refunds r WHERE r.payment_id=p.id),0)::text AS "refundedKes",CASE WHEN p.id IS NULL THEN 'NOT_RECEIPTED' WHEN EXISTS(SELECT 1 FROM accounting_billing_postings a JOIN journal_entries j ON j.id=a.journal_id WHERE a.source_type='BILLING_PAYMENT' AND a.source_id=p.id AND j.status='POSTED' AND NOT EXISTS(SELECT 1 FROM journal_entries rev WHERE rev.reversal_of_journal_id=j.id AND rev.status='POSTED')) THEN 'POSTED' ELSE 'PENDING_REVIEW' END AS "journalStatus" FROM bank_payment_records b JOIN billing_invoices i ON i.id=b.invoice_id LEFT JOIN billing_payments p ON p.id=b.billing_payment_id WHERE b.tenant_id=$1 AND b.facility_id=$2 ORDER BY b.id DESC LIMIT 200`,
      [s.tenantId, s.facilityId],
    ),
    pool.query(
      `SELECT id,bank_payment_id AS "bankPaymentId",actor_user_id AS "actorUserId",action,created_at AS "createdAt" FROM bank_payment_events WHERE tenant_id=$1 AND facility_id=$2 ORDER BY id DESC LIMIT 300`,
      [s.tenantId, s.facilityId],
    ),
  ]);
  const configurationHistory = await pool.query(
    `SELECT id,action,resource_id AS "accountId",user_id AS "actorUserId",timestamp AS "createdAt" FROM audit_logs WHERE tenant_id=$1 AND facility_id=$2 AND resource='bank_configuration' ORDER BY id DESC LIMIT 100`,
    [s.tenantId, s.facilityId],
  );
  return {
    configurationHistory: configurationHistory.rows,
    accounts: accounts.rows,
    invoices: invoices.rows,
    payments: payments.rows,
    events: events.rows,
    limit: 200,
    apiInitiationAvailable: false,
    notice:
      'Controlled manual transfers only. Independent statement verification and separate approval are required. No live bank API is enabled.',
  };
}
export async function submitBankPayment(context: AuthorizationContext, raw: unknown) {
  requireBankPermission(context, 'bank_payments.submit');
  const input = submitBankPaymentSchema.parse(raw),
    s = await bankScope(context, input.facilityId);
  const amountKes = centsToKes(parseKesToCents(input.amountKes));
  if (parseKesToCents(amountKes) <= 0n)
    throw new BankPaymentError('INVALID_AMOUNT', 'Amount must be positive.');
  const date = requireIsoDate(input.paymentDate),
    ref = bankReference(input.bankReference);
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        ...input,
        amountKes,
        paymentDate: date,
        bankReference: ref,
        actorUserId: s.actorUserId,
      }),
    )
    .digest('hex');
  return transaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,$2))', [
      input.idempotencyKey,
      s.facilityId,
    ]);
    const prior = await c.query(
      'SELECT id,request_hash FROM bank_payment_records WHERE facility_id=$1 AND tenant_id=$2 AND idempotency_key=$3',
      [s.facilityId, s.tenantId, input.idempotencyKey],
    );
    if (prior.rows.length) {
      if (prior.rows[0].request_hash !== hash)
        throw new BankPaymentError(
          'IDEMPOTENCY_CONFLICT',
          'Retry identity already belongs to different payment details.',
          409,
        );
      return { id: prior.rows[0].id, idempotentReplay: true };
    }
    const timing = await c.query('SELECT $1::date <= current_date AS valid', [date]);
    if (!timing.rows[0].valid)
      throw new BankPaymentError(
        'INVALID_PAYMENT_DATE',
        'A received transfer cannot have a future payment date.',
      );
    const policy = await c.query(
      'SELECT facility_id FROM facility_bank_payment_policies WHERE tenant_id=$1 AND facility_id=$2',
      [s.tenantId, s.facilityId],
    );
    if (!policy.rows.length)
      throw new BankPaymentError(
        'BANK_POLICY_REQUIRED',
        'A finance administrator must enable bank-only payments for this facility.',
        409,
      );
    const a = await c.query(
      "SELECT id FROM bank_accounts WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 AND is_active=true AND currency='KES' FOR SHARE",
      [input.bankAccountId, s.tenantId, s.facilityId],
    );
    if (!a.rows.length)
      throw new BankPaymentError('BANK_ACCOUNT_NOT_FOUND', 'Active KES account not found.', 404);
    const i = await c.query(
      "SELECT balance_amount FROM billing_invoices WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 AND finalized_at IS NOT NULL AND voided_at IS NULL AND status<>'Void' FOR SHARE",
      [input.invoiceId, s.tenantId, s.facilityId],
    );
    if (!i.rows.length)
      throw new BankPaymentError('INVOICE_NOT_FOUND', 'Eligible finalized invoice not found.', 404);
    if (parseKesToCents(amountKes) > parseKesToCents(i.rows[0].balance_amount))
      throw new BankPaymentError(
        'PAYMENT_EXCEEDS_BALANCE',
        'Payment exceeds the current invoice balance.',
      );
    const r = await c.query(
      `INSERT INTO bank_payment_records(tenant_id,facility_id,bank_account_id,invoice_id,amount_kes,bank_reference,payment_date,payer_party,idempotency_key,request_hash,submitted_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        s.tenantId,
        s.facilityId,
        input.bankAccountId,
        input.invoiceId,
        amountKes,
        ref,
        date,
        input.payerParty,
        input.idempotencyKey,
        hash,
        s.actorUserId,
      ],
    );
    await bankAudit(c, s, 'SUBMIT_PENDING', r.rows[0].id);
    return { id: r.rows[0].id, idempotentReplay: false };
  });
}
export async function verifyBankPayment(context: AuthorizationContext, id: number, raw: unknown) {
  requireBankPermission(context, 'bank_payments.verify');
  const input = verifySchema.parse(raw),
    s = await bankScope(context, input.facilityId);
  return transaction(async (c) => {
    const r = await c.query(
      'SELECT * FROM bank_payment_records WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
      [id, s.tenantId, s.facilityId],
    );
    const b = r.rows[0];
    if (!b) throw new BankPaymentError('BANK_PAYMENT_NOT_FOUND', 'Payment not found.', 404);
    assertIndependent(s.actorUserId, b.submitted_by_user_id);
    if (
      b.status === 'VERIFIED' &&
      b.statement_transaction_id === input.statementTransactionId &&
      b.verified_by_user_id === s.actorUserId &&
      b.verification_notes === input.notes
    )
      return { id, idempotentReplay: true };
    if (b.status !== 'PENDING')
      throw new BankPaymentError(
        'INVALID_PAYMENT_STATE',
        'Only pending transfers can be verified.',
        409,
      );
    const evidence = await c.query(
      `SELECT t.id FROM bank_transactions t JOIN bank_statement_imports s ON s.id=t.statement_import_id JOIN bank_accounts a ON a.id=t.bank_account_id WHERE t.id=$1 AND t.tenant_id=$2 AND t.facility_id=$3 AND t.bank_account_id=$4 AND s.bank_account_id=$4 AND s.tenant_id=$2 AND s.facility_id=$3 AND a.is_active=true AND a.currency='KES' AND t.direction='INFLOW' AND t.amount_kes=$5 AND upper(trim(t.reference_number))=$6 AND t.transaction_date::date=$7::date AND t.origin_classification='IMPORTED_STATEMENT' AND t.matched_journal_line_id IS NULL FOR UPDATE OF t`,
      [
        input.statementTransactionId,
        s.tenantId,
        s.facilityId,
        b.bank_account_id,
        b.amount_kes,
        b.bank_reference,
        b.payment_date,
      ],
    );
    if (!evidence.rows.length)
      throw new BankPaymentError(
        'BANK_EVIDENCE_MISMATCH',
        'An unmatched imported credit must match the receiving account, reference, amount and date exactly.',
        409,
      );
    await c.query(
      "UPDATE bank_payment_records SET status='VERIFIED',statement_transaction_id=$1,verified_by_user_id=$2,verified_at=now(),verification_notes=$3 WHERE id=$4",
      [input.statementTransactionId, s.actorUserId, input.notes, id],
    );
    await bankAudit(c, s, 'VERIFY_STATEMENT', id);
    return { id, idempotentReplay: false };
  });
}
export async function rejectBankPayment(context: AuthorizationContext, id: number, raw: unknown) {
  requireBankPermission(context, 'bank_payments.verify');
  const input = reasonSchema.parse(raw),
    s = await bankScope(context, input.facilityId);
  return transaction(async (c) => {
    const r = await c.query(
      'SELECT status,submitted_by_user_id FROM bank_payment_records WHERE id=$1 AND tenant_id=$2 AND facility_id=$3 FOR UPDATE',
      [id, s.tenantId, s.facilityId],
    );
    if (!r.rows.length)
      throw new BankPaymentError('BANK_PAYMENT_NOT_FOUND', 'Payment not found.', 404);
    assertIndependent(s.actorUserId, r.rows[0].submitted_by_user_id);
    if (r.rows[0].status !== 'PENDING')
      throw new BankPaymentError(
        'INVALID_PAYMENT_STATE',
        'Only pending transfers can be rejected.',
        409,
      );
    await c.query(
      "UPDATE bank_payment_records SET status='REJECTED',rejected_by_user_id=$1,rejection_reason=$2 WHERE id=$3",
      [s.actorUserId, input.reason, id],
    );
    await bankAudit(c, s, 'REJECT', id);
    return { id };
  });
}
