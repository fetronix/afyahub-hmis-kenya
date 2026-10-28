import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { payerHubApi, type FacilityPayer } from '../../api/payer-hub.client.ts';
import { shaEclaimsApi, type ShaConnectionStatusResponse } from '../../api/sha-eclaims.client.ts';
import {
  InsuranceClaim,
  Patient,
  BillingInvoice,
  ClaimableLine,
  Encounter,
  ServiceTariff,
} from '../../types/index.ts';
import {
  FileCheck2,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Shield,
  Send,
  X,
  Loader2,
  UserCheck,
  FileSpreadsheet,
  Landmark,
  Settings2,
  Network,
  ClipboardList,
} from 'lucide-react';
import { EligibilityAndBenefitsWorkspace } from './eclaims/EligibilityAndBenefitsWorkspace.tsx';
import { PreauthorizationWorkspace } from './eclaims/PreauthorizationWorkspace.tsx';
import { ClaimsLifecycleWorkspace } from './eclaims/ClaimsLifecycleWorkspace.tsx';
import { RemittanceAndAdminWorkspace } from './eclaims/RemittanceAndAdminWorkspace.tsx';

type InsuranceWorkspaceTab =
  | 'eligibility_benefits'
  | 'preauthorizations'
  | 'sha_eclaims'
  | 'remittances'
  | 'admin_rules'
  | 'connection_status'
  | 'manual_ledger';

/**
 * Insurance & SHA eClaims Module.
 *
 * Unifies SHA / DHA AfyaLink FHIR R4 eligibility verification, benefits
 * coverage validation, preauthorization, eClaims lifecycle, remittance
 * reconciliation, and payer rule governance alongside JaliCare's manual
 * invoice claims ledger.
 */
export const InsuranceClaimsModule: React.FC = () => {
  const {
    currentFacility,
    currentTenant,
    authenticatedUser,
    setSelectedPatient,
    setIsJourneyModalOpen,
    showToast,
    refreshKey,
    triggerRefresh,
  } = useHmis();

  const [activeWorkspace, setActiveWorkspace] =
    useState<InsuranceWorkspaceTab>('eligibility_benefits');
  const [shaConnection, setShaConnection] = useState<ShaConnectionStatusResponse | null>(null);
  const [claims, setClaims] = useState<InsuranceClaim[]>([]);
  const [availablePayers, setAvailablePayers] = useState<FacilityPayer[]>([]);
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [tariffs, setTariffs] = useState<ServiceTariff[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyClaimId, setBusyClaimId] = useState<number | null>(null);

  const permissionSet = new Set(authenticatedUser?.permissions ?? []);
  const isSuper = Boolean(
    authenticatedUser?.isSuperAdmin || authenticatedUser?.roles?.includes('SUPER_ADMIN'),
  );
  const hasPerm = (code: string) => isSuper || permissionSet.has(code);
  const notify = (msg: string) => showToast(msg);

  /* Draft modal */
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [lines, setLines] = useState<ClaimableLine[]>([]);
  const [selectedLineIds, setSelectedLineIds] = useState<number[]>([]);
  const [openClaimWarning, setOpenClaimWarning] = useState<string | null>(null);
  const [isLoadingLines, setIsLoadingLines] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [claimForm, setClaimForm] = useState({
    payerCode: '',
    policyNumber: '',
    preAuthCode: '',
    notes: '',
  });

  useEffect(() => {
    async function loadClaimsData() {
      setLoading(true);
      try {
        const [cList, invList, pList, encList, tariffList, connRes, catalogue] = await Promise.all([
          api.getClaims(currentFacility?.id).catch(() => [] as InsuranceClaim[]),
          api.getInvoices(currentFacility?.id).catch(() => [] as BillingInvoice[]),
          api.getPatients(currentTenant?.id, currentFacility?.id).catch(() => [] as Patient[]),
          currentFacility?.id
            ? api.getEncounters(undefined, currentFacility.id).catch(() => [] as Encounter[])
            : Promise.resolve([] as Encounter[]),
          currentFacility?.id
            ? api.getServiceTariffs(currentFacility.id).catch(() => [] as ServiceTariff[])
            : Promise.resolve([] as ServiceTariff[]),
          shaEclaimsApi.getConnectionStatus(currentFacility?.id).catch(() => null),
          currentFacility?.id
            ? payerHubApi.catalogue(currentFacility.id).catch(() => null)
            : Promise.resolve(null),
        ]);
        setClaims(cList);
        setInvoices(invList);
        setPatients(pList);
        setEncounters(encList);
        setTariffs(tariffList);
        setShaConnection(connRes);
        setAvailablePayers(catalogue?.providers.filter((p) => p.usableForNewClaims) ?? []);
      } catch (err) {
        console.error('Failed to load insurance claims:', err);
      } finally {
        setLoading(false);
      }
    }
    loadClaimsData();
  }, [currentTenant, currentFacility, refreshKey]);

  const resetDraftForm = () => {
    setSelectedInvoiceId('');
    setLines([]);
    setSelectedLineIds([]);
    setOpenClaimWarning(null);
    setClaimForm({
      payerCode: '',
      policyNumber: '',
      preAuthCode: '',
      notes: '',
    });
  };

  const openDraftModal = () => {
    resetDraftForm();
    setIsClaimModalOpen(true);
  };

  const loadInvoiceLines = async (invoiceId: string) => {
    setSelectedInvoiceId(invoiceId);
    setLines([]);
    setSelectedLineIds([]);
    setOpenClaimWarning(null);

    if (!invoiceId) return;

    setIsLoadingLines(true);

    try {
      const result = await api.getClaimableLines(Number(invoiceId), currentFacility?.id);

      setLines(result.lines);
      setSelectedLineIds(result.lines.map((line) => line.id));

      if (result.openClaims.length > 0) {
        setOpenClaimWarning(
          `This invoice already has an open claim (${result.openClaims
            .map((claim) => claim.claimNumber)
            .join(', ')}). Close it before drafting another.`,
        );
      }

      const patient = patients.find((p) => p.id === result.invoice.patientId);

      setClaimForm((prev) => ({
        ...prev,
        policyNumber: patient?.policyNumber || patient?.shaNumber || '',
      }));
    } catch (err: any) {
      showToast(`Could not load the invoice charges: ${err.message}`);
    } finally {
      setIsLoadingLines(false);
    }
  };

  const selectedInvoice = invoices.find((inv) => inv.id.toString() === selectedInvoiceId);

  const selectedCents = lines
    .filter((line) => selectedLineIds.includes(line.id))
    .reduce((sum, line) => sum + Math.round(Number(line.totalAmount ?? 0) * 100), 0);

  const balanceCents = selectedInvoice
    ? Math.round(Number(selectedInvoice.balanceAmount ?? 0) * 100)
    : 0;

  /* A claim can never ask for more than the patient still owes. */
  const claimableCents = Math.min(selectedCents, balanceCents);

  const toggleLine = (lineId: number) => {
    setSelectedLineIds((prev) =>
      prev.includes(lineId) ? prev.filter((id) => id !== lineId) : [...prev, lineId],
    );
  };

  const handleDraftClaim = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedInvoiceId || selectedLineIds.length === 0 || !claimForm.payerCode) return;

    setIsDrafting(true);

    try {
      const result = await api.draftClaim({
        invoiceId: Number(selectedInvoiceId),
        lineItemIds: selectedLineIds,
        payerCode: claimForm.payerCode,
        policyNumber: claimForm.policyNumber || undefined,
        preAuthCode: claimForm.preAuthCode || undefined,
        notes: claimForm.notes || undefined,
        facilityId: currentFacility?.id,
      });

      showToast(
        `Claim ${result.claim.claimNumber} drafted for KES ${Number(
          result.claim.claimAmount,
        ).toLocaleString()}.`,
      );

      setIsClaimModalOpen(false);
      resetDraftForm();
      triggerRefresh();
    } catch (err: any) {
      showToast(`Could not draft the claim: ${err.message}`);
    } finally {
      setIsDrafting(false);
    }
  };

  const handleSubmitClaim = async (claim: InsuranceClaim) => {
    const reference = window.prompt(
      'Enter the reference from your manual submission to the payer. This system does not transmit the claim.',
    );
    if (!reference?.trim()) return;
    setBusyClaimId(claim.id);

    try {
      await api.submitClaim(claim.id, currentFacility?.id, reference.trim());
      showToast(
        `Manual dispatch for ${claim.claimNumber} recorded. This does not mean the payer accepted or paid it.`,
      );
      triggerRefresh();
    } catch (err: any) {
      showToast(`Could not update the claim: ${err.message}`);
    } finally {
      setBusyClaimId(null);
    }
  };

  const handleAdjudicate = async (claim: InsuranceClaim) => {
    const entered = window.prompt(
      `Amount approved by ${claim.payerName} in KES (maximum ${Number(
        claim.claimAmount,
      ).toLocaleString()}). Enter 0 if the claim was declined.`,
      Number(claim.claimAmount).toFixed(2),
    );

    if (entered === null) return;

    const trimmed = entered.trim();

    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
      showToast('Enter the approved amount as a number, for example 4500.00.');
      return;
    }

    setBusyClaimId(claim.id);

    try {
      await api.adjudicateClaim(claim.id, trimmed, undefined, currentFacility?.id);
      showToast(
        Number(trimmed) > 0
          ? `Adjudication recorded: KES ${Number(trimmed).toLocaleString()} approved.`
          : 'Adjudication recorded: claim declined.',
      );
      triggerRefresh();
    } catch (err: any) {
      showToast(`Could not record the adjudication: ${err.message}`);
    } finally {
      setBusyClaimId(null);
    }
  };

  const handleSettle = async (claim: InsuranceClaim) => {
    const receiptId = window.prompt(
      'Enter the ID of the existing billing receipt for this insurer and invoice. No payment will be created.',
    );
    if (!receiptId) return;
    const reference = window.prompt(
      'Enter the actual remittance or bank reference recorded on that receipt.',
    );
    if (!reference) return;
    setBusyClaimId(claim.id);
    try {
      const result = await api.settleClaim(
        claim.id,
        currentFacility?.id,
        Number(receiptId),
        reference,
      );
      showToast(
        `Claim matched to existing receipt ${result.payment.receiptNumber}. The invoice was not changed.`,
      );
      triggerRefresh();
    } catch (err: any) {
      showToast(`Could not match the receipt: ${err.message}`);
    } finally {
      setBusyClaimId(null);
    }
  };

  const getPatient = (patientId: number) => patients.find((p) => p.id === patientId);

  const totalClaimValue = claims.reduce((acc, c) => acc + Number(c.claimAmount || 0), 0);
  const totalSettledValue = claims
    .filter((claim) => claim.status === 'Settled')
    .reduce((total, claim) => total + Number(claim.approvedAmount || 0), 0);
  const awaitingAdjudication = claims.filter((claim) => claim.status === 'Submitted').length;

  const statusClass = (status: string) => {
    if (status === 'Settled') return 'bg-emerald-50 text-emerald-800';
    if (status === 'Approved') return 'bg-teal-50 text-teal-800';
    if (status === 'Rejected') return 'bg-rose-50 text-rose-800';
    if (status === 'Submitted') return 'bg-amber-50 text-amber-800';

    return 'bg-slate-100 text-slate-700';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 rounded-card border border-hair bg-surface p-5 shadow-card">
        <div>
          <span className="eyebrow text-brand-700">Kenya Digital Health & Payer Revenue</span>
          <h1 className="font-display text-[1.35rem] leading-tight tracking-tight text-ink mt-0.5">
            Insurance & SHA eClaims
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Verify SHA beneficiary eligibility, validate approved service coverage, manage
            preauthorizations, assemble FHIR R4 eClaims, reconcile remittances, or manage manual
            private/portal claims.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {shaConnection && (
            <button
              type="button"
              onClick={() => setActiveWorkspace('connection_status')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border flex items-center gap-1.5 ${
                shaConnection.connection.isSimulated || !shaConnection.connection.enabled
                  ? 'bg-ember-50 text-copper-700 border-ember-200'
                  : 'bg-brand-50 text-brand-700 border-brand-200'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              {shaConnection.connection.isSimulated
                ? 'SHA Mode: Sandbox Simulation'
                : shaConnection.connection.enabled
                  ? `SHA Mode: ${shaConnection.connection.mode.toUpperCase()}`
                  : 'SHA Gateway: Credentials Required'}
            </button>
          )}
          {activeWorkspace === 'manual_ledger' && (
            <button
              onClick={openDraftModal}
              className="btn-accent text-xs flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Draft Manual Claim</span>
            </button>
          )}
        </div>
      </div>

      {/* Primary Workspace Navigation */}
      <div className="flex flex-wrap items-center gap-2 bg-white p-2 rounded-xl border border-slate-200 shadow-xs">
        {(
          [
            {
              id: 'eligibility_benefits',
              label: 'Eligibility & Benefits',
              icon: UserCheck,
            },
            {
              id: 'preauthorizations',
              label: 'Preauthorizations',
              icon: Shield,
            },
            {
              id: 'sha_eclaims',
              label: 'SHA eClaims',
              icon: FileSpreadsheet,
            },
            {
              id: 'remittances',
              label: 'Remittances & Reconciliation',
              icon: Landmark,
            },
            {
              id: 'admin_rules',
              label: 'Mappings & Benefit Rules',
              icon: Settings2,
            },
            {
              id: 'connection_status',
              label: 'SHA Gateway Status',
              icon: Network,
            },
            {
              id: 'manual_ledger',
              label: 'Manual Claims Ledger',
              icon: ClipboardList,
            },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeWorkspace === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveWorkspace(tab.id)}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                active ? 'bg-brand-600 text-white shadow-xs' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeWorkspace === 'eligibility_benefits' && (
        <EligibilityAndBenefitsWorkspace
          facilityId={currentFacility?.id ?? null}
          patients={patients}
          encounters={encounters}
          tariffs={tariffs}
          canCheckEligibility={hasPerm('insurance.sha.eligibility.check')}
          canValidateBenefits={hasPerm('insurance.sha.benefits.validate')}
          showToast={notify}
        />
      )}

      {activeWorkspace === 'preauthorizations' && (
        <PreauthorizationWorkspace
          facilityId={currentFacility?.id ?? null}
          patients={patients}
          canCreatePreauth={hasPerm('insurance.sha.preauthorization.create')}
          showToast={notify}
        />
      )}

      {activeWorkspace === 'sha_eclaims' && (
        <ClaimsLifecycleWorkspace
          facilityId={currentFacility?.id ?? null}
          invoices={invoices}
          patients={patients}
          canPrepare={hasPerm('insurance.sha.claims.prepare')}
          canSubmit={hasPerm('insurance.sha.claims.submit')}
          canResubmit={hasPerm('insurance.sha.claims.resubmit')}
          canAdjudicate={hasPerm('insurance.sha.reconciliation.manage')}
          showToast={notify}
        />
      )}

      {activeWorkspace === 'remittances' && (
        <RemittanceAndAdminWorkspace
          facilityId={currentFacility?.id ?? null}
          section="remittance"
          canReconcile={hasPerm('insurance.sha.reconciliation.manage')}
          canManageConfig={hasPerm('insurance.sha.configuration.manage')}
          showToast={notify}
        />
      )}

      {activeWorkspace === 'admin_rules' && (
        <RemittanceAndAdminWorkspace
          facilityId={currentFacility?.id ?? null}
          section="admin"
          canReconcile={hasPerm('insurance.sha.reconciliation.manage')}
          canManageConfig={hasPerm('insurance.sha.configuration.manage')}
          showToast={notify}
        />
      )}

      {activeWorkspace === 'connection_status' && (
        <RemittanceAndAdminWorkspace
          facilityId={currentFacility?.id ?? null}
          section="connection"
          canReconcile={hasPerm('insurance.sha.reconciliation.manage')}
          canManageConfig={hasPerm('insurance.sha.configuration.manage')}
          showToast={notify}
        />
      )}

      {activeWorkspace === 'manual_ledger' && (
        <>
          {/*
            Stated plainly, on the manual ledger itself. A facility should never
            believe manual ledger claims are being transmitted when they are not.
          */}
          <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 text-xs text-navy-900 flex items-start gap-2.5">
            <Shield className="w-4 h-4 shrink-0 mt-0.5 text-brand-700" />
            <div className="space-y-1">
              <div className="font-semibold">No live SHA connection on Manual Claims Ledger</div>
              <p className="text-slate-700">
                This manual ledger tab does not transmit claims to SHA or any private payer, and
                does not verify membership. Use the <strong>SHA eClaims</strong> tabs above for
                AfyaLink FHIR eClaims workflows, or draft manual portal claims below and reconcile
                approved amounts back against the invoice.
              </p>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
              <span className="text-2xs uppercase text-slate-400 font-semibold tracking-wider">
                Claims on record
              </span>
              <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
                {claims.length}
              </div>
              <div className="text-2xs text-slate-500 mt-1">
                Total claimed: KES {totalClaimValue.toLocaleString()}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
              <span className="text-2xs uppercase text-emerald-700 font-semibold tracking-wider">
                Settled and posted
              </span>
              <div className="text-2xl font-bold font-mono text-emerald-700 mt-1">
                KES {totalSettledValue.toLocaleString()}
              </div>
              <div className="text-2xs text-slate-500 mt-1">Money actually applied to invoices</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
              <span className="text-2xs uppercase text-amber-700 font-semibold tracking-wider">
                Awaiting adjudication
              </span>
              <div className="text-2xl font-bold font-mono text-amber-700 mt-1">
                {awaitingAdjudication}
              </div>
              <div className="text-2xs text-slate-500 mt-1">
                Submitted, no decision recorded yet
              </div>
            </div>
          </div>

          {/* Claims Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
              <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase flex items-center gap-1.5">
                <FileCheck2 className="w-4 h-4 text-teal-700" />
                <span>Claims ({claims.length})</span>
              </h2>
              <span className="text-2xs text-slate-400">Recorded locally</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50/80 text-2xs text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Claim #</th>
                    <th className="px-4 py-2.5 font-medium">Patient</th>
                    <th className="px-4 py-2.5 font-medium">Payer</th>
                    <th className="px-4 py-2.5 font-medium text-right">Claimed</th>
                    <th className="px-4 py-2.5 font-medium text-right">Approved</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {claims.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-slate-400 font-sans">
                        {loading ? 'Loading claims…' : 'No claims drafted yet.'}
                      </td>
                    </tr>
                  )}

                  {claims.map((claim) => {
                    const patient = getPatient(claim.patientId);
                    const busy = busyClaimId === claim.id;

                    return (
                      <tr key={claim.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-bold text-teal-800">{claim.claimNumber}</td>
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
                            <span>Patient #{claim.patientId}</span>
                          )}
                          <span className="text-2xs text-slate-400 font-mono">{patient?.mrn}</span>
                        </td>
                        <td className="px-4 py-3 font-sans text-slate-700">
                          <div>{claim.payerName}</div>
                          <div className="text-2xs text-slate-400">
                            {claim.policyNumber || 'No policy number'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">
                          KES {Number(claim.claimAmount).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-700">
                          {Number(claim.approvedAmount || 0) > 0
                            ? `KES ${Number(claim.approvedAmount).toLocaleString()}`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 font-sans">
                          <span
                            className={`px-2 py-0.5 rounded text-2xs font-medium ${statusClass(
                              claim.status,
                            )}`}
                          >
                            {claim.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-sans">
                          {busy ? (
                            <span className="inline-flex items-center gap-1 text-2xs text-slate-500">
                              <Loader2 className="w-3 h-3 animate-spin" /> working
                            </span>
                          ) : claim.status === 'Draft' ? (
                            <button
                              onClick={() => handleSubmitClaim(claim)}
                              className="px-2.5 py-1 text-2xs font-semibold border border-slate-200 rounded hover:bg-slate-50 inline-flex items-center gap-1"
                            >
                              <Send className="w-3 h-3" /> Mark submitted
                            </button>
                          ) : claim.status === 'Submitted' ? (
                            <button
                              onClick={() => handleAdjudicate(claim)}
                              className="px-2.5 py-1 text-2xs font-semibold border border-teal-200 text-teal-800 rounded hover:bg-teal-50 inline-flex items-center gap-1"
                            >
                              <FileCheck2 className="w-3 h-3" /> Record decision
                            </button>
                          ) : claim.status === 'Approved' ? (
                            <button
                              onClick={() => handleSettle(claim)}
                              className="px-2.5 py-1 text-2xs font-semibold bg-emerald-700 text-white rounded hover:bg-emerald-800 inline-flex items-center gap-1"
                            >
                              <CheckCircle2 className="w-3 h-3" /> Settle to invoice
                            </button>
                          ) : claim.status === 'Settled' ? (
                            <span className="text-2xs text-emerald-700 font-medium">
                              Money posted
                            </span>
                          ) : (
                            <span className="text-2xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* DRAFT CLAIM MODAL */}
          {isClaimModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4">
              <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
                <div className="border-b border-slate-200 pb-3 flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Draft a Claim</h3>
                    <p className="text-2xs text-slate-500">
                      Choose the invoice and the charges the payer should cover.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsClaimModalOpen(false)}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleDraftClaim} className="space-y-4">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Invoice *</label>
                    <select
                      required
                      value={selectedInvoiceId}
                      onChange={(e) => loadInvoiceLines(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-md"
                    >
                      <option value="">Select an invoice…</option>
                      {invoices
                        .filter((inv) => Number(inv.balanceAmount) > 0 && inv.status !== 'Void')
                        .map((inv) => {
                          const patient = getPatient(inv.patientId);

                          return (
                            <option key={inv.id} value={inv.id}>
                              {inv.invoiceNumber} —{' '}
                              {patient
                                ? `${patient.firstName} ${patient.lastName}`
                                : `Patient #${inv.patientId}`}{' '}
                              · KES {Number(inv.balanceAmount).toLocaleString()} due
                            </option>
                          );
                        })}
                    </select>
                  </div>

                  {openClaimWarning && (
                    <div className="bg-amber-50 border border-amber-300 rounded-md p-2.5 text-2xs text-amber-900 flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{openClaimWarning}</span>
                    </div>
                  )}

                  {isLoadingLines && (
                    <div className="text-2xs text-slate-500">Loading invoice charges…</div>
                  )}

                  {lines.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-medium text-slate-700">
                          Charges to claim ({selectedLineIds.length} of {lines.length})
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedLineIds(
                              selectedLineIds.length === lines.length ? [] : lines.map((l) => l.id),
                            )
                          }
                          className="text-2xs text-teal-700 hover:underline"
                        >
                          {selectedLineIds.length === lines.length ? 'Clear all' : 'Select all'}
                        </button>
                      </div>

                      <div className="border border-slate-200 rounded-md divide-y divide-slate-100 max-h-56 overflow-y-auto">
                        {lines.map((line) => (
                          <label
                            key={line.id}
                            className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedLineIds.includes(line.id)}
                              onChange={() => toggleLine(line.id)}
                              className="rounded border-slate-300"
                            />
                            <span className="flex-1 text-slate-800">{line.description}</span>
                            <span className="font-mono text-slate-600">
                              KES {Number(line.totalAmount ?? 0).toLocaleString()}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {lines.length > 0 && (
                    <div className="bg-slate-50 border border-slate-200 rounded-md p-3 space-y-1">
                      <div className="flex items-center justify-between font-semibold text-slate-900">
                        <span>Claim amount</span>
                        <span className="font-mono">
                          KES {(claimableCents / 100).toLocaleString()}
                        </span>
                      </div>
                      {balanceCents < selectedCents && (
                        <p className="text-2xs text-amber-800">
                          The selected charges total KES {(selectedCents / 100).toLocaleString()},
                          but only KES {(balanceCents / 100).toLocaleString()} is still outstanding.
                          The claim is capped at what the patient owes.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Payer scheme</label>
                      <select
                        value={claimForm.payerCode}
                        onChange={(e) => setClaimForm({ ...claimForm, payerCode: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-md"
                        required
                      >
                        <option value="">Select an enabled payer</option>
                        {availablePayers.map((payer) => (
                          <option key={payer.id} value={payer.code}>
                            {payer.displayName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        Policy / member number
                      </label>
                      <input
                        type="text"
                        value={claimForm.policyNumber}
                        onChange={(e) =>
                          setClaimForm({ ...claimForm, policyNumber: e.target.value })
                        }
                        placeholder="Leave blank if unknown"
                        className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                        maxLength={80}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        Pre-authorisation code
                      </label>
                      <input
                        type="text"
                        value={claimForm.preAuthCode}
                        onChange={(e) =>
                          setClaimForm({ ...claimForm, preAuthCode: e.target.value })
                        }
                        placeholder="Only if the payer issued one"
                        className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                        maxLength={80}
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Notes</label>
                      <input
                        type="text"
                        value={claimForm.notes}
                        onChange={(e) => setClaimForm({ ...claimForm, notes: e.target.value })}
                        placeholder="Optional"
                        className="w-full px-3 py-2 border border-slate-200 rounded-md"
                        maxLength={200}
                      />
                    </div>
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
                      disabled={
                        isDrafting ||
                        !!openClaimWarning ||
                        !selectedInvoiceId ||
                        !claimForm.payerCode ||
                        selectedLineIds.length === 0 ||
                        claimableCents <= 0
                      }
                      className="px-4 py-1.5 bg-teal-700 text-white rounded-md font-semibold hover:bg-teal-800 disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      {isDrafting ? 'Drafting…' : 'Draft claim'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
