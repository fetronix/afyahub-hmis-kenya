/**
 * Stock control inside the Inventory module.
 *
 * Five views over one ledger:
 *  - Movements: every change to stock on hand, newest first, filterable.
 *  - Adjustments: a reasoned, permission-gated correction.
 *  - Counts: open a physical count, enter what was counted, post the variance.
 *  - Transfers: move stock between stores without changing the total.
 *  - Replenishment: reorder alerts and stock valuation.
 *
 * Nothing here writes stock directly; each action calls the stock-control API,
 * which appends to the ledger in the same transaction as the quantity change.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, ClipboardCheck, Layers, Scale, SlidersHorizontal } from 'lucide-react';

import { ApiError } from '../../api/client.ts';
import {
  ADJUSTMENT_REASON_OPTIONS,
  inventoryControlClient,
  type ReorderAlertRow,
  type StockCountRow,
  type StockMovementRow,
  type StockValuation,
  type TransferRow,
} from '../../api/clients/inventory-control.client.ts';
import type { InventoryItem } from '../../types/index.ts';
import { useHmis } from '../../context/HmisContext.tsx';
import { PrimaryButton, SecondaryButton, Tabs } from '../ui/controls.tsx';
import { InventoryAccountingPanel } from './InventoryAccountingPanel.tsx';
import { AlertBanner, EmptyState, LoadingSkeleton, StatusBadge } from '../ui/feedback.tsx';
import { DataTable, StatCard } from '../ui/layout.tsx';

type View = 'movements' | 'adjustments' | 'counts' | 'transfers' | 'replenishment' | 'accounting';

const today = () => new Date().toISOString().slice(0, 10);

const movementTone = (type: StockMovementRow['movementType']) =>
  type === 'RECEIPT' || type === 'TRANSFER_IN'
    ? 'success'
    : type === 'DISPENSE' || type === 'WRITE_OFF'
      ? 'warning'
      : type === 'COUNT_VARIANCE'
        ? 'info'
        : 'neutral';

const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`;

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'The request could not be completed.';
}

export function StockControlPanel({
  facilityId,
  items,
  canManage,
}: {
  facilityId: number;
  items: InventoryItem[];
  canManage: boolean;
}) {
  const { showToast, triggerRefresh } = useHmis();
  const [view, setView] = useState<View>('movements');
  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [movementFilter, setMovementFilter] = useState('');
  const [counts, setCounts] = useState<StockCountRow[]>([]);
  const [openCount, setOpenCount] = useState<StockCountRow | null>(null);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [alerts, setAlerts] = useState<ReorderAlertRow[]>([]);
  const [valuation, setValuation] = useState<StockValuation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeItems = useMemo(() => items.filter((item) => item.isActive !== false), [items]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [movementResult, countResult, transferResult, alertResult, valuationResult] =
        await Promise.all([
          inventoryControlClient.listMovements(facilityId, { limit: 200 }),
          inventoryControlClient.listCounts(facilityId),
          inventoryControlClient.listTransfers(facilityId),
          inventoryControlClient.reorderAlerts(facilityId),
          inventoryControlClient.valuation(facilityId),
        ]);
      setMovements(movementResult.movements);
      setCounts(countResult.counts);
      setTransfers(transferResult.transfers);
      setAlerts(alertResult.items);
      setValuation(valuationResult.valuation);
      if (openCount) {
        const refreshed = countResult.counts.find((row) => row.id === openCount.id);
        if (refreshed)
          setOpenCount((await inventoryControlClient.getCount(facilityId, refreshed.id)).count);
      }
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [facilityId, openCount]);

  useEffect(() => {
    void load();
    // Reloading depends on the facility and the open count only; `load`
    // already closes over both.
  }, [facilityId]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleMovements = movementFilter
    ? movements.filter((row) => String(row.itemId) === movementFilter)
    : movements;

  const itemOptions = useMemo(
    () =>
      [...activeItems]
        .map((item) => ({ id: item.id, code: item.itemCode, name: item.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [activeItems],
  );

  /* ------------------------------------------------------------ adjustment */
  const [adjustItemId, setAdjustItemId] = useState('');
  const [adjustDirection, setAdjustDirection] = useState<'DECREASE' | 'INCREASE'>('DECREASE');
  const [adjustQuantity, setAdjustQuantity] = useState('1');
  const [adjustReason, setAdjustReason] = useState<string>('DAMAGE');
  const [adjustDate, setAdjustDate] = useState(today());
  const [adjustNotes, setAdjustNotes] = useState('');
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const submitAdjustment = async (event: React.FormEvent) => {
    event.preventDefault();
    setAdjustError(null);
    const quantity = Number(adjustQuantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      setAdjustError('Enter a whole number greater than zero.');
      return;
    }
    if (!adjustItemId) {
      setAdjustError('Choose the stock item being adjusted.');
      return;
    }
    setBusy(true);
    try {
      const result = await inventoryControlClient.adjust(facilityId, {
        itemId: Number(adjustItemId),
        direction: adjustDirection,
        quantity,
        reasonCode: adjustReason,
        movementDate: adjustDate,
        notes: adjustNotes.trim() || undefined,
      });
      showToast(
        `Stock adjusted. ${result.adjustment.delta > 0 ? 'Added' : 'Removed'} ${Math.abs(
          result.adjustment.delta,
        )}; ${result.adjustment.stockAfter} now on hand.`,
        { tone: 'success' },
      );
      setAdjustQuantity('1');
      setAdjustNotes('');
      triggerRefresh();
      await load();
    } catch (submitError) {
      setAdjustError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  /* ----------------------------------------------------------------- count */
  const [countNumber, setCountNumber] = useState('');
  const [countDate, setCountDate] = useState(today());
  const [countStore, setCountStore] = useState('Main Store');
  const [countError, setCountError] = useState<string | null>(null);
  const [countedValues, setCountedValues] = useState<Record<number, string>>({});

  const openNewCount = async (event: React.FormEvent) => {
    event.preventDefault();
    setCountError(null);
    if (!countNumber.trim()) {
      setCountError('Give the count a number so it can be referenced later.');
      return;
    }
    setBusy(true);
    try {
      const result = await inventoryControlClient.createCount(facilityId, {
        countNumber: countNumber.trim(),
        countDate,
        storeLocation: countStore.trim() || undefined,
      });
      setOpenCount(result.count);
      setCountedValues({});
      setCountNumber('');
      showToast(`Count ${result.count.countNumber} opened.`, { tone: 'success' });
      await load();
    } catch (submitError) {
      setCountError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  const saveCountLine = async (itemId: number) => {
    if (!openCount) return;
    const raw = countedValues[itemId];
    if (raw === undefined || raw === '') {
      setCountError('Enter the quantity actually counted.');
      return;
    }
    const countedQuantity = Number(raw);
    if (!Number.isSafeInteger(countedQuantity) || countedQuantity < 0) {
      setCountError('A counted quantity is a whole number, zero or more.');
      return;
    }
    setCountError(null);
    setBusy(true);
    try {
      const result = await inventoryControlClient.recordCountLine(facilityId, openCount.id, {
        itemId,
        countedQuantity,
      });
      setOpenCount(result.count);
    } catch (submitError) {
      setCountError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  const postCount = async () => {
    if (!openCount) return;
    setCountError(null);
    setBusy(true);
    try {
      const result = await inventoryControlClient.postCount(facilityId, openCount.id);
      showToast(
        `Count posted: ${result.adjusted} variance line(s), net ${signed(result.netVariance)}.`,
        { tone: 'success' },
      );
      setOpenCount(result.count);
      setCountedValues({});
      triggerRefresh();
      await load();
    } catch (submitError) {
      setCountError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  /* -------------------------------------------------------------- transfer */
  const [transferNumber, setTransferNumber] = useState('');
  const [transferDate, setTransferDate] = useState(today());
  const [transferFrom, setTransferFrom] = useState('Main Store');
  const [transferTo, setTransferTo] = useState('Satellite Store');
  const [transferItemId, setTransferItemId] = useState('');
  const [transferQuantity, setTransferQuantity] = useState('1');
  const [transferError, setTransferError] = useState<string | null>(null);

  const submitTransfer = async (event: React.FormEvent) => {
    event.preventDefault();
    setTransferError(null);
    if (!transferNumber.trim()) {
      setTransferError('Give the transfer a number so it can be reconciled.');
      return;
    }
    if (!transferItemId) {
      setTransferError('Choose the item being moved.');
      return;
    }
    const quantity = Number(transferQuantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      setTransferError('Enter a whole number greater than zero.');
      return;
    }
    setBusy(true);
    try {
      await inventoryControlClient.createTransfer(facilityId, {
        transferNumber: transferNumber.trim(),
        transferDate,
        storeFrom: transferFrom.trim(),
        storeTo: transferTo.trim(),
        items: [{ itemId: Number(transferItemId), quantity }],
      });
      showToast('Transfer recorded. Both legs are in the ledger.', { tone: 'success' });
      setTransferNumber('');
      setTransferQuantity('1');
      await load();
    } catch (submitError) {
      setTransferError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  /* --------------------------------------------------------- reorder level */
  const [reorderItemId, setReorderItemId] = useState('');
  const [reorderValue, setReorderValue] = useState('');
  const [reorderError, setReorderError] = useState<string | null>(null);

  const saveReorderLevel = async (event: React.FormEvent) => {
    event.preventDefault();
    setReorderError(null);
    const level = Number(reorderValue);
    if (!reorderItemId) {
      setReorderError('Choose the item whose reorder level is changing.');
      return;
    }
    if (!Number.isSafeInteger(level) || level < 0) {
      setReorderError('A reorder level is a whole number, zero or more.');
      return;
    }
    setBusy(true);
    try {
      await inventoryControlClient.updateReorderLevel(facilityId, Number(reorderItemId), level);
      showToast('Reorder level updated.', { tone: 'success' });
      setReorderValue('');
      await load();
    } catch (submitError) {
      setReorderError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Stock value at batch cost"
          value={loading ? '…' : valuation ? `KES ${valuation.totalKes}` : 'Unavailable'}
          detail={
            valuation
              ? `${valuation.unvaluedBatches} batch(es) without a recorded cost`
              : 'Valuation requires batch costs'
          }
          icon={<Scale size={19} />}
        />
        <StatCard
          label="Reorder alerts"
          value={loading ? '…' : alerts.length}
          detail="Items at or below their reorder level"
          icon={<Layers size={19} />}
        />
        <StatCard
          label="Ledger entries loaded"
          value={loading ? '…' : movements.length}
          detail="Every change to stock on hand is explained"
          icon={<SlidersHorizontal size={19} />}
        />
      </div>

      {error && (
        <AlertBanner tone="error" className="text-xs">
          {error}{' '}
          <button type="button" className="underline" onClick={() => void load()}>
            Try again
          </button>
        </AlertBanner>
      )}
      {!canManage && (
        <AlertBanner tone="info" className="text-xs">
          You can read the ledger and stock figures. Adjustments, counts and transfers need the
          inventory management permission.
        </AlertBanner>
      )}

      <Tabs
        label="Stock control views"
        idPrefix="stock-control"
        value={view}
        onChange={(id) => setView(id as View)}
        items={[
          { id: 'movements', label: 'Movements' },
          { id: 'adjustments', label: 'Adjustments' },
          { id: 'counts', label: 'Physical counts' },
          { id: 'transfers', label: 'Store transfers' },
          { id: 'replenishment', label: 'Reorder & valuation' },
          { id: 'accounting', label: 'Accounting' },
        ]}
      />

      {view === 'movements' && (
        <section aria-label="Stock movements" className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-semibold text-slate-600" htmlFor="movement-item-filter">
              Item
            </label>
            <select
              id="movement-item-filter"
              className="ui-input w-auto min-w-64 max-w-md text-xs"
              value={movementFilter}
              onChange={(event) => setMovementFilter(event.target.value)}
            >
              <option value="">All items</option>
              {itemOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.name}
                </option>
              ))}
            </select>
            <SecondaryButton type="button" onClick={() => void load()} disabled={loading}>
              Refresh
            </SecondaryButton>
          </div>
          {loading ? (
            <LoadingSkeleton label="Loading stock movements" rows={4} />
          ) : visibleMovements.length === 0 ? (
            <EmptyState
              title="No movements recorded yet"
              description="Receiving stock, dispensing, adjustments and counts appear here once they happen."
            />
          ) : (
            <DataTable aria-label="Stock movement ledger">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Item</th>
                  <th scope="col">Type</th>
                  <th scope="col">Change</th>
                  <th scope="col">Balance after</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Source</th>
                  <th scope="col">Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {visibleMovements.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap text-xs">{row.movementDate}</td>
                    <td className="text-xs">
                      <span className="font-mono text-2xs text-slate-500">{row.itemCode}</span>
                      <div>{row.itemName ?? `Item ${row.itemId}`}</div>
                    </td>
                    <td>
                      <StatusBadge tone={movementTone(row.movementType)}>
                        {row.movementType.replace('_', ' ')}
                      </StatusBadge>
                    </td>
                    <td
                      className={`font-mono text-xs ${row.quantityDelta < 0 ? 'text-rose-700' : 'text-emerald-700'}`}
                    >
                      {signed(row.quantityDelta)}
                    </td>
                    <td className="font-mono text-xs">{row.stockAfter}</td>
                    <td className="text-xs text-slate-600">{row.reasonCode ?? '—'}</td>
                    <td className="text-xs text-slate-600">
                      {row.referenceType ? `${row.referenceType} ${row.referenceId ?? ''}` : '—'}
                    </td>
                    <td className="text-xs text-slate-600">{row.actorName}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </section>
      )}

      {view === 'adjustments' && (
        <section aria-label="Stock adjustment" className="space-y-3">
          <form className="ui-card space-y-3 p-4" onSubmit={submitAdjustment}>
            <h3 className="text-sm font-semibold text-slate-800">Record an adjustment</h3>
            <p className="text-xs text-slate-600">
              Every adjustment needs a reason code. It is written to the ledger with the balance
              after the change, so a variance can always be explained.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs font-semibold text-slate-600">
                Stock item
                <select
                  id="stock-adjust-item"
                  className="ui-input mt-1 w-full text-xs"
                  value={adjustItemId}
                  onChange={(event) => setAdjustItemId(event.target.value)}
                  required
                  disabled={!canManage}
                >
                  <option value="">Choose an item</option>
                  {itemOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} — {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Direction
                <select
                  id="stock-adjust-direction"
                  className="ui-input mt-1 w-full text-xs"
                  value={adjustDirection}
                  onChange={(event) =>
                    setAdjustDirection(event.target.value === 'INCREASE' ? 'INCREASE' : 'DECREASE')
                  }
                  disabled={!canManage}
                >
                  <option value="DECREASE">Decrease (write off)</option>
                  <option value="INCREASE">Increase (found stock)</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Quantity
                <input
                  id="stock-adjust-quantity"
                  className="ui-input mt-1 w-full text-xs"
                  inputMode="numeric"
                  value={adjustQuantity}
                  onChange={(event) => setAdjustQuantity(event.target.value)}
                  disabled={!canManage}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Reason
                <select
                  id="stock-adjust-reason"
                  className="ui-input mt-1 w-full text-xs"
                  value={adjustReason}
                  onChange={(event) => setAdjustReason(event.target.value)}
                  disabled={!canManage}
                >
                  {ADJUSTMENT_REASON_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Adjustment date
                <input
                  type="date"
                  className="ui-input mt-1 w-full text-xs"
                  value={adjustDate}
                  onChange={(event) => setAdjustDate(event.target.value)}
                  disabled={!canManage}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Notes
                <input
                  id="stock-adjust-notes"
                  className="ui-input mt-1 w-full text-xs"
                  value={adjustNotes}
                  onChange={(event) => setAdjustNotes(event.target.value)}
                  placeholder="What happened, and where"
                  disabled={!canManage}
                />
              </label>
            </div>
            {adjustError && (
              <AlertBanner tone="error" className="text-xs">
                {adjustError}
              </AlertBanner>
            )}
            <div className="flex justify-end">
              <PrimaryButton type="submit" disabled={!canManage || busy}>
                {busy ? 'Saving…' : 'Post adjustment'}
              </PrimaryButton>
            </div>
          </form>
          <AlertBanner tone="info" className="text-xs">
            An adjustment cannot take stock below zero, and a stock count posts its own variance
            separately. Refusals leave stock unchanged.
          </AlertBanner>
        </section>
      )}

      {view === 'counts' && (
        <section aria-label="Physical stock counts" className="space-y-3">
          <form className="ui-card space-y-3 p-4" onSubmit={openNewCount}>
            <h3 className="text-sm font-semibold text-slate-800">Open a physical count</h3>
            <p className="text-xs text-slate-600">
              The count snapshots expected quantities for active items. Posting it records one
              variance movement per counted line; a line left blank is not treated as zero.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="text-xs font-semibold text-slate-600">
                Count number
                <input
                  id="stock-count-number"
                  className="ui-input mt-1 w-full text-xs"
                  value={countNumber}
                  onChange={(event) => setCountNumber(event.target.value)}
                  placeholder="COUNT-2026-001"
                  disabled={!canManage}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Count date
                <input
                  type="date"
                  className="ui-input mt-1 w-full text-xs"
                  value={countDate}
                  onChange={(event) => setCountDate(event.target.value)}
                  disabled={!canManage}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Store
                <input
                  id="stock-count-store"
                  className="ui-input mt-1 w-full text-xs"
                  value={countStore}
                  onChange={(event) => setCountStore(event.target.value)}
                  disabled={!canManage}
                />
              </label>
            </div>
            {countError && (
              <AlertBanner tone="error" className="text-xs">
                {countError}
              </AlertBanner>
            )}
            <div className="flex justify-end">
              <PrimaryButton type="submit" disabled={!canManage || busy}>
                <ClipboardCheck size={16} /> Open count
              </PrimaryButton>
            </div>
          </form>

          {openCount && (
            <div className="ui-card space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-800">
                  {openCount.countNumber} · {openCount.countDate} ·{' '}
                  {openCount.storeLocation ?? 'All stores'}
                </h3>
                <StatusBadge tone={openCount.status === 'POSTED' ? 'success' : 'warning'}>
                  {openCount.status}
                </StatusBadge>
              </div>
              <DataTable aria-label="Count lines">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Expected</th>
                    <th scope="col">Counted</th>
                    <th scope="col">Variance</th>
                    <th scope="col">Record</th>
                  </tr>
                </thead>
                <tbody>
                  {(openCount.lines ?? []).map((line) => (
                    <tr key={line.id}>
                      <td className="text-xs">
                        <span className="font-mono text-2xs text-slate-500">{line.itemCode}</span>
                        <div>{line.itemName ?? `Item ${line.itemId}`}</div>
                      </td>
                      <td className="font-mono text-xs">{line.expectedQuantity}</td>
                      <td className="font-mono text-xs">{line.countedQuantity ?? '—'}</td>
                      <td className="font-mono text-xs">
                        {line.varianceQuantity === null ? '—' : signed(line.varianceQuantity)}
                      </td>
                      <td>
                        {openCount.status === 'OPEN' && canManage ? (
                          <div className="flex items-center gap-2">
                            <input
                              aria-label={`Counted quantity for ${line.itemName ?? line.itemId}`}
                              className="ui-input w-20 text-xs"
                              inputMode="numeric"
                              value={countedValues[line.itemId] ?? ''}
                              onChange={(event) =>
                                setCountedValues((current) => ({
                                  ...current,
                                  [line.itemId]: event.target.value,
                                }))
                              }
                            />
                            <SecondaryButton
                              type="button"
                              onClick={() => void saveCountLine(line.itemId)}
                              disabled={busy}
                            >
                              Save
                            </SecondaryButton>
                          </div>
                        ) : (
                          <span className="text-2xs text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
              {openCount.status === 'OPEN' && (
                <div className="flex justify-end">
                  <PrimaryButton type="button" onClick={() => void postCount()} disabled={busy}>
                    {busy ? 'Posting…' : 'Post count variance'}
                  </PrimaryButton>
                </div>
              )}
            </div>
          )}

          {loading ? (
            <LoadingSkeleton label="Loading stock counts" rows={2} />
          ) : counts.length === 0 ? (
            <EmptyState
              title="No counts yet"
              description="Open a count to compare recorded stock with what is on the shelf."
            />
          ) : (
            <DataTable aria-label="Stock counts">
              <thead>
                <tr>
                  <th scope="col">Number</th>
                  <th scope="col">Date</th>
                  <th scope="col">Store</th>
                  <th scope="col">Status</th>
                  <th scope="col">Counted by</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {counts.map((row) => (
                  <tr key={row.id}>
                    <td className="font-mono text-xs">{row.countNumber}</td>
                    <td className="text-xs">{row.countDate}</td>
                    <td className="text-xs">{row.storeLocation ?? 'All stores'}</td>
                    <td>
                      <StatusBadge tone={row.status === 'POSTED' ? 'success' : 'warning'}>
                        {row.status}
                      </StatusBadge>
                    </td>
                    <td className="text-xs">{row.countedByName}</td>
                    <td>
                      <SecondaryButton
                        type="button"
                        onClick={async () => {
                          try {
                            const result = await inventoryControlClient.getCount(
                              facilityId,
                              row.id,
                            );
                            setOpenCount(result.count);
                            setCountedValues({});
                          } catch (openError) {
                            setCountError(errorMessage(openError));
                          }
                        }}
                      >
                        Open
                      </SecondaryButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </section>
      )}

      {view === 'transfers' && (
        <section aria-label="Store transfers" className="space-y-3">
          <form className="ui-card space-y-3 p-4" onSubmit={submitTransfer}>
            <h3 className="text-sm font-semibold text-slate-800">Move stock between stores</h3>
            <p className="text-xs text-slate-600">
              A transfer records both legs and leaves the facility total unchanged. It cannot move
              more than is on hand.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs font-semibold text-slate-600">
                Transfer number
                <input
                  id="stock-transfer-number"
                  className="ui-input mt-1 w-full text-xs"
                  value={transferNumber}
                  onChange={(event) => setTransferNumber(event.target.value)}
                  placeholder="TRF-2026-001"
                  disabled={!canManage}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Date
                <input
                  type="date"
                  className="ui-input mt-1 w-full text-xs"
                  value={transferDate}
                  onChange={(event) => setTransferDate(event.target.value)}
                  disabled={!canManage}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Item
                <select
                  id="stock-transfer-item"
                  className="ui-input mt-1 w-full text-xs"
                  value={transferItemId}
                  onChange={(event) => setTransferItemId(event.target.value)}
                  disabled={!canManage}
                >
                  <option value="">Choose an item</option>
                  {itemOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} — {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                From
                <input
                  className="ui-input mt-1 w-full text-xs"
                  value={transferFrom}
                  onChange={(event) => setTransferFrom(event.target.value)}
                  disabled={!canManage}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                To
                <input
                  className="ui-input mt-1 w-full text-xs"
                  value={transferTo}
                  onChange={(event) => setTransferTo(event.target.value)}
                  disabled={!canManage}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Quantity
                <input
                  id="stock-transfer-quantity"
                  className="ui-input mt-1 w-full text-xs"
                  inputMode="numeric"
                  value={transferQuantity}
                  onChange={(event) => setTransferQuantity(event.target.value)}
                  disabled={!canManage}
                />
              </label>
            </div>
            {transferError && (
              <AlertBanner tone="error" className="text-xs">
                {transferError}
              </AlertBanner>
            )}
            <div className="flex justify-end">
              <PrimaryButton type="submit" disabled={!canManage || busy}>
                <ArrowRightLeft size={16} /> Record transfer
              </PrimaryButton>
            </div>
          </form>

          {loading ? (
            <LoadingSkeleton label="Loading transfers" rows={2} />
          ) : transfers.length === 0 ? (
            <EmptyState
              title="No transfers yet"
              description="Moving stock between the main and satellite stores will appear here."
            />
          ) : (
            <DataTable aria-label="Store transfers">
              <thead>
                <tr>
                  <th scope="col">Number</th>
                  <th scope="col">Date</th>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col">Items</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((row) => (
                  <tr key={row.id}>
                    <td className="font-mono text-xs">{row.transferNumber}</td>
                    <td className="text-xs">{row.transferDate}</td>
                    <td className="text-xs">{row.storeFrom}</td>
                    <td className="text-xs">{row.storeTo}</td>
                    <td className="font-mono text-xs">{row.itemCount ?? '—'}</td>
                    <td className="font-mono text-xs">{row.totalQuantity ?? '—'}</td>
                    <td className="text-xs">{row.actorName}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </section>
      )}

      {view === 'accounting' && (
        <section aria-label="Inventory accounting">
          <InventoryAccountingPanel facilityId={facilityId} canManage={canManage} />
        </section>
      )}

      {view === 'replenishment' && (
        <section aria-label="Reorder alerts and valuation" className="space-y-4">
          <div className="ui-card space-y-3 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Reorder alerts</h3>
            {loading ? (
              <LoadingSkeleton label="Loading reorder alerts" rows={2} />
            ) : alerts.length === 0 ? (
              <EmptyState
                title="No item is at its reorder level"
                description="Set a reorder level on an item to be warned before it runs out."
              />
            ) : (
              <DataTable aria-label="Reorder alerts">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Store</th>
                    <th scope="col">On hand</th>
                    <th scope="col">Reorder level</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((row) => (
                    <tr key={row.id}>
                      <td className="text-xs">
                        <span className="font-mono text-2xs text-slate-500">{row.itemCode}</span>
                        <div>{row.name}</div>
                      </td>
                      <td className="text-xs">{row.storeLocation ?? '—'}</td>
                      <td className="font-mono text-xs">{row.currentStock ?? 0}</td>
                      <td className="font-mono text-xs">{row.reorderLevel ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
            <form className="flex flex-wrap items-end gap-3" onSubmit={saveReorderLevel}>
              <label className="text-xs font-semibold text-slate-600">
                Item
                <select
                  className="ui-input mt-1 w-auto min-w-64 max-w-md text-xs"
                  value={reorderItemId}
                  onChange={(event) => setReorderItemId(event.target.value)}
                  disabled={!canManage}
                >
                  <option value="">Choose an item</option>
                  {itemOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} — {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">
                New reorder level
                <input
                  className="ui-input mt-1 w-32 text-xs"
                  inputMode="numeric"
                  value={reorderValue}
                  onChange={(event) => setReorderValue(event.target.value)}
                  disabled={!canManage}
                />
              </label>
              <SecondaryButton type="submit" disabled={!canManage || busy}>
                Save level
              </SecondaryButton>
            </form>
            {reorderError && (
              <AlertBanner tone="error" className="text-xs">
                {reorderError}
              </AlertBanner>
            )}
          </div>

          <div className="ui-card space-y-3 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Stock valuation</h3>
            {loading ? (
              <LoadingSkeleton label="Loading valuation" rows={2} />
            ) : !valuation ? (
              <EmptyState
                title="Valuation unavailable"
                description="The server did not return a valuation."
              />
            ) : (
              <>
                <p className="text-xs text-slate-600">{valuation.note}</p>
                <DataTable aria-label="Valuation by category">
                  <thead>
                    <tr>
                      <th scope="col">Category</th>
                      <th scope="col">Quantity</th>
                      <th scope="col">Value (KES)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {valuation.categories.map((row) => (
                      <tr key={row.category}>
                        <td className="text-xs">{row.category}</td>
                        <td className="font-mono text-xs">{row.quantity}</td>
                        <td className="font-mono text-xs">{row.valueKes}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
                <p className="text-xs text-slate-600">
                  Total valued at batch cost: <strong>KES {valuation.totalKes}</strong>
                  {valuation.unvaluedBatches > 0
                    ? ` · ${valuation.unvaluedBatches} batch(es) / ${valuation.unvaluedQuantity} unit(s) have no recorded cost and are excluded from the total.`
                    : ''}
                </p>
                {valuation.batchReconciliation.length > 0 && (
                  <AlertBanner tone="warning" className="text-xs">
                    {valuation.batchReconciliation.length} item(s) have stock that does not match
                    their lots. Review these before relying on the valuation:{' '}
                    {valuation.batchReconciliation
                      .map(
                        (row) =>
                          `${row.itemCode} (${row.currentStock} on hand vs ${row.batchQuantity} in lots)`,
                      )
                      .join('; ')}
                    .
                  </AlertBanner>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
