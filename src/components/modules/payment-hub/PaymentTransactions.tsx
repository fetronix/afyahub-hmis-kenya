import React, { useCallback, useEffect, useRef, useState } from 'react';
import { paymentHubApi, type HubTransaction } from '../../../api/payment-hub.client.ts';
import { useHmis } from '../../../context/HmisContext.tsx';
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const button =
  'rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50';
const secondary =
  'rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50';
const card = 'rounded-xl border border-slate-200 bg-white p-4 space-y-3';
type Run = (action: () => Promise<unknown>, message: string) => Promise<void>;
function money(cents: string) {
  const n = Number(cents);
  return Number.isSafeInteger(n)
    ? `${Math.floor(n / 100).toLocaleString()}.${String(n % 100).padStart(2, '0')}`
    : '—';
}
export const PaymentTransactions: React.FC = () => {
  const { currentFacility, authenticatedUser } = useHmis();
  const permissions = new Set(authenticatedUser?.permissions ?? []);
  const canRead = permissions.has('payment_hub.transactions.read'),
    canInitiate = permissions.has('payment_hub.collection.initiate'),
    canVerify = permissions.has('payment_hub.payments.verify'),
    canReconcile = permissions.has('payment_hub.reconciliation.manage');
  const [scopedData, setScopedData] = useState<{
    facilityId: number;
    data: Awaited<ReturnType<typeof paymentHubApi.transactions>>;
  } | null>(null);
  const data = scopedData && scopedData.facilityId === currentFacility?.id ? scopedData.data : null;
  const requestVersion = useRef(0);
  const activeFacilityId = currentFacility?.id;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    integrationId: '',
    invoiceId: '',
    amountKes: '',
    phone: '',
    allowOverpayment: false,
  });
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [submitted, setSubmitted] = useState(false);
  const [separateReviewed, setSeparateReviewed] = useState(false);
  const load = useCallback(async () => {
    if (!activeFacilityId || !canRead) return;
    const version = ++requestVersion.current;
    setError('');
    try {
      const result = await paymentHubApi.transactions(activeFacilityId);
      if (version === requestVersion.current)
        setScopedData({ facilityId: activeFacilityId, data: result });
    } catch (e) {
      if (version === requestVersion.current)
        setError(e instanceof Error ? e.message : 'Unable to load transactions.');
    }
  }, [activeFacilityId, canRead]);
  useEffect(() => {
    setScopedData(null);
    setNotice('');
    setForm({
      integrationId: '',
      invoiceId: '',
      amountKes: '',
      phone: '',
      allowOverpayment: false,
    });
    setKey(crypto.randomUUID());
    setSubmitted(false);
    setSeparateReviewed(false);
    void load();
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);
  const run: Run = async (action, message) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed.');
    } finally {
      setBusy(false);
    }
  };
  if (!canRead) return <div className={card}>Transaction-view permission is required.</div>;
  if (!currentFacility)
    return <div className={card}>No authorized active facility is selected.</div>;
  const facilityId = currentFacility.id;
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          Payment Transactions &amp; Reconciliation
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {currentFacility.name} · Sandbox activity is separate from real receipts.
        </p>
      </div>
      <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
        An accepted request and a callback are not proof of payment. Callbacks are unverified hints;
        no payment request automatically creates a receipt or changes an invoice.
      </p>
      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      {canInitiate && (
        <details className={card}>
          <summary className="cursor-pointer font-semibold">
            Initiate a Daraja sandbox request
          </summary>
          <p className="text-xs text-slate-500">
            Use an enabled sandbox integration ID and an invoice in this facility. Only whole KES is
            supported. An uncertain request must be reviewed before attempting a new one.
          </p>
          <form
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const result = await paymentHubApi.collect(
                  { ...form, facilityId, confirmSeparateRequest: separateReviewed },
                  key,
                );
                setSubmitted(true);
                setForm((f) => ({ ...f, phone: '' }));
                setNotice(result.notice);
              }, 'Request recorded. Check its status below; no invoice was paid.');
            }}
          >
            <label className="text-xs">
              Integration ID
              <input
                className={field}
                required
                inputMode="numeric"
                value={form.integrationId}
                onChange={(e) => setForm({ ...form, integrationId: e.target.value })}
              />
            </label>
            <label className="text-xs">
              Invoice ID
              <input
                className={field}
                required
                inputMode="numeric"
                value={form.invoiceId}
                onChange={(e) => setForm({ ...form, invoiceId: e.target.value })}
              />
            </label>
            <label className="text-xs">
              Amount (whole KES)
              <input
                className={field}
                required
                inputMode="numeric"
                value={form.amountKes}
                onChange={(e) => setForm({ ...form, amountKes: e.target.value })}
              />
            </label>
            <label className="text-xs">
              Phone (254 format)
              <input
                className={field}
                required
                autoComplete="off"
                inputMode="numeric"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={form.allowOverpayment}
                onChange={(e) => setForm({ ...form, allowOverpayment: e.target.checked })}
              />
              Explicitly allow overpayment
            </label>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={separateReviewed}
                onChange={(e) => setSeparateReviewed(e.target.checked)}
              />
              I reviewed any earlier request and intend a separate request
            </label>
            <button className={button} disabled={busy || submitted}>
              Request sandbox STK
            </button>
            {submitted && (
              <button
                type="button"
                className={secondary}
                onClick={() => {
                  if (
                    window.confirm(
                      'Review the previous request first. Start a separate request with a new idempotency key?',
                    )
                  ) {
                    setSubmitted(false);
                    setSeparateReviewed(true);
                    setKey(crypto.randomUUID());
                  }
                }}
              >
                Start a separate request
              </button>
            )}
          </form>
        </details>
      )}
      {!data && !error && <p className="text-sm text-slate-500">Loading transactions…</p>}
      {data?.transactions.length === 0 && (
        <p className={card}>No provider transactions recorded for this facility.</p>
      )}
      {data?.transactions.map((t) => (
        <Transaction
          key={t.id}
          transaction={t}
          facilityId={facilityId}
          canVerify={canVerify}
          canReconcile={canReconcile}
          busy={busy}
          run={run}
        />
      ))}
      {data && (
        <div className={card}>
          <h2 className="font-semibold">Notifications</h2>
          {data.notifications.length === 0 ? (
            <p className="text-xs text-slate-500">No notifications.</p>
          ) : (
            data.notifications.map((e) => (
              <p key={e.id} className="text-xs text-slate-600">
                Request #{e.transactionId} · {e.verificationState} · result{' '}
                {e.resultCode ?? 'unknown'} · {new Date(e.receivedAt).toLocaleString()}
              </p>
            ))
          )}
        </div>
      )}
      {data && (
        <div className={card}>
          <h2 className="font-semibold">Reconciliation history</h2>
          {data.reconciliations.length === 0 ? (
            <p className="text-xs text-slate-500">No reconciliation reviews.</p>
          ) : (
            data.reconciliations.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span>
                  #{r.id} · transaction #{r.transactionId} · receipt #{r.billingPaymentId} ·{' '}
                  {r.status}
                </span>
                {canReconcile && r.status === 'MATCHED' && (
                  <button
                    className={secondary}
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Void this match? The existing receipt and invoice will not be changed.',
                        )
                      )
                        void run(
                          () => paymentHubApi.voidMatch(r.id, facilityId, 'WRONG_RECEIPT'),
                          'Match voided; receipt and invoice unchanged.',
                        );
                    }}
                  >
                    Void incorrect match
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
};
function Transaction({
  transaction: t,
  facilityId,
  canVerify,
  canReconcile,
  busy,
  run,
}: {
  transaction: HubTransaction;
  facilityId: number;
  canVerify: boolean;
  canReconcile: boolean;
  busy: boolean;
  run: Run;
}) {
  const [match, setMatch] = useState({
    billingPaymentId: '',
    verifiedReference: '',
    evidenceReference: '',
    attested: false,
  });
  return (
    <article className={card}>
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <h3 className="font-semibold">
            {t.provider} · request #{t.id}
          </h3>
          <p className="text-xs text-slate-500">
            {t.environment} · invoice {t.invoiceNumber} · requested KES{' '}
            {money(t.requestedAmountCents)}
          </p>
        </div>
        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold">
          {t.status.replaceAll('_', ' ')}
        </span>
      </div>
      <p className="text-xs text-slate-600">
        Provider request: {t.providerRequestId ?? 'not available'} · Unverified notifications:{' '}
        {t.unverifiedNotifications} · Last query:{' '}
        {t.lastQueryAt ? new Date(t.lastQueryAt).toLocaleString() : 'not checked'}
      </p>
      {canVerify && (
        <button
          className={secondary}
          disabled={busy || !t.providerRequestId}
          onClick={() =>
            void run(async () => {
              const result = await paymentHubApi.query(t.id, facilityId);
              if (result.status === 'REVIEW_REQUIRED')
                throw new Error('Conflicting status requires manual review.');
            }, 'Status query completed; no receipt or invoice was changed.')
          }
        >
          Query provider status
        </button>
      )}
      {canReconcile && (
        <details className="rounded bg-slate-50 p-3">
          <summary className="cursor-pointer text-xs font-semibold">
            Review an existing receipt
          </summary>
          <p className="my-2 text-xs text-slate-500">
            Only independently checked, provider-confirmed production transactions may be matched.
            This links an existing receipt and creates no payment. Sandbox transactions are refused.
          </p>
          <form
            className="grid gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await paymentHubApi.reconcile(t.id, { ...match, facilityId });
                setMatch({
                  billingPaymentId: '',
                  verifiedReference: '',
                  evidenceReference: '',
                  attested: false,
                });
              }, 'Receipt match recorded; no invoice or receipt was changed.');
            }}
          >
            <label className="text-xs">
              Existing receipt ID
              <input
                className={field}
                required
                inputMode="numeric"
                value={match.billingPaymentId}
                onChange={(e) => setMatch({ ...match, billingPaymentId: e.target.value })}
              />
            </label>
            <label className="text-xs">
              Independently verified provider reference
              <input
                className={field}
                required
                value={match.verifiedReference}
                onChange={(e) => setMatch({ ...match, verifiedReference: e.target.value })}
              />
            </label>
            <label className="text-xs">
              Evidence reference
              <input
                className={field}
                required
                value={match.evidenceReference}
                onChange={(e) => setMatch({ ...match, evidenceReference: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={match.attested}
                onChange={(e) => setMatch({ ...match, attested: e.target.checked })}
              />
              I reviewed the provider statement and receipt independently.
            </label>
            <button
              className={button}
              disabled={
                busy ||
                !match.attested ||
                t.environment !== 'PRODUCTION' ||
                t.status !== 'PROVIDER_CONFIRMED'
              }
            >
              Match existing receipt
            </button>
          </form>
        </details>
      )}
    </article>
  );
}
