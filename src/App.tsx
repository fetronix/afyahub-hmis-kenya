import React from 'react';
import { HmisProvider, useHmis } from './context/HmisContext.tsx';

import { Header } from './components/Header.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { LoginScreen } from './components/LoginScreen.tsx';
import { PatientJourneyModal } from './components/PatientJourneyModal.tsx';

import { DashboardModule } from './components/modules/DashboardModule.tsx';
import { PatientRegistrationModule } from './components/modules/PatientRegistrationModule.tsx';
import { ReceptionQueueModule } from './components/modules/ReceptionQueueModule.tsx';
import { OutpatientModule } from './components/modules/OutpatientModule.tsx';
import { InpatientModule } from './components/modules/InpatientModule.tsx';
import { TheatreModule } from './components/modules/TheatreModule.tsx';
import { SpecialtyModule } from './components/modules/SpecialtyModule.tsx';
import { LaboratoryModule } from './components/modules/LaboratoryModule.tsx';
import { RadiologyModule } from './components/modules/RadiologyModule.tsx';
import { PharmacyModule } from './components/modules/PharmacyModule.tsx';
import { InventoryModule } from './components/modules/InventoryModule.tsx';
import { ProcurementModule } from './components/modules/ProcurementModule.tsx';
import { BillingCashierModule } from './components/modules/BillingCashierModule.tsx';
import { InsuranceClaimsModule } from './components/modules/InsuranceClaimsModule.tsx';
import { PublicHealthModule } from './components/modules/PublicHealthModule.tsx';
import { InteroperabilityModule } from './components/modules/InteroperabilityModule.tsx';
import { ConfigurationModule } from './components/modules/ConfigurationModule.tsx';
import { AuditLogModule } from './components/modules/AuditLogModule.tsx';

import { CheckCircle2, Loader2 } from 'lucide-react';

const AppContent: React.FC = () => {
  const {
    activeModule,
    toastMessage,
    loading,
    isAuthenticated,
    authLoading,
  } = useHmis();

  /*
   * ---------------------------------------------------------
   * AUTHENTICATION GATE
   * ---------------------------------------------------------
   *
   * While the application is checking whether an existing
   * session is valid, do not show the login screen or dashboard.
   */
  if (authLoading) {
    return (
      <div className="min-h-screen w-screen bg-slate-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white shadow-lg flex items-center justify-center">
            <Loader2 className="w-7 h-7 text-teal-600 animate-spin" />
          </div>

          <div className="text-center">
            <h1 className="text-lg font-semibold text-slate-800">
              JaliCare HMIS
            </h1>

            <p className="text-sm text-slate-500 mt-1">
              Verifying your secure session...
            </p>
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
      case 'dashboard':
        return <DashboardModule />;

      case 'registration':
        return <PatientRegistrationModule />;

      case 'reception':
        return <ReceptionQueueModule />;

      case 'opd':
        return <OutpatientModule />;

      case 'inpatient':
        return <InpatientModule />;

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

      case 'public_health':
        return <PublicHealthModule />;

      case 'interoperability':
        return <InteroperabilityModule />;

      case 'configuration':
        return <ConfigurationModule />;

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
    <div className="flex flex-col h-screen w-screen bg-slate-100 overflow-hidden font-sans text-slate-800 antialiased selection:bg-teal-100 selection:text-teal-900">

      {/* Top Header */}
      <Header />

      {/* Main Container */}
      <div className="flex flex-1 overflow-hidden">

        {/* Navigation Sidebar */}
        <Sidebar />

        {/* Viewport Content */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 bg-slate-100/80">
          <div className="max-w-7xl mx-auto space-y-4">
            {renderModule()}
          </div>
        </main>
      </div>

      {/* Longitudinal Patient Journey Modal */}
      <PatientJourneyModal />

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white text-xs px-4 py-3 rounded-xl shadow-xl flex items-center gap-2.5 border border-slate-800 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Global Loading Indicator */}
      {loading && (
        <div className="fixed inset-0 z-[100] bg-slate-950/10 backdrop-blur-[1px] pointer-events-none">
          <div className="absolute top-0 left-0 right-0 h-1 bg-teal-500 animate-pulse" />
        </div>
      )}
    </div>
  );
};

export default function App() {
  return (
    <HmisProvider>
      <AppContent />
    </HmisProvider>
  );
}