import { PageHeader } from '../ui/layout.tsx';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import { StaffInvitationsPanel } from './StaffInvitationsPanel.tsx';
import { StaffRolesPanel } from './StaffRolesPanel.tsx';
import { FacilityServicesManager } from './FacilityServicesManager.tsx';
import { FacilityPaymentIntegrations } from './payment-hub/FacilityPaymentIntegrations.tsx';
import { FacilityPayerIntegrations } from './payer-hub/FacilityPayerIntegrations.tsx';
import {
  FACILITY_MODULES,
  resolveFacilityModules,
  resolveHiddenFacilityModules,
} from '../../config/facility-modules.ts';
import {
  Sliders,
  Building2,
  Layers,
  ShieldCheck,
  CheckCircle2,
  DollarSign,
  BedDouble,
  FlaskConical,
  CreditCard,
  ToggleLeft,
  ToggleRight,
  Plus,
  UserPlus,
  Lock,
  AlertTriangle,
  Save,
} from 'lucide-react';

export const ConfigurationModule: React.FC = () => {
  const {
    currentFacility,
    currentTenant,
    showToast,
    authenticatedUser,
    setCurrentFacility,
    setActiveModule,
  } = useHmis();
  const isFacilityAdmin = Boolean(
    authenticatedUser?.roles?.includes('FACILITY_ADMIN') &&
    !authenticatedUser?.isSuperAdmin &&
    !authenticatedUser?.roles?.includes('SUPER_ADMIN'),
  );

  const isSuperAdmin = Boolean(
    authenticatedUser?.isSuperAdmin || authenticatedUser?.roles?.includes('SUPER_ADMIN'),
  );

  const permissions = new Set(authenticatedUser?.permissions ?? []);
  const canViewPaymentHub = !isSuperAdmin && permissions.has('payment_hub.catalogue.read');
  const canViewPayerHub = !isSuperAdmin && permissions.has('payer_hub.catalogue.read');

  /*
   * The staff screen is gated on the same permission its API requires.
   * A facility administrator holds users.invite on a fresh install, so
   * this is also the condition that gives them a way into this module.
   */
  const canManageStaff = Boolean(
    !isSuperAdmin &&
    (isFacilityAdmin || permissions.has('users.invite') || permissions.has('users.roles.manage')),
  );

  /*
   * An account that holds only staff permissions came here for the
   * staff screen. Showing it the facility profile, the module switches
   * or the payment channels would be a wider surface than its
   * permissions allow.
   */
  const staffOnly = Boolean(
    !isSuperAdmin &&
    !isFacilityAdmin &&
    canManageStaff &&
    !permissions.has('facilities.update') &&
    !permissions.has('system.settings.manage') &&
    !permissions.has('roles.permissions.manage'),
  );

  const integrationOnly =
    (canViewPaymentHub || canViewPayerHub) &&
    !isFacilityAdmin &&
    !canManageStaff &&
    !permissions.has('facilities.update') &&
    !permissions.has('system.settings.manage') &&
    !permissions.has('roles.permissions.manage');

  const [activeTab, setActiveTab] = useState<
    'facility' | 'modules' | 'roles' | 'tariffs' | 'payments' | 'payers' | 'staff'
  >(
    integrationOnly
      ? canViewPaymentHub
        ? 'payments'
        : 'payers'
      : staffOnly
        ? 'staff'
        : 'facility',
  );

  useEffect(() => {
    /*
     * An account that holds only staff permissions has one honest
     * landing place. A facility administrator now sees the profile and
     * the module switches as well, so they are not forced to Staff.
     */
    if (integrationOnly) setActiveTab(canViewPaymentHub ? 'payments' : 'payers');
    else if (staffOnly) setActiveTab('staff');
  }, [staffOnly, integrationOnly, canViewPaymentHub]);

  /*
   * Facility module provisioning.
   *
   * This used to be a hard-coded map of seventeen modules that all
   * read `true`, rendered as switches that flipped local state and
   * toasted "updated". It had no connection to
   * `currentFacility.enabledModules`, which is the list the navigation
   * rail and the server-side module guard actually read — so a
   * facility whose row omitted `maternity` showed Maternity as ON
   * here and hid the antenatal register in the rail.
   *
   * The draft now starts from the facility row and is written back
   * through PATCH /api/facilities/:id/modules.
   */
  const [moduleDraft, setModuleDraft] = useState<string[]>(() =>
    resolveFacilityModules(currentFacility?.enabledModules),
  );
  const [hiddenDraft, setHiddenDraft] = useState<string[]>(() =>
    resolveHiddenFacilityModules(currentFacility?.hiddenModules),
  );
  const [moduleSaving, setModuleSaving] = useState(false);
  const [moduleError, setModuleError] = useState('');

  useEffect(() => {
    setModuleDraft(resolveFacilityModules(currentFacility?.enabledModules));
    setHiddenDraft(resolveHiddenFacilityModules(currentFacility?.hiddenModules));
    setModuleError('');
  }, [currentFacility?.id, currentFacility?.enabledModules, currentFacility?.hiddenModules]);

  /*
   * Mirrors the server rule in facility-modules.routes.ts. The server
   * decides; this only decides whether to offer the control.
   */
  const canProvisionModules = Boolean(
    isSuperAdmin ||
    isFacilityAdmin ||
    permissions.has('facilities.modules.manage') ||
    permissions.has('system.settings.manage'),
  );

  const savedModules = resolveFacilityModules(currentFacility?.enabledModules);
  const moduleChanges = [
    ...moduleDraft.filter((id) => !savedModules.includes(id)),
    ...savedModules.filter((id) => !moduleDraft.includes(id)),
  ];
  const savedHidden = resolveHiddenFacilityModules(currentFacility?.hiddenModules);
  const hiddenChanges = [
    ...hiddenDraft.filter((id) => !savedHidden.includes(id)),
    ...savedHidden.filter((id) => !hiddenDraft.includes(id)),
  ];
  const moduleDirty = moduleChanges.length + hiddenChanges.length > 0;

  const moduleGroups = Array.from(
    FACILITY_MODULES.reduce((groups, module) => {
      const list = groups.get(module.group) ?? [];
      list.push(module);
      groups.set(module.group, list);
      return groups;
    }, new Map<string, (typeof FACILITY_MODULES)[number][]>()),
  ).map(([group, modules]) => ({ group, modules }));

  const toggleModule = (moduleId: string) => {
    if (!canProvisionModules) return;

    const definition = FACILITY_MODULES.find((module) => module.id === moduleId);

    if (definition?.alwaysOn) return;

    setModuleError('');
    setModuleDraft((current) =>
      current.includes(moduleId) ? current.filter((id) => id !== moduleId) : [...current, moduleId],
    );
  };

  const handleSaveModules = async () => {
    if (!currentFacility) return;

    setModuleSaving(true);
    setModuleError('');

    try {
      const result = await api.updateFacilityModules(currentFacility.id, moduleDraft, {
        hiddenModules: hiddenDraft,
      });

      setCurrentFacility({
        ...currentFacility,
        enabledModules: result.enabledModules,
        hiddenModules: result.hiddenModules ?? [],
      });
      setModuleDraft(result.enabledModules);
      setHiddenDraft(result.hiddenModules ?? []);

      const enabledLabels = result.added
        .map((id) => FACILITY_MODULES.find((module) => module.id === id)?.label ?? id)
        .join(', ');
      const disabledLabels = result.removed
        .map((id) => FACILITY_MODULES.find((module) => module.id === id)?.label ?? id)
        .join(', ');

      const parts = [
        enabledLabels ? `${enabledLabels} enabled` : '',
        disabledLabels ? `${disabledLabels} disabled` : '',
        (result.hiddenAdded?.length ?? 0) + (result.hiddenRemoved?.length ?? 0) > 0
          ? 'navigation visibility updated'
          : '',
      ].filter(Boolean);

      showToast(
        parts.length > 0
          ? `Modules saved: ${parts.join('; ')}. The navigation has been updated.`
          : 'Modules saved. Nothing changed.',
        { tone: 'success' },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save the module list.';

      setModuleError(message);
      showToast(message, { tone: 'error' });
    } finally {
      setModuleSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader>
        <div>
          <h1 className="ui-page-title">Hospital Configuration Engine</h1>
          <p className="ui-page-description">
            Zero-code administrative controls: Facility details, enabled modular features, RBAC
            matrix, and payment gateways.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 bg-teal-50 border border-teal-200 text-teal-800 text-xs font-semibold rounded-lg">
            Tenant: {currentTenant?.name}
          </span>
        </div>
      </PageHeader>

      {/* Navigation Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl p-2 shadow-xs flex flex-wrap items-center gap-2">
        {[
          { id: 'facility', label: 'Facility Profile', icon: Building2 },
          { id: 'modules', label: 'Modular Features Engine', icon: Layers },
          { id: 'staff', label: 'Staff & Roles', icon: UserPlus },
          { id: 'payments', label: 'Payment & Banking Integrations', icon: CreditCard },
          { id: 'payers', label: 'Payers & eClaims', icon: ShieldCheck },
          { id: 'tariffs', label: 'Facility Services & Tariffs', icon: DollarSign },
        ]
          .filter((tab) => {
            if (tab.id === 'payments') return canViewPaymentHub;
            if (tab.id === 'payers') return canViewPayerHub;
            if (integrationOnly) return false;
            if (tab.id === 'staff') return canManageStaff;
            if (staffOnly) return false;
            /*
             * A facility administrator runs the facility: profile, module
             * provisioning, staff and tariffs. Payment access is checked above
             * with its own scoped permission. This used to return only `tariffs`,
             * which is why a facility administrator could never reach the
             * module switches at all.
             */
            if (isFacilityAdmin) return tab.id !== 'payments';
            return tab.id !== 'tariffs' && (!isSuperAdmin || tab.id !== 'staff');
          })
          .map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-teal-700 text-white font-semibold shadow-xs'
                    : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
      </div>

      {/* STAFF & ROLES TAB — the directory comes before the invitation form */}
      {activeTab === 'staff' && (
        <div className="space-y-6">
          <StaffRolesPanel />
          <StaffInvitationsPanel />
        </div>
      )}
      {/* FACILITY PROFILE TAB */}
      {activeTab === 'facility' && (
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Facility profile</p>
              <h2 className="mt-1 text-sm font-bold text-ink">
                {currentFacility?.name ?? 'No facility selected'}
              </h2>
            </div>
            <span className="chip font-mono">{currentFacility?.code ?? '—'}</span>
          </div>

          <dl className="grid grid-cols-1 gap-px bg-hair sm:grid-cols-2">
            {[
              { label: 'Facility level', value: currentFacility?.level },
              { label: 'KMFL / MFL code', value: currentFacility?.mflCode },
              { label: 'County', value: currentFacility?.county },
              { label: 'Sub-county', value: currentFacility?.subCounty },
              { label: 'Contact phone', value: currentFacility?.phone },
              { label: 'Official email', value: currentFacility?.email },
              { label: 'Tenant', value: currentTenant?.name },
              { label: 'Physical address', value: currentFacility?.address },
            ].map((field) => (
              <div key={field.label} className="bg-surface px-5 py-3">
                <dt className="eyebrow">{field.label}</dt>
                <dd className="mt-1 text-sm font-semibold text-ink">
                  {field.value || <span className="font-normal text-slate-400">Not recorded</span>}
                </dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hair px-5 py-3">
            <p className="flex max-w-xl items-start gap-2 text-2xs leading-relaxed text-muted">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              Facility identity fields are changed by a platform administrator. This table shows
              what the facility row currently holds; there is no edit form here because this screen
              has no facility-profile endpoint to call.
            </p>

            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => setActiveModule('platform_administration')}
                className="btn-quiet"
              >
                Open Platform Administration
              </button>
            )}
          </div>
        </div>
      )}

      {/* MODULAR FEATURES ENGINE TAB */}
      {activeTab === 'modules' && (
        <div className="space-y-4">
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Provisioning</p>
                <h2 className="mt-1 text-sm font-bold text-ink">Facility modules</h2>
                <p className="mt-1 max-w-2xl text-2xs leading-relaxed text-muted">
                  A switch here decides two things: whether the module appears in the navigation
                  rail, and whether the server answers that module's API. Records already stored are
                  kept when a module is switched off.
                </p>
              </div>

              <span className="chip font-mono">
                {moduleDraft.length} / {FACILITY_MODULES.length} enabled
              </span>
            </div>

            {moduleError && (
              <div
                role="alert"
                className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-2xs text-red-800"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{moduleError}</span>
              </div>
            )}

            {!canProvisionModules && (
              <div className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-2xs text-amber-900">
                This account can see the module list but cannot change it. Module provisioning needs
                the <span className="font-mono">facilities.modules.manage</span> permission or a
                facility administrator account.
              </div>
            )}

            {currentFacility?.id === undefined && (
              <div className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-2xs text-amber-900">
                No facility is selected, so there is nothing to provision.
              </div>
            )}

            <div className="space-y-5 p-5">
              {moduleGroups.map((group) => (
                <section key={group.group}>
                  <h3 className="eyebrow">{group.group}</h3>

                  <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {group.modules.map((module) => {
                      const on = moduleDraft.includes(module.id);
                      const locked = !canProvisionModules || Boolean(module.alwaysOn);

                      return (
                        <button
                          key={module.id}
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-label={`${module.label} module`}
                          disabled={locked || moduleSaving}
                          onClick={() => toggleModule(module.id)}
                          className={`flex w-full items-start justify-between gap-3 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed ${
                            on
                              ? 'border-brand-300 bg-brand-50/70'
                              : 'border-hair bg-surface hover:border-brand-200'
                          } disabled:opacity-80`}
                        >
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span
                                className={`text-xs font-semibold ${
                                  on ? 'text-brand-900' : 'text-ink-soft'
                                }`}
                              >
                                {module.label}
                              </span>
                              {module.alwaysOn && (
                                <Lock
                                  className="h-3 w-3 text-slate-400"
                                  aria-label="always available"
                                />
                              )}
                            </span>
                            <span className="mt-1 block text-2xs leading-relaxed text-muted">
                              {module.description}
                            </span>
                          </span>

                          <span
                            aria-hidden="true"
                            className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${
                              on ? 'bg-brand-500' : 'bg-slate-300'
                            }`}
                          >
                            <span
                              className={`h-4 w-4 rounded-full bg-white shadow-sm transition ${
                                on ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            <div className="border-t border-hair px-5 py-4">
              <h3 className="text-xs font-semibold text-ink">Hide from navigation</h3>
              <p className="mt-1 text-2xs text-muted">
                Hidden modules remain enabled and their APIs remain available to authorized staff.
                Hiding is not an access-control setting.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {FACILITY_MODULES.filter(
                  (module) => !module.alwaysOn && moduleDraft.includes(module.id),
                ).map((module) => (
                  <label key={module.id} className="flex items-center gap-2 text-xs text-ink-soft">
                    <input
                      type="checkbox"
                      checked={hiddenDraft.includes(module.id)}
                      disabled={!canProvisionModules || moduleSaving}
                      onChange={() =>
                        setHiddenDraft((current) =>
                          current.includes(module.id)
                            ? current.filter((id) => id !== module.id)
                            : [...current, module.id],
                        )
                      }
                    />
                    Hide {module.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hair px-5 py-3">
              <p className="text-2xs text-muted">
                {moduleDirty
                  ? `${moduleChanges.length + hiddenChanges.length} unsaved change${moduleChanges.length + hiddenChanges.length === 1 ? '' : 's'}.`
                  : 'Every change here is written to the facility row and recorded in the audit log.'}
              </p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setModuleDraft(savedModules);
                    setHiddenDraft(savedHidden);
                    setModuleError('');
                  }}
                  disabled={!moduleDirty || moduleSaving}
                  className="btn-quiet"
                >
                  Discard
                </button>

                <button
                  type="button"
                  onClick={() => void handleSaveModules()}
                  disabled={!moduleDirty || moduleSaving || !canProvisionModules}
                  className="btn-primary"
                >
                  <Save className="h-3.5 w-3.5" />
                  {moduleSaving ? 'Saving…' : 'Save modules'}
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
            <p className="text-xs font-semibold text-brand-900">
              Where the antenatal register lives
            </p>
            <p className="mt-1 max-w-3xl text-2xs leading-relaxed text-brand-800">
              It is inside <strong>Maternity &amp; MCH</strong> &rarr;{' '}
              <strong>Antenatal register</strong>, the first of five tabs (labour, deliveries,
              postnatal and immunisation follow). When Maternity is switched on above it is added to
              the Clinical care section of the navigation immediately, with no reload.
            </p>
          </div>
        </div>
      )}

      {/* Facility-scoped payment settings; no fabricated credentials or active status. */}
      {activeTab === 'payments' && <FacilityPaymentIntegrations />}
      {activeTab === 'payers' && <FacilityPayerIntegrations />}

      {/* One facility-owned configuration screen; historical tariff rows remain visible. */}
      {isFacilityAdmin && activeTab === 'tariffs' && currentFacility?.id && (
        <FacilityServicesManager
          key={currentFacility.id}
          facilityId={currentFacility.id}
          enabledModules={
            Array.isArray(currentFacility.enabledModules) ? currentFacility.enabledModules : []
          }
          canManage={permissions.has('tariffs.manage')}
        />
      )}
    </div>
  );
};
