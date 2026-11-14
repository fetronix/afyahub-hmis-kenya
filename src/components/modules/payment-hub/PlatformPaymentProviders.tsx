import React, { useCallback, useEffect, useState } from 'react';
import { paymentHubApi, type PlatformProvider } from '../../../api/payment-hub.client.ts';
import { useHmis } from '../../../context/HmisContext.tsx';

const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const button =
  'rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50';
const secondary =
  'rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50';
const card = 'rounded-xl border border-slate-200 bg-white p-4 space-y-3';

type Data = Awaited<ReturnType<typeof paymentHubApi.platform>>;
export const PlatformPaymentProviders: React.FC = () => {
  const { authenticatedUser } = useHmis();
  const permissions = new Set(authenticatedUser?.permissions ?? []);
  const canManage = permissions.has('payment_hub.global.manage'),
    canAssign = permissions.has('payment_hub.assign'),
    canApprove = permissions.has('payment_hub.production.approve');
  const [data, setData] = useState<Data | null>(null);
  const [facilities, setFacilities] = useState<
    Array<{ id: number; tenantId: number; name: string }>
  >([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [facilityId, setFacilityId] = useState('');
  const [allowShared, setAllowShared] = useState(false);
  const [form, setForm] = useState({
    code: '',
    displayName: '',
    documentationUrl: '',
    description: '',
  });
  const load = useCallback(async () => {
    setError('');
    try {
      const d = await paymentHubApi.platform();
      setData(d);
      if (canAssign) setFacilities((await paymentHubApi.facilities()).facilities);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load providers.');
    }
  }, [canAssign]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed.');
    } finally {
      setBusy(false);
    }
  };
  const changeStatus = (p: PlatformProvider) => {
    const disable = p.status === 'ACTIVE';
    if (
      disable &&
      !window.confirm(
        `Disable ${p.displayName} for all facilities? In-flight requests and financial history will remain.`,
      )
    )
      return;
    void run(
      () =>
        paymentHubApi.updateProvider(p.id, {
          status: disable ? 'DISABLED' : 'ACTIVE',
          requestable: p.requestable,
        }),
      disable
        ? 'Provider disabled centrally. Existing history is unchanged.'
        : 'Provider enabled; facilities still need an assignment.',
    );
  };
  if (!authenticatedUser?.isSuperAdmin && !authenticatedUser?.roles?.includes('SUPER_ADMIN'))
    return <div className={card}>Platform administrator access is required.</div>;
  if (!permissions.has('payment_hub.global.read'))
    return (
      <div className={card}>
        You do not have permission to view the global provider catalogue. Run the permission seed or
        request access.
      </div>
    );
  return (
    <section className="space-y-4" aria-label="Payment and banking providers">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Payment &amp; Banking Providers</h2>
        <p className="mt-1 text-sm text-slate-600">
          A shared platform registry; facility credentials, balances and transactions are not
          visible here.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      {!data && !error && <p className="text-sm text-slate-500">Loading providers…</p>}
      {canManage && (
        <details className={card}>
          <summary className="cursor-pointer font-semibold">
            Register an additional provider
          </summary>
          <p className="text-xs text-slate-500">
            New definitions start disabled with an unconfigured adapter. Registration does not
            implement an API.
          </p>
          <form
            className="grid gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await paymentHubApi.register(form);
                setForm({ code: '', displayName: '', documentationUrl: '', description: '' });
              }, 'Provider registered as unconfigured.');
            }}
          >
            {(
              [
                ['code', 'Provider code'],
                ['displayName', 'Display name'],
                ['documentationUrl', 'Official documentation URL'],
                ['description', 'Description'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="text-xs font-medium">
                {label}
                <input
                  className={field}
                  required
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
            <button disabled={busy} className={button}>
              Register provider
            </button>
          </form>
        </details>
      )}
      {canAssign && (
        <div className="max-w-lg space-y-2">
          <label className="block text-xs font-semibold">
            Facility to assign
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
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={allowShared}
              onChange={(e) => setAllowShared(e.target.checked)}
            />
            Contract permits this facility to use a recorded shared reference (not operational)
          </label>
        </div>
      )}
      {data?.providers.length === 0 && <p className={card}>No providers have been registered.</p>}
      <div className="grid gap-4 xl:grid-cols-2">
        {data?.providers.map((p) => (
          <article className={card} key={p.id}>
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <h3 className="font-bold text-slate-900">{p.displayName}</h3>
                <p className="text-xs text-slate-500">
                  {p.code} · {p.status} · adapter {p.adapterKey}
                </p>
              </div>
              <a
                className="text-xs font-semibold text-teal-700 underline"
                href={p.documentationUrl}
                target="_blank"
                rel="noreferrer"
              >
                Official information ↗
              </a>
            </div>
            <p className="text-sm text-slate-600">{p.description}</p>
            <p className="text-xs text-amber-800">{p.adapter.note}</p>
            <p className="text-xs text-slate-600">
              Implemented:{' '}
              {p.adapter.implementedCapabilities.length
                ? p.adapter.implementedCapabilities.join(', ')
                : 'none'}{' '}
              · Assigned facilities: {p.assignedFacilities} · Enabled configurations:{' '}
              {p.enabledIntegrations} · Unavailable checks: {p.unavailableIntegrations}
            </p>
            <div className="flex flex-wrap gap-2">
              {canManage && (
                <>
                  <button disabled={busy} className={secondary} onClick={() => changeStatus(p)}>
                    {p.status === 'ACTIVE' ? 'Disable globally' : 'Enable globally'}
                  </button>
                  <button
                    disabled={busy}
                    className={secondary}
                    onClick={() =>
                      void run(
                        () =>
                          paymentHubApi.updateProvider(p.id, {
                            status: p.status,
                            requestable: !p.requestable,
                          }),
                        `Access requests ${p.requestable ? 'disabled' : 'enabled'}.`,
                      )
                    }
                  >
                    {p.requestable ? 'Stop requests' : 'Allow requests'}
                  </button>
                </>
              )}
              {canAssign && (
                <button
                  disabled={busy || !facilityId || p.status !== 'ACTIVE'}
                  className={button}
                  onClick={() =>
                    void run(
                      () =>
                        paymentHubApi.assign(p.id, Number(facilityId), {
                          isAllowed: true,
                          sharedCredentialsAllowed: allowShared,
                        }),
                      'Provider assigned. The facility must complete setup.',
                    )
                  }
                >
                  Assign selected facility
                </button>
              )}
            </div>
            <div className="space-y-2 border-t border-slate-100 pt-2">
              <h4 className="text-xs font-bold">Capability policy</h4>
              {p.capabilities.length === 0 && (
                <p className="text-xs text-slate-500">
                  No implemented capabilities can be enabled.
                </p>
              )}
              {p.capabilities.map((policy) => (
                <div key={policy.capability} className="flex flex-wrap items-center gap-2 text-xs">
                  <span>
                    {policy.capability.replaceAll('_', ' ')} ·{' '}
                    {policy.isAllowed ? 'Allowed' : 'Restricted'}
                  </span>
                  {canManage && (
                    <button
                      className={secondary}
                      disabled={busy}
                      onClick={() => {
                        if (
                          policy.isAllowed &&
                          !window.confirm(
                            `Restrict ${policy.capability} for all facilities? Existing configurations will be disabled.`,
                          )
                        )
                          return;
                        void run(
                          () =>
                            paymentHubApi.updateCapability(
                              p.id,
                              policy.capability,
                              !policy.isAllowed,
                            ),
                          'Capability policy updated; affected configurations require review.',
                        );
                      }}
                    >
                      {policy.isAllowed ? 'Restrict' : 'Allow'}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="space-y-2 border-t border-slate-100 pt-2">
              {p.environments.map((env) => (
                <div key={env.environment} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold">{env.environment}</span>
                  <span>{env.isAvailable ? 'Available by assignment' : 'Unavailable'}</span>
                  <span>
                    · shared reference {env.sharedReferenceConfigured ? 'recorded' : 'not recorded'}{' '}
                    (not operational)
                  </span>
                  {canManage && (
                    <button
                      className={secondary}
                      disabled={busy}
                      onClick={() => {
                        if (
                          env.isAvailable &&
                          !window.confirm(`Disable ${env.environment} for all assigned facilities?`)
                        )
                          return;
                        void run(
                          () =>
                            paymentHubApi.updateEnvironment(p.id, env.environment, {
                              isAvailable: !env.isAvailable,
                            }),
                          'Environment policy updated.',
                        );
                      }}
                    >
                      {env.isAvailable ? 'Disable' : 'Make available'}
                    </button>
                  )}
                </div>
              ))}
            </div>
            {canManage && (
              <>
                <ProviderMetadataEditor provider={p} busy={busy} run={run} />
                <SharedReference provider={p} busy={busy} run={run} />
              </>
            )}
            <div className="space-y-2 border-t border-slate-100 pt-2">
              <h4 className="text-xs font-bold">Facility setup status</h4>
              {!data.assignments.some((a) => a.providerId === p.id) && (
                <p className="text-xs text-slate-500">No facilities assigned.</p>
              )}
              {data.assignments
                .filter((a) => a.providerId === p.id)
                .map((a) => (
                  <div className="rounded bg-slate-50 p-2 text-xs" key={a.facilityId}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {a.facilityName} · {a.isAllowed ? 'allowed' : 'revoked'}
                        {a.sharedCredentialsAllowed
                          ? ' · shared reference permitted (not operational)'
                          : ''}
                      </span>
                      {canAssign && a.isAllowed && (
                        <button
                          className={secondary}
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Revoke ${p.displayName} for ${a.facilityName}? History will be retained.`,
                              )
                            )
                              void run(
                                () =>
                                  paymentHubApi.assign(p.id, a.facilityId, { isAllowed: false }),
                                'Availability revoked; history retained.',
                              );
                          }}
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                    {a.integrations.length === 0 ? (
                      <p className="mt-1 text-slate-500">Facility setup not started.</p>
                    ) : (
                      a.integrations.map((i) => (
                        <div key={i.id} className="mt-1 flex flex-wrap items-center gap-2">
                          <span>
                            {i.environment}: {i.enabled ? 'enabled' : 'disabled'} ·{' '}
                            {i.connectionStatus} · approval {i.productionApproval}
                          </span>
                          {canApprove && i.productionApproval === 'PENDING' && (
                            <>
                              <button
                                disabled={busy}
                                className={secondary}
                                onClick={() => {
                                  const ref = window.prompt(
                                    'Provider approval evidence reference (no credentials or patient details):',
                                  );
                                  if (ref)
                                    void run(
                                      () =>
                                        paymentHubApi.decideProduction(i.id, {
                                          decision: 'APPROVED',
                                          approvalReference: ref,
                                        }),
                                      'Decision recorded; production remains blocked until the adapter is ready.',
                                    );
                                }}
                              >
                                Approve request
                              </button>
                              <button
                                disabled={busy}
                                className={secondary}
                                onClick={() => {
                                  const ref = window.prompt('Rejection reference:');
                                  if (ref)
                                    void run(
                                      () =>
                                        paymentHubApi.decideProduction(i.id, {
                                          decision: 'REJECTED',
                                          approvalReference: ref,
                                        }),
                                      'Production request rejected.',
                                    );
                                }}
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                ))}
            </div>
          </article>
        ))}
      </div>
      {data && (
        <div className={card}>
          <h3 className="font-semibold">Pending access requests</h3>
          {data.requests.length === 0 ? (
            <p className="text-xs text-slate-500">No pending requests.</p>
          ) : (
            data.requests.map((r) => (
              <div
                key={`${r.providerId}-${r.facilityId}`}
                className="flex flex-wrap items-center gap-3 text-sm"
              >
                <span>
                  {r.facilityName} ·{' '}
                  {data.providers.find((p) => p.id === r.providerId)?.displayName ?? 'Provider'}
                </span>
                {canAssign && (
                  <button
                    disabled={busy}
                    className={secondary}
                    onClick={() =>
                      void run(
                        () => paymentHubApi.assign(r.providerId, r.facilityId, { isAllowed: true }),
                        'Access granted; facility setup is still required.',
                      )
                    }
                  >
                    Grant access
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
      {data && (
        <details className={card}>
          <summary className="cursor-pointer font-semibold">Safe integration audit events</summary>
          <p className="text-xs text-slate-500">
            Administrative metadata only; no bank-account or patient details.
          </p>
          {data.auditEvents.length === 0 ? (
            <p className="text-xs">No events yet.</p>
          ) : (
            data.auditEvents.map((e) => (
              <p className="text-xs text-slate-600" key={e.id}>
                {new Date(e.timestamp).toLocaleString()} · {e.action} · {e.resource}
                {e.facilityId ? ` · facility #${e.facilityId}` : ''}
              </p>
            ))
          )}
        </details>
      )}
    </section>
  );
};
function SharedReference({
  provider,
  busy,
  run,
}: {
  provider: PlatformProvider;
  busy: boolean;
  run: (fn: () => Promise<unknown>, msg: string) => Promise<void>;
}) {
  const [env, setEnv] = useState<'SANDBOX' | 'PRODUCTION'>('SANDBOX');
  const [ref, setRef] = useState('');
  const [contract, setContract] = useState('');
  const selected = provider.environments.find((e) => e.environment === env);
  return (
    <details>
      <summary className="cursor-pointer text-xs font-semibold">
        Shared credential reference (not operational)
      </summary>
      <p className="my-2 text-xs text-slate-500">
        Only when the provider contract permits sharing. Facility routing is not implemented; this
        reference cannot be used for payment operations.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <select
          className={field}
          value={env}
          onChange={(e) => setEnv(e.target.value as 'SANDBOX' | 'PRODUCTION')}
        >
          <option>SANDBOX</option>
          <option>PRODUCTION</option>
        </select>
        <input
          className={field}
          placeholder="env:PAYMENT_HUB_SHARED_…"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
        <input
          className={field}
          placeholder="Provider contract reference"
          value={contract}
          onChange={(e) => setContract(e.target.value)}
        />
        <button
          className={secondary}
          disabled={busy || !ref || !contract || !selected}
          onClick={() =>
            void run(async () => {
              await paymentHubApi.updateEnvironment(provider.id, env, {
                isAvailable: selected!.isAvailable,
                sharedSecretReference: ref,
                sharedContractReference: contract,
              });
              setRef('');
              setContract('');
            }, 'Reference recorded; shared use remains disabled.')
          }
        >
          Save reference
        </button>
      </div>
    </details>
  );
}

function ProviderMetadataEditor({
  provider,
  busy,
  run,
}: {
  provider: PlatformProvider;
  busy: boolean;
  run: (fn: () => Promise<unknown>, msg: string) => Promise<void>;
}) {
  const [name, setName] = useState(provider.displayName);
  const [docs, setDocs] = useState(provider.documentationUrl);
  const [description, setDescription] = useState(provider.description);
  return (
    <details>
      <summary className="cursor-pointer text-xs font-semibold">
        Edit non-secret provider information
      </summary>
      <form
        className="mt-2 grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              paymentHubApi.updateProvider(provider.id, {
                status: provider.status,
                requestable: provider.requestable,
                displayName: name,
                documentationUrl: docs,
                description,
              }),
            'Provider information updated.',
          );
        }}
      >
        <label className="text-xs">
          Display name
          <input
            className={field}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Official information URL
          <input
            className={field}
            required
            value={docs}
            onChange={(e) => setDocs(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Description
          <input
            className={field}
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <button className={secondary} disabled={busy}>
          Save information
        </button>
      </form>
    </details>
  );
}
