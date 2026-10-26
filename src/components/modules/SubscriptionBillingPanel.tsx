import React, { useCallback, useEffect, useState } from 'react';
import { getSessionToken } from '../../api/client.ts';

type Period = {
  id: number;
  tenantId: number;
  facilityId: number;
  subscriptionName: string;
  amountDue: string | number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  gracePeriodEnd: string | null;
  status: string;
  notes?: string | null;
  facilityName?: string | null;
  facilityCode?: string | null;
  accessStatus?: string | null;
  suspensionReason?: string | null;
};

type Payment = {
  id: number;
  subscriptionPeriodId: number;
  transactionCode: string;
  amount: string | number;
  paymentDate: string;
  verificationStatus: string;
  verificationNotes?: string | null;
};

async function billingRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = getSessionToken();
  const response = await fetch(`/api/platform${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) {
    throw new Error(result.message || result.error || `Request failed (${response.status})`);
  }
  return result as T;
}

const fieldClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
const buttonClass =
  'rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50';
const primaryClass =
  'rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50';

export function SubscriptionBillingPanel() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [tenantId, setTenantId] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [subscriptionName, setSubscriptionName] = useState('Facility subscription');
  const [amountDue, setAmountDue] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [gracePeriodEnd, setGracePeriodEnd] = useState('');
  const [notes, setNotes] = useState('');

  const [transactionCode, setTransactionCode] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [verificationNotes, setVerificationNotes] = useState('');

  const [newAmount, setNewAmount] = useState('');
  const [effectiveTiming, setEffectiveTiming] = useState<'CURRENT_PERIOD' | 'NEXT_PERIOD'>(
    'NEXT_PERIOD',
  );
  const [priceReason, setPriceReason] = useState('');
  const [suspensionReason, setSuspensionReason] = useState('');

  const selectedPeriod = periods.find((period) => String(period.id) === selectedId);

  const loadPeriods = useCallback(async () => {
    setLoading(true);
    try {
      const result = await billingRequest<{ success: boolean; data: Period[] }>(
        '/subscription-periods',
      );
      const rows = Array.isArray(result.data) ? result.data : [];
      setPeriods(rows);
      setSelectedId((current) => {
        if (current && rows.some((row) => String(row.id) === current)) return current;
        return rows.length ? String(rows[0].id) : '';
      });
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load subscription periods.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPayments = useCallback(async () => {
    if (!selectedId) {
      setPayments([]);
      return;
    }
    try {
      const result = await billingRequest<{ success: boolean; data: Payment[] }>(
        `/subscription-periods/${selectedId}/payments`,
      );
      setPayments(Array.isArray(result.data) ? result.data : []);
    } catch (e) {
      setPayments([]);
      setError(e instanceof Error ? e.message : 'Could not load payments.');
    }
  }, [selectedId]);

  useEffect(() => {
    void loadPeriods();
  }, [loadPeriods]);

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  async function perform(label: string, action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(label);
      await loadPeriods();
      await loadPayments();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function createPeriod(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform('Subscription period created.', async () => {
      await billingRequest('/subscription-periods', 'POST', {
        tenantId: Number(tenantId),
        facilityId: Number(facilityId),
        subscriptionName: subscriptionName.trim(),
        amountDue,
        periodStart,
        periodEnd,
        dueDate,
        gracePeriodEnd: gracePeriodEnd || null,
        notes: notes.trim() || null,
      });
      setAmountDue('');
      setNotes('');
    });
  }

  async function recordPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    await perform('Payment recorded and awaiting verification.', async () => {
      await billingRequest(`/subscription-periods/${selectedId}/payments`, 'POST', {
        transactionCode: transactionCode.trim(),
        amount: paymentAmount,
        ...(paymentDate ? { paymentDate: new Date(paymentDate).toISOString() } : {}),
      });
      setTransactionCode('');
      setPaymentAmount('');
      setPaymentDate('');
    });
  }

  async function reviewPayment(paymentId: number, decision: 'VERIFIED' | 'REJECTED') {
    await perform(decision === 'VERIFIED' ? 'Payment verified.' : 'Payment rejected.', () =>
      billingRequest(`/subscription-payments/${paymentId}/verify`, 'POST', {
        decision,
        verificationNotes: verificationNotes.trim() || undefined,
      }),
    );
    setVerificationNotes('');
  }

  async function changePrice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    await perform('Subscription price change saved.', () =>
      billingRequest(`/subscription-periods/${selectedId}/price-changes`, 'POST', {
        newAmount,
        effectiveTiming,
        reason: priceReason.trim(),
      }),
    );
    setNewAmount('');
    setPriceReason('');
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Facility subscription billing</h2>
        <p className="mt-1 text-sm text-slate-600">
          Manage subscription periods, payment verification, negotiated fees and facility access.
          Only verified payments count toward the balance.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}
      {message && (
        <div
          role="status"
          className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800"
        >
          {message}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">Subscription periods</h3>
          <button
            type="button"
            className={buttonClass}
            disabled={loading || busy}
            onClick={() => void loadPeriods()}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <label className="mb-1 block text-sm font-medium" htmlFor="billing-period">
          Select a period
        </label>
        <select
          id="billing-period"
          className={fieldClass}
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">No subscription period found</option>
          {periods.map((period) => (
            <option key={period.id} value={String(period.id)}>
              #{period.id} · {period.facilityName || `Facility ${period.facilityId}`} ·{' '}
              {period.subscriptionName} · {period.currency} {period.amountDue} · {period.status}
            </option>
          ))}
        </select>

        {selectedPeriod && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Facility / tenant</div>
              <div className="font-medium">
                {selectedPeriod.facilityName || `Facility ${selectedPeriod.facilityId}`}
              </div>
              <div className="text-sm text-slate-600">Tenant ID: {selectedPeriod.tenantId}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Subscription fee</div>
              <div className="font-medium">
                {selectedPeriod.currency} {selectedPeriod.amountDue}
              </div>
              <div className="text-sm text-slate-600">Status: {selectedPeriod.status}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Period / due date</div>
              <div className="font-medium">
                {selectedPeriod.periodStart} to {selectedPeriod.periodEnd}
              </div>
              <div className="text-sm text-slate-600">Due: {selectedPeriod.dueDate}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 sm:col-span-2 lg:col-span-3">
              <div className="text-xs text-slate-500">Facility access</div>
              <div className="font-medium">
                {selectedPeriod.accessStatus || 'No access-control record'}
              </div>
              {selectedPeriod.suspensionReason && (
                <div className="text-sm text-slate-600">
                  Reason: {selectedPeriod.suspensionReason}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 p-4">
        <h3 className="mb-3 font-semibold">Create subscription period</h3>
        <p className="mb-3 text-sm text-slate-600">
          Use the existing numeric tenant and facility IDs. The server validates that the facility
          belongs to the tenant.
        </p>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={createPeriod}>
          <input
            className={fieldClass}
            type="number"
            min="1"
            required
            placeholder="Tenant ID"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
          />
          <input
            className={fieldClass}
            type="number"
            min="1"
            required
            placeholder="Facility ID"
            value={facilityId}
            onChange={(e) => setFacilityId(e.target.value)}
          />
          <input
            className={fieldClass}
            required
            placeholder="Subscription name / plan"
            value={subscriptionName}
            onChange={(e) => setSubscriptionName(e.target.value)}
          />
          <input
            className={fieldClass}
            required
            type="number"
            min="0.01"
            step="0.01"
            placeholder="Total fee (KES)"
            value={amountDue}
            onChange={(e) => setAmountDue(e.target.value)}
          />
          <label className="text-sm">
            Period start
            <input
              className={fieldClass}
              required
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Period end
            <input
              className={fieldClass}
              required
              type="date"
              min={periodStart || undefined}
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Payment due date
            <input
              className={fieldClass}
              required
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Grace period end (optional)
            <input
              className={fieldClass}
              type="date"
              value={gracePeriodEnd}
              onChange={(e) => setGracePeriodEnd(e.target.value)}
            />
          </label>
          <input
            className={fieldClass}
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="sm:col-span-2 lg:col-span-3">
            <button className={primaryClass} disabled={busy} type="submit">
              {busy ? 'Saving…' : 'Create period'}
            </button>
          </div>
        </form>
      </section>

      {selectedPeriod && (
        <>
          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="mb-3 font-semibold">Record a payment</h3>
            <p className="mb-3 text-sm text-slate-600">
              New M-Pesa transaction codes stay pending until a Super Admin verifies them.
            </p>
            <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={recordPayment}>
              <input
                className={fieldClass}
                required
                maxLength={100}
                placeholder="M-Pesa transaction code"
                value={transactionCode}
                onChange={(e) => setTransactionCode(e.target.value)}
              />
              <input
                className={fieldClass}
                required
                type="number"
                min="0.01"
                step="0.01"
                placeholder="Amount received (KES)"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
              <label className="text-sm">
                Payment date (optional)
                <input
                  className={fieldClass}
                  type="datetime-local"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
              </label>
              <div>
                <button className={primaryClass} disabled={busy} type="submit">
                  Record payment
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="mb-3 font-semibold">Payment history and verification</h3>
            <label className="mb-3 block text-sm">
              Verification notes (optional)
              <input
                className={fieldClass}
                value={verificationNotes}
                onChange={(e) => setVerificationNotes(e.target.value)}
                placeholder="Reason or reference for the decision"
              />
            </label>
            {payments.length === 0 ? (
              <p className="text-sm text-slate-600">No payment records found for this period.</p>
            ) : (
              <div className="space-y-3">
                {payments.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex flex-col justify-between gap-3 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-center"
                  >
                    <div>
                      <div className="font-medium">{payment.transactionCode}</div>
                      <div className="text-sm text-slate-600">
                        KES {payment.amount} ·{' '}
                        {payment.paymentDate
                          ? new Date(payment.paymentDate).toLocaleString()
                          : 'Date unavailable'}
                      </div>
                      <div className="text-sm">
                        Verification:{' '}
                        <span className="font-medium">{payment.verificationStatus}</span>
                      </div>
                      {payment.verificationNotes && (
                        <div className="text-sm text-slate-600">{payment.verificationNotes}</div>
                      )}
                    </div>
                    {payment.verificationStatus === 'PENDING' && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={primaryClass}
                          disabled={busy}
                          onClick={() => void reviewPayment(payment.id, 'VERIFIED')}
                        >
                          Verify
                        </button>
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={busy}
                          onClick={() => void reviewPayment(payment.id, 'REJECTED')}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="mb-3 font-semibold">Change negotiated subscription fee</h3>
            <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={changePrice}>
              <input
                className={fieldClass}
                required
                type="number"
                min="0.01"
                step="0.01"
                placeholder="New fee (KES)"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
              />
              <select
                className={fieldClass}
                value={effectiveTiming}
                onChange={(e) =>
                  setEffectiveTiming(e.target.value as 'CURRENT_PERIOD' | 'NEXT_PERIOD')
                }
              >
                <option value="NEXT_PERIOD">Apply next period</option>
                <option value="CURRENT_PERIOD">Apply to current period</option>
              </select>
              <input
                className={fieldClass}
                required
                maxLength={1000}
                placeholder="Reason for price change"
                value={priceReason}
                onChange={(e) => setPriceReason(e.target.value)}
              />
              <div className="sm:col-span-2 lg:col-span-3">
                <button className={primaryClass} disabled={busy} type="submit">
                  Save price change
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="mb-2 font-semibold">Facility access control</h3>
            <p className="mb-3 text-sm text-slate-600">
              Suspension and reactivation requests are subject to server-side overdue, grace-period
              and verified-payment checks.
            </p>
            <label className="mb-3 block text-sm">
              Suspension reason
              <input
                className={fieldClass}
                maxLength={1000}
                value={suspensionReason}
                onChange={(e) => setSuspensionReason(e.target.value)}
                placeholder="Explain why access should be suspended"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClass}
                disabled={busy || selectedPeriod.accessStatus === 'SUSPENDED'}
                onClick={() => {
                  if (!suspensionReason.trim()) {
                    setError('Enter a suspension reason first.');
                    return;
                  }
                  void perform('Suspension request submitted.', () =>
                    billingRequest(`/subscription-periods/${selectedPeriod.id}/suspend`, 'POST', {
                      reason: suspensionReason.trim(),
                    }),
                  );
                }}
              >
                Suspend facility
              </button>
              <button
                type="button"
                className={primaryClass}
                disabled={busy || selectedPeriod.accessStatus !== 'SUSPENDED'}
                onClick={() =>
                  void perform('Reactivation request submitted.', () =>
                    billingRequest(
                      `/subscription-periods/${selectedPeriod.id}/reactivate`,
                      'POST',
                      {},
                    ),
                  )
                }
              >
                Reactivate facility
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
