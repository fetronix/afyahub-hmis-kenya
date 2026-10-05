import React, { createContext, useContext, useState, useEffect } from 'react';
import { Tenant, Facility, Patient } from '../types/index.ts';
import { api } from '../api/client.ts';

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

interface HmisContextType {
  tenants: Tenant[];
  currentTenant: Tenant | null;
  setCurrentTenant: (tenant: Tenant) => void;
  facilities: Facility[];
  currentFacility: Facility | null;
  setCurrentFacility: (facility: Facility) => void;
  currentUser: StaffUser;
  setCurrentUser: (user: StaffUser) => void;
  activeModule: ModuleId;
  setActiveModule: (mod: ModuleId) => void;
  selectedPatient: Patient | null;
  setSelectedPatient: (patient: Patient | null) => void;
  isJourneyModalOpen: boolean;
  setIsJourneyModalOpen: (open: boolean) => void;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
  toastMessage: string | null;
  showToast: (msg: string) => void;
  refreshKey: number;
  triggerRefresh: () => void;
  loading: boolean;
}

const defaultStaff: StaffUser = {
  name: 'Dr. Angela Omwamba',
  role: 'Medical Director',
  license: 'KMPDC A.45821',
  department: 'Executive Clinical Leadership',
};

const HmisContext = createContext<HmisContextType | undefined>(undefined);

export const HmisProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [currentTenant, setCurrentTenant] = useState<Tenant | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [currentFacility, setCurrentFacility] = useState<Facility | null>(null);
  const [currentUser, setCurrentUser] = useState<StaffUser>(defaultStaff);
  const [activeModule, setActiveModule] = useState<ModuleId>('dashboard');
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [isJourneyModalOpen, setIsJourneyModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);

  const triggerRefresh = () => setRefreshKey((k) => k + 1);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  useEffect(() => {
    async function initTenantsAndFacilities() {
      try {
        setLoading(true);
        const tList = await api.getTenants();
        setTenants(tList);
        if (tList.length > 0) {
          const selectedT = tList[0];
          setCurrentTenant(selectedT);
          const fList = await api.getFacilities(selectedT.id);
          setFacilities(fList);
          if (fList.length > 0) {
            setCurrentFacility(fList[0]);
          }
        }
      } catch (err) {
        console.error('Failed to initialize tenants & facilities:', err);
      } finally {
        setLoading(false);
      }
    }
    initTenantsAndFacilities();
  }, []);

  const handleTenantChange = async (tenant: Tenant) => {
    setCurrentTenant(tenant);
    try {
      const fList = await api.getFacilities(tenant.id);
      setFacilities(fList);
      if (fList.length > 0) {
        setCurrentFacility(fList[0]);
      } else {
        setCurrentFacility(null);
      }
      triggerRefresh();
    } catch (err) {
      console.error('Failed to change tenant facilities:', err);
    }
  };

  return (
    <HmisContext.Provider
      value={{
        tenants,
        currentTenant,
        setCurrentTenant: handleTenantChange,
        facilities,
        currentFacility,
        setCurrentFacility,
        currentUser,
        setCurrentUser,
        activeModule,
        setActiveModule,
        selectedPatient,
        setSelectedPatient,
        isJourneyModalOpen,
        setIsJourneyModalOpen,
        isMobileMenuOpen,
        setIsMobileMenuOpen,
        toastMessage,
        showToast,
        refreshKey,
        triggerRefresh,
        loading,
      }}
    >
      {children}
    </HmisContext.Provider>
  );
};

export const useHmis = () => {
  const ctx = useContext(HmisContext);
  if (!ctx) throw new Error('useHmis must be used within HmisProvider');
  return ctx;
};
