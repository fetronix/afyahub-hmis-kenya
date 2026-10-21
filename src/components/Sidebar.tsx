import { Baby, Building2, X } from 'lucide-react';
import React from 'react';
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
} from 'lucide-react';

interface NavSection {
  title: string;
  items: Array<{
    id: ModuleId;
    label: string;
    icon: React.ElementType;
    badge?: string;
  }>;
}

const superAdminNavSections: NavSection[] = [
  {
    title: 'PLATFORM MANAGEMENT',
    items: [
      { id: 'dashboard', label: 'Platform Management', icon: LayoutDashboard },
    ],
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
];

/*
 * The facility rail follows the patient, not the database: the order is
 * the order of a visit — arrive, be seen, be investigated, collect
 * medicine, be admitted — then the money and the reporting that follow.
 */
const navSections: NavSection[] = [
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
    title: 'INTELLIGENCE & DHA',
    items: [
      { id: 'analytics', label: 'Reports & Revenue', icon: BarChart3 },
      { id: 'public_health', label: 'MOH 705 Surveillance', icon: Activity },
      { id: 'interoperability', label: 'DHA Readiness & FHIR', icon: Network },
    ],
  },
  {
    title: 'ADMINISTRATION',
    items: [
      { id: 'platform_administration', label: 'Platform Administration', icon: Building2 },
      { id: 'configuration', label: 'System Configuration', icon: Sliders },
      { id: 'audit', label: 'Audit Trail & Security', icon: ShieldAlert },
    ],
  },
];

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

  const permissions = new Set(authenticatedUser?.permissions ?? []);
  const isSuperAdmin = Boolean(
    authenticatedUser?.isSuperAdmin ||
    authenticatedUser?.roles?.includes('SUPER_ADMIN')
  );

  const can = (permission: string) =>
    isSuperAdmin || permissions.has(permission);

  const isFacilityModuleEnabled = (id: ModuleId): boolean => {
    // Platform administration is not an operational facility module.
    if (id === 'platform_administration') return true;

    const enabledModules = new Set(currentFacility?.enabledModules ?? []);

    // Do not expose operational modules until a facility is resolved.
    if (!currentFacility) return false;

    // Dashboard is available when at least one operational module is enabled.
    if (id === 'dashboard') {
      return [
        'registration', 'reception', 'opd', 'inpatient', 'maternity', 'theatre',
        'specialty', 'laboratory', 'radiology', 'pharmacy', 'inventory',
        'procurement', 'finance', 'insurance', 'claims', 'public_health',
        'analytics', 'interoperability', 'configuration', 'audit'
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
        'patients.read', 'appointments.read', 'clinical.read',
        'inpatient.read', 'laboratory.read', 'pharmacy.read',
        'inventory.read', 'billing.read', 'reports.read'
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
        'system.settings.manage', 'users.roles.manage',
        'roles.permissions.manage', 'facilities.update',
        /*
         * A facility administrator holds none of the four above on a
         * fresh install; they hold users.invite, which is what the
         * staff screen needs. Without this the Staff tab — and the
         * invitation screen that was already there — had no way in.
         */
        'users.invite'
      ],
      audit: ['audit.read', 'audit.security.read']
    };

    return (required[id] ?? []).some(can);
  };

  const handleSelectModule = (id: ModuleId) => {
    setActiveModule(id);
    if (isMobileMenuOpen) {
      setIsMobileMenuOpen(false);
    }
  };

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isMobileMenuOpen && (
        <div
          onClick={() => setIsMobileMenuOpen(false)}
          className="fixed inset-0 z-30 bg-pine-950/50 backdrop-blur-[2px] md:hidden animate-in fade-in duration-200"
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`flex w-[17rem] shrink-0 select-none flex-col overflow-y-auto bg-pine-950 transition-transform duration-200 ease-in-out z-40
          fixed inset-y-0 left-0 top-16 md:static md:translate-x-0 ${
            isMobileMenuOpen ? 'translate-x-0 shadow-lift' : '-translate-x-full md:translate-x-0'
          }`}
      >
        {/* Mobile Header Close */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 md:hidden">
          <span className="font-display text-sm tracking-tight text-pine-50">
            JaliCare HMIS
          </span>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="rounded-lg p-1.5 text-pine-200 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mobile Tenant Selector (Visible on small screens) */}
        <div className="border-b border-white/10 px-4 py-3 md:hidden">
          <div className="mb-1.5 text-3xs font-semibold uppercase tracking-[0.18em] text-pine-400">
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
            className="w-full rounded-lg border border-white/15 bg-pine-900 px-2.5 py-2 text-xs font-medium text-pine-50 outline-none focus:border-clay-400"
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
          <div className="border-b border-white/10 px-4 py-4">
            <div className="mb-2 text-3xs font-semibold uppercase tracking-[0.18em] text-pine-400">
              Your facility
            </div>

            <div className="flex items-start gap-2.5">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-clay-400" />
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm leading-snug text-pine-50 break-words">
                  {currentFacility?.name || 'Facility not assigned'}
                </p>

                <p className="mt-1.5 font-mono text-2xs text-pine-300/80">
                  MFL {currentFacility?.mflCode || '—'}
                </p>

                <p className="mt-0.5 text-2xs text-pine-400">
                  {currentFacility?.level || 'Level not configured'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Sections */}
        <nav className="flex-1 space-y-6 px-3 py-4">
          {(isSuperAdmin ? superAdminNavSections : navSections)
            .filter((sec) => sec.items.some((item) => isModuleVisible(item.id)))
            .map((sec, secIdx) => (
              <div key={secIdx}>
                <div className="mb-1.5 px-2.5 text-3xs font-semibold uppercase tracking-[0.18em] text-pine-400/80">
                  {sec.title}
                </div>
                <div className="space-y-0.5">
                  {sec.items.filter((item) => isModuleVisible(item.id)).map((item) => {
                    const Icon = item.icon;
                    const isActive = activeModule === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelectModule(item.id)}
                        aria-current={isActive ? 'page' : undefined}
                        className={`relative flex min-h-[40px] w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors md:min-h-0 md:py-1.5 ${
                          isActive
                            ? 'bg-white/[0.09] font-semibold text-white'
                            : 'font-medium text-pine-200/85 hover:bg-white/[0.05] hover:text-white'
                        }`}
                      >
                        {isActive && (
                          <span
                            aria-hidden="true"
                            className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-clay-400"
                          />
                        )}
                        <span className="flex min-w-0 items-center gap-2.5 truncate">
                          <Icon
                            className={`h-4 w-4 shrink-0 ${
                              isActive ? 'text-clay-300' : 'text-pine-400'
                            }`}
                          />
                          <span className="truncate">{item.label}</span>
                        </span>
                        {item.badge && (
                          <span
                            className={`rounded px-1.5 font-mono text-2xs font-semibold ${
                              isActive
                                ? 'bg-clay-500 text-white'
                                : 'bg-white/10 text-pine-200'
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
        </nav>

        {/* Footer Info */}
        <div className="border-t border-white/10 px-4 py-3 text-3xs text-pine-400">
          <div className="flex items-center justify-between">
            <span className="font-display text-xs text-pine-100">JaliCare HMIS</span>
            <span className="font-semibold text-clay-300">Kenya MOH Ready</span>
          </div>
          <div className="mt-1 text-pine-500">DHA Architecture &amp; FHIR R4</div>
        </div>
      </aside>
    </>
  );
};
