import React, { useState } from 'react';

import { useHmis, type ModuleId } from '../context/HmisContext.tsx';

import { navSections, superAdminNavSections } from './Sidebar.tsx';

import {
  ChevronDown,
  ChevronRight,
  LogOut,
  Menu,
  X,
  UserCircle,
  ShieldCheck,
  LayoutDashboard,
} from 'lucide-react';

/*
|--------------------------------------------------------------------------
| Module Titles
|--------------------------------------------------------------------------
|
| One place that names where the user is. Rendered as the last crumb of
| the breadcrumb so the rail can stay quiet.
|
*/

const moduleTitles: Record<ModuleId, string> = {
  dashboard: 'Executive & Clinical Overview',
  registration: 'Patient Registration & Identity',
  reception: 'Reception, Queue & Appointments',
  opd: 'Outpatient Triage & Consultation',
  inpatient: 'Inpatient Wards & Bed Board',
  maternity: 'Maternity, ANC & Labour Ward',
  theatre: 'Operating Theatres & Surgical List',
  dialysis: 'Dialysis Unit',
  specialty: 'Specialist Clinics (Dental/Eye/ENT/Renal)',
  laboratory: 'Clinical Diagnostic Laboratory',
  radiology: 'Radiology & Medical Imaging',
  pharmacy: 'Central Pharmacy & Dispensing',
  inventory: 'Inventory, Batches & Stores',
  procurement: 'Procurement & Purchase Orders',
  finance: 'Billing, Invoicing & Cashier POS',
  payment_transactions: 'Payment Transactions & Reconciliation',
  accounting: 'Accounting & General Ledger',
  claims: 'Social Health Authority (SHA) E-Claims',
  private_insurance: 'Private Insurance & Multi-Payer Claims',
  public_health: 'MOH 705 & Disease Surveillance',
  analytics: 'Reports, Revenue & Bed Utilisation',
  interoperability: 'DHA Certification Readiness & HL7 FHIR',
  platform_administration: 'Platform Administration',
  configuration: 'Facility & System Configuration Engine',
  patient_portal: 'Patient Portal Management',
  audit: 'Immutable Security Audit Trail',
};

/*
 * The group a module belongs to comes from the rail itself, so the two
 * cannot disagree about where "Laboratory" lives.
 */
const sectionLabel = (id: ModuleId, isSuperAdmin: boolean): string | null => {
  const sections = isSuperAdmin
    ? [...superAdminNavSections, ...navSections]
    : [...navSections, ...superAdminNavSections];

  const match = sections.find((section) => section.items.some((item) => item.id === id));

  if (!match) return null;

  const words = match.title.toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/*
|--------------------------------------------------------------------------
| Header
|--------------------------------------------------------------------------
*/

export const Header: React.FC = () => {
  const {
    authenticatedUser,
    currentUser,
    activeModule,
    setActiveModule,
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    logout,
  } = useHmis();

  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | Authoritative User Identity
  |--------------------------------------------------------------------------
  |
  | The role displayed here is NOT an authorization mechanism. The backend
  | RBAC decides what a session may do; this is a label for the human.
  |
  */

  const displayName = authenticatedUser?.fullName || currentUser?.name || 'Authenticated User';

  const username = authenticatedUser?.username || '';
  const email = authenticatedUser?.email || '';
  const displayRole = currentUser?.role || 'Authenticated User';
  const department = currentUser?.department || 'JaliCare HMIS';
  const professionalId = currentUser?.license || '';

  const isSuperAdmin = Boolean(
    authenticatedUser?.isSuperAdmin || authenticatedUser?.roles?.includes('SUPER_ADMIN'),
  );

  const group = sectionLabel(activeModule, isSuperAdmin);

  const userInitials =
    displayName
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((name) => name.charAt(0))
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'JC';

  const handleLogout = async () => {
    if (loggingOut) {
      return;
    }

    setLoggingOut(true);

    try {
      await logout();
    } finally {
      setLoggingOut(false);
      setUserDropdownOpen(false);
    }
  };

  return (
    <header className="relative z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-hair bg-surface px-3 sm:px-5">
      {/* ---------------------------------------------------------------
          Brand + breadcrumb
      --------------------------------------------------------------- */}

      <div className="flex min-w-0 items-center gap-2.5 sm:gap-4">
        <button
          type="button"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="-ml-1 rounded-lg p-2 text-ink-soft transition-colors hover:bg-slate-100 hover:text-ink md:hidden"
          aria-label="Toggle navigation menu"
        >
          {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <div className="flex items-center gap-2.5">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand-700 text-white shadow-sm">
            <span className="text-base font-bold leading-none tracking-tight">J</span>
            <span
              aria-hidden="true"
              className="absolute bottom-0 right-0 h-2 w-2 rounded-tl-[4px] bg-ember-500"
              title="Care Indicator"
            />
          </div>

          <div className="flex flex-col leading-none">
            <span className="flex items-center gap-1.5">
              <span className="text-[15px] font-bold tracking-tight text-navy-900 whitespace-nowrap">
                Jali<span className="text-ember-600">Care</span>
              </span>
              <span className="hidden rounded bg-navy-50 px-1.5 py-0.5 text-3xs font-bold uppercase leading-none tracking-[0.14em] text-navy-600 sm:inline">
                HMIS
              </span>
            </span>
            <span className="mt-1 hidden text-3xs font-medium tracking-wide text-muted sm:inline">
              Healthcare. Empowered.
            </span>
          </div>
        </div>

        <span aria-hidden="true" className="hidden h-8 w-px bg-hair md:block" />

        {/* Breadcrumb: home › department › screen */}
        <nav
          aria-label="Breadcrumb"
          className="hidden min-w-0 items-center gap-1.5 text-xs md:flex"
        >
          <button
            type="button"
            onClick={() => setActiveModule('dashboard')}
            className="flex items-center gap-1 rounded px-1 py-0.5 text-muted transition-colors hover:bg-brand-50 hover:text-brand-700"
            aria-label="Go to overview"
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
          </button>

          {group && (
            <>
              <ChevronRight className="h-3 w-3 shrink-0 text-slate-300" />
              <span className="whitespace-nowrap text-muted">{group}</span>
            </>
          )}

          <ChevronRight className="h-3 w-3 shrink-0 text-slate-300" />
          <span
            className="truncate font-semibold text-navy-800"
            aria-current="page"
            title={moduleTitles[activeModule]}
          >
            {moduleTitles[activeModule]}
          </span>
        </nav>
      </div>

      {/* ---------------------------------------------------------------
          Interoperability marker + user menu
      --------------------------------------------------------------- */}

      <div className="flex items-center gap-1.5 sm:gap-3">
        <div className="hidden items-center gap-1.5 rounded-full border border-hair bg-canvas py-1 pl-2 pr-2.5 lg:flex">
          <ShieldCheck className="h-3.5 w-3.5 text-brand-600" />
          <span className="text-2xs font-semibold text-ink-soft">DHA ready</span>
          <span className="text-2xs text-slate-300">·</span>
          <span className="font-mono text-2xs text-muted">FHIR R4</span>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setUserDropdownOpen(!userDropdownOpen)}
            className="flex items-center gap-2 rounded-lg border border-hair bg-surface py-1 pl-1 pr-2.5 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40 sm:pr-3"
            aria-haspopup="menu"
            aria-expanded={userDropdownOpen}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-navy-800 text-2xs font-semibold text-white">
              {userInitials}
            </span>

            <span className="hidden min-w-0 flex-col sm:flex">
              <span className="max-w-28 truncate text-xs font-semibold leading-tight text-navy-900 sm:max-w-32">
                {displayName}
              </span>
              <span className="max-w-28 truncate text-2xs font-medium leading-tight text-brand-700 sm:max-w-32">
                {displayRole}
              </span>
            </span>

            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
                userDropdownOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {userDropdownOpen && (
            <>
              {/* Click-away layer: the menu must not trap the page. */}
              <div
                className="fixed inset-0 z-40"
                aria-hidden="true"
                onClick={() => setUserDropdownOpen(false)}
              />

              <div
                className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-hair bg-surface py-1.5 text-xs shadow-lift animate-in fade-in zoom-in-95 duration-100"
                role="menu"
              >
                <div className="border-b border-hair px-3 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-navy-800 text-sm font-semibold text-white">
                      {userInitials}
                    </span>

                    <div className="min-w-0">
                      <div className="truncate font-semibold text-navy-900">{displayName}</div>

                      {username && (
                        <div className="mt-0.5 truncate text-2xs text-muted">@{username}</div>
                      )}

                      <div className="mt-0.5 text-2xs font-semibold text-brand-700">
                        {displayRole}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5 px-3 py-3">
                  <div>
                    <div className="text-3xs font-semibold uppercase tracking-[0.14em] text-muted">
                      Email
                    </div>
                    <div className="mt-0.5 truncate text-xs text-ink-soft">
                      {email || 'No email available'}
                    </div>
                  </div>

                  <div>
                    <div className="text-3xs font-semibold uppercase tracking-[0.14em] text-muted">
                      Work area
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-soft">
                      <UserCircle className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{department}</span>
                    </div>
                  </div>

                  {professionalId && (
                    <div>
                      <div className="text-3xs font-semibold uppercase tracking-[0.14em] text-muted">
                        Professional ID
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-ink-soft">{professionalId}</div>
                    </div>
                  )}

                  {authenticatedUser && (
                    <div>
                      <div className="text-3xs font-semibold uppercase tracking-[0.14em] text-muted">
                        Account status
                      </div>
                      <div className="mt-0.5 text-xs text-ink-soft">
                        {authenticatedUser.accountStatus}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-1 border-t border-hair pt-1">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      void handleLogout();
                    }}
                    disabled={loggingOut}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <LogOut className="h-4 w-4" />

                    <span className="font-semibold">
                      {loggingOut ? 'Signing out...' : 'Sign out'}
                    </span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
