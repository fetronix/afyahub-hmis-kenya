import { Baby, Building2, ChevronLeft, ChevronRight, Cross, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
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
  ShieldCheck,
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
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'registration', label: 'Patient Management', icon: UserPlus },
      { id: 'reception', label: 'Appointments & Queue', icon: Users },
      { id: 'opd', label: 'Outpatient Services', icon: Stethoscope },
      { id: 'inpatient', label: 'Inpatient Management', icon: BedDouble },
      { id: 'maternity', label: 'Maternity & MCH', icon: Baby },
      { id: 'theatre', label: 'Operating Theatre', icon: Scissors },
      { id: 'dialysis', label: 'Dialysis Unit', icon: Activity },
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
      { id: 'finance', label: 'Billing & Invoicing', icon: Receipt },
      { id: 'payment_transactions', label: 'Payment Transactions', icon: Receipt },
      { id: 'accounting', label: 'Accounting & General Ledger', icon: BarChart3 },
      { id: 'claims', label: 'Insurance & SHA eClaims', icon: FileCheck2 },
      { id: 'private_insurance', label: 'Private Insurance', icon: ShieldCheck },
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
      { id: 'analytics', label: 'Reports & Analytics', icon: BarChart3 },
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

export const Sidebar: React.FC<{ collapsed: boolean; onToggleCollapse: () => void }> = ({
  collapsed,
  onToggleCollapse,
}) => {
  const {
    activeModule,
    setActiveModule,
    currentFacility,
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    authenticatedUser,
  } = useHmis();
  const [health, setHealth] = useState<'checking' | 'online' | 'unavailable'>('checking');

  useEffect(() => {
    let live = true;
    const check = () => {
      api
        .getHealth()
        .then((result) => {
          if (live) setHealth(result.status === 'healthy' ? 'online' : 'unavailable');
        })
        .catch(() => {
          if (live) setHealth('unavailable');
        });
    };
    check();
    const timer = window.setInterval(check, 60_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

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
    const hiddenModules = new Set(currentFacility?.hiddenModules ?? []);

    // Do not expose operational modules until a facility is resolved.
    if (!currentFacility) return false;
    const configuredId =
      id === 'claims' || id === 'private_insurance'
        ? 'insurance'
        : id === 'payment_transactions'
          ? 'finance'
          : id;
    if (hiddenModules.has(configuredId)) return false;

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

    // The UI uses "claims" and "private_insurance"; the persisted facility setting uses "insurance".
    if (id === 'claims' || id === 'private_insurance') {
      return enabledModules.has('insurance') || enabledModules.has('claims');
    }

    return enabledModules.has(configuredId);
  };

  const isModuleVisible = (id: ModuleId): boolean => {
    // Global superadmins retain access to platform-management navigation.
    if (isSuperAdmin)
      return ![
        'payment_transactions',
        'finance',
        'accounting',
        'claims',
        'private_insurance',
      ].includes(id);

    // Facility configuration overrides role permissions.
    if (!isFacilityModuleEnabled(id)) return false;

    // Tariff administrators need a route to their own facility's service page,
    // even when they have no staff-management permission. The page and APIs
    // still require the facility-admin role and tariff permissions.
    if (
      id === 'configuration' &&
      authenticatedUser?.roles?.includes('FACILITY_ADMIN') &&
      (permissions.has('tariffs.read') || permissions.has('tariffs.manage'))
    )
      return true;

    const required: Partial<Record<ModuleId, string[]>> = {
      dashboard: [
        'patients.read',
        'appointments.read',
        'clinical.read',
        'inpatient.read',
        'theatre.read',
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
      theatre: ['theatre.read'],
      dialysis: ['dialysis.read'],
      specialty: ['clinical.read'],
      laboratory: ['laboratory.read'],
      radiology: ['laboratory.read', 'clinical.read'],
      pharmacy: ['pharmacy.read'],
      inventory: ['inventory.read'],
      procurement: ['procurement.read'],
      finance: ['billing.read'],
      payment_transactions: ['payment_hub.transactions.read'],
      accounting: ['accounting.read'],
      claims: [
        'insurance.read',
        'insurance.sha.read',
        'insurance.sha.eligibility.check',
        'insurance.sha.benefits.validate',
        'insurance.sha.preauthorization.create',
        'insurance.sha.claims.read',
      ],
      private_insurance: [
        'insurance.read',
        'insurance.payers.read',
        'insurance.payers.manage',
        'insurance.members.read',
        'insurance.members.manage',
        'insurance.eligibility.check',
        'insurance.benefits.validate',
        'insurance.preauthorization.manage',
        'insurance.private.claims.prepare',
        'insurance.private.claims.submit',
        'insurance.private.remittance.reconcile',
      ],
      analytics: ['reports.read'],
      public_health: ['reports.read'],
      interoperability: ['interop.fhir.patient.read'],
      configuration: [
        'system.settings.manage',
        'payment_hub.catalogue.read',
        'payer_hub.catalogue.read',
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
      {isMobileMenuOpen && (
        <button
          type="button"
          onClick={() => setIsMobileMenuOpen(false)}
          className="fixed inset-0 z-40 bg-[#07142b]/55 md:hidden"
          aria-label="Close navigation backdrop"
        />
      )}
      <aside
        className={`dashboard-sidebar fixed inset-y-0 left-0 z-50 flex w-[248px] shrink-0 flex-col bg-[#10203d] text-white transition-[width,transform] duration-200 md:relative md:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} ${collapsed ? 'md:w-[76px]' : 'md:w-[248px]'}`}
      >
        <div
          className={`flex h-[76px] shrink-0 items-center ${collapsed ? 'md:justify-center md:px-2' : ''} gap-3 px-6`}
        >
          <span className="brand-mark flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] text-white">
            <Cross className="h-7 w-7" strokeWidth={3} />
          </span>
          <div className={`min-w-0 leading-tight ${collapsed ? 'md:hidden' : ''}`}>
            <div className="text-[19px] font-bold tracking-[-.03em]">JaliCare</div>
            <div className="mt-0.5 text-[12px] font-medium text-[#c9d7ef]">HMIS Kenya</div>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="ml-auto rounded-lg p-2 text-white/75 hover:bg-white/10 md:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav
          aria-label="Main navigation"
          className="dashboard-nav min-h-0 flex-1 overflow-y-auto px-[14px] pb-3 pt-3"
        >
          {sections
            .filter((section) => section.items.some((item) => isModuleVisible(item.id)))
            .map((section, sectionIndex) => (
              <div key={section.title} className={sectionIndex ? 'mt-2' : ''}>
                {sectionIndex > 0 && (
                  <div
                    aria-hidden="true"
                    className={`mx-3 my-2 h-px bg-white/[.08] ${collapsed ? 'md:mx-1' : ''}`}
                  />
                )}
                <div className="space-y-[3px]">
                  {section.items
                    .filter((item) => isModuleVisible(item.id))
                    .map((item) => {
                      const Icon = item.icon;
                      const active = activeModule === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleSelectModule(item.id)}
                          aria-current={active ? 'page' : undefined}
                          title={item.label}
                          className={`sidebar-link flex min-h-[39px] w-full items-center gap-3 rounded-[9px] px-3 text-left text-[12.5px] font-medium transition-colors ${collapsed ? 'md:justify-center md:px-0' : ''} ${active ? 'bg-[#075cf1] font-semibold text-white shadow-[0_4px_14px_rgba(0,78,220,.3)]' : 'text-[#cdd7e7] hover:bg-white/[.08] hover:text-white'}`}
                        >
                          <Icon
                            className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-white' : 'text-[#b6c5da]'}`}
                            strokeWidth={2.2}
                          />
                          <span className={`truncate ${collapsed ? 'md:hidden' : ''}`}>
                            {item.label}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
        </nav>
        <div className={`shrink-0 px-[14px] pb-5 pt-2 ${collapsed ? 'md:px-2' : ''}`}>
          <div
            className={`rounded-[10px] border border-white/10 bg-white/[.025] px-3 py-3 ${collapsed ? 'md:flex md:justify-center md:px-1' : ''}`}
            title="This indicator checks the application process only; it does not verify external systems."
          >
            <div className="flex items-center gap-3">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${health === 'online' ? 'bg-[#15bf77]' : health === 'checking' ? 'bg-amber-400' : 'bg-rose-400'}`}
              />
              <div className={collapsed ? 'md:hidden' : ''}>
                <p className="text-[11px] font-semibold text-white">System status</p>
                <p className="mt-0.5 text-[10px] text-[#a9bedb]">
                  {health === 'online'
                    ? 'Application responding'
                    : health === 'checking'
                      ? 'Checking application…'
                      : 'Status unavailable'}
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleCollapse}
            className={`mt-2 hidden w-full items-center gap-2 rounded-lg px-2 py-2 text-[11px] text-[#9db0cc] hover:bg-white/5 hover:text-white md:flex ${collapsed ? 'justify-center' : ''}`}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span>Collapse navigation</span>
              </>
            )}
          </button>
          <div className={`px-2 pt-2 text-[10px] text-[#7387a7] ${collapsed ? 'md:hidden' : ''}`}>
            JaliCare HMIS · v0.1.0
          </div>
        </div>
      </aside>
    </>
  );
};
