import React, { useEffect, useRef, useState } from 'react';
import {
  bankPaymentsApi as bank,
  type BankWorkspace,
  type StatementWorkspace,
  type BankPayment,
  type BankWorksheet,
  type MatchSuggestion,
} from '../../../api/clients/bank-payments.client.ts';
import { useHmis } from '../../../context/HmisContext.tsx';
import { RefundsPanel } from '../RefundsPanel.tsx';

const field = 'w-full rounded border border-slate-300 bg-white p-2 text-sm';
const button = 'rounded bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50';
const card = 'space-y-3 rounded-xl border border-slate-200 bg-white p-4';
const money = (v: string) => `KES ${v}`;
type Run = (fn: () => Promise<unknown>, notice: string) => Promise<void>;

/** Each scope is a separate mounted component, so old requests cannot populate another facility. */
export function BankPaymentsWorkspace() {
  const { currentFacility, authenticatedUser } = useHmis();
  return <BankWorkspaceScope key={`${currentFacility?.id}:${authenticatedUser?.id}`} />;
}
function BankWorkspaceScope() {
  const { currentFacility, authenticatedUser } = useHmis();
  const facilityId = currentFacility?.id;
  const permissions = new Set(authenticatedUser?.permissions ?? []);
  const [data, setData] = useState<BankWorkspace | null>(null),
    [enabled, setEnabled] = useState(false);
  const [tab, setTab] = useState('Payments'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const allowed =
    !!facilityId && !authenticatedUser?.isSuperAdmin && permissions.has('bank_payments.read');
  useEffect(() => {
    let current = true;
    setData(null);
    setError('');
    if (allowed && facilityId)
      Promise.all([bank.workspace(facilityId), bank.policy(facilityId)])
        .then(([d, p]) => {
          if (current) {
            setData(d);
            setEnabled(p.bankOnly);
          }
        })
        .catch(() => {
          if (current)
            setError('Bank data could not be loaded. Do not assume there are no payments.');
        });
    return () => {
      current = false;
    };
  }, [facilityId, allowed, reload]);
  const run: Run = async (fn, message) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      if (alive.current) {
        setNotice(message);
        setReload((n) => n + 1);
      }
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error ? e.message : 'Operation failed. Review history before retrying.',
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  if (!allowed || !facilityId)
    return (
      <section className={card}>
        Bank payments require facility finance access and the Bank Payments read permission.
      </section>
    );
  return (
    <main className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">Bank Payments &amp; Reconciliation</h1>
        <p className="text-sm text-slate-600">
          Facility-owned receiving accounts • verified transfers • statement reconciliation
        </p>
      </header>
      <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
        Controlled manual bank transfers only. No live bank collection, transfer or notification API
        is enabled. KCB and Equity checks are sandbox authentication only; NCBA and Co-op are
        manual-only.
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button className={button} disabled={busy} onClick={() => setReload((n) => n + 1)}>
        Refresh bank data
      </button>
      <nav aria-label="Bank workspace" className="flex flex-wrap gap-2">
        {['Payments', 'Statements & Matching', 'Accounts', 'History'].map((t) => (
          <button className={button} key={t} aria-pressed={t === tab} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      {!data ? (
        <p>Loading bank data…</p>
      ) : (
        <>
          {!enabled && (
            <section className={card}>
              <h2 className="font-bold">Facility setup required</h2>
              <p>
                Configure an active KES account, then explicitly enable bank-only payments. This
                disables generic receipt recording and STK initiation for this facility, without
                rewriting historical receipts.
              </p>
              {permissions.has('bank_payments.configure') &&
                authenticatedUser?.roles?.includes('FACILITY_ADMIN') && (
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Enable bank-only payments for this facility? Generic payment recording and STK initiation will be blocked.',
                        )
                      )
                        void run(() => bank.enable(facilityId), 'Bank-only payments enabled.');
                    }}
                  >
                    Enable bank-only payments
                  </button>
                )}
            </section>
          )}
          {tab === 'Payments' && (
            <>
              {permissions.has('bank_payments.submit') && (
                <BankPaymentForm
                  data={data}
                  enabled={enabled}
                  busy={busy}
                  run={run}
                  facilityId={facilityId}
                />
              )}
              <p className="text-xs">
                Latest {data.limit} records at most. Pending and verified transfers are not
                receipts. Journal status is separate from receipt settlement.
              </p>
              {data.payments.length === 0 ? (
                <p>No bank payment records in this facility.</p>
              ) : (
                data.payments.map((p) => (
                  <PaymentReview
                    key={p.id}
                    payment={p}
                    facilityId={facilityId}
                    permissions={permissions}
                    actor={authenticatedUser!.id}
                    run={run}
                    busy={busy}
                  />
                ))
              )}
            </>
          )}
          {tab === 'Accounts' && (
            <Accounts
              data={data}
              facilityId={facilityId}
              canConfigure={
                permissions.has('bank_payments.configure') &&
                !!authenticatedUser?.roles?.includes('FACILITY_ADMIN')
              }
              run={run}
              busy={busy}
            />
          )}
          {tab === 'Statements & Matching' && (
            <Statements
              key={reload}
              data={data}
              facilityId={facilityId}
              canRead={permissions.has('accounting.read')}
              canManage={permissions.has('accounting.bank.manage')}
              run={run}
              busy={busy}
            />
          )}
          {tab === 'History' && (
            <section className={card}>
              <h2 className="font-bold">Payment audit history</h2>
              <h3>Configuration history</h3>
              {data.configurationHistory.map((e) => (
                <p key={`config:${e.id}`}>
                  {e.action} · account/facility #{e.accountId} · staff #{e.actorUserId} ·{' '}
                  {new Date(e.createdAt).toLocaleString()}
                </p>
              ))}
              {data.events.map((e) => (
                <p key={e.id}>
                  Payment #{e.bankPaymentId} · {e.action} · staff #{e.actorUserId} ·{' '}
                  {new Date(e.createdAt).toLocaleString()}
                </p>
              ))}
              {!data.events.length && <p>No payment events recorded.</p>}
            </section>
          )}
        </>
      )}
    </main>
  );
}
function BankPaymentForm({
  data,
  enabled,
  busy,
  run,
  facilityId,
  selectedInvoiceId,
}: {
  data: BankWorkspace;
  enabled: boolean;
  busy: boolean;
  run: Run;
  facilityId: number;
  selectedInvoiceId?: number;
}) {
  const [invoiceId, setInvoiceId] = useState(String(selectedInvoiceId ?? '')),
    [accountId, setAccountId] = useState(''),
    [amount, setAmount] = useState('');
  const [reference, setReference] = useState(''),
    [date, setDate] = useState(''),
    [party, setParty] = useState('PATIENT');
  const [key, setKey] = useState<string | null>(null),
    [sent, setSent] = useState(false);
  const invoice = data.invoices.find((i) => String(i.id) === invoiceId);
  const fingerprint = JSON.stringify({ invoiceId, accountId, amount, reference, date, party });
  const locked = useRef<string | null>(null);
  return (
    <form
      className={card}
      onSubmit={(e) => {
        e.preventDefault();
        if (locked.current && locked.current !== fingerprint) return;
        const retry = key ?? crypto.randomUUID();
        setKey(retry);
        locked.current = fingerprint;
        void run(async () => {
          await bank.submit({
            facilityId,
            invoiceId: Number(invoiceId),
            bankAccountId: Number(accountId),
            amountKes: amount,
            currency: 'KES',
            bankReference: reference,
            paymentDate: date,
            payerParty: party,
            idempotencyKey: retry,
          });
          setSent(true);
        }, 'Pending transfer saved. No receipt issued and no invoice settled.');
      }}
    >
      <h2 className="font-bold">Record external bank transfer</h2>
      <p className="text-sm">
        Select a finalized invoice. Transfer instructions must be confirmed with your facility
        finance team. A reference or screenshot alone is not verified payment.
      </p>
      <label>
        Invoice
        <select
          aria-label="Bank payment invoice"
          className={field}
          required
          disabled={!!key || busy || !!selectedInvoiceId}
          value={invoiceId}
          onChange={(e) => setInvoiceId(e.target.value)}
        >
          <option value="">Select invoice</option>
          {data.invoices.map((i) => (
            <option value={i.id} key={i.id}>
              {i.invoiceNumber} — {money(i.balanceAmount)} outstanding
            </option>
          ))}
        </select>
      </label>
      {selectedInvoiceId && !invoice && (
        <p>Finalize the invoice and review its balance before recording a transfer.</p>
      )}
      <p>
        Outstanding balance: {invoice ? money(invoice.balanceAmount) : 'Select an eligible invoice'}
      </p>
      <label>
        Receiving bank account
        <select
          className={field}
          required
          disabled={!!key || busy}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">Select account</option>
          {data.accounts
            .filter((a) => a.isActive && a.currency === 'KES')
            .map((a) => (
              <option value={a.id} key={a.id}>
                {a.bankName} · {a.accountName} · {a.accountNumberMasked}
              </option>
            ))}
        </select>
      </label>
      <label>
        Amount (KES)
        <input
          className={field}
          required
          inputMode="decimal"
          pattern="[0-9]+(\.[0-9]{1,2})?"
          disabled={!!key || busy}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <label>
        Bank reference
        <input
          className={field}
          maxLength={100}
          required
          disabled={!!key || busy}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </label>
      <label>
        Transfer date
        <input
          className={field}
          type="date"
          required
          disabled={!!key || busy}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <label>
        Paying party
        <select
          className={field}
          disabled={!!key || busy}
          value={party}
          onChange={(e) => setParty(e.target.value)}
        >
          <option value="PATIENT">Patient</option>
          <option value="INSURER">Insurer</option>
        </select>
      </label>
      <button className={button} disabled={!enabled || busy || sent || !invoice}>
        {sent
          ? 'Pending record saved'
          : key
            ? 'Retry same pending transfer'
            : 'Save pending transfer — no receipt'}
      </button>
      {key && (
        <p className="text-xs">
          This form is frozen to the same retry identity. If the response was lost, retry these
          exact details. Before starting another transfer or reloading this page, check payment
          history to avoid a second declaration.
        </p>
      )}
    </form>
  );
}
function PaymentReview({
  payment: p,
  facilityId,
  permissions,
  actor,
  run,
  busy,
}: {
  payment: BankPayment;
  facilityId: number;
  permissions: Set<string>;
  actor: number;
  run: Run;
  busy: boolean;
}) {
  const [statement, setStatement] = useState(''),
    [notes, setNotes] = useState(''),
    [attested, setAttested] = useState(false),
    [refund, setRefund] = useState(false);
  const own = p.submittedByUserId === actor;
  return (
    <section className={card}>
      <h3 className="font-bold">
        #{p.id} · {p.invoiceNumber} · {money(p.amountKes)}
      </h3>
      <p>
        Bank account #{p.bankAccountId} · {p.bankReference} · {p.paymentDate} · {p.payerParty}
      </p>
      <p>
        Payment:{' '}
        <strong>
          {Number(p.refundedKes) >= Number(p.amountKes)
            ? 'REVERSED'
            : Number(p.refundedKes) > 0
              ? 'PARTIALLY_REVERSED'
              : p.status}
        </strong>{' '}
        · Verification: {p.verifiedByUserId ? 'Independently statement-verified' : 'Unverified'} ·
        Journal: {p.journalStatus}
      </p>
      <p>
        Submitted by #{p.submittedByUserId}; verified by{' '}
        {p.verifiedByUserId ? `#${p.verifiedByUserId}` : '—'}; approved by{' '}
        {p.approvedByUserId ? `#${p.approvedByUserId}` : '—'}.
      </p>
      {p.receiptNumber && (
        <p>
          Receipt: {p.receiptNumber} · Refunded/reversed: {money(p.refundedKes)}. Refunds and
          journal reversals retain the original receipt.
        </p>
      )}
      {p.status === 'PENDING' && permissions.has('bank_payments.verify') && !own && (
        <div className="space-y-2">
          <label>
            Imported statement credit ID
            <input
              className={field}
              type="number"
              min={1}
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
            />
          </label>
          <label>
            Verification notes / rejection reason
            <textarea
              className={field}
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <label className="block">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
            />{' '}
            I independently checked the bank statement, receiving account, reference, amount and
            date.
          </label>
          <button
            className={button}
            disabled={busy || !statement || !notes.trim() || !attested}
            onClick={() =>
              void run(
                () => bank.verify(facilityId, p.id, Number(statement), notes),
                'Statement verified. Separate settlement approval is still required.',
              )
            }
          >
            Verify statement credit
          </button>{' '}
          <button
            className={button}
            disabled={busy || !notes.trim()}
            onClick={() =>
              void run(
                () => bank.reject(facilityId, p.id, notes),
                'Pending transfer rejected without changing the invoice.',
              )
            }
          >
            Reject pending transfer
          </button>
        </div>
      )}
      {p.status === 'VERIFIED' &&
        permissions.has('bank_payments.settle') &&
        permissions.has('billing.payments.record') &&
        !own &&
        actor !== p.verifiedByUserId && (
          <button
            className={button}
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  'Approve this verified transfer and issue its receipt? The current invoice and party balance will be checked again.',
                )
              )
                void run(
                  () => bank.settle(facilityId, p.id),
                  'Verified transfer receipted. Review and post its source-linked accounting journal.',
                );
            }}
          >
            Approve and issue verified receipt
          </button>
        )}
      {p.status === 'SETTLED' && permissions.has('billing.read') && (
        <>
          <button className={button} onClick={() => setRefund((v) => !v)}>
            Authorized refunds &amp; history
          </button>
          {refund && <RefundsPanel invoiceId={p.invoiceId} bankOnly />}
        </>
      )}
    </section>
  );
}
function Accounts({
  data,
  facilityId,
  canConfigure,
  run,
  busy,
}: {
  data: BankWorkspace;
  facilityId: number;
  canConfigure: boolean;
  run: Run;
  busy: boolean;
}) {
  const [id, setId] = useState(''),
    [name, setName] = useState(''),
    [bankName, setBankName] = useState(''),
    [code, setCode] = useState(''),
    [branch, setBranch] = useState(''),
    [identifier, setIdentifier] = useState(''),
    [gl, setGl] = useState(''),
    [provider, setProvider] = useState('MANUAL'),
    [active, setActive] = useState(true);
  const [ledger, setLedger] = useState<Array<{ id: number; accountName: string }>>([]),
    [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    if (canConfigure)
      bank
        .ledgerAccounts(facilityId)
        .then((r) => {
          if (current)
            setLedger(
              r.accounts.filter((a) => a.accountType === 'ASSET' && a.normalBalance === 'DEBIT'),
            );
        })
        .catch(() => {
          if (current)
            setError('Ledger accounts could not be loaded. Accounting read access is required.');
        });
    return () => {
      current = false;
    };
  }, [facilityId, canConfigure]);
  return (
    <section className={card}>
      <h2 className="font-bold">Facility receiving accounts</h2>
      {data.accounts.map((a) => (
        <p key={a.id}>
          {a.bankName} · {a.accountName} · {a.accountNumberMasked ?? 'Identifier not configured'} ·{' '}
          {a.branchName ?? 'No branch'} · {a.currency} · {a.isActive ? 'Active' : 'Inactive'} ·
          Manual statements only
        </p>
      ))}
      {canConfigure && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await bank.saveAccount(
                {
                  facilityId,
                  accountName: name,
                  bankName,
                  bankCode: code,
                  branchName: branch,
                  currency: 'KES',
                  glAccountId: Number(gl),
                  ...(identifier ? { accountIdentifier: identifier } : {}),
                  isActive: active,
                  provider,
                  environment: 'MANUAL',
                },
                id ? Number(id) : undefined,
              );
              setIdentifier('');
            }, 'Bank account configuration saved without exposing its identifier or credentials.');
          }}
        >
          <p>
            Finance-administrator access is required. Full identifiers are encrypted and write-only.
            Account identity/GL cannot be changed after financial history; create a replacement
            account instead.
          </p>
          {error && <p role="alert">{error}</p>}
          <label>
            Account to configure
            <select
              className={field}
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                setIdentifier('');
                const a = data.accounts.find((a) => String(a.id) === e.target.value);
                setName(a?.accountName ?? '');
                setBankName(a?.bankName ?? '');
                setCode(a?.bankCode ?? '');
                setBranch(a?.branchName ?? '');
                setGl(a ? String(a.glAccountId) : '');
                setProvider(a?.provider ?? 'MANUAL');
                setActive(a?.isActive ?? true);
              }}
            >
              <option value="">New account</option>
              {data.accounts.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.accountName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Account name
            <input
              className={field}
              required
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Bank name
            <input
              className={field}
              required
              maxLength={160}
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
            />
          </label>
          <label>
            Bank code
            <input
              className={field}
              required
              maxLength={80}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <label>
            Branch
            <input
              className={field}
              required
              maxLength={160}
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            />
          </label>
          <label>
            Authorized account identifier
            <input
              className={field}
              type="password"
              autoComplete="new-password"
              required={!id}
              maxLength={50}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </label>
          <label>
            Bank asset GL
            <select
              className={field}
              required
              disabled={!!id}
              value={gl}
              onChange={(e) => setGl(e.target.value)}
            >
              <option value="">Select active debit-normal asset</option>
              {ledger.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.accountName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bank/provider metadata
            <select
              className={field}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              {['MANUAL', 'KCB_BUNI', 'EQUITY', 'NCBA', 'COOP'].map((p) => (
                <option key={p} value={p}>
                  {p} — manual reconciliation
                </option>
              ))}
            </select>
          </label>
          <p>
            Currency: KES · Environment: controlled manual. Provider selection does not enable an
            API.
          </p>
          <label>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{' '}
            Active
          </label>
          <br />
          <button className={button} disabled={busy || !!error}>
            Save facility bank account
          </button>
        </form>
      )}
    </section>
  );
}
function Statements({
  data,
  facilityId,
  canRead,
  canManage,
  run,
  busy,
}: {
  data: BankWorkspace;
  facilityId: number;
  canRead: boolean;
  canManage: boolean;
  run: Run;
  busy: boolean;
}) {
  const [workspace, setWorkspace] = useState<StatementWorkspace | null>(null),
    [error, setError] = useState(''),
    [account, setAccount] = useState('');
  const [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [closing, setClosing] = useState(''),
    [csv, setCsv] = useState('');
  const [worksheet, setWorksheet] = useState<{
      id: number;
      accountId: number;
      value: BankWorksheet;
    } | null>(null),
    [notes, setNotes] = useState(''),
    [period, setPeriod] = useState('');
  const [transaction, setTransaction] = useState<number | null>(null),
    [suggestions, setSuggestions] = useState<MatchSuggestion[]>([]);
  const [preview, setPreview] = useState<{
    fingerprint: string;
    lineCount: number;
    overlappingLines: number;
    duplicatesWithinFile: number;
    canImport: boolean;
  } | null>(null);
  const importFingerprint = JSON.stringify({ account, start, end, closing, csv });
  const [unmatchedOnly, setUnmatchedOnly] = useState(false),
    [search, setSearch] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    if (canRead)
      bank
        .statements(facilityId)
        .then((d) => {
          if (current) setWorkspace(d);
        })
        .catch(() => {
          if (current) setError('Statements could not be loaded.');
        });
    return () => {
      current = false;
    };
  }, [facilityId, canRead]);
  if (!canRead)
    return <p>Accounting read permission is required to inspect statements and reconciliations.</p>;
  const lines =
    workspace?.transactions.filter(
      (t) =>
        (!account || String(t.bankAccountId) === account) &&
        (!unmatchedOnly || t.matchStatus === 'UNMATCHED') &&
        `${t.reference} ${t.description}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  return (
    <section className="space-y-4">
      {error && <p role="alert">{error}</p>}
      <label>
        Filter bank account
        <select
          className={field}
          value={account}
          onChange={(e) => {
            setAccount(e.target.value);
            setWorksheet(null);
            setSuggestions([]);
          }}
        >
          <option value="">All accounts</option>
          {data.accounts.map((a) => (
            <option value={a.id} key={a.id}>
              {a.accountName}
            </option>
          ))}
        </select>
      </label>
      <p>
        Imported statement evidence is manually sourced, not a live bank feed. A zero worksheet
        difference is not bank API confirmation. Latest 100 imports / 200 lines are shown.
      </p>
      {canManage && (
        <form
          className={card}
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                bank.importStatement(facilityId, Number(account), {
                  startDate: start,
                  endDate: end,
                  closingBalanceKes: closing,
                  csvText: csv,
                }),
              'Statement imported atomically. Duplicates and overlaps require review; no invoice was settled.',
            );
          }}
        >
          <h2 className="font-bold">Import bank CSV statement</h2>
          <p>
            Select an account above. CSV columns: date,reference,description,direction,amount.
            Direction: INFLOW or OUTFLOW. KES only. An overlapping duplicate rejects the entire
            import; review the source rather than silently skipping money.
          </p>
          <label>
            Start date
            <input
              className={field}
              type="date"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            End date
            <input
              className={field}
              type="date"
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <label>
            Closing statement balance (KES)
            <input
              className={field}
              required
              value={closing}
              onChange={(e) => setClosing(e.target.value)}
            />
          </label>
          <label>
            Statement CSV
            <textarea
              className={field}
              required
              maxLength={1000000}
              rows={5}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />
          </label>
          <button
            type="button"
            className={button}
            disabled={busy || !account || !start || !end || !closing || !csv}
            onClick={() => {
              const fingerprint = importFingerprint;
              bank
                .previewImport(facilityId, Number(account), {
                  startDate: start,
                  endDate: end,
                  closingBalanceKes: closing,
                  csvText: csv,
                })
                .then((p) => {
                  if (alive.current) setPreview({ ...p, fingerprint });
                })
                .catch(() => {
                  if (alive.current)
                    setError(
                      'Import preview failed. Check account, dates, balance and CSV format.',
                    );
                });
            }}
          >
            Validate import preview
          </button>
          {preview?.fingerprint === importFingerprint && (
            <p>
              Preview: {preview.lineCount} lines · existing overlaps {preview.overlappingLines} ·
              duplicates within file {preview.duplicatesWithinFile}.{' '}
              {preview.canImport
                ? 'Ready for atomic validation and import.'
                : 'Resolve duplicates before importing.'}
            </p>
          )}
          <button
            className={button}
            disabled={
              busy || !account || preview?.fingerprint !== importFingerprint || !preview?.canImport
            }
          >
            Import statement — does not issue receipts
          </button>
        </form>
      )}
      <section className={card}>
        <h2 className="font-bold">Statement credits, withdrawals &amp; unmatched deposits</h2>
        <label>
          Reference / description search
          <input className={field} value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label>
          <input
            type="checkbox"
            checked={unmatchedOnly}
            onChange={(e) => setUnmatchedOnly(e.target.checked)}
          />{' '}
          Unmatched only
        </label>
        {lines.map((t) => (
          <div key={t.id} className="border-t py-2">
            <p>
              Credit/line #{t.id} · account #{t.bankAccountId} · {t.date} ·{' '}
              {t.reference ?? 'No reference'} · {t.direction} {money(t.amountKes)} · {t.matchStatus}
            </p>
            <p>{t.description}</p>
            {canManage && t.matchStatus === 'UNMATCHED' && (
              <button
                className={button}
                disabled={busy}
                onClick={() => {
                  setTransaction(t.id);
                  setSuggestions([]);
                  bank
                    .suggestions(facilityId, t.id)
                    .then((r) => {
                      if (alive.current) setSuggestions(r.suggestions);
                    })
                    .catch(() => {
                      if (alive.current) setError('Match suggestions could not be loaded.');
                    });
                }}
              >
                Review ledger match suggestions
              </button>
            )}
            {canManage && t.matchedJournalLineId && (
              <button
                className={button}
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt(
                    'Reason for unmatching (does not reverse money or journal):',
                  );
                  if (reason)
                    void run(
                      () => bank.unmatch(facilityId, t.id, reason),
                      'Match removed with audit; journal and receipt unchanged.',
                    );
                }}
              >
                Unmatch with reason
              </button>
            )}
          </div>
        ))}
        {!lines.length && workspace && <p>No lines match these filters.</p>}
        {transaction && (
          <div>
            <h3 className="font-bold">Non-mutating suggestions for line #{transaction}</h3>
            <p>
              Check the source-linked journal and evidence. A suggestion is not a verified match. No
              suggestions may mean its receipt journal still needs posting in Accounting.
            </p>
            {suggestions.map((s) => (
              <p key={s.journalLineId}>
                Journal line #{s.journalLineId} · {s.reference} · {s.confidence} ·{' '}
                {s.reasons.join(' ')}{' '}
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => bank.match(facilityId, transaction, s.journalLineId),
                      'Exact posted ledger line matched with audit.',
                    )
                  }
                >
                  Confirm reviewed match
                </button>
              </p>
            ))}
          </div>
        )}
      </section>
      <section className={card}>
        <h2 className="font-bold">Statement reconciliation &amp; approval</h2>
        {workspace?.imports
          .filter((i) => !account || String(i.bankAccountId) === account)
          .map((i) => (
            <p key={i.id}>
              Import #{i.id} · account #{i.bankAccountId} · {i.startDate}—{i.endDate} ·{' '}
              {i.lineCount} lines · closing {money(i.closingBalanceKes)}{' '}
              <button
                className={button}
                disabled={busy}
                onClick={() => {
                  bank
                    .worksheet(facilityId, i.bankAccountId, i.id)
                    .then((r) => {
                      if (alive.current)
                        setWorksheet({ id: i.id, accountId: i.bankAccountId, value: r.worksheet });
                    })
                    .catch(() => {
                      if (alive.current) setError('Worksheet unavailable.');
                    });
                }}
              >
                Review worksheet
              </button>
            </p>
          ))}
        {worksheet && (
          <div className="space-y-2">
            <p>
              Import #{worksheet.id} · statement {money(worksheet.value.statementBalanceKes)} ·
              ledger {money(worksheet.value.ledgerBalanceKes)} · difference{' '}
              {money(worksheet.value.differenceKes)} · unmatched lines{' '}
              {worksheet.value.unmatchedStatementCount}
            </p>
            <label>
              Financial period code
              <input
                className={field}
                placeholder="YYYY-MM"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </label>
            <label>
              Preparation notes
              <textarea
                className={field}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            {canManage && (
              <button
                className={button}
                disabled={
                  busy ||
                  !worksheet.value.worksheetBalanced ||
                  worksheet.value.unmatchedStatementCount > 0 ||
                  !notes.trim() ||
                  !period
                }
                onClick={() =>
                  void run(
                    () =>
                      bank.prepare(facilityId, worksheet.accountId, worksheet.id, {
                        periodCode: period,
                        reviewNotes: notes,
                        idempotencyKey: `bank-recon:${worksheet.id}:${period}`,
                      }),
                    'Reconciliation prepared for independent approval.',
                  )
                }
              >
                Prepare reviewed reconciliation
              </button>
            )}
          </div>
        )}
        {workspace?.reconciliations
          .filter((r) => !account || String(r.bankAccountId) === account)
          .map((r) => (
            <p key={r.id}>
              Reconciliation #{r.id} · import #{r.statementImportId} · {r.status} · difference{' '}
              {money(r.differenceKes)}{' '}
              {canManage && r.status !== 'APPROVED' && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => {
                    const note = window.prompt('Independent approval notes:');
                    if (note)
                      void run(
                        () => bank.approve(facilityId, r.id, note),
                        'Reconciliation independently approved after recomputing its worksheet.',
                      );
                  }}
                >
                  Independently approve
                </button>
              )}
            </p>
          ))}
      </section>
    </section>
  );
}

/** Bank-first entry point from an existing invoice; the cashier cannot issue an unverified receipt. */
export function BankPaymentEntry({ invoiceId }: { invoiceId: number }) {
  const { currentFacility, authenticatedUser, setActiveModule } = useHmis();
  const [data, setData] = useState<BankWorkspace | null>(null),
    [enabled, setEnabled] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const facilityId = currentFacility?.id;
  const allowed =
    authenticatedUser?.permissions?.includes('bank_payments.read') &&
    authenticatedUser.permissions.includes('bank_payments.submit') &&
    !authenticatedUser.isSuperAdmin;
  useEffect(() => {
    let current = true;
    if (allowed && facilityId)
      Promise.all([bank.workspace(facilityId), bank.policy(facilityId)])
        .then(([d, p]) => {
          if (current) {
            setData(d);
            setEnabled(p.bankOnly);
          }
        })
        .catch(() => {
          if (current)
            setError('Bank payment setup could not be loaded. No receipt can be issued here.');
        });
    return () => {
      current = false;
    };
  }, [allowed, facilityId]);
  const run: Run = async (fn, message) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      if (alive.current) setNotice(message);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Bank request failed.');
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section className={card}>
      <h2 className="font-bold">Bank payment</h2>
      <p>Unverified transfers do not settle this invoice.</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {allowed && data && facilityId ? (
        <BankPaymentForm
          key={invoiceId}
          data={data}
          selectedInvoiceId={invoiceId}
          enabled={enabled}
          busy={busy}
          run={run}
          facilityId={facilityId}
        />
      ) : (
        <p>Authorized staff record and review transfers in the Bank Payments workspace.</p>
      )}
      <button className={button} onClick={() => setActiveModule('payment_transactions')}>
        Open Bank Payments &amp; Reconciliation
      </button>
    </section>
  );
}
