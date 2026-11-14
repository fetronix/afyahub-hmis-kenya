import React, { useEffect, useState } from 'react';
import { fetchJson } from '../../../api/client.ts';
import type { PayrollPayslipDetail } from '../../../api/clients/workforce.client.ts';
import { parseMoneyToCents } from '../../../billing/settlement.ts';
function parseKesToCents(value: string) {
  const n = parseMoneyToCents(value);
  if (n === null || n < 0 || !Number.isSafeInteger(n))
    throw new Error('Enter an exact non-negative KES amount with at most two decimals.');
  return BigInt(n);
}
function centsToKes(value: bigint) {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

const input = 'w-full rounded border border-slate-300 p-2';
const button = 'rounded bg-teal-800 px-3 py-2 text-white disabled:opacity-50';
const get = <T,>(path: string, facilityId: number) =>
  fetchJson<T>(`/api/payroll/${path}${path.includes('?') ? '&' : '?'}facilityId=${facilityId}`);
async function send(
  path: string,
  method: string,
  facilityId: number,
  body: Record<string, unknown>,
) {
  return fetchJson(`/api/payroll/${path}`, {
    method,
    body: JSON.stringify({ ...body, facilityId }),
  });
}
function message(e: unknown) {
  return e instanceof Error
    ? e.message
    : 'Payroll operation failed; review history before retrying.';
}
export function downloadPayroll(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
/** Clone only the selected document into an isolated print frame; no unescaped HTML or application/sidebar/salary list. */
export function printPayroll(id: string) {
  const source = document.getElementById(id);
  if (!source) return;
  const frame = document.createElement('iframe');
  frame.title = 'Payroll print preview';
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0';
  document.body.append(frame);
  const doc = frame.contentDocument!;
  const style = doc.createElement('style');
  style.textContent =
    'body{font:12px Arial,sans-serif;color:#111;padding:20px} table{border-collapse:collapse;width:100%}th,td{padding:6px;border-bottom:1px solid #ddd;text-align:left}button,summary{display:none} .payroll-page{break-after:page}';
  doc.head.append(style);
  const clone = source.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('button').forEach((b) => b.remove());
  clone.querySelectorAll('details').forEach((d) => (d.open = true));
  doc.body.append(clone);
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  window.setTimeout(() => frame.remove(), 60_000);
}

type Component = {
  id: number;
  code: string;
  name: string;
  kind: string;
  amountCents: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  statutoryExclusions?: string[];
};
type Employee = {
  id: number;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  baseSalaryCents: string;
  components?: Component[];
};
export function PayrollStaffPay({
  facilityId,
  canManage,
}: {
  facilityId: number;
  canManage: boolean;
}) {
  const [employees, setEmployees] = useState<Employee[]>([]),
    [selected, setSelected] = useState<Employee | null>(null);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [salary, setSalary] = useState(''),
    [reason, setReason] = useState('');
  const [form, setForm] = useState({
    code: '',
    name: '',
    kind: 'EARNING',
    amount: '',
    effectiveFrom: '',
    effectiveTo: '',
    taxable: true,
    excludeAhl: false,
  });
  useEffect(() => {
    let live = true;
    get<Employee[]>('employees', facilityId)
      .then((d) => {
        if (live) setEmployees(d);
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [facilityId]);
  async function select(id: string) {
    setError('');
    setSelected(null);
    if (!id) return;
    try {
      const e = await get<Employee>(`employees/${id}`, facilityId);
      setSelected(e);
      setSalary(centsToKes(BigInt(e.baseSalaryCents)));
    } catch (e) {
      setError(message(e));
    }
  }
  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(
        'Saved. Recalculate an unapproved run explicitly to use changes; finalized payroll is unchanged.',
      );
      if (selected) await select(String(selected.id));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4">
      <h2 className="font-bold">Staff salary structures</h2>
      <p>
        Contracted monthly basic salary plus dated fixed-amount earnings and deductions. Record
        approved allowances, overtime and bonuses as dated earning components. Overtime hours/rates
        are not calculated from attendance. A one-off component must be bounded to its intended
        period; no automatic proration is performed.
      </p>
      <p>
        Showing up to 200 staff. Use HR for employment records; payroll preparation permission is
        required for pay changes.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <label>
        Salary employee
        <select
          className={input}
          defaultValue=""
          onChange={(e) => void select(e.target.value)}
          disabled={busy}
        >
          <option value="">Choose staff member</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.employeeNumber} — {e.firstName} {e.lastName}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <>
          <p>Current basic salary: KES {centsToKes(BigInt(selected.baseSalaryCents))}</p>
          {canManage && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() =>
                  send(`employees/${selected.id}/salary`, 'PUT', facilityId, {
                    baseSalaryCents: parseKesToCents(salary).toString(),
                    reason,
                  }),
                );
              }}
            >
              <label>
                Monthly basic salary (KES)
                <input
                  className={input}
                  required
                  value={salary}
                  onChange={(e) => setSalary(e.target.value)}
                />
              </label>
              <label>
                Salary change reason
                <input
                  className={input}
                  required
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button className={button} disabled={busy}>
                Save basic salary
              </button>
            </form>
          )}
          <h3 className="font-bold">Pay components</h3>
          {(selected.components ?? []).map((c) => (
            <p key={c.id}>
              {c.code} · {c.name} · {c.kind} · KES {centsToKes(BigInt(c.amountCents))} ·{' '}
              {c.effectiveFrom} → {c.effectiveTo ?? 'ongoing'} ·{' '}
              {c.isActive ? 'Active' : 'Retained / inactive'}{' '}
              {canManage && c.isActive && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void run(() => send(`components/${c.id}`, 'DELETE', facilityId, {}))
                  }
                >
                  Deactivate {c.code}
                </button>
              )}
            </p>
          ))}
          {canManage && (
            <form
              className="space-y-2 rounded border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() =>
                  send('components', 'POST', facilityId, {
                    employeeId: selected.id,
                    code: form.code,
                    name: form.name,
                    kind: form.kind,
                    amountCents: parseKesToCents(form.amount).toString(),
                    taxable: form.taxable,
                    effectiveFrom: form.effectiveFrom,
                    effectiveTo: form.effectiveTo || null,
                    statutoryExclusions: form.excludeAhl ? ['AHL'] : [],
                  }),
                );
              }}
            >
              <h3 className="font-bold">Add allowance, overtime, bonus or deduction</h3>
              <label>
                Component code
                <input
                  className={input}
                  required
                  pattern="[A-Za-z0-9_]{2,24}"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </label>
              <label>
                Component name
                <input
                  className={input}
                  required
                  maxLength={120}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                Component kind
                <select
                  className={input}
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value })}
                >
                  <option>EARNING</option>
                  <option>DEDUCTION</option>
                </select>
              </label>
              <label>
                Component amount (KES)
                <input
                  className={input}
                  required
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </label>
              <label>
                Component effective from
                <input
                  className={input}
                  required
                  type="date"
                  value={form.effectiveFrom}
                  onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
                />
              </label>
              <label>
                Component effective to
                <input
                  className={input}
                  type="date"
                  value={form.effectiveTo}
                  onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.taxable}
                  onChange={(e) => setForm({ ...form, taxable: e.target.checked })}
                />{' '}
                Taxable earning (confirm against authority guidance)
              </label>
              <br />
              <label>
                <input
                  type="checkbox"
                  checked={form.excludeAhl}
                  onChange={(e) => setForm({ ...form, excludeAhl: e.target.checked })}
                />{' '}
                Exclude earning from AHL base (only where authoritative treatment supports it)
              </label>
              <br />
              <button className={button} disabled={busy}>
                Add pay component
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

type Reports = {
  run: { id: number; periodName: string };
  payslips: PayrollPayslipDetail[];
  notice: string;
  bankSchedule: Array<{
    employeeNumber: string;
    employeeName: string;
    netCents: string;
    bankName: string | null;
    bankAccountMasked: string | null;
    paymentStatus: string;
  }>;
  remittances: Array<{
    statute: string;
    employeeCents: string;
    employerCents: string;
    totalCents: string;
  }>;
  statutoryRows: unknown[];
};
export function PayrollRunOutputs({
  facilityId,
  runId,
  status,
  renderPayslip,
}: {
  facilityId: number;
  runId: number;
  status: string;
  renderPayslip: (p: PayrollPayslipDetail) => React.ReactNode;
}) {
  const [data, setData] = useState<Reports | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [bulk, setBulk] = useState(false);
  if (status !== 'POSTED')
    return (
      <p>
        Payment/remittance reports and bulk payslips require finalized payroll. POSTED is an
        accounting liability, not proof of salaries paid.
      </p>
    );
  return (
    <section className="space-y-3">
      <p>
        POSTED means finalized to the ledger, not salaries paid or statutory contributions remitted.
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        className={button}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          get<Reports>(`runs/${runId}/reports`, facilityId)
            .then(setData)
            .catch((e) => setError(message(e)))
            .finally(() => setBusy(false));
        }}
      >
        Generate finalized reports &amp; bulk payslips
      </button>
      {data && (
        <>
          <p role="note">{data.notice}</p>
          <div id="payroll-schedules" className="space-y-3">
            <h2>Payroll schedules — {data.run.periodName}</h2>
            <p>
              NOT FILED · PAYMENT NOT EVIDENCED · masked bank review schedule, not bank-upload
              instructions.
            </p>
            <h3>Statutory remittance review</h3>
            <table>
              <thead>
                <tr>
                  <th>Statute</th>
                  <th>Employee KES</th>
                  <th>Employer KES</th>
                  <th>Total KES</th>
                </tr>
              </thead>
              <tbody>
                {data.remittances.map((r) => (
                  <tr key={r.statute}>
                    <td>{r.statute}</td>
                    <td>{centsToKes(BigInt(r.employeeCents))}</td>
                    <td>{centsToKes(BigInt(r.employerCents))}</td>
                    <td>{centsToKes(BigInt(r.totalCents))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Salary bank-payment review schedule</h3>
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Bank / masked account</th>
                  <th>Net KES</th>
                  <th>Payment</th>
                </tr>
              </thead>
              <tbody>
                {data.bankSchedule.map((r) => (
                  <tr key={r.employeeNumber}>
                    <td>
                      {r.employeeNumber} — {r.employeeName}
                    </td>
                    <td>
                      {r.bankName ?? 'Not recorded'} /{' '}
                      {r.bankAccountMasked ?? 'Independent account verification required'}
                    </td>
                    <td>{centsToKes(BigInt(r.netCents))}</td>
                    <td>{r.paymentStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={button} onClick={() => printPayroll('payroll-schedules')}>
              Print schedules
            </button>
            <button
              className={button}
              onClick={() =>
                downloadPayroll(`payroll-${runId}-internal-schedules.json`, {
                  run: data.run,
                  notice: data.notice,
                  bankSchedule: data.bankSchedule,
                  remittances: data.remittances,
                  statutoryRows: data.statutoryRows,
                })
              }
            >
              Download internal schedules
            </button>
            <button className={button} onClick={() => setBulk(true)}>
              View bulk payslips
            </button>
          </div>
          {bulk && (
            <>
              <button className={button} onClick={() => printPayroll('payroll-bulk')}>
                Print all payslips
              </button>
              <div id="payroll-bulk">
                {data.payslips.map((p) => (
                  <article className="payroll-page border-t p-3" key={p.id}>
                    {renderPayslip(p)}
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

export function PayrollHistoryAndForms({
  facilityId,
  canManageRules,
}: {
  facilityId: number;
  canManageRules: boolean;
}) {
  const [history, setHistory] = useState<
      Array<{
        id: number;
        action: string;
        resource: string;
        resourceId: string;
        actorId: string;
        createdAt: string;
      }>
    >([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [form, setForm] = useState({
      formCode: 'P9',
      formVersion: '',
      authorityReference: '',
      effectiveFrom: '',
      effectiveTo: '',
    }),
    [year, setYear] = useState(String(new Date().getUTCFullYear()));
  useEffect(() => {
    let live = true;
    get<{ events: typeof history }>('history', facilityId)
      .then((d) => {
        if (live) setHistory(d.events);
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [facilityId]);
  return (
    <section className="space-y-3">
      <h2 className="font-bold">Payroll audit history &amp; annual extracts</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <p>
        P9/P10 extracts contain posted payroll figures only, not an official submitted return.
        Configure the authority's form version and verify its layout before external filing.
      </p>
      <label>
        Extract form
        <select
          className={input}
          value={form.formCode}
          onChange={(e) => setForm({ ...form, formCode: e.target.value })}
        >
          <option>P9</option>
          <option>P10</option>
        </select>
      </label>
      <label>
        Tax year
        <input
          className={input}
          type="number"
          min="2000"
          max="2100"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
      </label>
      <button
        className={button}
        onClick={() => {
          setError('');
          get(`statutory-extract?formCode=${form.formCode}&taxYear=${year}`, facilityId)
            .then((d) =>
              downloadPayroll(`payroll-${form.formCode}-${year}-internal-extract.json`, d),
            )
            .catch((e) => setError(message(e)));
        }}
      >
        Download annual extract
      </button>
      {canManageRules && (
        <form
          className="space-y-2 rounded border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send('form-profiles', 'POST', facilityId, {
              ...form,
              effectiveTo: form.effectiveTo || null,
            })
              .then(() =>
                setNotice('Authority form profile recorded. This does not file a return.'),
              )
              .catch((e) => setError(message(e)));
          }}
        >
          <h3>Record authority form profile</h3>
          <label>
            Authority form version
            <input
              className={input}
              required
              value={form.formVersion}
              onChange={(e) => setForm({ ...form, formVersion: e.target.value })}
            />
          </label>
          <label>
            Authority form publication reference
            <input
              className={input}
              required
              minLength={8}
              value={form.authorityReference}
              onChange={(e) => setForm({ ...form, authorityReference: e.target.value })}
            />
          </label>
          <label>
            Form effective from
            <input
              className={input}
              type="date"
              required
              value={form.effectiveFrom}
              onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
            />
          </label>
          <label>
            Form effective to
            <input
              className={input}
              type="date"
              value={form.effectiveTo}
              onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
            />
          </label>
          <button className={button}>Save form profile</button>
        </form>
      )}
      <h3>Latest 300 payroll audit events</h3>
      {history.map((e) => (
        <p key={e.id}>
          {e.action} · {e.resource} #{e.resourceId} · staff #{e.actorId} ·{' '}
          {new Date(e.createdAt).toLocaleString()}
        </p>
      ))}
    </section>
  );
}
