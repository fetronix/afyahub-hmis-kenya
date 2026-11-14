/**
 * Inventory accounting: the facility's basis, its account map and the
 * reconciliation against the ledger.
 *
 * The panel exists because perpetual inventory accounting is a finance
 * decision, not a toggle: a facility must choose which accounts stock, clearing,
 * consumption, write-offs and the opening balance land in, name who approved
 * it, and be able to see whether the books and the shelf still agree.
 *
 * Nothing here posts a journal. It saves a draft, asks the server to activate
 * it (which is where the opening balance is posted, under the facility lock),
 * and reads the reconciliation the server computes.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { BookOpenCheck, RefreshCw, Save, ShieldCheck } from 'lucide-react';

import { ApiError } from '../../api/client.ts';
import {
  inventoryControlClient,
  type InventoryAccountingPolicyInput,
  type InventoryAccountingPolicyRow,
  type InventoryAccountingState,
  type InventoryReconciliation,
} from '../../api/clients/inventory-control.client.ts';
import {
  listPostingAccounts,
  type PostingAccount,
} from '../../api/clients/procurement-workflow.client.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import { PrimaryButton, SecondaryButton } from '../ui/controls.tsx';
import { AlertBanner, EmptyState, LoadingSkeleton, StatusBadge } from '../ui/feedback.tsx';
import { StatCard } from '../ui/layout.tsx';

type AccountField = {
  key: keyof InventoryAccountingPolicyInput;
  label: string;
  hint: string;
};

/** The accounts the server refuses to activate without, in posting order. */
const ACCOUNT_FIELDS: AccountField[] = [
  { key: 'stockAssetAccountId', label: 'Stock on hand', hint: 'Debited when stock arrives.' },
  { key: 'clearingAccountId', label: 'Received not invoiced', hint: 'Cleared by the invoice.' },
  { key: 'consumptionAccountId', label: 'Consumption', hint: 'Dispensed and used stock.' },
  { key: 'adjustmentAccountId', label: 'Adjustments', hint: 'Count variances and corrections.' },
  { key: 'writeOffAccountId', label: 'Write-offs', hint: 'Expired or damaged stock.' },
  { key: 'openingBalanceAccountId', label: 'Opening counterpart', hint: 'Approved by finance.' },
  { key: 'inputVatAccountId', label: 'Recoverable input tax', hint: 'Optional.' },
  { key: 'nonRecoverableTaxAccountId', label: 'Non-recoverable tax', hint: 'Optional.' },
];

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'The request could not be completed.';
}

const badgeTone = (status: InventoryAccountingPolicyRow['status']) =>
  status === 'ACTIVE' ? 'success' : status === 'DRAFT' ? 'warning' : 'neutral';

export function InventoryAccountingPanel({
  facilityId,
  canManage,
}: {
  facilityId: number;
  canManage: boolean;
}) {
  const { showToast, triggerRefresh } = useHmis();
  const [state, setState] = useState<InventoryAccountingState | null>(null);
  const [reconciliation, setReconciliation] = useState<InventoryReconciliation | null>(null);
  const [accounts, setAccounts] = useState<PostingAccount[]>([]);
  const [draft, setDraft] = useState<InventoryAccountingPolicyInput>({ basis: 'PERPETUAL' });
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [policy, books, chart] = await Promise.all([
        inventoryControlClient.accountingPolicy(facilityId),
        inventoryControlClient.reconciliation(facilityId),
        listPostingAccounts(facilityId).catch(() => [] as PostingAccount[]),
      ]);
      setState(policy);
      setReconciliation(books.reconciliation);
      setAccounts(chart);
      const editable =
        policy.versions.find((row) => row.status === 'DRAFT') ??
        (policy.active ? undefined : policy.versions[0]);
      if (editable) {
        setDraft({
          basis: editable.basis,
          stockAssetAccountId: editable.stockAssetAccountId,
          clearingAccountId: editable.clearingAccountId,
          consumptionAccountId: editable.consumptionAccountId,
          adjustmentAccountId: editable.adjustmentAccountId,
          writeOffAccountId: editable.writeOffAccountId,
          openingBalanceAccountId: editable.openingBalanceAccountId,
          inputVatAccountId: editable.inputVatAccountId,
          nonRecoverableTaxAccountId: editable.nonRecoverableTaxAccountId,
        });
        if (editable.effectiveFrom) setEffectiveFrom(editable.effectiveFrom);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    // Loading is external state (the server's books), not derived state.
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      await inventoryControlClient.saveAccountingPolicy(facilityId, draft);
      showToast('Draft policy saved. It posts nothing until it is activated.');
      await load();
    } catch (caught) {
      showToast(errorMessage(caught), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const activate = async () => {
    setBusy(true);
    try {
      /*
       * The approver is the signed-in user and the server records that id; it
       * also requires accounting posting permission for this call, so the
       * person named is the person who authorised it.
       */
      const result = await inventoryControlClient.activateAccountingPolicy(facilityId, {
        effectiveFrom,
      });
      showToast(
        result.openingJournalId
          ? `Perpetual accounting activated; opening stock posted at ${result.openingValueKes}.`
          : 'Perpetual accounting activated. There was no opening stock to post.',
      );
      triggerRefresh();
      await load();
    } catch (caught) {
      showToast(errorMessage(caught), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingSkeleton rows={6} />;

  const active = state?.versions.find((row) => row.status === 'ACTIVE');
  const draftRow = state?.versions.find((row) => row.status === 'DRAFT');

  return (
    <div className="space-y-6">
      {error && (
        <AlertBanner tone="error">Could not load inventory accounting. {error}</AlertBanner>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Basis in force"
          value={state?.basis === 'PERPETUAL' ? 'Perpetual' : 'Expense on purchase'}
          detail={
            active ? `Active since ${active.effectiveFrom ?? 'activation'}` : 'Default treatment'
          }
        />
        <StatCard
          label="Stock value"
          value={reconciliation ? `KES ${reconciliation.valuationKes}` : '—'}
          detail="Lots with a recorded cost"
        />
        <StatCard
          label="Ledger difference"
          value={reconciliation ? `KES ${reconciliation.differenceKes}` : '—'}
          detail={reconciliation?.reconciled ? 'Agrees with the ledger' : 'Needs review'}
        />
      </div>

      {reconciliation && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <header className="mb-3 flex items-center gap-2">
            <BookOpenCheck className="h-4 w-4 text-slate-500" aria-hidden />
            <h3 className="text-sm font-semibold text-slate-800">Reconciliation</h3>
            <StatusBadge tone={reconciliation.reconciled ? 'success' : 'warning'}>
              {reconciliation.reconciled ? 'Agrees' : 'Differences'}
            </StatusBadge>
          </header>
          <dl className="grid gap-2 text-sm md:grid-cols-3">
            <div>
              <dt className="text-slate-500">Stock asset balance</dt>
              <dd className="font-medium">KES {reconciliation.stockAssetBalanceKes}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Shelf valuation</dt>
              <dd className="font-medium">KES {reconciliation.valuationKes}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Movements without a journal</dt>
              <dd className="font-medium">{reconciliation.unpostedMovements}</dd>
            </div>
          </dl>
          {reconciliation.differences.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-slate-700">
              {reconciliation.differences.map((difference) => (
                <li key={`${difference.kind}-${difference.detail}`}>
                  <span className="font-mono text-xs text-slate-500">{difference.kind}</span>{' '}
                  {difference.detail}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <SecondaryButton onClick={() => void load()} disabled={busy}>
              <RefreshCw className="mr-1 h-4 w-4" aria-hidden /> Re-read
            </SecondaryButton>
          </div>
        </section>
      )}

      {!canManage ? (
        <EmptyState
          title="Accounting configuration is managed by finance"
          description="You can see the basis and the reconciliation, but only a user with inventory management permission can change them."
        />
      ) : (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <header className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-slate-500" aria-hidden />
            <h3 className="text-sm font-semibold text-slate-800">Facility policy</h3>
            {draftRow && (
              <StatusBadge tone={badgeTone('DRAFT')}>Draft v{draftRow.version}</StatusBadge>
            )}
            {active && (
              <StatusBadge tone={badgeTone('ACTIVE')}>Active v{active.version}</StatusBadge>
            )}
          </header>

          {active ? (
            <p className="text-sm text-slate-600">
              Perpetual accounting is in force from {active.effectiveFrom ?? 'activation'}. Saving a
              new policy here would start a fresh draft; the active policy keeps posting until the
              new one is activated.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-600">
                Choose where each stock event should land. Saving a draft changes nothing;
                activation requires a named finance approver and posts the opening balance against
                the counterpart account you select.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {ACCOUNT_FIELDS.map((field) => (
                  <label key={String(field.key)} className="text-sm">
                    <span className="block font-medium text-slate-700">{field.label}</span>
                    <span className="mb-1 block text-xs text-slate-500">{field.hint}</span>
                    <select
                      className="w-full rounded border border-slate-300 px-2 py-1"
                      value={String(draft[field.key] ?? '')}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [field.key]: event.target.value ? Number(event.target.value) : null,
                        }))
                      }
                    >
                      <option value="">Not set</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.accountCode} — {account.accountName}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="text-sm">
                  <span className="block font-medium text-slate-700">Effective from</span>
                  <input
                    type="date"
                    className="rounded border border-slate-300 px-2 py-1"
                    value={effectiveFrom}
                    onChange={(event) => setEffectiveFrom(event.target.value)}
                  />
                </label>
                <PrimaryButton onClick={() => void save()} disabled={busy}>
                  <Save className="mr-1 h-4 w-4" aria-hidden /> Save draft
                </PrimaryButton>
                <SecondaryButton onClick={() => void activate()} disabled={busy}>
                  <ShieldCheck className="mr-1 h-4 w-4" aria-hidden /> Activate
                </SecondaryButton>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
