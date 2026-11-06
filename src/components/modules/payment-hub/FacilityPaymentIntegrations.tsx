import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  paymentHubApi,
  type FacilityProvider,
  type HubIntegration,
} from '../../../api/payment-hub.client.ts';
import { useHmis } from '../../../context/HmisContext.tsx';
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const button =
  'rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50';
const secondary =
  'rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50';
const card = 'rounded-xl border border-slate-200 bg-white p-4 space-y-3';
type Run = (action: () => Promise<unknown>, message: string) => Promise<void>;

export const FacilityPaymentIntegrations: React.FC<{
  category?: 'all' | 'mobile' | 'banking';
}> = ({ category = 'all' }) => {
  const { currentFacility, authenticatedUser } = useHmis();
  const permissions = new Set(authenticatedUser?.permissions ?? []);
  const isSuper = Boolean(
    authenticatedUser?.isSuperAdmin || authenticatedUser?.roles?.includes('SUPER_ADMIN'),
  );
  const isFacilityAdmin = Boolean(!isSuper && authenticatedUser?.roles?.includes('FACILITY_ADMIN'));
  const canView = permissions.has('payment_hub.catalogue.read'),
    canManage = isFacilityAdmin && permissions.has('payment_hub.facility.manage'),
    canCredentials = isFacilityAdmin && permissions.has('payment_hub.credentials.manage'),
    canRequestProduction = isFacilityAdmin && permissions.has('payment_hub.production.request'),
    canAccounts = permissions.has('payment_hub.accounts.read');
  const [scopedData, setScopedData] = useState<{
    facilityId: number;
    data: { providers: FacilityProvider[]; notice: string };
  } | null>(null);
  const data = scopedData && scopedData.facilityId === currentFacility?.id ? scopedData.data : null;
  const requestVersion = useRef(0);
  const facilityId = currentFacility?.id;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!facilityId || !canView || isSuper) return;
    const version = ++requestVersion.current;
    setError('');
    try {
      const result = await paymentHubApi.catalogue(facilityId);
      if (version === requestVersion.current) setScopedData({ facilityId, data: result });
    } catch (e) {
      if (version === requestVersion.current)
        setError(e instanceof Error ? e.message : 'Unable to load integrations.');
    }
  }, [facilityId, canView, isSuper]);
  useEffect(() => {
    setScopedData(null);
    setNotice('');
    void load();
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);
  const run: Run = async (action, message) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(message);
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Operation failed.';
      // A failed OAuth check is persisted as UNAVAILABLE. Refresh that status
      // even though the action is reported as an error.
      await load();
      setError(message);
    } finally {
      setBusy(false);
    }
  };
  if (isSuper)
    return (
      <div className={card}>
        Provider administration is under Platform Administration → Payment &amp; Banking Providers.
        Facility configuration requires an authorized facility user.
      </div>
    );
  if (!canView)
    return <div className={card}>You do not have permission to view payment integrations.</div>;
  if (!currentFacility)
    return <div className={card}>No authorized active facility is selected.</div>;
  const providers = data?.providers.filter((provider) => {
    if (category === 'all') return true;
    if (category === 'mobile') return provider.adapterKey === 'MPESA_DARAJA';
    return ['KCB_BUNI', 'NCBA', 'EQUITY'].includes(provider.adapterKey);
  });
  return (
    <section className="space-y-4" aria-label="Facility payment and banking integrations">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Payment &amp; Banking Integrations</h2>
        <p className="mt-1 text-sm text-slate-600">
          {currentFacility.name} · Facility-owned settings. A sandbox request is not a real payment.
        </p>
      </div>
      <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
        Production is blocked pending provider approvals, sandbox evidence and security review. An
        OAuth check does not verify an account or payment. Bank APIs and transfers are unavailable.
      </p>
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
      {!data && !error && <p className="text-sm text-slate-500">Loading facility catalogue…</p>}
      {providers?.length === 0 && (
        <p className={card}>
          No providers in this category are currently available or open for requests.
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {providers?.map((p) => (
          <Provider
            key={p.id}
            provider={p}
            facilityId={currentFacility.id}
            canManage={canManage}
            canCredentials={canCredentials}
            canRequestProduction={canRequestProduction}
            canAccounts={canAccounts}
            busy={busy}
            run={run}
          />
        ))}
      </div>
    </section>
  );
};
function Provider({
  provider: p,
  facilityId,
  canManage,
  canCredentials,
  canRequestProduction,
  canAccounts,
  busy,
  run,
}: {
  provider: FacilityProvider;
  facilityId: number;
  canManage: boolean;
  canCredentials: boolean;
  canRequestProduction: boolean;
  canAccounts: boolean;
  busy: boolean;
  run: Run;
}) {
  const [env, setEnv] = useState<'SANDBOX' | 'PRODUCTION'>('SANDBOX');
  const [selected, setSelected] = useState<string[]>(
    p.integrations.find((integration) => integration.environment === 'SANDBOX')
      ?.enabledCapabilities ?? [],
  );
  const capabilities = p.adapter.implementedCapabilities;
  return (
    <article className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-slate-900">{p.displayName}</h3>
          <p className="text-xs text-slate-500">
            {p.isAllowed
              ? 'Available to your facility'
              : `Not enabled · access ${p.requestStatus.toLowerCase()}`}
          </p>
        </div>
        <a
          href={p.documentationUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-semibold text-teal-700 underline"
        >
          Provider information ↗
        </a>
      </div>
      <p className="text-sm text-slate-600">{p.description}</p>
      <p className="text-xs text-amber-800">{p.adapter.note}</p>
      {!p.isAllowed ? (
        <>
          {canManage && p.status !== 'DISABLED' && p.requestable !== false && (
            <button
              disabled={busy || p.requestStatus === 'PENDING'}
              className={button}
              onClick={() =>
                void run(
                  () => paymentHubApi.access(p.id, facilityId),
                  'Access request sent to the platform administrator.',
                )
              }
            >
              {p.requestStatus === 'PENDING' ? 'Request pending' : 'Request access'}
            </button>
          )}
          {canCredentials &&
            p.integrations
              .filter((i) => i.credentialsConfigured)
              .map((i) => (
                <div key={i.id} className="rounded border border-amber-200 bg-amber-50 p-3 text-xs">
                  <p>
                    {i.environment} · configuration #{i.id} · provider disabled or unassigned ·{' '}
                    {i.credentialsRevoked ? 'credentials revoked' : 'credentials retained'}
                  </p>
                  {!i.credentialsRevoked && (
                    <button
                      type="button"
                      className={secondary}
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            'Revoke these credentials and disable this integration? Provider requests already in flight must be reviewed separately.',
                          )
                        )
                          void run(
                            () => paymentHubApi.revokeCredentials(i.id, facilityId),
                            'Credentials revoked and integration disabled. Replace them before testing again.',
                          );
                      }}
                    >
                      Revoke stored credentials
                    </button>
                  )}
                  <button
                    type="button"
                    className={secondary}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => paymentHubApi.reencryptCredentials(i.id, facilityId),
                        'Credentials re-encrypted with the active server vault key. Provider credentials were not changed.',
                      )
                    }
                  >
                    Re-encrypt with active vault key
                  </button>
                </div>
              ))}
        </>
      ) : (
        <>
          {canManage && (
            <details className="rounded-lg bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-semibold">
                Configure an environment and capabilities
              </summary>
              <div className="mt-3 space-y-2">
                <label className="block text-xs font-semibold">
                  Authorized environment
                  <select
                    className={field}
                    value={env}
                    onChange={(e) => {
                      const next = e.target.value as 'SANDBOX' | 'PRODUCTION';
                      setEnv(next);
                      setSelected(
                        p.integrations.find((integration) => integration.environment === next)
                          ?.enabledCapabilities ?? [],
                      );
                    }}
                  >
                    <option value="SANDBOX" disabled={!p.availableEnvironments.includes('SANDBOX')}>
                      Sandbox {p.availableEnvironments.includes('SANDBOX') ? '' : '(unavailable)'}
                    </option>
                    <option
                      value="PRODUCTION"
                      disabled={!p.availableEnvironments.includes('PRODUCTION')}
                    >
                      Production{' '}
                      {p.availableEnvironments.includes('PRODUCTION') ? '' : '(unavailable)'}
                    </option>
                  </select>
                </label>
                {capabilities.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No operations are implemented for this provider yet. You can record setup, but
                    cannot enable it.
                  </p>
                ) : (
                  capabilities.map((cap) => (
                    <label className="mr-4 inline-flex items-center gap-1 text-xs" key={cap}>
                      <input
                        type="checkbox"
                        checked={selected.includes(cap)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, cap]
                              : selected.filter((x) => x !== cap),
                          )
                        }
                      />
                      {cap}
                    </label>
                  ))
                )}
                <button
                  disabled={busy || !p.availableEnvironments.includes(env)}
                  className={button}
                  onClick={() =>
                    void run(
                      () =>
                        paymentHubApi.configure(p.id, {
                          facilityId,
                          environment: env,
                          capabilities: selected.filter((capability) =>
                            capabilities.includes(capability),
                          ),
                        }),
                      'Environment settings saved. Changes may require a new health check and approval.',
                    )
                  }
                >
                  Save environment
                </button>
              </div>
            </details>
          )}
          {p.integrations.length === 0 && (
            <p className="text-xs text-slate-500">Setup has not been started.</p>
          )}
          {p.integrations.map((i) => (
            <Integration
              key={i.id}
              integration={i}
              provider={p}
              facilityId={facilityId}
              canManage={canManage}
              canCredentials={canCredentials}
              canRequestProduction={canRequestProduction}
              canAccounts={canAccounts}
              busy={busy}
              run={run}
            />
          ))}
        </>
      )}
    </article>
  );
}
function Integration({
  integration: i,
  provider,
  facilityId,
  canManage,
  canCredentials,
  canRequestProduction,
  canAccounts,
  busy,
  run,
}: {
  integration: HubIntegration;
  provider: FacilityProvider;
  facilityId: number;
  canManage: boolean;
  canCredentials: boolean;
  canRequestProduction: boolean;
  canAccounts: boolean;
  busy: boolean;
  run: Run;
}) {
  const [secretReference, setSecretReference] = useState('');
  const [account, setAccount] = useState({
    alias: '',
    lastFour: '',
    accountType: provider.code === 'MPESA_DARAJA' ? 'MOBILE_MONEY' : 'BANK',
    bankAccountId: '',
  });
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <span>
          {i.environment} · configuration #{i.id}
        </span>
        <span
          className={`rounded px-2 py-1 text-xs ${i.isEffective ? 'bg-teal-50 text-teal-800' : 'bg-slate-100 text-slate-600'}`}
        >
          {i.isEffective
            ? i.environment === 'SANDBOX'
              ? 'Sandbox enabled'
              : 'Enabled'
            : i.credentialsRevoked
              ? 'Credentials revoked'
              : i.credentialsExpired
                ? 'Credentials expired'
                : i.isEnabled
                  ? 'Restricted or incomplete'
                  : 'Disconnected / disabled'}
        </span>
        <span className="text-xs text-slate-600">
          Health: {i.connectionStatus.replaceAll('_', ' ')}
          {i.lastHealthAt ? ` · ${new Date(i.lastHealthAt).toLocaleString()}` : ''}
        </span>
      </div>
      <p className="text-xs text-slate-500">
        Credentials: {i.credentials} · Storage: {i.credentialSource ?? 'legacy or not recorded'} ·
        Expiry:{' '}
        {i.credentialsExpiresAt
          ? new Date(i.credentialsExpiresAt).toLocaleString()
          : 'not recorded'}
        {i.credentialsExpired ? ' (expired)' : ''}
        {i.credentialsRevoked
          ? ` · Revoked: ${i.credentialsRevokedAt ? new Date(i.credentialsRevokedAt).toLocaleString() : 'yes'}`
          : ''}{' '}
        · Production review: {i.productionApproval.replaceAll('_', ' ')}
        {i.lastErrorCode ? ` · ${i.lastErrorCode}` : ''}
      </p>
      <p className="text-xs text-slate-500">
        Selected: {i.enabledCapabilities.length ? i.enabledCapabilities.join(', ') : 'none'}
      </p>
      {i.environment === 'PRODUCTION' && (
        <p className="text-xs font-semibold text-amber-800">
          Production activation is blocked even when an approval decision is recorded.
        </p>
      )}
      {canAccounts ? (
        i.accounts.length ? (
          i.accounts.map((a) => (
            <p className="text-xs text-slate-700" key={a.id}>
              {a.alias} · {a.accountType} · {a.maskedIdentifier} · {a.authorizationState} (not
              provider verified)
            </p>
          ))
        ) : (
          <p className="text-xs text-slate-500">No masked account aliases configured.</p>
        )
      ) : (
        <p className="text-xs text-slate-500">Account details require a separate permission.</p>
      )}
      {canCredentials && provider.code === 'MPESA_DARAJA' && i.environment === 'SANDBOX' && (
        <DarajaVaultForm integrationId={i.id} facilityId={facilityId} busy={busy} run={run} />
      )}
      {canCredentials && i.credentialsConfigured && !i.credentialsRevoked && (
        <button
          type="button"
          className={secondary}
          disabled={busy}
          onClick={() => {
            if (
              !window.confirm(
                'Revoke these credentials and disable this integration? Provider requests already in flight must be reviewed separately.',
              )
            )
              return;
            void run(
              () => paymentHubApi.revokeCredentials(i.id, facilityId),
              'Credentials revoked and integration disabled. Replace them before testing again.',
            );
          }}
        >
          Revoke stored credentials
        </button>
      )}
      {canCredentials && i.credentialsConfigured && (
        <button
          type="button"
          className={secondary}
          disabled={busy}
          onClick={() =>
            void run(
              () => paymentHubApi.reencryptCredentials(i.id, facilityId),
              'Credentials re-encrypted with the active server vault key. Provider credentials were not changed.',
            )
          }
        >
          Re-encrypt with active vault key
        </button>
      )}
      {canCredentials && (
        <details className="rounded bg-slate-50 p-2">
          <summary className="cursor-pointer text-xs font-semibold">
            {i.credentialsConfigured ? 'Replace' : 'Add'} facility credential reference
          </summary>
          <p className="my-2 text-xs text-slate-500">
            Do not put credentials, online-banking passwords or OTPs in a reference. The environment
            secret is provisioned by an authorized server operator. Saving a reference disables this
            integration and resets review.
          </p>
          <form
            className="grid gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const payload =
                provider.code === 'MPESA_DARAJA'
                  ? { facilityId, source: 'ENVIRONMENT' }
                  : { facilityId, secretReference };
              void run(async () => {
                await paymentHubApi.credentials(i.id, payload);
                setSecretReference('');
              }, 'Credential reference recorded. Run the applicable check again.');
            }}
          >
            {provider.code === 'MPESA_DARAJA' ? (
              <p className="text-xs text-slate-600 sm:col-span-2">
                Ask the server operator to provision the facility-specific variable{' '}
                <code className="break-all font-semibold">{i.credentialEnvName}</code> using the
                documented secret format. Its value is never sent to or returned by this browser.
              </p>
            ) : (
              <label className="text-xs">
                Facility-owned secret reference (not resolved by an adapter)
                <input
                  className={field}
                  required
                  placeholder="secret:your-facility-reference"
                  value={secretReference}
                  onChange={(e) => setSecretReference(e.target.value)}
                />
              </label>
            )}
            <button disabled={busy} className={button}>
              Save reference
            </button>
          </form>
        </details>
      )}
      {canManage && (
        <details className="rounded bg-slate-50 p-2">
          <summary className="cursor-pointer text-xs font-semibold">
            Add masked account alias
          </summary>
          <p className="my-2 text-xs text-slate-500">
            Enter only the last four digits; this records an alias, not provider authorization.
            Optionally link an existing accounting bank account ID.
          </p>
          <form
            className="grid gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await paymentHubApi.addAccount(i.id, {
                  ...account,
                  facilityId,
                  bankAccountId: account.bankAccountId || undefined,
                });
                setAccount({ ...account, alias: '', lastFour: '', bankAccountId: '' });
              }, 'Alias added as pending; no account authorization was inferred.');
            }}
          >
            <input
              className={field}
              placeholder="Alias (e.g. Main operating)"
              required
              value={account.alias}
              onChange={(e) => setAccount({ ...account, alias: e.target.value })}
            />
            <input
              className={field}
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              placeholder="Last 4 digits only"
              required
              value={account.lastFour}
              onChange={(e) => setAccount({ ...account, lastFour: e.target.value })}
            />
            <select
              className={field}
              value={account.accountType}
              onChange={(e) => setAccount({ ...account, accountType: e.target.value })}
            >
              <option value="BANK">Bank</option>
              <option value="MOBILE_MONEY">Mobile money</option>
              <option value="OTHER">Other</option>
            </select>
            <input
              className={field}
              placeholder="Existing bank account ID (optional)"
              inputMode="numeric"
              value={account.bankAccountId}
              onChange={(e) => setAccount({ ...account, bankAccountId: e.target.value })}
            />
            <button disabled={busy} className={button}>
              Add alias
            </button>
          </form>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        {canManage &&
          i.environment === 'SANDBOX' &&
          provider.adapter.implementedCapabilities.includes('HEALTH') && (
            <button
              disabled={busy || !i.credentialsConfigured || i.credentialsRevoked}
              className={secondary}
              onClick={() =>
                void run(async () => {
                  const result = await paymentHubApi.health(i.id, facilityId);
                  if (result.status !== 'HEALTHY')
                    throw new Error('Provider unavailable or authentication failed.');
                }, 'OAuth connection check succeeded; merchant approval and payment remain unverified.')
              }
            >
              Test OAuth connection
            </button>
          )}
        {canManage && (
          <button
            disabled={
              busy ||
              (!i.isEnabled &&
                (i.credentialsRevoked || provider.adapter.implementedCapabilities.length === 0))
            }
            className={secondary}
            onClick={() =>
              void run(
                () => paymentHubApi.enabled(i.id, facilityId, !i.isEnabled),
                i.isEnabled ? 'Integration disabled.' : 'Integration enabled for sandbox only.',
              )
            }
          >
            {i.isEnabled ? 'Disable integration' : 'Enable integration'}
          </button>
        )}
        {canRequestProduction && i.environment === 'PRODUCTION' && (
          <button
            disabled={busy || i.productionApproval === 'PENDING'}
            className={secondary}
            onClick={() =>
              void run(
                () => paymentHubApi.productionRequest(i.id, facilityId),
                'Production approval requested. Activation remains blocked.',
              )
            }
          >
            Request production review
          </button>
        )}
      </div>
    </div>
  );
}

/** One-way credential entry. Values are never populated from an API response. */
function DarajaVaultForm({
  integrationId,
  facilityId,
  busy,
  run,
}: {
  integrationId: number;
  facilityId: number;
  busy: boolean;
  run: Run;
}) {
  const empty = {
    consumerKey: '',
    consumerSecret: '',
    passkey: '',
    shortcode: '',
    transactionType: '',
    partyB: '',
  };
  const [credentials, setCredentials] = useState(empty);
  const [expiry, setExpiry] = useState('');
  return (
    <details className="rounded bg-slate-50 p-2">
      <summary className="cursor-pointer text-xs font-semibold">
        Add or replace Daraja sandbox credentials
      </summary>
      <p className="my-2 text-xs text-slate-600">
        Enter only provider-issued sandbox application credentials over HTTPS. They are encrypted
        server-side and cannot be viewed again. Never enter a customer PIN, bank password or OTP.
        Replacing credentials disables the integration and requires a new OAuth check.
      </p>
      <form
        className="grid gap-2 sm:grid-cols-2"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            try {
              const { partyB, ...common } = credentials;
              await paymentHubApi.credentials(integrationId, {
                facilityId,
                source: 'VAULT',
                credentials:
                  credentials.transactionType === 'CustomerBuyGoodsOnline'
                    ? { ...common, partyB }
                    : common,
                expiresAt: expiry ? new Date(expiry).toISOString() : null,
              });
            } finally {
              // Do not keep entered secrets in the form after any submission.
              setCredentials(empty);
              setExpiry('');
            }
          }, 'Credentials saved encrypted. Test OAuth before enabling the sandbox.');
        }}
      >
        <label className="text-xs">
          Consumer key
          <input
            className={field}
            type="password"
            required
            maxLength={256}
            autoComplete="new-password"
            value={credentials.consumerKey}
            onChange={(e) => setCredentials({ ...credentials, consumerKey: e.target.value })}
          />
        </label>
        <label className="text-xs">
          Consumer secret
          <input
            className={field}
            type="password"
            required
            maxLength={256}
            autoComplete="new-password"
            value={credentials.consumerSecret}
            onChange={(e) => setCredentials({ ...credentials, consumerSecret: e.target.value })}
          />
        </label>
        <label className="text-xs">
          STK passkey
          <input
            className={field}
            type="password"
            required
            maxLength={512}
            autoComplete="new-password"
            value={credentials.passkey}
            onChange={(e) => setCredentials({ ...credentials, passkey: e.target.value })}
          />
        </label>
        <label className="text-xs">
          Sandbox shortcode
          <input
            className={field}
            inputMode="numeric"
            pattern="[0-9]{4,12}"
            required
            value={credentials.shortcode}
            onChange={(e) => setCredentials({ ...credentials, shortcode: e.target.value })}
          />
        </label>
        <label className="text-xs">
          Authorized transaction type
          <select
            className={field}
            required
            value={credentials.transactionType}
            onChange={(e) => setCredentials({ ...credentials, transactionType: e.target.value })}
          >
            <option value="">Select provider-authorized type</option>
            <option value="CustomerPayBillOnline">Paybill</option>
            <option value="CustomerBuyGoodsOnline">Buy goods</option>
          </select>
        </label>
        {credentials.transactionType === 'CustomerBuyGoodsOnline' && (
          <label className="text-xs">
            Sandbox receiving till (PartyB)
            <input
              className={field}
              type="password"
              autoComplete="new-password"
              inputMode="numeric"
              pattern="[0-9]{4,12}"
              required
              value={credentials.partyB}
              onChange={(e) => setCredentials({ ...credentials, partyB: e.target.value })}
            />
            <span className="block text-slate-500">
              Use the provider-issued receiving till, which may differ from the business shortcode.
            </span>
          </label>
        )}
        <label className="text-xs">
          Credential expiry (optional; your local time)
          <input
            className={field}
            type="datetime-local"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          />
        </label>
        <button disabled={busy} className={button}>
          Save encrypted sandbox credentials
        </button>
      </form>
    </details>
  );
}
