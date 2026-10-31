import { FormField, PrimaryButton, SecondaryButton } from '../ui/controls.tsx';
import { AlertBanner, ErrorState } from '../ui/feedback.tsx';
import { Modal } from '../ui/overlays.tsx';
import { PageHeader } from '../ui/layout.tsx';
import React, { useState, useEffect, useRef } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { RadiologyOrder, Patient, Encounter, FacilityService } from '../../types/index.ts';
import { Scan, CheckCircle2, Clock, UserCheck, Plus, FileText } from 'lucide-react';

export const RadiologyModule: React.FC = () => {
  const {
    currentTenant,
    currentFacility,
    currentUser,
    setSelectedPatient,
    setIsJourneyModalOpen,
    showToast,
    refreshKey,
    triggerRefresh,
  } = useHmis();
  const [orders, setOrders] = useState<RadiologyOrder[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [examinations, setExaminations] = useState<FacilityService[]>([]);
  const [examSearch, setExamSearch] = useState('');
  const [patientEncounters, setPatientEncounters] = useState<Encounter[]>([]);
  const [encountersError, setEncountersError] = useState(false);
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const submittingRequestRef = useRef(false);
  const requestKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const [catalogueError, setCatalogueError] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<RadiologyOrder | null>(null);
  const selectedOrderRef = useRef<RadiologyOrder | null>(null);
  const [patientLookup, setPatientLookup] = useState<{
    id: number;
    patient: Patient | null;
    failed: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadAttempt, setReloadAttempt] = useState(0);

  // New Request Form Modal
  const [isNewReqModalOpen, setIsNewReqModalOpen] = useState(false);
  const [reqForm, setReqForm] = useState({
    patientId: '',
    encounterId: '',
    modality: 'X-Ray',
    facilityServiceId: '',
    procedureName: '',
    clinicalIndication: '',
  });

  // Report Editor State
  const [reportFindings, setReportFindings] = useState('');
  const [reportImpression, setReportImpression] = useState('');

  const selectOrder = (order: RadiologyOrder) => {
    selectedOrderRef.current = order;
    setSelectedOrder(order);
    setReportFindings(order.radiologistFindings || '');
    setReportImpression(order.impression || '');
  };

  useEffect(() => {
    let active = true;
    setExaminations([]);
    setCatalogueError(false);
    if (currentFacility?.id) {
      Promise.resolve()
        .then(() => api.getAvailableFacilityServices(currentFacility.id, { category: 'RADIOLOGY' }))
        .then((rows) => {
          if (active) setExaminations(rows);
        })
        .catch(() => {
          if (active) setCatalogueError(true);
        });
    }
    return () => {
      active = false;
    };
  }, [currentFacility?.id, refreshKey]);

  useEffect(() => {
    let active = true;
    async function loadRadiology() {
      if (!currentTenant?.id || !currentFacility?.id) {
        setOrders([]);
        setPatients([]);
        selectedOrderRef.current = null;
        setSelectedOrder(null);
        setLoadError('Select an authorized facility to load radiology.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError('');
      try {
        const [rList, pList] = await Promise.all([
          api.getRadiologyOrders(currentFacility.id),
          api.getPatients(currentTenant.id, currentFacility.id),
        ]);
        if (!active) return;
        setOrders(rList);
        setPatients(pList);
        setReqForm((previous) => ({
          ...previous,
          patientId: pList.some((patient) => String(patient.id) === previous.patientId)
            ? previous.patientId
            : '',
        }));
        const currentSelection = selectedOrderRef.current;
        if (rList.length > 0 && !currentSelection) selectOrder(rList[0]);
        if (currentSelection && !rList.some((order) => order.id === currentSelection.id)) {
          selectedOrderRef.current = null;
          setSelectedOrder(null);
        }
      } catch (err) {
        if (!active) return;
        setOrders([]);
        setPatients([]);
        selectedOrderRef.current = null;
        setSelectedOrder(null);
        setLoadError(err instanceof Error ? err.message : 'Unable to load radiology records.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadRadiology();
    return () => {
      active = false;
    };
  }, [currentTenant?.id, currentFacility?.id, refreshKey, reloadAttempt]);

  useEffect(() => {
    let active = true;
    const patientId = selectedOrder?.patientId;
    if (!patientId || patients.some((patient) => patient.id === patientId))
      return () => {
        active = false;
      };
    void api
      .getPatient(patientId)
      .then((patient) => {
        if (active) setPatientLookup({ id: patientId, patient, failed: false });
      })
      .catch(() => {
        if (active) setPatientLookup({ id: patientId, patient: null, failed: true });
      });
    return () => {
      active = false;
    };
  }, [selectedOrder?.patientId, patients]);

  useEffect(() => {
    let current = true;
    setPatientEncounters([]);
    setEncountersError(false);
    if (isNewReqModalOpen && reqForm.patientId && currentFacility?.id) {
      Promise.resolve()
        .then(() => api.getEncounters(Number(reqForm.patientId), currentFacility.id))
        .then((rows) => {
          if (current)
            setPatientEncounters(rows.filter((row) => row.status?.toLowerCase() !== 'cancelled'));
        })
        .catch(() => {
          if (current) setEncountersError(true);
        });
    }
    return () => {
      current = false;
    };
  }, [isNewReqModalOpen, reqForm.patientId, currentFacility?.id]);

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqForm.patientId || submittingRequestRef.current) return;

    if (!currentFacility?.id) {
      showToast('Select a facility before saving this record.', { tone: 'warning' });
      return;
    }

    const payload = {
      tenantId: currentFacility.tenantId,
      facilityId: currentFacility.id,
      patientId: Number(reqForm.patientId),
      ...(reqForm.encounterId ? { encounterId: Number(reqForm.encounterId) } : {}),
      modality: reqForm.modality,
      ...(reqForm.facilityServiceId
        ? { facilityServiceId: Number(reqForm.facilityServiceId) }
        : {}),
      procedureName: reqForm.procedureName,
      clinicalIndication: reqForm.clinicalIndication,
      status: 'Requested',
      orderedBy: currentUser.name,
    };
    const fingerprint = JSON.stringify(payload);
    if (requestKey.current?.fingerprint !== fingerprint)
      requestKey.current = { fingerprint, key: crypto.randomUUID() };
    submittingRequestRef.current = true;
    setSubmittingRequest(true);
    try {
      const result = await api.createRadiologyOrder({
        ...payload,
        idempotencyKey: requestKey.current.key,
      });
      showToast(
        result.idempotentReplay
          ? 'Existing imaging request recovered. No second order was created.'
          : 'Radiology imaging request created. Billing is assessed when reported.',
      );
      requestKey.current = null;
      setIsNewReqModalOpen(false);
      setReqForm({
        patientId: '',
        encounterId: '',
        modality: 'X-Ray',
        facilityServiceId: '',
        procedureName: '',
        clinicalIndication: '',
      });
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    } finally {
      submittingRequestRef.current = false;
      setSubmittingRequest(false);
    }
  };

  const handleSaveReport = async () => {
    if (!selectedOrder) return;
    try {
      const reported = await api.updateRadiologyReport(selectedOrder.id, {
        findings: reportFindings,
        impression: reportImpression,
        reportedBy: currentUser.name,
      });

      if (reported.billing?.charged)
        showToast(
          `Report saved; ${reported.billing.invoiceNumber} billed KES ${reported.billing.totalAmount}.`,
        );
      else if (reported.billing?.reason === 'DUPLICATE')
        showToast('Report saved; an imaging charge already exists.');
      else
        showToast(
          `Report saved; billing not confirmed: ${reported.billing?.message ?? 'review the unresolved queue.'}`,
        );
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const getPatient = (patientId: number) => {
    return patients.find((p) => p.id === patientId);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader>
        <div>
          <h1 className="ui-page-title">Diagnostic Radiology & Medical Imaging</h1>
          <p className="ui-page-description">
            X-ray, ultrasound, CT and MRI requests and recorded imaging reports.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <PrimaryButton onClick={() => setIsNewReqModalOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            <span>New Imaging Request</span>
          </PrimaryButton>
        </div>
      </PageHeader>

      {loadError && (
        <ErrorState
          message={loadError}
          onRetry={() => setReloadAttempt((attempt) => attempt + 1)}
        />
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Imaging Orders Queue (1 col) */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-900 tracking-tight uppercase flex items-center gap-1.5">
              <Scan className="w-4 h-4 text-teal-700" />
              <span>
                Imaging Requests ({loading ? 'Loading…' : loadError ? 'Unavailable' : orders.length}
                )
              </span>
            </h2>
            <span className="text-2xs text-slate-400 font-mono">Modality Worklist</span>
          </div>

          <div className="p-3 space-y-2 flex-1 overflow-y-auto max-h-[600px]">
            {orders.map((ord) => {
              const patient = getPatient(ord.patientId);
              const isSelected = selectedOrder?.id === ord.id;

              return (
                <button
                  type="button"
                  key={ord.id}
                  onClick={() => selectOrder(ord)}
                  aria-pressed={isSelected}
                  className={`w-full text-left p-3 rounded-lg border cursor-pointer transition-all ${
                    isSelected
                      ? 'border-teal-700 bg-teal-50/40'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900 text-xs">
                      {ord.procedureName}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-3xs font-medium ${
                        ord.status === 'Reported'
                          ? 'bg-emerald-50 text-emerald-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {ord.status}
                    </span>
                  </div>

                  <div className="text-2xs text-slate-600 mt-1">
                    Patient:{' '}
                    <strong>
                      {patient
                        ? `${patient.firstName} ${patient.lastName}`
                        : `Patient #${ord.patientId}`}
                    </strong>
                    {patient?.mrn ? ` (${patient.mrn})` : ''}
                  </div>

                  <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-100 text-3xs text-slate-400 font-mono">
                    <span className="px-1.5 py-0.2 bg-slate-100 rounded text-slate-700 font-semibold">
                      {ord.modality}
                    </span>
                    <span>{new Date(ord.createdAt).toLocaleDateString()}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Two Columns: Radiologist Report Editor (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          {selectedOrder ? (
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs text-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    {selectedOrder.procedureName}
                  </h2>
                  <div className="text-2xs text-slate-500 mt-0.5">
                    Modality: <strong>{selectedOrder.modality}</strong> · Ordered by:{' '}
                    <strong>{selectedOrder.orderedBy || 'Not recorded'}</strong>
                  </div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded text-2xs font-semibold ${
                    selectedOrder.status === 'Reported'
                      ? 'bg-emerald-50 text-emerald-800'
                      : 'bg-amber-50 text-amber-800'
                  }`}
                >
                  {selectedOrder.status}
                </span>
              </div>

              {/* Patient info */}
              {(() => {
                const lookup = patientLookup?.id === selectedOrder.patientId ? patientLookup : null;
                const pat = getPatient(selectedOrder.patientId) ?? lookup?.patient ?? null;
                return (
                  <div className="bg-slate-50 p-3 rounded-lg flex flex-wrap gap-2 items-center justify-between text-2xs">
                    <div>
                      Patient:{' '}
                      <strong className="text-slate-800">
                        {pat
                          ? `${pat.firstName} ${pat.lastName}`
                          : `Patient #${selectedOrder.patientId}`}
                      </strong>{' '}
                      {pat
                        ? `(${[pat.mrn, pat.gender, pat.dateOfBirth].filter(Boolean).join(' · ')})`
                        : lookup?.failed
                          ? '(details unavailable)'
                          : '(loading details…)'}
                    </div>
                    <div>
                      Clinical Indication:{' '}
                      <strong className="text-slate-700">
                        {selectedOrder.clinicalIndication || 'Not recorded'}
                      </strong>
                    </div>
                  </div>
                );
              })()}

              <AlertBanner tone="info" className="text-xs">
                <strong>Imaging connection not verified.</strong> This screen records requests and
                text reports; it does not verify a PACS connection or the presence of a DICOM study.
                Use the facility's authorized imaging viewer to review images.
              </AlertBanner>

              {/* Radiologist Report Editor */}
              <div className="space-y-3 pt-2">
                <div>
                  <label
                    htmlFor="radiology-findings"
                    className="block font-medium text-slate-700 mb-1"
                  >
                    Radiological Findings
                  </label>
                  <textarea
                    id="radiology-findings"
                    rows={4}
                    value={reportFindings}
                    onChange={(e) => setReportFindings(e.target.value)}
                    placeholder="Detailed anatomical observations, bones, soft tissues, lung fields, cardiac silhouette..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700"
                  />
                </div>

                <div>
                  <label
                    htmlFor="radiology-impression"
                    className="block font-medium text-slate-700 mb-1"
                  >
                    Impression / Radiologist Conclusion
                  </label>
                  <textarea
                    id="radiology-impression"
                    rows={2}
                    value={reportImpression}
                    onChange={(e) => setReportImpression(e.target.value)}
                    placeholder="Definitive radiological diagnosis..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-teal-700 font-semibold"
                  />
                </div>

                <div className="pt-2 flex flex-wrap gap-3 items-center justify-between border-t border-slate-100">
                  <span className="text-2xs text-slate-400">
                    Sign-off: <strong>{currentUser.name}</strong> ({currentUser.role})
                  </span>
                  <button
                    onClick={handleSaveReport}
                    className="px-5 py-2 bg-teal-700 text-white rounded-lg font-semibold hover:bg-teal-800 transition-colors shadow-xs"
                  >
                    Save Imaging Report
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-xs text-slate-400">
              Select an imaging order from the worklist to review and transcribe report.
            </div>
          )}
        </div>
      </div>

      {/* New requests remain explicit; no patient or clinical history is pre-filled. */}
      <Modal
        open={isNewReqModalOpen}
        onClose={() => setIsNewReqModalOpen(false)}
        title="Request Diagnostic Medical Imaging"
        actions={
          <>
            <SecondaryButton onClick={() => setIsNewReqModalOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton type="submit" form="radiology-request-form" disabled={submittingRequest}>
              {submittingRequest ? 'Submitting…' : 'Send Imaging Request'}
            </PrimaryButton>
          </>
        }
      >
        <p className="mb-4 text-xs text-muted">
          Order X-ray, ultrasound, CT or MRI with a clinical indication.
        </p>
        <form id="radiology-request-form" onSubmit={handleCreateOrder} className="space-y-4">
          <FormField label="Select patient *" htmlFor="radiology-patient">
            <select
              id="radiology-patient"
              required
              value={reqForm.patientId}
              onChange={(event) =>
                setReqForm({ ...reqForm, patientId: event.target.value, encounterId: '' })
              }
              className="field-input"
            >
              <option value="">Select a patient</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.firstName} {patient.lastName} ({patient.mrn} · {patient.payerType})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Link an encounter" htmlFor="radiology-encounter">
            <select
              id="radiology-encounter"
              value={reqForm.encounterId}
              onChange={(event) => setReqForm({ ...reqForm, encounterId: event.target.value })}
              className="field-input"
            >
              <option value="">Standalone request — no encounter linked</option>
              {patientEncounters.map((encounter) => (
                <option key={encounter.id} value={encounter.id}>
                  #{encounter.id} · {encounter.encounterType} · {encounter.status}
                </option>
              ))}
            </select>
          </FormField>
          {encountersError && (
            <p className="text-xs text-rose-700">
              Encounters could not be loaded. A standalone request will not be combined with an
              encounter invoice.
            </p>
          )}
          <FormField label="Search examinations" htmlFor="radiology-exam-search">
            <input
              id="radiology-exam-search"
              value={examSearch}
              onChange={(event) => setExamSearch(event.target.value)}
              className="field-input"
              placeholder="Search code or examination"
            />
          </FormField>
          <FormField label="Facility examination" htmlFor="radiology-facility-exam">
            <select
              id="radiology-facility-exam"
              value={reqForm.facilityServiceId}
              className="field-input"
              onChange={(event) => {
                const exam = examinations.find((item) => String(item.id) === event.target.value);
                setReqForm({
                  ...reqForm,
                  facilityServiceId: event.target.value,
                  procedureName: exam?.name ?? '',
                });
              }}
            >
              <option value="">Free-text clinical request only</option>
              {examinations
                .filter(
                  (exam) =>
                    `${exam.code} ${exam.name}`.toLowerCase().includes(examSearch.toLowerCase()) ||
                    String(exam.id) === reqForm.facilityServiceId,
                )
                .map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.code} — {exam.name} ·{' '}
                    {exam.unitPrice === null
                      ? 'Price not configured'
                      : `KES ${exam.unitPrice} / ${exam.unit}`}
                  </option>
                ))}
            </select>
          </FormField>
          <p className="text-xs text-muted">
            {catalogueError
              ? 'Facility examinations unavailable; free-text requests require billing review.'
              : 'Prices shown are indicative and rechecked when the examination is reported. Free-text or unpriced requests remain available for care and require billing review.'}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Imaging modality" htmlFor="radiology-modality">
              <select
                id="radiology-modality"
                value={reqForm.modality}
                onChange={(event) => setReqForm({ ...reqForm, modality: event.target.value })}
                className="field-input"
              >
                <option value="X-Ray">X-Ray (Plain Radiography)</option>
                <option value="Ultrasound">Ultrasound (Sonography)</option>
                <option value="CT Scan">CT Scan (Computed Tomography)</option>
                <option value="MRI">MRI (Magnetic Resonance)</option>
              </select>
            </FormField>
            <FormField label="Procedure title *" htmlFor="radiology-procedure">
              <input
                id="radiology-procedure"
                required
                value={reqForm.procedureName}
                readOnly={Boolean(reqForm.facilityServiceId)}
                onChange={(event) => setReqForm({ ...reqForm, procedureName: event.target.value })}
                placeholder="Enter procedure title"
                className="field-input"
              />
            </FormField>
          </div>
          <FormField label="Clinical indication & history *" htmlFor="radiology-indication">
            <textarea
              id="radiology-indication"
              rows={3}
              required
              value={reqForm.clinicalIndication}
              onChange={(event) =>
                setReqForm({ ...reqForm, clinicalIndication: event.target.value })
              }
              placeholder="Enter the clinical reason and relevant history"
              className="field-input h-auto py-2"
            />
          </FormField>
        </form>
      </Modal>
    </div>
  );
};
