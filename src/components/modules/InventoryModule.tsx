import React, { useState, useEffect } from 'react';
import { useHmis } from '../../context/HmisContext.tsx';
import { api } from '../../api/client.ts';
import { InventoryItem } from '../../types/index.ts';
import {
  Package,
  AlertTriangle,
  Plus,
  Search,
  CheckCircle2,
  TrendingDown,
  Layers
} from 'lucide-react';

export const InventoryModule: React.FC = () => {
  const { currentFacility, showToast, refreshKey, triggerRefresh } = useHmis();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

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
        const list = await api.getInventory(currentFacility?.id);
        setItems(list);
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
            onClick={() => setIsNewItemModalOpen(true)}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Stock Item</span>
          </button>
        </div>
      </div>

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
    </div>
  );
};
