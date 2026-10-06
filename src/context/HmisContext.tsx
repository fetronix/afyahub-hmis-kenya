import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';

import {
  api,
  type AuthenticatedUser,
} from '../api/client.ts';

import type {
  Tenant,
  Facility,
  Patient,
} from '../types/index.ts';

/*
|--------------------------------------------------------------------------
| User Roles
|--------------------------------------------------------------------------
|
| These labels are currently UI compatibility labels.
|
| IMPORTANT:
| The backend RBAC system remains authoritative.
| The browser must never be trusted to determine permissions.
|
*/

export type UserRole =
  | 'Medical Director'
  | 'Doctor / Consultant'
  | 'Clinical Officer'
  | 'Nurse / Triage'
  | 'Pharmacist'
  | 'Laboratory Technologist'
  | 'Radiographer'
  | 'Cashier / Revenue'
  | 'Storekeeper'
  | 'Facility Administrator'
  | 'Platform Administrator';

export interface StaffUser {
  name: string;
  role: UserRole;
  license: string;
  department: string;
}

/*
|--------------------------------------------------------------------------
| Module IDs
|--------------------------------------------------------------------------
*/

export type ModuleId =
  | 'dashboard'
  | 'registration'
  | 'reception'
  | 'opd'
  | 'inpatient'
  | 'theatre'
  | 'specialty'
  | 'laboratory'
  | 'radiology'
  | 'pharmacy'
  | 'inventory'
  | 'procurement'
  | 'finance'
  | 'claims'
  | 'public_health'
  | 'interoperability'
  | 'configuration'
  | 'audit';

/*
|--------------------------------------------------------------------------
| Context Interface
|--------------------------------------------------------------------------
*/

interface HmisContextType {
  /*
  |--------------------------------------------------------------------------
  | Authentication
  |--------------------------------------------------------------------------
  */

  isAuthenticated: boolean;

  authenticatedUser: AuthenticatedUser | null;

  authLoading: boolean;

  login: (
    identifier: string,
    password: string
  ) => Promise<{
    success: boolean;
    message?: string;
    requiresMfa?: boolean;
    requiresPasswordChange?: boolean;
  }>;

  logout: () => Promise<void>;

  /*
  |--------------------------------------------------------------------------
  | Tenant / Facility
  |--------------------------------------------------------------------------
  */

  tenants: Tenant[];

  currentTenant: Tenant | null;

  setCurrentTenant: (
    tenant: Tenant
  ) => Promise<void>;

  facilities: Facility[];

  currentFacility: Facility | null;

  setCurrentFacility: (
    facility: Facility
  ) => void;

  /*
  |--------------------------------------------------------------------------
  | Current User
  |--------------------------------------------------------------------------
  |
  | This remains non-null for compatibility with the existing HMIS modules.
  |
  | authenticatedUser is the authoritative backend identity.
  | currentUser is only a UI representation of that identity.
  |
  */

  currentUser: StaffUser;

  /*
  |--------------------------------------------------------------------------
  | Legacy Compatibility
  |--------------------------------------------------------------------------
  |
  | Header.tsx currently expects setCurrentUser.
  |
  | This function does NOT change authentication or authorization.
  | It exists temporarily so the old component can compile.
  |
  | We will remove the fake browser-side role switcher when Header.tsx
  | is replaced.
  |
  */

  setCurrentUser: (
    user: StaffUser
  ) => void;

  /*
  |--------------------------------------------------------------------------
  | Navigation
  |--------------------------------------------------------------------------
  */

  activeModule: ModuleId;

  setActiveModule: (
    mod: ModuleId
  ) => void;

  /*
  |--------------------------------------------------------------------------
  | Patient Journey
  |--------------------------------------------------------------------------
  */

  selectedPatient: Patient | null;

  setSelectedPatient: (
    patient: Patient | null
  ) => void;

  isJourneyModalOpen: boolean;

  setIsJourneyModalOpen: (
    open: boolean
  ) => void;

  /*
  |--------------------------------------------------------------------------
  | Mobile Navigation
  |--------------------------------------------------------------------------
  */

  isMobileMenuOpen: boolean;

  setIsMobileMenuOpen: (
    open: boolean
  ) => void;

  /*
  |--------------------------------------------------------------------------
  | Notifications
  |--------------------------------------------------------------------------
  */

  toastMessage: string | null;

  showToast: (
    msg: string
  ) => void;

  /*
  |--------------------------------------------------------------------------
  | Refresh
  |--------------------------------------------------------------------------
  */

  refreshKey: number;

  triggerRefresh: () => void;

  /*
  |--------------------------------------------------------------------------
  | General Loading
  |--------------------------------------------------------------------------
  */

  loading: boolean;
}

/*
|--------------------------------------------------------------------------
| Empty UI User
|--------------------------------------------------------------------------
|
| Existing HMIS modules expect currentUser to always exist.
|
| During authentication/session restoration there may be no authenticated
| backend user yet. This safe empty object prevents null-reference errors.
|
| It is NOT treated as an authenticated user.
|
*/

const emptyStaffUser: StaffUser = {
  name: '',
  role: 'Facility Administrator',
  license: '',
  department: '',
};

/*
|--------------------------------------------------------------------------
| Convert Backend User to UI StaffUser
|--------------------------------------------------------------------------
|
| The backend AuthenticatedUser currently does not expose the final RBAC
| role, professional license, or department.
|
| Therefore we do not invent clinical permissions here.
|
| Backend RBAC will later provide the authoritative role.
|
*/

function mapAuthenticatedUserToStaffUser(
  user: AuthenticatedUser
): StaffUser {
  let role: UserRole =
    'Facility Administrator';

  /*
  |--------------------------------------------------------------------------
  | Temporary Platform Administrator mapping
  |--------------------------------------------------------------------------
  |
  | This is only for UI display.
  |
  | Authorization will eventually use backend RBAC.
  |
  */

  if (
    user.username.toLowerCase() ===
      'admin' ||
    user.email.toLowerCase() ===
      'admin@jalicare.co.ke'
  ) {
    role =
      'Platform Administrator';
  }

  return {
    name: user.fullName,
    role,
    license: '',
    department: '',
  };
}

/*
|--------------------------------------------------------------------------
| Context
|--------------------------------------------------------------------------
*/

const HmisContext =
  createContext<
    HmisContextType | undefined
  >(undefined);

/*
|--------------------------------------------------------------------------
| Provider
|--------------------------------------------------------------------------
*/

export const HmisProvider: React.FC<{
  children: React.ReactNode;
}> = ({
  children,
}) => {
  /*
  |--------------------------------------------------------------------------
  | Authentication State
  |--------------------------------------------------------------------------
  */

  const [
    isAuthenticated,
    setIsAuthenticated,
  ] = useState(false);

  const [
    authenticatedUser,
    setAuthenticatedUser,
  ] =
    useState<AuthenticatedUser | null>(
      null
    );

  const [
    authLoading,
    setAuthLoading,
  ] = useState(true);

  /*
  |--------------------------------------------------------------------------
  | Tenant State
  |--------------------------------------------------------------------------
  */

  const [
    tenants,
    setTenants,
  ] = useState<Tenant[]>([]);

  const [
    currentTenant,
    setCurrentTenantState,
  ] =
    useState<Tenant | null>(null);

  /*
  |--------------------------------------------------------------------------
  | Facility State
  |--------------------------------------------------------------------------
  */

  const [
    facilities,
    setFacilities,
  ] =
    useState<Facility[]>([]);

  const [
    currentFacility,
    setCurrentFacilityState,
  ] =
    useState<Facility | null>(null);

  /*
  |--------------------------------------------------------------------------
  | UI State
  |--------------------------------------------------------------------------
  */

  const [
    activeModule,
    setActiveModule,
  ] =
    useState<ModuleId>(
      'dashboard'
    );

  const [
    selectedPatient,
    setSelectedPatient,
  ] =
    useState<Patient | null>(
      null
    );

  const [
    isJourneyModalOpen,
    setIsJourneyModalOpen,
  ] =
    useState(false);

  const [
    isMobileMenuOpen,
    setIsMobileMenuOpen,
  ] =
    useState(false);

  const [
    toastMessage,
    setToastMessage,
  ] =
    useState<string | null>(
      null
    );

  const [
    refreshKey,
    setRefreshKey,
  ] = useState(0);

  const [
    loading,
    setLoading,
  ] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | Toast
  |--------------------------------------------------------------------------
  */

  const showToast = (
    msg: string
  ) => {
    setToastMessage(msg);

    window.setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  /*
  |--------------------------------------------------------------------------
  | Refresh
  |--------------------------------------------------------------------------
  */

  const triggerRefresh = () => {
    setRefreshKey(
      (current) =>
        current + 1
    );
  };

  /*
  |--------------------------------------------------------------------------
  | Load Authorized Tenant / Facility Context
  |--------------------------------------------------------------------------
  |
  | IMPORTANT:
  |
  | This is frontend state only.
  |
  | It is NOT a security boundary.
  |
  | The backend must independently enforce tenant and facility isolation.
  |
  */

  const loadTenantAndFacilityContext =
    async (
      user: AuthenticatedUser
    ) => {
      setLoading(true);

      try {
        /*
        |--------------------------------------------------------------------------
        | Platform Administrator
        |--------------------------------------------------------------------------
        |
        | tenantId === null means global platform scope.
        |
        */

        if (
          user.tenantId === null
        ) {
          const tenantList =
            await api.getTenants();

          setTenants(
            tenantList
          );

          if (
            tenantList.length ===
            0
          ) {
            setCurrentTenantState(
              null
            );

            setFacilities([]);

            setCurrentFacilityState(
              null
            );

            return;
          }

          const selectedTenant =
            tenantList[0];

          setCurrentTenantState(
            selectedTenant
          );

          const facilityList =
            await api.getFacilities(
              selectedTenant.id
            );

          setFacilities(
            facilityList
          );

          /*
          |--------------------------------------------------------------------------
          | Respect an assigned facility if one exists.
          |--------------------------------------------------------------------------
          */

          if (
            user.facilityId !==
            null
          ) {
            const assignedFacility =
              facilityList.find(
                (facility) =>
                  facility.id ===
                  user.facilityId
              ) ?? null;

            setCurrentFacilityState(
              assignedFacility
            );
          } else {
            setCurrentFacilityState(
              facilityList[0] ??
                null
            );
          }

          return;
        }

        /*
        |--------------------------------------------------------------------------
        | Tenant-bound user
        |--------------------------------------------------------------------------
        */

        const tenantList =
          await api.getTenants();

        const authorizedTenant =
          tenantList.find(
            (tenant) =>
              tenant.id ===
              user.tenantId
          ) ?? null;

        if (
          !authorizedTenant
        ) {
          setTenants([]);

          setCurrentTenantState(
            null
          );

          setFacilities([]);

          setCurrentFacilityState(
            null
          );

          return;
        }

        setTenants([
          authorizedTenant,
        ]);

        setCurrentTenantState(
          authorizedTenant
        );

        /*
        |--------------------------------------------------------------------------
        | Load facilities for authorized tenant
        |--------------------------------------------------------------------------
        */

        const facilityList =
          await api.getFacilities(
            authorizedTenant.id
          );

        /*
        |--------------------------------------------------------------------------
        | Facility-bound user
        |--------------------------------------------------------------------------
        */

        if (
          user.facilityId !==
          null
        ) {
          const authorizedFacility =
            facilityList.find(
              (facility) =>
                facility.id ===
                user.facilityId
            ) ?? null;

          setFacilities(
            authorizedFacility
              ? [
                  authorizedFacility,
                ]
              : []
          );

          setCurrentFacilityState(
            authorizedFacility
          );

          return;
        }

        /*
        |--------------------------------------------------------------------------
        | Tenant-level user without facility restriction
        |--------------------------------------------------------------------------
        */

        setFacilities(
          facilityList
        );

        setCurrentFacilityState(
          facilityList[0] ??
            null
        );
      } catch (error) {
        console.error(
          'Failed to initialize authorized tenant/facility context:',
          error
        );

        setTenants([]);

        setCurrentTenantState(
          null
        );

        setFacilities([]);

        setCurrentFacilityState(
          null
        );
      } finally {
        setLoading(false);
      }
    };

  /*
  |--------------------------------------------------------------------------
  | Restore Existing Session
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    let mounted = true;

    const restoreSession =
      async () => {
        setAuthLoading(true);

        try {
          /*
          |--------------------------------------------------------------------------
          | getSession() will fail if there is no valid token.
          |--------------------------------------------------------------------------
          */

          const session =
            await api.getSession();

          if (!mounted) {
            return;
          }

          if (
            session.success &&
            session.user
          ) {
            setAuthenticatedUser(
              session.user
            );

            setIsAuthenticated(
              true
            );

            await loadTenantAndFacilityContext(
              session.user
            );
          } else {
            setAuthenticatedUser(
              null
            );

            setIsAuthenticated(
              false
            );
          }
        } catch (error) {
          /*
          |--------------------------------------------------------------------------
          | No valid session.
          |--------------------------------------------------------------------------
          |
          | This is normal for a fresh browser session.
          |
          */

          if (
            import.meta.env.DEV
          ) {
            console.debug(
              'No valid existing authentication session.',
              error
            );
          }

          if (mounted) {
            setAuthenticatedUser(
              null
            );

            setIsAuthenticated(
              false
            );

            setTenants([]);

            setCurrentTenantState(
              null
            );

            setFacilities([]);

            setCurrentFacilityState(
              null
            );
          }
        } finally {
          if (mounted) {
            setAuthLoading(false);
          }
        }
      };

    void restoreSession();

    return () => {
      mounted = false;
    };
  }, []);

  /*
  |--------------------------------------------------------------------------
  | Login
  |--------------------------------------------------------------------------
  */

  const login = async (
    identifier: string,
    password: string
  ) => {
    setAuthLoading(true);

    try {
      const result =
        await api.login(
          identifier,
          password
        );

      /*
      |--------------------------------------------------------------------------
      | MFA
      |--------------------------------------------------------------------------
      |
      | MFA is not yet fully implemented.
      |
      | Therefore we MUST NOT mark the user authenticated until
      | MFA verification is completed.
      |
      */

      if (
        result.requiresMfa
      ) {
        return {
          success: true,
          requiresMfa: true,
          message:
            result.message ??
            'Additional authentication is required.',
        };
      }

      /*
      |--------------------------------------------------------------------------
      | Password authentication must return a user.
      |--------------------------------------------------------------------------
      */

      if (
        !result.user
      ) {
        return {
          success: false,
          message:
            'Authentication succeeded but no authenticated user was returned.',
        };
      }

      /*
      |--------------------------------------------------------------------------
      | Store authenticated identity
      |--------------------------------------------------------------------------
      */

      setAuthenticatedUser(
        result.user
      );

      setIsAuthenticated(
        true
      );

      /*
      |--------------------------------------------------------------------------
      | Reset UI state after login
      |--------------------------------------------------------------------------
      */

      setActiveModule(
        'dashboard'
      );

      setSelectedPatient(
        null
      );

      setIsJourneyModalOpen(
        false
      );

      /*
      |--------------------------------------------------------------------------
      | Load authorized tenant/facility context
      |--------------------------------------------------------------------------
      */

      await loadTenantAndFacilityContext(
        result.user
      );

      return {
        success: true,
        requiresPasswordChange:
          result.requiresPasswordChange,
        message:
          result.message,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Login failed.';

      return {
        success: false,
        message,
      };
    } finally {
      setAuthLoading(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Logout
  |--------------------------------------------------------------------------
  */

  const logout =
    async () => {
      setAuthLoading(true);

      try {
        await api.logout();
      } catch (error) {
        console.error(
          'Logout request failed:',
          error
        );
      } finally {
        /*
        |--------------------------------------------------------------------------
        | Destroy local authentication state.
        |--------------------------------------------------------------------------
        */

        setAuthenticatedUser(
          null
        );

        setIsAuthenticated(
          false
        );

        /*
        |--------------------------------------------------------------------------
        | Clear tenant/facility state.
        |--------------------------------------------------------------------------
        */

        setTenants([]);

        setCurrentTenantState(
          null
        );

        setFacilities([]);

        setCurrentFacilityState(
          null
        );

        /*
        |--------------------------------------------------------------------------
        | Clear sensitive UI state.
        |--------------------------------------------------------------------------
        */

        setSelectedPatient(
          null
        );

        setIsJourneyModalOpen(
          false
        );

        setIsMobileMenuOpen(
          false
        );

        /*
        |--------------------------------------------------------------------------
        | Reset navigation.
        |--------------------------------------------------------------------------
        */

        setActiveModule(
          'dashboard'
        );

        setAuthLoading(false);
      }
    };

  /*
  |--------------------------------------------------------------------------
  | Tenant Change
  |--------------------------------------------------------------------------
  */

  const handleTenantChange =
    async (
      tenant: Tenant
    ) => {
      if (
        !authenticatedUser
      ) {
        showToast(
          'Authentication is required.'
        );

        return;
      }

      /*
      |--------------------------------------------------------------------------
      | Platform administrator
      |--------------------------------------------------------------------------
      */

      if (
        authenticatedUser.tenantId ===
        null
      ) {
        setLoading(true);

        try {
          const facilityList =
            await api.getFacilities(
              tenant.id
            );

          setCurrentTenantState(
            tenant
          );

          setFacilities(
            facilityList
          );

          if (
            authenticatedUser.facilityId !==
            null
          ) {
            const assignedFacility =
              facilityList.find(
                (facility) =>
                  facility.id ===
                  authenticatedUser.facilityId
              ) ?? null;

            setCurrentFacilityState(
              assignedFacility
            );
          } else {
            setCurrentFacilityState(
              facilityList[0] ??
                null
            );
          }

          triggerRefresh();
        } catch (error) {
          console.error(
            'Failed to change tenant facilities:',
            error
          );

          showToast(
            'Unable to load facilities for this organization.'
          );
        } finally {
          setLoading(false);
        }

        return;
      }

      /*
      |--------------------------------------------------------------------------
      | Tenant-bound users cannot switch tenants
      |--------------------------------------------------------------------------
      */

      if (
        authenticatedUser.tenantId !==
        tenant.id
      ) {
        showToast(
          'You are not authorized to switch to this organization.'
        );

        return;
      }

      setLoading(true);

      try {
        const facilityList =
          await api.getFacilities(
            tenant.id
          );

        setCurrentTenantState(
          tenant
        );

        /*
        |--------------------------------------------------------------------------
        | Facility-bound tenant user
        |--------------------------------------------------------------------------
        */

        if (
          authenticatedUser.facilityId !==
          null
        ) {
          const authorizedFacility =
            facilityList.find(
              (facility) =>
                facility.id ===
                authenticatedUser.facilityId
            ) ?? null;

          setFacilities(
            authorizedFacility
              ? [
                  authorizedFacility,
                ]
              : []
          );

          setCurrentFacilityState(
            authorizedFacility
          );
        } else {
          /*
          |--------------------------------------------------------------------------
          | Tenant-level user
          |--------------------------------------------------------------------------
          */

          setFacilities(
            facilityList
          );

          setCurrentFacilityState(
            facilityList[0] ??
              null
          );
        }

        triggerRefresh();
      } catch (error) {
        console.error(
          'Failed to change tenant facilities:',
          error
        );

        showToast(
          'Unable to load facilities for this organization.'
        );
      } finally {
        setLoading(false);
      }
    };

  /*
  |--------------------------------------------------------------------------
  | Facility Change
  |--------------------------------------------------------------------------
  */

  const handleFacilityChange =
    (
      facility: Facility
    ) => {
      if (
        !authenticatedUser
      ) {
        showToast(
          'Authentication is required.'
        );

        return;
      }

      /*
      |--------------------------------------------------------------------------
      | Verify selected facility belongs to selected tenant
      |--------------------------------------------------------------------------
      */

      if (
        currentTenant &&
        facility.tenantId !==
          currentTenant.id
      ) {
        showToast(
          'This facility does not belong to the selected organization.'
        );

        return;
      }

      /*
      |--------------------------------------------------------------------------
      | Facility-bound users cannot switch facilities
      |--------------------------------------------------------------------------
      */

      if (
        authenticatedUser.facilityId !==
          null &&
        authenticatedUser.facilityId !==
          facility.id
      ) {
        showToast(
          'You are not authorized to access this facility.'
        );

        return;
      }

      setCurrentFacilityState(
        facility
      );

      triggerRefresh();
    };

  /*
  |--------------------------------------------------------------------------
  | Current User
  |--------------------------------------------------------------------------
  |
  | Always return a StaffUser object so existing HMIS modules can safely
  | use currentUser.name and currentUser.role.
  |
  */

  const currentUser: StaffUser =
    authenticatedUser
      ? mapAuthenticatedUserToStaffUser(
          authenticatedUser
        )
      : emptyStaffUser;

  /*
  |--------------------------------------------------------------------------
  | Legacy setCurrentUser Compatibility
  |--------------------------------------------------------------------------
  |
  | IMPORTANT:
  |
  | This does NOT change the authenticated identity.
  |
  | The old Header.tsx uses this to implement a fake staff/role switcher.
  | We will remove that behavior when Header.tsx is replaced.
  |
  */

  const setCurrentUser = (
    user: StaffUser
  ): void => {
    console.warn(
      'setCurrentUser is deprecated. User identity and roles are managed by backend authentication and RBAC.'
    );

    /*
    | The argument is deliberately ignored.
    |
    | This prevents browser-side role switching from changing the
    | authenticated identity.
    */

    void user;
  };

  /*
  |--------------------------------------------------------------------------
  | Provider
  |--------------------------------------------------------------------------
  */

  return (
    <HmisContext.Provider
      value={{
        /*
        |--------------------------------------------------------------------------
        | Authentication
        |--------------------------------------------------------------------------
        */

        isAuthenticated,

        authenticatedUser,

        authLoading,

        login,

        logout,

        /*
        |--------------------------------------------------------------------------
        | Tenant / Facility
        |--------------------------------------------------------------------------
        */

        tenants,

        currentTenant,

        setCurrentTenant:
          handleTenantChange,

        facilities,

        currentFacility,

        setCurrentFacility:
          handleFacilityChange,

        /*
        |--------------------------------------------------------------------------
        | Current User
        |--------------------------------------------------------------------------
        */

        currentUser,

        setCurrentUser,

        /*
        |--------------------------------------------------------------------------
        | Navigation
        |--------------------------------------------------------------------------
        */

        activeModule,

        setActiveModule,

        /*
        |--------------------------------------------------------------------------
        | Patient Journey
        |--------------------------------------------------------------------------
        */

        selectedPatient,

        setSelectedPatient,

        isJourneyModalOpen,

        setIsJourneyModalOpen,

        /*
        |--------------------------------------------------------------------------
        | Mobile Navigation
        |--------------------------------------------------------------------------
        */

        isMobileMenuOpen,

        setIsMobileMenuOpen,

        /*
        |--------------------------------------------------------------------------
        | Notifications
        |--------------------------------------------------------------------------
        */

        toastMessage,

        showToast,

        /*
        |--------------------------------------------------------------------------
        | Refresh
        |--------------------------------------------------------------------------
        */

        refreshKey,

        triggerRefresh,

        /*
        |--------------------------------------------------------------------------
        | Loading
        |--------------------------------------------------------------------------
        */

        loading,
      }}
    >
      {children}
    </HmisContext.Provider>
  );
};

/*
|--------------------------------------------------------------------------
| Hook
|--------------------------------------------------------------------------
*/

export const useHmis =
  (): HmisContextType => {
    const context =
      useContext(
        HmisContext
      );

    if (!context) {
      throw new Error(
        'useHmis must be used within HmisProvider'
      );
    }

    return context;
  };