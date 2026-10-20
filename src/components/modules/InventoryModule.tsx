import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { InventoryItem, InventoryBatchRow, ExpirySummary } from '../../types/index.ts';
import {
  Package,
  AlertTriangle,
  Plus,
  Search,
  CheckCircle2,
  TrendingDown,
  Layers,
  CalendarClock,
  PackagePlus,
  RefreshCw
} from 'lucide-react';

export const InventoryModule: React.FC = () => {
  const { currentFacility, showToast, refreshKey, triggerRefresh } = useHmis();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

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
    quantity: '100',
    costPerUnit: '0',
  });

  // New Item Modal
  const [isNewItemModalOpen, setIsNewItemModalOpen] = useState(false);
  const [newItem, setNewItem] = useState({
    itemCode: 'DRUG-NEW-01',
    name: 'Ceftriaxone 1g Powder for Injection',
    genericName: 'Ceftriaxone',
    category: 'Pharmaceuticals',
    unit: 'Vials',
    strength: '1g',
    dosageForm: 'Injection',
    currentStock: 150,
    reorderLevel: 50,
    unitCost: '180.00',
    sellingPrice: '300.00',
    storeLocation: 'Main Pharmacy Cold Storage',
  });

  useEffect(() => {
    async function loadInventory() {
      setLoading(true);
      try {
        const [list, batchList, expirySummary] = await Promise.all([
          api.getInventory(currentFacility?.id),
          api.getInventoryBatches(currentFacility?.id, { horizonDays: 30 }).catch((err) => {
            console.error('Failed to load batches:', err);
            return [] as InventoryBatchRow[];
          }),
          api.getExpirySummary(currentFacility?.id, 30).catch((err) => {
            console.error('Failed to load expiry summary:', err);
            return null;
          }),
        ]);

        setItems(list);
        setBatches(batchList);
        setExpiry(expirySummary);
      } catch (err) {
        console.error('Failed to load inventory:', err);
      } finally {
        setLoading(false);
      }
    }
    loadInventory();
  }, [currentFacility, refreshKey]);

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createInventoryItem({
        facilityId: currentFacility?.id || 1,
        ...newItem,
        currentStock: Number(newItem.currentStock),
        reorderLevel: Number(newItem.reorderLevel),
      });

      showToast('Item added to facility inventory catalogue!');
      setIsNewItemModalOpen(false);
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  const filteredItems = items.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.genericName && i.genericName.toLowerCase().includes(search.toLowerCase())) ||
    i.itemCode.toLowerCase().includes(search.toLowerCase())
  );

  const lowStockCount = items.filter(i => (i.currentStock || 0) <= (i.reorderLevel || 50)).length;

  const filteredBatches = batches.filter(
    (b) => batchFilter === 'All' || b.status === batchFilter
  );

  const batchStatusClass = (status: InventoryBatchRow['status']) => {
    if (status === 'Expired') return 'bg-rose-100 text-rose-800 border-rose-200';
    if (status === 'Expiring') return 'bg-amber-100 text-amber-900 border-amber-200';
    return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  };

  const handleReceiveBatch = async (e: React.FormEvent) => {
    e.preventDefault();

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
          '.'
      );

      setIsReceiveModalOpen(false);
      setReceiveForm({ itemId: '', batchNumber: '', expiryDate: '', quantity: '100', costPerUnit: '0' });
      triggerRefresh();
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Hospital Inventory, Batches & Stores</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Pharmaceutical stock tracking, reorder alert triggers, store locations, and valuation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setReceiveForm((prev) => ({
                ...prev,
                itemId: prev.itemId || String(items[0]?.id ?? ''),
              }));
              setIsReceiveModalOpen(true);
            }}
            className="px-3.5 py-2 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <PackagePlus className="w-3.5 h-3.5" />
            <span>Receive Batch</span>
          </button>

          <button
            onClick={() => setIsNewItemModalOpen(true)}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Stock Item</span>
          </button>
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit shadow-xs">
        <button
          onClick={() => setTab('items')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            tab === 'items' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          Stock Items
        </button>
        <button
          onClick={() => setTab('batches')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
            tab === 'batches' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          Batches & Expiry
          {(expiry?.expiredBatches ?? 0) > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-3xs font-bold">
              {expiry?.expiredBatches}
            </span>
          )}
        </button>
      </div>

      {tab === 'items' && (
      <>
      {/* Stock Health KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
          <span className="text-2xs uppercase text-slate-400 font-semibold tracking-wider">Total SKUs in Store</span>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-1">{items.length}</div>
          <div className="text-2xs text-slate-500 mt-1">Pharmaceuticals, Consumables, Reagents</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
          <span className="text-2xs uppercase text-amber-700 font-semibold tracking-wider flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Reorder Level Alerts</span>
          </span>
          <div className="text-2xl font-bold font-mono text-amber-700 mt-1">{lowStockCount}</div>
          <div className="text-2xs text-slate-500 mt-1">Items at or below safe reorder threshold</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
          <span className="text-2xs uppercase text-teal-800 font-semibold tracking-wider">Store Valuation</span>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
            KES {items.reduce((acc, i) => acc + (Number(i.unitCost || 0) * (i.currentStock || 0)), 0).toLocaleString()}
          </div>
          <div className="text-2xs text-slate-500 mt-1">Total inventory acquisition value</div>
        </div>
      </div>

      {/* Search & Stock Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search drug name, generic name, item code..."
              className="w-full pl-9 pr-4 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-700 bg-white"
            />
          </div>

          <span className="text-2xs font-mono text-slate-400">{filteredItems.length} items shown</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
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
                <th className="px-4 py-2.5 font-medium">Store Shelf</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {filteredItems.map((item) => {
                const isLow = (item.currentStock || 0) <= (item.reorderLevel || 50);

                return (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-bold text-teal-800">{item.itemCode}</td>
                    <td className="px-4 py-3 font-sans font-semibold text-slate-900">
                      {item.name}
                      {item.strength && <span className="text-2xs text-slate-400 ml-1">({item.strength})</span>}
                    </td>
                    <td className="px-4 py-3 font-sans text-slate-700">{item.genericName || '—'}</td>
                    <td className="px-4 py-3 font-sans text-slate-600">
                      {item.category} · {item.unit}
                    </td>
                    <td className="px-4 py-3 text-right font-bold">
                      <span className={isLow ? 'text-rose-600' : 'text-slate-900'}>
                        {item.currentStock}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">{item.reorderLevel}</td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      KES {Number(item.unitCost).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-teal-800">
                      KES {Number(item.sellingPrice).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-sans text-slate-600 text-2xs truncate max-w-xs">
                      {item.storeLocation}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      </>
      )}

      {/* BATCHES & EXPIRY */}
      {tab === 'batches' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
              <span className="text-2xs uppercase text-rose-700 font-semibold tracking-wider flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Expired Stock</span>
              </span>
              <div className="text-2xl font-bold font-mono text-rose-700 mt-1">
                {expiry?.expiredUnits ?? 0}
              </div>
              <div className="text-2xs text-slate-500 mt-1">
                units in {expiry?.expiredBatches ?? 0} batch{(expiry?.expiredBatches ?? 0) === 1 ? '' : 'es'} · KES{' '}
                {((expiry?.expiredValueCents ?? 0) / 100).toLocaleString()}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
              <span className="text-2xs uppercase text-amber-700 font-semibold tracking-wider flex items-center gap-1">
                <CalendarClock className="w-3.5 h-3.5" />
                <span>Expiring in {expiry?.horizonDays ?? 30} days</span>
              </span>
              <div className="text-2xl font-bold font-mono text-amber-700 mt-1">
                {expiry?.expiringUnits ?? 0}
              </div>
              <div className="text-2xs text-slate-500 mt-1">
                units in {expiry?.expiringBatches ?? 0} batch{(expiry?.expiringBatches ?? 0) === 1 ? '' : 'es'} · KES{' '}
                {((expiry?.expiringValueCents ?? 0) / 100).toLocaleString()}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
              <span className="text-2xs uppercase text-slate-400 font-semibold tracking-wider">Tracked Batches</span>
              <div className="text-2xl font-bold font-mono text-slate-900 mt-1">{batches.length}</div>
              <div className="text-2xs text-slate-500 mt-1">Lots with a batch number and expiry</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs">
              <span className="text-2xs uppercase text-slate-400 font-semibold tracking-wider">Items Affected</span>
              <div className="text-2xl font-bold font-mono text-slate-900 mt-1">{expiry?.affectedItems ?? 0}</div>
              <div className="text-2xs text-slate-500 mt-1">Have stock expired or expiring</div>
            </div>
          </div>

          {!loading && batches.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-xs text-slate-600">
              <p className="font-semibold text-slate-900 mb-1">No batches recorded yet.</p>
              <p>
                Stock received with <strong>Receive Batch</strong> is tracked by lot and expiry, and
                dispensing then draws first-expiry-first-out. Items without batches keep dispensing
                from their plain stock count.
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
                {filteredBatches.length} batch{filteredBatches.length === 1 ? '' : 'es'} · FEFO order
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
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
                        <span className="ml-1.5 text-2xs text-slate-400">
                          {batch.daysToExpiry === null
                            ? ''
                            : batch.daysToExpiry < 0
                              ? `${Math.abs(batch.daysToExpiry)}d ago`
                              : `in ${batch.daysToExpiry}d`}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded border text-2xs font-semibold ${batchStatusClass(batch.status)}`}>
                          {batch.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                        {batch.quantityRemaining}
                        <span className="ml-1 text-2xs text-slate-400 font-normal">{batch.unit}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-600">
                        KES {Number(batch.costPerUnit).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-700">
                        KES {(Number(batch.costPerUnit) * batch.quantityRemaining).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredBatches.length === 0 && batches.length > 0 && (
                <div className="px-4 py-6 text-center text-xs text-slate-500">
                  No batches with status {batchFilter}.
                </div>
              )}
            </div>
          </div>

          <p className="text-2xs text-slate-400 px-1">
            Dispensing draws the earliest expiry first. A batch expiring today is still dispensable;
            expired stock is never dispensed and is excluded from the available quantity.
          </p>
        </div>
      )}

      {/* ADD ITEM MODAL */}
      {isNewItemModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Add Inventory Stock Item</h3>
              <p className="text-2xs text-slate-500">Configure new pharmaceutical item, pricing, and reorder threshold.</p>
            </div>

            <form onSubmit={handleCreateItem} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Item Code *</label>
                  <input
                    type="text"
                    required
                    value={newItem.itemCode}
                    onChange={(e) => setNewItem({ ...newItem, itemCode: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Category</label>
                  <select
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
                <label className="block font-medium text-slate-700 mb-1">Trade / Brand Name *</label>
                <input
                  type="text"
                  required
                  value={newItem.name}
                  onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Generic Name</label>
                  <input
                    type="text"
                    value={newItem.genericName}
                    onChange={(e) => setNewItem({ ...newItem, genericName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Dosage Form & Strength</label>
                  <input
                    type="text"
                    value={newItem.strength}
                    onChange={(e) => setNewItem({ ...newItem, strength: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Initial Stock Quantity</label>
                  <input
                    type="number"
                    value={newItem.currentStock}
                    onChange={(e) => setNewItem({ ...newItem, currentStock: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Reorder Level Alert</label>
                  <input
                    type="number"
                    value={newItem.reorderLevel}
                    onChange={(e) => setNewItem({ ...newItem, reorderLevel: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Unit Cost (KES)</label>
                  <input
                    type="text"
                    value={newItem.unitCost}
                    onChange={(e) => setNewItem({ ...newItem, unitCost: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Selling Price (KES)</label>
                  <input
                    type="text"
                    value={newItem.sellingPrice}
                    onChange={(e) => setNewItem({ ...newItem, sellingPrice: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-md font-mono font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Store Location</label>
                <input
                  type="text"
                  value={newItem.storeLocation}
                  onChange={(e) => setNewItem({ ...newItem, storeLocation: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-md"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsNewItemModalOpen(false)}
                  className="px-3.5 py-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-teal-700 text-white rounded-md font-semibold hover:bg-teal-800"
                >
                  Save Stock Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RECEIVE BATCH MODAL */}
      {isReceiveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <PackagePlus className="w-4 h-4 text-teal-700" />
                Receive Stock into a Batch
              </h3>
              <button
                type="button"
                onClick={() => setIsReceiveModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-lg leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleReceiveBatch} className="space-y-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Stock Item</label>
                <select
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
                  <label className="block font-medium text-slate-700 mb-1">Batch Number</label>
                  <input
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
                  <label className="block font-medium text-slate-700 mb-1">Expiry Date</label>
                  <input
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
                  <label className="block font-medium text-slate-700 mb-1">Quantity</label>
                  <input
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
                  <label className="block font-medium text-slate-700 mb-1">Cost per Unit (KES)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
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

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsReceiveModalOpen(false)}
                  className="px-3.5 py-1.5 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-teal-700 text-white rounded-md font-semibold hover:bg-teal-800"
                >
                  Receive Stock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
