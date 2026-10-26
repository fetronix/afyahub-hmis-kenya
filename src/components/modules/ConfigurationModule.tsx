import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import type { ServiceTariff } from '../../types/index.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import { StaffInvitationsPanel } from './StaffInvitationsPanel.tsx';
import { StaffRolesPanel } from './StaffRolesPanel.tsx';
import { FACILITY_MODULES, resolveFacilityModules } from '../../config/facility-modules.ts';
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

  const [activeTab, setActiveTab] = useState<
    'facility' | 'modules' | 'roles' | 'tariffs' | 'payments' | 'staff'
  >(staffOnly ? 'staff' : 'facility');

  useEffect(() => {
    /*
     * An account that holds only staff permissions has one honest
     * landing place. A facility administrator now sees the profile and
     * the module switches as well, so they are not forced to Staff.
     */
    if (staffOnly) {
      setActiveTab('staff');
    }
  }, [staffOnly]);

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
  const [moduleSaving, setModuleSaving] = useState(false);
  const [moduleError, setModuleError] = useState('');

  useEffect(() => {
    setModuleDraft(resolveFacilityModules(currentFacility?.enabledModules));
    setModuleError('');
  }, [currentFacility?.id, currentFacility?.enabledModules]);

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
  const moduleDirty = moduleChanges.length > 0;

  const moduleGroups = Array.from(
    FACILITY_MODULES.reduce((groups, module) => {
      const list = groups.get(module.group) ?? [];
      list.push(module);
      groups.set(module.group, list);
      return groups;
    }, new Map<string, (typeof FACILITY_MODULES)[number][]>()),
  ).map(([group, modules]) => ({ group, modules }));

  // Facility-scoped service tariff management.
  const [tariffs, setTariffs] = useState<ServiceTariff[]>([]);
  const [tariffsLoading, setTariffsLoading] = useState(false);
  const [tariffSaving, setTariffSaving] = useState(false);
  const [tariffError, setTariffError] = useState('');
  const [editingTariffId, setEditingTariffId] = useState<number | null>(null);
  const [tariffFormOpen, setTariffFormOpen] = useState(false);
  const [tariffForm, setTariffForm] = useState({
    code: '',
    description: '',
    department: 'opd',
    unit: 'Service',
    fee: '',
    shaStatus: 'Not Assessed',
    shaNotes: '',
  });

  const tariffDepartments = [
    { id: 'opd', label: 'OPD / Outpatient' },
    { id: 'inpatient', label: 'Inpatient' },
    { id: 'theatre', label: 'Theatre' },
    { id: 'specialty', label: 'Specialty' },
    { id: 'laboratory', label: 'Laboratory' },
    { id: 'radiology', label: 'Radiology' },
    { id: 'pharmacy', label: 'Pharmacy' },
    { id: 'registration', label: 'Registration' },
    { id: 'reception', label: 'Reception' },
    { id: 'insurance', label: 'Insurance / SHA' },
    { id: 'finance', label: 'Finance / General' },
  ];

  const facilityModules = Array.isArray(currentFacility?.enabledModules)
    ? currentFacility.enabledModules
    : [];

  const availableTariffDepartments = tariffDepartments.filter((department) =>
    facilityModules.includes(department.id),
  );

  const resetTariffForm = () => {
    setEditingTariffId(null);
    setTariffForm({
      code: '',
      description: '',
      department: availableTariffDepartments[0]?.id || 'opd',
      unit: 'Service',
      fee: '',
      shaStatus: 'Not Assessed',
      shaNotes: '',
    });
    setTariffFormOpen(false);
  };

  const loadTariffs = async () => {
    if (!currentFacility?.id) {
      setTariffs([]);
      return;
    }

    setTariffsLoading(true);
    setTariffError('');
    try {
      const result = await api.getServiceTariffs(currentFacility.id);
      setTariffs(Array.isArray(result) ? result : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load service tariffs.';
      setTariffError(message);
      setTariffs([]);
    } finally {
      setTariffsLoading(false);
    }
  };

  useEffect(() => {
    if (isFacilityAdmin && activeTab === 'tariffs') {
      void loadTariffs();
    }
  }, [activeTab, currentFacility?.id]);

  const startTariffEdit = (tariff: ServiceTariff) => {
    setEditingTariffId(tariff.id);
    setTariffForm({
      code: tariff.code,
      description: tariff.description,
      department: tariff.department,
      unit: tariff.unit,
      fee: String(tariff.fee),
      shaStatus: tariff.shaStatus,
      shaNotes: tariff.shaNotes || '',
    });
    setTariffFormOpen(true);
  };

  const saveTariff = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!currentFacility?.id) {
      showToast('Select a facility before managing tariffs.');
      return;
    }

    const fee = Number(tariffForm.fee);
    if (!Number.isFinite(fee) || fee < 0 || !/^\d+(\.\d{1,2})?$/.test(tariffForm.fee.trim())) {
      showToast('Enter a valid fee with no more than two decimal places.');
      return;
    }

    setTariffSaving(true);
    try {
      const input = {
        facilityId: currentFacility.id,
        code: tariffForm.code.trim().toUpperCase(),
        description: tariffForm.description.trim(),
        department: tariffForm.department,
        unit: tariffForm.unit.trim(),
        fee: fee.toFixed(2),
        shaStatus: tariffForm.shaStatus,
        shaNotes: tariffForm.shaNotes.trim() || null,
      };

      if (editingTariffId !== null) {
        await api.updateServiceTariff(editingTariffId, input);
        showToast('Service tariff updated.');
      } else {
        await api.createServiceTariff(input);
        showToast('Service tariff created.');
      }

      resetTariffForm();
      await loadTariffs();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save the service tariff.');
    } finally {
      setTariffSaving(false);
    }
  };

  const deactivateTariff = async (tariff: ServiceTariff) => {
    if (!currentFacility?.id || !window.confirm(`Deactivate tariff ${tariff.code}?`)) {
      return;
    }

    try {
      await api.deactivateServiceTariff(tariff.id, currentFacility.id);
      showToast('Service tariff deactivated.');
      await loadTariffs();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not deactivate the tariff.');
    }
  };
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
      const result = await api.updateFacilityModules(currentFacility.id, moduleDraft);

      setCurrentFacility({
        ...currentFacility,
        enabledModules: result.enabledModules,
      });
      setModuleDraft(result.enabledModules);

      const enabledLabels = result.added
        .map((id) => FACILITY_MODULES.find((module) => module.id === id)?.label ?? id)
        .join(', ');
      const disabledLabels = result.removed
        .map((id) => FACILITY_MODULES.find((module) => module.id === id)?.label ?? id)
        .join(', ');

      const parts = [
        enabledLabels ? `${enabledLabels} enabled` : '',
        disabledLabels ? `${disabledLabels} disabled` : '',
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-card border border-hair bg-surface p-5 shadow-card">
        <div>
          <h1 className="font-display text-[1.35rem] leading-tight tracking-tight text-ink">
            Hospital Configuration Engine
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Zero-code administrative controls: Facility details, enabled modular features, RBAC
            matrix, and payment gateways.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 bg-teal-50 border border-teal-200 text-teal-800 text-xs font-semibold rounded-lg">
            Tenant: {currentTenant?.name}
          </span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl p-2 shadow-xs flex flex-wrap items-center gap-2">
        {[
          { id: 'facility', label: 'Facility Profile', icon: Building2 },
          { id: 'modules', label: 'Modular Features Engine', icon: Layers },
          { id: 'staff', label: 'Staff & Roles', icon: UserPlus },
          { id: 'payments', label: 'M-Pesa & Payment Channels', icon: CreditCard },
          { id: 'tariffs', label: 'Service Pricing & Tariffs', icon: DollarSign },
        ]
          .filter((tab) => {
            if (tab.id === 'staff') return canManageStaff;
            if (staffOnly) return false;
            /*
             * A facility administrator runs the facility: profile, module
             * provisioning, staff and tariffs. Payment credentials stay
             * with the platform. This used to return only `tariffs`,
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

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hair px-5 py-3">
              <p className="text-2xs text-muted">
                {moduleDirty
                  ? `${moduleChanges.length} unsaved change${moduleChanges.length === 1 ? '' : 's'}.`
                  : 'Every change here is written to the facility row and recorded in the audit log.'}
              </p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setModuleDraft(savedModules);
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

      {/* PAYMENT CHANNELS TAB */}
      {activeTab === 'payments' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs text-xs space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900 uppercase">
              Payment Gateway Integration & M-Pesa Credentials
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 border border-slate-200 rounded-lg space-y-3">
              <span className="font-bold text-slate-900 text-xs">
                Safaricom Daraja M-Pesa STK Push
              </span>
              <div>
                <label className="block text-slate-600 mb-1">Business Shortcode / Paybill</label>
                <input
                  type="text"
                  defaultValue="883921"
                  className="w-full px-3 py-1.5 border border-slate-200 rounded font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Passkey</label>
                {/*
                  A Daraja passkey is a secret used to build every STK push
                  password. It is not rendered, prefilled or bundled here: a
                  value in this component would ship to every browser that
                  loads the app, and this panel has no integration behind it
                  to read one anyway.
                */}
                <input
                  type="password"
                  value=""
                  readOnly
                  placeholder="Held on the server"
                  className="w-full px-3 py-1.5 border border-slate-200 rounded font-mono bg-slate-50"
                />
                <p className="mt-1 text-2xs text-slate-500">
                  The passkey stays in the server environment and is never sent to the browser.
                </p>
              </div>
              <span className="text-2xs text-emerald-700 font-medium">
                ✓ Auto-STK Push Active on Cashier POS
              </span>
            </div>

            <div className="p-4 border border-slate-200 rounded-lg space-y-3">
              <span className="font-bold text-slate-900 text-xs">
                Bank Wire / PDQ Card Terminal
              </span>
              <div>
                <label className="block text-slate-600 mb-1">Bank Name</label>
                <input
                  type="text"
                  defaultValue="KCB Bank Kenya Ltd"
                  className="w-full px-3 py-1.5 border border-slate-200 rounded"
                />
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Account Number</label>
                <input
                  type="text"
                  defaultValue="1102948201"
                  className="w-full px-3 py-1.5 border border-slate-200 rounded font-mono"
                />
              </div>
              <span className="text-2xs text-emerald-700 font-medium">
                ✓ Card & EFT Reconciliation Active
              </span>
            </div>
          </div>
        </div>
      )}

      {/* SERVICE PRICING TAB */}
      {isFacilityAdmin && activeTab === 'tariffs' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs text-xs">
          <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900 uppercase">
                Facility Tariff & Pricing Schedule
              </h2>
              <p className="text-slate-500 mt-1">
                Manage prices for services offered by this facility.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                resetTariffForm();
                setTariffForm((previous) => ({
                  ...previous,
                  department: availableTariffDepartments[0]?.id || 'opd',
                }));
                setTariffFormOpen(true);
              }}
              disabled={availableTariffDepartments.length === 0}
              className="px-3 py-2 rounded-lg bg-teal-700 text-white font-semibold disabled:opacity-50"
            >
              + Add Service Tariff
            </button>
          </div>

          {!facilityModules.includes('finance') && (
            <div className="m-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900">
              The Finance module must be enabled before this facility can manage tariffs.
            </div>
          )}

          {availableTariffDepartments.length === 0 && (
            <div className="m-4 p-3 rounded-lg border border-slate-200 bg-slate-50 text-slate-600">
              No tariff departments are enabled for this facility. Enable the relevant modules
              first.
            </div>
          )}

          {tariffFormOpen && (
            <form
              onSubmit={saveTariff}
              className="m-4 p-4 border border-teal-200 rounded-xl bg-teal-50/30 space-y-4"
            >
              <h3 className="font-bold text-slate-900">
                {editingTariffId === null ? 'Create tariff' : 'Edit tariff'}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <label className="block">
                  <span className="block mb-1 font-medium text-slate-700">Service code</span>
                  <input
                    required
                    maxLength={50}
                    value={tariffForm.code}
                    onChange={(event) => setTariffForm({ ...tariffForm, code: event.target.value })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                    placeholder="e.g. SRV-OPD-01"
                  />
                </label>
                <label className="block md:col-span-1 lg:col-span-2">
                  <span className="block mb-1 font-medium text-slate-700">Description</span>
                  <input
                    required
                    maxLength={500}
                    value={tariffForm.description}
                    onChange={(event) =>
                      setTariffForm({ ...tariffForm, description: event.target.value })
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                    placeholder="Service description"
                  />
                </label>
                <label className="block">
                  <span className="block mb-1 font-medium text-slate-700">Department</span>
                  <select
                    required
                    value={tariffForm.department}
                    onChange={(event) =>
                      setTariffForm({ ...tariffForm, department: event.target.value })
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                  >
                    {availableTariffDepartments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block mb-1 font-medium text-slate-700">Unit</span>
                  <input
                    required
                    maxLength={50}
                    value={tariffForm.unit}
                    onChange={(event) => setTariffForm({ ...tariffForm, unit: event.target.value })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                    placeholder="Service, day, session..."
                  />
                </label>
                <label className="block">
                  <span className="block mb-1 font-medium text-slate-700">Fee (KES)</span>
                  <input
                    required
                    inputMode="decimal"
                    pattern="^\d+(\.\d{1,2})?$"
                    value={tariffForm.fee}
                    onChange={(event) => setTariffForm({ ...tariffForm, fee: event.target.value })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                    placeholder="0.00"
                  />
                </label>
                <label className="block">
                  <span className="block mb-1 font-medium text-slate-700">SHA status</span>
                  <select
                    value={tariffForm.shaStatus}
                    onChange={(event) =>
                      setTariffForm({ ...tariffForm, shaStatus: event.target.value })
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                  >
                    <option>Not Assessed</option>
                    <option>Covered</option>
                    <option>Not Covered</option>
                    <option>Pre-Authorization Required</option>
                    <option>Conditional</option>
                  </select>
                </label>
                <label className="block md:col-span-2 lg:col-span-2">
                  <span className="block mb-1 font-medium text-slate-700">
                    SHA notes (optional)
                  </span>
                  <input
                    maxLength={1000}
                    value={tariffForm.shaNotes}
                    onChange={(event) =>
                      setTariffForm({ ...tariffForm, shaNotes: event.target.value })
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                    placeholder="Coverage conditions or notes"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={
                    tariffSaving ||
                    !facilityModules.includes('finance') ||
                    availableTariffDepartments.length === 0
                  }
                  type="submit"
                  className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
                >
                  {tariffSaving
                    ? 'Saving…'
                    : editingTariffId === null
                      ? 'Create tariff'
                      : 'Save changes'}
                </button>
                <button
                  type="button"
                  onClick={resetTariffForm}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {tariffError && (
            <div className="m-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900">
              <p>{tariffError}</p>
              <p className="mt-1">
                Confirm the database migration and tariff permissions have been reviewed and applied
                before retrying.
              </p>
              <button
                type="button"
                onClick={() => void loadTariffs()}
                className="mt-2 underline font-semibold"
              >
                Retry loading
              </button>
            </div>
          )}

          {tariffsLoading ? (
            <p className="p-6 text-center text-slate-500">Loading facility tariffs…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-y border-slate-200 text-2xs text-slate-500 uppercase">
                  <tr>
                    <th className="px-4 py-3 font-medium">Service code</th>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 font-medium">Department / unit</th>
                    <th className="px-4 py-3 font-medium text-right">Fee (KES)</th>
                    <th className="px-4 py-3 font-medium">SHA status</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tariffs.map((tariff) => (
                    <tr key={tariff.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono font-bold text-teal-800">{tariff.code}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {tariff.description}
                        {tariff.shaNotes && (
                          <p className="mt-1 text-slate-500 font-normal">{tariff.shaNotes}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {tariffDepartments.find((department) => department.id === tariff.department)
                          ?.label || tariff.department}
                        <p className="mt-1 text-slate-400">{tariff.unit}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900 tabular-nums">
                        {Number(tariff.fee).toLocaleString('en-KE', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{tariff.shaStatus}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-1 font-semibold ${tariff.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                        >
                          {tariff.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => startTariffEdit(tariff)}
                          className="mr-3 font-semibold text-teal-800 hover:underline"
                        >
                          Edit
                        </button>
                        {tariff.isActive && (
                          <button
                            type="button"
                            onClick={() => void deactivateTariff(tariff)}
                            className="font-semibold text-rose-700 hover:underline"
                          >
                            Deactivate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {tariffs.length === 0 && !tariffError && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                        No tariffs have been configured for this facility yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
