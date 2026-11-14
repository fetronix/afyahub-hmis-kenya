import React, { useEffect, useRef, useState } from 'react';
import { paymentHubApi } from '../../api/payment-hub.client.ts';
import { payerHubApi } from '../../api/payer-hub.client.ts';
import type { IntegrationAuditEvent } from '../../api/integration-hub.types.ts';

export function IntegrationConfigurationAudit({
  facilityId,
  canViewPayments,
  canViewPayers,
}: {
  facilityId: number;
  canViewPayments: boolean;
  canViewPayers: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [events, setEvents] = useState<Array<IntegrationAuditEvent & { domain: string }>>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const version = useRef(0);
  useEffect(
    () => () => {
      version.current += 1;
    },
    [],
  );
  if (!canViewPayments && !canViewPayers) return null;
  const load = async () => {
    const request = ++version.current;
    setLoading(true);
    setErrors([]);
    const domains = [
      ...(canViewPayments
        ? [{ name: 'Payment and banking', get: () => paymentHubApi.configurationAudit(facilityId) }]
        : []),
      ...(canViewPayers
        ? [{ name: 'Payers', get: () => payerHubApi.configurationAudit(facilityId) }]
        : []),
    ];
    const results = await Promise.allSettled(domains.map((domain) => domain.get()));
    if (request !== version.current) return;
    const next: Array<IntegrationAuditEvent & { domain: string }> = [];
    const failures: string[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        next.push(
          ...result.value.events.map((event) => ({ ...event, domain: domains[index].name })),
        );
      } else {
        failures.push(`${domains[index].name} configuration activity could not be loaded.`);
      }
    });
    next.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || b.id - a.id);
    setEvents(next);
    setErrors(failures);
    setLoaded(true);
    setLoading(false);
  };
  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4"
      aria-label="Configuration audit history"
    >
      <h3 className="font-bold text-slate-900">Configuration activity</h3>
      <p className="mt-1 text-xs text-slate-600">
        Recent facility-scoped configuration events only; credential values, patient information and
        payment details are not displayed. Up to 100 events per authorized domain.
      </p>
      <button
        type="button"
        disabled={loading}
        onClick={() => void load()}
        className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
      >
        {loading
          ? 'Loading activity…'
          : loaded
            ? 'Refresh activity'
            : 'View configuration activity'}
      </button>
      {errors.map((error) => (
        <p role="alert" className="mt-2 text-sm text-red-700" key={error}>
          {error}
        </p>
      ))}
      {loaded && !events.length && !errors.length && (
        <p className="mt-2 text-sm text-slate-600">No configuration events recorded.</p>
      )}
      {events.length > 0 && (
        <ol className="mt-3 space-y-2">
          {events.map((event) => (
            <li
              className="rounded bg-slate-50 p-2 text-xs text-slate-700"
              key={`${event.domain}-${event.id}`}
            >
              {new Date(event.timestamp).toLocaleString()} · {event.domain} · {event.action} ·{' '}
              {event.resource} #{event.resourceId ?? '—'} · actor #{event.actorUserId ?? 'system'}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
