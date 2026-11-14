import React, { useState } from 'react';
import type { Patient } from '../../types/index.ts';
import { usePatientDirectory } from './usePatientDirectory.ts';

/** Browse only the explicitly selected tenant/facility; the API remains authoritative. */
export const PatientDirectoryPicker: React.FC<{
  tenantId?: number;
  facilityId?: number;
  onSelect: (patient: Patient) => void;
  refreshKey?: number;
}> = ({ tenantId, facilityId, onSelect, refreshKey }) => {
  const [search, setSearch] = useState('');
  const directory = usePatientDirectory({ tenantId, facilityId, search, refreshKey });
  return (
    <section
      aria-label="Find a facility patient"
      className="space-y-3 rounded border border-slate-200 bg-white p-3"
    >
      <label className="block text-xs font-medium text-slate-700">
        Search facility patients by name, MRN, ID or phone
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
        />
      </label>
      {directory.error ? (
        <div role="alert" className="text-xs text-red-700">
          <p>{directory.error}</p>
          <button type="button" className="mt-2 underline" onClick={directory.retry}>
            Retry directory
          </button>
        </div>
      ) : directory.loading ? (
        <p role="status" className="text-xs text-slate-500">
          Loading patients…
        </p>
      ) : directory.items.length === 0 ? (
        <p className="text-xs text-slate-500">No patients found in this facility.</p>
      ) : (
        <ul className="max-h-60 overflow-y-auto divide-y divide-slate-100">
          {directory.items.map((patient) => (
            <li key={patient.id}>
              <button
                type="button"
                className="w-full rounded px-2 py-2 text-left text-xs hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
                onClick={() => onSelect(patient)}
              >
                <span className="font-semibold">
                  {patient.firstName} {patient.lastName}
                </span>
                <span className="ml-2 text-slate-500">
                  MRN: {patient.mrn} · DOB: {patient.dateOfBirth}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <nav
        aria-label="Facility patient pages"
        className="flex items-center justify-between gap-3 text-xs"
      >
        <button
          type="button"
          disabled={!directory.canPrevious}
          onClick={directory.previous}
          className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-50"
        >
          Previous page
        </button>
        <span>Page {directory.page}</span>
        <button
          type="button"
          disabled={!directory.canNext}
          onClick={directory.next}
          className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-50"
        >
          Next page
        </button>
      </nav>
    </section>
  );
};
