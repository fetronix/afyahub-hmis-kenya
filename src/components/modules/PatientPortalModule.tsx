/**
 * JaliCare HMIS
 * Patient portal management — facility administration
 *
 * This is the staff-side control room for the patient portal. It is
 * deliberately not part of the patient interface: nothing here is
 * reachable from `/portal`, and nothing here is rendered for a patient
 * session.
 *
 * Every figure on the overview is counted by the server from this
 * facility's rows. The page never shows a benchmark, a target or an
 * "industry average", because there is no such number in this build and
 * inventing one would make a screenshot look better than the system is.
 */

import React, { useCallback, useEffect, useState } from 'react';

import { useHmis } from '../../context/HmisContext.tsx';

import {
  portalAdminApi,
  PortalApiError,
  type PortalAccountDetail,
  type PortalAccountRow,
  type PortalAdminOverview,
  type PortalPolicy,
} from '../../api/portal-client.ts';

import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  KeyRound,
  Loader2,
  Lock,
  QrCode,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react';

/* ============================================================
   Helpers
   ============================================================ */

type AdminTab = 'overview' | 'accounts' | 'settings' | 'audit' | 'card';

const TABS: Array<{ id: AdminTab; label: string; icon: React.ElementType }> = [
  { id: 'overview', label: 'Overview', icon: Users },
  { id: 'accounts', label: 'Accounts', icon: UserRound },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'audit', label: 'Audit', icon: ShieldAlert },
  { id: 'card', label: 'Card lookup', icon: QrCode },
];

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof PortalApiError) {
    if (error.status === 403) {
      return 'Your account does not hold the permission for this action.';
    }

    return error.message;
  }

  if (error instanceof Error) return error.message;

  return 'The request could not be completed.';
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'ACTIVE'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : status === 'SUSPENDED'
        ? 'border-ember-200 bg-ember-50 text-ember-900'
        : status === 'REVOKED'
          ? 'border-rose-200 bg-rose-50 text-rose-800'
          : 'border-brand-200 bg-brand-50 text-brand-900';

  return (
    <span
      className={cx('inline-flex rounded-full border px-2 py-0.5 text-2xs font-semibold', tone)}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: 'default' | 'warn' | 'good';
}) {
  return (
    <div className="panel px-4 py-3">
      <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p
        className={cx(
          'stat-value mt-1',
          tone === 'warn' && 'text-ember-700',
          tone === 'good' && 'text-emerald-700',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-2xs leading-relaxed text-slate-500">{hint}</p> : null}
    </div>
  );
}

/* ============================================================
   Overview
   ============================================================ */

function OverviewTab({ onOpenAccount }: { onOpenAccount: () => void }) {
  const [data, setData] = useState<PortalAdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      setData(await portalAdminApi.overview());
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-xs text-ink-soft">
        <Loader2 className="h-4 w-4 animate-spin" /> Counting this facility's portal records…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-900">
        {error}
      </div>
    );
  }

  const activated = data.invitations.activated;
  const delivered = data.invitations.pending + activated;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Patients at this facility"
          value={data.eligiblePatients}
          hint="Registered here. This is the population an invitation could reach."
        />
        <Stat
          label="Invited"
          value={data.invitedPatients}
          hint={`${data.accountsTotal} account${data.accountsTotal === 1 ? '' : 's'} created from those invitations.`}
        />
        <Stat
          label="Active accounts"
          value={data.activeAccounts}
          tone="good"
          hint="Signed up and not suspended or revoked."
        />
        <Stat
          label="Pending verification"
          value={data.pendingVerificationAccounts}
          tone={data.pendingVerificationAccounts > 0 ? 'warn' : 'default'}
          hint="Activation stopped because identity must be confirmed at the desk."
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Suspended"
          value={data.suspendedAccounts}
          hint="Access paused; record untouched."
        />
        <Stat label="Revoked" value={data.revokedAccounts} hint="Access ended permanently." />
        <Stat
          label="Invitations waiting"
          value={data.invitations.pending}
          hint="Issued, unexpired and not yet used."
        />
        <Stat
          label="Delivery failed"
          value={data.invitations.failedDelivery + data.invitations.notConfigured}
          tone={
            data.invitations.failedDelivery + data.invitations.notConfigured > 0
              ? 'warn'
              : 'default'
          }
          hint={`${data.invitations.notConfigured} had no provider configured — those were never sent.`}
        />
      </div>

      <section className="panel">
        <header className="panel-header">
          <h2 className="text-sm font-semibold text-ink">Invitation states</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            An invitation is one row through its life. Delivery is tracked separately from
            activation: a message a provider accepted is not an activated account, and this page
            never treats it as one.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-2 px-4 py-4 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['Waiting', data.invitations.pending],
            ['Activated', activated],
            ['Expired', data.invitations.expired],
            ['Revoked', data.invitations.revoked],
            ['Superseded', data.invitations.superseded],
            ['Never sent', data.invitations.notConfigured],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-2xs uppercase tracking-wide text-slate-500">{label}</p>
              <p className="font-mono text-lg font-semibold text-ink">{value}</p>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-100 px-4 py-3 text-2xs leading-relaxed text-slate-500">
          {delivered === 0
            ? 'No invitation has been delivered yet. Manual handover at the desk is the only channel available until a messaging provider is configured.'
            : `${delivered} invitation${delivered === 1 ? '' : 's'} reached the waiting or activated state.`}
        </div>
      </section>

      {data.recentAccountEvents.length > 0 ? (
        <section className="panel">
          <header className="panel-header">
            <h2 className="text-sm font-semibold text-ink">Recent account administration</h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              Actions taken by staff, from the audit trail. Reading this page does not create an
              entry; reading the Audit tab does.
            </p>
          </header>

          <ul className="divide-y divide-slate-100 px-4">
            {data.recentAccountEvents.map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-3 py-2.5">
                <div>
                  <p className="text-xs font-semibold text-ink">
                    {event.action} · {event.resource}
                  </p>
                  <p className="text-2xs text-ink-soft">{event.details ?? '—'}</p>
                </div>
                <span className="whitespace-nowrap text-2xs text-slate-500">
                  {formatDateTime(event.timestamp)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel">
        <header className="panel-header">
          <h2 className="text-sm font-semibold text-ink">Invitation events</h2>
        </header>

        {data.recentEvents.length === 0 ? (
          <p className="px-4 py-4 text-xs text-ink-soft">No invitation has been issued yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 px-4">
            {data.recentEvents.map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-3 py-2.5">
                <div>
                  <p className="text-xs font-semibold text-ink">{event.eventType}</p>
                  <p className="text-2xs text-ink-soft">{event.detail ?? '—'}</p>
                </div>
                <span className="whitespace-nowrap text-2xs text-slate-500">
                  {formatDateTime(event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-xs text-brand-900">
        <span>{data.note}</span>
        <button type="button" className="btn-quiet" onClick={onOpenAccount}>
          Search accounts
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   Accounts
   ============================================================ */

function AccountsTab() {
  const { showToast } = useHmis();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<PortalAccountRow[]>([]);
  const [detail, setDetail] = useState<PortalAccountDetail | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const result = await portalAdminApi.accounts({
        search: search.trim() || undefined,
        status: status || undefined,
        limit: 50,
      });

      setRows(result.accounts);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (accountId: number) => {
    setBusy(true);

    try {
      setDetail(await portalAdminApi.accountDetail(accountId));
      setReason('');
    } catch (caught) {
      showToast(errorMessage(caught), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: 'suspend' | 'reactivate' | 'revoke' | 'reset') => {
    if (!detail) return;

    setBusy(true);

    try {
      if (action === 'reset') {
        const result = await portalAdminApi.forceReset(detail.account.id);

        showToast(`Password reset forced. ${result.sessionsRevoked} session(s) signed out.`, {
          tone: 'success',
        });
      } else {
        const result =
          action === 'suspend'
            ? await portalAdminApi.suspend(detail.account.id, reason)
            : action === 'reactivate'
              ? await portalAdminApi.reactivate(detail.account.id, reason)
              : await portalAdminApi.revoke(detail.account.id, reason);

        showToast(`Account is now ${String(result.status).toLowerCase()}.`, {
          tone: 'success',
        });
      }

      setDetail(await portalAdminApi.accountDetail(detail.account.id));
      setReason('');
      await load();
    } catch (caught) {
      showToast(errorMessage(caught), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="panel">
        <header className="panel-header">
          <h2 className="text-sm font-semibold text-ink">Portal accounts at this facility</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Search by record number, first or last name. The sign-in identifier is masked: an
            administrator does not need the full number to manage an account.
          </p>
        </header>

        <div className="flex flex-wrap items-end gap-2 px-4 pb-3">
          <label className="min-w-[220px] flex-1">
            <span className="field-label">Search</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="field-input pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Record number or name"
              />
            </div>
          </label>

          <label>
            <span className="field-label">Status</span>
            <select
              className="field-input w-[180px]"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="PENDING_VERIFICATION">Pending verification</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="REVOKED">Revoked</option>
            </select>
          </label>

          <button
            type="button"
            className="btn-quiet"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={cx('h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>

        {error ? (
          <p className="px-4 pb-3 text-xs text-rose-700">{error}</p>
        ) : loading ? (
          <p className="px-4 pb-4 text-xs text-ink-soft">Reading accounts…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 pb-4 text-xs text-ink-soft">
            No portal account matches this search. Patients are invited from the reception screen,
            not created here.
          </p>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="table-quiet w-full min-w-[720px]">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Record no.</th>
                  <th>Sign-in</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.accountId}>
                    <td>
                      {row.firstName} {row.lastName}
                    </td>
                    <td className="font-mono text-2xs">{row.mrn}</td>
                    <td className="text-2xs">{row.maskedIdentifier ?? '—'}</td>
                    <td>
                      <StatusPill status={row.status} />
                    </td>
                    <td className="text-2xs">{formatDateTime(row.lastLoginAt)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn-quiet"
                        onClick={() => void openDetail(row.accountId)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {detail ? (
        <section className="panel">
          <header className="panel-header flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">
                {detail.patient.firstName} {detail.patient.lastName}
              </h2>
              <p className="mt-0.5 text-xs text-ink-soft">
                Record {detail.patient.mrn} · {detail.account.maskedIdentifier ?? 'no identifier'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <StatusPill status={detail.account.status} />
              <button type="button" className="btn-quiet" onClick={() => setDetail(null)}>
                Close
              </button>
            </div>
          </header>

          <div className="grid gap-4 px-4 py-4 lg:grid-cols-2">
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-2xs uppercase tracking-wide text-slate-500">Activated</dt>
                  <dd className="text-ink">{formatDateTime(detail.account.activatedAt)}</dd>
                </div>
                <div>
                  <dt className="text-2xs uppercase tracking-wide text-slate-500">Last sign-in</dt>
                  <dd className="text-ink">{formatDateTime(detail.account.lastLoginAt)}</dd>
                </div>
                <div>
                  <dt className="text-2xs uppercase tracking-wide text-slate-500">Suspended</dt>
                  <dd className="text-ink">{formatDateTime(detail.account.suspendedAt)}</dd>
                </div>
                <div>
                  <dt className="text-2xs uppercase tracking-wide text-slate-500">Revoked</dt>
                  <dd className="text-ink">{formatDateTime(detail.account.revokedAt)}</dd>
                </div>
                <div>
                  <dt className="text-2xs uppercase tracking-wide text-slate-500">Digital card</dt>
                  <dd className="text-ink">{detail.account.hasDigitalCard ? 'Issued' : 'None'}</dd>
                </div>
                <div>
                  <dt className="text-2xs uppercase tracking-wide text-slate-500">Live sessions</dt>
                  <dd className="text-ink">
                    {detail.sessions.filter((session) => !session.revokedAt).length}
                  </dd>
                </div>
              </dl>

              <label className="block">
                <span className="field-label">Reason (recorded in the audit trail)</span>
                <input
                  className="field-input"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="e.g. Patient asked to pause access while her phone is replaced"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                {detail.account.status === 'ACTIVE' ? (
                  <button
                    type="button"
                    className="btn-quiet"
                    disabled={busy}
                    onClick={() => void act('suspend')}
                  >
                    <Lock className="h-4 w-4" />
                    Suspend
                  </button>
                ) : null}

                {detail.account.status === 'SUSPENDED' ? (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => void act('reactivate')}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Reactivate
                  </button>
                ) : null}

                {detail.account.status !== 'REVOKED' ? (
                  <button
                    type="button"
                    className="btn-quiet text-rose-700"
                    disabled={busy}
                    onClick={() => void act('revoke')}
                  >
                    <ShieldAlert className="h-4 w-4" />
                    Revoke
                  </button>
                ) : null}

                <button
                  type="button"
                  className="btn-quiet"
                  disabled={busy}
                  onClick={() => void act('reset')}
                >
                  <KeyRound className="h-4 w-4" />
                  Force password reset
                </button>
              </div>

              <p className="text-2xs leading-relaxed text-slate-500">
                Suspension pauses portal access only. The clinical record is not changed and nothing
                is deleted. Revocation is permanent; the way back is a fresh invitation, which
                re-establishes identity.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <p className="eyebrow">Invitations</p>

                <ul className="mt-2 space-y-1.5">
                  {detail.invitations.length === 0 ? (
                    <li className="text-xs text-ink-soft">None.</li>
                  ) : (
                    detail.invitations.map((invitation) => (
                      <li
                        key={invitation.id}
                        className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-2"
                      >
                        <div>
                          <p className="text-2xs font-semibold text-ink">
                            {invitation.purpose} · {invitation.deliveryChannel}
                          </p>
                          <p className="text-2xs text-ink-soft">
                            {invitation.effectiveStatus} · delivery {invitation.deliveryStatus}
                          </p>
                          <p className="text-2xs text-slate-500">
                            Issued {formatDateTime(invitation.createdAt)}
                          </p>
                        </div>
                        <span className="whitespace-nowrap text-2xs text-slate-500">
                          {formatDateTime(invitation.expiresAt)}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </div>

              <div>
                <p className="eyebrow">Sessions</p>

                <ul className="mt-2 space-y-1.5">
                  {detail.sessions.length === 0 ? (
                    <li className="text-xs text-ink-soft">No session has been created.</li>
                  ) : (
                    detail.sessions.map((session) => (
                      <li key={session.id} className="rounded-lg bg-slate-50 px-2.5 py-2 text-2xs">
                        Started {formatDateTime(session.createdAt)} · expires{' '}
                        {formatDateTime(session.expiresAt)}
                        {session.revokedAt ? ' · revoked' : ''}
                      </li>
                    ))
                  )}
                </ul>
              </div>

              <div>
                <p className="eyebrow">Events</p>

                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {detail.events.map((event, index) => (
                    <li key={`${event.createdAt}-${index}`} className="text-2xs text-ink-soft">
                      {formatDateTime(event.createdAt)} · {event.eventType}
                      {event.detail ? ` · ${event.detail}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <RiskReview />
    </div>
  );
}

/* ============================================================
   Risk review
   ============================================================ */

/**
 * What an administrator should look at, not what the system should fix.
 *
 * A shared phone number is ordinary in one household. The panel says so,
 * because a list of "risks" that implies guilt is worse than no list.
 */
function RiskReview() {
  const [data, setData] = useState<{
    sharedIdentifiers: Array<{ masked: string | null; accounts: number }>;
    pendingVerification: Array<{ accountId: number; patientId: number; status: string }>;
    note: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await portalAdminApi.risks();

        if (!cancelled) setData(result);
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="panel">
      <header className="panel-header">
        <h2 className="text-sm font-semibold text-ink">Review list</h2>
        <p className="mt-0.5 text-xs text-ink-soft">
          Accounts a person should look at. Nothing here is corrected automatically.
        </p>
      </header>

      <div className="space-y-3 px-4 py-4">
        {loading ? <p className="text-xs text-ink-soft">Reading…</p> : null}

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-900">
            {error}
          </div>
        ) : null}

        {data ? (
          <>
            <div>
              <p className="eyebrow">Shared sign-in identifiers</p>

              {data.sharedIdentifiers.length === 0 ? (
                <p className="mt-1 text-2xs text-ink-soft">
                  No identifier is shared by more than one account in this facility.
                </p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {data.sharedIdentifiers.map((row) => (
                    <li key={row.masked ?? 'unknown'} className="text-2xs text-ink-soft">
                      <span className="font-mono">{row.masked ?? 'unknown'}</span> · {row.accounts}{' '}
                      accounts
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="eyebrow">Awaiting identity verification</p>

              {data.pendingVerification.length === 0 ? (
                <p className="mt-1 text-2xs text-ink-soft">None.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {data.pendingVerification.map((row) => (
                    <li key={row.accountId} className="text-2xs text-ink-soft">
                      Account #{row.accountId} · patient #{row.patientId} · {row.status}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-2xs leading-relaxed text-slate-600">
              {data.note}
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}

/* ============================================================
   Settings
   ============================================================ */

function SettingsTab() {
  const { showToast } = useHmis();

  const [policy, setPolicy] = useState<PortalPolicy | null>(null);
  const [bounds, setBounds] = useState({ minExpiryHours: 4, maxExpiryHours: 336, maxResends: 10 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [settings, overview] = await Promise.all([
          portalAdminApi.getSettings(),
          portalAdminApi.overview(),
        ]);

        if (cancelled) return;

        setPolicy(settings.policy);
        setBounds(overview.policyBounds);
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    if (!policy) return;

    setSaving(true);

    try {
      const result = await portalAdminApi.saveSettings(policy);
      setPolicy(result.policy);
      showToast('Portal settings saved.', { tone: 'success' });
    } catch (caught) {
      showToast(errorMessage(caught), { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="py-6 text-xs text-ink-soft">Reading portal settings…</p>;
  }

  if (error || !policy) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-900">
        {error ?? 'Settings could not be read.'}
      </div>
    );
  }

  const toggle = (key: keyof PortalPolicy) => (
    <label
      key={key}
      className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5"
    >
      <span>
        <span className="block text-xs font-semibold text-ink">{LABELS[key].label}</span>
        <span className="mt-0.5 block text-2xs leading-relaxed text-slate-500">
          {LABELS[key].hint}
        </span>
      </span>

      <input
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
        checked={Boolean(policy[key])}
        onChange={(event) => setPolicy({ ...policy, [key]: event.target.checked })}
      />
    </label>
  );

  return (
    <div className="space-y-4">
      <section className="panel">
        <header className="panel-header">
          <h2 className="text-sm font-semibold text-ink">Invitation policy</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            These bounds are enforced on the server. Typing a larger number here does not widen it —
            the saved value comes back clamped.
          </p>
        </header>

        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
          <label>
            <span className="field-label">Invitation lifetime (hours)</span>
            <input
              type="number"
              className="field-input"
              min={bounds.minExpiryHours}
              max={bounds.maxExpiryHours}
              value={policy.invitationExpiryHours}
              onChange={(event) =>
                setPolicy({ ...policy, invitationExpiryHours: Number(event.target.value) })
              }
            />
            <span className="mt-1 block text-2xs text-slate-500">
              {bounds.minExpiryHours}–{bounds.maxExpiryHours} hours. A link that never expires is
              not an option this build offers.
            </span>
          </label>

          <label>
            <span className="field-label">Resends allowed per invitation</span>
            <input
              type="number"
              className="field-input"
              min={0}
              max={bounds.maxResends}
              value={policy.maxResends}
              onChange={(event) => setPolicy({ ...policy, maxResends: Number(event.target.value) })}
            />
            <span className="mt-1 block text-2xs text-slate-500">
              0–{bounds.maxResends}. Counting resends stops an invitation being mailed repeatedly to
              a wrong number.
            </span>
          </label>
        </div>
      </section>

      <section className="panel">
        <header className="panel-header">
          <h2 className="text-sm font-semibold text-ink">Delivery channels</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Only a channel with a configured provider can actually send. Enabling SMS here does not
            create a provider — until one exists, the invitation is recorded as not sent and the
            desk is offered the printed handover instead.
          </p>
        </header>

        <div className="space-y-2 px-4 py-4">
          {toggle('allowManualDelivery')}
          {toggle('allowSms')}
          {toggle('allowEmail')}
        </div>
      </section>

      <section className="panel">
        <header className="panel-header">
          <h2 className="text-sm font-semibold text-ink">What the portal releases</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            These switches change what a patient sees. They cannot switch off verification of
            laboratory results, the audit trail, invitation expiry, single use or session limits —
            those are not settings.
          </p>
        </header>

        <div className="space-y-2 px-4 py-4">
          {toggle('showLabResults')}
          {toggle('showAppointments')}
          {toggle('showPrescriptions')}
          {toggle('showAllergies')}
          {toggle('showDischargeSummaries')}
          {toggle('allowDownloads')}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-surface px-4 py-3">
        <p className="flex items-start gap-2 text-2xs leading-relaxed text-slate-600">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          Mandatory controls — single-use invitations, expiry, hash-only token storage, session
          limits, audit immutability — are enforced in code and the database, not in this form.
        </p>

        <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          Save settings
        </button>
      </div>
    </div>
  );
}

const LABELS: Record<keyof PortalPolicy, { label: string; hint: string }> = {
  invitationExpiryHours: {
    label: 'Invitation lifetime',
    hint: 'How long a printed or sent link stays usable.',
  },
  maxResends: {
    label: 'Resend limit',
    hint: 'How many times staff may reissue delivery for one invitation.',
  },
  allowManualDelivery: {
    label: 'Hand over at the desk',
    hint: 'Print or show the link to a patient whose identity was confirmed in person. Works with no provider at all.',
  },
  allowSms: {
    label: 'SMS',
    hint: 'Requires a configured SMS provider. Without one, no message is sent and none is claimed.',
  },
  allowEmail: {
    label: 'Email',
    hint: 'Requires a configured email provider.',
  },
  showLabResults: {
    label: 'Laboratory results',
    hint: 'Only results a laboratory professional has verified are ever returned.',
  },
  showAppointments: {
    label: 'Appointments',
    hint: 'Upcoming and past appointments at this facility.',
  },
  showPrescriptions: {
    label: 'Prescriptions',
    hint: 'Medicines prescribed at this facility.',
  },
  showAllergies: {
    label: 'Allergies',
    hint: 'Active allergies on the record.',
  },
  showDischargeSummaries: {
    label: 'Discharge summaries',
    hint: 'Summaries released after a discharge.',
  },
  allowDownloads: {
    label: 'Record download',
    hint: 'A generated copy, streamed to a live session. There is no permanent link.',
  },
};

/* ============================================================
   Audit
   ============================================================ */

function AuditTab() {
  const [rows, setRows] = useState<
    Array<{
      id: number;
      action: string;
      resource: string;
      resourceId: string | null;
      details: string | null;
      userId: string | null;
      ipAddress: string | null;
      timestamp: string;
    }>
  >([]);
  const [events, setEvents] = useState<
    Array<{ id: number; eventType: string; detail: string | null; createdAt: string }>
  >([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const result = await portalAdminApi.audit({ limit: 100 });

      setRows(result.rows);
      setEvents(result.invitationEvents);
      setNote(result.note);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="py-6 text-xs text-ink-soft">Reading the portal audit trail…</p>;

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-xs text-rose-900">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="panel">
        <header className="panel-header">
          <h2 className="text-sm font-semibold text-ink">Portal audit trail</h2>
          <p className="mt-0.5 text-xs text-ink-soft">{note}</p>
        </header>

        {rows.length === 0 ? (
          <p className="px-4 py-4 text-xs text-ink-soft">
            No portal audit entry has been written yet.
          </p>
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="table-quiet w-full min-w-[720px]">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Details</th>
                  <th>Staff</th>
                  <th>From</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap text-2xs">{formatDateTime(row.timestamp)}</td>
                    <td className="text-2xs font-semibold">{row.action}</td>
                    <td className="text-2xs">
                      {row.resource}
                      {row.resourceId ? ` #${row.resourceId}` : ''}
                    </td>
                    <td className="text-2xs">{row.details ?? '—'}</td>
                    <td className="text-2xs">{row.userId ?? 'system'}</td>
                    <td className="text-2xs">{row.ipAddress ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <header className="panel-header">
          <h2 className="text-sm font-semibold text-ink">Invitation events</h2>
        </header>

        {events.length === 0 ? (
          <p className="px-4 py-4 text-xs text-ink-soft">No invitation event has been recorded.</p>
        ) : (
          <ul className="divide-y divide-slate-100 px-4">
            {events.map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-3 py-2.5">
                <div>
                  <p className="text-xs font-semibold text-ink">{event.eventType}</p>
                  <p className="text-2xs text-ink-soft">{event.detail ?? '—'}</p>
                </div>
                <span className="whitespace-nowrap text-2xs text-slate-500">
                  {formatDateTime(event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ============================================================
   Card lookup
   ============================================================ */

function CardTab() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{
    mrn: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    dateOfBirth: string | null;
    gender: string | null;
    portalAccountStatus: string;
    note: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      setResult(await portalAdminApi.lookupCard(code.trim()));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="panel">
        <header className="panel-header">
          <h2 className="text-sm font-semibold text-ink">Find a patient from a card</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Scanning a card never grants access. This lookup runs under your staff session, inside
            your facility, rate-limited, and every successful lookup is written to the access log.
          </p>
        </header>

        <form className="flex flex-wrap items-end gap-2 px-4 py-4" onSubmit={lookup}>
          <label className="min-w-[260px] flex-1">
            <span className="field-label">Card code</span>
            <input
              className="field-input font-mono"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="JC-P…"
              autoComplete="off"
            />
          </label>

          <button type="submit" className="btn-primary" disabled={busy || code.trim() === ''}>
            {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Look up
          </button>
        </form>

        <div className="px-4 pb-4">
          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-900">
              {error}
            </div>
          ) : null}

          {result ? (
            <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-3">
              <p className="text-sm font-semibold text-ink">
                {result.firstName} {result.middleName ?? ''} {result.lastName}
              </p>
              <p className="mt-1 text-xs text-brand-900">
                Record {result.mrn} · {result.gender ?? '—'} · born {result.dateOfBirth ?? '—'}
              </p>
              <p className="mt-1 text-2xs text-brand-900">
                Portal account: {result.portalAccountStatus}
              </p>
              <p className="mt-2 text-2xs text-brand-900">{result.note}</p>
            </div>
          ) : null}
        </div>
      </section>

      <div className="rounded-xl border border-ember-200 bg-ember-50 px-4 py-3 text-xs leading-relaxed text-ember-900">
        <p className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            A card proves possession, not identity. Before acting on a record, confirm the person in
            front of you — a shared household phone or a borrowed card is common.
          </span>
        </p>
      </div>
    </div>
  );
}

/* ============================================================
   Module
   ============================================================ */

export const PatientPortalModule: React.FC = () => {
  const [tab, setTab] = useState<AdminTab>('overview');

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Patient portal</p>
          <h1 className="display-title mt-1">Patient Portal Management</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-soft">
            Invitations, accounts, settings and oversight for the patient-facing record portal.
            Patients are invited from the reception screen; this section manages the programme.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-2xs font-semibold text-brand-900">
          <ShieldCheck className="h-4 w-4" />
          Staff-only surface
        </div>
      </header>

      <nav className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-surface p-1">
        {TABS.map((entry) => {
          const Icon = entry.icon;

          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={cx(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors',
                tab === entry.id
                  ? 'bg-brand-700 text-white'
                  : 'text-ink-soft hover:bg-brand-50 hover:text-brand-800',
              )}
            >
              <Icon className="h-4 w-4" />
              {entry.label}
            </button>
          );
        })}
      </nav>

      {tab === 'overview' ? <OverviewTab onOpenAccount={() => setTab('accounts')} /> : null}
      {tab === 'accounts' ? <AccountsTab /> : null}
      {tab === 'settings' ? <SettingsTab /> : null}
      {tab === 'audit' ? <AuditTab /> : null}
      {tab === 'card' ? <CardTab /> : null}

      <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-2xs leading-relaxed text-slate-600">
        <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        Portal actions are audited. Answers to patients are generic by design: this application will
        not confirm whether a given phone number belongs to a patient, and neither should the desk.
      </p>
    </div>
  );
};

export default PatientPortalModule;
