import React, { useMemo, useState } from 'react';
import { 
  Search, 
  Plus, 
  Trash2, 
  Edit3,
  Package,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { motion } from 'motion/react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { ConfirmDialog } from './ConfirmDialog';

export const SkusTab: React.FC = () => {
  const skus = useWarehouseStore((state) => state.skus);
  const handleDeleteSku = useWarehouseStore((state) => state.handleDeleteSku);
  
  const skuSearch = useUIStore((state) => state.skuSearch);
  const setSkuSearch = useUIStore((state) => state.setSkuSearch);
  const setShowSkuModal = useUIStore((state) => state.setShowSkuModal);
  const setEditingSku = useUIStore((state) => state.setEditingSku);
  const setSkuForm = useUIStore((state) => state.setSkuForm);

  const [skuToDelete, setSkuToDelete] = useState<string | null>(null);

  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>({ key: 'sku', direction: 'asc' });

  const filteredSkus = useMemo(() => {
    return skus.filter(s => {
      const skuStr = s.sku || (s as any).article || '';
      return skuStr.toLowerCase().includes(skuSearch.toLowerCase());
    });
  }, [skus, skuSearch]);

  const sortedSkus = useMemo(() => {
    let sortableItems = [...filteredSkus];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        let aValue: any = a[sortConfig.key as keyof typeof a];
        let bValue: any = b[sortConfig.key as keyof typeof b];

        if (typeof aValue === 'string') {
          aValue = aValue.toLowerCase();
          bValue = bValue.toLowerCase();
        }

        if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableItems;
  }, [filteredSkus, sortConfig]);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (columnKey: string) => {
    if (!sortConfig || sortConfig.key !== columnKey) {
      return <ArrowUpDown size={14} className="inline opacity-30 group-hover:opacity-100 ml-1" />;
    }
    return sortConfig.direction === 'asc' ? 
      <ArrowUp size={14} className="inline text-indigo-600 ml-1" /> : 
      <ArrowDown size={14} className="inline text-indigo-600 ml-1" />;
  };

  return (
    <motion.div 
      key="skus"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold">Справочник SKU</h2>
          <p className="text-slate-500">Управление номенклатурой товаров</p>
        </div>
        <button 
          onClick={() => {
            setEditingSku(null);
            setSkuForm({ sku: '', price: 0, minStock: 10, pcsPerBox: 1 });
            setShowSkuModal(true);
          }}
          className="flex items-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
        >
          <Plus size={20} /> Добавить SKU
        </button>
      </div>

      {/* Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="relative max-w-md">
          <input 
            type="text"
            placeholder="Поиск по артикулу..."
            value={skuSearch}
            onChange={(e) => setSkuSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/50 border-b border-slate-200">
              <th className="px-6 py-4 font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('sku')}>
                Артикул {getSortIcon('sku')}
              </th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('pcsPerBox')}>
                Шт/Кор {getSortIcon('pcsPerBox')}
              </th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('minStock')}>
                Мин. остаток {getSortIcon('minStock')}
              </th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {sortedSkus.map((s, index) => (
              <tr key={`${s.sku}-${index}`} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4 font-mono text-sm text-indigo-600 font-medium">{s.sku}</td>
                <td className="px-6 py-4 text-right font-bold text-slate-900">{s.pcsPerBox}</td>
                <td className="px-6 py-4 text-right">
                  <span className="px-2 py-1 bg-amber-50 text-amber-600 rounded-md font-bold text-xs">
                    {s.minStock} шт
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button 
                      onClick={() => {
                        setEditingSku(s);
                        setSkuForm({ ...s });
                        setShowSkuModal(true);
                      }}
                      className="p-2 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded-lg transition-all"
                    >
                      <Edit3 size={16} />
                    </button>
                    <button 
                      onClick={() => setSkuToDelete(s.sku)}
                      className="p-2 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-all"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {filteredSkus.length === 0 && (
          <div className="p-20 text-center">
            <Package className="mx-auto text-slate-200 mb-4" size={48} />
            <p className="text-slate-400 font-medium">SKU не найдены</p>
          </div>
        )}
      </div>

      <ConfirmDialog 
        show={skuToDelete !== null}
        title="Подтверждение удаления"
        message={`Вы действительно хотите удалить SKU ${skuToDelete}? Это действие нельзя отменить.`}
        onConfirm={() => {
          if (skuToDelete) handleDeleteSku(skuToDelete);
        }}
        onCancel={() => setSkuToDelete(null)}
      />
    </motion.div>
  );
};
