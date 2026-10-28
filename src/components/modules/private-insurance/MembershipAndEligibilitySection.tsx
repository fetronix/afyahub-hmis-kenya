import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  Plus,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';
import type { Encounter, Patient } from '../../../types/index.ts';
import {
  privateInsuranceApi,
  type PrivateEligibilityRecord,
  type PrivateMemberPolicy,
  type PrivatePayerConfig,
} from '../../../api/private-insurance.client.ts';

interface Props {
  activeScreen: 'members' | 'eligibility';
  selectedPayerFilter: string;
  payers: PrivatePayerConfig[];
  patients: Patient[];
  encounters: Encounter[];
  members: PrivateMemberPolicy[];
  verifications: PrivateEligibilityRecord[];
  canManageMembers: boolean;
  canCheckEligibility: boolean;
  onRefresh: () => Promise<void>;
  showToast: (msg: string, opts?: { tone?: 'info' | 'success' | 'warning' | 'error' }) => void;
}

const SERVICE_CATEGORIES = [
  'OPD_CONSULTATION',
  'LABORATORY',
  'PHARMACY',
  'IMAGING',
  'PROCEDURE',
  'INPATIENT_BED',
  'THEATRE_SPECIALIST',
];

function verificationBadge(status: string): string {
  switch (status) {
    case 'PAYER_API_VERIFIED':
    case 'Eligible':
    case 'ELIGIBLE':
      return 'bg-brand-50 text-brand-800 border-brand-200';
    case 'MANUALLY_VERIFIED':
      return 'bg-ember-50 text-ember-800 border-ember-200';
    case 'Ineligible':
    case 'INELIGIBLE':
      return 'bg-rose-50 text-rose-800 border-rose-200';
    case 'Not supported by current integration':
      return 'bg-amber-50 text-amber-900 border-amber-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-300';
  }
}

export const MembershipAndEligibilitySection: React.FC<Props> = ({
  activeScreen,
  selectedPayerFilter,
  payers,
  patients,
  encounters,
  members,
  verifications,
  canManageMembers,
  canCheckEligibility,
  onRefresh,
  showToast,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [editingMember, setEditingMember] = useState<PrivateMemberPolicy | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const defaultPayer =
    selectedPayerFilter !== 'ALL' ? selectedPayerFilter : (payers[0]?.payerCode ?? '');

  const [memberForm, setMemberForm] = useState({
    patientId: '',
    payerCode: defaultPayer,
    memberNumber: '',
    policyNumber: '',
    schemeName: '',
    planName: '',
    memberRole: 'PRINCIPAL',
    principalMemberName: '',
    principalMemberNumber: '',
    relationshipToPrincipal: 'SELF',
    validFrom: '',
    validTo: '',
    evidenceSource: 'INSURANCE_CARD',
    notes: '',
  });

  const [correctionForm, setCorrectionForm] = useState({
    memberNumber: '',
    policyNumber: '',
    schemeName: '',
    planName: '',
    validFrom: '',
    validTo: '',
    status: 'ACTIVE',
    correctionReason: '',
  });

  const [eligForm, setEligForm] = useState({
    patientId: '',
    payerCode: defaultPayer,
    memberPolicyId: '',
    memberNumber: '',
    policyNumber: '',
    encounterId: '',
    intendedServiceArea: 'OPD_CONSULTATION',
    verificationMode: 'MANUAL' as 'ADAPTER' | 'MANUAL',
    manualOutcome: '',
    manualReference: '',
    evidenceSource: 'PAYER_PORTAL_MANUAL',
    evidenceDocumentRef: '',
    notes: '',
  });

  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      if (selectedPayerFilter !== 'ALL' && m.payerCode !== selectedPayerFilter) return false;
      if (!searchTerm.trim()) return true;
      const q = searchTerm.toLowerCase();
      return (
        m.patientName.toLowerCase().includes(q) ||
        m.memberNumber.toLowerCase().includes(q) ||
        (m.policyNumber ?? '').toLowerCase().includes(q)
      );
    });
  }, [members, selectedPayerFilter, searchTerm]);

  const patientPoliciesForElig = useMemo(() => {
    const pid = Number(eligForm.patientId);
    if (!pid) return [];
    return members.filter(
      (m) => m.patientId === pid && (!eligForm.payerCode || m.payerCode === eligForm.payerCode),
    );
  }, [members, eligForm.patientId, eligForm.payerCode]);

  const patientEncounters = useMemo(() => {
    const pid = Number(eligForm.patientId);
    if (!pid) return [];
    return encounters.filter((e) => Number(e.patientId) === pid);
  }, [encounters, eligForm.patientId]);

  const handleCreateMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await privateInsuranceApi.createMember({
        patientId: Number(memberForm.patientId),
        payerCode: memberForm.payerCode,
        memberNumber: memberForm.memberNumber,
        policyNumber: memberForm.policyNumber || null,
        schemeName: memberForm.schemeName || null,
        planName: memberForm.planName || null,
        memberRole: memberForm.memberRole,
        principalMemberName:
          memberForm.memberRole === 'DEPENDENT' ? memberForm.principalMemberName || null : null,
        principalMemberNumber:
          memberForm.memberRole === 'DEPENDENT' ? memberForm.principalMemberNumber || null : null,
        relationshipToPrincipal: memberForm.relationshipToPrincipal,
        validFrom: memberForm.validFrom || null,
        validTo: memberForm.validTo || null,
        evidenceSource: memberForm.evidenceSource,
        manualReviewNotes: memberForm.notes || null,
      });
      showToast(
        'Policy linked to JaliCare patient (labelled UNVERIFIED_LOCAL until eligibility is verified).',
        { tone: 'success' },
      );
      setShowMemberForm(false);
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create membership.', {
        tone: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;
    setSubmitting(true);
    try {
      await privateInsuranceApi.updateMember(editingMember.id, {
        memberNumber: correctionForm.memberNumber,
        policyNumber: correctionForm.policyNumber || null,
        schemeName: correctionForm.schemeName || null,
        planName: correctionForm.planName || null,
        validFrom: correctionForm.validFrom || null,
        validTo: correctionForm.validTo || null,
        status: correctionForm.status,
        correctionReason: correctionForm.correctionReason,
      });
      showToast('Audited policy correction saved.', { tone: 'success' });
      setEditingMember(null);
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update policy.', {
        tone: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckEligibility = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await privateInsuranceApi.checkEligibility({
        patientId: Number(eligForm.patientId),
        payerCode: eligForm.payerCode,
        memberPolicyId: eligForm.memberPolicyId ? Number(eligForm.memberPolicyId) : undefined,
        memberNumber: eligForm.memberNumber || undefined,
        policyNumber: eligForm.policyNumber || undefined,
        encounterId: eligForm.encounterId ? Number(eligForm.encounterId) : undefined,
        intendedServiceArea: eligForm.intendedServiceArea,
        verificationMode: eligForm.verificationMode,
        manualOutcome: eligForm.manualOutcome,
        manualReference: eligForm.manualReference || undefined,
        evidenceSource: eligForm.evidenceSource,
        evidenceDocumentRef: eligForm.evidenceDocumentRef || undefined,
        notes: eligForm.notes || undefined,
      });
      showToast(`Eligibility outcome: ${res.outcome} (${res.source})`, {
        tone: res.outcome === 'Eligible' ? 'success' : 'info',
      });
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Eligibility verification failed.', {
        tone: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  /* ============================================================
     SCREEN 3: MEMBER & POLICY MANAGEMENT
     ============================================================ */
  if (activeScreen === 'members') {
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-5 h-5 text-brand-600" />
              Member &amp; Policy Management
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Links existing JaliCare patients to Britam, PACIS, or other private policies without
              duplicating patient registration. Locally entered policy details remain{' '}
              <strong>UNVERIFIED_LOCAL</strong> until verified.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search patient or member no..."
                className="pl-9 pr-3 py-1.5 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            {canManageMembers && (
              <button
                type="button"
                onClick={() => setShowMemberForm((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700"
              >
                <Plus className="w-4 h-4" />
                Link Patient Policy
              </button>
            )}
          </div>
        </div>

        {showMemberForm && canManageMembers && (
          <form
            onSubmit={handleCreateMember}
            className="bg-white border border-brand-200 rounded-xl p-5 shadow-sm space-y-4"
          >
            <h3 className="text-sm font-bold text-slate-900">
              Link Existing JaliCare Patient to Insurer Policy
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  JaliCare Patient
                </label>
                <select
                  required
                  value={memberForm.patientId}
                  onChange={(e) => setMemberForm({ ...memberForm, patientId: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Select registered patient...</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {`${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()} (#{p.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Insurer</label>
                <select
                  value={memberForm.payerCode}
                  onChange={(e) => setMemberForm({ ...memberForm, payerCode: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {payers.map((py) => (
                    <option key={py.payerCode} value={py.payerCode}>
                      {py.payerName} ({py.payerCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Member Number
                </label>
                <input
                  required
                  value={memberForm.memberNumber}
                  onChange={(e) => setMemberForm({ ...memberForm, memberNumber: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="e.g. BRM-90482-00"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Policy / Corporate Scheme Number
                </label>
                <input
                  value={memberForm.policyNumber}
                  onChange={(e) => setMemberForm({ ...memberForm, policyNumber: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="POL-2026-CORP"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Scheme / Employer Name
                </label>
                <input
                  value={memberForm.schemeName}
                  onChange={(e) => setMemberForm({ ...memberForm, schemeName: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Corporate Medical Cover"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Plan / Benefit Tier
                </label>
                <input
                  value={memberForm.planName}
                  onChange={(e) => setMemberForm({ ...memberForm, planName: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Executive Inpatient + Outpatient"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Member Relationship
                </label>
                <select
                  value={memberForm.memberRole}
                  onChange={(e) => setMemberForm({ ...memberForm, memberRole: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="PRINCIPAL">Principal Member</option>
                  <option value="DEPENDENT">Dependent (Spouse / Child)</option>
                </select>
              </div>

              {memberForm.memberRole === 'DEPENDENT' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Principal Member Name
                    </label>
                    <input
                      value={memberForm.principalMemberName}
                      onChange={(e) =>
                        setMemberForm({ ...memberForm, principalMemberName: e.target.value })
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Principal Member Number
                    </label>
                    <input
                      value={memberForm.principalMemberNumber}
                      onChange={(e) =>
                        setMemberForm({ ...memberForm, principalMemberNumber: e.target.value })
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Valid From
                </label>
                <input
                  type="date"
                  value={memberForm.validFrom}
                  onChange={(e) => setMemberForm({ ...memberForm, validFrom: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Valid To</label>
                <input
                  type="date"
                  value={memberForm.validTo}
                  onChange={(e) => setMemberForm({ ...memberForm, validTo: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Evidence Source
                </label>
                <select
                  value={memberForm.evidenceSource}
                  onChange={(e) => setMemberForm({ ...memberForm, evidenceSource: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="INSURANCE_CARD">Physical / Digital Insurance Card</option>
                  <option value="EMPLOYER_LETTER">Employer / HR Undertaking Letter</option>
                  <option value="PAYER_PORTAL_MANUAL">Insurer Provider Portal</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowMemberForm(false)}
                className="px-3 py-1.5 text-sm text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-ember-500 text-navy-950 hover:bg-ember-600"
              >
                {submitting ? 'Saving...' : 'Register Policy Link'}
              </button>
            </div>
          </form>
        )}

        {editingMember && canManageMembers && (
          <form
            onSubmit={handleSaveCorrection}
            className="bg-white border-2 border-ember-300 rounded-xl p-5 shadow-sm space-y-4"
          >
            <h3 className="text-sm font-bold text-slate-900">
              Auditable Policy Correction — {editingMember.patientName} ({editingMember.payerCode})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Member Number
                </label>
                <input
                  required
                  value={correctionForm.memberNumber}
                  onChange={(e) =>
                    setCorrectionForm({ ...correctionForm, memberNumber: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Policy Number
                </label>
                <input
                  value={correctionForm.policyNumber}
                  onChange={(e) =>
                    setCorrectionForm({ ...correctionForm, policyNumber: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Status</label>
                <select
                  value={correctionForm.status}
                  onChange={(e) => setCorrectionForm({ ...correctionForm, status: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                  <option value="EXPIRED">EXPIRED</option>
                </select>
              </div>
              <div className="md:col-span-3">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Mandatory Audit Reason for Correction
                </label>
                <input
                  required
                  value={correctionForm.correctionReason}
                  onChange={(e) =>
                    setCorrectionForm({ ...correctionForm, correctionReason: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="e.g. Corrected member suffix from physical Britam card"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingMember(null)}
                className="px-3 py-1.5 text-sm text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-brand-600 text-white"
              >
                Save Audited Correction
              </button>
            </div>
          </form>
        )}

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Patient</th>
                  <th className="px-4 py-3">Insurer</th>
                  <th className="px-4 py-3">Member / Policy</th>
                  <th className="px-4 py-3">Role &amp; Plan</th>
                  <th className="px-4 py-3">Validity</th>
                  <th className="px-4 py-3">Verification State</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      No private insurance member policies linked yet.
                    </td>
                  </tr>
                ) : (
                  filteredMembers.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-semibold text-slate-900">{m.patientName}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-bold px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200">
                          {m.payerCode}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs font-semibold text-slate-800">
                          {m.memberNumber}
                        </div>
                        <div className="text-xs text-slate-500">{m.policyNumber ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        <div>{m.memberRole}</div>
                        <div className="text-slate-500">{m.planName ?? m.schemeName ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {m.validFrom ?? 'Open'} &rarr; {m.validTo ?? 'Open'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${verificationBadge(m.verificationStatus)}`}
                        >
                          {m.verificationStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {canManageMembers && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMember(m);
                              setCorrectionForm({
                                memberNumber: m.memberNumber,
                                policyNumber: m.policyNumber ?? '',
                                schemeName: m.schemeName ?? '',
                                planName: m.planName ?? '',
                                validFrom: m.validFrom ?? '',
                                validTo: m.validTo ?? '',
                                status: m.status,
                                correctionReason: '',
                              });
                            }}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-ember-700 hover:text-ember-800"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Correct
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  /* ============================================================
     SCREEN 4: ELIGIBILITY VERIFICATION
     ============================================================ */
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-brand-600" />
          Eligibility Verification — Live Adapter or Audited Manual Check
        </h2>
        <p className="text-sm text-slate-600 mt-0.5">
          Unavailable insurer APIs never report a patient as <em>Ineligible</em>, and manual checks
          are permanently labelled <strong>MANUAL_STAFF_VERIFICATION</strong> rather than live API
          confirmation.
        </p>

        {canCheckEligibility && (
          <form onSubmit={handleCheckEligibility} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  1. JaliCare Patient
                </label>
                <select
                  required
                  value={eligForm.patientId}
                  onChange={(e) =>
                    setEligForm({
                      ...eligForm,
                      patientId: e.target.value,
                      memberPolicyId: '',
                      encounterId: '',
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Select patient...</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {`${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()} (#{p.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  2. Insurer
                </label>
                <select
                  value={eligForm.payerCode}
                  onChange={(e) =>
                    setEligForm({ ...eligForm, payerCode: e.target.value, memberPolicyId: '' })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {payers.map((py) => (
                    <option key={py.payerCode} value={py.payerCode}>
                      {py.payerName} ({py.payerCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  3. Linked Policy (required)
                </label>
                <select
                  required
                  value={eligForm.memberPolicyId}
                  onChange={(e) => {
                    const selected = patientPoliciesForElig.find(
                      (pol) => String(pol.id) === e.target.value,
                    );
                    setEligForm({
                      ...eligForm,
                      memberPolicyId: e.target.value,
                      memberNumber: selected?.memberNumber ?? eligForm.memberNumber,
                      policyNumber: selected?.policyNumber ?? eligForm.policyNumber,
                    });
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Select the patient’s linked policy...</option>
                  {patientPoliciesForElig.map((pol) => (
                    <option key={pol.id} value={pol.id}>
                      {pol.memberNumber} — {pol.planName ?? pol.schemeName ?? pol.payerCode}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  4. Encounter / Visit Context (Optional)
                </label>
                <select
                  value={eligForm.encounterId}
                  onChange={(e) => setEligForm({ ...eligForm, encounterId: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Pre-visit / Front-desk check</option>
                  {patientEncounters.map((enc) => (
                    <option key={enc.id} value={enc.id}>
                      Encounter #{enc.id} ({enc.status ?? 'Active'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  5. Intended Service Category
                </label>
                <select
                  value={eligForm.intendedServiceArea}
                  onChange={(e) =>
                    setEligForm({ ...eligForm, intendedServiceArea: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {SERVICE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  6. Verification Method
                </label>
                <select
                  value={eligForm.verificationMode}
                  onChange={(e) =>
                    setEligForm({
                      ...eligForm,
                      verificationMode: e.target.value as 'ADAPTER' | 'MANUAL',
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="ADAPTER" disabled>
                    Payer API unavailable (not verified)
                  </option>
                  <option value="MANUAL">Record Manual Insurer Verification</option>
                </select>
              </div>
            </div>

            {eligForm.verificationMode === 'MANUAL' && (
              <div className="bg-ember-50/60 border border-ember-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Manual Verification Outcome
                  </label>
                  <select
                    value={eligForm.manualOutcome}
                    onChange={(e) => setEligForm({ ...eligForm, manualOutcome: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                  >
                    <option value="">Select the documented outcome</option>
                    <option value="Eligible">Eligible</option>
                    <option value="Ineligible">Ineligible</option>
                    <option value="Pending">Pending Insurer Confirmation</option>
                    <option value="Manual review required">Manual Review Required</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Insurer Portal / Call / Letter Reference (Required)
                  </label>
                  <input
                    required
                    value={eligForm.manualReference}
                    onChange={(e) => setEligForm({ ...eligForm, manualReference: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                    placeholder="e.g. BRITAM-PORTAL-REF-88412"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Evidence Channel
                  </label>
                  <select
                    value={eligForm.evidenceSource}
                    onChange={(e) => setEligForm({ ...eligForm, evidenceSource: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                  >
                    <option value="PAYER_PORTAL_MANUAL">Insurer Web Portal</option>
                    <option value="CALL_CENTRE_CONFIRMATION">
                      Insurer Care Desk / Call Reference
                    </option>
                    <option value="COVER_NOTE">Official Undertaking Email / Letter</option>
                  </select>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-brand-600 text-white hover:bg-brand-700"
              >
                {submitting
                  ? 'Verifying...'
                  : eligForm.verificationMode === 'ADAPTER'
                    ? 'Run Adapter Eligibility Check'
                    : 'Save Audited Manual Verification'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Verification History */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">
            Recent Eligibility Verifications &amp; Audit Trail
          </h3>
          <span className="text-xs text-slate-500">{verifications.length} records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Checked At</th>
                <th className="px-4 py-3">Insurer</th>
                <th className="px-4 py-3">Identifier Hint</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Outcome</th>
                <th className="px-4 py-3">Source &amp; Reference</th>
                <th className="px-4 py-3">Details / Next Step</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {verifications.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No eligibility verifications recorded yet.
                  </td>
                </tr>
              ) : (
                verifications.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {new Date(v.checkedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200">
                        {v.payerCode}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{v.identificationHint}</td>
                    <td className="px-4 py-3 text-xs">{v.intendedServiceArea ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full border ${verificationBadge(v.outcome)}`}
                      >
                        {v.outcome === 'Eligible' ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : v.outcome === 'Manual review required' ? (
                          <ShieldCheck className="w-3 h-3" />
                        ) : (
                          <AlertCircle className="w-3 h-3" />
                        )}
                        {v.outcome}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-semibold text-slate-800">{v.source}</div>
                      <div className="font-mono text-slate-500">
                        {v.payerReference ?? v.manualReference ?? '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 max-w-xs">
                      <div>{v.reason}</div>
                      {v.possibleSolution && (
                        <div className="text-amber-800 mt-0.5">{v.possibleSolution}</div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
