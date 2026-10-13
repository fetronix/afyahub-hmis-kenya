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
    facilities,
    isMobileMenuOpen, 
    setIsMobileMenuOpen,
    showToast
  } = useHmis();

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

        {/* Facility Header Banner with Quick Switcher */}
        <div className="px-4 py-3 border-b border-slate-200/80 bg-white">
          <div className="text-2xs uppercase tracking-wider text-slate-400 font-bold mb-1">
            Active Facility
          </div>
          <select
            value={currentFacility?.id}
            onChange={(e) => {
              const f = facilities.find((item) => item.id === Number(e.target.value));
              if (f) {
                setCurrentFacility(f);
                showToast(`Switched facility to: ${f.name} (${f.mflCode})`);
              }
            }}
            className="w-full bg-blue-50/50 border border-blue-200 rounded-md px-2 py-1 text-xs text-blue-950 font-semibold focus:ring-1 focus:ring-blue-600 focus:outline-hidden"
          >
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.mflCode})
              </option>
            ))}
          </select>
          <div className="flex items-center justify-between text-2xs font-mono mt-1 px-0.5">
            <span className="text-orange-700 font-bold">{currentFacility?.mflCode}</span>
            <span className="text-slate-400">{currentFacility?.level}</span>
          </div>
        </div>

        {/* Navigation Sections */}
        <div className="p-3 space-y-5 flex-1">
          {navSections.map((sec, secIdx) => (
            <div key={secIdx}>
              <div className="px-2.5 pb-1 text-2xs font-semibold text-slate-400 tracking-wider">
                {sec.title}
              </div>
              <div className="space-y-0.5">
                {sec.items.map((item) => {
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
