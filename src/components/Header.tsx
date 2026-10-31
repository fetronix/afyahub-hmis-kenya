import React, { useEffect, useRef, useState } from 'react';
import { Building2, ChevronDown, LogOut, Menu, Search, X } from 'lucide-react';
import { api } from '../api/client.ts';
import { useHmis, type ModuleId } from '../context/HmisContext.tsx';
import type { DashboardSearchResult } from '../dashboard/dashboard.types.ts';
import { NotificationBell } from './NotificationCentre.tsx';
import { useInbox } from '../context/InboxContext.tsx';

// Preserve the contextual module titles from the existing shell while keeping the dashboard header compact.
export const moduleTitles: Record<ModuleId, string> = {
  dashboard: 'Hospital Dashboard',
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
  audit: 'Security Audit Trail',
};

type HeaderProps = { collapsed: boolean; onToggleCollapse: () => void };

// Remount scope-sensitive search state immediately when the authenticated user or facility changes.
export const Header: React.FC<HeaderProps> = (props) => {
  const { authenticatedUser, currentFacility } = useHmis();
  return (
    <HeaderContent
      key={`${authenticatedUser?.id ?? 'none'}:${currentFacility?.id ?? 'none'}`}
      {...props}
    />
  );
};

const HeaderContent: React.FC<HeaderProps> = ({ collapsed, onToggleCollapse }) => {
  const {
    authenticatedUser,
    currentUser,
    activeModule,
    currentFacility,
    facilities,
    setCurrentFacility,
    currentTenant,
    tenants,
    setCurrentTenant,
    setActiveModule,
    setDirectorySearch,
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    logout,
  } = useHmis();
  const [profileOpen, setProfileOpen] = useState(false);
  const { open: notificationsOpen, setOpen: setNotificationsOpen } = useInbox();
  const [term, setTerm] = useState('');
  const [focused, setFocused] = useState(false);
  const [searchState, setSearchState] = useState<{
    facility: number;
    term: string;
    result?: DashboardSearchResult;
    loading?: boolean;
    error?: string;
  } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const isSuperAdmin = Boolean(authenticatedUser?.isSuperAdmin);
  const canSearch =
    !isSuperAdmin &&
    Boolean(currentFacility) &&
    Boolean(
      authenticatedUser?.permissions?.some((p) =>
        ['patients.read', 'billing.read', 'tariffs.read'].includes(p),
      ),
    );
  const trimmed = term.trim();
  const facilityId = currentFacility?.id;
  const visibleState =
    searchState && searchState.facility === currentFacility?.id && searchState.term === trimmed
      ? searchState
      : null;

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && canSearch) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') {
        setFocused(false);
        setProfileOpen(false);
        setNotificationsOpen(false);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [canSearch]);

  useEffect(() => {
    if (notificationsOpen) setProfileOpen(false);
  }, [notificationsOpen]);

  useEffect(() => {
    if (!profileOpen && !notificationsOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (profileOpen && !profileRef.current?.contains(target)) setProfileOpen(false);
      if (notificationsOpen && !notificationsRef.current?.contains(target))
        setNotificationsOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [profileOpen, notificationsOpen]);

  useEffect(() => {
    if (!canSearch || !facilityId || trimmed.length < 2 || trimmed.length > 80) return;
    const controller = new AbortController();
    const id = facilityId;
    const timer = window.setTimeout(() => {
      setSearchState({ facility: id, term: trimmed, loading: true });
      api
        .searchDashboard(id, trimmed, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setSearchState({ facility: id, term: trimmed, result });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setSearchState({
              facility: id,
              term: trimmed,
              error: error instanceof Error ? error.message : 'Search is unavailable.',
            });
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canSearch, facilityId, trimmed]);

  const name = authenticatedUser?.fullName || currentUser?.name || 'Signed-in user';
  const role =
    authenticatedUser?.designation ||
    authenticatedUser?.roles?.join(', ') ||
    currentUser?.role ||
    'Staff';
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  const closeSearch = () => {
    setFocused(false);
    setTerm('');
    setSearchState(null);
  };
  const result = visibleState?.result;

  return (
    <header className="dashboard-header relative z-30 flex h-[76px] shrink-0 items-center gap-3 border-b border-[#e5eaf2] bg-white px-4 sm:gap-5 sm:px-6">
      <button
        type="button"
        onClick={() =>
          window.matchMedia('(min-width: 768px)').matches
            ? onToggleCollapse()
            : setIsMobileMenuOpen(!isMobileMenuOpen)
        }
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#172948] transition hover:bg-[#edf2f9]"
        aria-label={
          isMobileMenuOpen
            ? 'Close navigation'
            : collapsed
              ? 'Expand navigation'
              : 'Toggle navigation'
        }
      >
        {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      <div className="relative min-w-0 flex-1 max-w-[530px]">
        <label className="flex h-10 items-center gap-2.5 rounded-[9px] border border-[#e2e7f0] bg-[#f3f6fb] px-3 text-[#627593] focus-within:border-[#96b8f5] focus-within:ring-2 focus-within:ring-[#dbe9ff]">
          <Search className="h-[17px] w-[17px] shrink-0" />
          <input
            ref={searchRef}
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setFocused(true);
            }}
            onFocus={() => setFocused(true)}
            placeholder={
              canSearch
                ? 'Search patients, invoices, or services...'
                : 'Search unavailable for this account'
            }
            aria-label="Search patients, invoices, or services"
            maxLength={80}
            disabled={!canSearch}
            className="w-full min-w-0 bg-transparent text-[13px] text-[#1b2c47] outline-none placeholder:text-[#6e809b] disabled:cursor-not-allowed"
          />
          <span className="hidden whitespace-nowrap text-[11px] text-[#8290a5] lg:block">
            Ctrl + K
          </span>
          {term && (
            <button
              type="button"
              onClick={closeSearch}
              aria-label="Clear search"
              className="rounded p-1 hover:bg-[#e3eaf5]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
        {focused && trimmed.length >= 2 && (
          <div
            className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[60vh] overflow-y-auto rounded-xl border border-[#dfe6f0] bg-white p-2 shadow-[0_16px_40px_rgba(13,33,68,.16)]"
            role="region"
            aria-label="Search results"
          >
            {visibleState?.loading || !visibleState ? (
              <p className="p-3 text-xs text-[#6b7b95]">Searching authorized records…</p>
            ) : visibleState.error ? (
              <p role="alert" className="p-3 text-xs text-rose-700">
                {visibleState.error}
              </p>
            ) : result ? (
              <>
                {result.patients.length > 0 && (
                  <div>
                    <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-[#8a99af]">
                      Patients
                    </p>
                    {result.patients.map((patient) => (
                      <button
                        key={patient.id}
                        type="button"
                        onClick={() => {
                          setDirectorySearch(patient.mrn);
                          setActiveModule('registration');
                          closeSearch();
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs hover:bg-[#f1f6ff]"
                      >
                        <span className="font-semibold text-[#142744]">{patient.name}</span>
                        <span className="text-[#71829a]">{patient.mrn} · Open directory</span>
                      </button>
                    ))}
                  </div>
                )}
                {result.invoices.length > 0 && (
                  <div>
                    <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-[#8a99af]">
                      Invoices
                    </p>
                    {result.invoices.map((invoice) => (
                      <div
                        key={invoice.id}
                        className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs"
                      >
                        <span>
                          <strong className="text-[#142744]">{invoice.number}</strong>{' '}
                          <span className="text-[#71829a]">
                            · {invoice.status || 'Status unavailable'}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveModule('finance');
                            closeSearch();
                          }}
                          className="font-semibold text-[#075cf1] hover:underline"
                        >
                          Open billing
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {result.services.length > 0 && (
                  <div>
                    <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-[#8a99af]">
                      Configured services
                    </p>
                    {result.services.map((service) => (
                      <div key={service.id} className="px-3 py-2 text-xs">
                        <strong className="text-[#142744]">{service.description}</strong>
                        <span className="ml-2 text-[#71829a]">{service.code}</span>
                      </div>
                    ))}
                  </div>
                )}
                {result.patients.length + result.invoices.length + result.services.length === 0 && (
                  <p className="p-3 text-xs text-[#6b7b95]">
                    No matches in the record types available to your account.
                  </p>
                )}
                {Object.values(result.available).some((available) => !available) && (
                  <p className="border-t border-[#edf0f5] px-3 pt-2 text-[10px] text-[#8795a9]">
                    Some record types are unavailable to this account or facility.
                  </p>
                )}
              </>
            ) : null}
          </div>
        )}
      </div>
      <div
        className="hidden min-w-0 max-w-[210px] items-center gap-2 rounded-lg border border-[#e5eaf2] bg-[#f8faff] px-3 py-1.5 xl:flex"
        title={`${currentFacility?.name ?? 'No facility selected'} · ${currentTenant?.name ?? 'No organization selected'}`}
      >
        <Building2 aria-hidden="true" className="h-4 w-4 shrink-0 text-[#58749c]" />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[11px] font-semibold text-[#243856]">
            {currentFacility?.name ?? 'No facility selected'}
          </p>
          <p className="truncate text-[10px] text-[#71819a]">
            {currentTenant?.name ?? 'No organization selected'}
          </p>
        </div>
      </div>
      <span className="sr-only" aria-live="polite">
        {activeModule ? moduleTitles[activeModule] : ''}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
        <div className="relative" ref={notificationsRef}>
          <NotificationBell />
        </div>
        <span className="hidden h-8 w-px bg-[#e9edf3] sm:block" />
        <div className="relative" ref={profileRef}>
          <button
            type="button"
            onClick={() => {
              setProfileOpen(!profileOpen);
              setNotificationsOpen(false);
            }}
            aria-haspopup="menu"
            aria-expanded={profileOpen}
            className="flex items-center gap-2 rounded-lg p-1 text-left hover:bg-[#f5f7fb]"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#dce9fd] text-xs font-bold text-[#1750a3]">
              {initials}
            </span>
            <span className="hidden min-w-0 sm:block">
              <span className="block max-w-[150px] truncate text-[12px] font-semibold text-[#132644]">
                {name}
              </span>
              <span className="block max-w-[150px] truncate text-[11px] text-[#72829a]">
                {role}
              </span>
            </span>
            <ChevronDown className="hidden h-3.5 w-3.5 text-[#8190a5] sm:block" />
          </button>
          {profileOpen && (
            <div
              className="absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-[#e0e7f0] bg-white p-4 shadow-xl"
              role="menu"
            >
              <p className="text-sm font-bold text-[#132644]">{name}</p>
              {authenticatedUser?.username && (
                <p className="mt-1 text-xs text-[#73839c]">@{authenticatedUser.username}</p>
              )}
              <p className="mt-1 break-all text-xs text-[#73839c]">
                {authenticatedUser?.email || 'Email unavailable'}
              </p>
              <p className="mt-1 text-xs text-[#73839c]">{role}</p>
              {currentUser?.department && (
                <p className="mt-1 text-xs text-[#73839c]">Work area: {currentUser.department}</p>
              )}
              {currentUser?.license && (
                <p className="mt-1 text-xs text-[#73839c]">
                  Professional ID: {currentUser.license}
                </p>
              )}
              {authenticatedUser?.accountStatus && (
                <p className="mt-1 text-xs text-[#73839c]">
                  Account: {authenticatedUser.accountStatus}
                </p>
              )}
              {tenants.length > 1 && (
                <label className="mt-4 block text-[11px] font-semibold text-[#546882]">
                  Organization
                  <select
                    aria-label="Organization"
                    value={currentTenant?.id ?? ''}
                    onChange={(event) => {
                      const tenant = tenants.find((item) => item.id === Number(event.target.value));
                      if (tenant) void setCurrentTenant(tenant);
                    }}
                    className="mt-1 block w-full rounded-lg border border-[#dce4ef] bg-white px-2 py-2 text-xs"
                  >
                    {tenants.map((tenant) => (
                      <option value={tenant.id} key={tenant.id}>
                        {tenant.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {facilities.length > 1 && (
                <label className="mt-3 block text-[11px] font-semibold text-[#546882]">
                  Facility
                  <select
                    aria-label="Facility"
                    value={currentFacility?.id ?? ''}
                    onChange={(event) => {
                      const facility = facilities.find(
                        (item) => item.id === Number(event.target.value),
                      );
                      if (facility) setCurrentFacility(facility);
                    }}
                    className="mt-1 block w-full rounded-lg border border-[#dce4ef] bg-white px-2 py-2 text-xs"
                  >
                    {facilities.map((facility) => (
                      <option value={facility.id} key={facility.id}>
                        {facility.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {currentTenant && tenants.length <= 1 && (
                <p className="mt-3 text-xs text-[#73839c]">Organization: {currentTenant.name}</p>
              )}
              {currentFacility && facilities.length <= 1 && (
                <p className="mt-1 text-xs text-[#73839c]">Facility: {currentFacility.name}</p>
              )}
              <button
                type="button"
                role="menuitem"
                disabled={loggingOut}
                onClick={() => {
                  setLoggingOut(true);
                  void logout().finally(() => {
                    setLoggingOut(false);
                    setProfileOpen(false);
                  });
                }}
                className="mt-4 flex w-full items-center gap-2 border-t border-[#edf0f5] pt-3 text-left text-xs font-semibold text-rose-700 hover:text-rose-900 disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" />
                {loggingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
