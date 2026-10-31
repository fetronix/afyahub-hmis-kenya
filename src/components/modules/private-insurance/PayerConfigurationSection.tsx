import React, { useState } from 'react';
import { useHmis } from '../../../context/HmisContext.tsx';
import {
  privateInsuranceApi,
  type PrivateInsuranceDashboardResponse,
  type PrivatePayerConfig,
} from '../../../api/private-insurance.client.ts';

interface Props {
  activeScreen: 'dashboard' | 'payers';
  dashboard: PrivateInsuranceDashboardResponse | null;
  payers: PrivatePayerConfig[];
  canManagePayers: boolean;
  onNavigateScreen: (screen: string) => void;
  onRefresh: () => Promise<void>;
  showToast: (msg: string, opts?: { tone?: 'info' | 'success' | 'warning' | 'error' }) => void;
}
export function connectionBadge(_status: string): { label: string; className: string } {
  return { label: 'API not verified', className: 'bg-amber-50 text-amber-900 border-amber-200' };
}
const card = 'rounded-xl border border-slate-200 bg-white p-4 space-y-3';
const button =
  'rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50';

export const PayerConfigurationSection: React.FC<Props> = ({
  activeScreen,
  dashboard,
  payers,
  canManagePayers,
  onNavigateScreen,
  onRefresh,
  showToast,
}) => {
  const { setActiveModule } = useHmis();
  const [editing, setEditing] = useState<PrivatePayerConfig | null>(null);
  const [providerIdentifier, setProviderIdentifier] = useState('');
  const [requireVerified, setRequireVerified] = useState(true);
  const [saving, setSaving] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      await privateInsuranceApi.updatePayer(editing.id, {
        providerIdentifier: providerIdentifier.trim() || null,
        requireVerifiedEligibility: requireVerified,
      });
      setEditing(null);
      await onRefresh();
      showToast('Facility payer settings saved.', { tone: 'success' });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save settings.', {
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  };
  if (activeScreen === 'dashboard') {
    const k = dashboard?.kpis;
    return (
      <div className="space-y-4">
        <div className={card}>
          <h2 className="text-lg font-bold">Private insurance operations</h2>
          <p className="text-sm text-slate-600">
            Uses existing patient, encounter and invoice records. Britam, PACIS, CIC and other
            assigned payers currently use manual processing only.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className={button} onClick={() => onNavigateScreen('eligibility')}>
              Eligibility
            </button>
            <button className={button} onClick={() => onNavigateScreen('claim_prepare')}>
              Prepare claim
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Active memberships', k?.activeMembersCount ?? 'Unavailable'],
            ['Pending preauthorizations', k?.pendingPreauthsCount ?? 'Unavailable'],
            ['Claims awaiting submission', k?.pendingSubmissionCount ?? 'Unavailable'],
            ['Advice awaiting allocation', k?.unreconciledRemittancesCount ?? 'Unavailable'],
          ].map(([label, value]) => (
            <div key={label} className={card}>
              <p className="text-xs text-slate-500">{label}</p>
              <p className="text-2xl font-bold">{value}</p>
            </div>
          ))}
        </div>
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Manual verification and dispatch must be recorded with supporting references. No private
          insurer API connection has been verified.
        </p>
        <button className={button} onClick={() => onNavigateScreen('payers')}>
          View enabled payers
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className={card}>
        <h2 className="text-lg font-bold">Enabled private payers</h2>
        <p className="text-sm text-slate-600">
          The platform registers and assigns payers. Facility activation, access requests and
          credential references are managed in Configuration → Payers &amp; eClaims. Existing claims
          remain visible after a payer is disabled.
        </p>
        <button className={button} onClick={() => setActiveModule('configuration')}>
          Open facility configuration
        </button>
      </div>
      {!payers.length && (
        <p className={card}>
          No assigned and active private payers. Request an assignment or activate one in facility
          configuration.
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {payers.map((payer) => (
          <article key={payer.id} className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold">
                {payer.payerName} ({payer.payerCode})
              </h3>
              <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-900">
                Manual · API not verified
              </span>
            </div>
            <p className="text-xs text-slate-600">
              Facility provider ID: {payer.providerIdentifier || 'Not provided'} · Eligibility
              evidence required: {payer.requireVerifiedEligibility ? 'Yes' : 'No'}
            </p>
            <p className="text-xs text-slate-600">
              Benefits and filing rules must be entered from this facility’s actual payer agreement;
              none are assumed.
            </p>
            <details>
              <summary className="cursor-pointer text-xs font-semibold">
                Onboarding blockers
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
                {payer.onboardingChecklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </details>
            {canManagePayers && (
              <button
                className={button}
                onClick={() => {
                  setEditing(payer);
                  setProviderIdentifier(payer.providerIdentifier ?? '');
                  setRequireVerified(payer.requireVerifiedEligibility);
                }}
              >
                Edit facility settings
              </button>
            )}
          </article>
        ))}
      </div>
      {editing && (
        <form onSubmit={save} className={card}>
          <h3 className="font-semibold">Facility settings — {editing.payerName}</h3>
          <label className="block text-xs">
            Provider panel identifier
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={providerIdentifier}
              onChange={(e) => setProviderIdentifier(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={requireVerified}
              onChange={(e) => setRequireVerified(e.target.checked)}
            />
            Require documented eligibility before claim readiness
          </label>
          <div className="flex gap-2">
            <button className={button} disabled={saving}>
              Save
            </button>
            <button
              type="button"
              className="text-sm text-slate-600"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
