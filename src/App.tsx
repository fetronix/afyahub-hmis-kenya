import React, { useEffect, useState } from 'react';
import { HmisProvider, useHmis } from './context/HmisContext.tsx';
import { InboxProvider } from './context/InboxContext.tsx';

import { Header, moduleTitles } from './components/Header.tsx';
import { PageBreadcrumbs } from './components/ui/layout.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { LoginScreen } from './components/LoginScreen.tsx';
import { StaffInvitationAcceptance } from './components/StaffInvitationAcceptance.tsx';
import FacilityAdminInvitationAcceptance from './components/FacilityAdminInvitationAcceptance.tsx';
import { PlatformAdministrationModule } from './components/modules/PlatformAdministrationModule';
import { PatientJourneyModal } from './components/PatientJourneyModal.tsx';
import { NotificationDialog } from './components/NotificationDialog.tsx';
import { PatientPortalApp } from './components/portal/PortalApp.tsx';

import { DashboardModule } from './components/modules/DashboardModule.tsx';
import { HospitalDashboard } from './components/modules/HospitalDashboard.tsx';
import { SuperAdminDashboardModule } from './components/modules/SuperAdminDashboardModule.tsx';
import { PatientRegistrationModule } from './components/modules/PatientRegistrationModule.tsx';
import { ReceptionQueueModule } from './components/modules/ReceptionQueueModule.tsx';
import { OutpatientModule } from './components/modules/OutpatientModule.tsx';
import { InpatientModule } from './components/modules/InpatientModule.tsx';
import { MaternityModule } from './components/modules/MaternityModule.tsx';
import { TheatreModule } from './components/modules/TheatreModule.tsx';
import { SpecialtyModule } from './components/modules/SpecialtyModule.tsx';
import { LaboratoryModule } from './components/modules/LaboratoryModule.tsx';
import { RadiologyModule } from './components/modules/RadiologyModule.tsx';
import { PharmacyModule } from './components/modules/PharmacyModule.tsx';
import { InventoryModule } from './components/modules/InventoryModule.tsx';
import { ProcurementModule } from './components/modules/ProcurementModule.tsx';
import { BillingCashierModule } from './components/modules/BillingCashierModule.tsx';
import { AccountingModule } from './components/modules/AccountingModule.tsx';
import { PaymentTransactions } from './components/modules/payment-hub/PaymentTransactions.tsx';
import { DialysisModule } from './components/modules/DialysisModule.tsx';
import { InsuranceClaimsModule } from './components/modules/InsuranceClaimsModule.tsx';
import { PrivateInsuranceModule } from './components/modules/private-insurance/PrivateInsuranceModule.tsx';
import { ReportsModule } from './components/modules/ReportsModule.tsx';
import { PublicHealthModule } from './components/modules/PublicHealthModule.tsx';
import { InteroperabilityModule } from './components/modules/InteroperabilityModule.tsx';
import { ConfigurationModule } from './components/modules/ConfigurationModule.tsx';
import { PatientPortalModule } from './components/modules/PatientPortalModule.tsx';
import { AuditLogModule } from './components/modules/AuditLogModule.tsx';

import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

const AppContent: React.FC = () => {
  const {
    activeModule,
    authenticatedUser,
    currentFacility,
    setActiveModule,
    loading,
    isAuthenticated,
    authLoading,
    contextLoading,
    contextError,
    retryContextInitialization,
  } = useHmis();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('jalicare.sidebar.collapsed') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('jalicare.sidebar.collapsed', sidebarCollapsed ? '1' : '0');
    } catch {
      /* A blocked storage preference must not prevent navigation. */
    }
  }, [sidebarCollapsed]);
  const toggleSidebar = () => setSidebarCollapsed((current) => !current);

  /*
   * ---------------------------------------------------------
   * AUTHENTICATION GATE
   * ---------------------------------------------------------
   *
   * While the application is checking whether an existing
   * session is valid, do not show the login screen or dashboard.
   */
  if (window.location.pathname === '/accept-staff-invitation') return <StaffInvitationAcceptance />;

  if (window.location.pathname === '/accept-facility-admin-invitation')
    return <FacilityAdminInvitationAcceptance />;
  if (authLoading) {
    return (
      <div className="min-h-screen w-screen bg-canvas flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white shadow-card flex items-center justify-center">
            <Loader2 className="w-7 h-7 text-brand-600 animate-spin" />
          </div>

          <div className="text-center">
            <h1 className="font-display text-xl text-ink">JaliCare HMIS</h1>

            <p className="text-sm text-slate-500 mt-1">Verifying your secure session...</p>
          </div>
        </div>
      </div>
    );
  }

  /*
   * ---------------------------------------------------------
   * LOGIN SCREEN
   * ---------------------------------------------------------
   *
   * No authenticated session = no access to the HMIS
   * dashboard.
   */
  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  /*
   * ---------------------------------------------------------
   * MODULE ROUTING
   * ---------------------------------------------------------
   */
  const renderModule = () => {
    if (
      authenticatedUser?.isSuperAdmin &&
      ['finance', 'accounting', 'claims', 'private_insurance'].includes(activeModule)
    ) {
      return (
        <div className="rounded-xl border border-hair bg-surface p-5 text-sm">
          Facility financial operations require an authorized facility account.
        </div>
      );
    }
    if (activeModule === 'dialysis' || activeModule === 'accounting') {
      const permission = activeModule === 'dialysis' ? 'dialysis.read' : 'accounting.read';
      const enabled = currentFacility?.enabledModules?.includes(activeModule);
      const hidden = currentFacility?.hiddenModules?.includes(activeModule);
      const permitted =
        authenticatedUser?.isSuperAdmin || authenticatedUser?.permissions?.includes(permission);
      if (!enabled || hidden || !permitted) {
        return (
          <div className="rounded-xl border border-hair bg-surface p-5 text-sm">
            This module is not available for the selected facility or account.
          </div>
        );
      }
    }
    switch (activeModule) {
      case 'platform_administration':
        return authenticatedUser?.isSuperAdmin ||
          authenticatedUser?.roles?.includes('SUPER_ADMIN') ? (
          <PlatformAdministrationModule />
        ) : (
          <DashboardModule />
        );
      case 'dashboard':
        return authenticatedUser?.isSuperAdmin ||
          authenticatedUser?.roles?.includes('SUPER_ADMIN') ? (
          <SuperAdminDashboardModule onNavigate={(module) => setActiveModule(module as any)} />
        ) : (
          <HospitalDashboard
            key={`${authenticatedUser?.id ?? 'none'}:${currentFacility?.id ?? 'none'}`}
          />
        );

      case 'registration':
        return (
          <PatientRegistrationModule
            key={`${authenticatedUser?.id ?? 'none'}:${currentFacility?.id ?? 'none'}`}
          />
        );

      case 'reception':
        return (
          <ReceptionQueueModule
            key={`${authenticatedUser?.id ?? 'none'}:${currentFacility?.id ?? 'none'}`}
          />
        );

      case 'opd':
        return (
          <OutpatientModule
            key={`${authenticatedUser?.id ?? 'none'}:${currentFacility?.id ?? 'none'}`}
          />
        );

      case 'inpatient':
        return <InpatientModule />;

      case 'maternity':
        return <MaternityModule />;

      case 'theatre':
        return <TheatreModule />;

      case 'dialysis':
        return <DialysisModule />;

      case 'specialty':
        return (
          <SpecialtyModule
            key={`${authenticatedUser?.id ?? 'none'}:${currentFacility?.id ?? 'none'}`}
          />
        );

      case 'laboratory':
        return (
          <LaboratoryModule
            key={`${authenticatedUser?.id ?? 'none'}:${currentFacility?.id ?? 'none'}`}
          />
        );

      case 'radiology':
        return (
          <RadiologyModule
            key={`${authenticatedUser?.id ?? 'none'}:${currentFacility?.id ?? 'none'}`}
          />
        );

      case 'pharmacy':
        return (
          <PharmacyModule
            key={`${authenticatedUser?.id ?? 'none'}:${currentFacility?.id ?? 'none'}`}
          />
        );

      case 'inventory':
        return (
          <InventoryModule
            key={`${authenticatedUser?.id ?? 'none'}:${currentFacility?.id ?? 'none'}`}
          />
        );

      case 'procurement':
        return <ProcurementModule />;

      case 'finance':
        return (
          <BillingCashierModule
            key={`${authenticatedUser?.id ?? 'none'}:${currentFacility?.id ?? 'none'}`}
          />
        );

      case 'payment_transactions':
        return !authenticatedUser?.isSuperAdmin &&
          !authenticatedUser?.roles?.includes('SUPER_ADMIN') &&
          currentFacility?.enabledModules?.includes('finance') &&
          !currentFacility?.hiddenModules?.includes('finance') &&
          authenticatedUser?.permissions?.includes('payment_hub.transactions.read') ? (
          <PaymentTransactions />
        ) : (
          <div className="rounded-xl border border-hair bg-surface p-5 text-sm">
            Payment transactions are not available for this facility or account.
          </div>
        );

      case 'accounting':
        return (
          <AccountingModule
            key={`${authenticatedUser?.id ?? 'none'}:${currentFacility?.id ?? 'none'}`}
          />
        );

      case 'claims':
        return <InsuranceClaimsModule />;

      case 'private_insurance':
        return (
          <PrivateInsuranceModule
            key={`${authenticatedUser?.id ?? 'none'}:${currentFacility?.id ?? 'none'}`}
          />
        );

      case 'analytics':
        return <ReportsModule />;

      case 'public_health':
        return (
          <PublicHealthModule
            key={`${authenticatedUser?.id ?? 'none'}:${currentFacility?.id ?? 'none'}`}
          />
        );

      case 'interoperability':
        /*
         * Superadmin only. The rail no longer offers this to facility
         * users, and this guard means a restored or programmatic
         * `activeModule` cannot open it either. The server refuses the
         * same requests independently — see `requireSuperAdmin` on
         * /api/compliance/dha and /api/integrations/dha/readiness.
         */
        return authenticatedUser?.isSuperAdmin ||
          authenticatedUser?.roles?.includes('SUPER_ADMIN') ? (
          <InteroperabilityModule />
        ) : (
          <DashboardModule />
        );

      case 'configuration':
        return <ConfigurationModule />;

      case 'patient_portal':
        return <PatientPortalModule />;

      case 'audit':
        return (
          <AuditLogModule
            key={`${authenticatedUser?.id ?? 'none'}:${currentFacility?.id ?? 'none'}`}
          />
        );

      default:
        return (
          <HospitalDashboard
            key={`${authenticatedUser?.id ?? 'none'}:${currentFacility?.id ?? 'none'}`}
          />
        );
    }
  };

  /*
   * ---------------------------------------------------------
   * AUTHENTICATED HMIS APPLICATION
   * ---------------------------------------------------------
   */
  return (
    <div className="app-shell flex h-screen h-[100dvh] w-screen overflow-hidden bg-canvas font-sans text-ink antialiased">
      <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} />
        <main className="app-workspace min-w-0 flex-1 overflow-y-auto bg-canvas px-3 py-4 sm:px-5 sm:py-5 lg:px-7">
          <div className="mx-auto w-full max-w-[1400px] space-y-5">
            {activeModule !== 'dashboard' && (
              <PageBreadcrumbs
                items={[
                  {
                    label: authenticatedUser?.isSuperAdmin ? 'Platform Dashboard' : 'Dashboard',
                    onClick: () => setActiveModule('dashboard'),
                  },
                  { label: moduleTitles[activeModule] },
                ]}
              />
            )}
            {contextError && (
              <div
                role="alert"
                className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm ${
                  contextError.kind === 'forbidden'
                    ? 'border-rose-200 bg-rose-50 text-rose-900'
                    : 'border-amber-300 bg-amber-50 text-amber-900'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">
                      {contextError.kind === 'forbidden'
                        ? 'Organization or facility access restricted'
                        : 'Authorized organization and facility context could not be loaded'}
                    </p>
                    <p className="mt-0.5 text-xs opacity-90">{contextError.message}</p>
                  </div>
                </div>

                {contextError.kind === 'error' && (
                  <button
                    type="button"
                    onClick={() => void retryContextInitialization()}
                    disabled={contextLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100/60 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${contextLoading ? 'animate-spin' : ''}`} />
                    {contextLoading ? 'Retrying…' : 'Retry'}
                  </button>
                )}
              </div>
            )}

            {renderModule()}
          </div>
        </main>
      </div>

      {/* Longitudinal Patient Journey Modal */}
      <PatientJourneyModal />

      {/*
        One notification surface for the whole product, centred and
        animated. Every `showToast(...)` call in every module lands
        here; nothing in a module renders its own banner.
      */}
      <NotificationDialog />

      {/* Global Loading Indicator */}
      {loading && (
        <div className="fixed inset-0 z-[100] bg-slate-950/10 backdrop-blur-[1px] pointer-events-none">
          <div className="absolute top-0 left-0 right-0 h-1 bg-brand-500 animate-pulse" />
        </div>
      )}
    </div>
  );
};

/**
 * The patient portal is a separate surface with its own session token.
 *
 * It is decided **before** `HmisProvider` mounts, so a patient's phone
 * never loads the staff session, the staff module catalogue or the
 * notification queue. The tokens live under different keys and neither
 * server router accepts the other's; this keeps the browser side of that
 * separation just as literal.
 */
const PORTAL_PATHS = ['/portal', '/portal/activate'];

export default function App() {
  /*
   * Trailing slashes are normalised: `/portal/activate/` was falling
   * through to the staff shell, which then said "Authentication is
   * required" to a patient holding a valid invitation.
   */
  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  if (PORTAL_PATHS.includes(path)) {
    return <PatientPortalApp />;
  }

  return (
    <HmisProvider>
      <InboxProvider>
        <AppContent />
      </InboxProvider>
    </HmisProvider>
  );
}
