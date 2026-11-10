import { PrimaryButton, SecondaryButton } from '../ui/controls.tsx';
import { DataTable, PageHeader } from '../ui/layout.tsx';
import { AlertBanner } from '../ui/feedback.tsx';
import { Modal } from '../ui/overlays.tsx';
import React, { useEffect, useMemo, useState } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { PublicHealthReport } from '../../types/index.ts';
import { AlertTriangle, Download, FileWarning, Plus } from 'lucide-react';

/*
 * Public health surveillance
 * ==========================
 *
 * This screen used to make four claims that were not true:
 *
 *   1. "Integrated with Kenya Digital Health Agency (DHA) national
 *      disease surveillance network" — there is no such integration.
 *   2. "DHIS2 Auto-Push" — nothing is pushed anywhere.
 *   3. "queued for KHIS submission" — the report is stored locally and
 *      no queue exists.
 *   4. "Epidemic Threshold: Normal Trend" on every row — no threshold
 *      data is held, so the label was invented.
 *
 * It also POSTed `facilityId: currentFacility?.id || 1`, which filed a
 * notifiable disease report against facility 1 when no facility was
 * selected.
 *
 * The MOH 705 endpoint returns 501 with an explicit reason. That is the
 * honest state of the feature, and this screen now shows it instead of
 * rendering an empty table and letting the export button download
 * `null`.
 */

/** ISO-8601 epidemiological week, e.g. 2026-W43. */
export function currentEpiWeek(date: Date = new Date()): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);

  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const NOTIFIABLE_CONDITIONS: Record<string, string> = {
  A00: 'Cholera (suspected)',
  A20: 'Plague (suspected)',
  A80: 'Acute flaccid paralysis (polio sentinel)',
  B05: 'Measles (suspected)',
  B50: 'Malaria (confirmed)',
  J09: 'Severe acute respiratory infection (SARI)',
};

export const PublicHealthModule: React.FC = () => {
  const { currentFacility, showToast, refreshKey, triggerRefresh } = useHmis();

  const [reports, setReports] = useState<PublicHealthReport[]>([]);
  const [reportsError, setReportsError] = useState('');
  const [loading, setLoading] = useState(true);

  /*
   * The MOH 705 aggregate is a separate question from the sentinel
   * ledger: one can be listed while the other is unavailable. Its
   * failure is kept apart so a 501 does not blank the page.
   */
  const [mohSummary, setMohSummary] = useState<unknown>(null);
  const [mohError, setMohError] = useState('');

  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [alertForm, setAlertForm] = useState({
    diseaseCode: '',
    casesCount: '',
    mortalityCount: '',
    ageGroup: '',
    epiWeek: '',
  });

  useEffect(() => {
    async function loadPublicHealth() {
      if (!currentFacility?.id) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setReportsError('');
      setMohError('');

      const [reportsResult, mohResult] = await Promise.allSettled([
        api.getPublicHealthReports(currentFacility.id),
        api.getMoh705Summary(currentFacility.id),
      ]);

      if (reportsResult.status === 'fulfilled') {
        setReports(reportsResult.value);
      } else {
        const reason = reportsResult.reason;
        setReportsError(
          reason instanceof Error ? reason.message : 'The sentinel ledger could not be read.',
        );
      }

      if (mohResult.status === 'fulfilled') {
        setMohSummary(mohResult.value);
      } else {
        const reason = mohResult.reason;
        setMohSummary(null);
        setMohError(
          reason instanceof Error ? reason.message : 'The MOH 705 aggregate is not available.',
        );
      }

      setLoading(false);
    }

    void loadPublicHealth();
  }, [currentFacility?.id, refreshKey]);

  const totals = useMemo(
    () =>
      reports.reduce(
        (sum, report) => ({
          cases: sum.cases + report.casesCount,
          deaths: sum.deaths + report.mortalityCount,
        }),
        { cases: 0, deaths: 0 },
      ),
    [reports],
  );

  const handleRecordAlert = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentFacility?.id) {
      showToast('Select a facility before recording a notifiable case.', {
        tone: 'warning',
      });
      return;
    }

    try {
      await api.recordPublicHealthReport({
        facilityId: currentFacility.id,
        diseaseCode: alertForm.diseaseCode,
        diseaseName: NOTIFIABLE_CONDITIONS[alertForm.diseaseCode] ?? 'Notifiable condition',
        casesCount: Number(alertForm.casesCount),
        mortalityCount: Number(alertForm.mortalityCount),
        ageGroup: alertForm.ageGroup,
        epiWeek: alertForm.epiWeek,
      });

      showToast(
        `Case recorded at ${currentFacility.name}. It has not been transmitted to KHIS or DHIS2.`,
        { tone: 'success' },
      );

      setIsAlertModalOpen(false);
      setAlertForm({
        diseaseCode: '',
        casesCount: '',
        mortalityCount: '',
        ageGroup: '',
        epiWeek: '',
      });
      triggerRefresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The case could not be recorded.';

      showToast(message, { tone: 'error' });
    }
  };

  const exportSummary = () => {
    if (mohSummary === null) return;

    const dataStr = JSON.stringify(mohSummary, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = `MOH-705-${currentFacility?.mflCode || 'facility'}-${currentEpiWeek()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('Downloaded the MOH 705 payload returned by the server.');
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <PageHeader>
        <div>
          <p className="eyebrow">Public health</p>
          <h1 className="ui-page-title">Surveillance &amp; MOH 705</h1>
          <p className="ui-page-description">
            Notifiable disease reports recorded at this facility, and the MOH 705 outpatient return.
            Nothing on this screen is transmitted automatically.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SecondaryButton
            type="button"
            onClick={exportSummary}
            disabled={mohSummary === null}
            title={
              mohSummary === null
                ? 'The MOH 705 aggregate is not produced by this build'
                : 'Download the server payload'
            }
          >
            <Download className="h-3.5 w-3.5" />
            Export MOH 705 JSON
          </SecondaryButton>

          <PrimaryButton type="button" onClick={() => setIsAlertModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Record notifiable case
          </PrimaryButton>
        </div>
      </PageHeader>

      {/* Standing caveat — the screen must not imply a national connection. */}
      <AlertBanner tone="warning" className="text-xs">
        <div>
          <p className="font-bold">Local record only — not a national submission</p>
          <p className="mt-0.5 max-w-3xl text-2xs leading-relaxed text-amber-800">
            Reports are stored in this facility&apos;s database. This build has no connection to
            KHIS, DHIS2 or the DHA surveillance network, and no queue that would send them later.
            Immediate notification of a reportable disease remains a manual duty of the facility.
          </p>
        </div>
      </AlertBanner>

      {loading && <p className="text-sm text-slate-500">Loading the surveillance ledger…</p>}

      {!currentFacility?.id && !loading && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No facility is selected, so there is nothing to report against.
        </div>
      )}

      {/* MOH 705 aggregate */}
      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div>
            <p className="eyebrow">MOH 705 · outpatient return</p>
            <h2 className="mt-1 text-sm font-bold text-ink">Top morbidity</h2>
          </div>
          <span className="chip font-mono">{currentEpiWeek()}</span>
        </div>

        {mohError ? (
          <div className="flex items-start gap-3 px-5 py-4">
            <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="text-xs">
              <p className="font-semibold text-ink">This report is not produced by this build</p>
              <p className="mt-1 max-w-3xl leading-relaxed text-muted">{mohError}</p>
              <p className="mt-1 text-2xs text-muted">
                The server returns this message deliberately rather than an empty table. No figures
                are shown because no figures exist.
              </p>
            </div>
          </div>
        ) : (
          <p className="px-5 py-4 text-xs text-muted">
            The server returned a payload that this screen does not interpret yet.
          </p>
        )}
      </section>

      {/* Sentinel ledger */}
      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Notifiable conditions</p>
            <h2 className="mt-1 text-sm font-bold text-ink">
              Sentinel ledger
              <span className="ml-2 font-mono text-2xs text-muted">
                {loading
                  ? 'Loading…'
                  : reportsError
                    ? 'Unavailable'
                    : `${reports.length} record${reports.length === 1 ? '' : 's'}`}
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <span className="chip">cases {loading || reportsError ? '—' : totals.cases}</span>
            <span className="chip">deaths {loading || reportsError ? '—' : totals.deaths}</span>
          </div>
        </div>

        {reportsError && (
          <div
            role="alert"
            className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-2xs text-red-800"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{reportsError}</span>
          </div>
        )}

        <div className="overflow-x-auto">
          <DataTable className="table-quiet">
            <thead>
              <tr>
                <th>Condition</th>
                <th>ICD-10</th>
                <th>Age group</th>
                <th className="text-right">Cases</th>
                <th className="text-right">Deaths</th>
                <th>Epi-week</th>
                <th className="text-right">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 && !reportsError && !loading && currentFacility?.id && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-muted">
                    No notifiable condition has been recorded at this facility.
                  </td>
                </tr>
              )}

              {reports.map((report) => (
                <tr key={report.id}>
                  <td className="font-semibold text-ink">{report.diseaseName}</td>
                  <td className="font-mono text-brand-800">{report.diseaseCode}</td>
                  <td className="text-muted">{report.ageGroup}</td>
                  <td className="text-right font-mono font-bold">{report.casesCount}</td>
                  <td
                    className={`text-right font-mono ${
                      report.mortalityCount > 0 ? 'text-rose-700 font-bold' : 'text-muted'
                    }`}
                  >
                    {report.mortalityCount}
                  </td>
                  <td className="font-mono text-muted">{report.epiWeek}</td>
                  <td className="text-right text-2xs text-muted">
                    {new Date(report.reportedAt).toLocaleString('en-KE')}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      </section>

      {/* Report modal */}
      <Modal
        open={isAlertModalOpen}
        onClose={() => setIsAlertModalOpen(false)}
        title="Record a notifiable case"

        actions={
          <>
            <SecondaryButton onClick={() => setIsAlertModalOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton type="submit" form="public-health-form">
              Record case
            </PrimaryButton>
          </>
        }
      >
        <p className="text-xs text-muted">
          Stored at this facility. Not submitted to any national system.
        </p>
        <form id="public-health-form" onSubmit={handleRecordAlert} className="mt-4 space-y-3">
          <div>
            <label className="field-label" htmlFor="notifiable-condition">
              Condition
            </label>
            <select
              id="notifiable-condition"
              required
              value={alertForm.diseaseCode}
              onChange={(e) => setAlertForm({ ...alertForm, diseaseCode: e.target.value })}
              className="field-input"
            >
              <option value="">Select a condition</option>
              {Object.entries(NOTIFIABLE_CONDITIONS).map(([code, name]) => (
                <option key={code} value={code}>
                  {code} — {name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="cases-count">
                Cases
              </label>
              <input
                id="cases-count"
                type="number"
                min={1}
                required
                value={alertForm.casesCount}
                onChange={(e) => setAlertForm({ ...alertForm, casesCount: e.target.value })}
                className="field-input font-mono"
              />
            </div>

            <div>
              <label className="field-label" htmlFor="deaths-count">
                Deaths
              </label>
              <input
                id="deaths-count"
                type="number"
                min={0}
                max={alertForm.casesCount || undefined}
                required
                value={alertForm.mortalityCount}
                onChange={(e) =>
                  setAlertForm({
                    ...alertForm,
                    mortalityCount: e.target.value,
                  })
                }
                className="field-input font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="age-group">
                Age group
              </label>
              <select
                id="age-group"
                required
                value={alertForm.ageGroup}
                onChange={(e) => setAlertForm({ ...alertForm, ageGroup: e.target.value })}
                className="field-input"
              >
                <option value="">Select an age group</option>
                <option value="Under 5 Years">Under 5 years</option>
                <option value="Over 5 Years">5 years and over</option>
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="epi-week">
                Epi-week
              </label>
              <input
                id="epi-week"
                type="text"
                placeholder="YYYY-Www"
                required
                pattern="\d{4}-W(0[1-9]|[1-4]\d|5[0-3])"
                value={alertForm.epiWeek}
                onChange={(e) => setAlertForm({ ...alertForm, epiWeek: e.target.value })}
                className="field-input font-mono"
              />
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
};
