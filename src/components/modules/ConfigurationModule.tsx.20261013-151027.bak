import React, { useState } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import {
  Sliders,
  Building2,
  Layers,
  ShieldCheck,
  CheckCircle2,
  DollarSign,
  BedDouble,
  FlaskConical,
  CreditCard,
  ToggleLeft,
  ToggleRight,
  Plus
} from 'lucide-react';

export const ConfigurationModule: React.FC = () => {
  const { currentFacility, currentTenant, showToast } = useHmis();
  const [activeTab, setActiveTab] = useState<'facility' | 'modules' | 'roles' | 'tariffs' | 'payments'>('facility');

  // Facility Info Form
  const [facilityData, setFacilityData] = useState({
    name: currentFacility?.name || 'Nairobi Central Referral Hospital',
    code: currentFacility?.code || 'NRB-CENTRAL',
    level: currentFacility?.level || 'Level 5 Hospital',
    county: currentFacility?.county || 'Nairobi',
    subCounty: currentFacility?.subCounty || 'Westlands',
    mflCode: currentFacility?.mflCode || 'MFL-12845',
    phone: currentFacility?.phone || '+254 703 082 000',
    email: currentFacility?.email || 'admin@nairobihospital.ke',
  });

  // Enabled Modules Toggles
  const [enabledModules, setEnabledModules] = useState<Record<string, boolean>>({
    registration: true,
    reception: true,
    opd: true,
    inpatient: true,
    theatre: true,
    specialty: true,
    laboratory: true,
    radiology: true,
    pharmacy: true,
    inventory: true,
    procurement: true,
    finance: true,
    insurance: true,
    public_health: true,
    analytics: true,
    interoperability: true,
  });

  // Roles & Permissions matrix
  const [rolesList, setRolesList] = useState([
    { role: 'Platform Administrator', perms: ['Full System Admin', 'Multi-Tenant Config', 'Billing Rules', 'Audit Logs'] },
    { role: 'Facility Administrator', perms: ['User Management', 'Departments', 'Bed Allocation', 'Pricing Tariffs'] },
    { role: 'Medical Director', perms: ['Approve POs', 'Clinical Reviews', 'Surgical Allocation', 'Death Audits'] },
    { role: 'Doctor / Consultant', perms: ['OPD Consultation', 'Prescribe Drugs', 'Order Labs', 'Admit Patients'] },
    { role: 'Clinical Officer', perms: ['OPD Triage', 'Consultation', 'Prescribe', 'Referrals'] },
    { role: 'Nurse / Midwife', perms: ['Record Vitals', 'Triage Category', 'MAR Nursing Notes', 'Ward Care'] },
    { role: 'Pharmacist', perms: ['Dispense Medicines', 'Stock Batches', 'Drug Reorders', 'Expiry Tracking'] },
    { role: 'Laboratory Technologist', perms: ['Sample Accessioning', 'Result Entry', 'Pathologist Verification'] },
    { role: 'Radiology Staff', perms: ['PACS Management', 'Radiology Reports', 'Imaging Queue'] },
    { role: 'Cashier / Revenue Officer', perms: ['Receive Payments', 'M-Pesa STK Push', 'Issue Receipts', 'POS Shift'] },
  ]);

  const toggleModule = (key: string) => {
    setEnabledModules(prev => ({ ...prev, [key]: !prev[key] }));
    showToast(`Updated module "${key}" state.`);
  };

  const handleSaveFacility = (e: React.FormEvent) => {
    e.preventDefault();
    showToast('Facility configuration updated successfully.');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Hospital Configuration Engine</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Zero-code administrative controls: Facility details, enabled modular features, RBAC matrix, and payment gateways.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 bg-teal-50 border border-teal-200 text-teal-800 text-xs font-semibold rounded-lg">
            Tenant: {currentTenant?.name}
          </span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl p-2 shadow-xs flex flex-wrap items-center gap-2">
        {[
          { id: 'facility', label: 'Facility Profile', icon: Building2 },
          { id: 'modules', label: 'Modular Features Engine', icon: Layers },
          { id: 'roles', label: 'RBAC Roles & Permissions', icon: ShieldCheck },
          { id: 'payments', label: 'M-Pesa & Payment Channels', icon: CreditCard },
          { id: 'tariffs', label: 'Service Pricing & Tariffs', icon: DollarSign },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-teal-700 text-white font-semibold shadow-xs'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* FACILITY PROFILE TAB */}
      {activeTab === 'facility' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs text-xs space-y-5">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 uppercase">
              Facility Information & KMFL Registration
            </h2>
            <span className="text-2xs text-slate-400 font-mono">Tenant ID: {currentTenant?.slug}</span>
          </div>

          <form onSubmit={handleSaveFacility} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Facility Name</label>
                <input
                  type="text"
                  value={facilityData.name}
                  onChange={(e) => setFacilityData({ ...facilityData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md font-semibold text-slate-900"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Facility Code</label>
                <input
                  type="text"
                  value={facilityData.code}
                  onChange={(e) => setFacilityData({ ...facilityData, code: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Facility Level</label>
                <select
                  value={facilityData.level}
                  onChange={(e) => setFacilityData({ ...facilityData, level: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                >
                  <option value="Level 2 Clinic">Level 2 Clinic</option>
                  <option value="Level 3 Medical Center">Level 3 Medical Center</option>
                  <option value="Level 4 Sub-County Hospital">Level 4 Sub-County Hospital</option>
                  <option value="Level 5 County Referral Hospital">Level 5 County Referral Hospital</option>
                  <option value="Level 6 National Teaching Hospital">Level 6 National Referral Hospital</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">County</label>
                <input
                  type="text"
                  value={facilityData.county}
                  onChange={(e) => setFacilityData({ ...facilityData, county: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Sub-County</label>
                <input
                  type="text"
                  value={facilityData.subCounty}
                  onChange={(e) => setFacilityData({ ...facilityData, subCounty: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Kenya Master Facility Code (KMFL)</label>
                <input
                  type="text"
                  value={facilityData.mflCode}
                  onChange={(e) => setFacilityData({ ...facilityData, mflCode: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono font-bold text-teal-800"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Contact Phone</label>
                <input
                  type="text"
                  value={facilityData.phone}
                  onChange={(e) => setFacilityData({ ...facilityData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Official Email</label>
                <input
                  type="email"
                  value={facilityData.email}
                  onChange={(e) => setFacilityData({ ...facilityData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="submit"
                className="px-5 py-2 bg-teal-700 text-white rounded-lg font-semibold hover:bg-teal-800 transition-colors shadow-xs"
              >
                Save Facility Settings
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODULAR FEATURES ENGINE TAB */}
      {activeTab === 'modules' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs text-xs space-y-4">
          <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900 uppercase">
                Facility Module Provisioning Engine
              </h2>
              <p className="text-2xs text-slate-500">
                Tailor system complexity: Enable or disable specific departments according to clinic or hospital size.
              </p>
            </div>
            <span className="text-2xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-semibold">
              Live Reconfiguration Active
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(enabledModules).map(([modKey, isEnabled]) => (
              <div
                key={modKey}
                onClick={() => toggleModule(modKey)}
                className={`p-3.5 rounded-lg border cursor-pointer transition-all flex items-center justify-between ${
                  isEnabled
                    ? 'border-teal-700 bg-teal-50/30'
                    : 'border-slate-200 bg-slate-50/50 opacity-60'
                }`}
              >
                <div>
                  <div className="font-semibold text-slate-900 capitalize">{modKey.replace('_', ' ')}</div>
                  <div className="text-3xs text-slate-500">
                    {isEnabled ? 'Active in navigation & API' : 'Disabled for this facility'}
                  </div>
                </div>

                <div className={`text-base font-bold ${isEnabled ? 'text-teal-700' : 'text-slate-400'}`}>
                  {isEnabled ? 'ON' : 'OFF'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RBAC MATRIX TAB */}
      {activeTab === 'roles' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs text-xs">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
            <h2 className="font-bold text-slate-900 uppercase">
              Role-Based Access Control (RBAC) System
            </h2>
            <span className="text-2xs text-slate-400">10 Clinical & Administrative Roles</span>
          </div>

          <div className="divide-y divide-slate-100">
            {rolesList.map((r, idx) => (
              <div key={idx} className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-slate-50/60">
                <div className="min-w-44">
                  <span className="font-bold text-slate-900">{r.role}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 flex-1">
                  {r.perms.map((p, pIdx) => (
                    <span key={pIdx} className="px-2 py-0.5 rounded text-2xs bg-slate-100 text-slate-700 font-medium">
                      {p}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => showToast(`Configured permissions for role: ${r.role}`)}
                  className="px-2.5 py-1 text-2xs font-semibold text-teal-800 bg-teal-50 rounded hover:bg-teal-100 transition-colors"
                >
                  Edit Permissions
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PAYMENT CHANNELS TAB */}
      {activeTab === 'payments' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs text-xs space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900 uppercase">
              Payment Gateway Integration & M-Pesa Credentials
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 border border-slate-200 rounded-lg space-y-3">
              <span className="font-bold text-slate-900 text-xs">Safaricom Daraja M-Pesa STK Push</span>
              <div>
                <label className="block text-slate-600 mb-1">Business Shortcode / Paybill</label>
                <input type="text" defaultValue="883921" className="w-full px-3 py-1.5 border border-slate-200 rounded font-mono" />
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Passkey (Encrypted)</label>
                <input type="password" defaultValue="bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919" className="w-full px-3 py-1.5 border border-slate-200 rounded font-mono" />
              </div>
              <span className="text-2xs text-emerald-700 font-medium">✓ Auto-STK Push Active on Cashier POS</span>
            </div>

            <div className="p-4 border border-slate-200 rounded-lg space-y-3">
              <span className="font-bold text-slate-900 text-xs">Bank Wire / PDQ Card Terminal</span>
              <div>
                <label className="block text-slate-600 mb-1">Bank Name</label>
                <input type="text" defaultValue="KCB Bank Kenya Ltd" className="w-full px-3 py-1.5 border border-slate-200 rounded" />
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Account Number</label>
                <input type="text" defaultValue="1102948201" className="w-full px-3 py-1.5 border border-slate-200 rounded font-mono" />
              </div>
              <span className="text-2xs text-emerald-700 font-medium">✓ Card & EFT Reconciliation Active</span>
            </div>
          </div>
        </div>
      )}

      {/* SERVICE PRICING TAB */}
      {activeTab === 'tariffs' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs text-xs">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
            <h2 className="font-bold text-slate-900 uppercase">
              Facility Tariff & Pricing Schedule
            </h2>
            <button
              onClick={() => showToast('Tariff added to master list.')}
              className="text-2xs font-semibold text-teal-800 bg-teal-50 px-2.5 py-1 rounded hover:bg-teal-100"
            >
              + Add Custom Service Tariff
            </button>
          </div>

          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-2xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2.5 font-medium">Service Code</th>
                <th className="px-4 py-2.5 font-medium">Description</th>
                <th className="px-4 py-2.5 font-medium">Department</th>
                <th className="px-4 py-2.5 font-medium text-right">Standard Fee (KES)</th>
                <th className="px-4 py-2.5 font-medium text-right">SHA Covered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {[
                { code: 'SRV-OPD-01', desc: 'General Medical Doctor Consultation', dept: 'OPD', fee: '800.00', sha: 'Yes' },
                { code: 'SRV-SPEC-01', desc: 'Specialist Physician Consultation', dept: 'Specialist', fee: '2,500.00', sha: 'Yes' },
                { code: 'SRV-BED-GEN', desc: 'General Ward Inpatient Daily Charge', dept: 'Inpatient', fee: '1,500.00', sha: 'Yes' },
                { code: 'SRV-BED-ICU', desc: 'ICU / HDU Ventilated Bed Daily Fee', dept: 'Inpatient', fee: '12,000.00', sha: 'Pre-Auth' },
                { code: 'SRV-OT-CS', desc: 'Emergency Caesarean Section Theatre Fee', dept: 'Theatre', fee: '35,000.00', sha: 'Yes (Linda Mama/SHA)' },
                { code: 'SRV-REN-01', desc: 'Haemodialysis 4-Hour Session Fee', dept: 'Renal', fee: '9,500.00', sha: 'Yes (Dialysis Benefit)' },
              ].map((t, idx) => (
                <tr key={idx} className="hover:bg-slate-50/70">
                  <td className="px-4 py-2.5 font-bold text-teal-800">{t.code}</td>
                  <td className="px-4 py-2.5 font-sans font-medium text-slate-900">{t.desc}</td>
                  <td className="px-4 py-2.5 font-sans text-slate-600">{t.dept}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-slate-900">KES {t.fee}</td>
                  <td className="px-4 py-2.5 text-right font-sans text-emerald-700 font-semibold">{t.sha}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
