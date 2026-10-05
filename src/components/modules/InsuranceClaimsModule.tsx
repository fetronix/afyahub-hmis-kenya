import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { InsuranceClaim, Patient, BillingInvoice } from '../../types/index.ts';
import {
  FileCheck2,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Plus,
  Shield,
  Send,
  Building2
} from 'lucide-react';

export const InsuranceClaimsModule: React.FC = () => {
  const { currentFacility, currentTenant, currentUser, setSelectedPatient, setIsJourneyModalOpen, showToast, refreshKey, triggerRefresh } = useHmis();
  const [claims, setClaims] = useState<InsuranceClaim[]>([]);
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);

  // New Claim Modal
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
  const [claimForm, setClaimForm] = useState({
    patientId: '',
    invoiceId: '',
    claimNumber: `CLM-SHA-2026-${Math.floor(1000 + Math.random() * 9000)}`,
    payerName: 'Social Health Authority (SHA)',
    policyNumber: 'SHA-KEN-2026-9921',
    preAuthCode: 'AUTH-SHA-782109',
    claimAmount: '4450.00',
    adjudicationNotes: 'OPD consultation, kidney profile lab test, and prescription cover.',
  });

  useEffect(() => {
    async function loadClaimsData() {
      setLoading(true);
      try {
        const [cList, invList, pList] = await Promise.all([
          api.getClaims(currentFacility?.id),
          api.getInvoices(currentFacility?.id),
          api.getPatients(undefined, currentFacility?.id),
        ]);
        setClaims(cList);
        setInvoices(invList);
        setPatients(pList);
        if (pList.length > 0 && !claimForm.patientId) {
          setClaimForm(prev => ({
            ...prev,
            patientId: pList[0].id.toString(),
            invoiceId: invList[0]?.id.toString() || '1',
          }));
        }
      } catch (err) {
        console.error('Failed to load insurance claims:', err);
      } finally {
        setLoading(false);
      }
    }
    loadClaimsData();
  }, [currentFacility, refreshKey]);

  const handleCreateClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!claimForm.patientId || !claimForm.invoiceId) return;

    try {
      await api.createClaim({
        tenantId: currentTenant?.id || 1,
        facilityId: currentFacility?.id || 1,
        patientId: Number(claimForm.patientId),
        invoiceId: Number(claimForm.invoiceId),
        claimNumber: claimForm.claimNumber,
        payerName: claimForm.payerName,
        policyNumber: claimForm.policyNumber,
        preAuthCode: claimForm.preAuthCode,
        claimAmount: claimForm.claimAmount,
        status: 'Submitted',
        submittedAt: new Date().toISOString(),
        adjudicationNotes: claimForm.adjudicationNotes,
      });

      showToast(`E-Claim submitted to ${claimForm.payerName} portal!`);
      setIsClaimModalOpen(false);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const handleUpdateClaimStatus = async (id: number, status: string, approvedAmount?: string) => {
    try {
      await api.updateClaimStatus(id, status, approvedAmount);
      showToast(`Claim status updated to "${status}"`);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const getPatient = (patientId: number) => {
    return patients.find(p => p.id === patientId);
  };

  const totalClaimValue = claims.reduce((acc, c) => acc + Number(c.claimAmount || 0), 0);
  const totalApprovedValue = claims.reduce((acc, c) => acc + Number(c.approvedAmount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Social Health Authority (SHA) & Payer E-Claims</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Payer abstraction engine, pre-authorizations, electronic claim submission, and remittance reconciliation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsClaimModalOpen(true)}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Submit New E-Claim</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
          <span className="text-2xs uppercase text-slate-400 font-semibold tracking-wider">Submitted Claims</span>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-1">{claims.length}</div>
          <div className="text-2xs text-slate-500 mt-1">Total value: KES {totalClaimValue.toLocaleString()}</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
          <span className="text-2xs uppercase text-emerald-700 font-semibold tracking-wider">Settled & Approved Value</span>
          <div className="text-2xl font-bold font-mono text-emerald-700 mt-1">
            KES {totalApprovedValue.toLocaleString()}
          </div>
          <div className="text-2xs text-slate-500 mt-1">Adjudicated reimbursement</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
          <span className="text-2xs uppercase text-teal-800 font-semibold tracking-wider">Primary Scheme</span>
          <div className="text-sm font-bold text-slate-900 mt-1">Kenya Social Health Authority (SHA)</div>
          <div className="text-2xs text-slate-500 mt-1">API Integration Ready</div>
        </div>
      </div>

      {/* Claims Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase flex items-center gap-1.5">
            <FileCheck2 className="w-4 h-4 text-teal-700" />
            <span>E-Claims Ledger ({claims.length})</span>
          </h2>
          <span className="text-2xs text-slate-400 font-mono">DHA Electronic Remittance Ready</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50/80 text-2xs text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2.5 font-medium">Claim Tracking #</th>
                <th className="px-4 py-2.5 font-medium">Patient Details</th>
                <th className="px-4 py-2.5 font-medium">Payer Scheme</th>
                <th className="px-4 py-2.5 font-medium">Pre-Auth Code</th>
                <th className="px-4 py-2.5 font-medium text-right">Claim Amount</th>
                <th className="px-4 py-2.5 font-medium text-right">Approved Amt</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {claims.map((c) => {
                const patient = getPatient(c.patientId);

                return (
                  <tr key={c.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-bold text-teal-800">{c.claimNumber}</td>
                    <td className="px-4 py-3 font-sans">
                      {patient ? (
                        <button
                          onClick={() => {
                            setSelectedPatient(patient);
                            setIsJourneyModalOpen(true);
                          }}
                          className="font-semibold text-slate-900 hover:text-teal-700 text-left block"
                        >
                          {patient.firstName} {patient.lastName}
                        </button>
                      ) : (
                        <span>Patient #{c.patientId}</span>
                      )}
                      <span className="text-2xs text-slate-400 font-mono">{patient?.mrn}</span>
                    </td>
                    <td className="px-4 py-3 font-sans text-slate-700">
                      <div>{c.payerName}</div>
                      <div className="text-2xs text-slate-400">{c.policyNumber || 'No Policy #'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.preAuthCode || 'Pre-Auth N/A'}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900">
                      KES {Number(c.claimAmount).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-700 font-bold">
                      KES {Number(c.approvedAmount || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-sans">
                      <span className={`px-2 py-0.5 rounded text-2xs font-medium ${
                        c.status === 'Approved' || c.status === 'Settled'
                          ? 'bg-emerald-50 text-emerald-800'
                          : c.status === 'Rejected'
                          ? 'bg-rose-50 text-rose-800'
                          : 'bg-amber-50 text-amber-800'
                      }`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-sans">
                      <select
                        value={c.status}
                        onChange={(e) => handleUpdateClaimStatus(c.id, e.target.value, c.claimAmount)}
                        className="px-2 py-1 text-2xs border border-slate-200 rounded font-medium"
                      >
                        <option value="Draft">Draft</option>
                        <option value="Submitted">Submitted</option>
                        <option value="Approved">Approved</option>
                        <option value="Settled">Settled</option>
                        <option value="Rejected">Rejected</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SUBMIT CLAIM MODAL */}
      {isClaimModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Submit Payer Electronic Claim</h3>
              <p className="text-2xs text-slate-500">Generate electronic submission for Social Health Authority or private insurer.</p>
            </div>

            <form onSubmit={handleCreateClaim} className="space-y-4">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Select Patient *</label>
                <select
                  required
                  value={claimForm.patientId}
                  onChange={(e) => {
                    const pid = e.target.value;
                    const pat = patients.find(p => p.id.toString() === pid);
                    const patInv = invoices.find(i => i.patientId.toString() === pid);
                    setClaimForm(prev => ({
                      ...prev,
                      patientId: pid,
                      payerName: pat?.insuranceProvider || (pat?.payerType === 'SHA' ? 'Social Health Authority (SHA)' : 'Jubilee Insurance'),
                      policyNumber: pat?.policyNumber || pat?.shaNumber || 'SHA-2026-9921',
                      invoiceId: patInv?.id.toString() || prev.invoiceId,
                      claimAmount: patInv?.totalAmount || prev.claimAmount,
                    }));
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                >
                  {patients.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName} ({p.mrn} · {p.payerType})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Payer Scheme</label>
                  <select
                    value={claimForm.payerName}
                    onChange={(e) => setClaimForm({ ...claimForm, payerName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  >
                    <option value="Social Health Authority (SHA)">Social Health Authority (SHA)</option>
                    <option value="Jubilee Health Insurance">Jubilee Health Insurance</option>
                    <option value="APA Insurance Kenya">APA Insurance Kenya</option>
                    <option value="Britam Health">Britam Health</option>
                    <option value="CIC Insurance Group">CIC Insurance Group</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Policy / Member ID</label>
                  <input
                    type="text"
                    required
                    value={claimForm.policyNumber}
                    onChange={(e) => setClaimForm({ ...claimForm, policyNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Pre-Authorization Code</label>
                  <input
                    type="text"
                    value={claimForm.preAuthCode}
                    onChange={(e) => setClaimForm({ ...claimForm, preAuthCode: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Claim Amount (KES) *</label>
                  <input
                    type="text"
                    required
                    value={claimForm.claimAmount}
                    onChange={(e) => setClaimForm({ ...claimForm, claimAmount: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Adjudication Notes</label>
                <textarea
                  rows={2}
                  value={claimForm.adjudicationNotes}
                  onChange={(e) => setClaimForm({ ...claimForm, adjudicationNotes: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsClaimModalOpen(false)}
                  className="px-3.5 py-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-teal-700 text-white rounded-md font-semibold hover:bg-teal-800"
                >
                  Submit E-Claim to Payer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
