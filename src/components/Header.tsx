import React, { useState } from 'react';
import { useHmis, UserRole, ModuleId } from '../context/HmisContext.tsx';
import { 
  Building2, 
  ShieldCheck, 
  UserCheck, 
  ChevronDown, 
  Search, 
  Activity,
  Layers,
  Sparkles,
  Menu,
  X
} from 'lucide-react';

const moduleTitles: Record<ModuleId, string> = {
  dashboard: 'Executive & Clinical Overview',
  registration: 'Patient Registration & Identity',
  reception: 'Reception, Queue & Appointments',
  opd: 'Outpatient Triage & Consultation',
  inpatient: 'Inpatient Wards & Bed Board',
  theatre: 'Operating Theatres & Surgical List',
  specialty: 'Specialist Clinics (Dental/Eye/MCH/Renal)',
  laboratory: 'Clinical Diagnostic Laboratory',
  radiology: 'Radiology & Medical Imaging',
  pharmacy: 'Central Pharmacy & Dispensing',
  inventory: 'Inventory, Batches & Stores',
  procurement: 'Procurement & Purchase Orders',
  finance: 'Billing, Invoicing & Cashier POS',
  claims: 'Social Health Authority (SHA) E-Claims',
  public_health: 'MOH 705 & Disease Surveillance',
  interoperability: 'DHA Certification Readiness & HL7 FHIR',
  configuration: 'Facility & System Configuration Engine',
  audit: 'Immutable Security Audit Trail',
};

const sampleRoles: Array<{ name: string; role: UserRole; license: string; department: string }> = [
  { name: 'Dr. Angela Omwamba', role: 'Medical Director', license: 'KMPDC A.45821', department: 'Executive Medical Staff' },
  { name: 'Dr. Dennis Mutua', role: 'Doctor / Consultant', license: 'KMPDC A.51290', department: 'Internal Medicine / OPD' },
  { name: 'CO Peter Kiprop', role: 'Clinical Officer', license: 'COC C.11029', department: 'Outpatient Care' },
  { name: 'Nurse Grace Achieng', role: 'Nurse / Triage', license: 'NCK R.38201', department: 'Emergency & Triage' },
  { name: 'James Kimani', role: 'Pharmacist', license: 'PPB P.0832', department: 'Pharmacy & Drug Stores' },
  { name: 'David Omondi', role: 'Laboratory Technologist', license: 'KMLTTB T.9412', department: 'Clinical Pathology' },
  { name: 'Sarah Wanjiku', role: 'Radiographer', license: 'KRB R.1042', department: 'Diagnostic Imaging' },
  { name: 'Brian Koech', role: 'Cashier / Revenue', license: 'REV-0941', department: 'Finance & Billing' },
  { name: 'System Administrator', role: 'Facility Administrator', license: 'ADM-SYS-01', department: 'Health Informatics' },
];

export const Header: React.FC = () => {
  const { 
    tenants, 
    currentTenant, 
    setCurrentTenant, 
    facilities, 
    currentFacility, 
    setCurrentFacility,
    currentUser,
    setCurrentUser,
    activeModule,
    setActiveModule,
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    showToast
  } = useHmis();

  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false);
  const [facilityDropdownOpen, setFacilityDropdownOpen] = useState(false);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);

  return (
    <header className="h-14 border-b border-slate-200 bg-white px-3 sm:px-5 flex items-center justify-between z-30 shrink-0 relative">
      {/* Zone 1: Mobile Hamburger & Brand & Breadcrumb */}
      <div className="flex items-center gap-2 sm:gap-4 min-w-0">
        {/* Mobile Hamburger Button */}
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 -ml-1 text-slate-600 hover:text-slate-900 rounded-lg md:hidden hover:bg-slate-100 transition-colors"
          aria-label="Toggle navigation menu"
        >
          {isMobileMenuOpen ? <X className="w-5 h-5 text-slate-800" /> : <Menu className="w-5 h-5 text-slate-800" />}
        </button>

        {/* Brand Zone */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-blue-700 text-white flex items-center justify-center font-bold text-sm sm:text-base shadow-xs shrink-0 relative overflow-hidden">
            <span className="font-black tracking-tight text-white">Jc</span>
            <span className="absolute bottom-0 right-0 w-2 h-2 sm:w-2.5 sm:h-2.5 bg-orange-500 rounded-tl-xs" title="Care Indicator" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1 sm:gap-1.5">
              <span className="font-bold text-slate-900 text-sm sm:text-base tracking-tight leading-none whitespace-nowrap">
                JaliCare
              </span>
              <span className="px-1.5 py-0.5 rounded text-3xs font-bold uppercase tracking-wider bg-orange-100 text-orange-800 leading-none">
                Care
              </span>
            </div>
            <span className="text-3xs text-slate-400 font-medium tracking-wide leading-tight hidden xs:inline">Kenya HMIS</span>
          </div>
        </div>

        <span className="text-slate-300 font-light hidden lg:inline" aria-hidden="true">/</span>

        {/* Breadcrumb Context (Desktop) */}
        <div className="hidden lg:flex items-center gap-2 text-xs font-medium text-slate-600 truncate">
          <span className="text-slate-500 truncate max-w-40">{currentFacility?.name || 'Facility'}</span>
          <span className="text-slate-300" aria-hidden="true">·</span>
          <span className="text-blue-900 font-semibold truncate">{moduleTitles[activeModule]}</span>
        </div>
      </div>

      {/* Zone 2: Multi-Tenant, Facility & Role Switchers */}
      <div className="flex items-center gap-1.5 sm:gap-3">
        {/* Tenant Selector (Hidden on very small screens, visible from sm) */}
        <div className="relative hidden sm:block">
          <button
            onClick={() => {
              setTenantDropdownOpen(!tenantDropdownOpen);
              setFacilityDropdownOpen(false);
              setRoleDropdownOpen(false);
            }}
            className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md border border-slate-200 bg-slate-50 text-slate-700 text-xs font-medium hover:bg-slate-100 transition-colors whitespace-nowrap"
            title="Switch Healthcare Tenant"
          >
            <Layers className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="max-w-24 sm:max-w-32 truncate">{currentTenant?.name || 'Tenant'}</span>
            <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
          </button>

          {tenantDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3 py-1 text-2xs uppercase tracking-wider text-slate-400 font-semibold">
                Healthcare Organization
              </div>
              {tenants.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setCurrentTenant(t);
                    setTenantDropdownOpen(false);
                    showToast(`Switched tenant to: ${t.name}`);
                  }}
                  className={`w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between ${
                    currentTenant?.id === t.id ? 'bg-blue-50/70 text-blue-900 font-semibold' : 'text-slate-700'
                  }`}
                >
                  <span className="truncate">{t.name}</span>
                  <span className="text-2xs text-slate-400 font-mono">{t.currency}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Facility Selector */}
        <div className="relative">
          <button
            onClick={() => {
              setFacilityDropdownOpen(!facilityDropdownOpen);
              setTenantDropdownOpen(false);
              setRoleDropdownOpen(false);
            }}
            className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md border border-blue-200/80 bg-blue-50/50 text-blue-900 text-xs font-medium hover:bg-blue-50 transition-colors whitespace-nowrap"
            title="Switch Facility"
          >
            <Building2 className="w-3.5 h-3.5 text-blue-700 shrink-0" />
            <span className="max-w-24 sm:max-w-36 truncate font-semibold">{currentFacility?.name || 'Facility'}</span>
            <span className="font-mono text-2xs text-orange-700 font-bold hidden xl:inline">{currentFacility?.mflCode}</span>
            <ChevronDown className="w-3 h-3 text-blue-500 shrink-0" />
          </button>

          {facilityDropdownOpen && (
            <div className="absolute top-full right-0 sm:right-auto sm:left-0 mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-lg py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3 py-1 text-2xs uppercase tracking-wider text-slate-400 font-semibold">
                Branches & Health Facilities
              </div>
              {facilities.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setCurrentFacility(f);
                    setFacilityDropdownOpen(false);
                    showToast(`Switched facility to: ${f.name} (${f.mflCode})`);
                  }}
                  className={`w-full text-left px-3 py-2 hover:bg-slate-50 flex flex-col ${
                    currentFacility?.id === f.id ? 'bg-blue-50/70 text-blue-900 font-semibold' : 'text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate">{f.name}</span>
                    <span className="font-mono text-2xs text-orange-600 font-semibold">{f.mflCode}</span>
                  </div>
                  <span className="text-2xs text-slate-400">{f.level} · {f.county}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* DHA Interoperability Indicator (Hidden on small viewports) */}
        <button
          onClick={() => setActiveModule('interoperability')}
          className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 text-xs text-blue-900 bg-blue-50/60 border border-blue-200 rounded-md hover:bg-blue-100/60 transition-colors"
          title="Digital Health Agency & FHIR Readiness Matrix"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-blue-700" />
          <span className="font-medium">DHA Ready</span>
          <span className="font-mono text-2xs text-orange-600 font-semibold">FHIR R4</span>
        </button>

        {/* Role & Staff Switcher */}
        <div className="relative">
          <button
            onClick={() => {
              setRoleDropdownOpen(!roleDropdownOpen);
              setTenantDropdownOpen(false);
              setFacilityDropdownOpen(false);
            }}
            className="flex items-center gap-1.5 sm:gap-2 pl-1.5 sm:pl-2 pr-2 sm:pr-3 py-1 rounded-md border border-slate-200 hover:border-blue-400 transition-colors bg-white text-left"
          >
            <div className="w-6 h-6 rounded-full bg-blue-800 text-white flex items-center justify-center text-xs font-semibold shrink-0">
              {currentUser.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
            </div>
            <div className="hidden sm:flex flex-col min-w-0">
              <span className="text-xs font-medium text-slate-900 leading-tight truncate max-w-28 sm:max-w-32">
                {currentUser.name}
              </span>
              <span className="text-2xs text-orange-700 font-semibold leading-tight truncate max-w-28 sm:max-w-32">
                {currentUser.role}
              </span>
            </div>
            <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
          </button>

          {roleDropdownOpen && (
            <div className="absolute top-full right-0 mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-lg py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3 py-1.5 text-2xs uppercase tracking-wider text-slate-400 font-semibold border-b border-slate-100">
                Switch Workstation & Clinical Role
              </div>
              <div className="max-h-80 overflow-y-auto py-1">
                {sampleRoles.map((r, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setCurrentUser(r);
                      setRoleDropdownOpen(false);
                      showToast(`Role switched to ${r.role} (${r.name})`);
                    }}
                    className={`w-full text-left px-3 py-2 hover:bg-slate-50 flex flex-col ${
                      currentUser.role === r.role ? 'bg-blue-50/70 text-blue-900 font-medium' : 'text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{r.name}</span>
                      <span className="font-mono text-2xs text-slate-400">{r.license}</span>
                    </div>
                    <div className="flex items-center gap-2 text-2xs text-slate-500">
                      <span className="text-orange-700 font-semibold">{r.role}</span>
                      <span>·</span>
                      <span>{r.department}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
