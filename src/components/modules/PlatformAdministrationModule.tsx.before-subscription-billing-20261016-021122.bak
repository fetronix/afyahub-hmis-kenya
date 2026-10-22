import React, { useCallback, useEffect, useState } from "react";
import { api, getSessionToken } from "../../api/client.ts";
import type { Tenant, Facility } from "../../types/index.ts";
import { Building2, Hospital, UserPlus, RefreshCw, Copy } from "lucide-react";

type Tab = "tenants" | "facilities" | "administrators";
type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

type FacilityAdminInvitation = {
  id: number;
  tenantId: number;
  tenantName: string;
  facilityId: number;
  facilityName: string;
  email: string;
  fullName: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedUserId: number | null;
  revokedAt: string | null;
  status: InvitationStatus;
};

async function getRequest<T>(url: string): Promise<T> {
  const token = getSessionToken();
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false || data.error) {
    throw new Error(data.message || data.error || `Request failed (${response.status})`);
  }
  return data as T;
}

async function request<T>(url: string, body: unknown): Promise<T> {
  const token = getSessionToken();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false || data.error) {
    throw new Error(data.message || data.error || `Request failed (${response.status})`);
  }
  return data as T;
}

const fieldClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100";
const labelClass = "mb-1 block text-xs font-semibold text-slate-700";

export const PlatformAdministrationModule: React.FC = () => {
  const [tab, setTab] = useState<Tab>("tenants");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invitationLink, setInvitationLink] = useState("");
  const [invitations, setInvitations] = useState<FacilityAdminInvitation[]>([]);
  const [loadingInvitations, setLoadingInvitations] = useState(false);
  const [invitationActionId, setInvitationActionId] = useState<number | null>(null);

  const [tenantForm, setTenantForm] = useState({
    name: "", slug: "", contactEmail: "", contactPhone: "",
  });
  const [facilityForm, setFacilityForm] = useState({
    code: "", name: "", level: "Level 4", county: "",
    subCounty: "", mflCode: "", email: "", phone: "", address: "",
  });
  const [adminForm, setAdminForm] = useState({
    fullName: "", email: "", phone: "",
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const tenantRows = await api.getTenants();
      setTenants(tenantRows);
      const selectedTenantId =
        tenantRows.some((t) => String(t.id) === tenantId)
          ? tenantId
          : String(tenantRows[0]?.id ?? "");
      setTenantId(selectedTenantId);

      if (selectedTenantId) {
        const facilityRows = await api.getFacilities(Number(selectedTenantId));
        setFacilities(facilityRows);
        setFacilityId((current) =>
          facilityRows.some((f) => String(f.id) === current)
            ? current
            : String(facilityRows[0]?.id ?? "")
        );
      } else {
        setFacilities([]);
        setFacilityId("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load platform records.");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);
  const loadInvitations = useCallback(async () => {
    setLoadingInvitations(true);
    try {
      const result = await getRequest<{ data: FacilityAdminInvitation[] }>(
        "/api/platform/facility-admin-invitations",
      );
      setInvitations(result.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load invitations.");
    } finally {
      setLoadingInvitations(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "administrators") void loadInvitations();
  }, [tab, loadInvitations]);

  const revokeInvitation = async (id: number) => {
    if (!window.confirm("Revoke this invitation? Its link will no longer work.")) return;
    setInvitationActionId(id);
    setError("");
    setNotice("");
    try {
      await request(`/api/platform/facility-admin-invitations/${id}/revoke`, {});
      setNotice("Invitation revoked.");
      await loadInvitations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to revoke invitation.");
    } finally {
      setInvitationActionId(null);
    }
  };

  const reissueInvitation = async (id: number) => {
    setInvitationActionId(id);
    setError("");
    setNotice("");
    try {
      const result = await request<{
        data?: { invitationLink?: string; email?: string; expiresAt?: string };
      }>(`/api/platform/facility-admin-invitations/${id}/reissue`, {});
      if (!result.data?.invitationLink) {
        throw new Error("The API did not return the new invitation link.");
      }
      setInvitationLink(result.data.invitationLink);
      setNotice("Invitation reissued. Copy and send the new link; the previous link is invalid.");
      await loadInvitations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reissue invitation.");
    } finally {
      setInvitationActionId(null);
    }
  };

  const reloadFacilities = async (id: string) => {
    setTenantId(id);
    setFacilityId("");
    setError("");
    try {
      const rows = id ? await api.getFacilities(Number(id)) : [];
      setFacilities(rows);
      setFacilityId(String(rows[0]?.id ?? ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load facilities.");
    }
  };

  const submit = async (
    event: React.FormEvent,
    action: () => Promise<void>,
  ) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await action();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The operation failed.");
    } finally {
      setSaving(false);
    }
  };

  const createTenant = (event: React.FormEvent) =>
    submit(event, async () => {
      const name = tenantForm.name.trim();
      const slug = tenantForm.slug.trim() ||
        name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      await request("/api/platform/tenants", {
        name, slug,
        contactEmail: tenantForm.contactEmail.trim() || undefined,
        contactPhone: tenantForm.contactPhone.trim() || undefined,
        currency: "KES",
        timezone: "Africa/Nairobi",
      });
      setTenantForm({ name: "", slug: "", contactEmail: "", contactPhone: "" });
      setNotice("Tenant created successfully.");
    });

  const createFacility = (event: React.FormEvent) =>
    submit(event, async () => {
      if (!tenantId) throw new Error("Select a tenant first.");
      await request("/api/platform/facilities", {
        tenantId: Number(tenantId),
        ...facilityForm,
        code: facilityForm.code.trim(),
        name: facilityForm.name.trim(),
      });
      setFacilityForm({
        code: "", name: "", level: "Level 4", county: "",
        subCounty: "", mflCode: "", email: "", phone: "", address: "",
      });
      setNotice("Facility created. Its initial onboarding record has also been created.");
    });

  const inviteAdministrator = (event: React.FormEvent) =>
    submit(event, async () => {
      if (!facilityId) throw new Error("Select a facility first.");
      const result = await request<{
        data?: { invitationLink?: string; email?: string; expiresAt?: string };
      }>("/api/platform/facility-admin-invitations", {
        facilityId: Number(facilityId),
        fullName: adminForm.fullName.trim(),
        email: adminForm.email.trim(),
        phone: adminForm.phone.trim() || undefined,
      });
      const link = result.data?.invitationLink;
      if (!link) throw new Error("Invitation created but no link was returned. Check the API response.");
      setInvitationLink(link);
      setAdminForm({ fullName: "", email: "", phone: "" });
      setNotice("Invitation created. Copy the secure link and send it to the administrator.");
    });

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "tenants", label: "Tenants", icon: Building2 },
    { id: "facilities", label: "Facilities", icon: Hospital },
    { id: "administrators", label: "Facility administrators", icon: UserPlus },
  ];

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Platform controls</p>
          <h1 className="mt-1 text-xl font-bold text-slate-900">Tenant & Facility Administration</h1>
          <p className="mt-1 text-sm text-slate-500">Register organizations, onboard facilities, and invite facility administrators.</p>
        </div>
        <button type="button" onClick={() => void loadData()} disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </header>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => { setTab(id); setError(""); setNotice(""); }}
            className={`flex items-center gap-3 rounded-xl border p-4 text-left text-sm font-semibold ${tab === id ? "border-blue-700 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
            <Icon className="h-5 w-5" /> {label}
          </button>
        ))}
      </div>

      {tab === "tenants" && (
        <div className="grid gap-5 xl:grid-cols-2">
          <form onSubmit={createTenant} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-bold text-slate-900">Create tenant</h2>
            <div><label className={labelClass}>Organization name *</label><input className={fieldClass} required maxLength={200} value={tenantForm.name} onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })} /></div>
            <div><label className={labelClass}>Tenant slug (optional)</label><input className={fieldClass} value={tenantForm.slug} onChange={(e) => setTenantForm({ ...tenantForm, slug: e.target.value })} placeholder="generated-from-name" /></div>
            <div><label className={labelClass}>Contact email</label><input className={fieldClass} type="email" value={tenantForm.contactEmail} onChange={(e) => setTenantForm({ ...tenantForm, contactEmail: e.target.value })} /></div>
            <div><label className={labelClass}>Contact phone</label><input className={fieldClass} value={tenantForm.contactPhone} onChange={(e) => setTenantForm({ ...tenantForm, contactPhone: e.target.value })} /></div>
            <button disabled={saving} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{saving ? "Saving…" : "Create tenant"}</button>
          </form>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-bold text-slate-900">Existing tenants ({tenants.length})</h2>
            {loading ? <p className="text-sm text-slate-500">Loading…</p> : tenants.length === 0 ? <p className="text-sm text-slate-500">No tenants found.</p> :
              <ul className="divide-y divide-slate-100">{tenants.map((t) => <li key={t.id} className="py-3"><p className="font-semibold text-slate-800">{t.name}</p><p className="text-xs text-slate-500">{t.slug} · ID {t.id}</p></li>)}</ul>}
          </div>
        </div>
      )}

      {tab === "facilities" && (
        <div className="grid gap-5 xl:grid-cols-2">
          <form onSubmit={createFacility} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-bold text-slate-900">Create facility</h2>
            <div><label className={labelClass}>Parent tenant *</label><select className={fieldClass} required value={tenantId} onChange={(e) => void reloadFacilities(e.target.value)}><option value="">Select tenant</option>{tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
            <div><label className={labelClass}>Facility name *</label><input className={fieldClass} required maxLength={200} value={facilityForm.name} onChange={(e) => setFacilityForm({ ...facilityForm, name: e.target.value })} /></div>
            <div><label className={labelClass}>Facility code *</label><input className={fieldClass} required maxLength={80} value={facilityForm.code} onChange={(e) => setFacilityForm({ ...facilityForm, code: e.target.value })} /></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><label className={labelClass}>Facility level</label><select className={fieldClass} value={facilityForm.level} onChange={(e) => setFacilityForm({ ...facilityForm, level: e.target.value })}>{["Level 2","Level 3","Level 4","Level 5","Level 6"].map((v) => <option key={v}>{v}</option>)}</select></div><div><label className={labelClass}>MFL code</label><input className={fieldClass} value={facilityForm.mflCode} onChange={(e) => setFacilityForm({ ...facilityForm, mflCode: e.target.value })} /></div></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><label className={labelClass}>County</label><input className={fieldClass} value={facilityForm.county} onChange={(e) => setFacilityForm({ ...facilityForm, county: e.target.value })} /></div><div><label className={labelClass}>Sub-county</label><input className={fieldClass} value={facilityForm.subCounty} onChange={(e) => setFacilityForm({ ...facilityForm, subCounty: e.target.value })} /></div></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><label className={labelClass}>Email</label><input className={fieldClass} type="email" value={facilityForm.email} onChange={(e) => setFacilityForm({ ...facilityForm, email: e.target.value })} /></div><div><label className={labelClass}>Phone</label><input className={fieldClass} value={facilityForm.phone} onChange={(e) => setFacilityForm({ ...facilityForm, phone: e.target.value })} /></div></div>
            <div><label className={labelClass}>Address</label><input className={fieldClass} value={facilityForm.address} onChange={(e) => setFacilityForm({ ...facilityForm, address: e.target.value })} /></div>
            <button disabled={saving || !tenantId} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{saving ? "Saving…" : "Create facility"}</button>
          </form>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-bold text-slate-900">Facilities for selected tenant</h2>
            {!tenantId ? <p className="text-sm text-slate-500">Select a tenant to view facilities.</p> : facilities.length === 0 ? <p className="text-sm text-slate-500">No facilities found for this tenant.</p> :
              <ul className="divide-y divide-slate-100">{facilities.map((f) => <li key={f.id} className="py-3"><p className="font-semibold text-slate-800">{f.name}</p><p className="text-xs text-slate-500">{f.code} · {f.level} · {f.county || "County not set"}</p></li>)}</ul>}
          </div>
        </div>
      )}

      {tab === "administrators" && (
        <>
        <div className="grid gap-5 xl:grid-cols-2">
          <form onSubmit={inviteAdministrator} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-bold text-slate-900">Invite facility administrator</h2>
            <p className="text-sm text-slate-500">The recipient sets their own username and password. This invitation grants the facility administrator role only.</p>
            <div><label className={labelClass}>Tenant *</label><select className={fieldClass} required value={tenantId} onChange={(e) => void reloadFacilities(e.target.value)}><option value="">Select tenant</option>{tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
            <div><label className={labelClass}>Facility *</label><select className={fieldClass} required value={facilityId} onChange={(e) => setFacilityId(e.target.value)}><option value="">Select facility</option>{facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
            <div><label className={labelClass}>Administrator full name *</label><input className={fieldClass} required maxLength={200} value={adminForm.fullName} onChange={(e) => setAdminForm({ ...adminForm, fullName: e.target.value })} /></div>
            <div><label className={labelClass}>Email *</label><input className={fieldClass} type="email" required maxLength={254} value={adminForm.email} onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })} /></div>
            <div><label className={labelClass}>Phone</label><input className={fieldClass} value={adminForm.phone} onChange={(e) => setAdminForm({ ...adminForm, phone: e.target.value })} /></div>
            <button disabled={saving || !facilityId} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{saving ? "Creating…" : "Create invitation"}</button>
          </form>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-bold text-slate-900">Invitation link</h2>
            {invitationLink ? <><p className="mt-2 text-sm text-slate-600">Send this link to the administrator. It expires after 48 hours and can only be used once.</p><input aria-label="Invitation link" readOnly value={invitationLink} onFocus={(e) => e.currentTarget.select()} className={`${fieldClass} mt-3`} /><button type="button" onClick={() => void navigator.clipboard.writeText(invitationLink).then(() => setNotice("Invitation link copied.")).catch(() => setError("Clipboard unavailable; select and copy the link manually."))} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold"><Copy className="h-4 w-4" /> Copy link</button></> : <p className="mt-2 text-sm text-slate-500">A newly created invitation link will appear here.</p>}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
            <div>
              <h2 className="font-bold text-slate-900">Facility administrator invitations</h2>
              <p className="mt-1 text-xs text-slate-500">The list shows invitation metadata only, never token hashes.</p>
            </div>
            <button type="button" onClick={() => void loadInvitations()} disabled={loadingInvitations}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
              {loadingInvitations ? "Refreshing..." : "Refresh invitations"}
            </button>
          </div>

          {loadingInvitations && invitations.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">Loading invitations...</p>
          ) : invitations.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No facility administrator invitations found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Recipient</th>
                    <th className="px-4 py-3">Facility / tenant</th>
                    <th className="px-4 py-3">Created / expires</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invitations.map((invitation) => (
                    <tr key={invitation.id}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-800">{invitation.fullName}</p>
                        <p className="text-xs text-slate-500">{invitation.email}</p>
                        <p className="text-xs text-slate-400">ID {invitation.id}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{invitation.facilityName}</p>
                        <p className="text-xs text-slate-500">{invitation.tenantName}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <p>Created: {new Date(invitation.createdAt).toLocaleString()}</p>
                        <p className="mt-1">Expires: {new Date(invitation.expiresAt).toLocaleString()}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${
                          invitation.status === "ACCEPTED" ? "bg-emerald-100 text-emerald-800" :
                          invitation.status === "PENDING" ? "bg-blue-100 text-blue-800" :
                          invitation.status === "EXPIRED" ? "bg-amber-100 text-amber-800" :
                          "bg-slate-100 text-slate-700"
                        }`}>{invitation.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        {invitation.status === "ACCEPTED" || invitation.status === "REVOKED" ? (
                          <span className="text-xs text-slate-400">No actions available</span>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <button type="button" disabled={invitationActionId === invitation.id}
                              onClick={() => void reissueInvitation(invitation.id)}
                              className="rounded-lg border border-blue-200 px-2.5 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-50 disabled:opacity-50">
                              {invitationActionId === invitation.id ? "Working..." : "Reissue"}
                            </button>
                            <button type="button" disabled={invitationActionId === invitation.id}
                              onClick={() => void revokeInvitation(invitation.id)}
                              className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50">
                              Revoke
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </>
      )}
    </section>
  );
};