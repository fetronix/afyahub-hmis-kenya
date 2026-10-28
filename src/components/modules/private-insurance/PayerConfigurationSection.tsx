import React, { useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  KeyRound,
  Network,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
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

export function connectionBadge(status: string): { label: string; className: string } {
  switch (status) {
    case 'PRODUCTION_AUTHORIZED':
      return {
        label: 'Production authorized',
        className: 'bg-brand-50 text-brand-800 border-brand-200',
      };
    case 'CONNECTION_VERIFIED':
      return {
        label: 'Connection verified',
        className: 'bg-brand-50 text-brand-700 border-brand-200',
      };
    case 'SANDBOX_CONFIGURED':
      return {
        label: 'Sandbox configured',
        className: 'bg-ember-50 text-ember-800 border-ember-200',
      };
    case 'AWAITING_DOCUMENTATION':
      return {
        label: 'Awaiting insurer documentation',
        className: 'bg-amber-50 text-amber-900 border-amber-200',
      };
    default:
      return {
        label: 'Not configured',
        className: 'bg-slate-100 text-slate-700 border-slate-300',
      };
  }
}

export const PayerConfigurationSection: React.FC<Props> = ({
  activeScreen,
  dashboard,
  payers,
  canManagePayers,
  onNavigateScreen,
  onRefresh,
  showToast,
}) => {
  const [editingPayer, setEditingPayer] = useState<PrivatePayerConfig | null>(null);
  const [probingId, setProbingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);

  const [editForm, setEditForm] = useState({
    integrationType: 'MANUAL',
    adapterKey: 'manual',
    environment: 'UNCONFIGURED',
    apiBaseUrl: '',
    authMethod: 'NONE',
    secretEnvPrefix: '',
    providerIdentifier: '',
    gatewayProvider: '',
    isActive: true,
    requireVerifiedEligibility: true,
    notes: '',
  });

  const [newPayerForm, setNewPayerForm] = useState({
    payerCode: '',
    payerName: '',
    integrationType: 'MANUAL',
    adapterKey: 'manual',
    secretEnvPrefix: '',
    providerIdentifier: '',
  });

  const openEdit = (payer: PrivatePayerConfig) => {
    setEditingPayer(payer);
    setEditForm({
      integrationType: payer.integrationType,
      adapterKey: payer.adapterKey,
      environment: payer.environment,
      apiBaseUrl: payer.apiBaseUrl ?? '',
      authMethod: payer.authMethod,
      secretEnvPrefix: payer.secretReference.envPrefix ?? '',
      providerIdentifier: payer.providerIdentifier ?? '',
      gatewayProvider: payer.gatewayProvider ?? '',
      isActive: payer.isActive,
      requireVerifiedEligibility: payer.requireVerifiedEligibility,
      notes: payer.notes ?? '',
    });
  };

  const handleSavePayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPayer) return;
    setSaving(true);
    try {
      await privateInsuranceApi.updatePayer(editingPayer.id, {
        integrationType: editForm.integrationType,
        adapterKey: editForm.adapterKey,
        environment: editForm.environment,
        apiBaseUrl: editForm.apiBaseUrl.trim() || null,
        authMethod: editForm.authMethod,
        secretEnvPrefix: editForm.secretEnvPrefix.trim() || null,
        providerIdentifier: editForm.providerIdentifier.trim() || null,
        gatewayProvider:
          editForm.integrationType === 'THIRD_PARTY_GATEWAY'
            ? editForm.gatewayProvider.trim() || 'SmartLink'
            : null,
        isActive: editForm.isActive,
        requireVerifiedEligibility: editForm.requireVerifiedEligibility,
        notes: editForm.notes.trim() || null,
      });
      showToast(`Updated ${editingPayer.payerName} configuration.`, { tone: 'success' });
      setEditingPayer(null);
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update insurer.', {
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePayer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await privateInsuranceApi.createPayer({
        payerCode: newPayerForm.payerCode,
        payerName: newPayerForm.payerName,
        integrationType: newPayerForm.integrationType,
        adapterKey: newPayerForm.adapterKey,
        secretEnvPrefix: newPayerForm.secretEnvPrefix.trim() || null,
        providerIdentifier: newPayerForm.providerIdentifier.trim() || null,
      });
      showToast(`Added ${newPayerForm.payerName}.`, { tone: 'success' });
      setShowNewForm(false);
      setNewPayerForm({
        payerCode: '',
        payerName: '',
        integrationType: 'MANUAL',
        adapterKey: 'manual',
        secretEnvPrefix: '',
        providerIdentifier: '',
      });
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create insurer.', {
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleProbe = async (payer: PrivatePayerConfig) => {
    setProbingId(payer.id);
    try {
      const res = await privateInsuranceApi.probePayerConnection(payer.id);
      showToast(`${payer.payerCode}: ${res.summary}`, {
        tone: res.verified ? 'success' : 'info',
      });
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Probe failed.', { tone: 'error' });
    } finally {
      setProbingId(null);
    }
  };

  if (activeScreen === 'dashboard') {
    const kpis = dashboard?.kpis;
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Multi-Insurer Operations Overview — Britam &amp; PACIS First
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                Reuses existing JaliCare patients, encounters, admissions, diagnostics, pharmacy,
                service tariffs, and invoices. Live external dispatch activates only when official
                insurer or approved gateway credentials are provisioned.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onNavigateScreen('eligibility')}
                className="px-3.5 py-2 rounded-lg text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700"
              >
                Verify Eligibility
              </button>
              <button
                type="button"
                onClick={() => onNavigateScreen('claim_prepare')}
                className="px-3.5 py-2 rounded-lg text-sm font-semibold bg-ember-500 text-navy-950 hover:bg-ember-600"
              >
                Prepare Claim from Invoice
              </button>
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-brand-100 rounded-xl p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">
              Active Memberships
            </div>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {kpis?.activeMembersCount ?? 0}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Across {kpis?.configuredPayersCount ?? payers.length} private insurers
            </div>
          </div>

          <div className="bg-white border border-ember-100 rounded-xl p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-ember-700">
              Pending Preauthorizations
            </div>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {kpis?.pendingPreauthsCount ?? 0}
            </div>
            <div className="text-xs text-slate-500 mt-1">Draft, requested &amp; pending review</div>
          </div>

          <div className="bg-white border border-brand-100 rounded-xl p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">
              Proposed Insurer Claims
            </div>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              KES {Number(kpis?.totalProposedClaimAmount ?? '0').toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {kpis?.pendingSubmissionCount ?? 0} awaiting submission ·{' '}
              {kpis?.rejectedClaimsCount ?? 0} rejected
            </div>
          </div>

          <div className="bg-white border border-ember-100 rounded-xl p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-ember-700">
              Reconciled Remittances
            </div>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              KES {Number(kpis?.totalReconciledPaidAmount ?? '0').toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {kpis?.unreconciledRemittancesCount ?? 0} advice batches awaiting allocation
            </div>
          </div>
        </div>

        {/* Insurer Connection Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {payers.map((payer) => {
            const badge = connectionBadge(payer.connectionStatus);
            const liveReadyCount = payer.capabilities.filter((c) => c.readyInCurrentConfig).length;
            return (
              <div
                key={payer.id}
                className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between gap-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="inline-block text-xs font-bold tracking-wider uppercase px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200">
                        {payer.payerCode}
                      </span>
                      <h3 className="text-base font-bold text-slate-900 mt-1.5">
                        {payer.payerName}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Adapter: <span className="font-medium">{payer.adapterDisplayName}</span> ·
                        Mode: <span className="font-medium">{payer.integrationType}</span>
                        {payer.isGatewayAdapter && payer.gatewayProvider
                          ? ` (${payer.gatewayProvider} Gateway)`
                          : ''}
                      </p>
                    </div>
                    <span
                      className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </div>

                  <div className="mt-4 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 space-y-1">
                    <div>
                      <strong>Provider Panel ID:</strong>{' '}
                      {payer.providerIdentifier ?? 'Not assigned yet'}
                    </div>
                    <div>
                      <strong>API Base URL:</strong>{' '}
                      {payer.apiBaseUrl ?? 'None configured (internal & manual workflow active)'}
                    </div>
                    <div>
                      <strong>Server Secret Env Prefix:</strong>{' '}
                      <code>{payer.secretReference.envPrefix ?? 'None'}</code> (
                      {payer.secretReference.allRequiredSecretsPresent
                        ? 'Credentials present in server env'
                        : 'No live credentials in server env'}
                      )
                    </div>
                    <div>
                      <strong>External Live Capabilities Ready:</strong> {liveReadyCount} /{' '}
                      {payer.capabilities.length}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => handleProbe(payer)}
                    disabled={probingId === payer.id}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${probingId === payer.id ? 'animate-spin' : ''}`}
                    />
                    Verify Connection Status
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigateScreen('payers')}
                    className="text-xs font-semibold text-ember-700 hover:text-ember-800"
                  >
                    Configure Insurer &rarr;
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ============================================================
     SCREEN 2: INSURER CONFIGURATION
     ============================================================ */
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-brand-600" />
            Insurer Configuration &amp; Adapter Capabilities
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Each insurer maintains independent endpoints, server-side secret references, provider
            identifiers, tariffs, benefit rules, and adapter selection. Third-party gateways such as
            SmartLink are explicitly distinguished from direct insurer APIs.
          </p>
        </div>
        {canManagePayers && (
          <button
            type="button"
            onClick={() => setShowNewForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700"
          >
            <Plus className="w-4 h-4" />
            Add Private Insurer
          </button>
        )}
      </div>

      {showNewForm && canManagePayers && (
        <form
          onSubmit={handleCreatePayer}
          className="bg-white border border-brand-200 rounded-xl p-5 shadow-sm space-y-4"
        >
          <h3 className="text-sm font-bold text-slate-900">Register Additional Private Insurer</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Payer Code (e.g. JUBILEE, AAR)
              </label>
              <input
                required
                value={newPayerForm.payerCode}
                onChange={(e) =>
                  setNewPayerForm({ ...newPayerForm, payerCode: e.target.value.toUpperCase() })
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="AAR"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Insurer Name
              </label>
              <input
                required
                value={newPayerForm.payerName}
                onChange={(e) => setNewPayerForm({ ...newPayerForm, payerName: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="AAR Insurance Kenya"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Initial Integration Mode
              </label>
              <select
                value={newPayerForm.integrationType}
                onChange={(e) => {
                  const type = e.target.value;
                  setNewPayerForm({
                    ...newPayerForm,
                    integrationType: type,
                    adapterKey: type === 'THIRD_PARTY_GATEWAY' ? 'smartlink_gateway' : 'manual',
                  });
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="MANUAL">MANUAL (Portal / Signed Form)</option>
                <option value="FILE_EXPORT">FILE_EXPORT (Structured Batch)</option>
                <option value="THIRD_PARTY_GATEWAY">
                  THIRD_PARTY_GATEWAY (e.g. SmartLink Gateway)
                </option>
                <option value="DIRECT_API">DIRECT_API (Insurer Direct REST)</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowNewForm(false)}
              className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-ember-500 text-navy-950 hover:bg-ember-600"
            >
              {saving ? 'Saving...' : 'Create Insurer'}
            </button>
          </div>
        </form>
      )}

      {editingPayer && canManagePayers && (
        <form
          onSubmit={handleSavePayer}
          className="bg-white border-2 border-brand-300 rounded-xl p-5 shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">
              Edit Configuration — {editingPayer.payerName} ({editingPayer.payerCode})
            </h3>
            <button
              type="button"
              onClick={() => setEditingPayer(null)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Integration Type
              </label>
              <select
                value={editForm.integrationType}
                onChange={(e) => {
                  const nextType = e.target.value;
                  let nextAdapter = editForm.adapterKey;
                  if (nextType === 'THIRD_PARTY_GATEWAY') nextAdapter = 'smartlink_gateway';
                  else if (nextType === 'DIRECT_API') {
                    nextAdapter =
                      editingPayer.payerCode === 'BRITAM'
                        ? 'britam_direct'
                        : editingPayer.payerCode === 'PACIS'
                          ? 'pacis_direct'
                          : 'manual';
                  } else {
                    nextAdapter = 'manual';
                  }
                  setEditForm({
                    ...editForm,
                    integrationType: nextType,
                    adapterKey: nextAdapter,
                  });
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="MANUAL">MANUAL</option>
                <option value="FILE_EXPORT">FILE_EXPORT</option>
                <option value="DIRECT_API">DIRECT_API</option>
                <option value="THIRD_PARTY_GATEWAY">THIRD_PARTY_GATEWAY</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Adapter Implementation
              </label>
              <select
                value={editForm.adapterKey}
                onChange={(e) => setEditForm({ ...editForm, adapterKey: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="manual">Internal Manual / Portal Export Adapter</option>
                <option value="britam_direct">Britam Direct Insurer Adapter</option>
                <option value="pacis_direct">PACIS Direct Insurer Adapter</option>
                <option value="smartlink_gateway">
                  SmartLink Gateway Adapter (Third-Party Mediator)
                </option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Environment</label>
              <select
                value={editForm.environment}
                onChange={(e) => setEditForm({ ...editForm, environment: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="UNCONFIGURED">UNCONFIGURED</option>
                <option value="SANDBOX">SANDBOX / UAT</option>
                <option value="PRODUCTION">PRODUCTION</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                HTTPS API Base URL (Optional)
              </label>
              <input
                value={editForm.apiBaseUrl}
                onChange={(e) => setEditForm({ ...editForm, apiBaseUrl: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Leave blank until issued by insurer"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Auth Method</label>
              <select
                value={editForm.authMethod}
                onChange={(e) => setEditForm({ ...editForm, authMethod: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="NONE">NONE</option>
                <option value="OAUTH2_CLIENT_CREDENTIALS">OAUTH2_CLIENT_CREDENTIALS</option>
                <option value="API_KEY_HEADER">API_KEY_HEADER</option>
                <option value="BEARER_TOKEN_REF">BEARER_TOKEN_REF</option>
                <option value="MUTUAL_TLS">MUTUAL_TLS</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Server Env Secret Prefix (Never raw secret)
              </label>
              <input
                value={editForm.secretEnvPrefix}
                onChange={(e) =>
                  setEditForm({ ...editForm, secretEnvPrefix: e.target.value.toUpperCase() })
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                placeholder="BRITAM_API"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Hospital Provider Panel Code
              </label>
              <input
                value={editForm.providerIdentifier}
                onChange={(e) => setEditForm({ ...editForm, providerIdentifier: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Assigned hospital provider code"
              />
            </div>

            {editForm.integrationType === 'THIRD_PARTY_GATEWAY' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Gateway Mediator Name
                </label>
                <input
                  value={editForm.gatewayProvider}
                  onChange={(e) => setEditForm({ ...editForm, gatewayProvider: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="SmartLink"
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-6 text-xs text-slate-700">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={editForm.isActive}
                onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
              />
              Insurer active for facility workflows
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={editForm.requireVerifiedEligibility}
                onChange={(e) =>
                  setEditForm({ ...editForm, requireVerifiedEligibility: e.target.checked })
                }
              />
              Require verified eligibility before claim readiness
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingPayer(null)}
              className="px-3 py-1.5 text-sm text-slate-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700"
            >
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </form>
      )}

      {/* Detailed Payer Cards */}
      <div className="space-y-5">
        {payers.map((payer) => {
          const badge = connectionBadge(payer.connectionStatus);
          return (
            <div
              key={payer.id}
              className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4"
            >
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-brand-600" />
                    <h3 className="text-base font-bold text-slate-900">
                      {payer.payerName} ({payer.payerCode})
                    </h3>
                    <span
                      className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">
                    Integration: <strong>{payer.integrationType}</strong> · Adapter:{' '}
                    <strong>{payer.adapterDisplayName}</strong> · Environment:{' '}
                    <strong>{payer.environment}</strong> · Coding:{' '}
                    <strong>{payer.defaultCodingSystem}</strong>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleProbe(payer)}
                    disabled={probingId === payer.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100"
                  >
                    <Network className="w-3.5 h-3.5" />
                    Probe Status
                  </button>
                  {canManagePayers && (
                    <button
                      type="button"
                      onClick={() => openEdit(payer)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-ember-500 text-navy-950 hover:bg-ember-600"
                    >
                      Configure
                    </button>
                  )}
                </div>
              </div>

              {/* Secret reference status — NEVER exposes secret values */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-ember-600 shrink-0" />
                  <div>
                    <div className="font-semibold text-slate-800">Secret Reference Key</div>
                    <div className="text-slate-600 font-mono">
                      {payer.secretReference.envPrefix ?? 'Not set'} (values never stored in DB)
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-brand-600 shrink-0" />
                  <div>
                    <div className="font-semibold text-slate-800">Server Env Credential Check</div>
                    <div className="text-slate-600">
                      CLIENT_ID: {payer.secretReference.hasClientId ? 'Present' : 'Absent'} ·
                      SECRET: {payer.secretReference.hasClientSecret ? 'Present' : 'Absent'} ·
                      API_KEY: {payer.secretReference.hasApiKey ? 'Present' : 'Absent'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4 text-brand-600 shrink-0" />
                  <div>
                    <div className="font-semibold text-slate-800">Last Connection Probe</div>
                    <div className="text-slate-600">
                      {payer.lastConnectionSummary ?? 'Not probed yet'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Supported Capabilities Matrix */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Operation Capability Matrix
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {payer.capabilities.map((cap) => (
                    <div
                      key={cap.operation}
                      className="border border-slate-200 rounded-lg p-2.5 text-xs flex items-start gap-2"
                    >
                      {cap.readyInCurrentConfig ? (
                        <CheckCircle2 className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-semibold text-slate-800">{cap.operation}</div>
                        <div className="text-slate-500 text-[11px]">{cap.mode}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Onboarding Checklist */}
              {payer.onboardingChecklist.length > 0 && (
                <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3">
                  <div className="text-xs font-bold text-amber-900 mb-1">
                    Required from {payer.payerName} to Enable Live External API Dispatch:
                  </div>
                  <ul className="list-disc list-inside text-xs text-amber-900 space-y-0.5">
                    {payer.onboardingChecklist.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
