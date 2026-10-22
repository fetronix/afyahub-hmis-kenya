/**
 * JaliCare HMIS
 * Portal invitation — the reception desk panel
 *
 * This is where a patient is invited to the portal. It is deliberately
 * narrow:
 *
 *   - it shows the portal *status* of one patient, not their clinical
 *     history;
 *   - it will not create an account by matching a phone number or a date
 *     of birth. The account is created by the patient, from a single-use
 *     link, after a member of staff has confirmed who they are;
 *   - it never reports a message as delivered unless a provider accepted
 *     it. With no provider configured, the only truthful option is the
 *     printed handover, and that is what the panel offers.
 *
 * The API decides what the caller may do. If a receptionist without
 * `portal.invites.manage` presses "Revoke", the server refuses and the
 * refusal is shown as it came back — the browser is not the authority.
 */

import React, { useCallback, useEffect, useState } from 'react';

import {
  portalAdminApi,
  PortalApiError,
  type IssuedInvitation,
  type PatientPortalStatus,
} from '../../api/portal-client.ts';

import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Link2,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';

interface Props {
  patientId: number;
  patientName: string;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

type Channel = 'MANUAL' | 'SMS' | 'EMAIL';

function errorText(error: unknown): string {
  if (error instanceof PortalApiError) {
    if (error.status === 403) {
      return 'You do not have permission for this action. Ask a facility administrator.';
    }

    return error.message;
  }

  if (error instanceof Error) return error.message;

  return 'The request could not be completed.';
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

export const PortalInviteDialog: React.FC<Props> = ({
  patientId,
  patientName,
  open,
  onClose,
  onChanged,
}) => {
  const [status, setStatus] = useState<PatientPortalStatus | null>(null);
  const [channel, setChannel] = useState<Channel>('MANUAL');
  const [contact, setContact] = useState('');
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!open) return;

    setLoading(true);

    try {
      const result = await portalAdminApi.patientStatus(patientId);

      setStatus(result);
      setError(null);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }, [open, patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!open) return null;

  const send = async () => {
    setBusy(true);
    setError(null);
    setIssued(null);

    try {
      const result = await portalAdminApi.invite(patientId, {
        channel,
        contact: contact.trim() || undefined,
        purpose: 'ACTIVATION',
      });

      setIssued(result);
      await load();
      onChanged?.();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const reissue = async (invitationId: number) => {
    setBusy(true);
    setError(null);

    try {
      const result = await portalAdminApi.reissueLink(invitationId);

      setIssued({
        success: true,
        invitationId,
        status: 'PENDING',
        deliveryStatus: 'PENDING',
        deliveryChannel: 'MANUAL',
        expiresAt: result.expiresAt,
        activationLink: result.activationLink,
        deliveryMessage: result.message,
      });

      await load();
      onChanged?.();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const handOver = async (invitationId: number) => {
    setBusy(true);
    setError(null);

    try {
      await portalAdminApi.markHandedOver(invitationId);
      await load();
      onChanged?.();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (invitationId: number) => {
    const reason = window.prompt(
      'Why is this invitation being revoked? This is recorded in the audit trail.',
      'Patient asked for the invitation to be withdrawn',
    );

    if (!reason) return;

    setBusy(true);
    setError(null);

    try {
      await portalAdminApi.revokeInvitation(invitationId, reason);
      await load();
      onChanged?.();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!issued?.activationLink) return;

    try {
      await navigator.clipboard.writeText(issued.activationLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('The link could not be copied. Select it and copy it manually.');
    }
  };

  const invitation = status?.latestInvitation ?? null;
  const smsAvailable = Boolean(status?.notificationConfigured.sms);
  const emailAvailable = Boolean(status?.notificationConfigured.email);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-slate-200 bg-surface shadow-xl sm:rounded-2xl">
        <header className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-surface px-4 py-3">
          <div>
            <p className="eyebrow">Patient portal</p>
            <h3 className="mt-0.5 text-sm font-semibold text-ink">Invite {patientName}</h3>
            <p className="mt-0.5 text-2xs text-slate-500">
              Confirm the person's identity before handing over a link. A phone number alone is not
              identity.
            </p>
          </div>

          <button type="button" className="btn-quiet" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-4 py-4">
          {loading ? (
            <p className="flex items-center gap-2 text-xs text-ink-soft">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading portal status…
            </p>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-900">
              {error}
            </div>
          ) : null}

          {status ? (
            <>
              <div className="rounded-xl border border-slate-200 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-2xs uppercase tracking-wide text-slate-500">Account</p>
                    <p className="text-xs font-semibold text-ink">
                      {status.hasAccount
                        ? `Linked · ${status.accountStatus?.replace(/_/g, ' ').toLowerCase()}`
                        : 'Not linked'}
                    </p>
                    {status.accountMaskedContact ? (
                      <p className="mt-0.5 font-mono text-2xs text-ink-soft">
                        {status.accountMaskedContact}
                      </p>
                    ) : null}
                  </div>

                  {status.hasAccount ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-2xs font-semibold text-emerald-800">
                      Existing account
                    </span>
                  ) : (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-2xs font-semibold text-slate-600">
                      No account
                    </span>
                  )}
                </div>
              </div>

              {invitation ? (
                <div className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-3">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-brand-900">
                    Latest invitation
                  </p>
                  <p className="mt-1 text-xs font-semibold text-ink">
                    {invitation.status} · delivery {invitation.deliveryStatus.replace(/_/g, ' ').toLowerCase()}
                  </p>
                  <p className="mt-0.5 text-2xs text-brand-900">
                    {invitation.deliveryChannel} · expires {formatDateTime(invitation.expiresAt)}
                  </p>

                  {invitation.lastDeliveryError ? (
                    <p className="mt-1 text-2xs text-ember-900">{invitation.lastDeliveryError}</p>
                  ) : null}

                  {invitation.handedOverAt ? (
                    <p className="mt-1 text-2xs text-emerald-800">
                      Handed over at the desk {formatDateTime(invitation.handedOverAt)}
                    </p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap gap-2">
                    {invitation.canResend ? (
                      <button
                        type="button"
                        className="btn-quiet"
                        disabled={busy}
                        onClick={() => void reissue(invitation.id)}
                      >
                        <Link2 className="h-4 w-4" />
                        New link
                      </button>
                    ) : null}

                    {invitation.status === 'PENDING' && !invitation.handedOverAt ? (
                      <button
                        type="button"
                        className="btn-quiet"
                        disabled={busy}
                        onClick={() => void handOver(invitation.id)}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Mark handed over
                      </button>
                    ) : null}

                    {invitation.status === 'PENDING' ? (
                      <button
                        type="button"
                        className="btn-quiet text-rose-700"
                        disabled={busy}
                        onClick={() => void revoke(invitation.id)}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </div>

                  {!invitation.canResend && invitation.resendBlockedReason ? (
                    <p className="mt-2 text-2xs text-brand-900">{invitation.resendBlockedReason}</p>
                  ) : null}
                </div>
              ) : null}

              {issued?.activationLink ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-emerald-900">
                    Hand this link to the patient now
                  </p>
                  <p className="mt-1 break-all rounded-lg bg-white px-2 py-2 font-mono text-2xs text-ink">
                    {issued.activationLink}
                  </p>

                  {/*
                    A relative link has no host. It was produced before the
                    server carried the request origin, or by a deployment
                    whose APP_BASE_URL is unset. Say so where the receptionist
                    will see it, rather than let them hand out a path.
                  */}
                  {!issued.activationLink.startsWith('http') ? (
                    <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-2 text-2xs text-amber-900">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        This address has no domain. Set <code>APP_BASE_URL</code> (for
                        example <code>https://hmis.yourdomain</code>) and restart the
                        server, or hand the link over on a device already inside the
                        application.
                      </span>
                    </p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className="btn-quiet" onClick={() => void copy()}>
                      <Copy className="h-4 w-4" />
                      {copied ? 'Copied' : 'Copy link'}
                    </button>
                  </div>

                  <p className="mt-2 text-2xs leading-relaxed text-emerald-900">
                    This link is shown once. It works once. It is not stored on the server in a form
                    anyone can read back — if it is lost, issue a new one.
                  </p>
                </div>
              ) : null}

              {issued && !issued.activationLink ? (
                <div className="rounded-xl border border-ember-200 bg-ember-50 px-3 py-2.5 text-xs text-ember-900">
                  <p className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {issued.deliveryMessage ??
                        'No message was sent. Use the printed handover instead.'}
                    </span>
                  </p>
                </div>
              ) : null}

              {!status.hasAccount ? (
                <div className="rounded-xl border border-slate-200 px-3 py-3">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-slate-500">
                    Issue an invitation
                  </p>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label>
                      <span className="field-label">Channel</span>
                      <select
                        className="field-input"
                        value={channel}
                        onChange={(event) => setChannel(event.target.value as Channel)}
                      >
                        <option value="MANUAL">Hand over at the desk</option>
                        <option value="SMS" disabled={!smsAvailable || !status.policy.allowSms}>
                          SMS {smsAvailable && status.policy.allowSms ? '' : '(no provider configured)'}
                        </option>
                        <option value="EMAIL" disabled={!emailAvailable || !status.policy.allowEmail}>
                          Email {emailAvailable && status.policy.allowEmail ? '' : '(no provider configured)'}
                        </option>
                      </select>
                    </label>

                    <label>
                      <span className="field-label">Contact override (optional)</span>
                      <input
                        className="field-input"
                        value={contact}
                        onChange={(event) => setContact(event.target.value)}
                        placeholder="Only if the record's number is wrong"
                      />
                    </label>
                  </div>

                  <p className="mt-2 text-2xs leading-relaxed text-slate-500">
                    Invitation lifetime: {status.policy.invitationExpiryHours} hours. Resends allowed:{' '}
                    {status.policy.maxResends}. These are set by the facility administrator.
                  </p>

                  <button
                    type="button"
                    className="btn-primary mt-3 w-full"
                    disabled={busy}
                    onClick={() => void send()}
                  >
                    {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {busy ? 'Issuing…' : 'Issue invitation'}
                  </button>
                </div>
              ) : (
                <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-2xs leading-relaxed text-slate-600">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                  This patient already has a portal account. A new account is never created from a
                  matching phone number — if they cannot sign in, use the recovery invitation from the
                  account screen.
                </p>
              )}
            </>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
          <p className="text-2xs text-slate-500">This panel never shows clinical results or notes.</p>

          <div className="flex gap-2">
            <button type="button" className="btn-quiet" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>

            <button type="button" className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default PortalInviteDialog;
