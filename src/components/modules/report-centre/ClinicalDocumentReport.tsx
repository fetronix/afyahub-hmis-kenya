import React, { useRef, useEffect, useState } from 'react';
import { documentClient, openBlob } from '../../../api/clients/branding.client.ts';
export type ClinicalDocumentWorkflow = 'laboratory' | 'radiology' | 'discharge';
/** Reuse existing scoped/release-checked documents; never construct a report from browser values. */
export function ClinicalDocumentReport({ workflow }: { workflow: ClinicalDocumentWorkflow }) {
  const [reference, setReference] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const version = useRef(0);
  useEffect(
    () => () => {
      version.current += 1;
    },
    [],
  );
  async function open(download: boolean) {
    const id = Number(reference),
      request = ++version.current;
    setError('');
    if (!Number.isSafeInteger(id) || id <= 0) {
      setError('Enter a valid request/admission reference from the source module.');
      return;
    }
    setBusy(true);
    try {
      const blob = await (workflow === 'laboratory'
        ? documentClient.laboratoryReport(id)
        : workflow === 'radiology'
          ? documentClient.radiologyReport(id)
          : documentClient.dischargeSummary(id));
      if (request === version.current)
        openBlob(blob, download ? `${workflow}-${id}.pdf` : undefined);
    } catch (e) {
      if (request === version.current)
        setError(e instanceof Error ? e.message : 'The document could not be generated.');
    } finally {
      if (request === version.current) setBusy(false);
    }
  }
  return (
    <section
      className="space-y-4 rounded border border-teal-200 p-4"
      aria-label="Existing clinical report document"
    >
      <h3 className="font-semibold">Existing {workflow} document</h3>
      <p className="text-sm">
        Use the request/admission reference from the source clinical module. The existing document
        service checks access, facility and report release/completion before returning a PDF.
        Preview and download use the same facility-rendered document, with a plain fallback where no
        historical letterhead was active.
      </p>
      <label className="block">
        Request / admission reference
        <input
          aria-label="Request / admission reference"
          type="number"
          min="1"
          className="ml-2 rounded border p-2"
          value={reference}
          onChange={(e) => {
            version.current += 1;
            setReference(e.target.value);
            setBusy(false);
            setError('');
          }}
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          className="rounded border px-3 py-2"
          disabled={busy}
          onClick={() => void open(false)}
        >
          Preview / Print PDF
        </button>
        <button
          className="rounded border px-3 py-2"
          disabled={busy}
          onClick={() => void open(true)}
        >
          Download clinical PDF
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <p className="text-xs text-slate-500">
        This does not sign, verify or release a result. Make clinical changes in the source module.
        Reference browsing, XLSX and CSV are not available for these individual clinical documents.
      </p>
    </section>
  );
}
