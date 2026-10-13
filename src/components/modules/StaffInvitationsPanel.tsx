import React, { useCallback, useEffect, useState } from "react";
import { getSessionToken } from "../../api/client.ts";
import { Copy, Mail, RefreshCw, ShieldCheck, UserPlus, XCircle } from "lucide-react";

type AssignableRole = {
  id: number;
  name: string;
  description?: string | null;
};

type StaffInvitation = {
  id: number;
  email: string;
  fullName: string;
  designation?: string | null;
  roleName?: string | null;
  status?: string;
  expiresAt?: string;
  createdAt?: string;
  acceptedAt?: string | null;
  revokedAt?: string | null;
};

type ApiError = {
  message?: string;
  code?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(
      (payload as ApiError).message || `Request failed (${response.status}).`,
    );
  }
  return payload as T;
}

function buildAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getSessionToken();
  return {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}
function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export const StaffInvitationsPanel: React.FC = () => {
  const [roles, setRoles] = useState<AssignableRole[]>([]);
  const [invitations, setInvitations] = useState<StaffInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invitationUrl, setInvitationUrl] = useState("");
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    designation: "",
    roleId: "",
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [roleResponse, invitationResponse] = await Promise.all([
        fetch("/api/staff-invitations/roles", {
          credentials: "same-origin",
          headers: buildAuthHeaders(),
        }),
        fetch("/api/staff-invitations/", {
          credentials: "same-origin",
          headers: buildAuthHeaders(),
        }),
      ]);

      const rolePayload = await readJson<{ roles: AssignableRole[] }>(roleResponse);
      const invitationPayload = await readJson<{ invitations: StaffInvitation[] }>(
        invitationResponse,
      );

      setRoles(rolePayload.roles ?? []);
      setInvitations(invitationPayload.invitations ?? []);
      setForm((current) => ({
        ...current,
        roleId:
          current.roleId && (rolePayload.roles ?? []).some(
            (role) => String(role.id) === current.roleId,
          )
            ? current.roleId
            : String(rolePayload.roles?.[0]?.id ?? ""),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load staff invitations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const createInvitation = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setInvitationUrl("");

    if (!form.roleId) {
      setError("No assignable roles are available for this tenant. Check role setup and permissions.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/staff-invitations/", {
        method: "POST",
        credentials: "same-origin",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || null,
          designation: form.designation.trim() || null,
          roleId: Number(form.roleId),
        }),
      });

      const payload = await readJson<{
        invitationUrl?: string;
        warning?: string;
        invitation?: StaffInvitation;
      }>(response);

      if (!payload.invitationUrl) {
        throw new Error(
          payload.warning ||
            "The invitation was created, but the server did not return a link. Check APP_BASE_URL and reload the invitation list before trying again.",
        );
      }

      setInvitationUrl(payload.invitationUrl);
      setNotice("Invitation created. Copy the link and send it to the staff member.");
      setForm((current) => ({
        ...current,
        fullName: "",
        email: "",
        phone: "",
        designation: "",
      }));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the invitation.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    if (!invitationUrl) return;
    try {
      await navigator.clipboard.writeText(invitationUrl);
      setNotice("Invitation link copied to the clipboard.");
    } catch {
      setError("Clipboard access was blocked. Select and copy the invitation link manually.");
    }
  };

  const revokeInvitation = async (invitation: StaffInvitation) => {
    if (!window.confirm(`Revoke the invitation for ${invitation.email}? This cannot be undone.`)) {
      return;
    }

    setRevokingId(invitation.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/staff-invitations/${invitation.id}/revoke`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: buildAuthHeaders(),
        },
      );
      await readJson<{ success: boolean }>(response);
      setNotice(`Invitation for ${invitation.email} revoked.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke this invitation.");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <ShieldCheck className="h-5 w-5 text-teal-700" />
            Staff Invitations
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Invite staff to create their own accounts using a time-limited, single-use link.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
          {notice}
        </div>
      )}

      {invitationUrl && (
        <div className="space-y-3 rounded-xl border border-teal-200 bg-teal-50/50 p-4">
          <label htmlFor="staff-invitation-link" className="block text-xs font-bold text-slate-800">
            Invitation link
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="staff-invitation-link"
              readOnly
              value={invitationUrl}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
            />
            <button
              type="button"
              onClick={() => void copyLink()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
            >
              <Copy className="h-4 w-4" />
              Copy link
            </button>
          </div>
          <p className="text-xs text-slate-600">
            The link expires after 48 hours and can only be accepted once. Treat it as a secret until the recipient has used it.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <form onSubmit={createInvitation} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <UserPlus className="h-4 w-4 text-teal-700" />
              Invite a staff member
            </h3>
            <p className="mt-1 text-xs text-slate-500">An account is created only after the invitee accepts.</p>
          </div>

          <div>
            <label htmlFor="invite-full-name" className="mb-1 block text-xs font-medium text-slate-700">Full name *</label>
            <input id="invite-full-name" required maxLength={160} value={form.fullName}
              onChange={(event) => setForm({ ...form, fullName: event.target.value })}
              autoComplete="name" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-600" />
          </div>

          <div>
            <label htmlFor="invite-email" className="mb-1 block text-xs font-medium text-slate-700">Work email *</label>
            <input id="invite-email" type="email" required maxLength={254} value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              autoComplete="email" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-600" />
          </div>

          <div>
            <label htmlFor="invite-phone" className="mb-1 block text-xs font-medium text-slate-700">Phone (optional)</label>
            <input id="invite-phone" type="tel" maxLength={40} value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              autoComplete="tel" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-600" />
          </div>

          <div>
            <label htmlFor="invite-designation" className="mb-1 block text-xs font-medium text-slate-700">Job title / designation (optional)</label>
            <input id="invite-designation" maxLength={120} value={form.designation}
              onChange={(event) => setForm({ ...form, designation: event.target.value })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-600" />
          </div>

          <div>
            <label htmlFor="invite-role" className="mb-1 block text-xs font-medium text-slate-700">Access role *</label>
            <select id="invite-role" required value={form.roleId}
              onChange={(event) => setForm({ ...form, roleId: event.target.value })}
              disabled={loading || roles.length === 0}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 disabled:bg-slate-50">
              <option value="">Select a role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}{role.description ? ` — ${role.description}` : ""}
                </option>
              ))}
            </select>
            {roles.length === 0 && !loading && (
              <p className="mt-1 text-xs text-amber-700">No assignable roles returned. Confirm tenant roles are active and configured.</p>
            )}
          </div>

          <button type="submit" disabled={submitting || loading || roles.length === 0}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50">
            <Mail className="h-4 w-4" />
            {submitting ? "Creating invitation..." : "Create invitation link"}
          </button>
        </form>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Invitation history</h3>
              <p className="mt-1 text-xs text-slate-500">Only invitations in your authorized facility scope are shown.</p>
            </div>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">{invitations.length}</span>
          </div>

          {loading ? (
            <div className="p-6 text-center text-xs text-slate-500">Loading invitations...</div>
          ) : invitations.length === 0 ? (
            <div className="p-8 text-center">
              <Mail className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-700">No invitations yet</p>
              <p className="mt-1 text-xs text-slate-500">Create an invitation using the form.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {invitations.map((invitation) => {
                const status = invitation.status ?? (
                  invitation.acceptedAt ? "accepted" :
                  invitation.revokedAt ? "revoked" :
                  invitation.expiresAt && new Date(invitation.expiresAt).getTime() < Date.now() ? "expired" :
                  "pending"
                );
                const pending = status.toLowerCase() === "pending";

                return (
                  <article key={invitation.id} className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold text-slate-900">{invitation.fullName}</p>
                        <p className="break-all text-xs text-slate-600">{invitation.email}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase ${
                        status.toLowerCase() === "accepted" ? "bg-emerald-50 text-emerald-700" :
                        status.toLowerCase() === "pending" ? "bg-amber-50 text-amber-700" :
                        "bg-slate-100 text-slate-600"
                      }`}>{status}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>Role: {invitation.roleName || "—"}</span>
                      {invitation.designation && <span>Title: {invitation.designation}</span>}
                    </div>
                    <p className="text-xs text-slate-500">Expires: {formatDate(invitation.expiresAt)}</p>
                    {pending && (
                      <button type="button" onClick={() => void revokeInvitation(invitation)}
                        disabled={revokingId === invitation.id}
                        className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
                        <XCircle className="h-3.5 w-3.5" />
                        {revokingId === invitation.id ? "Revoking..." : "Revoke invitation"}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};