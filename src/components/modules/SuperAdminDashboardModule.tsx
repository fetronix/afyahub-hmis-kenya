import { PageHeader, StatCard } from '../ui/layout.tsx';
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';

type Row = Record<string, any>;

type Health = {
  status?: string;
  system?: string;
  dhaReadiness?: string;
  timestamp?: string;
};

export function SuperAdminDashboardModule({
  onNavigate,
}: {
  onNavigate: (module: string) => void;
}) {
  const [tenants, setTenants] = useState<Row[] | null>(null);
  const [facilities, setFacilities] = useState<Row[] | null>(null);
  const [auditLogs, setAuditLogs] = useState<Row[] | null>(null);
  const [subscriptions, setSubscriptions] = useState<Row[] | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const failures: string[] = [];

    const tasks = await Promise.allSettled([
      api.getTenants(),
      api.getFacilities(),
      api.getAuditLogs(),
      api.getHealth(),
      api.getSubscriptionPeriods(),
    ]);

    const applyFulfilled = [
      (value: unknown) => {
        if (!Array.isArray(value)) throw new Error('Invalid tenants response.');
        setTenants(value);
      },
      (value: unknown) => {
        if (!Array.isArray(value)) throw new Error('Invalid facilities response.');
        setFacilities(value);
      },
      (value: unknown) => {
        if (!Array.isArray(value)) throw new Error('Invalid audit activity response.');
        setAuditLogs(value);
      },
      (value: unknown) => setHealth((value as Health) ?? null),
      (value: unknown) => {
        if (!Array.isArray(value)) throw new Error('Invalid subscriptions response.');
        setSubscriptions(value);
      },
    ];

    const applyRejected = [
      () => setTenants(null),
      () => setFacilities(null),
      () => setAuditLogs(null),
      () => setHealth(null),
      () => setSubscriptions(null),
    ];

    const names = ['Tenants', 'Facilities', 'Audit activity', 'System health', 'Subscriptions'];

    tasks.forEach((task, index) => {
      if (task.status === 'fulfilled') {
        try {
          applyFulfilled[index]!(task.value);
        } catch (err) {
          applyRejected[index]!();
          failures.push(
            `${names[index]}: ${err instanceof Error ? err.message : 'Could not load data'}`,
          );
        }
      } else {
        applyRejected[index]!();
        failures.push(
          `${names[index]}: ${task.reason instanceof Error ? task.reason.message : 'Could not load data'}`,
        );
      }
    });

    setErrors(failures);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const cardClass = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm';
  const buttonClass =
    'mt-4 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';

  const metricValue = (rows: Row[] | null): string | number =>
    rows === null ? '\u2014' : rows.length;

  const cards = [
    {
      title: 'Tenants',
      value: metricValue(tenants),
      description: 'Organizations registered on the platform',
      action: 'Manage tenants and facilities',
      module: 'platform_administration',
    },
    {
      title: 'Facilities',
      value: metricValue(facilities),
      description: 'Facilities visible to your platform account',
      action: 'Open facility management',
      module: 'platform_administration',
    },
    {
      title: 'Subscriptions',
      value: metricValue(subscriptions),
      description:
        subscriptions === null
          ? 'Subscription status unavailable'
          : `${subscriptions.filter((item) => String(item.status).toLowerCase() === 'active').length} marked active`,
      action: 'Review subscriptions',
      module: 'platform_administration',
    },
    {
      title: 'Audit activity',
      value: metricValue(auditLogs),
      description: 'Audit records returned by the authorized API',
      action: 'Open audit logs',
      module: 'audit',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader>
        <div>
          <p className="text-sm font-medium uppercase tracking-wider text-teal-700">
            JaliCare HMIS · Platform administration
          </p>
          <h1 className="ui-page-title">Platform Management</h1>
          <p className="ui-page-description">
            Manage organizations, facilities, subscriptions, access and platform oversight.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className={buttonClass}
        >
          {loading ? 'Refreshing…' : 'Refresh data'}
        </button>
      </PageHeader>

      {errors.length > 0 && (
        <div
          role="status"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p className="font-semibold">Some dashboard data could not be loaded.</p>
          <ul className="mt-2 list-disc pl-5">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          <p className="mt-2">Unavailable figures are not presented as zero.</p>
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <StatCard
            key={card.title}
            label={card.title}
            value={loading ? '…' : card.value}
            detail={card.description}
            action={
              <button type="button" className={buttonClass} onClick={() => onNavigate(card.module)}>
                {card.action}
              </button>
            }
          />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <article className={`${cardClass} lg:col-span-2`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-slate-900">Recent audit activity</h2>
              <p className="mt-1 text-sm text-slate-500">
                Latest records returned by the audit endpoint
              </p>
            </div>
            <button type="button" className={buttonClass} onClick={() => onNavigate('audit')}>
              View audit logs
            </button>
          </div>

          {auditLogs === null ? (
            <p className="py-6 text-sm text-slate-500">
              {loading ? 'Loading activity…' : 'Audit activity could not be loaded.'}
            </p>
          ) : auditLogs.length === 0 ? (
            <p className="py-6 text-sm text-slate-500">
              {loading ? 'Loading activity…' : 'No audit records returned.'}
            </p>
          ) : (
            <div className="mt-4 divide-y divide-slate-100">
              {auditLogs.slice(0, 6).map((log, index) => (
                <div key={String(log.id ?? index)} className="py-3">
                  <p className="text-sm font-medium text-slate-800">
                    {String(
                      log.action ?? log.actionType ?? log.eventType ?? log.event ?? 'Audit event',
                    )}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {String(log.username ?? log.userName ?? log.userId ?? 'User not specified')}
                    {' · '}
                    {String(
                      log.createdAt ?? log.timestamp ?? log.created_at ?? 'Time not specified',
                    )}
                  </p>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className={cardClass}>
          <h2 className="font-semibold text-slate-900">System health</h2>
          <p className="mt-1 text-sm text-slate-500">Live health endpoint response</p>
          <div className="mt-4 flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                health?.status?.toLowerCase() === 'healthy'
                  ? 'bg-emerald-500'
                  : health
                    ? 'bg-amber-500'
                    : 'bg-slate-300'
              }`}
            />
            <span className="font-semibold text-slate-800">
              {loading && !health ? 'Checking…' : (health?.status ?? 'Unavailable')}
            </span>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-slate-500">System</dt>
              <dd className="font-medium text-slate-800">{health?.system ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">DHA readiness</dt>
              <dd className="font-medium text-slate-800">
                {health?.dhaReadiness ?? 'Not reported'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Last health check</dt>
              <dd className="break-words text-slate-700">
                {health?.timestamp ? new Date(health.timestamp).toLocaleString() : '—'}
              </dd>
            </div>
          </dl>
        </article>
      </section>

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">Users and access management</h2>
        <p className="mt-2 text-sm text-slate-600">
          Open the existing administration workflows to manage tenant and facility administrators. A
          platform-wide user total is not shown because a verified platform-wide users endpoint has
          not yet been confirmed.
        </p>
        <button
          type="button"
          className={buttonClass}
          onClick={() => onNavigate('platform_administration')}
        >
          Open administration
        </button>
      </section>
    </div>
  );
}
