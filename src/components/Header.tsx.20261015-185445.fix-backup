import React, { useState } from 'react';

import {
  useHmis,
  type ModuleId,
} from '../context/HmisContext.tsx';

import {
  Building2,
  ShieldCheck,
  ChevronDown,
  Layers,
  Menu,
  X,
  LogOut,
  UserCircle,
} from 'lucide-react';

/*
|--------------------------------------------------------------------------
| Module Titles
|--------------------------------------------------------------------------
*/

const moduleTitles: Record<ModuleId, string> = {
  dashboard:
    'Executive & Clinical Overview',

  registration:
    'Patient Registration & Identity',

  reception:
    'Reception, Queue & Appointments',

  opd:
    'Outpatient Triage & Consultation',

  inpatient:
    'Inpatient Wards & Bed Board',

  theatre:
    'Operating Theatres & Surgical List',

  specialty:
    'Specialist Clinics (Dental/Eye/MCH/Renal)',

  laboratory:
    'Clinical Diagnostic Laboratory',

  radiology:
    'Radiology & Medical Imaging',

  pharmacy:
    'Central Pharmacy & Dispensing',

  inventory:
    'Inventory, Batches & Stores',

  procurement:
    'Procurement & Purchase Orders',

  finance:
    'Billing, Invoicing & Cashier POS',

  claims:
    'Social Health Authority (SHA) E-Claims',

  public_health:
    'MOH 705 & Disease Surveillance',

  interoperability:
    'DHA Certification Readiness & HL7 FHIR',

  configuration:
    'Facility & System Configuration Engine',

  audit:
    'Immutable Security Audit Trail',
};

/*
|--------------------------------------------------------------------------
| Header
|--------------------------------------------------------------------------
*/

export const Header: React.FC = () => {
  const {
    tenants,
    currentTenant,
    setCurrentTenant,

    facilities,
    currentFacility,
    setCurrentFacility,

    authenticatedUser,
    currentUser,

    activeModule,
    setActiveModule,

    isMobileMenuOpen,
    setIsMobileMenuOpen,

    logout,
    showToast,
  } = useHmis();

  /*
  |--------------------------------------------------------------------------
  | Dropdown State
  |--------------------------------------------------------------------------
  */

  const [
    tenantDropdownOpen,
    setTenantDropdownOpen,
  ] = useState(false);

  const [
    facilityDropdownOpen,
    setFacilityDropdownOpen,
  ] = useState(false);

  const [
    userDropdownOpen,
    setUserDropdownOpen,
  ] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | Logout State
  |--------------------------------------------------------------------------
  */

  const [
    loggingOut,
    setLoggingOut,
  ] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | Authoritative User Identity
  |--------------------------------------------------------------------------
  */

  const displayName =
    authenticatedUser?.fullName ||
    currentUser?.name ||
    'Authenticated User';

  const username =
    authenticatedUser?.username ||
    '';

  const email =
    authenticatedUser?.email ||
    '';

  /*
  |--------------------------------------------------------------------------
  | Temporary Display Role
  |--------------------------------------------------------------------------
  |
  | The role displayed here is NOT an authorization mechanism.
  | Backend RBAC will become authoritative.
  |
  */

  const displayRole =
    currentUser?.role ||
    'Authenticated User';

  const department =
    currentUser?.department ||
    'JaliCare HMIS';

  const professionalId =
    currentUser?.license ||
    '';

  /*
  |--------------------------------------------------------------------------
  | User Initials
  |--------------------------------------------------------------------------
  */

  const userInitials =
    displayName
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(
        (name) =>
          name.charAt(0)
      )
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'JC';

  /*
  |--------------------------------------------------------------------------
  | Close Dropdowns
  |--------------------------------------------------------------------------
  */

  const closeDropdowns = () => {
    setTenantDropdownOpen(false);
    setFacilityDropdownOpen(false);
    setUserDropdownOpen(false);
  };

  /*
  |--------------------------------------------------------------------------
  | Logout
  |--------------------------------------------------------------------------
  */

  const handleLogout = async () => {
    if (loggingOut) {
      return;
    }

    setLoggingOut(true);

    try {
      await logout();
    } finally {
      setLoggingOut(false);
      closeDropdowns();
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Render
  |--------------------------------------------------------------------------
  */

  return (
    <header
      className="
        h-14
        border-b
        border-slate-200
        bg-white
        px-3
        sm:px-5
        flex
        items-center
        justify-between
        z-30
        shrink-0
        relative
      "
    >
      {/* ------------------------------------------------------------------
          Zone 1: Mobile Menu + Brand + Breadcrumb
      ------------------------------------------------------------------ */}

      <div
        className="
          flex
          items-center
          gap-2
          sm:gap-4
          min-w-0
        "
      >
        {/* Mobile Menu */}

        <button
          type="button"
          onClick={() =>
            setIsMobileMenuOpen(
              !isMobileMenuOpen
            )
          }
          className="
            p-2
            -ml-1
            text-slate-600
            hover:text-slate-900
            rounded-lg
            md:hidden
            hover:bg-slate-100
            transition-colors
          "
          aria-label="Toggle navigation menu"
        >
          {isMobileMenuOpen ? (
            <X className="w-5 h-5 text-slate-800" />
          ) : (
            <Menu className="w-5 h-5 text-slate-800" />
          )}
        </button>

        {/* JaliCare Brand */}

        <div className="flex items-center gap-2.5">
          <div
            className="
              w-7
              h-7
              sm:w-8
              sm:h-8
              rounded-lg
              bg-blue-700
              text-white
              flex
              items-center
              justify-center
              font-bold
              text-sm
              sm:text-base
              shadow-xs
              shrink-0
              relative
              overflow-hidden
            "
          >
            <span className="font-black tracking-tight text-white">
              Jc
            </span>

            <span
              className="
                absolute
                bottom-0
                right-0
                w-2
                h-2
                sm:w-2.5
                sm:h-2.5
                bg-orange-500
                rounded-tl-xs
              "
              title="Care Indicator"
            />
          </div>

          <div className="flex flex-col">
            <div className="flex items-center gap-1 sm:gap-1.5">
              <span
                className="
                  font-bold
                  text-slate-900
                  text-sm
                  sm:text-base
                  tracking-tight
                  leading-none
                  whitespace-nowrap
                "
              >
                JaliCare
              </span>

              <span
                className="
                  px-1.5
                  py-0.5
                  rounded
                  text-3xs
                  font-bold
                  uppercase
                  tracking-wider
                  bg-orange-100
                  text-orange-800
                  leading-none
                "
              >
                Care
              </span>
            </div>

            <span
              className="
                text-3xs
                text-slate-400
                font-medium
                tracking-wide
                leading-tight
                hidden
                xs:inline
              "
            >
              Kenya HMIS
            </span>
          </div>
        </div>

        <span
          className="
            text-slate-300
            font-light
            hidden
            lg:inline
          "
          aria-hidden="true"
        >
          /
        </span>

        {/* Breadcrumb */}

        <div
          className="
            hidden
            lg:flex
            items-center
            gap-2
            text-xs
            font-medium
            text-slate-600
            truncate
          "
        >
          <span
            className="
              text-slate-500
              truncate
              max-w-40
            "
          >
            {currentFacility?.name ||
              'Facility'}
          </span>

          <span
            className="text-slate-300"
            aria-hidden="true"
          >
            ·
          </span>

          <span
            className="
              text-blue-900
              font-semibold
              truncate
            "
          >
            {moduleTitles[activeModule]}
          </span>
        </div>
      </div>

      {/* ------------------------------------------------------------------
          Zone 2: Tenant / Facility / DHA / User
      ------------------------------------------------------------------ */}

      <div
        className="
          flex
          items-center
          gap-1.5
          sm:gap-3
        "
      >
        {/* Tenant Selector */}

        <div className="relative hidden sm:block">
          <button
            type="button"
            onClick={() => {
              setTenantDropdownOpen(
                !tenantDropdownOpen
              );

              setFacilityDropdownOpen(false);
              setUserDropdownOpen(false);
            }}
            className="
              flex
              items-center
              gap-1.5
              px-2
              sm:px-2.5
              py-1.5
              rounded-md
              border
              border-slate-200
              bg-slate-50
              text-slate-700
              text-xs
              font-medium
              hover:bg-slate-100
              transition-colors
              whitespace-nowrap
            "
            title="Switch Healthcare Tenant"
          >
            <Layers
              className="
                w-3.5
                h-3.5
                text-slate-500
                shrink-0
              "
            />

            <span
              className="
                max-w-24
                sm:max-w-32
                truncate
              "
            >
              {currentTenant?.name ||
                'Tenant'}
            </span>

            <ChevronDown
              className="
                w-3
                h-3
                text-slate-400
                shrink-0
              "
            />
          </button>

          {tenantDropdownOpen && (
            <div
              className="
                absolute
                top-full
                left-0
                mt-1
                w-64
                bg-white
                border
                border-slate-200
                rounded-lg
                shadow-lg
                py-1.5
                z-50
                text-xs
                animate-in
                fade-in
                zoom-in-95
                duration-100
              "
            >
              <div
                className="
                  px-3
                  py-1
                  text-2xs
                  uppercase
                  tracking-wider
                  text-slate-400
                  font-semibold
                "
              >
                Healthcare Organization
              </div>

              {tenants.length === 0 ? (
                <div
                  className="
                    px-3
                    py-3
                    text-slate-400
                  "
                >
                  No organizations available.
                </div>
              ) : (
                tenants.map((tenant) => (
                  <button
                    type="button"
                    key={tenant.id}
                    onClick={async () => {
                      try {
                        await setCurrentTenant(
                          tenant
                        );

                        setTenantDropdownOpen(
                          false
                        );

                        showToast(
                          `Switched tenant to: ${tenant.name}`
                        );
                      } catch {
                        showToast(
                          'Unable to switch organization.'
                        );
                      }
                    }}
                    className={`
                      w-full
                      text-left
                      px-3
                      py-2
                      hover:bg-slate-50
                      flex
                      items-center
                      justify-between
                      ${
                        currentTenant?.id ===
                        tenant.id
                          ? 'bg-blue-50/70 text-blue-900 font-semibold'
                          : 'text-slate-700'
                      }
                    `}
                  >
                    <span className="truncate">
                      {tenant.name}
                    </span>

                    <span
                      className="
                        text-2xs
                        text-slate-400
                        font-mono
                      "
                    >
                      {tenant.currency}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Facility Selector */}

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setFacilityDropdownOpen(
                !facilityDropdownOpen
              );

              setTenantDropdownOpen(false);
              setUserDropdownOpen(false);
            }}
            className="
              flex
              items-center
              gap-1.5
              px-2
              sm:px-2.5
              py-1.5
              rounded-md
              border
              border-blue-200/80
              bg-blue-50/50
              text-blue-900
              text-xs
              font-medium
              hover:bg-blue-50
              transition-colors
              whitespace-nowrap
            "
            title="Switch Facility"
          >
            <Building2
              className="
                w-3.5
                h-3.5
                text-blue-700
                shrink-0
              "
            />

            <span
              className="
                max-w-24
                sm:max-w-36
                truncate
                font-semibold
              "
            >
              {currentFacility?.name ||
                'Facility'}
            </span>

            <span
              className="
                font-mono
                text-2xs
                text-orange-700
                font-bold
                hidden
                xl:inline
              "
            >
              {currentFacility?.mflCode}
            </span>

            <ChevronDown
              className="
                w-3
                h-3
                text-blue-500
                shrink-0
              "
            />
          </button>

          {facilityDropdownOpen && (
            <div
              className="
                absolute
                top-full
                right-0
                sm:right-auto
                sm:left-0
                mt-1
                w-72
                bg-white
                border
                border-slate-200
                rounded-lg
                shadow-lg
                py-1.5
                z-50
                text-xs
                animate-in
                fade-in
                zoom-in-95
                duration-100
              "
            >
              <div
                className="
                  px-3
                  py-1
                  text-2xs
                  uppercase
                  tracking-wider
                  text-slate-400
                  font-semibold
                "
              >
                Branches & Health Facilities
              </div>

              {facilities.length === 0 ? (
                <div
                  className="
                    px-3
                    py-3
                    text-slate-400
                  "
                >
                  No facilities available.
                </div>
              ) : (
                facilities.map(
                  (facility) => (
                    <button
                      type="button"
                      key={facility.id}
                      onClick={() => {
                        setCurrentFacility(
                          facility
                        );

                        setFacilityDropdownOpen(
                          false
                        );

                        showToast(
                          `Switched facility to: ${facility.name} (${facility.mflCode})`
                        );
                      }}
                      className={`
                        w-full
                        text-left
                        px-3
                        py-2
                        hover:bg-slate-50
                        flex
                        flex-col
                        ${
                          currentFacility?.id ===
                          facility.id
                            ? 'bg-blue-50/70 text-blue-900 font-semibold'
                            : 'text-slate-700'
                        }
                      `}
                    >
                      <div
                        className="
                          flex
                          items-center
                          justify-between
                        "
                      >
                        <span className="truncate">
                          {facility.name}
                        </span>

                        <span
                          className="
                            font-mono
                            text-2xs
                            text-orange-600
                            font-semibold
                          "
                        >
                          {facility.mflCode}
                        </span>
                      </div>

                      <span
                        className="
                          text-2xs
                          text-slate-400
                        "
                      >
                        {facility.level} ·{' '}
                        {facility.county}
                      </span>
                    </button>
                  )
                )
              )}
            </div>
          )}
        </div>

        {/* DHA Indicator */}

        <button
          type="button"
          onClick={() =>
            setActiveModule(
              'interoperability'
            )
          }
          className="
            hidden
            xl:flex
            items-center
            gap-1.5
            px-2.5
            py-1
            text-xs
            text-blue-900
            bg-blue-50/60
            border
            border-blue-200
            rounded-md
            hover:bg-blue-100/60
            transition-colors
          "
          title="Digital Health Agency & FHIR Readiness Matrix"
        >
          <ShieldCheck
            className="
              w-3.5
              h-3.5
              text-blue-700
            "
          />

          <span className="font-medium">
            DHA Ready
          </span>

          <span
            className="
              font-mono
              text-2xs
              text-orange-600
              font-semibold
            "
          >
            FHIR R4
          </span>
        </button>

        {/* ----------------------------------------------------------------
            Authenticated User Menu
        ---------------------------------------------------------------- */}

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setUserDropdownOpen(
                !userDropdownOpen
              );

              setTenantDropdownOpen(false);
              setFacilityDropdownOpen(false);
            }}
            className="
              flex
              items-center
              gap-1.5
              sm:gap-2
              pl-1.5
              sm:pl-2
              pr-2
              sm:pr-3
              py-1
              rounded-md
              border
              border-slate-200
              hover:border-blue-400
              transition-colors
              bg-white
              text-left
            "
            aria-haspopup="menu"
            aria-expanded={
              userDropdownOpen
            }
          >
            {/* Avatar */}

            <div
              className="
                w-6
                h-6
                rounded-full
                bg-blue-800
                text-white
                flex
                items-center
                justify-center
                text-xs
                font-semibold
                shrink-0
              "
            >
              {userInitials}
            </div>

            {/* Name + Role */}

            <div
              className="
                hidden
                sm:flex
                flex-col
                min-w-0
              "
            >
              <span
                className="
                  text-xs
                  font-medium
                  text-slate-900
                  leading-tight
                  truncate
                  max-w-28
                  sm:max-w-32
                "
              >
                {displayName}
              </span>

              <span
                className="
                  text-2xs
                  text-orange-700
                  font-semibold
                  leading-tight
                  truncate
                  max-w-28
                  sm:max-w-32
                "
              >
                {displayRole}
              </span>
            </div>

            <ChevronDown
              className="
                w-3
                h-3
                text-slate-400
                shrink-0
              "
            />
          </button>

          {userDropdownOpen && (
            <div
              className="
                absolute
                top-full
                right-0
                mt-1
                w-80
                bg-white
                border
                border-slate-200
                rounded-lg
                shadow-lg
                py-1.5
                z-50
                text-xs
                animate-in
                fade-in
                zoom-in-95
                duration-100
              "
              role="menu"
            >
              {/* Identity */}

              <div
                className="
                  px-3
                  py-3
                  border-b
                  border-slate-100
                "
              >
                <div
                  className="
                    flex
                    items-center
                    gap-3
                  "
                >
                  <div
                    className="
                      w-10
                      h-10
                      rounded-full
                      bg-blue-800
                      text-white
                      flex
                      items-center
                      justify-center
                      text-sm
                      font-semibold
                      shrink-0
                    "
                  >
                    {userInitials}
                  </div>

                  <div className="min-w-0">
                    <div
                      className="
                        font-semibold
                        text-slate-900
                        truncate
                      "
                    >
                      {displayName}
                    </div>

                    {username && (
                      <div
                        className="
                          text-2xs
                          text-slate-500
                          mt-0.5
                          truncate
                        "
                      >
                        @{username}
                      </div>
                    )}

                    <div
                      className="
                        text-2xs
                        text-orange-700
                        font-semibold
                        mt-0.5
                      "
                    >
                      {displayRole}
                    </div>
                  </div>
                </div>
              </div>

              {/* Account Details */}

              <div className="px-3 py-2.5 space-y-2">
                <div>
                  <div
                    className="
                      text-2xs
                      uppercase
                      tracking-wider
                      text-slate-400
                      font-semibold
                    "
                  >
                    Email
                  </div>

                  <div
                    className="
                      text-xs
                      text-slate-600
                      mt-0.5
                      truncate
                    "
                  >
                    {email ||
                      'No email available'}
                  </div>
                </div>

                <div>
                  <div
                    className="
                      text-2xs
                      uppercase
                      tracking-wider
                      text-slate-400
                      font-semibold
                    "
                  >
                    Work Area
                  </div>

                  <div
                    className="
                      flex
                      items-center
                      gap-2
                      text-xs
                      text-slate-600
                      mt-0.5
                    "
                  >
                    <UserCircle className="w-3.5 h-3.5 shrink-0" />

                    <span className="truncate">
                      {department}
                    </span>
                  </div>
                </div>

                {professionalId && (
                  <div>
                    <div
                      className="
                        text-2xs
                        uppercase
                        tracking-wider
                        text-slate-400
                        font-semibold
                      "
                    >
                      Professional ID
                    </div>

                    <div
                      className="
                        text-xs
                        text-slate-600
                        mt-0.5
                        font-mono
                      "
                    >
                      {professionalId}
                    </div>
                  </div>
                )}

                {authenticatedUser && (
                  <div>
                    <div
                      className="
                        text-2xs
                        uppercase
                        tracking-wider
                        text-slate-400
                        font-semibold
                      "
                    >
                      Account Status
                    </div>

                    <div
                      className="
                        text-xs
                        text-slate-600
                        mt-0.5
                      "
                    >
                      {authenticatedUser.accountStatus}
                    </div>
                  </div>
                )}
              </div>

              {/* Logout */}

              <div
                className="
                  border-t
                  border-slate-100
                  mt-1
                  pt-1
                "
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void handleLogout();
                  }}
                  disabled={loggingOut}
                  className="
                    w-full
                    flex
                    items-center
                    gap-2
                    px-3
                    py-2.5
                    text-left
                    text-red-700
                    hover:bg-red-50
                    disabled:opacity-50
                    disabled:cursor-not-allowed
                    transition-colors
                  "
                >
                  <LogOut className="w-4 h-4" />

                  <span className="font-medium">
                    {loggingOut
                      ? 'Signing out...'
                      : 'Sign out'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};