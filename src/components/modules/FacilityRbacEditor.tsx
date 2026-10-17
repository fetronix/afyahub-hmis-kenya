import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, type RbacPermission, type RbacRole } from "../../api/client.ts";

type Props = {
  facilityId: number;
  facilityName: string;
};

export const FacilityRbacEditor: React.FC<Props> = ({
  facilityId,
  facilityName,
}) => {
  const [roles, setRoles] = useState<RbacRole[]>([]);
  const [permissions, setPermissions] = useState<RbacPermission[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [draftPermissionIds, setDraftPermissionIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const result = await api.getRbacRoles(facilityId);
      setRoles(result.roles);
      setPermissions(result.permissions);
      setSelectedRoleId((current) =>
        current !== null && result.roles.some((role) => role.id === current)
          ? current
          : (result.roles.find((role) => role.canEdit)?.id ??
            result.roles[0]?.id ??
            null),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not load facility roles and permissions.",
      );
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  const selectedRole =
    roles.find((role) => role.id === selectedRoleId) ?? null;

  useEffect(() => {
    setDraftPermissionIds(
      selectedRole ? [...selectedRole.permissionIds] : [],
    );
  }, [selectedRoleId, roles]);

  const groupedPermissions = useMemo(() => {
    const groups: Record<string, RbacPermission[]> = {};

    for (const permission of permissions) {
      const moduleName = permission.module || "Other";
      (groups[moduleName] ??= []).push(permission);
    }

    return Object.entries(groups);
  }, [permissions]);

  const togglePermission = (permissionId: number, checked: boolean) => {
    setDraftPermissionIds((current) =>
      checked
        ? [...new Set([...current, permissionId])]
        : current.filter((id) => id !== permissionId),
    );
  };

  const saveOverride = async () => {
    if (!selectedRole || !selectedRole.canEdit || saving) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      await api.updateRbacRolePermissions(
        selectedRole.id,
        facilityId,
        draftPermissionIds,
      );

      setNotice(
        `Facility override saved for ${selectedRole.name}.`,
      );

      // Reload authoritative server state, including the override indicator.
      await loadRoles();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not save the facility permission override.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-bold text-slate-900">
            Facility Role Permissions
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Configure role permissions for this facility without changing
            shared tenant defaults.
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Facility: <span className="font-semibold">{facilityName}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadRoles()}
          disabled={loading || saving}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "Refresh roles"}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {notice}
        </div>
      )}

      {loading && roles.length === 0 ? (
        <p className="text-sm text-slate-500">
          Loading roles and permissions...
        </p>
      ) : roles.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
          No roles were returned for this facility. Check your account
          permissions and facility scope.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="space-y-2">
            <h3 className="text-sm font-bold text-slate-700">
              Available roles
            </h3>

            {roles.map((role) => (
              <button
                type="button"
                key={role.id}
                onClick={() => setSelectedRoleId(role.id)}
                className={`w-full rounded-lg border p-3 text-left ${
                  selectedRoleId === role.id
                    ? "border-blue-700 bg-blue-50 text-blue-900"
                    : "border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="block font-semibold">{role.name}</span>
                <span className="mt-1 block text-xs text-slate-500">
                  {role.permissionIds.length} effective permissions
                </span>
                <span className="mt-2 inline-block rounded px-2 py-1 text-xs font-semibold">
                  {role.hasFacilityOverride
                    ? "Facility override"
                    : "Shared defaults"}
                </span>
              </button>
            ))}
          </aside>

          <div className="min-w-0">
            {selectedRole ? (
              <>
                <div className="border-b border-slate-200 pb-4">
                  <h3 className="font-bold text-slate-900">
                    {selectedRole.name}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {selectedRole.description ||
                      "No role description provided."}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    Current source:{" "}
                    <strong>
                      {selectedRole.hasFacilityOverride
                        ? "Facility-specific override"
                        : "Shared tenant role defaults"}
                    </strong>
                  </p>
                  {!selectedRole.canEdit && (
                    <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      This role is read-only for your account.
                    </p>
                  )}
                </div>

                <div className="my-4 flex items-center justify-between gap-3">
                  <h4 className="font-semibold text-slate-800">
                    Permission catalogue
                  </h4>
                  <span className="text-sm text-slate-500">
                    {draftPermissionIds.length} selected
                  </span>
                </div>

                {groupedPermissions.map(([moduleName, modulePermissions]) => (
                  <div
                    key={moduleName}
                    className="mb-4 overflow-hidden rounded-lg border border-slate-200"
                  >
                    <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 font-semibold capitalize text-slate-700">
                      {moduleName.replace(/[_-]/g, " ")}
                    </div>

                    <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2">
                      {modulePermissions.map((permission) => {
                        const checked = draftPermissionIds.includes(
                          permission.id,
                        );
                        const disabled =
                          !selectedRole.canEdit ||
                          (!permission.assignable && !checked);

                        return (
                          <label
                            key={permission.id}
                            className={`flex items-start gap-2 rounded border p-3 ${
                              checked
                                ? "border-blue-200 bg-blue-50/50"
                                : "border-slate-100"
                            } ${disabled ? "opacity-70" : "cursor-pointer"}`}
                          >
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={checked}
                              disabled={disabled || saving}
                              onChange={(event) =>
                                togglePermission(
                                  permission.id,
                                  event.target.checked,
                                )
                              }
                            />
                            <span className="min-w-0 text-sm">
                              <span className="block font-semibold text-slate-800">
                                {permission.name}
                              </span>
                              <span className="mt-1 block break-words text-xs text-slate-500">
                                {permission.code}
                              </span>
                              {permission.description && (
                                <span className="mt-1 block text-xs text-slate-500">
                                  {permission.description}
                                </span>
                              )}
                              {!permission.assignable && (
                                <span className="mt-1 block text-xs text-amber-700">
                                  Restricted for this account
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
                  <button
                    type="button"
                    disabled={!selectedRole.canEdit || saving}
                    onClick={() =>
                      setDraftPermissionIds([...selectedRole.permissionIds])
                    }
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Discard changes
                  </button>

                  <button
                    type="button"
                    disabled={!selectedRole.canEdit || saving || loading}
                    onClick={() => void saveOverride()}
                    className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                  >
                    {saving
                      ? "Saving..."
                      : selectedRole.hasFacilityOverride
                        ? "Save facility override"
                        : "Apply facility override"}
                  </button>
                </div>

                <p className="mt-3 text-xs text-slate-500">
                  Saving creates or updates a facility-specific permission
                  set. An empty selection is an explicit override granting
                  no permissions; it does not restore shared defaults.
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-500">
                Select a role to inspect its effective permissions.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
};