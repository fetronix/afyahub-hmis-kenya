import React, { useEffect, useState } from 'react';
import {
  documentRequest,
  type PatientFile,
  type ResponsibleDoctorOptions,
} from '../api/patient-documents.client.ts';

/** Clinical assertions are deliberately separate from the simple file upload.
 * Originals and their metadata are immutable: review creates a new version.
 */
export function RadiologyConsentMetadata({
  patientId,
  doc,
  disabled,
  onSaved,
}: {
  patientId: number;
  doc: PatientFile;
  disabled: boolean;
  onSaved: (doc: PatientFile) => void;
}) {
  const [options, setOptions] = useState<ResponsibleDoctorOptions | null>(null);
  const [search, setSearch] = useState('');
  const [doctor, setDoctor] = useState('');
  const [date, setDate] = useState(doc.signing_date?.slice(0, 10) ?? '');
  const [patientSignature, setPatientSignature] = useState(doc.patient_signature);
  const [doctorSignature, setDoctorSignature] = useState(doc.doctor_signature);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () => {
        documentRequest<ResponsibleDoctorOptions>(
          `/patients/${patientId}/doctors?${new URLSearchParams({ search })}`,
        )
          .then((data) => {
            if (!active) return;
            setOptions(data);
            setDoctor((value) => value || String(data.currentDoctor?.id ?? ''));
            setError('');
          })
          .catch((e) => {
            if (active) {
              setOptions(null);
              setError(e.message);
            }
          });
      },
      search ? 250 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [patientId, search]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const original = await documentRequest<Blob>(`/patients/${patientId}/${doc.id}/file`);
      const saved = await documentRequest<PatientFile>(`/patients/${patientId}`, {
        method: 'POST',
        headers: {
          'Content-Type': doc.mime_type,
          'X-Document-Metadata': encodeURIComponent(
            JSON.stringify({
              title: doc.title,
              notes: doc.notes ?? '',
              filename: doc.filename,
              category: doc.category,
              documentType: doc.document_type,
              previousId: doc.id,
              radiologyOrderId: doc.radiology_order_id,
              signingDate: date,
              doctorId: doctor,
              patientSignature,
              doctorSignature,
              reason,
            }),
          ),
        },
        body: original,
      });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signature review could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  const field = 'mt-1 w-full rounded border p-2';
  return (
    <details className="rounded border p-3">
      <summary>Record signature details for consent review</summary>
      <p className="my-2">
        Only record what you observed on the saved original. Saving creates a new version with
        unchanged file bytes; it does not verify consent or release a document.
      </p>
      {!doc.reviewed_by_actor && <p>Preview this original before recording signature details.</p>}
      <form
        aria-label="Record consent signature details"
        onSubmit={(e) => void save(e)}
        className="grid gap-3 sm:grid-cols-2"
      >
        <label>
          Signing date
          <input
            className={field}
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {options?.canAssignOthers && (
          <label>
            Search doctors
            <input
              className={field}
              maxLength={80}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setDoctor('');
              }}
            />
          </label>
        )}
        <label>
          Responsible doctor
          <select
            className={field}
            required
            value={doctor}
            disabled={busy || !options?.canAssignOthers}
            onChange={(e) => setDoctor(e.target.value)}
          >
            <option value="">Select an active doctor</option>
            {options?.currentDoctor &&
              !options.doctors.some((d) => d.id === options.currentDoctor?.id) && (
                <option value={options.currentDoctor.id}>{options.currentDoctor.name}</option>
              )}
            {options?.doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.designation ? ` — ${d.designation}` : ''}
              </option>
            ))}
          </select>
        </label>
        {options?.hasMore && <p>Refine the search to find more doctors.</p>}
        <label>
          Patient signature status
          <select
            className={field}
            value={patientSignature}
            onChange={(e) => setPatientSignature(e.target.value)}
          >
            <option value="UNKNOWN">Unknown / not checked</option>
            <option value="ABSENT">Absent</option>
            <option value="PRESENT">Present (staff-observed)</option>
          </select>
        </label>
        <label>
          Doctor signature status
          <select
            className={field}
            value={doctorSignature}
            onChange={(e) => setDoctorSignature(e.target.value)}
          >
            <option value="UNKNOWN">Unknown / not checked</option>
            <option value="ABSENT">Absent</option>
            <option value="PRESENT">Present (staff-observed)</option>
          </select>
        </label>
        <label className="sm:col-span-2">
          Signature review reason
          <textarea
            className={field}
            required
            minLength={10}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button
          className="rounded border p-2 disabled:opacity-50 sm:col-span-2"
          type="submit"
          disabled={busy || disabled || !doc.reviewed_by_actor || !options || !doctor}
        >
          Save reviewed signature details as new version
        </button>
      </form>
    </details>
  );
}
