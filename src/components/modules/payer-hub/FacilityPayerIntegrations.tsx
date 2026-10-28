import React, { useCallback, useEffect, useRef, useState } from 'react';
import { payerHubApi, type FacilityPayer } from '../../../api/payer-hub.client.ts';
import { useHmis } from '../../../context/HmisContext.tsx';

const card = 'rounded-xl border border-slate-200 bg-white p-4 space-y-3';
const button =
  'rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50';
const secondary =
  'rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50';
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
type Run = (fn: () => Promise<unknown>, message: string) => Promise<void>;

export function FacilityPayerIntegrations() {
  const { currentFacility, authenticatedUser } = useHmis();
  const permissions = new Set(authenticatedUser?.permissions ?? []);
  const isSuper = Boolean(
    authenticatedUser?.isSuperAdmin || authenticatedUser?.roles?.includes('SUPER_ADMIN'),
  );
  const canView = permissions.has('payer_hub.catalogue.read');
  const canManage = permissions.has('payer_hub.facility.manage');
  const canCredentials = permissions.has('payer_hub.credentials.manage');
  const canProduction = permissions.has('payer_hub.production.request');
  const facilityId = currentFacility?.id;
  const [loaded, setLoaded] = useState<{ facilityId: number; providers: FacilityPayer[] } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const load = useCallback(async () => {
    if (!facilityId || !canView || isSuper) return;
    const requestVersion = ++version.current;
    const response = await payerHubApi.catalogue(facilityId);
    if (requestVersion === version.current)
      setLoaded({ facilityId, providers: response.providers });
  }, [facilityId, canView, isSuper]);
  useEffect(() => {
    setLoaded(null);
    setError('');
    setNotice('');
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : 'Could not load the payer catalogue.'),
    );
    return () => {
      version.current += 1;
    };
  }, [load]);
  const run: Run = async (fn, message) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      await load();
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed.');
    } finally {
      setBusy(false);
    }
  };
  if (isSuper)
    return (
      <div className={card}>
        Payer registration and assignments are under Platform Administration. Facility configuration
        requires a facility-scoped account.
      </div>
    );
  if (!canView)
    return <div className={card}>You do not have permission to view payer integrations.</div>;
  if (!currentFacility) return <div className={card}>Select an authorized facility.</div>;
  const providers = loaded?.facilityId === currentFacility.id ? loaded.providers : null;
  return (
    <section aria-label="Facility payer integrations" className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Payer, SHA eClaims &amp; insurance</h2>
        <p className="text-sm text-slate-600">
          {currentFacility.name} · Request and activate only platform-assigned payers.
        </p>
      </div>
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        Manual processing is not a payer API connection. SHA/DHA transport and operational
        simulation are blocked; mocks run only in isolated tests. Sandbox connectivity and
        production are not verified or approved.
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
      {!providers && !error && <p className="text-sm text-slate-500">Loading payer catalogue…</p>}
      {providers?.length === 0 && (
        <p className={card}>No payers are currently available for this facility.</p>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {providers?.map((payer) => (
          <Provider
            key={payer.id}
            payer={payer}
            facilityId={currentFacility.id}
            canManage={canManage}
            canCredentials={canCredentials}
            canProduction={canProduction}
            busy={busy}
            run={run}
          />
        ))}
      </div>
    </section>
  );
}
function Provider({
  payer,
  facilityId,
  canManage,
  canCredentials,
  canProduction,
  busy,
  run,
}: {
  payer: FacilityPayer;
  facilityId: number;
  canManage: boolean;
  canCredentials: boolean;
  canProduction: boolean;
  busy: boolean;
  run: Run;
}) {
  const [environment, setEnvironment] = useState('SANDBOX');
  const [providerIdentifier, setProviderIdentifier] = useState('');
  return (
    <article className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-slate-900">{payer.displayName}</h3>
          <p className="text-xs text-slate-500">
            {payer.code} · {payer.payerType}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">
          {payer.status === 'DISABLED'
            ? 'Globally disabled'
            : !payer.isAssigned
              ? 'Not assigned'
              : payer.isActive
                ? 'Active for internal workflows'
                : 'Assigned, not active'}
        </span>
      </div>
      <a
        href={payer.informationUrl}
        target="_blank"
        rel="noreferrer"
        className="text-xs font-semibold text-teal-700 underline"
      >
        Provider information ↗
      </a>
      <p className="text-xs text-slate-700">{payer.processing}</p>
      <p className="text-xs text-slate-500">
        Connection: {payer.connectionStatus} · Sandbox: {payer.sandboxStatus} · Production:{' '}
        {payer.productionApproval}
      </p>
      {payer.assignmentSource === 'LEGACY_REVIEW_REQUIRED' && (
        <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">
          Legacy configuration preserved; platform assignment review is required before new
          operations.
        </p>
      )}
      {!payer.isAssigned ? (
        canManage &&
        payer.status === 'ACTIVE' &&
        payer.requestable && (
          <button
            className={button}
            disabled={busy || payer.requestStatus === 'PENDING'}
            onClick={() =>
              void run(
                () => payerHubApi.requestAccess(payer.id, facilityId),
                'Access requested from the platform administrator.',
              )
            }
          >
            {payer.requestStatus === 'PENDING' ? 'Request pending' : 'Request access'}
          </button>
        )
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {canManage && (
              <button
                className={payer.isActive ? secondary : button}
                disabled={busy || (payer.status !== 'ACTIVE' && !payer.isActive)}
                onClick={() =>
                  void run(
                    () => payerHubApi.activate(payer.id, facilityId, !payer.isActive),
                    payer.isActive
                      ? 'Payer deactivated for new workflows.'
                      : 'Payer activated for permitted internal workflows.',
                  )
                }
              >
                {payer.isActive ? 'Deactivate' : 'Activate accepted payer'}
              </button>
            )}
            {canManage && (
              <button
                className={secondary}
                disabled={busy || payer.status !== 'ACTIVE'}
                onClick={() =>
                  void run(async () => {
                    const result = await payerHubApi.test(payer.id, facilityId);
                    if (!result.tested) throw new Error(result.message);
                  }, 'Connection test completed.')
                }
              >
                Check connection availability
              </button>
            )}
            {canProduction && (
              <button
                className={secondary}
                disabled={
                  busy || payer.status !== 'ACTIVE' || payer.productionApproval === 'PENDING'
                }
                onClick={() =>
                  void run(
                    () => payerHubApi.production(payer.id, facilityId),
                    'Production review requested; live transport remains blocked.',
                  )
                }
              >
                Request production review
              </button>
            )}
          </div>
          {payer.isActive && (
            <div>
              <p className="text-xs font-semibold">Allowed internal workflows</p>
              <p className="text-xs text-slate-600">
                {payer.workflows.length
                  ? payer.workflows.map((v) => v.replaceAll('_', ' ')).join(' · ')
                  : 'None enabled'}
              </p>
            </div>
          )}
          {canCredentials && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold">
                Server-side credential reference
              </summary>
              <p className="mt-1 text-xs text-slate-500">
                No passwords, API keys or tokens are accepted in the browser. References are unique
                to this facility and environment; no live transport is enabled.
              </p>
              <form
                className="mt-2 grid gap-2 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    () =>
                      payerHubApi.configure(payer.id, facilityId, environment, providerIdentifier),
                    'Facility-specific reference saved; connectivity not tested.',
                  );
                }}
              >
                <label className="text-xs">
                  Environment
                  <select
                    className={field}
                    value={environment}
                    onChange={(e) => setEnvironment(e.target.value)}
                  >
                    <option>SANDBOX</option>
                    <option>PRODUCTION</option>
                  </select>
                </label>
                <label className="text-xs">
                  Provider identifier (optional)
                  <input
                    className={field}
                    value={providerIdentifier}
                    onChange={(e) => setProviderIdentifier(e.target.value)}
                  />
                </label>
                <button className={secondary} disabled={busy || payer.status !== 'ACTIVE'}>
                  Save reference
                </button>
              </form>
              {payer.environments.map((e) => (
                <p key={e.environment} className="mt-2 break-all text-xs text-slate-600">
                  {e.environment}: {e.secretReference} · credentials{' '}
                  {e.configured ? 'present' : 'not provisioned'} · not tested
                </p>
              ))}
            </details>
          )}
        </>
      )}
    </article>
  );
}
