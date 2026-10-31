import { PrimaryButton, SecondaryButton, SearchBar, Tabs } from '../ui/controls.tsx';
import { AlertBanner, ErrorState } from '../ui/feedback.tsx';
import { Modal } from '../ui/overlays.tsx';
import { DataTable, PageHeader, StatCard } from '../ui/layout.tsx';
import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { InventoryItem, InventoryBatchRow, ExpirySummary } from '../../types/index.ts';
import ExpiryCountdown, { expiryDeadline } from '../ExpiryCountdown.tsx';
import {
  Package,
  AlertTriangle,
  Plus,
  CheckCircle2,
  TrendingDown,
  Layers,
  CalendarClock,
  PackagePlus,
  RefreshCw,
} from 'lucide-react';

export const InventoryModule: React.FC = () => {
  const { currentFacility, showToast, refreshKey, triggerRefresh } = useHmis();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [itemsError, setItemsError] = useState('');
  const [batchesError, setBatchesError] = useState('');
  const [expiryError, setExpiryError] = useState('');
  const [attempt, setAttempt] = useState(0);

  /* Stock batches and expiry */
  const [tab, setTab] = useState<'items' | 'batches'>('items');
  const [batches, setBatches] = useState<InventoryBatchRow[]>([]);
  const [expiry, setExpiry] = useState<ExpirySummary | null>(null);
  const [batchFilter, setBatchFilter] = useState<'All' | 'Expired' | 'Expiring' | 'OK'>('All');
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [receiveForm, setReceiveForm] = useState({
    itemId: '',
    batchNumber: '',
    expiryDate: '',
    quantity: '',
    costPerUnit: '',
  });

  // New Item Modal
  const [isNewItemModalOpen, setIsNewItemModalOpen] = useState(false);
  const [newItem, setNewItem] = useState({
    itemCode: '',
    name: '',
    genericName: '',
    category: 'Pharmaceuticals',
    unit: '',
    strength: '',
    dosageForm: '',
    currentStock: '',
    reorderLevel: '',
    unitCost: '',
    sellingPrice: '',
    storeLocation: '',
    /*
     * Expiry is a property of a batch, not of the catalogue item: the
     * same item is received many times with different shelf lives.
     * The opening stock is therefore received into its first batch, so
     * the countdown below has a date to count to.
     */
    batchNumber: '',
    expiryDate: '',
  });

  useEffect(() => {
    let active = true;
    async function loadInventory() {
      if (!currentFacility?.id) {
        setItems([]);
        setBatches([]);
        setExpiry(null);
        setItemsError('Select an authorized facility to load inventory.');
        setBatchesError('');
        setExpiryError('');
        setLoading(false);
        return;
      }
      setLoading(true);
      setItemsError('');
      setBatchesError('');
      setExpiryError('');
      const [itemsResult, batchesResult, expiryResult] = await Promise.allSettled([
        api.getInventory(currentFacility.id),
        api.getInventoryBatches(currentFacility.id, { horizonDays: 30 }),
        api.getExpirySummary(currentFacility.id, 30),
      ]);
      if (!active) return;
      if (itemsResult.status === 'fulfilled') setItems(itemsResult.value);
      else {
        setItems([]);
        setItemsError('Inventory items could not be loaded.');
      }
      if (batchesResult.status === 'fulfilled') setBatches(batchesResult.value);
      else {
        setBatches([]);
        setBatchesError('Batch records could not be loaded.');
      }
      if (expiryResult.status === 'fulfilled') setExpiry(expiryResult.value);
      else {
        setExpiry(null);
        setExpiryError('Expiry summary could not be loaded.');
      }
      setLoading(false);
    }
    void loadInventory();
    return () => {
      active = false;
    };
  }, [currentFacility?.id, refreshKey, attempt]);

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentFacility?.id) {
      showToast('Select a facility before saving this record.', { tone: 'warning' });
      return;
    }

    if (!newItem.currentStock.trim() || !newItem.reorderLevel.trim()) {
      showToast('Enter the initial stock and reorder level; use zero only when confirmed.', {
        tone: 'warning',
      });
      return;
    }
    const openingQuantity = Number(newItem.currentStock);
    const batchNumber = newItem.batchNumber.trim();
    const expiryDate = newItem.expiryDate.trim();
    const wantsBatch = batchNumber.length > 0 || expiryDate.length > 0;

    /*
     * A batch is all-or-nothing. Half a lot — a batch number with no
     * expiry, or an expiry with no number — cannot be received by the
     * batch endpoint and would silently leave the item untracked.
     */
    if (wantsBatch && !newItem.unitCost.trim()) {
      showToast('Enter the unit cost for the opening batch; use zero only when confirmed.', {
        tone: 'warning',
      });
      return;
    }
    if (wantsBatch && (!batchNumber || !expiryDate)) {
      showToast(
        'Enter both a batch number and an expiry date, or leave both blank to track the item as a plain stock count.',
        { tone: 'warning' },
      );
      return;
    }

    if (wantsBatch && !expiryDeadline(expiryDate)) {
      showToast('Enter a real expiry date in YYYY-MM-DD format.', { tone: 'warning' });
      return;
    }

    if (wantsBatch && expiryDeadline(expiryDate)!.getTime() < Date.now()) {
      showToast('That expiry date has already passed. Stock cannot be received already expired.', {
        tone: 'warning',
      });
      return;
    }

    if (wantsBatch && (!Number.isSafeInteger(openingQuantity) || openingQuantity < 1)) {
      showToast('Opening stock must be a whole number of at least 1 to receive a batch.', {
        tone: 'warning',
      });
      return;
    }

    let createdItemId: number | null = null;

    try {
      /*
       * The batch number and expiry date are not columns on
       * inventory_items; they are stripped here so the catalogue write
       * carries only catalogue fields. When a batch is supplied the
       * item is created with zero stock and the opening quantity is
       * received into the lot, which is the only path that keeps
       * current_stock and the batch rows in step.
       */
      const { batchNumber: _batchNumber, expiryDate: _expiryDate, ...catalogueFields } = newItem;

      const created = await api.createInventoryItem({
        facilityId: currentFacility.id,
        ...catalogueFields,
        unitCost: newItem.unitCost.trim() || null,
        sellingPrice: newItem.sellingPrice.trim() || null,
        currentStock: wantsBatch ? 0 : Number(newItem.currentStock),
        reorderLevel: Number(newItem.reorderLevel),
      });

      createdItemId = created?.id ?? null;

      if (wantsBatch && created?.id) {
        await api.receiveBatch(created.id, {
          facilityId: currentFacility.id,
          batchNumber,
          expiryDate,
          quantity: openingQuantity,
          costPerUnit: newItem.unitCost,
        });
      }

      showToast(
        wantsBatch
          ? `Item added; ${openingQuantity} units received into batch ${batchNumber}, expiring ${expiryDate}.`
          : 'Item added to facility inventory catalogue!',
      );
      setIsNewItemModalOpen(false);
      setNewItem((current) => ({ ...current, batchNumber: '', expiryDate: '' }));
      triggerRefresh();
    } catch (err: any) {
      showToast(
        createdItemId !== null
          ? `The item was created, but its opening batch could not be received: ${err.message}. Use Receive Batch to add the stock.`
          : `Error: ${err.message}`,
        { tone: 'warning' },
      );

      if (createdItemId !== null) {
        setIsNewItemModalOpen(false);
        triggerRefresh();
      }
    }
  };

  const filteredItems = items.filter(
    (i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      (i.genericName && i.genericName.toLowerCase().includes(search.toLowerCase())) ||
      i.itemCode.toLowerCase().includes(search.toLowerCase()),
  );

  const hasStockThreshold = (item: InventoryItem) =>
    item.currentStock != null &&
    item.reorderLevel != null &&
    Number.isFinite(Number(item.currentStock)) &&
    Number.isFinite(Number(item.reorderLevel));
  const lowStockCount = items.filter(
    (item) => hasStockThreshold(item) && item.currentStock <= item.reorderLevel,
  ).length;
  const missingStockThreshold = items.some((item) => !hasStockThreshold(item));
  // Legacy rows may contain database-default zero costs, indistinguishable from
  // a deliberately recorded zero. Do not present that ambiguous valuation as certain.
  const ambiguousCost = items.some(
    (item) => Number(item.currentStock) > 0 && Number(item.unitCost) === 0,
  );

  /*
   * One countdown per item, taken from its batches rather than from a
   * column on the item: the item is the catalogue entry, the batch owns
   * the expiry. The soonest batch that still has stock wins, because
   * that is the lot FEFO will hand out next. When every lot has run out
   * or expired, the earliest expiry is still shown so the shelf is not
   * silently reported as having no date.
   */
  const nearestExpiryByItem = new Map<
    number,
    { expiryDate: string; batchNumber: string; expired: boolean }
  >();

  const considerBatch = (batch: InventoryBatchRow) => {
    const candidate = {
      expiryDate: batch.expiryDate,
      batchNumber: batch.batchNumber,
      expired: (batch.daysToExpiry ?? -1) < 0,
    };

    const current = nearestExpiryByItem.get(batch.itemId);

    if (!current) {
      nearestExpiryByItem.set(batch.itemId, candidate);
      return;
    }

    /* A usable lot always beats an expired one; otherwise earliest wins. */
    if (current.expired !== candidate.expired) {
      if (current.expired) nearestExpiryByItem.set(batch.itemId, candidate);
      return;
    }

    if (candidate.expiryDate < current.expiryDate) {
      nearestExpiryByItem.set(batch.itemId, candidate);
    }
  };

  /*
   * A lot with nothing left is not stock at risk. It is only shown when
   * the item has no batch holding stock at all, so the shelf still says
   * what it last held rather than "no batch recorded".
   */
  for (const batch of batches) {
    if (batch.quantityRemaining > 0) considerBatch(batch);
  }

  for (const batch of batches) {
    if (!nearestExpiryByItem.has(batch.itemId)) considerBatch(batch);
  }

  const expiringWithin10 = batches.filter(
    (batch) =>
      batch.quantityRemaining > 0 &&
      (batch.status === 'Expired' || (batch.daysToExpiry ?? 999) <= 10),
  );

  const filteredBatches = batches.filter((b) => batchFilter === 'All' || b.status === batchFilter);

  const batchStatusClass = (status: InventoryBatchRow['status']) => {
    if (status === 'Expired') return 'bg-rose-100 text-rose-800 border-rose-200';
    if (status === 'Expiring') return 'bg-amber-100 text-amber-900 border-amber-200';
    return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  };

  const handleReceiveBatch = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!receiveForm.quantity.trim() || !receiveForm.costPerUnit.trim()) {
      showToast('Enter the quantity and unit cost; use zero only when confirmed.', {
        tone: 'warning',
      });
      return;
    }
    const itemId = Number(receiveForm.itemId);

    if (!Number.isSafeInteger(itemId) || itemId <= 0) {
      showToast('Select a stock item first.');
      return;
    }

    try {
      const result = await api.receiveBatch(itemId, {
        facilityId: currentFacility?.id,
        batchNumber: receiveForm.batchNumber.trim(),
        expiryDate: receiveForm.expiryDate,
        quantity: Number(receiveForm.quantity),
        costPerUnit: receiveForm.costPerUnit,
      });

      showToast(
        `Received ${result.received} units into batch ${result.batch.batchNumber}` +
          (result.expiryMismatch
            ? ` (existing expiry ${result.expiryMismatch} kept)`
            : `, expiring ${result.batch.expiryDate}`) +
          '.',
      );

      setIsReceiveModalOpen(false);
      setReceiveForm({
        itemId: '',
        batchNumber: '',
        expiryDate: '',
        quantity: '',
        costPerUnit: '',
      });
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader>
        <div>
          <h1 className="ui-page-title">Hospital Inventory, Batches & Stores</h1>
          <p className="ui-page-description">
            Pharmaceutical stock tracking, reorder alert triggers, store locations, and valuation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <SecondaryButton onClick={() => setIsReceiveModalOpen(true)}>
            <PackagePlus className="w-3.5 h-3.5" />
            <span>Receive Batch</span>
          </SecondaryButton>

          <PrimaryButton onClick={() => setIsNewItemModalOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            <span>Add Stock Item</span>
          </PrimaryButton>
        </div>
      </PageHeader>

      {(itemsError || batchesError || expiryError) && (
        <ErrorState
          message={[itemsError, batchesError, expiryError].filter(Boolean).join(' ')}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      )}
      <Tabs
        label="Inventory views"
        idPrefix="inventory"
        value={tab}
        onChange={(id) => setTab(id as 'items' | 'batches')}
        items={[
          { id: 'items', label: 'Stock Items' },
          {
            id: 'batches',
            label: (
              <>
                Batches & Expiry{' '}
                {(expiry?.expiredBatches ?? 0) > 0 && (
                  <span className="ml-1 rounded bg-rose-600 px-1 text-white">
                    {expiry?.expiredBatches}
                  </span>
                )}
              </>
            ),
          },
        ]}
      />
      <div
        role="tabpanel"
        id="inventory-panel-items"
        aria-labelledby="inventory-tab-items"
        hidden={tab !== 'items'}
      >
        {tab === 'items' && (
          <>
            {/* Stock Health KPI Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                label="Total SKUs in store"
                value={loading ? '…' : itemsError ? 'Unavailable' : items.length}
                detail="Pharmaceuticals, consumables and reagents"
                icon={<Package size={19} />}
              />
              <StatCard
                label="Reorder level alerts"
                value={
                  loading
                    ? '…'
                    : itemsError || missingStockThreshold
                      ? 'Unavailable'
                      : lowStockCount
                }
                detail="Items at or below their recorded reorder threshold"
                icon={<AlertTriangle size={19} />}
              />
              <StatCard
                label="Store valuation"
                value={
                  loading
                    ? '…'
                    : itemsError ||
                        items.some(
                          (item) =>
                            item.unitCost == null ||
                            String(item.unitCost).trim() === '' ||
                            !Number.isFinite(Number(item.unitCost)) ||
                            item.currentStock == null ||
                            !Number.isFinite(Number(item.currentStock)),
                        )
                      ? 'Unavailable'
                      : ambiguousCost
                        ? 'Unconfirmed'
                        : `KES ${items.reduce((sum, item) => sum + Number(item.unitCost) * Number(item.currentStock), 0).toLocaleString()}`
                }
                detail="Recorded cost × stock; zero or missing costs require confirmation"
              />
            </div>

            {/* Search & Stock Table */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between gap-4">
                <SearchBar
                  className="w-full max-w-md"
                  aria-label="Search inventory"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search drug name, generic name, item code..."
                />

                <span className="text-2xs font-mono text-slate-400">
                  {loading
                    ? 'Loading…'
                    : itemsError
                      ? 'Items unavailable'
                      : `${filteredItems.length} items shown`}
                </span>
              </div>

              <div className="overflow-x-auto">
                <DataTable className="w-full text-xs text-left">
                  <thead className="bg-slate-50/80 text-2xs text-slate-500 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Item Code</th>
                      <th className="px-4 py-2.5 font-medium">Item Name & Strength</th>
                      <th className="px-4 py-2.5 font-medium">Generic Name</th>
                      <th className="px-4 py-2.5 font-medium">Category / Unit</th>
                      <th className="px-4 py-2.5 font-medium text-right">In Stock</th>
                      <th className="px-4 py-2.5 font-medium text-right">Reorder Lvl</th>
                      <th className="px-4 py-2.5 font-medium text-right">Unit Cost</th>
                      <th className="px-4 py-2.5 font-medium text-right">Selling Price</th>
                      <th className="px-4 py-2.5 font-medium">Expiry Countdown</th>
                      <th className="px-4 py-2.5 font-medium">Store Shelf</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {filteredItems.map((item) => {
                      const isLow =
                        hasStockThreshold(item) && item.currentStock <= item.reorderLevel;

                      return (
                        <tr key={item.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-3 font-bold text-teal-800">{item.itemCode}</td>
                          <td className="px-4 py-3 font-sans font-semibold text-slate-900">
                            {item.name}
                            {item.strength && (
                              <span className="text-2xs text-slate-400 ml-1">
                                ({item.strength})
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-sans text-slate-700">
                            {item.genericName || '—'}
                          </td>
                          <td className="px-4 py-3 font-sans text-slate-600">
                            {item.category} · {item.unit}
                          </td>
                          <td className="px-4 py-3 text-right font-bold">
                            <span className={isLow ? 'text-rose-600' : 'text-slate-900'}>
                              {item.currentStock ?? '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-500">
                            {item.reorderLevel ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-600">
                            {item.unitCost == null || String(item.unitCost).trim() === ''
                              ? 'Not recorded'
                              : Number(item.unitCost) === 0
                                ? 'Zero or unpriced'
                                : `KES ${Number(item.unitCost).toLocaleString()}`}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-teal-800">
                            {item.sellingPrice == null || String(item.sellingPrice).trim() === ''
                              ? 'Not recorded'
                              : Number(item.sellingPrice) === 0
                                ? 'Zero or unset'
                                : `KES ${Number(item.sellingPrice).toLocaleString()}`}
                          </td>
                          <td className="px-4 py-3 font-sans">
                            {nearestExpiryByItem.get(item.id) ? (
                              <div className="flex flex-col">
                                <ExpiryCountdown
                                  expiryDate={nearestExpiryByItem.get(item.id)!.expiryDate}
                                  short
                                />
                                <span className="text-3xs text-slate-400 font-mono">
                                  {nearestExpiryByItem.get(item.id)!.batchNumber} ·{' '}
                                  {nearestExpiryByItem.get(item.id)!.expiryDate}
                                </span>
                              </div>
                            ) : (
                              <span className="text-2xs text-slate-400">
                                {batchesError ? 'Batch data unavailable' : 'No batch recorded'}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-sans text-slate-600 text-2xs truncate max-w-xs">
                            {item.storeLocation}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </DataTable>
              </div>
            </div>
          </>
        )}
      </div>
      <div
        role="tabpanel"
        id="inventory-panel-batches"
        aria-labelledby="inventory-tab-batches"
        hidden={tab !== 'batches'}
      >
        {/* BATCHES & EXPIRY */}
        {tab === 'batches' && (
          <div className="space-y-4">
            <AlertBanner tone="info" className="text-xs">
              The batch API does not distinguish an unpriced lot from a zero cost. Confirm any zero
              or unpriced amounts before using them for valuation.
            </AlertBanner>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
                <span className="text-2xs uppercase text-rose-700 font-semibold tracking-wider flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Expired Stock</span>
                </span>
                <div className="text-2xl font-bold font-mono text-rose-700 mt-1">
                  {loading ? '…' : expiryError || !expiry ? '—' : expiry.expiredUnits}
                </div>
                <div className="text-2xs text-slate-500 mt-1">
                  {expiry
                    ? `units in ${expiry.expiredBatches} batch${expiry.expiredBatches === 1 ? '' : 'es'}`
                    : 'Expiry summary unavailable'}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
                <span className="text-2xs uppercase text-amber-700 font-semibold tracking-wider flex items-center gap-1">
                  <CalendarClock className="w-3.5 h-3.5" />
                  <span>Expiring in {expiry?.horizonDays ?? 30} days</span>
                </span>
                <div className="text-2xl font-bold font-mono text-amber-700 mt-1">
                  {loading ? '…' : expiryError || !expiry ? '—' : expiry.expiringUnits}
                </div>
                <div className="text-2xs text-slate-500 mt-1">
                  {expiry
                    ? `units in ${expiry.expiringBatches} batch${expiry.expiringBatches === 1 ? '' : 'es'}`
                    : 'Expiry summary unavailable'}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
                <span className="text-2xs uppercase text-slate-400 font-semibold tracking-wider">
                  Tracked Batches
                </span>
                <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
                  {loading ? '…' : batchesError ? '—' : batches.length}
                </div>
                <div className="text-2xs text-slate-500 mt-1">
                  Lots with a batch number and expiry
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
                <span className="text-2xs uppercase text-slate-400 font-semibold tracking-wider">
                  Items Affected
                </span>
                <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
                  {loading ? '…' : expiryError || !expiry ? '—' : expiry.affectedItems}
                </div>
                <div className="text-2xs text-slate-500 mt-1">Have stock expired or expiring</div>
              </div>
            </div>

            {expiringWithin10.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-amber-900">
                  <CalendarClock className="w-3.5 h-3.5" />
                  <span>
                    {expiringWithin10.length} batch
                    {expiringWithin10.length === 1 ? '' : 'es'} expired or expiring within 10 days
                  </span>
                </div>

                <ul className="mt-2 divide-y divide-amber-200/70">
                  {expiringWithin10.slice(0, 6).map((batch) => (
                    <li
                      key={batch.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                    >
                      <span className="text-amber-950">
                        <strong className="font-semibold">{batch.itemName}</strong>
                        <span className="ml-1.5 font-mono text-2xs text-amber-800">
                          {batch.batchNumber}
                        </span>
                        <span className="ml-1.5 text-2xs text-amber-800">
                          {batch.quantityRemaining} {batch.unit ?? 'units'}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 font-mono text-2xs text-amber-900">
                        {batch.expiryDate}
                        <ExpiryCountdown expiryDate={batch.expiryDate} short />
                      </span>
                    </li>
                  ))}
                </ul>

                {expiringWithin10.length > 6 && (
                  <p className="mt-1.5 text-2xs text-amber-800">
                    {expiringWithin10.length - 6} more. The overview lists every lot inside the
                    ten-day window.
                  </p>
                )}
              </div>
            )}

            {!loading && !batchesError && batches.length === 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-6 text-xs text-slate-600">
                <p className="font-semibold text-slate-900 mb-1">No batches recorded yet.</p>
                <p>
                  Stock received with <strong>Receive Batch</strong> is tracked by lot and expiry,
                  and dispensing then draws first-expiry-first-out. Items without batches keep
                  dispensing from their plain stock count.
                </p>
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
              <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1">
                  {(['All', 'Expired', 'Expiring', 'OK'] as const).map((status) => (
                    <button
                      key={status}
                      onClick={() => setBatchFilter(status)}
                      className={`px-2.5 py-1 rounded-md text-2xs font-semibold border transition-colors ${
                        batchFilter === status
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {status}
                      {status !== 'All' && (
                        <span className="ml-1 opacity-70">
                          {batches.filter((b) => b.status === status).length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <span className="text-2xs font-mono text-slate-400">
                  {filteredBatches.length} batch{filteredBatches.length === 1 ? '' : 'es'} · FEFO
                  order
                </span>
              </div>

              <div className="overflow-x-auto">
                <DataTable className="w-full text-xs text-left">
                  <thead className="bg-slate-50/80 text-2xs text-slate-500 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Item</th>
                      <th className="px-4 py-2.5 font-medium">Batch No.</th>
                      <th className="px-4 py-2.5 font-medium">Expiry</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium text-right">Remaining</th>
                      <th className="px-4 py-2.5 font-medium text-right">Unit Cost</th>
                      <th className="px-4 py-2.5 font-medium text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredBatches.map((batch) => (
                      <tr key={batch.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{batch.itemName}</div>
                          <div className="text-2xs text-slate-500 font-mono">{batch.itemCode}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-700">{batch.batchNumber}</td>
                        <td className="px-4 py-3 font-mono text-slate-700">
                          {batch.expiryDate}
                          <div className="mt-0.5">
                            <ExpiryCountdown expiryDate={batch.expiryDate} short />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded border text-2xs font-semibold ${batchStatusClass(batch.status)}`}
                          >
                            {batch.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                          {batch.quantityRemaining}
                          <span className="ml-1 text-2xs text-slate-400 font-normal">
                            {batch.unit}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-600">
                          {Number(batch.costPerUnit) === 0
                            ? 'Zero or unpriced'
                            : `KES ${Number(batch.costPerUnit).toLocaleString()}`}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-700">
                          {Number(batch.costPerUnit) === 0
                            ? 'Unconfirmed'
                            : `KES ${(Number(batch.costPerUnit) * batch.quantityRemaining).toLocaleString()}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>

                {filteredBatches.length === 0 && batches.length > 0 && (
                  <div className="px-4 py-6 text-center text-xs text-slate-500">
                    No batches with status {batchFilter}.
                  </div>
                )}
              </div>
            </div>

            <p className="text-2xs text-slate-400 px-1">
              Dispensing draws the earliest expiry first. A batch expiring today is still
              dispensable; expired stock is never dispensed and is excluded from the available
              quantity.
            </p>
          </div>
        )}
      </div>

      {/* ADD ITEM MODAL */}
      <Modal
        open={isNewItemModalOpen}
        onClose={() => setIsNewItemModalOpen(false)}
        title="Add Inventory Stock Item"

        actions={
          <>
            <SecondaryButton onClick={() => setIsNewItemModalOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton type="submit" form="inventory-item-form">
              Save Stock Item
            </PrimaryButton>
          </>
        }
      >
        <p className="mb-4 text-xs text-muted">
          Configure an item, its pricing, reorder threshold and the expiry of its opening batch.
        </p>
        <form id="inventory-item-form" onSubmit={handleCreateItem} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1" htmlFor="inventory-field-1">
                Item Code *
              </label>
              <input
                id="inventory-field-1"
                type="text"
                required
                value={newItem.itemCode}
                onChange={(e) => setNewItem({ ...newItem, itemCode: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1" htmlFor="inventory-field-2">
                Category
              </label>
              <select
                id="inventory-field-2"
                value={newItem.category}
                onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              >
                <option value="Pharmaceuticals">Pharmaceuticals</option>
                <option value="Surgical Supplies">Surgical Supplies</option>
                <option value="Lab Reagents">Lab Reagents</option>
                <option value="General Consumables">General Consumables</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1" htmlFor="inventory-field-3">
              Trade / Brand Name *
            </label>
            <input
              id="inventory-field-3"
              type="text"
              required
              value={newItem.name}
              onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-md"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1" htmlFor="inventory-field-4">
                Generic Name
              </label>
              <input
                id="inventory-field-4"
                type="text"
                value={newItem.genericName}
                onChange={(e) => setNewItem({ ...newItem, genericName: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1" htmlFor="inventory-field-5">
                Dosage Form & Strength
              </label>
              <input
                id="inventory-field-5"
                type="text"
                value={newItem.strength}
                onChange={(e) => setNewItem({ ...newItem, strength: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1" htmlFor="inventory-unit">
              Unit of stock
            </label>
            <input
              id="inventory-unit"
              type="text"
              value={newItem.unit}
              onChange={(event) => setNewItem({ ...newItem, unit: event.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-md"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1" htmlFor="inventory-field-6">
                Initial Stock Quantity
              </label>
              <input
                id="inventory-field-6"
                type="number"
                required
                min={0}
                step={1}
                value={newItem.currentStock}
                onChange={(e) => setNewItem({ ...newItem, currentStock: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1" htmlFor="inventory-field-7">
                Reorder Level Alert
              </label>
              <input
                id="inventory-field-7"
                type="number"
                required
                min={0}
                step={1}
                value={newItem.reorderLevel}
                onChange={(e) => setNewItem({ ...newItem, reorderLevel: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1" htmlFor="inventory-field-8">
                Batch Number
              </label>
              <input
                id="inventory-field-8"
                type="text"
                value={newItem.batchNumber}
                onChange={(e) => setNewItem({ ...newItem, batchNumber: e.target.value })}
                placeholder="e.g. BATCH-2026A"
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                maxLength={64}
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1" htmlFor="inventory-field-9">
                Expiry Date
              </label>
              <input
                id="inventory-field-9"
                type="date"
                value={newItem.expiryDate}
                onChange={(e) => setNewItem({ ...newItem, expiryDate: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
          </div>

          <p className="text-2xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md p-2.5">
            {newItem.expiryDate && expiryDeadline(newItem.expiryDate) ? (
              <span className="flex flex-wrap items-center gap-1.5">
                <CalendarClock className="w-3 h-3" />
                Opening stock expires on {newItem.expiryDate} —
                <ExpiryCountdown expiryDate={newItem.expiryDate} short />
              </span>
            ) : (
              <span>
                Expiry belongs to the batch, not the item. Enter a batch number and an expiry date
                to receive the opening stock into that lot; the stock list then counts down to it.
                Leave both blank to track a plain stock count with no expiry.
              </span>
            )}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1" htmlFor="inventory-field-10">
                Unit Cost (KES)
              </label>
              <input
                id="inventory-field-10"
                type="text"
                value={newItem.unitCost}
                onChange={(e) => setNewItem({ ...newItem, unitCost: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1" htmlFor="inventory-field-11">
                Selling Price (KES)
              </label>
              <input
                id="inventory-field-11"
                type="text"
                value={newItem.sellingPrice}
                onChange={(e) => setNewItem({ ...newItem, sellingPrice: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1" htmlFor="inventory-field-12">
              Store Location
            </label>
            <input
              id="inventory-field-12"
              type="text"
              value={newItem.storeLocation}
              onChange={(e) => setNewItem({ ...newItem, storeLocation: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-md"
            />
          </div>
        </form>
      </Modal>

      {/* RECEIVE BATCH MODAL */}
      <Modal
        open={isReceiveModalOpen}
        onClose={() => setIsReceiveModalOpen(false)}
        title="Receive Stock into a Batch"

        actions={
          <>
            <SecondaryButton onClick={() => setIsReceiveModalOpen(false)}>Cancel</SecondaryButton>
            <PrimaryButton type="submit" form="inventory-receive-form">
              Receive Stock
            </PrimaryButton>
          </>
        }
      >
        <form id="inventory-receive-form" onSubmit={handleReceiveBatch} className="space-y-3">
          <div>
            <label className="block font-medium text-slate-700 mb-1" htmlFor="inventory-field-13">
              Stock Item
            </label>
            <select
              id="inventory-field-13"
              value={receiveForm.itemId}
              onChange={(e) => setReceiveForm({ ...receiveForm, itemId: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-md"
              required
            >
              <option value="">Select an item…</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.itemCode} — {item.name}
                  {item.strength ? ` (${item.strength})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1" htmlFor="inventory-field-14">
                Batch Number
              </label>
              <input
                id="inventory-field-14"
                type="text"
                value={receiveForm.batchNumber}
                onChange={(e) => setReceiveForm({ ...receiveForm, batchNumber: e.target.value })}
                placeholder="e.g. BATCH-2026A"
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                maxLength={64}
                required
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1" htmlFor="inventory-field-15">
                Expiry Date
              </label>
              <input
                id="inventory-field-15"
                type="date"
                value={receiveForm.expiryDate}
                onChange={(e) => setReceiveForm({ ...receiveForm, expiryDate: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1" htmlFor="inventory-field-16">
                Quantity
              </label>
              <input
                id="inventory-field-16"
                type="number"
                min={1}
                step={1}
                value={receiveForm.quantity}
                onChange={(e) => setReceiveForm({ ...receiveForm, quantity: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono font-bold"
                required
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1" htmlFor="inventory-field-17">
                Cost per Unit (KES)
              </label>
              <input
                id="inventory-field-17"
                type="number"
                min={0}
                step="0.01"
                required
                value={receiveForm.costPerUnit}
                onChange={(e) => setReceiveForm({ ...receiveForm, costPerUnit: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
              />
            </div>
          </div>

          <p className="text-2xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md p-2.5">
            Receiving the same batch number again tops up the existing lot. The expiry already
            recorded for that batch is never extended. Stock cannot be received already expired.
          </p>
        </form>
      </Modal>
    </div>
  );
};
