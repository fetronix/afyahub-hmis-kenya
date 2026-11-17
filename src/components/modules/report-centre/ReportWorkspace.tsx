import React, { useState } from 'react';
import { PageBreadcrumbs } from '../../ui/layout.tsx';
import { AlertTriangle, ArrowLeft, LockKeyhole } from 'lucide-react';
import { REPORT_ENGINES } from '../../../reporting/report-centre.types.ts';
import {
  reportImplementation,
  type ReportCategory,
  type ReportEntry,
} from '../../../reporting/report-catalogue.ts';
import type { ReportSelectionOption } from '../../../reporting/report-centre.types.ts';
import { FinalizedInvoicePanel } from '../FinalizedInvoicePanel.tsx';
import { ClinicalDocumentReport } from './ClinicalDocumentReport.tsx';
import { ReportSelectionPicker } from './ReportSelectionPicker.tsx';
import { ReportWorkbench } from './ReportWorkbench.tsx';
import type { Availability } from './ReportCataloguePanel.tsx';

function InvoiceDocument({ facilityId }: { facilityId: number }) {
  const [selected, setSelected] = useState<ReportSelectionOption[]>([]);
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [openVersion, setOpenVersion] = useState(0);
  const [error, setError] = useState('');

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted">
        Browse invoices recorded at the selected facility. The existing statement and audited print
        are reused; template approval and a full document catalogue remain outstanding.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!selected[0]) {
            setInvoiceId(null);
            setError('Select an invoice to open.');
            return;
          }
          setError('');
          setInvoiceId(selected[0].id);
          // Opening the same selection must fetch a fresh, audited snapshot too.
          setOpenVersion((version) => version + 1);
        }}
        className="space-y-3"
      >
        <ReportSelectionPicker
          reportId="invoice-document"
          facilityId={facilityId}
          kind="invoice"
          label="Invoice"
          value={selected}
          required
          onChange={(next) => {
            setSelected(next);
            setInvoiceId(null);
            setError('');
          }}
        />
        <button type="submit" className="ui-button ui-button-primary w-full sm:w-auto">
          Open invoice
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      {invoiceId !== null && (
        <FinalizedInvoicePanel
          key={`${invoiceId}:${openVersion}`}
          invoiceId={invoiceId}
          reportCentre
        />
      )}
    </div>
  );
}

/**
 * One report, on its own page.
 *
 * The workspace states what the report is before offering any control, keeps the
 * facility and period visible, and never renders a result area that looks filled
 * when the report cannot run.
 */
export const ReportWorkspace: React.FC<{
  category: ReportCategory;
  entry: ReportEntry;
  facilityId: number;
  facilityName: string;
  canExport: boolean;
  availability: Availability;
  onBack: () => void;
  onBackToCategory: () => void;
}> = ({
  category,
  entry,
  facilityId,
  facilityName,
  canExport,
  availability,
  onBack,
  onBackToCategory,
}) => {
  const engine = entry.engine ? REPORT_ENGINES[entry.engine] : null;
  const status = reportImplementation(entry);
  /* The invoice document has its own panel; every other workflow is a clinical document. */
  const clinicalWorkflow = entry.workflow && entry.workflow !== 'invoice' ? entry.workflow : null;

  return (
    <section aria-label="Report workspace" className="space-y-4">
      <PageBreadcrumbs
        items={[
          { label: 'Reporting Centre', onClick: onBack },
          { label: category.name, onClick: onBackToCategory },
          { label: entry.name },
        ]}
      />

      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-hair pb-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-ink">{entry.name}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">{entry.summary}</p>
          <p className="mt-1 text-2xs text-muted">
            {category.name} · {facilityName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-hair bg-surface px-2.5 py-1 text-2xs font-semibold text-ink-soft">
            {status.label}
          </span>
          <button type="button" onClick={onBack} className="ui-button ui-button-secondary">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            All reports
          </button>
        </div>
      </header>

      {availability.allowed && engine ? (
        <ReportWorkbench
          key={`${facilityId}:${entry.id}`}
          id={entry.engine!}
          facilityId={facilityId}
          canExport={canExport}
        />
      ) : availability.allowed && entry.workflow === 'invoice' ? (
        <InvoiceDocument key={facilityId} facilityId={facilityId} />
      ) : availability.allowed && clinicalWorkflow ? (
        <ClinicalDocumentReport key={`${facilityId}:${entry.id}`} workflow={clinicalWorkflow} />
      ) : status.status === 'unavailable' ? (
        <div className="rounded-xl border border-hair bg-surface p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
            This report cannot be produced yet
          </p>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted">{entry.dependency}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Nothing is inferred, estimated or filled in to make this page look complete. The rest of
            the catalogue is unaffected.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-semibold">
            <LockKeyhole className="h-4 w-4" aria-hidden="true" />
            {availability.label}
          </p>
          <p className="mt-2 leading-relaxed">{availability.reason}</p>
        </div>
      )}

      {(entry.engine || entry.workflow) && (
        <p className="text-2xs leading-relaxed text-muted">
          Full requested report still needs: {entry.dependency}
        </p>
      )}
    </section>
  );
};
