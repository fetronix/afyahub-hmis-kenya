import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getSessionToken } from "../../api/client.ts";
import { StaffVerificationModal } from "./StaffVerificationModal.tsx";
import {
  BadgeCheck,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserCog,
  Users,
  X,
} from "lucide-react";

/**
 * Staff directory and role assignment for one facility.
 *
 * The invitation screen assigns a role at the moment an account is
 * created. This screen is the other half: the staff who already exist,
 * the role each of them holds, and the ability to correct it without
 * inviting the person again.
 *
 * It never edits an administrator account and never offers an
 * administrator role: the server enforces both, and this screen shows
 * the same rule rather than a button that will fail.
 */

type AssignableRole = {
  id: number;
  name: string;
  description?: string | null;
  permissions?: string[];
  permissionCount?: number;
  requiresVerification: boolean;
  regulator: string | null;
  regulatorName: string | null;
};

type HeldRole = {
  id: number;
  name: string;
  roleActive: boolean;
  assignable: boolean;
};

type StaffMember = {
  id: number;
  fullName: string;
  email: string;
  username: string;
  designation?: string | null;
  accountStatus: string;
  isActive: boolean;
  lastLoginAt?: string | null;
  roles: HeldRole[];
  verifiedRegulators: { regulator: string; status: string }[];
  canAssign: boolean;
  protectionReason: string | null;
};

type ApiError = {
  message?: string;
  code?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.success === false) {
    const error = new Error(
      (payload as ApiError).message || `Request failed (${response.status}).`,
    ) as Error & { code?: string };

    error.code = (payload as ApiError).code;
    throw error;
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

function formatDate(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export const StaffRolesPanel: React.FC = () => {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [roles, setRoles] = useState<AssignableRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedRoleIds, setSelectedRoleIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  const [verifyingRole, setVerifyingRole] = useState<AssignableRole | null>(null);

  const loadData = useCallback(async (): Promise<StaffMember[] | null> => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/staff-roles/", {
        credentials: "same-origin",
        headers: buildAuthHeaders(),
      });

      const payload = await readJson<{
        staff: StaffMember[];
        roles: AssignableRole[];
        currentUserId: number;
      }>(response);

      setStaff(payload.staff ?? []);
      setRoles(payload.roles ?? []);

      return payload.staff ?? [];
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the staff directory.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const editing = useMemo(
    () => staff.find((member) => member.id === editingId) ?? null,
    [staff, editingId],
  );

  const visibleStaff = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return staff;

    return staff.filter((member) =>
      [member.fullName, member.email, member.username, member.designation ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [staff, search]);

  const openEditor = (member: StaffMember) => {
    setEditingId(member.id);
    setSelectedRoleIds(
      member.roles.filter((role) => role.assignable).map((role) => role.id),
    );
    setModalError("");
    setError("");
    setNotice("");
  };

  const closeEditor = () => {
    setEditingId(null);
    setSelectedRoleIds([]);
    setModalError("");
  };

  const toggleRole = (roleId: number) => {
    setSelectedRoleIds((current) =>
      current.includes(roleId)
        ? current.filter((id) => id !== roleId)
        : [...current, roleId],
    );
  };

  const isVerifiedFor = (member: StaffMember, role: AssignableRole) => {
    if (!role.requiresVerification) return true;
    if (!role.regulator) return false;

    return member.verifiedRegulators.some(
      (credential) => credential.regulator === role.regulator,
    );
  };

  const saveRoles = async () => {
    if (!editing) return;

    setSaving(true);
    setModalError("");

    try {
      const response = await fetch(`/api/staff-roles/${editing.id}/roles`, {
        method: "PUT",
        credentials: "same-origin",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ roleIds: selectedRoleIds }),
      });

      const payload = await readJson<{
        message?: string;
        added?: string[];
        removed?: string[];
        changed?: boolean;
      }>(response);

      setNotice(
        payload.changed
          ? `Roles updated for ${editing.fullName}.${
              payload.added && payload.added.length > 0
                ? ` Added: ${payload.added.join(", ")}.`
                : ""
            }${
              payload.removed && payload.removed.length > 0
                ? ` Removed: ${payload.removed.join(", ")}.`
                : ""
            }`
          : `No change was needed for ${editing.fullName}.`,
      );

      closeEditor();
      await loadData();
    } catch (err) {
      const apiError = err as Error & { code?: string };

      setModalError(apiError.message || "Could not save the roles.");

      /*
       * The server refused because a clinical role has no verified
       * registration. Offer the check here instead of making the
       * administrator find the missing step.
       */
      if (apiError.code === "VERIFICATION_REQUIRED") {
        const missing = roles.find(
          (role) =>
            selectedRoleIds.includes(role.id) &&
            role.requiresVerification &&
            !isVerifiedFor(editing, role),
        );

        if (missing) {
          setVerifyingRole(missing);
        }
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <UserCog className="h-5 w-5 text-teal-700" />
            Staff &amp; Roles
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            See who already works at this facility and assign the role each person holds.
            Administrator roles are not offered here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
            {staff.length} staff
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
            {roles.length} assignable roles
          </span>
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
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

      {roles.length === 0 && !loading && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          No assignable roles were returned for this facility. Roles must be active on the
          tenant and carry at least one non-administrative permission.
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Staff directory</h3>
            <p className="mt-1 text-xs text-slate-500">
              Only accounts at your facility are shown. A role decides what the person can open.
            </p>
          </div>
          <label htmlFor="staff-search" className="sr-only">
            Search staff
          </label>
          <input
            id="staff-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email or title"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-teal-600 sm:w-64"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading staff...
          </div>
        ) : visibleStaff.length === 0 ? (
          <div className="p-8 text-center">
            <Users className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-700">
              {staff.length === 0 ? "No staff accounts yet" : "No staff match that search"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {staff.length === 0
                ? "Invite a staff member below; their account appears here once they accept."
                : "Clear the search box to see every account."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {visibleStaff.map((member) => (
              <article
                key={member.id}
                className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] md:items-center"
              >
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-slate-900">
                    {member.fullName}
                  </p>
                  <p className="break-all text-xs text-slate-600">{member.email}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Username: {member.username}
                  </p>
                </div>

                <div className="min-w-0 text-xs text-slate-600">
                  <p>{member.designation || "No job title recorded"}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Last login: {formatDate(member.lastLoginAt)}
                  </p>
                </div>

                <div className="min-w-0">
                  {member.roles.length === 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">
                      <ShieldAlert className="h-3 w-3" />
                      No role
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {member.roles.map((role) => (
                        <span
                          key={role.id}
                          title={
                            role.assignable
                              ? "Managed from this screen"
                              : "Held role that this screen does not change"
                          }
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                            role.assignable
                              ? "border-teal-200 bg-teal-50 text-teal-800"
                              : "border-slate-200 bg-slate-50 text-slate-600"
                          }`}
                        >
                          {role.name}
                          {!role.roleActive && " (inactive role)"}
                        </span>
                      ))}
                    </div>
                  )}
                  {member.verifiedRegulators.length > 0 && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-700">
                      <BadgeCheck className="h-3 w-3" />
                      Registration on file:{" "}
                      {member.verifiedRegulators
                        .map((credential) => credential.regulator)
                        .join(", ")}
                    </p>
                  )}
                </div>

                <div className="flex flex-col items-start gap-1 md:items-end">
                  <button
                    type="button"
                    onClick={() => openEditor(member)}
                    disabled={!member.canAssign}
                    title={member.protectionReason ?? "Change this person's roles"}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-transparent"
                  >
                    <UserCog className="h-3.5 w-3.5" />
                    Change roles
                  </button>
                  {member.protectionReason && (
                    <p className="max-w-[220px] text-right text-[10px] text-slate-400">
                      {member.protectionReason}
                    </p>
                  )}
                  {!member.isActive && (
                    <p className="text-[10px] font-semibold uppercase text-slate-400">
                      Deactivated
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Roles for ${editing.fullName}`}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4"
        >
          <div className="my-8 w-full max-w-2xl space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <header className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <UserCog className="h-4 w-4 text-teal-700" />
                  Roles for {editing.fullName}
                </h3>
                <p className="mt-1 break-all text-xs text-slate-500">{editing.email}</p>
              </div>
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {modalError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {modalError}
              </div>
            )}

            {!editing.canAssign && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {editing.protectionReason}
              </div>
            )}

            {editing.roles.some((role) => !role.assignable) && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-bold uppercase text-slate-500">
                  Not changed on this screen
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {editing.roles
                    .filter((role) => !role.assignable)
                    .map((role) => (
                      <span
                        key={role.id}
                        className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600"
                      >
                        {role.name}
                        {!role.roleActive && " (inactive)"}
                      </span>
                    ))}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  These roles are kept as they are. Only the roles below are managed here.
                </p>
              </div>
            )}

            <div className="space-y-2">
              {roles.map((role) => {
                const checked = selectedRoleIds.includes(role.id);
                const heldNow = editing.roles.some(
                  (held) => held.id === role.id && held.assignable,
                );
                const verified = isVerifiedFor(editing, role);

                return (
                  <div
                    key={role.id}
                    className={`rounded-lg border p-3 ${
                      checked ? "border-teal-300 bg-teal-50/40" : "border-slate-200 bg-white"
                    }`}
                  >
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRole(role.id)}
                        disabled={!editing.canAssign || saving}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-900">{role.name}</span>
                          {heldNow && (
                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                              Held now
                            </span>
                          )}
                          {role.requiresVerification && (
                            <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                              Clinical
                            </span>
                          )}
                        </span>
                        {role.description && (
                          <span className="mt-0.5 block text-[11px] text-slate-600">
                            {role.description}
                          </span>
                        )}
                        {role.permissionCount !== undefined && (
                          <span className="mt-0.5 block text-[10px] text-slate-400">
                            {role.permissionCount} permission
                            {role.permissionCount === 1 ? "" : "s"}
                          </span>
                        )}
                      </span>
                    </label>

                    {role.requiresVerification && (
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5">
                        {verified ? (
                          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800">
                            <BadgeCheck className="h-3.5 w-3.5" />
                            Registration verified with {role.regulator}
                          </span>
                        ) : (
                          <>
                            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800">
                              <ShieldAlert className="h-3.5 w-3.5" />
                              No verified registration for {role.regulator ?? "the regulator"} on file
                            </span>
                            <button
                              type="button"
                              onClick={() => setVerifyingRole(role)}
                              disabled={!editing.canAssign}
                              className="inline-flex items-center gap-1 rounded-md border border-teal-200 px-2 py-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-50"
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                              Check registration
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {roles.length === 0 && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  No assignable roles are configured. Ask a platform administrator to check the
                  tenant role setup.
                </p>
              )}
            </div>

            <footer className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-slate-500">
                {selectedRoleIds.length === 0
                  ? "Choose at least one role. Leaving an active account with no role would give it nothing to open, so it is not allowed."
                  : "Saving replaces the roles above. The change is recorded in the audit log."}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveRoles()}
                  disabled={
                    saving ||
                    !editing.canAssign ||
                    selectedRoleIds.length === 0
                  }
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-xs font-bold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {saving ? "Saving..." : "Save roles"}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}

      {verifyingRole && editing && (
        <StaffVerificationModal
          roleName={verifyingRole.name}
          fullName={editing.fullName}
          subjectUserId={editing.id}
          onClose={() => setVerifyingRole(null)}
          onVerified={(_credentialId, summary) => {
            const roleName = verifyingRole.name;
            const memberId = editing.id;

            setVerifyingRole(null);
            setNotice(`${summary}. Reloading the staff record...`);

            void loadData().then((refreshed) => {
              const updated = refreshed?.find((member) => member.id === memberId);

              if (updated) {
                setNotice(`${summary}. ${updated.fullName} can now be given ${roleName}.`);
              }
            });
          }}
        />
      )}
    </section>
  );
};
