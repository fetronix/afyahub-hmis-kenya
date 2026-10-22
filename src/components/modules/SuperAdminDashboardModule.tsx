import React, { useCallback, useEffect, useState } from "react";
import { api, getSessionToken } from "../../api/client.ts";

type Row = Record<string, any>;

type Health = {
  status?: string;
  system?: string;
  dhaReadiness?: string;
  timestamp?: string;
};

async function loadSubscriptions(): Promise<Row[]> {
  const token = getSessionToken();
  const response = await fetch("/api/platform/subscription-periods", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) {
    throw new Error(result.message || "Subscription data unavailable");
  }
  return Array.isArray(result.data) ? result.data : [];
}

export function SuperAdminDashboardModule({
  onNavigate,
}: {
  onNavigate: (module: string) => void;
}) {
  const [tenants, setTenants] = useState<Row[]>([]);
  const [facilities, setFacilities] = useState<Row[]>([]);
  const [auditLogs, setAuditLogs] = useState<Row[]>([]);
  const [subscriptions, setSubscriptions] = useState<Row[]>([]);
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
      loadSubscriptions(),
    ]);

    const setters = [
      (value: any) => setTenants(Array.isArray(value) ? value : []),
      (value: any) => setFacilities(Array.isArray(value) ? value : []),
      (value: any) => setAuditLogs(Array.isArray(value) ? value : []),
      (value: any) => setHealth(value),
      (value: any) => setSubscriptions(Array.isArray(value) ? value : []),
    ];
    const names = ["Tenants", "Facilities", "Audit activity", "System health", "Subscriptions"];

    tasks.forEach((task, index) => {
      if (task.status === "fulfilled") {
        setters[index](task.value);
      } else {
        failures.push(`${names[index]}: ${task.reason instanceof Error ? task.reason.message : "Could not load data"}`);
      }
    });

    setErrors(failures);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const cardClass =
    "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";
  const buttonClass =
    "mt-4 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50";

  const cards = [
    {
      title: "Tenants",
      value: tenants.length,
      description: "Organizations registered on the platform",
      action: "Manage tenants and facilities",
      module: "platform_administration",
    },
    {
      title: "Facilities",
      value: facilities.length,
      description: "Facilities visible to your platform account",
      action: "Open facility management",
      module: "platform_administration",
    },
    {
      title: "Subscriptions",
      value: subscriptions.length,
      description: `${subscriptions.filter((item) => String(item.status).toLowerCase() === "active").length} marked active`,
      action: "Review subscriptions",
      module: "platform_administration",
    },
    {
      title: "Audit activity",
      value: auditLogs.length,
      description: "Audit records returned by the authorized API",
      action: "Open audit logs",
      module: "audit",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-wider text-teal-700">
            JaliCare HMIS · Platform administration
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            Platform Management
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Manage organizations, facilities, subscriptions, access and platform oversight.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className={buttonClass}
        >
          {loading ? "Refreshing…" : "Refresh data"}
        </button>
      </div>

      {errors.length > 0 && (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Some dashboard data could not be loaded.</p>
          <ul className="mt-2 list-disc pl-5">
            {errors.map((error) => <li key={error}>{error}</li>)}
          </ul>
          <p className="mt-2">Unavailable figures are not presented as zero.</p>
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article key={card.title} className={cardClass}>
            <p className="text-sm font-medium text-slate-500">{card.title}</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">
              {loading ? "…" : card.value}
            </p>
            <p className="mt-2 text-sm text-slate-600">{card.description}</p>
            <button
              type="button"
              className={buttonClass}
              onClick={() => onNavigate(card.module)}
            >
              {card.action}
            </button>
          </article>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <article className={`${cardClass} lg:col-span-2`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-slate-900">Recent audit activity</h2>
              <p className="mt-1 text-sm text-slate-500">Latest records returned by the audit endpoint</p>
            </div>
            <button type="button" className={buttonClass} onClick={() => onNavigate("audit")}>
              View audit logs
            </button>
          </div>

          {auditLogs.length === 0 ? (
            <p className="py-6 text-sm text-slate-500">
              {loading ? "Loading activity…" : "No audit records returned."}
            </p>
          ) : (
            <div className="mt-4 divide-y divide-slate-100">
              {auditLogs.slice(0, 6).map((log, index) => (
                <div key={String(log.id ?? index)} className="py-3">
                  <p className="text-sm font-medium text-slate-800">
                    {String(log.action ?? log.actionType ?? log.eventType ?? log.event ?? "Audit event")}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {String(log.username ?? log.userName ?? log.userId ?? "User not specified")}
                    {" · "}
                    {String(log.createdAt ?? log.timestamp ?? log.created_at ?? "Time not specified")}
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
            <span className={`h-2.5 w-2.5 rounded-full ${
              health?.status?.toLowerCase() === "healthy" ? "bg-emerald-500" :
              health ? "bg-amber-500" : "bg-slate-300"
            }`} />
            <span className="font-semibold text-slate-800">
              {loading && !health ? "Checking…" : health?.status ?? "Unavailable"}
            </span>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-slate-500">System</dt>
              <dd className="font-medium text-slate-800">{health?.system ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">DHA readiness</dt>
              <dd className="font-medium text-slate-800">{health?.dhaReadiness ?? "Not reported"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Last health check</dt>
              <dd className="break-words text-slate-700">
                {health?.timestamp ? new Date(health.timestamp).toLocaleString() : "—"}
              </dd>
            </div>
          </dl>
        </article>
      </section>

      <section className={cardClass}>
        <h2 className="font-semibold text-slate-900">Users and access management</h2>
        <p className="mt-2 text-sm text-slate-600">
          Open the existing administration workflows to manage tenant and facility administrators.
          A platform-wide user total is not shown because a verified platform-wide users endpoint
          has not yet been confirmed.
        </p>
        <button
          type="button"
          className={buttonClass}
          onClick={() => onNavigate("platform_administration")}
        >
          Open administration
        </button>
      </section>
    </div>
  );
}
