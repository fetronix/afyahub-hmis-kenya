import { Baby, Building2, ChevronLeft, ChevronRight, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useHmis, ModuleId } from '../context/HmisContext.tsx';
import {
  LayoutDashboard,
  UserPlus,
  Users,
  Stethoscope,
  BedDouble,
  Scissors,
  Eye,
  FlaskConical,
  Scan,
  Pill,
  Package,
  ShoppingCart,
  Receipt,
  FileCheck2,
  Activity,
  BarChart3,
  Network,
  Sliders,
  ShieldAlert,
  QrCode,
} from 'lucide-react';

export interface NavSection {
  title: string;
  items: Array<{
    id: ModuleId;
    label: string;
    icon: React.ElementType;
    badge?: string;
  }>;
}

export const superAdminNavSections: NavSection[] = [
  {
    title: 'PLATFORM MANAGEMENT',
    items: [{ id: 'dashboard', label: 'Platform Management', icon: LayoutDashboard }],
  },
  {
    title: 'ORGANIZATIONS & BILLING',
    items: [
      { id: 'platform_administration', label: 'Tenant & Facility Management', icon: Building2 },
    ],
  },
  {
    title: 'SECURITY & ACCESS',
    items: [
      { id: 'audit', label: 'Audit Logs', icon: ShieldAlert },
      { id: 'configuration', label: 'Platform Settings', icon: Sliders },
    ],
  },
  {
    /*
     * The DHA readiness assessment is a platform-owner view, not a
     * facility screen: it scores the whole product against 46
     * requirements and names what is missing. It used to sit in the
     * facility rail; it is now here and nowhere else.
     */
    title: 'INTEGRATIONS & READINESS',
    items: [{ id: 'interoperability', label: 'DHA Readiness & FHIR', icon: Network }],
  },
];

/*
 * The facility rail follows the patient, not the database: the order is
 * the order of a visit — arrive, be seen, be investigated, collect
 * medicine, be admitted — then the money and the reporting that follow.
 */
export const navSections: NavSection[] = [
  {
    title: 'CLINICAL CARE',
    items: [
      { id: 'dashboard', label: 'Overview & KPIs', icon: LayoutDashboard },
      { id: 'registration', label: 'Patient Directory', icon: UserPlus },
      { id: 'reception', label: 'Reception & Queue', icon: Users },
      { id: 'opd', label: 'Outpatient & Triage', icon: Stethoscope },
      { id: 'inpatient', label: 'Inpatient & Wards', icon: BedDouble },
      { id: 'maternity', label: 'Maternity & MCH', icon: Baby },
      { id: 'theatre', label: 'Operating Theatre', icon: Scissors },
      { id: 'specialty', label: 'Specialty Clinics', icon: Eye },
    ],
  },
  {
    title: 'DIAGNOSTICS',
    items: [
      { id: 'laboratory', label: 'Laboratory & Pathology', icon: FlaskConical },
      { id: 'radiology', label: 'Radiology & Imaging', icon: Scan },
    ],
  },
  {
    title: 'PHARMACY & SUPPLIES',
    items: [
      { id: 'pharmacy', label: 'Pharmacy & Dispense', icon: Pill },
      { id: 'inventory', label: 'Inventory & Batches', icon: Package },
      { id: 'procurement', label: 'Procurement & POs', icon: ShoppingCart },
    ],
  },
  {
    title: 'REVENUE & PAYERS',
    items: [
      { id: 'finance', label: 'Billing & Cashier POS', icon: Receipt },
      { id: 'claims', label: 'SHA & E-Claims', icon: FileCheck2 },
    ],
  },
  {
    /*
     * `interoperability` is deliberately absent. It is a superadmin
     * screen — it opens the readiness assessment, the DHA connection
     * report and the FHIR preview. Ordinary staff see neither the
     * entry nor the screen; the API refuses them as well, so hiding
     * the rail item is not the only thing standing in the way.
     */
    title: 'INTELLIGENCE & REPORTING',
    items: [
      { id: 'analytics', label: 'Reports & Revenue', icon: BarChart3 },
      { id: 'public_health', label: 'MOH 705 Surveillance', icon: Activity },
    ],
  },
  {
    title: 'ADMINISTRATION',
    items: [
      { id: 'platform_administration', label: 'Platform Administration', icon: Building2 },
      { id: 'configuration', label: 'System Configuration', icon: Sliders },
      { id: 'patient_portal', label: 'Patient Portal Management', icon: QrCode },
      { id: 'audit', label: 'Audit Trail & Security', icon: ShieldAlert },
    ],
  },
];

const COLLAPSE_KEY = 'jalicare.sidebar.collapsed';

export const Sidebar: React.FC = () => {
  const {
    activeModule,
    setActiveModule,
    currentTenant,
    setCurrentTenant,
    tenants,
    currentFacility,
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    showToast,
    authenticatedUser,
  } = useHmis();

  /*
   * The rail remembers whether the user folded it away. This is a
   * preference, not a permission: it changes nothing about what the
   * session may open.
   */
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* A browser that blocks storage should still get a rail. */
    }
  }, [collapsed]);

  const permissions = new Set(authenticatedUser?.permissions ?? []);
  const isSuperAdmin = Boolean(
    authenticatedUser?.isSuperAdmin || authenticatedUser?.roles?.includes('SUPER_ADMIN'),
  );

  const can = (permission: string) => isSuperAdmin || permissions.has(permission);

  const isFacilityModuleEnabled = (id: ModuleId): boolean => {
    // Platform administration is not an operational facility module.
    if (id === 'platform_administration') return true;

    /*
     * Configuration is where a facility switches its modules on and
     * off, so it cannot itself depend on the list it controls. A
     * facility row that omits `configuration` would otherwise hide the
     * only screen able to add it back. The permission list in
     * `isModuleVisible` still decides who gets in.
     */
    if (id === 'configuration') return true;

    const enabledModules = new Set(currentFacility?.enabledModules ?? []);

    // Do not expose operational modules until a facility is resolved.
    if (!currentFacility) return false;

    // Dashboard is available when at least one operational module is enabled.
    if (id === 'dashboard') {
      return [
        'registration',
        'reception',
        'opd',
        'inpatient',
        'maternity',
        'theatre',
        'specialty',
        'laboratory',
        'radiology',
        'pharmacy',
        'inventory',
        'procurement',
        'finance',
        'insurance',
        'claims',
        'public_health',
        'analytics',
        'interoperability',
        'configuration',
        'patient_portal',
        'audit',
      ].some((moduleId) => enabledModules.has(moduleId));
    }

    // The UI uses "claims"; the persisted facility setting uses "insurance".
    if (id === 'claims') {
      return enabledModules.has('insurance') || enabledModules.has('claims');
    }

    return enabledModules.has(id);
  };

  const isModuleVisible = (id: ModuleId): boolean => {
    // Global superadmins retain access to platform-management navigation.
    if (isSuperAdmin) return true;

    // Facility configuration overrides role permissions.
    if (!isFacilityModuleEnabled(id)) return false;

    const required: Partial<Record<ModuleId, string[]>> = {
      dashboard: [
        'patients.read',
        'appointments.read',
        'clinical.read',
        'inpatient.read',
        'laboratory.read',
        'pharmacy.read',
        'inventory.read',
        'billing.read',
        'reports.read',
      ],
      registration: ['patients.read'],
      reception: ['appointments.read', 'clinical.read', 'patients.read'],
      opd: ['clinical.read'],
      inpatient: ['inpatient.read'],
      maternity: ['maternity.read'],
      theatre: ['clinical.read', 'inpatient.read'],
      specialty: ['clinical.read'],
      laboratory: ['laboratory.read'],
      radiology: ['laboratory.read', 'clinical.read'],
      pharmacy: ['pharmacy.read'],
      inventory: ['inventory.read'],
      procurement: ['procurement.read'],
      finance: ['billing.read'],
      claims: ['insurance.read'],
      analytics: ['reports.read'],
      public_health: ['reports.read'],
      interoperability: ['interop.fhir.patient.read'],
      configuration: [
        'system.settings.manage',
        'users.roles.manage',
        'roles.permissions.manage',
        'facilities.update',
        /*
         * A facility administrator holds none of the four above on a
         * fresh install; they hold users.invite, which is what the
         * staff screen needs. Without this the Staff tab — and the
         * invitation screen that was already there — had no way in.
         */
        'users.invite',
      ],
      /*
       * Portal administration is a separate duty from configuration.
       * A receptionist holds `portal.invite` but not
       * `portal.accounts.manage`, so the management screen stays out of
       * their rail while the invitation button in reception still works.
       */
      patient_portal: ['portal.accounts.manage'],
      audit: ['audit.read', 'audit.security.read'],
    };

    return (required[id] ?? []).some(can);
  };

  const handleSelectModule = (id: ModuleId) => {
    setActiveModule(id);
    if (isMobileMenuOpen) {
      setIsMobileMenuOpen(false);
    }
  };

  const sections = isSuperAdmin ? superAdminNavSections : navSections;

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isMobileMenuOpen && (
        <div
          onClick={() => setIsMobileMenuOpen(false)}
          className="fixed inset-0 z-30 bg-navy-950/60 backdrop-blur-[2px] md:hidden animate-in fade-in duration-200"
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`flex shrink-0 select-none flex-col overflow-y-auto bg-navy-900 transition-[width,transform] duration-200 ease-in-out z-40
          fixed inset-y-0 left-0 top-16 w-[17rem] md:static md:translate-x-0 ${
            isMobileMenuOpen ? 'translate-x-0 shadow-lift' : '-translate-x-full md:translate-x-0'
          } ${collapsed ? 'md:w-[4.75rem]' : 'md:w-[17rem]'}`}
      >
        {/* Mobile Header Close */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 md:hidden">
          <span className="text-sm font-semibold tracking-tight text-white">JaliCare HMIS</span>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="rounded-lg p-1.5 text-navy-200 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mobile Tenant Selector (Visible on small screens) */}
        <div className="border-b border-white/10 px-4 py-3 md:hidden">
          <div className="mb-1.5 text-3xs font-semibold uppercase tracking-[0.16em] text-brand-300">
            Organization (Tenant)
          </div>
          <select
            value={currentTenant?.id}
            onChange={(e) => {
              const t = tenants.find((item) => item.id === Number(e.target.value));
              if (t) {
                setCurrentTenant(t);
                showToast(`Switched tenant to: ${t.name}`);
              }
            }}
            className="w-full rounded-lg border border-white/15 bg-navy-800 px-2.5 py-2 text-xs font-medium text-white outline-none focus:border-brand-400"
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {/* Read-only facility identity; hidden for superadmin */}
        {!isSuperAdmin && (
          <div className={`border-b border-white/10 ${collapsed ? 'px-3 py-4' : 'px-4 py-4'}`}>
            {collapsed ? (
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.06] text-brand-300"
                title={currentFacility?.name || 'Facility not assigned'}
              >
                <Building2 className="h-4 w-4" />
              </div>
            ) : (
              <>
                <div className="mb-2 text-3xs font-semibold uppercase tracking-[0.16em] text-brand-300/80">
                  Your facility
                </div>

                <div className="flex items-start gap-2.5">
                  <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-ember-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug text-white break-words">
                      {currentFacility?.name || 'Facility not assigned'}
                    </p>

                    <p className="mt-1.5 font-mono text-2xs text-navy-200">
                      MFL {currentFacility?.mflCode || '—'}
                    </p>

                    <p className="mt-0.5 text-2xs text-navy-300">
                      {currentFacility?.level || 'Level not configured'}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Navigation Sections */}
        <nav className={`flex-1 space-y-5 py-4 ${collapsed ? 'px-2' : 'px-3'}`}>
          {sections
            .filter((sec) => sec.items.some((item) => isModuleVisible(item.id)))
            .map((sec, secIdx) => (
              <div key={secIdx}>
                {!collapsed ? (
                  <div className="mb-1.5 px-2.5 text-3xs font-semibold uppercase tracking-[0.16em] text-brand-300/70">
                    {sec.title}
                  </div>
                ) : (
                  secIdx > 0 && <div className="mx-2 mb-3 h-px bg-white/10" />
                )}

                <div className="space-y-0.5">
                  {sec.items
                    .filter((item) => isModuleVisible(item.id))
                    .map((item) => {
                      const Icon = item.icon;
                      const isActive = activeModule === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => handleSelectModule(item.id)}
                          aria-current={isActive ? 'page' : undefined}
                          title={collapsed ? item.label : undefined}
                          className={`relative flex min-h-[40px] w-full items-center rounded-lg text-left text-xs transition-colors md:min-h-0 ${
                            collapsed ? 'justify-center px-0 py-2.5' : 'justify-between px-2.5 py-2'
                          } ${
                            isActive
                              ? 'bg-brand-600/30 font-semibold text-white'
                              : 'font-medium text-navy-100/85 hover:bg-white/[0.06] hover:text-white'
                          }`}
                        >
                          {isActive && (
                            <span
                              aria-hidden="true"
                              className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-ember-500"
                            />
                          )}

                          {collapsed ? (
                            <Icon
                              className={`h-[18px] w-[18px] shrink-0 ${
                                isActive ? 'text-white' : 'text-brand-300/80'
                              }`}
                            />
                          ) : (
                            <>
                              <span className="flex min-w-0 items-center gap-2.5 truncate">
                                <Icon
                                  className={`h-4 w-4 shrink-0 ${
                                    isActive ? 'text-ember-300' : 'text-brand-300/80'
                                  }`}
                                />
                                <span className="truncate">{item.label}</span>
                              </span>
                              {item.badge && (
                                <span
                                  className={`rounded px-1.5 font-mono text-2xs font-semibold ${
                                    isActive
                                      ? 'bg-ember-500 text-white'
                                      : 'bg-white/10 text-navy-100'
                                  }`}
                                >
                                  {item.badge}
                                </span>
                              )}
                            </>
                          )}
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
        </nav>

        {/* Collapse control (desktop) */}
        <div className="hidden border-t border-white/10 px-3 py-2.5 md:block">
          <button
            type="button"
            onClick={() => setCollapsed((current) => !current)}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-2xs font-medium text-navy-200 transition-colors hover:bg-white/[0.06] hover:text-white ${
              collapsed ? 'justify-center' : ''
            }`}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span>Collapse menu</span>
              </>
            )}
          </button>
        </div>

        {/* Footer Info */}
        <div
          className={`border-t border-white/10 text-3xs text-navy-300 ${collapsed ? 'px-2 py-3' : 'px-4 py-3'}`}
        >
          {collapsed ? (
            <div className="flex justify-center">
              <span className="h-1.5 w-1.5 rounded-full bg-ember-500" title="Kenya MOH ready" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">JaliCare HMIS</span>
                <span className="font-semibold text-ember-400">Kenya MOH Ready</span>
              </div>
              <div className="mt-1 text-navy-300">DHA Architecture &amp; FHIR R4</div>
            </>
          )}
        </div>
      </aside>
    </>
  );
};
