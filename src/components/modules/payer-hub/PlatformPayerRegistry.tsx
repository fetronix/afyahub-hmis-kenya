import React, { useCallback, useEffect, useState } from 'react';
import {
  payerHubApi,
  type PayerAssignment,
  type PlatformPayer,
} from '../../../api/payer-hub.client.ts';
import { useHmis } from '../../../context/HmisContext.tsx';

const card = 'rounded-xl border border-slate-200 bg-white p-4 space-y-3';
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const button =
  'rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50';
const secondary =
  'rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50';

export function PlatformPayerRegistry() {
  const { authenticatedUser } = useHmis();
  const perms = new Set(authenticatedUser?.permissions ?? []);
  const superAdmin = Boolean(
    authenticatedUser?.isSuperAdmin || authenticatedUser?.roles?.includes('SUPER_ADMIN'),
  );
  const canRead = superAdmin || perms.has('payer_hub.global.read');
  const canManage = superAdmin || perms.has('payer_hub.global.manage');
  const canAssign = superAdmin || perms.has('payer_hub.assign');
  const canDecide = superAdmin || perms.has('payer_hub.production.approve');
  const [data, setData] = useState<{
    providers: PlatformPayer[];
    assignments: PayerAssignment[];
    requests: Array<{
      id: number;
      providerId: number;
      facilityId: number;
      facilityName: string;
      status: string;
    }>;
    notice: string;
  } | null>(null);
  const [facilities, setFacilities] = useState<
    Array<{ id: number; tenantId: number; name: string }>
  >([]);
  const [facilityId, setFacilityId] = useState('');
  const [form, setForm] = useState({ code: '', displayName: '', informationUrl: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!canRead || !superAdmin) return;
    const [registry, allFacilities] = await Promise.all([
      payerHubApi.platform(),
      canAssign ? payerHubApi.facilities() : Promise.resolve({ facilities: [] }),
    ]);
    setData(registry);
    setFacilities(allFacilities.facilities);
  }, [canRead, canAssign, superAdmin]);
  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load payers.'));
  }, [load]);
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await load();
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed.');
    } finally {
      setBusy(false);
    }
  };
  if (!superAdmin || !canRead)
    return (
      <div className={card}>Platform payer administration requires a super administrator.</div>
    );
  return (
    <section aria-label="Platform payer registry" className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Payer &amp; eClaims registry</h2>
        <p className="text-sm text-slate-600">
          Set platform policy and facility assignments. This view does not expose patient claims or
          facility credentials.
        </p>
      </div>
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        Registration and internal workflow policy do not establish a provider API contract or
        connection. No payer sandbox or production connection is verified.
      </p>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
          {notice}
        </p>
      )}
      {canManage && (
        <details className={card}>
          <summary className="cursor-pointer font-semibold">Register another payer</summary>
          <p className="text-xs text-slate-500">
            New payers start disabled with a manual-only adapter. Registration does not implement an
            API.
          </p>
          <form
            className="grid gap-2 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await payerHubApi.register(form);
                setForm({ code: '', displayName: '', informationUrl: '' });
              }, 'Payer registered as disabled and manual-only.');
            }}
          >
            <label className="text-xs font-medium">
              Code
              <input
                className={field}
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              />
            </label>
            <label className="text-xs font-medium">
              Name
              <input
                className={field}
                required
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium">
              Official information URL
              <input
                className={field}
                required
                type="url"
                value={form.informationUrl}
                onChange={(e) => setForm({ ...form, informationUrl: e.target.value })}
              />
            </label>
            <button className={button} disabled={busy}>
              Register
            </button>
          </form>
        </details>
      )}
      {canAssign && (
        <label className="block max-w-md text-xs font-semibold">
          Facility for assignment
          <select
            className={field}
            value={facilityId}
            onChange={(e) => setFacilityId(e.target.value)}
          >
            <option value="">Select a facility</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} · #{f.id}
              </option>
            ))}
          </select>
        </label>
      )}
      {data?.requests.length ? (
        <div className={card}>
          <h3 className="font-semibold">Pending facility requests</h3>
          {data.requests.map((r) => (
            <p key={r.id} className="text-sm">
              {r.facilityName} requests{' '}
              {data.providers.find((p) => p.id === r.providerId)?.displayName ?? 'payer'} — select
              that facility below to assign.
            </p>
          ))}
        </div>
      ) : null}
      {!data && !error && <p className="text-sm text-slate-500">Loading registry…</p>}
      <div className="grid gap-4 xl:grid-cols-2">
        {data?.providers.map((p) => {
          const assignment = data.assignments.find(
            (a) => a.providerId === p.id && a.facilityId === Number(facilityId),
          );
          return (
            <article key={p.id} className={card}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold">{p.displayName}</h3>
                  <p className="text-xs text-slate-500">
                    {p.code} · {p.payerType} · platform adapter {p.adapterKey}
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{p.status}</span>
              </div>
              <a
                className="text-xs font-semibold text-teal-700 underline"
                href={p.informationUrl}
                target="_blank"
                rel="noreferrer"
              >
                Official information ↗
              </a>
              <p className="text-xs text-slate-600">
                Facility manual workflows only; API onboarding and verification remain separate.
              </p>
              <div className="flex flex-wrap gap-2">
                {canManage && (
                  <button
                    className={secondary}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          payerHubApi.update(p.id, {
                            status: p.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
                          }),
                        p.status === 'ACTIVE'
                          ? 'Payer globally disabled; historical claims remain.'
                          : 'Payer globally enabled; facility assignment is still required.',
                      )
                    }
                  >
                    {p.status === 'ACTIVE' ? 'Disable globally' : 'Enable globally'}
                  </button>
                )}
                {canAssign && (
                  <button
                    className={button}
                    disabled={
                      busy || !facilityId || (p.status !== 'ACTIVE' && !assignment?.isAllowed)
                    }
                    onClick={() =>
                      void run(
                        () => payerHubApi.assign(p.id, Number(facilityId), !assignment?.isAllowed),
                        assignment?.isAllowed
                          ? 'Facility assignment revoked.'
                          : 'Payer assigned; the facility must activate it.',
                      )
                    }
                  >
                    {assignment?.isAllowed ? 'Revoke assignment' : 'Assign to facility'}
                  </button>
                )}
              </div>
              {assignment && (
                <p className="text-xs text-slate-500">
                  Assignment: {assignment.isAllowed ? 'allowed' : 'not allowed'} ·{' '}
                  {assignment.assignmentSource} · Sandbox {assignment.sandboxStatus} · Production{' '}
                  {assignment.productionApproval}
                </p>
              )}
              <details>
                <summary className="cursor-pointer text-xs font-semibold">
                  Internal workflow policy
                </summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {p.capabilities.map((c) => (
                    <label key={c.capability} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={c.isAllowed}
                        disabled={!canManage || busy}
                        onChange={(e) =>
                          void run(
                            () => payerHubApi.workflow(p.id, c.capability, e.target.checked),
                            'Workflow policy updated.',
                          )
                        }
                      />
                      {c.capability.replaceAll('_', ' ')}
                    </label>
                  ))}
                </div>
              </details>
            </article>
          );
        })}
      </div>
      {data?.assignments.some((a) => a.productionApproval === 'PENDING') && (
        <div className={card}>
          <h3 className="font-semibold">Production requests</h3>
          <p className="text-xs text-amber-800">
            Approval is blocked until an isolated transport passes authorized sandbox and security
            verification.
          </p>
          {data.assignments
            .filter((a) => a.productionApproval === 'PENDING')
            .map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span>
                  {a.facilityName} ·{' '}
                  {data.providers.find((p) => p.id === a.providerId)?.displayName}
                </span>
                {canDecide && (
                  <button
                    className={secondary}
                    disabled={busy}
                    onClick={() => {
                      const reference = window.prompt(
                        'Decision reference (no secrets or patient data):',
                      );
                      if (reference)
                        void run(
                          () => payerHubApi.decide(a.id, 'REJECTED', reference),
                          'Production request rejected.',
                        );
                    }}
                  >
                    Reject request
                  </button>
                )}
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
