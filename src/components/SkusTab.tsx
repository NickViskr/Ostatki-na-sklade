import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { 
  Search, 
  Plus, 
  Trash2, 
  Edit3,
  Package,
  Layers,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Download
} from 'lucide-react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { ConfirmDialog } from './ConfirmDialog';

export const SkusTab: React.FC = React.memo(() => {
  const skus = useWarehouseStore((state) => state.skus);
  const kits = useWarehouseStore((state) => state.kits);
  const handleDeleteSku = useWarehouseStore((state) => state.handleDeleteSku);
  
  const skuSearch = useUIStore((state) => state.skuSearch);
  const setSkuSearch = useUIStore((state) => state.setSkuSearch);
  const setShowSkuModal = useUIStore((state) => state.setShowSkuModal);
  const setEditingSku = useUIStore((state) => state.setEditingSku);
  const setSkuForm = useUIStore((state) => state.setSkuForm);
  const showKitModal = useUIStore((state) => state.showKitModal);
  const setShowKitModal = useUIStore((state) => state.setShowKitModal);
  const kitModalSku = useUIStore((state) => state.kitModalSku);
  const setKitModalSku = useUIStore((state) => state.setKitModalSku);

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

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);

  useEffect(() => {
    setCurrentPage(1);
  }, [skuSearch]);

  const totalPages = Math.ceil(sortedSkus.length / pageSize) || 1;

  const displayedSkus = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedSkus.slice(start, start + pageSize);
  }, [sortedSkus, currentPage, pageSize]);

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const handleExportCSV = useCallback(() => {
    if (sortedSkus.length === 0) return;
    
    const headers = ['Артикул', 'Штрихкод Ozon', 'Штрихкод WB', 'Шт. в коробе', 'Минимальный остаток'];
    const csvContent = [
      headers.join(';'),
      ...sortedSkus.map(s => 
        [
          s.sku,
          s.ozonBarcode || '',
          s.wbBarcode || '',
          s.pcsPerBox,
          s.minStock
        ].join(';')
      )
    ].join('\n');

    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    link.setAttribute('href', url);
    link.setAttribute('download', `skus_export_${dateStr}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [sortedSkus]);

  const getSortIcon = (columnKey: string) => {
    if (!sortConfig || sortConfig.key !== columnKey) {
      return <ArrowUpDown size={14} className="inline opacity-30 group-hover:opacity-100 ml-1" />;
    }
    return sortConfig.direction === 'asc' ? 
      <ArrowUp size={14} className="inline text-indigo-600 ml-1" /> : 
      <ArrowDown size={14} className="inline text-indigo-600 ml-1" />;
  };

  return (
    <div 
      key="skus"
      className="space-y-6 tab-enter"
    >
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold">Справочник SKU</h2>
          <p className="text-slate-500">Управление номенклатурой товаров</p>
        </div>
        <div className="flex gap-3 items-center">
          <button 
            onClick={handleExportCSV}
            className="flex items-center gap-2 bg-white text-slate-700 border border-slate-200 px-4 py-3 rounded-2xl font-bold hover:bg-slate-50 transition-all shadow-sm"
            title="Выгрузить текущий список в CSV"
          >
            <Download size={20} /> Экспорт CSV
          </button>
          <button 
            onClick={() => {
              setEditingSku(null);
              setSkuForm({ sku: '', price: 0, minStock: 10, pcsPerBox: 1, volumeLiters: 0 });
              setShowSkuModal(true);
            }}
            className="flex items-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
          >
            <Plus size={20} /> Добавить SKU
          </button>
        </div>
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
              <th className="px-6 py-4 font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('ozonBarcode')}>
                ШК (Ozon) {getSortIcon('ozonBarcode')}
              </th>
              <th className="px-6 py-4 font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('wbBarcode')}>
                Баркод (WB) {getSortIcon('wbBarcode')}
              </th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('pcsPerBox')}>
                Шт/Кор {getSortIcon('pcsPerBox')}
              </th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('minStock')}>
                Мин. остаток {getSortIcon('minStock')}
              </th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-center">
                Комплект
              </th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('volumeLiters')}>
                Литраж, л {getSortIcon('volumeLiters')}
              </th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {displayedSkus.map((s, index) => {
              const hasKit = kits.some(k => k.kitSku === s.sku);
              return (
              <tr key={`${s.sku}-${index}`} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4 font-mono text-sm text-indigo-600 font-medium">{s.sku}</td>
                <td className="px-6 py-4 font-mono text-sm text-slate-600">{s.ozonBarcode || '-'}</td>
                <td className="px-6 py-4 font-mono text-sm text-slate-600">{s.wbBarcode || '-'}</td>
                <td className="px-6 py-4 text-right font-bold text-slate-900">{s.pcsPerBox}</td>
                <td className="px-6 py-4 text-right">
                  <span className="px-2 py-1 bg-amber-50 text-amber-600 rounded-md font-bold text-xs">
                    {s.minStock} шт
                  </span>
                </td>
                <td className="px-6 py-4 text-center">
                  {hasKit
                    ? <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-violet-50 text-violet-600">
                        <Layers size={11} /> Комплект
                      </span>
                    : <span className="text-slate-200 text-xs">—</span>
                  }
                </td>
                <td className="px-6 py-4 text-right font-medium text-slate-900">
                  {s.volumeLiters && s.volumeLiters > 0 ? (
                    s.volumeLiters
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => { setKitModalSku(s.sku); setShowKitModal(true); }}
                      title={hasKit ? 'Редактировать комплект' : 'Создать комплект'}
                      className={`p-2 rounded-lg transition-all ${
                        hasKit
                          ? 'bg-violet-50 text-violet-600 hover:bg-violet-100 ring-1 ring-violet-200'
                          : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                      }`}
                    >
                      <Layers size={16} />
                    </button>
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
            )})}
          </tbody>
        </table>
        
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50 rounded-b-3xl">
            <div className="text-sm text-slate-500 font-medium flex items-center gap-2">
              <span>Записи с {(currentPage - 1) * pageSize + 1} по {Math.min(currentPage * pageSize, sortedSkus.length)} из {sortedSkus.length}</span>
              <span className="text-slate-300">|</span>
              <label htmlFor="pageSizeSkus" className="sr-only">Размер страницы</label>
              <select
                id="pageSizeSkus"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="text-sm border border-slate-200 rounded-lg px-2 py-1 bg-white outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-slate-700"
              >
                <option value={30}>30</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={150}>150</option>
              </select>
            </div>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1 rounded-md hover:bg-slate-200 text-slate-600 disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
                title="Предыдущая страница"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="text-sm font-medium text-slate-600 px-2 min-w-[100px] text-center">
                Стр. {currentPage} из {totalPages}
              </span>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1 rounded-md hover:bg-slate-200 text-slate-600 disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
                title="Следующая страница"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
        )}

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
    </div>
  );
});
