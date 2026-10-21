import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getSessionToken } from "../../api/client.ts";
import { StaffVerificationModal } from "./StaffVerificationModal.tsx";
import {
  BadgeCheck,
  Ban,
  CheckCircle2,
  KeyRound,
  Loader2,
  PlayCircle,
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

type RoleTaskGroup = {
  module: string;
  permissions: Array<{
    id: number;
    code: string;
    name: string;
    description: string | null;
  }>;
};

type RoleTaskCatalogue = {
  role: {
    id: number;
    name: string;
    description: string | null;
    requiresVerification: boolean;
  };
  granted: string[];
  unmapped: string[];
  groups: RoleTaskGroup[];
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

  /*
   * Activate / deactivate. The dialog exists because the action is
   * consequential: it ends any open session on the next request.
   */
  const [statusTarget, setStatusTarget] = useState<StaffMember | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState("");

  /*
   * Task-level permissions on a role, loaded when the editor opens so
   * the screen never shows a stale catalogue.
   */
  const [taskRole, setTaskRole] = useState<AssignableRole | null>(null);
  const [taskCatalogue, setTaskCatalogue] = useState<RoleTaskCatalogue | null>(null);
  const [taskSelected, setTaskSelected] = useState<number[]>([]);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskError, setTaskError] = useState("");

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


  /* ------------------------------------------------------------
     Task-level permissions
     ------------------------------------------------------------ */

  const openTasks = async (role: AssignableRole) => {
    setTaskRole(role);
    setTaskCatalogue(null);
    setTaskError("");
    setTaskLoading(true);

    try {
      const response = await fetch(
        `/api/staff-roles/roles/${role.id}/permissions`,
        {
          credentials: "same-origin",
          headers: buildAuthHeaders(),
        },
      );

      const payload = await readJson<RoleTaskCatalogue>(response);

      setTaskCatalogue(payload);

      const idByCode = new Map<string, number>();

      for (const group of payload.groups) {
        for (const permission of group.permissions) {
          idByCode.set(permission.code, permission.id);
        }
      }

      setTaskSelected(
        payload.granted
          .map((code) => idByCode.get(code))
          .filter((id): id is number => typeof id === "number"),
      );
    } catch (err) {
      setTaskError(
        err instanceof Error ? err.message : "Could not load this role's tasks.",
      );
    } finally {
      setTaskLoading(false);
    }
  };

  const closeTasks = () => {
    setTaskRole(null);
    setTaskCatalogue(null);
    setTaskSelected([]);
    setTaskError("");
    setTaskSaving(false);
  };

  const toggleTask = (permissionId: number) => {
    setTaskSelected((current) =>
      current.includes(permissionId)
        ? current.filter((id) => id !== permissionId)
        : [...current, permissionId],
    );
  };

  const saveTasks = async () => {
    if (!taskRole) return;

    setTaskSaving(true);
    setTaskError("");

    try {
      const response = await fetch(
        `/api/staff-roles/roles/${taskRole.id}/permissions`,
        {
          method: "PUT",
          credentials: "same-origin",
          headers: buildAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ permissionIds: taskSelected }),
        },
      );

      const payload = await readJson<{
        roleName?: string;
        changed?: boolean;
        added?: string[];
        removed?: string[];
      }>(response);

      const name = payload.roleName ?? taskRole.name;

      setNotice(
        payload.changed
          ? `Tasks updated for ${name}.${
              payload.added && payload.added.length > 0
                ? ` Added: ${payload.added.join(", ")}.`
                : ""
            }${
              payload.removed && payload.removed.length > 0
                ? ` Removed: ${payload.removed.join(", ")}.`
                : ""
            } Staff holding this role may need to sign in again to see the change.`
          : `No task change was needed for ${name}.`,
      );

      closeTasks();
      await loadData();
    } catch (err) {
      setTaskError(
        err instanceof Error ? err.message : "Could not save the role tasks.",
      );
    } finally {
      setTaskSaving(false);
    }
  };

  /* ------------------------------------------------------------
     Activate / deactivate
     ------------------------------------------------------------ */

  const openStatus = (member: StaffMember) => {
    setStatusTarget(member);
    setStatusReason("");
    setStatusError("");
  };

  const closeStatus = () => {
    setStatusTarget(null);
    setStatusReason("");
    setStatusError("");
    setStatusSaving(false);
  };

  const saveStatus = async () => {
    if (!statusTarget) return;

    const nextActive = !statusTarget.isActive;
    const member = statusTarget;

    setStatusSaving(true);
    setStatusError("");

    try {
      const response = await fetch(
        `/api/staff-roles/${member.id}/status`,
        {
          method: "PUT",
          credentials: "same-origin",
          headers: buildAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            active: nextActive,
            ...(nextActive ? {} : { reason: statusReason.trim() || undefined }),
          }),
        },
      );

      const payload = await readJson<{ changed?: boolean }>(response);

      setNotice(
        payload.changed
          ? nextActive
            ? `${member.fullName}'s account is active again.`
            : `${member.fullName}'s account is deactivated. Open sessions stop at their next request.`
          : `No status change was needed for ${member.fullName}.`,
      );

      closeStatus();
      await loadData();
    } catch (err) {
      setStatusError(
        err instanceof Error ? err.message : "Could not change the account status.",
      );
    } finally {
      setStatusSaving(false);
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
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="break-words text-sm font-semibold text-slate-900">
                      {member.fullName}
                    </p>

                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        member.isActive
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-rose-50 text-rose-700"
                      }`}
                    >
                      {member.isActive ? "Active" : "Deactivated"}
                    </span>
                  </div>
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
                  <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                    <button
                      type="button"
                      onClick={() => openEditor(member)}
                      disabled={!member.canAssign}
                      title={member.protectionReason ?? "Change this person's roles"}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-transparent"
                    >
                      <UserCog className="h-3.5 w-3.5" />
                      Change roles
                    </button>

                    <button
                      type="button"
                      onClick={() => openStatus(member)}
                      disabled={!member.canAssign || member.accountStatus === "PENDING"}
                      title={
                        member.protectionReason ??
                        (member.accountStatus === "PENDING"
                          ? "This invitation has not been accepted yet. Revoke the invitation instead."
                          : member.isActive
                          ? "Stop this account from signing in"
                          : "Allow this account to sign in again")
                      }
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-transparent ${
                        member.isActive
                          ? "border-rose-200 text-rose-700 hover:bg-rose-50"
                          : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      }`}
                    >
                      {member.isActive ? (
                        <>
                          <Ban className="h-3.5 w-3.5" />
                          Deactivate
                        </>
                      ) : (
                        <>
                          <PlayCircle className="h-3.5 w-3.5" />
                          Activate
                        </>
                      )}
                    </button>
                  </div>

                  {member.protectionReason && (
                    <p className="max-w-[240px] text-right text-[10px] text-slate-400">
                      {member.protectionReason}
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------
          What each role may do — task-level, not a second admin
      ------------------------------------------------------------ */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <KeyRound className="h-4 w-4 text-brand-700" />
              Role tasks
            </h3>
            <p className="mt-1 max-w-2xl text-xs text-slate-500">
              Choose what each role is allowed to do. A doctor can be given
              billing or tariff access without being made an administrator.
              Administrator, security, platform and audit permissions are never
              offered here.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
            {roles.length} roles
          </span>
        </div>

        {roles.length === 0 ? (
          <p className="px-4 py-6 text-xs text-slate-500">
            No assignable roles are configured, so there are no tasks to edit.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {roles.map((role) => (
              <div
                key={role.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {role.name}
                    </span>
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">
                      {role.permissionCount ?? role.permissions?.length ?? 0} tasks
                    </span>
                    {role.requiresVerification && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        Clinical — registration required
                      </span>
                    )}
                  </div>
                  {role.description && (
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {role.description}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void openTasks(role)}
                  className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 sm:self-auto"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Edit tasks
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-[11px] text-slate-500">
          A role belongs to the tenant, not one facility: a change here applies
          to every facility on this tenant. Every change is written to the audit
          log.
        </p>
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

      {/* ------------------------------------------------------------
          Task editor
      ------------------------------------------------------------ */}
      {taskRole && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Tasks for ${taskRole.name}`}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4"
        >
          <div className="my-8 w-full max-w-3xl space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <header className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <KeyRound className="h-4 w-4 text-brand-700" />
                  Tasks for {taskRole.name}
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  {taskRole.description ||
                    "Choose the tasks this role is allowed to perform."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeTasks}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {taskError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {taskError}
              </div>
            )}

            {taskCatalogue && taskCatalogue.unmapped.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                This role also holds {taskCatalogue.unmapped.length} task
                {taskCatalogue.unmapped.length === 1 ? "" : "s"} that this
                screen never grants ({taskCatalogue.unmapped.join(", ")}). They
                are left untouched by a save.
              </div>
            )}

            {taskLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading the task catalogue...
              </div>
            ) : taskCatalogue ? (
              <div className="max-h-[52vh] space-y-4 overflow-y-auto pr-1">
                {taskCatalogue.groups.map((group) => (
                  <section key={group.module}>
                    <h4 className="sticky top-0 z-10 mb-1.5 bg-white py-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      {group.module.replace(/_/g, " ")}
                    </h4>

                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {group.permissions.map((permission) => {
                        const checked = taskSelected.includes(permission.id);

                        return (
                          <label
                            key={permission.id}
                            className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition-colors ${
                              checked
                                ? "border-brand-300 bg-brand-50/50"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleTask(permission.id)}
                              disabled={taskSaving}
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-700"
                            />
                            <span className="min-w-0">
                              <span className="block text-xs font-semibold text-slate-900">
                                {permission.name}
                              </span>
                              <span className="block font-mono text-[10px] text-slate-400">
                                {permission.code}
                              </span>
                              {permission.description && (
                                <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                                  {permission.description}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                ))}

                {taskCatalogue.groups.length === 0 && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    No delegable tasks are configured on this installation. Ask a
                    platform administrator to run the permission seed.
                  </p>
                )}
              </div>
            ) : null}

            <footer className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-slate-500">
                <span className="font-semibold text-slate-700">
                  {taskSelected.length} selected.
                </span>{" "}
                Applies to every facility on this tenant. Staff holding this role
                may need to sign in again to see a new module.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeTasks}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveTasks()}
                  disabled={
                    taskSaving ||
                    taskLoading ||
                    taskSelected.length === 0 ||
                    !taskCatalogue
                  }
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-xs font-bold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {taskSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {taskSaving ? "Saving..." : "Save tasks"}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------
          Activate / deactivate confirmation
      ------------------------------------------------------------ */}
      {statusTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={
            statusTarget.isActive
              ? `Deactivate ${statusTarget.fullName}`
              : `Activate ${statusTarget.fullName}`
          }
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4"
        >
          <div className="my-16 w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <header className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  {statusTarget.isActive ? (
                    <>
                      <Ban className="h-4 w-4 text-rose-600" />
                      Deactivate {statusTarget.fullName}?
                    </>
                  ) : (
                    <>
                      <PlayCircle className="h-4 w-4 text-emerald-600" />
                      Activate {statusTarget.fullName}?
                    </>
                  )}
                </h3>
                <p className="mt-1 break-all text-xs text-slate-500">
                  {statusTarget.email}
                </p>
              </div>
              <button
                type="button"
                onClick={closeStatus}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {statusError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {statusError}
              </div>
            )}

            {statusTarget.isActive ? (
              <>
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                  The account will stop signing in immediately, and any session
                  already open stops at its next request. The person keeps their
                  roles, history and verification records; nothing is deleted.
                </p>

                <div>
                  <label htmlFor="status-reason" className="field-label">
                    Reason (optional, kept in the audit log)
                  </label>
                  <input
                    id="status-reason"
                    type="text"
                    maxLength={200}
                    value={statusReason}
                    onChange={(event) => setStatusReason(event.target.value)}
                    disabled={statusSaving}
                    placeholder="e.g. Left the facility"
                    className="field-input"
                  />
                </div>
              </>
            ) : (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-900">
                Signing in will be allowed again. Any lock from repeated failed
                passwords is cleared, and the person keeps the roles they held.
              </p>
            )}

            <footer className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={closeStatus}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveStatus()}
                disabled={statusSaving}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                  statusTarget.isActive
                    ? "bg-rose-600 hover:bg-rose-700"
                    : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {statusSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {statusSaving
                  ? "Saving..."
                  : statusTarget.isActive
                  ? "Deactivate account"
                  : "Activate account"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
};
