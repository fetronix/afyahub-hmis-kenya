import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { api, type AuthenticatedUser } from '../api/client.ts';

import type { Tenant, Facility, Patient } from '../types/index.ts';

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

/* ============================================================
   Notifications
   ============================================================

   One queue, rendered once, at the centre of the screen. Every
   existing `showToast(...)` call keeps working; a caller that knows
   the outcome can pass a tone so a refused save does not wear a
   green tick.
   ============================================================ */

export type NotificationTone = 'info' | 'success' | 'warning' | 'error';

export interface ShowToastOptions {
  tone?: NotificationTone;
}

export interface AppNotification {
  id: number;
  message: string;
  tone: NotificationTone;
  createdAt: number;
}

/** How long a single notification stays on screen. */
export const NOTIFICATION_LIFETIME_MS = 5200;

/** How many are shown at once before the oldest is dropped. */
export const NOTIFICATION_QUEUE_LIMIT = 4;

export type UserRole = string;

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
  | 'platform_administration'
  | 'registration'
  | 'reception'
  | 'opd'
  | 'inpatient'
  | 'maternity'
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
  | 'analytics'
  | 'interoperability'
  | 'configuration'
  | 'patient_portal'
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
    password: string,
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

  setCurrentTenant: (tenant: Tenant) => Promise<void>;

  facilities: Facility[];

  currentFacility: Facility | null;

  setCurrentFacility: (facility: Facility) => void;

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

  setCurrentUser: (user: StaffUser) => void;

  /*
  |--------------------------------------------------------------------------
  | Navigation
  |--------------------------------------------------------------------------
  */

  activeModule: ModuleId;

  setActiveModule: (mod: ModuleId) => void;

  /*
  |--------------------------------------------------------------------------
  | Patient Journey
  |--------------------------------------------------------------------------
  */

  selectedPatient: Patient | null;

  setSelectedPatient: (patient: Patient | null) => void;

  isJourneyModalOpen: boolean;

  setIsJourneyModalOpen: (open: boolean) => void;

  /*
  |--------------------------------------------------------------------------
  | Mobile Navigation
  |--------------------------------------------------------------------------
  */

  isMobileMenuOpen: boolean;

  setIsMobileMenuOpen: (open: boolean) => void;

  /*
  |--------------------------------------------------------------------------
  | Notifications
  |--------------------------------------------------------------------------
  */

  notifications: AppNotification[];

  showToast: (msg: string, options?: ShowToastOptions) => void;

  dismissNotification: (id: number) => void;

  dismissAllNotifications: () => void;

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

function mapAuthenticatedUserToStaffUser(user: AuthenticatedUser): StaffUser {
  const assignedRoles = user.roles ?? [];

  let role = user.designation?.trim() ?? '';

  if (user.isSuperAdmin || assignedRoles.includes('SUPER_ADMIN')) {
    role = 'Platform Administrator';
  } else if (!role && assignedRoles.length > 0) {
    role = assignedRoles[0]
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  return {
    name: user.fullName,
    role: role || 'Unassigned Role',
    license: '',
    department: '',
  };
}
/*
|--------------------------------------------------------------------------
| Context
|--------------------------------------------------------------------------
*/

const HmisContext = createContext<HmisContextType | undefined>(undefined);

/*
|--------------------------------------------------------------------------
| Provider
|--------------------------------------------------------------------------
*/

export const HmisProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  /*
  |--------------------------------------------------------------------------
  | Authentication State
  |--------------------------------------------------------------------------
  */

  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const [authenticatedUser, setAuthenticatedUser] = useState<AuthenticatedUser | null>(null);

  const [authLoading, setAuthLoading] = useState(true);

  /*
  |--------------------------------------------------------------------------
  | Tenant State
  |--------------------------------------------------------------------------
  */

  const [tenants, setTenants] = useState<Tenant[]>([]);

  const [currentTenant, setCurrentTenantState] = useState<Tenant | null>(null);

  /*
  |--------------------------------------------------------------------------
  | Facility State
  |--------------------------------------------------------------------------
  */

  const [facilities, setFacilities] = useState<Facility[]>([]);

  const [currentFacility, setCurrentFacilityState] = useState<Facility | null>(null);

  /*
  |--------------------------------------------------------------------------
  | UI State
  |--------------------------------------------------------------------------
  */

  const [activeModule, setActiveModule] = useState<ModuleId>('dashboard');

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  const [isJourneyModalOpen, setIsJourneyModalOpen] = useState(false);

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const [refreshKey, setRefreshKey] = useState(0);

  const [loading, setLoading] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | Toast
  |--------------------------------------------------------------------------
  */

  const notificationSequence = useRef(0);
  const notificationTimers = useRef(new Map<number, number>());

  const dismissNotification = useCallback((id: number) => {
    const timer = notificationTimers.current.get(id);

    if (timer !== undefined) {
      window.clearTimeout(timer);
      notificationTimers.current.delete(id);
    }

    setNotifications((current) => current.filter((notification) => notification.id !== id));
  }, []);

  const dismissAllNotifications = useCallback(() => {
    for (const timer of notificationTimers.current.values()) {
      window.clearTimeout(timer);
    }

    notificationTimers.current.clear();
    setNotifications([]);
  }, []);

  /*
   * Clear every pending timer when the provider unmounts. The previous
   * implementation kept one global timer, so a second toast raised
   * within four seconds could be wiped by the first toast's timer.
   * Timers are per notification now.
   */
  useEffect(
    () => () => {
      for (const timer of notificationTimers.current.values()) {
        window.clearTimeout(timer);
      }

      notificationTimers.current.clear();
    },
    [],
  );

  const showToast = useCallback(
    (msg: string, options?: ShowToastOptions) => {
      const message = msg.trim();

      if (!message) return;

      const tone = options?.tone ?? 'info';

      setNotifications((current) => {
        /*
         * The same sentence twice is the same notification refreshed,
         * not two dialogs. A screen can report one server message from
         * two paths, and a queue of identical rows is noise.
         */
        const duplicate = current.find(
          (notification) => notification.message === message && notification.tone === tone,
        );

        if (duplicate) {
          const existingTimer = notificationTimers.current.get(duplicate.id);

          if (existingTimer !== undefined) {
            window.clearTimeout(existingTimer);
          }

          notificationTimers.current.set(
            duplicate.id,
            window.setTimeout(() => dismissNotification(duplicate.id), NOTIFICATION_LIFETIME_MS),
          );

          return current;
        }

        const id = (notificationSequence.current += 1);

        const next = [...current, { id, message, tone, createdAt: Date.now() }];

        notificationTimers.current.set(
          id,
          window.setTimeout(() => dismissNotification(id), NOTIFICATION_LIFETIME_MS),
        );

        return next.length > NOTIFICATION_QUEUE_LIMIT
          ? next.slice(next.length - NOTIFICATION_QUEUE_LIMIT)
          : next;
      });
    },
    [dismissNotification],
  );

  /*
  |--------------------------------------------------------------------------
  | Refresh
  |--------------------------------------------------------------------------
  */

  const triggerRefresh = () => {
    setRefreshKey((current) => current + 1);
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

  const loadTenantAndFacilityContext = async (user: AuthenticatedUser) => {
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

      if (user.tenantId === null) {
        const tenantList = await api.getTenants();

        setTenants(tenantList);

        if (tenantList.length === 0) {
          setCurrentTenantState(null);

          setFacilities([]);

          setCurrentFacilityState(null);

          return;
        }

        const selectedTenant = tenantList[0];

        setCurrentTenantState(selectedTenant);

        const facilityList = await api.getFacilities(selectedTenant.id);

        setFacilities(facilityList);

        /*
          |--------------------------------------------------------------------------
          | Respect an assigned facility if one exists.
          |--------------------------------------------------------------------------
          */

        if (user.facilityId !== null) {
          const assignedFacility =
            facilityList.find((facility) => facility.id === user.facilityId) ?? null;

          setCurrentFacilityState(assignedFacility);
        } else {
          setCurrentFacilityState(facilityList[0] ?? null);
        }

        return;
      }

      /*
        |--------------------------------------------------------------------------
        | Tenant-bound user
        |--------------------------------------------------------------------------
        */

      const tenantList = await api.getTenants();

      const authorizedTenant = tenantList.find((tenant) => tenant.id === user.tenantId) ?? null;

      if (!authorizedTenant) {
        setTenants([]);

        setCurrentTenantState(null);

        setFacilities([]);

        setCurrentFacilityState(null);

        return;
      }

      setTenants([authorizedTenant]);

      setCurrentTenantState(authorizedTenant);

      /*
        |--------------------------------------------------------------------------
        | Load facilities for authorized tenant
        |--------------------------------------------------------------------------
        */

      const facilityList = await api.getFacilities(authorizedTenant.id);

      /*
        |--------------------------------------------------------------------------
        | Facility-bound user
        |--------------------------------------------------------------------------
        */

      if (user.facilityId !== null) {
        const authorizedFacility =
          facilityList.find((facility) => facility.id === user.facilityId) ?? null;

        setFacilities(authorizedFacility ? [authorizedFacility] : []);

        setCurrentFacilityState(authorizedFacility);

        return;
      }

      /*
        |--------------------------------------------------------------------------
        | Tenant-level user without facility restriction
        |--------------------------------------------------------------------------
        */

      setFacilities(facilityList);

      setCurrentFacilityState(facilityList[0] ?? null);
    } catch (error) {
      console.error('Failed to initialize authorized tenant/facility context:', error);

      setTenants([]);

      setCurrentTenantState(null);

      setFacilities([]);

      setCurrentFacilityState(null);
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

    const restoreSession = async () => {
      setAuthLoading(true);

      try {
        /*
          |--------------------------------------------------------------------------
          | getSession() will fail if there is no valid token.
          |--------------------------------------------------------------------------
          */

        const session = await api.getSession();

        if (!mounted) {
          return;
        }

        if (session.success && session.user) {
          setAuthenticatedUser(session.user);

          setIsAuthenticated(true);

          await loadTenantAndFacilityContext(session.user);
        } else {
          setAuthenticatedUser(null);

          setIsAuthenticated(false);
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

        if (import.meta.env.DEV) {
          console.debug('No valid existing authentication session.', error);
        }

        if (mounted) {
          setAuthenticatedUser(null);

          setIsAuthenticated(false);

          setTenants([]);

          setCurrentTenantState(null);

          setFacilities([]);

          setCurrentFacilityState(null);
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

  const login = async (identifier: string, password: string) => {
    setAuthLoading(true);

    try {
      const result = await api.login(identifier, password);

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

      if (result.requiresMfa) {
        return {
          success: true,
          requiresMfa: true,
          message: result.message ?? 'Additional authentication is required.',
        };
      }

      /*
      |--------------------------------------------------------------------------
      | Password authentication must return a user.
      |--------------------------------------------------------------------------
      */

      if (!result.user) {
        return {
          success: false,
          message: 'Authentication succeeded but no authenticated user was returned.',
        };
      }

      /*
      |--------------------------------------------------------------------------
      | Store authenticated identity
      |--------------------------------------------------------------------------
      */

      const sessionResult = await api.getSession();

      if (!sessionResult.success || !sessionResult.user) {
        api.clearLocalSession();

        setAuthenticatedUser(null);
        setIsAuthenticated(false);

        return {
          success: false,
          message:
            'Login succeeded, but your authorized session could not be loaded. Please try again.',
        };
      }

      const authenticatedSessionUser = sessionResult.user;

      setAuthenticatedUser(authenticatedSessionUser);

      setIsAuthenticated(true);

      /*
      |--------------------------------------------------------------------------
      | Reset UI state after login
      |--------------------------------------------------------------------------
      */

      setActiveModule(
        authenticatedSessionUser.isSuperAdmin ||
          authenticatedSessionUser.roles?.includes('SUPER_ADMIN')
          ? 'platform_administration'
          : 'dashboard',
      );

      setSelectedPatient(null);

      setIsJourneyModalOpen(false);

      /*
      |--------------------------------------------------------------------------
      | Load authorized tenant/facility context
      |--------------------------------------------------------------------------
      */

      await loadTenantAndFacilityContext(authenticatedSessionUser);

      return {
        success: true,
        requiresPasswordChange: result.requiresPasswordChange,
        message: result.message,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed.';

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

  const logout = async () => {
    setAuthLoading(true);

    try {
      await api.logout();
    } catch (error) {
      console.error('Logout request failed:', error);
    } finally {
      /*
        |--------------------------------------------------------------------------
        | Destroy local authentication state.
        |--------------------------------------------------------------------------
        */

      setAuthenticatedUser(null);

      setIsAuthenticated(false);

      /*
        |--------------------------------------------------------------------------
        | Clear tenant/facility state.
        |--------------------------------------------------------------------------
        */

      setTenants([]);

      setCurrentTenantState(null);

      setFacilities([]);

      setCurrentFacilityState(null);

      /*
        |--------------------------------------------------------------------------
        | Clear sensitive UI state.
        |--------------------------------------------------------------------------
        */

      setSelectedPatient(null);

      setIsJourneyModalOpen(false);

      setIsMobileMenuOpen(false);

      /*
        |--------------------------------------------------------------------------
        | Reset navigation.
        |--------------------------------------------------------------------------
        */

      setActiveModule('dashboard');

      setAuthLoading(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Tenant Change
  |--------------------------------------------------------------------------
  */

  const handleTenantChange = async (tenant: Tenant) => {
    if (!authenticatedUser) {
      showToast('Authentication is required.');

      return;
    }

    /*
      |--------------------------------------------------------------------------
      | Platform administrator
      |--------------------------------------------------------------------------
      */

    if (authenticatedUser.tenantId === null) {
      setLoading(true);

      try {
        const facilityList = await api.getFacilities(tenant.id);

        setCurrentTenantState(tenant);

        setFacilities(facilityList);

        if (authenticatedUser.facilityId !== null) {
          const assignedFacility =
            facilityList.find((facility) => facility.id === authenticatedUser.facilityId) ?? null;

          setCurrentFacilityState(assignedFacility);
        } else {
          setCurrentFacilityState(facilityList[0] ?? null);
        }

        triggerRefresh();
      } catch (error) {
        console.error('Failed to change tenant facilities:', error);

        showToast('Unable to load facilities for this organization.');
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

    if (authenticatedUser.tenantId !== tenant.id) {
      showToast('You are not authorized to switch to this organization.');

      return;
    }

    setLoading(true);

    try {
      const facilityList = await api.getFacilities(tenant.id);

      setCurrentTenantState(tenant);

      /*
        |--------------------------------------------------------------------------
        | Facility-bound tenant user
        |--------------------------------------------------------------------------
        */

      if (authenticatedUser.facilityId !== null) {
        const authorizedFacility =
          facilityList.find((facility) => facility.id === authenticatedUser.facilityId) ?? null;

        setFacilities(authorizedFacility ? [authorizedFacility] : []);

        setCurrentFacilityState(authorizedFacility);
      } else {
        /*
          |--------------------------------------------------------------------------
          | Tenant-level user
          |--------------------------------------------------------------------------
          */

        setFacilities(facilityList);

        setCurrentFacilityState(facilityList[0] ?? null);
      }

      triggerRefresh();
    } catch (error) {
      console.error('Failed to change tenant facilities:', error);

      showToast('Unable to load facilities for this organization.');
    } finally {
      setLoading(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Facility Change
  |--------------------------------------------------------------------------
  */

  const handleFacilityChange = (facility: Facility) => {
    if (!authenticatedUser) {
      showToast('Authentication is required.');

      return;
    }

    /*
      |--------------------------------------------------------------------------
      | Verify selected facility belongs to selected tenant
      |--------------------------------------------------------------------------
      */

    if (currentTenant && facility.tenantId !== currentTenant.id) {
      showToast('This facility does not belong to the selected organization.');

      return;
    }

    /*
      |--------------------------------------------------------------------------
      | Facility-bound users cannot switch facilities
      |--------------------------------------------------------------------------
      */

    if (authenticatedUser.facilityId !== null && authenticatedUser.facilityId !== facility.id) {
      showToast('You are not authorized to access this facility.');

      return;
    }

    setCurrentFacilityState(facility);

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

  const currentUser: StaffUser = authenticatedUser
    ? mapAuthenticatedUserToStaffUser(authenticatedUser)
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

  const setCurrentUser = (user: StaffUser): void => {
    console.warn(
      'setCurrentUser is deprecated. User identity and roles are managed by backend authentication and RBAC.',
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

        setCurrentTenant: handleTenantChange,

        facilities,

        currentFacility,

        setCurrentFacility: handleFacilityChange,

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

        notifications,

        showToast,

        dismissNotification,

        dismissAllNotifications,

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

export const useHmis = (): HmisContextType => {
  const context = useContext(HmisContext);

  if (!context) {
    throw new Error('useHmis must be used within HmisProvider');
  }

  return context;
};
