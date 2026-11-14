/**
 * Delegated approval authority — the facility settings screen.
 *
 * What this screen is for
 * -----------------------
 * A facility can say "commitments above this amount need a particular
 * authority". Those thresholds are enforced inside procurement: an approval that
 * does not carry the required permission is refused with
 * `APPROVAL_AUTHORITY_REQUIRED`. Before this screen existed the enforcement ran
 * but the rules could only be seen or changed with direct database access, which
 * meant an administrator could be blocked by a rule they could not inspect.
 *
 * Design decisions worth knowing
 * ------------------------------
 * - **Threshold, scope and required permission are immutable once saved.** The
 *   edit form only changes the name, the end date, the note and whether the rule
 *   is active. Rewriting a threshold in place would silently restate the rule
 *   that past approvals were judged against. To move a threshold, retire the
 *   policy and create a new one — the screen says so rather than hiding it.
 * - **Saving always asks first.** These rules change who may spend money, so the
 *   confirmation names the exact change before it is written.
 * - **Amounts are handled in integer cents end to end.** The form converts from
 *   shillings with exact decimal parsing so no float rounding reaches the
 *   server's integer validation.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Info, Plus, ShieldCheck, SlidersHorizontal } from 'lucide-react';

import { api } from '../../api/client.ts';
import { ApiError } from '../../api/clients/http.ts';
import type {
  ApprovalPolicyRow,
  ApprovalPreview,
  ApprovalScopeKey,
} from '../../api/clients/approval-policy.client.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import { FormField, PrimaryButton, SecondaryButton } from '../ui/controls.tsx';
import { AlertBanner, EmptyState, LoadingSkeleton, StatusBadge } from '../ui/feedback.tsx';
import { DataTable, StatCard } from '../ui/layout.tsx';
import { ConfirmationDialog, Modal } from '../ui/overlays.tsx';

const SCOPES: Array<{ value: ApprovalScopeKey; label: string }> = [
  { value: 'REQUISITION', label: 'Requisition' },
  { value: 'PURCHASE_ORDER', label: 'Purchase order' },
];

const scopeLabel = (scope: string) => SCOPES.find((entry) => entry.value === scope)?.label ?? scope;

/**
 * "1,250.50" -> 125050 cents, exactly.
 *
 * Rejects anything that is not a plain non-negative decimal with at most two
 * places, so a typo cannot silently become a different threshold.
 */
export function parseAmountToCents(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, '');
  if (trimmed === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 125050 -> "1,250.50" for display only. */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const value = Math.abs(Math.trunc(cents));
  const whole = Math.floor(value / 100).toLocaleString('en-KE');
  const fraction = String(value % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

const today = () => new Date().toISOString().slice(0, 10);

type Draft = {
  policyScope: ApprovalScopeKey;
  policyName: string;
  amount: string;
  requiredPermission: string;
  effectiveFrom: string;
  effectiveTo: string;
  notes: string;
};

const emptyDraft = (): Draft => ({
  policyScope: 'PURCHASE_ORDER',
  policyName: '',
  amount: '',
  requiredPermission: '',
  effectiveFrom: today(),
  effectiveTo: '',
  notes: '',
});

/** Field-level problems, so a message can sit under the input that caused it. */
type FieldErrors = Partial<Record<keyof Draft, string>>;

export function ApprovalPoliciesPanel({
  facilityId,
  canManage,
}: {
  facilityId: number;
  /** Whether this account may change thresholds. Reading is decided by the parent. */
  canManage: boolean;
}) {
  const { showToast } = useHmis();

  const [policies, setPolicies] = useState<ApprovalPolicyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [detailsFor, setDetailsFor] = useState<ApprovalPolicyRow | null>(null);

  const [editing, setEditing] = useState<ApprovalPolicyRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editEffectiveTo, setEditEffectiveTo] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmEdit, setConfirmEdit] = useState(false);

  const [previewScope, setPreviewScope] = useState<ApprovalScopeKey>('PURCHASE_ORDER');
  const [previewAmount, setPreviewAmount] = useState('');
  const [preview, setPreview] = useState<ApprovalPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const load = useCallback(async () => {
    if (!facilityId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await api.listApprovalPolicies(facilityId);
      setPolicies(result.policies);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Approval policies could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [load]);

  const summary = useMemo(() => {
    const active = policies.filter((row) => row.isActive).length;
    const scopes = new Set(policies.filter((row) => row.isActive).map((row) => row.policyScope));
    return { active, total: policies.length, scopes: scopes.size };
  }, [policies]);

  /* ------------------------------------------------------------ create */

  function openCreate() {
    setDraft(emptyDraft());
    setFieldErrors({});
    setCreateError(null);
    setCreating(true);
  }

  function validateDraft(): { errors: FieldErrors; cents: number | null } {
    const errors: FieldErrors = {};
    if (!draft.policyName.trim()) errors.policyName = 'Give the rule a name people will recognise.';
    else if (draft.policyName.trim().length > 120)
      errors.policyName = 'Keep the name to 120 characters or fewer.';

    const cents = parseAmountToCents(draft.amount);
    if (cents === null)
      errors.amount = 'Enter the threshold in shillings, for example 50000 or 50000.50.';

    if (!draft.requiredPermission.trim())
      errors.requiredPermission =
        'Name the permission an approver must hold, for example procurement.approve.';
    if (!draft.effectiveFrom) errors.effectiveFrom = 'Choose the date the rule starts.';
    if (draft.effectiveTo && draft.effectiveTo < draft.effectiveFrom)
      errors.effectiveTo = 'The end date cannot be before the start date.';

    return { errors, cents };
  }

  async function submitCreate() {
    const { errors, cents } = validateDraft();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || cents === null) return;

    setSaving(true);
    try {
      const { policy } = await api.createApprovalPolicy(facilityId, {
        policyScope: draft.policyScope,
        policyName: draft.policyName.trim(),
        minAmountCents: cents,
        requiredPermission: draft.requiredPermission.trim(),
        effectiveFrom: draft.effectiveFrom,
        effectiveTo: draft.effectiveTo || null,
        notes: draft.notes.trim() || null,
      });
      setPolicies((current) => [...current, policy]);
      setCreating(false);
      setConfirmCreate(false);
      showToast(`Rule “${policy.policyName}” saved.`, { tone: 'success' });
    } catch (err) {
      /*
       * Server refusals name the field at fault. A duplicate threshold and an
       * unknown permission need different fixes, so the message is put beside
       * the input that caused it rather than in one catch-all place. The
       * confirmation closes so the message is visible instead of waiting
       * behind another dialog.
       */
      const code = err instanceof ApiError ? err.code : undefined;
      const message = err instanceof Error ? err.message : 'The rule could not be saved.';
      setConfirmCreate(false);
      if (code === 'UNKNOWN_PERMISSION') setFieldErrors({ requiredPermission: message });
      else if (code === 'APPROVAL_THRESHOLD_IN_USE' || code === 'INVALID_AMOUNT')
        setFieldErrors({ amount: message });
      else setCreateError(message);
    } finally {
      setSaving(false);
    }
  }

  /* -------------------------------------------------------------- edit */

  function openEdit(policy: ApprovalPolicyRow) {
    setEditing(policy);
    setEditName(policy.policyName);
    setEditEffectiveTo(policy.effectiveTo ?? '');
    setEditNotes(policy.notes ?? '');
    setEditActive(policy.isActive);
    setEditError(null);
  }

  async function submitEdit() {
    if (!editing) return;
    if (!editName.trim()) {
      setEditError('Give the rule a name people will recognise.');
      return;
    }
    if (editEffectiveTo && editEffectiveTo < editing.effectiveFrom) {
      setEditError('The end date cannot be before the start date.');
      return;
    }

    setSaving(true);
    try {
      const { policy } = await api.updateApprovalPolicy(facilityId, editing.id, {
        policyName: editName.trim(),
        effectiveTo: editEffectiveTo || null,
        isActive: editActive,
        notes: editNotes.trim() || null,
      });
      setPolicies((current) => current.map((row) => (row.id === policy.id ? policy : row)));
      setEditing(null);
      setConfirmEdit(false);
      showToast(`Rule “${policy.policyName}” updated.`, { tone: 'success' });
    } catch (err) {
      /* Same reasoning: close the confirmation so the refusal is readable. */
      setConfirmEdit(false);
      setEditError(err instanceof Error ? err.message : 'The rule could not be updated.');
    } finally {
      setSaving(false);
    }
  }

  /* ----------------------------------------------------------- preview */

  async function runPreview() {
    const cents = parseAmountToCents(previewAmount);
    if (cents === null) {
      setPreviewError('Enter an amount in shillings, for example 75000.');
      setPreview(null);
      return;
    }
    setPreviewing(true);
    setPreviewError(null);
    try {
      setPreview(
        await api.previewApprovalRequirement(facilityId, {
          scope: previewScope,
          amountCents: cents,
        }),
      );
    } catch (err) {
      setPreview(null);
      setPreviewError(err instanceof Error ? err.message : 'The preview could not be calculated.');
    } finally {
      setPreviewing(false);
    }
  }

  /* ------------------------------------------------------------ render */

  if (loading) return <LoadingSkeleton rows={5} />;

  const createCents = parseAmountToCents(draft.amount);

  return (
    <div className="space-y-6">
      {loadError && (
        <AlertBanner tone="error">
          {loadError}{' '}
          <button type="button" className="underline" onClick={() => void load()}>
            Try again
          </button>
        </AlertBanner>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Active rules"
          value={String(summary.active)}
          detail="Thresholds currently enforced on approvals."
        />
        <StatCard
          label="Rules on record"
          value={String(summary.total)}
          detail="Includes retired rules kept for history."
        />
        <StatCard
          label="Scopes covered"
          value={`${summary.scopes} of ${SCOPES.length}`}
          detail="A scope with no active rule falls back to the standard approval permission."
        />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Approval thresholds</h2>
          <p className="max-w-2xl text-xs text-muted">
            A rule applies to amounts at or above its threshold, and the highest matching threshold
            wins — so a larger commitment can never be approved under a weaker rule than a smaller
            one. With no active rule, the standard approval permission applies unchanged.
          </p>
        </div>
        {canManage && (
          <PrimaryButton onClick={openCreate}>
            <Plus size={14} /> New rule
          </PrimaryButton>
        )}
      </div>

      {policies.length === 0 ? (
        <EmptyState
          title="No approval thresholds"
          description={
            canManage
              ? 'Every approval currently relies on the standard permission. Add a rule to require a higher authority above a chosen amount.'
              : 'Every approval currently relies on the standard permission. A facility administrator can add thresholds.'
          }
        />
      ) : (
        <DataTable className="table-quiet">
          <thead>
            <tr>
              <th>Rule</th>
              <th>Applies to</th>
              <th className="text-right">From amount (KES)</th>
              <th>Requires</th>
              <th>Effective</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {policies.map((policy) => (
              <tr key={policy.id}>
                <td className="font-medium">{policy.policyName}</td>
                <td>{scopeLabel(policy.policyScope)}</td>
                <td className="text-right tabular-nums">{formatCents(policy.minAmountCents)}</td>
                <td>
                  <code className="text-xs">{policy.requiredPermission}</code>
                </td>
                <td className="text-xs">
                  {policy.effectiveFrom}
                  {policy.effectiveTo ? ` → ${policy.effectiveTo}` : ' onward'}
                </td>
                <td>
                  <StatusBadge tone={policy.isActive ? 'success' : 'neutral'}>
                    {policy.isActive ? 'ACTIVE' : 'INACTIVE'}
                  </StatusBadge>
                </td>
                <td className="text-right">
                  <div className="flex justify-end gap-2">
                    <SecondaryButton onClick={() => setDetailsFor(policy)}>Details</SecondaryButton>
                    {canManage && (
                      <SecondaryButton onClick={() => openEdit(policy)}>Edit</SecondaryButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}

      {/* ------------------------------------------------------- preview */}
      <div className="rounded-xl border border-slate-200 p-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={15} className="text-slate-500" />
          <h3 className="text-sm font-semibold text-ink">What would this amount require?</h3>
        </div>
        <p className="mt-1 text-xs text-muted">
          Check a proposed commitment against the rules above before it is raised.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <FormField label="Scope" htmlFor="preview-scope">
            <select
              id="preview-scope"
              className="ui-input"
              value={previewScope}
              onChange={(event) => setPreviewScope(event.target.value as ApprovalScopeKey)}
            >
              {SCOPES.map((scope) => (
                <option key={scope.value} value={scope.value}>
                  {scope.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Amount (KES)" htmlFor="preview-amount">
            <input
              id="preview-amount"
              className="ui-input"
              inputMode="decimal"
              placeholder="75000"
              value={previewAmount}
              onChange={(event) => setPreviewAmount(event.target.value)}
            />
          </FormField>

          <div className="flex items-end">
            <SecondaryButton onClick={() => void runPreview()} disabled={previewing}>
              <BadgeCheck size={14} /> {previewing ? 'Checking…' : 'Check amount'}
            </SecondaryButton>
          </div>
        </div>

        {previewError && (
          <p className="mt-2 text-xs text-red-700" role="alert">
            {previewError}
          </p>
        )}

        {preview && (
          <div
            className={`mt-3 rounded-lg border p-3 text-xs ${
              preview.satisfied
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-amber-200 bg-amber-50'
            }`}
          >
            <p className="font-medium text-ink">
              KES {formatCents(preview.amountCents)} on a {scopeLabel(preview.scope).toLowerCase()}
            </p>
            <p className="mt-1">
              {preview.rule
                ? `${preview.rule.policyName} applies: amounts from KES ${formatCents(
                    preview.rule.minAmountCents,
                  )} need ${preview.rule.requiredPermission}.`
                : 'No facility rule covers this amount; the standard approval permission applies.'}
            </p>
            <p className="mt-1 font-medium">
              {preview.satisfied
                ? 'This account holds the required authority.'
                : `This account does not hold ${preview.rule?.requiredPermission}. The approval would be refused.`}
            </p>
          </div>
        )}
      </div>

      {!canManage && (
        <p className="flex items-start gap-2 text-xs text-muted">
          <Info size={14} className="mt-0.5 shrink-0" />
          You can view these thresholds but not change them. Changing them needs
          approval_policies.manage, facilities.update or facilities.modules.manage.
        </p>
      )}

      {/* -------------------------------------------------------- create */}
      {creating && (
        <Modal open title="New approval rule" onClose={() => setCreating(false)}>
          <div className="space-y-3 text-xs">
            {createError && <AlertBanner tone="error">{createError}</AlertBanner>}
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Applies to" htmlFor="new-scope">
                <select
                  id="new-scope"
                  className="ui-input"
                  value={draft.policyScope}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      policyScope: event.target.value as ApprovalScopeKey,
                    }))
                  }
                >
                  {SCOPES.map((scope) => (
                    <option key={scope.value} value={scope.value}>
                      {scope.label}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField
                label="Rule name"
                htmlFor="new-name"
                error={fieldErrors.policyName}
                hint="Shown to approvers when the rule blocks them."
              >
                <input
                  id="new-name"
                  className="ui-input"
                  value={draft.policyName}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, policyName: event.target.value }))
                  }
                />
              </FormField>

              <FormField
                label="From amount (KES)"
                htmlFor="new-amount"
                error={fieldErrors.amount}
                hint="Amounts at or above this need the permission below."
              >
                <input
                  id="new-amount"
                  className="ui-input"
                  inputMode="decimal"
                  placeholder="50000"
                  value={draft.amount}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, amount: event.target.value }))
                  }
                />
              </FormField>

              <FormField
                label="Required permission"
                htmlFor="new-permission"
                error={fieldErrors.requiredPermission}
                hint="For example procurement.approve."
              >
                <input
                  id="new-permission"
                  className="ui-input"
                  placeholder="procurement.approve"
                  value={draft.requiredPermission}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      requiredPermission: event.target.value,
                    }))
                  }
                />
              </FormField>

              <FormField
                label="Effective from"
                htmlFor="new-from"
                error={fieldErrors.effectiveFrom}
              >
                <input
                  id="new-from"
                  type="date"
                  className="ui-input"
                  value={draft.effectiveFrom}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, effectiveFrom: event.target.value }))
                  }
                />
              </FormField>

              <FormField
                label="Effective to (optional)"
                htmlFor="new-to"
                error={fieldErrors.effectiveTo}
                hint="Leave empty for no end date."
              >
                <input
                  id="new-to"
                  type="date"
                  className="ui-input"
                  value={draft.effectiveTo}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, effectiveTo: event.target.value }))
                  }
                />
              </FormField>
            </div>

            <FormField label="Note (optional)" htmlFor="new-notes">
              <textarea
                id="new-notes"
                className="ui-input"
                rows={2}
                value={draft.notes}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </FormField>

            <div className="flex justify-end gap-2 pt-1">
              <SecondaryButton onClick={() => setCreating(false)}>Cancel</SecondaryButton>
              <PrimaryButton
                disabled={saving}
                onClick={() => {
                  const { errors, cents } = validateDraft();
                  setFieldErrors(errors);
                  if (Object.keys(errors).length === 0 && cents !== null) setConfirmCreate(true);
                }}
              >
                Review and save
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmationDialog
        open={confirmCreate}
        busy={saving}
        title="Create this approval rule?"
        confirmLabel={saving ? 'Saving…' : 'Create rule'}
        onCancel={() => setConfirmCreate(false)}
        onConfirm={() => void submitCreate()}
      >
        <p>
          From <strong>KES {createCents === null ? draft.amount : formatCents(createCents)}</strong>
          , a {scopeLabel(draft.policyScope).toLowerCase()} will need{' '}
          <code>{draft.requiredPermission.trim() || '(no permission set)'}</code>, effective{' '}
          {draft.effectiveFrom}
          {draft.effectiveTo ? ` until ${draft.effectiveTo}` : ' with no end date'}.
        </p>
        <p className="mt-2">
          Approvals that do not carry that authority will be refused from then on.
        </p>
      </ConfirmationDialog>

      {/* ---------------------------------------------------------- edit */}
      {editing && (
        <Modal open title={`Edit “${editing.policyName}”`} onClose={() => setEditing(null)}>
          <div className="space-y-3 text-xs">
            <AlertBanner tone="info">
              The threshold, scope and required permission cannot be changed. Approvals that already
              happened were judged against them, so rewriting them would restate history. To move a
              threshold, make this rule inactive and create a new one.
            </AlertBanner>

            <div className="rounded-lg border border-slate-200 p-3">
              <p>
                <strong>{scopeLabel(editing.policyScope)}</strong> from{' '}
                <strong>KES {formatCents(editing.minAmountCents)}</strong> requires{' '}
                <code>{editing.requiredPermission}</code>, effective {editing.effectiveFrom}
                {editing.effectiveTo ? ` to ${editing.effectiveTo}` : ' onward'}.
              </p>
            </div>

            {editError && <AlertBanner tone="error">{editError}</AlertBanner>}

            <FormField label="Rule name" htmlFor="edit-name">
              <input
                id="edit-name"
                className="ui-input"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
            </FormField>

            <FormField
              label="Effective to (optional)"
              htmlFor="edit-to"
              hint="An end date in the past retires the rule without deleting it."
            >
              <input
                id="edit-to"
                type="date"
                className="ui-input"
                value={editEffectiveTo}
                onChange={(event) => setEditEffectiveTo(event.target.value)}
              />
            </FormField>

            <FormField label="Note (optional)" htmlFor="edit-notes">
              <textarea
                id="edit-notes"
                className="ui-input"
                rows={2}
                value={editNotes}
                onChange={(event) => setEditNotes(event.target.value)}
              />
            </FormField>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={editActive}
                onChange={(event) => setEditActive(event.target.checked)}
              />
              <span>
                Rule is active
                {!editActive && ' — an inactive rule is not enforced'}
              </span>
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <SecondaryButton onClick={() => setEditing(null)}>Cancel</SecondaryButton>
              <PrimaryButton
                disabled={saving}
                onClick={() => {
                  setEditError(null);
                  setConfirmEdit(true);
                }}
              >
                Review and save
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmationDialog
        open={confirmEdit && editing !== null}
        busy={saving}
        title="Save these changes?"
        confirmLabel={saving ? 'Saving…' : 'Save changes'}
        onCancel={() => setConfirmEdit(false)}
        onConfirm={() => void submitEdit()}
      >
        {editing && (
          <>
            <p>
              Rule <strong>{editing.policyName}</strong> will be renamed to{' '}
              <strong>{editName.trim() || '(no name)'}</strong>.
            </p>
            <p className="mt-2">
              Status: {editActive ? 'active' : 'inactive'}
              {editEffectiveTo ? `, ending ${editEffectiveTo}` : ', with no end date'}.
            </p>
            {!editActive && (
              <p className="mt-2">
                Making this rule inactive stops it governing future approvals. Approvals already
                recorded keep the rule they were judged against.
              </p>
            )}
          </>
        )}
      </ConfirmationDialog>

      {/* ------------------------------------------------------- details */}
      {detailsFor && (
        <Modal open title={detailsFor.policyName} onClose={() => setDetailsFor(null)}>
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <ShieldCheck size={15} className="text-slate-500" />
              <StatusBadge tone={detailsFor.isActive ? 'success' : 'neutral'}>
                {detailsFor.isActive ? 'ACTIVE' : 'INACTIVE'}
              </StatusBadge>
            </div>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-muted">Applies to</dt>
                <dd className="font-medium">{scopeLabel(detailsFor.policyScope)}</dd>
              </div>
              <div>
                <dt className="text-muted">From amount</dt>
                <dd className="font-medium tabular-nums">
                  KES {formatCents(detailsFor.minAmountCents)}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Requires</dt>
                <dd>
                  <code>{detailsFor.requiredPermission}</code>
                </dd>
              </div>
              <div>
                <dt className="text-muted">Effective</dt>
                <dd className="font-medium">
                  {detailsFor.effectiveFrom}
                  {detailsFor.effectiveTo ? ` → ${detailsFor.effectiveTo}` : ' onward'}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Created by</dt>
                <dd className="font-medium">{detailsFor.createdByName}</dd>
              </div>
              <div>
                <dt className="text-muted">Created</dt>
                <dd className="font-medium">{String(detailsFor.createdAt).slice(0, 10)}</dd>
              </div>
            </dl>
            {detailsFor.notes && (
              <div>
                <dt className="text-muted">Note</dt>
                <dd>{detailsFor.notes}</dd>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
