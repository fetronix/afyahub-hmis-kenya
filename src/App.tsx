import React from 'react';
import { HmisProvider, useHmis } from './context/HmisContext.tsx';

import { Header } from './components/Header.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { LoginScreen } from './components/LoginScreen.tsx';
import { StaffInvitationAcceptance } from './components/StaffInvitationAcceptance.tsx';
import FacilityAdminInvitationAcceptance from './components/FacilityAdminInvitationAcceptance.tsx';
import { PlatformAdministrationModule } from './components/modules/PlatformAdministrationModule';
import { PatientJourneyModal } from './components/PatientJourneyModal.tsx';
import { NotificationDialog } from './components/NotificationDialog.tsx';
import { PatientPortalApp } from './components/portal/PortalApp.tsx';

import { DashboardModule } from './components/modules/DashboardModule.tsx';
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
import { InsuranceClaimsModule } from './components/modules/InsuranceClaimsModule.tsx';
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
    setActiveModule,
    loading,
    isAuthenticated,
    authLoading,
    contextLoading,
    contextError,
    retryContextInitialization,
  } = useHmis();

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
          <DashboardModule />
        );

      case 'registration':
        return <PatientRegistrationModule />;

      case 'reception':
        return <ReceptionQueueModule />;

      case 'opd':
        return <OutpatientModule />;

      case 'inpatient':
        return <InpatientModule />;

      case 'maternity':
        return <MaternityModule />;

      case 'theatre':
        return <TheatreModule />;

      case 'specialty':
        return <SpecialtyModule />;

      case 'laboratory':
        return <LaboratoryModule />;

      case 'radiology':
        return <RadiologyModule />;

      case 'pharmacy':
        return <PharmacyModule />;

      case 'inventory':
        return <InventoryModule />;

      case 'procurement':
        return <ProcurementModule />;

      case 'finance':
        return <BillingCashierModule />;

      case 'claims':
        return <InsuranceClaimsModule />;

      case 'analytics':
        return <ReportsModule />;

      case 'public_health':
        return <PublicHealthModule />;

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
        return <AuditLogModule />;

      default:
        return <DashboardModule />;
    }
  };

  /*
   * ---------------------------------------------------------
   * AUTHENTICATED HMIS APPLICATION
   * ---------------------------------------------------------
   */
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-canvas font-sans text-ink antialiased">
      {/* Top Header */}
      <Header />

      {/* Main Container */}
      <div className="flex flex-1 overflow-hidden">
        {/* Navigation Sidebar */}
        <Sidebar />

        {/* Viewport Content */}
        <main className="flex-1 overflow-y-auto bg-canvas px-3 py-4 sm:px-5 sm:py-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1400px] space-y-5">
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
      <AppContent />
    </HmisProvider>
  );
}
