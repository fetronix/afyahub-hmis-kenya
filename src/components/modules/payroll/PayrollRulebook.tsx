import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FlaskConical, RefreshCw, Scale, ShieldQuestion } from 'lucide-react';

import { api, ApiError } from '../../../api/client.ts';
import type {
  PayrollPreview,
  PayrollRulebook,
  PayrollRulebookEntry,
} from '../../../api/clients/workforce.client.ts';
import { PrimaryButton, SecondaryButton } from '../../ui/controls.tsx';
import { AlertBanner, EmptyState, StatusBadge } from '../../ui/feedback.tsx';
import { DataTable, FilterToolbar } from '../../ui/layout.tsx';

const today = () => new Date().toISOString().slice(0, 10);

function kes(value: string | number | bigint | null | undefined): string {
  const cents = BigInt(String(value ?? '0'));
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = (absolute / 100n).toLocaleString('en-KE');
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Steps a payroll officer can check one by one. They are derived from the
 * engine's own lines and statute traces, not recomputed here: the screen must
 * show what the engine did, not a second opinion that could drift from it.
 */
function traceRows(preview: PayrollPreview) {
  const slip = preview.slip;
  const statute = (code: string) => slip.statutes.find((row) => row.statute === code);
  return [
    { step: '1. Gross earnings', value: kes(slip.grossCents), note: 'Basic + taxable allowances' },
    {
      step: '2. Taxable gross',
      value: kes(slip.taxableGrossCents),
      note: 'Gross less documented exempt earnings',
    },
    {
      step: '3. NSSF employee',
      value: kes(slip.nssfEmployeeCents),
      note: `Tier I ${kes(
        slip.lines.find((line) => line.code === 'NSSF_T1')?.amountCents ?? '0',
      )} · Tier II ${kes(slip.lines.find((line) => line.code === 'NSSF_T2')?.amountCents ?? '0')}`,
    },
    {
      step: '4. NSSF employer',
      value: kes(slip.nssfEmployerCents),
      note: 'Not deducted from the employee',
    },
    { step: '5. SHIF', value: kes(slip.shifCents), note: 'Employee only; no insurance relief' },
    {
      step: '6. AHL employee',
      value: kes(slip.ahlEmployeeCents),
      note: `Base ${kes(statute('AHL')?.taxableBaseCents ?? '0')}`,
    },
    {
      step: '7. AHL employer',
      value: kes(slip.ahlEmployerCents),
      note: 'Not deducted from the employee',
    },
    {
      step: '8. Qualifying pension',
      value: kes(slip.qualifyingPensionCents),
      note: 'Deductible, not a relief',
    },
    {
      step: '9. Taxable income',
      value: kes(slip.taxableCents),
      note: 'Before PAYE bands',
    },
    {
      step: '10. PAYE before relief',
      value: kes(slip.payeBeforeReliefCents),
      note: `${statute('PAYE')?.bands.length ?? 0} band(s) charged`,
    },
    {
      step: '11. Reliefs',
      value: kes(BigInt(slip.personalReliefCents) + BigInt(slip.insuranceReliefCents)),
      note: `Personal ${kes(slip.personalReliefCents)} · insurance ${kes(slip.insuranceReliefCents)}`,
    },
    { step: '12. Net pay', value: kes(slip.netCents), note: 'After every employee deduction' },
    {
      step: '13. Employer total cost',
      value: kes(slip.employerCostCents),
      note: `Employer contributions ${kes(slip.employerContributionsCents)}`,
    },
  ];
}

export function PayrollRulebookPanel({
  facilityId,
  canManageRules,
  onChanged,
}: {
  facilityId: number;
  canManageRules: boolean;
  onChanged: () => void;
}) {
  const [data, setData] = useState<PayrollRulebook | null>(null);
  const [effectiveOn, setEffectiveOn] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.getPayrollRulebook(facilityId, effectiveOn));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the rule catalogue.');
    }
  }, [facilityId, effectiveOn]);

  useEffect(() => {
    void load();
  }, [load]);

  const install = async (entry?: PayrollRulebookEntry) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.installPayrollRulebook(facilityId, {
        effectiveOn,
        ...(entry ? { statutes: [entry.statute] } : {}),
      });
      const installed = result.installed.map((row) => row.key).join(', ');
      const skipped = result.skipped.map((row) => `${row.statute}: ${row.reason}`).join(' ');
      setMessage(
        [
          installed ? `Installed as draft: ${installed}.` : 'Nothing new to install.',
          skipped,
          result.nextActions.join(' '),
        ]
          .filter(Boolean)
          .join(' '),
      );
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not install the rule.');
    } finally {
      setBusy(false);
    }
  };

  const entries = data?.entries ?? [];
  const covering = entries.filter((entry) => entry.appliesOnSelectedDate);
  const notCovering = entries.filter((entry) => !entry.appliesOnSelectedDate);

  return (
    <section className="space-y-3">
      <FilterToolbar>
        <div className="flex flex-wrap items-end gap-2">
          <label className="ui-field">
            <span>Rules effective on</span>
            <input
              className="ui-input"
              type="date"
              value={effectiveOn}
              onChange={(event) => {
                setData(null);
                setError('');
                setEffectiveOn(event.target.value);
              }}
            />
          </label>
          <SecondaryButton
            onClick={() => {
              setError('');
              void load();
            }}
          >
            <RefreshCw size={14} /> Refresh
          </SecondaryButton>
        </div>
        {canManageRules && (
          <PrimaryButton disabled={busy || covering.length === 0} onClick={() => void install()}>
            <Download size={15} /> Install the {covering.length} covering rule
            {covering.length === 1 ? '' : 's'} as drafts
          </PrimaryButton>
        )}
      </FilterToolbar>

      {error && <AlertBanner tone="error">{error}</AlertBanner>}
      {message && <AlertBanner tone="info">{message}</AlertBanner>}

      <p className="text-xs text-muted">
        These are reference transcriptions of published Kenyan instruments, with the passage each
        figure came from. Installing copies an entry into this facility as a <strong>draft</strong>;
        it becomes usable only after a named user verifies it against the source and activates it.
        The application does not certify legal compliance, and a catalogue entry marked as
        unverified below needs its official text checked before activation.
      </p>

      {!data ? (
        <EmptyState title="Loading catalogue" description="Reading the published rule catalogue." />
      ) : (
        <>
          <h3 className="text-sm font-semibold">Covering {effectiveOn}</h3>
          <CatalogueTable
            entries={covering}
            canManageRules={canManageRules}
            busy={busy}
            onInstall={install}
          />
          {notCovering.length > 0 && (
            <>
              <h3 className="text-sm font-semibold">Other effective-dated entries</h3>
              <p className="text-xs text-muted">
                Not effective on the selected date. Installing one records it as a draft for its own
                dates; it will not be used for {effectiveOn}.
              </p>
              <CatalogueTable
                entries={notCovering}
                canManageRules={canManageRules}
                busy={busy}
                onInstall={install}
              />
            </>
          )}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted">Where these figures came from</summary>
            <ul className="mt-2 space-y-2">
              {entries.map((entry) => (
                <li key={`${entry.key}-source`}>
                  <strong>{entry.key}</strong> — {entry.sourceTitle}.{' '}
                  <a
                    className="underline"
                    href={entry.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {entry.sourceUrl}
                  </a>
                  {entry.sourcePublishedOn ? ` · published ${entry.sourcePublishedOn}` : ''}
                  <p className="mt-1 text-muted">“{entry.citedPassage}”</p>
                  {entry.verificationNote && (
                    <p className="mt-1 text-muted">Catalogue note: {entry.verificationNote}</p>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}

function CatalogueTable({
  entries,
  canManageRules,
  busy,
  onInstall,
}: {
  entries: PayrollRulebookEntry[];
  canManageRules: boolean;
  busy: boolean;
  onInstall: (entry: PayrollRulebookEntry) => void;
}) {
  if (entries.length === 0)
    return (
      <EmptyState
        title="No published entry covers this date"
        description="Record the authority's version manually, with its source, rather than borrowing a rate from another period."
      />
    );
  return (
    <DataTable className="table-quiet">
      <thead>
        <tr>
          <th>Statute</th>
          <th>Rule</th>
          <th>Effective</th>
          <th>Method</th>
          <th>Status here</th>
          <th aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.key}>
            <td className="font-semibold">{entry.statute}</td>
            <td>
              <p className="text-xs font-medium">{entry.ruleName}</p>
              <p className="text-xs text-muted">{entry.authority}</p>
            </td>
            <td className="text-xs tabular-nums">
              {entry.effectiveFrom} → {entry.effectiveTo ?? 'open'}
            </td>
            <td className="text-xs">{entry.calculationMethod}</td>
            <td>
              {entry.installedVersionId ? (
                <StatusBadge tone={entry.installedStatus === 'ACTIVE' ? 'success' : 'warning'}>
                  {entry.installedStatus} · version {entry.installedVersionId}
                </StatusBadge>
              ) : (
                <StatusBadge tone="neutral">Not installed</StatusBadge>
              )}
            </td>
            <td className="text-right">
              {canManageRules && !entry.installedVersionId && (
                <SecondaryButton disabled={busy} onClick={() => onInstall(entry)}>
                  <Download size={14} /> Install draft
                </SecondaryButton>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

/**
 * Cost one employee for a period without creating a run.
 *
 * The point is to answer "what would this rule do to this person?" before
 * payroll is finalised, and to show which dated version every figure came
 * from. It writes nothing; the notice says so.
 */
export function PayrollPreviewPanel({
  facilityId,
  canReadPayslips,
}: {
  facilityId: number;
  canReadPayslips: boolean;
}) {
  const [form, setForm] = useState({
    payDate: today(),
    mode: 'synthetic' as 'synthetic' | 'employee',
    employeeId: '',
    grossKes: '100000.00',
    taxResidency: 'RESIDENT',
    insurancePremiumKes: '',
    pensionKes: '',
  });
  const [result, setResult] = useState<PayrollPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [employees, setEmployees] = useState<Array<{ id: number; name: string }>>([]);

  useEffect(() => {
    if (!canReadPayslips) return;
    let live = true;
    fetchEmployees(facilityId)
      .then((rows) => {
        if (live) setEmployees(rows);
      })
      .catch(() => {
        /* The synthetic path still works when the staff list is not readable. */
      });
    return () => {
      live = false;
    };
  }, [facilityId, canReadPayslips]);

  const submit = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const components: Array<Record<string, unknown>> = [];
      if (form.pensionKes.trim())
        components.push({
          code: 'PENSION',
          name: 'Qualifying pension',
          kind: 'DEDUCTION',
          amountKes: form.pensionKes,
          taxDeductible: true,
        });
      setResult(
        await api.previewPayroll(facilityId, {
          payDate: form.payDate,
          ...(form.mode === 'employee'
            ? { employeeId: Number(form.employeeId) }
            : {
                grossKes: form.grossKes,
                taxResidency: form.taxResidency,
                insurancePremiumKes: form.insurancePremiumKes,
                components,
              }),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The preview could not be calculated.');
    } finally {
      setBusy(false);
    }
  };

  const rows = useMemo(() => (result ? traceRows(result) : []), [result]);

  return (
    <section className="space-y-3">
      <FilterToolbar>
        <h2 className="text-sm font-semibold">Calculation preview</h2>
        <p className="text-xs text-muted">Writes nothing. Not a payroll run.</p>
      </FilterToolbar>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="ui-field">
          <span>Pay date *</span>
          <input
            className="ui-input"
            type="date"
            value={form.payDate}
            onChange={(event) => setForm({ ...form, payDate: event.target.value })}
          />
        </label>
        <label className="ui-field">
          <span>Cost</span>
          <select
            className="ui-input"
            value={form.mode}
            onChange={(event) =>
              setForm({ ...form, mode: event.target.value as 'synthetic' | 'employee' })
            }
          >
            <option value="synthetic">A synthetic salary</option>
            <option value="employee">A real employee&apos;s recorded pay</option>
          </select>
        </label>
        {form.mode === 'employee' ? (
          <label className="ui-field">
            <span>Employee *</span>
            <select
              className="ui-input"
              value={form.employeeId}
              onChange={(event) => setForm({ ...form, employeeId: event.target.value })}
            >
              <option value="">Select…</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="ui-field">
            <span>Gross monthly (KES) *</span>
            <input
              className="ui-input"
              inputMode="decimal"
              value={form.grossKes}
              onChange={(event) => setForm({ ...form, grossKes: event.target.value })}
            />
          </label>
        )}
        {form.mode === 'synthetic' ? (
          <label className="ui-field">
            <span>Tax residency</span>
            <select
              className="ui-input"
              value={form.taxResidency}
              onChange={(event) => setForm({ ...form, taxResidency: event.target.value })}
            >
              <option value="RESIDENT">Resident — personal relief applies</option>
              <option value="NON_RESIDENT">Non-resident — no personal relief</option>
            </select>
          </label>
        ) : (
          <div />
        )}
        {form.mode === 'synthetic' && (
          <>
            <label className="ui-field">
              <span>Declared insurance premium (KES)</span>
              <input
                className="ui-input"
                inputMode="decimal"
                placeholder="0.00"
                value={form.insurancePremiumKes}
                onChange={(event) => setForm({ ...form, insurancePremiumKes: event.target.value })}
              />
            </label>
            <label className="ui-field">
              <span>Qualifying pension (KES)</span>
              <input
                className="ui-input"
                inputMode="decimal"
                placeholder="0.00"
                value={form.pensionKes}
                onChange={(event) => setForm({ ...form, pensionKes: event.target.value })}
              />
            </label>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <PrimaryButton
          disabled={busy || (form.mode === 'employee' ? !form.employeeId : !form.grossKes.trim())}
          onClick={() => void submit()}
        >
          <FlaskConical size={15} /> {busy ? 'Calculating…' : 'Preview calculation'}
        </PrimaryButton>
        <p className="text-xs text-muted">
          A preview may be run before the rules are activated; a payroll run may not.
        </p>
      </div>

      {error && <AlertBanner tone="error">{error}</AlertBanner>}

      {result && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Gross', value: result.slip.grossCents },
              { label: 'PAYE', value: result.slip.payeCents },
              { label: 'Net pay', value: result.slip.netCents },
              { label: 'Employer total cost', value: result.slip.employerCostCents },
            ].map((card) => (
              <div key={card.label} className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted">{card.label}</p>
                <p className="text-lg font-semibold tabular-nums">KES {kes(card.value)}</p>
              </div>
            ))}
          </div>

          <DataTable className="table-quiet">
            <thead>
              <tr>
                <th>Step</th>
                <th className="text-right">Amount (KES)</th>
                <th>Working</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.step}>
                  <td className="text-xs font-medium">{row.step}</td>
                  <td className="text-right text-xs tabular-nums">{row.value}</td>
                  <td className="text-xs text-muted">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>

          <DataTable className="table-quiet">
            <thead>
              <tr>
                <th>Statute</th>
                <th>Rule version</th>
                <th>Effective</th>
                <th className="text-right">Bands charged</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {result.slip.statutes.map((statute) => {
                const version = result.ruleVersions.find((row) => row.statute === statute.statute);
                return (
                  <tr key={statute.statute}>
                    <td className="font-semibold">{statute.statute}</td>
                    <td className="text-xs">
                      {statute.label} <span className="text-muted">(#{statute.versionId})</span>
                    </td>
                    <td className="text-xs tabular-nums">
                      {statute.effectiveFrom} → {statute.effectiveTo ?? 'open'}
                    </td>
                    <td className="text-right text-xs tabular-nums">{statute.bands.length}</td>
                    <td
                      className="max-w-[16rem] truncate text-xs text-muted"
                      title={version?.sourceReference}
                    >
                      {version?.sourceReference}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>

          <AlertBanner tone="info">
            <span className="inline-flex items-center gap-2">
              <ShieldQuestion size={15} /> {result.notice}
            </span>
          </AlertBanner>
        </div>
      )}

      <p className="text-xs text-muted">
        <Scale size={13} className="mr-1 inline" />
        The steps above are the engine&apos;s own trace, not a re-calculation in the browser. To
        check it independently, apply the cited instrument&apos;s bands by hand and compare each
        figure; a difference is a defect to investigate, not a rounding to accept.
      </p>
    </section>
  );
}

async function fetchEmployees(facilityId: number): Promise<Array<{ id: number; name: string }>> {
  const rows = await api.getHrEmployees(facilityId);
  return (rows ?? []).map(
    (row: { id: number; firstName: string; lastName: string; employeeNumber: string }) => ({
      id: row.id,
      name: `${row.employeeNumber} — ${row.firstName} ${row.lastName}`,
    }),
  );
}
