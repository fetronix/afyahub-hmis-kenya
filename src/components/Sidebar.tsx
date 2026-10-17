import { Building2 } from 'lucide-react';
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
  Network,
  Sliders,
  ShieldAlert,
  X
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
const navSections: NavSection[] = [
  {
    title: 'CLINICAL CARE',
    items: [
      { id: 'dashboard', label: 'Overview & KPIs', icon: LayoutDashboard },
      { id: 'registration', label: 'Patient Directory', icon: UserPlus },
      { id: 'reception', label: 'Reception & Queue', icon: Users },
      { id: 'opd', label: 'Outpatient & Triage', icon: Stethoscope },
      { id: 'inpatient', label: 'Inpatient & Wards', icon: BedDouble },
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
    setCurrentFacility,
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
        'registration', 'reception', 'opd', 'inpatient', 'theatre',
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
      theatre: ['clinical.read', 'inpatient.read'],
      specialty: ['clinical.read'],
      laboratory: ['laboratory.read'],
      radiology: ['laboratory.read', 'clinical.read'],
      pharmacy: ['pharmacy.read'],
      inventory: ['inventory.read'],
      procurement: ['procurement.read'],
      finance: ['billing.read'],
      claims: ['insurance.read'],
      public_health: ['reports.read'],
      interoperability: ['interop.fhir.patient.read'],
      configuration: [
        'system.settings.manage', 'users.roles.manage',
        'roles.permissions.manage', 'facilities.update'
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
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-30 md:hidden animate-in fade-in duration-200"
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`w-64 border-r border-slate-200 bg-slate-50/90 flex flex-col shrink-0 select-none overflow-y-auto transition-transform duration-200 ease-in-out z-40 
          fixed inset-y-0 left-0 top-14 md:top-0 md:static md:translate-x-0 ${
            isMobileMenuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'
          }`}
      >
        {/* Mobile Header Close */}
        <div className="md:hidden px-4 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-blue-700 text-white flex items-center justify-center font-bold text-xs relative overflow-hidden">
              <span>Jc</span>
              <span className="absolute bottom-0 right-0 w-1.5 h-1.5 bg-orange-500" />
            </div>
            <span className="text-xs font-bold text-slate-900 tracking-tight">JaliCare HMIS</span>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="p-1 rounded-md text-slate-500 hover:text-slate-800"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mobile Tenant Selector (Visible on small screens) */}
        <div className="md:hidden px-4 py-2.5 bg-slate-100/70 border-b border-slate-200">
          <div className="text-2xs uppercase tracking-wider text-slate-400 font-bold mb-1">
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
            className="w-full bg-white border border-slate-200 rounded-md px-2 py-1.5 text-xs text-slate-800 font-medium focus:ring-1 focus:ring-blue-600 focus:outline-hidden"
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
          <div className="px-4 py-3 border-b border-slate-200/80 bg-white">
            <div className="text-xs uppercase tracking-wider text-slate-400 font-bold mb-2">
              Your Facility
            </div>

            <div className="flex items-start gap-2">
              <Building2 className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 break-words">
                  {currentFacility?.name || "Facility not assigned"}
                </p>

                <p className="mt-1 text-xs text-slate-500">
                  MFL Code: {currentFacility?.mflCode || "Not configured"}
                </p>

                <p className="mt-1 text-xs font-medium text-slate-600">
                  {currentFacility?.level || "Level not configured"}
                </p>
              </div>
            </div>
          </div>
        )}
        {/* Navigation Sections */}
        <div className="p-3 space-y-5 flex-1">
          {(isSuperAdmin ? superAdminNavSections : navSections).filter((sec) => sec.items.some((item) => isModuleVisible(item.id))).map((sec, secIdx) => (
            <div key={secIdx}>
              <div className="px-2.5 pb-1 text-2xs font-semibold text-slate-400 tracking-wider">
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
                      className={`w-full flex items-center justify-between px-2.5 py-2 md:py-1.5 rounded-md text-xs font-medium transition-colors text-left min-h-[38px] md:min-h-0 ${
                        isActive
                          ? 'bg-blue-700 text-white font-semibold shadow-xs border-l-2 border-orange-400'
                          : 'text-slate-700 hover:bg-blue-50/50 hover:text-blue-900 active:bg-blue-100'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                        <span className="truncate">{item.label}</span>
                      </div>
                      {item.badge && (
                        <span className={`text-2xs font-mono px-1.5 py-0.2 rounded font-semibold ${isActive ? 'bg-orange-500 text-white' : 'bg-slate-200 text-slate-700'}`}>
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer Info */}
        <div className="p-3 border-t border-slate-200 bg-white/70 text-2xs text-slate-500 shrink-0">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-blue-950">JaliCare HMIS</span>
            <span className="text-orange-600 font-bold">Kenya MOH Ready</span>
          </div>
          <div className="text-slate-400 mt-0.5">DHA Architecture & FHIR R4</div>
        </div>
      </aside>
    </>
  );
};








