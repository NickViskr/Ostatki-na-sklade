import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { Package, Truck, TrendingDown, Calendar, Filter, Edit3, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';

export const ShipmentCostTab: React.FC = () => {
  const transactions = useWarehouseStore((state) => state.transactions);
  const handleDeleteTransaction = useWarehouseStore((state) => state.handleDeleteTransaction);
  
  const setEditingTrans = useUIStore((state) => state.setEditingTrans);
  const setShowEditTransModal = useUIStore((state) => state.setShowEditTransModal);
  
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [destinationFilter, setDestinationFilter] = useState('');
  
  const [transToDelete, setTransToDelete] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const handleDeleteMultipleTransactions = useWarehouseStore((state) => state.handleDeleteMultipleTransactions);

  const uniqueDestinations = useMemo(() => {
    return Array.from(new Set(transactions.filter(t => t.type === 'Расход').map(t => t.destination))).filter(Boolean).sort();
  }, [transactions]);

  // We only care about 'Расход' transactions for shipment costs
  const shipmentTransactions = useMemo(() => {
    return transactions
      .filter(t => t.type === 'Расход')
      .filter(t => {
        if (destinationFilter && t.destination !== destinationFilter) return false;
        
        if (!dateFrom && !dateTo) return true;
        
        let tDate = new Date(t.date);
        if (isNaN(tDate.getTime()) && t.date.includes('.')) {
          const parts = t.date.split(',')[0].trim().split('.');
          if (parts.length === 3) {
            tDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00`);
          }
        }
        
        if (isNaN(tDate.getTime())) return true;
        
        const timestamp = tDate.getTime();
        
        if (dateFrom) {
          const fromTimestamp = new Date(dateFrom).getTime();
          if (timestamp < fromTimestamp) return false;
        }
        
        if (dateTo) {
          const toDate = new Date(dateTo);
          toDate.setHours(23, 59, 59, 999);
          if (timestamp > toDate.getTime()) return false;
        }
        
        return true;
      })
      .sort((a, b) => {
        let aDate = new Date(a.date);
        if (isNaN(aDate.getTime()) && a.date.includes('.')) {
          const parts = a.date.split(',')[0].trim().split('.');
          aDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00`);
        }
        let bDate = new Date(b.date);
        if (isNaN(bDate.getTime()) && b.date.includes('.')) {
          const parts = b.date.split(',')[0].trim().split('.');
          bDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00`);
        }
        return bDate.getTime() - aDate.getTime();
      });
  }, [transactions, dateFrom, dateTo, destinationFilter]);

  // Group by date and destination to show shipments as batches
  const groupedShipments = useMemo(() => {
    const groups: Record<string, typeof shipmentTransactions> = {};
    
    shipmentTransactions.forEach(t => {
      // Group by date (DD-MM-YYYY) and destination
      let dateStr = '';
      if (t.date) {
        if (t.date.includes('.')) {
          dateStr = t.date.split(',')[0].trim().replace(/\./g, '-');
        } else {
          const d = new Date(t.date);
          if (!isNaN(d.getTime())) {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            dateStr = `${day}-${month}-${year}`;
          } else {
            dateStr = t.date.split('T')[0];
          }
        }
      }
      
      const key = `${dateStr}_${t.destination}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });

    return Object.entries(groups).map(([key, items]) => {
      const dateStr = key.split('_')[0];
      const destination = key.split('_')[1];
      const totalCost = items.reduce((sum, item) => sum + item.total, 0);
      const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
      
      const deliveryDateRaw = items.find(i => i.deliveryDate)?.deliveryDate;
      let deliveryDateStr = '';
      if (deliveryDateRaw) {
        if (deliveryDateRaw.includes('.')) {
          deliveryDateStr = deliveryDateRaw.split(',')[0].trim().replace(/\./g, '-');
        } else {
          const d = new Date(deliveryDateRaw);
          if (!isNaN(d.getTime())) {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            deliveryDateStr = `${day}-${month}-${year}`;
          } else {
            deliveryDateStr = deliveryDateRaw.split('T')[0];
          }
        }
      }
      
      return {
        id: key,
        date: items[0].date,
        dateStr,
        destination,
        totalCost,
        totalItems,
        deliveryDateStr,
        items
      };
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [shipmentTransactions]);

  const totalShipmentCost = useMemo(() => {
    return shipmentTransactions.reduce((sum, t) => sum + t.total, 0);
  }, [shipmentTransactions]);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [dateFrom, dateTo, destinationFilter]);

  const totalPages = Math.ceil(groupedShipments.length / pageSize) || 1;

  const displayedGroups = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return groupedShipments.slice(start, start + pageSize);
  }, [groupedShipments, currentPage, pageSize]);

  const handleSelectAllGroup = (groupItems: typeof shipmentTransactions, checked: boolean) => {
    const newSet = new Set(selectedIds);
    groupItems.forEach(t => {
      if (checked) newSet.add(t.id);
      else newSet.delete(t.id);
    });
    setSelectedIds(newSet);
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const currentSelectionCount = selectedIds.size;

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const success = await handleDeleteMultipleTransactions(Array.from(selectedIds));
    if (success) {
      setSelectedIds(new Set());
    }
    setBulkDeleteConfirm(false);
  };

  return (
    <motion.div 
      key="shipment-cost"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="max-w-6xl mx-auto space-y-8"
    >
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-2">
          <h2 className="text-3xl font-bold">Себестоимость отгрузки</h2>
          <p className="text-slate-500">Анализ себестоимости отгруженных товаров с учетом доп. расходов</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-4">
          {currentSelectionCount > 0 && (
            <button
              onClick={() => setBulkDeleteConfirm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors font-medium border border-red-100"
            >
              <Trash2 size={18} />
              Удалить выбранные ({currentSelectionCount})
            </button>
          )}
          <div className="flex flex-wrap items-center gap-2 bg-white p-2 rounded-2xl shadow-sm border border-slate-200 w-full md:w-auto">
          <div className="flex items-center gap-2 px-2 border-r border-slate-100 text-slate-400">
            <Filter size={16} />
            <span className="text-sm font-medium hidden sm:inline">Фильтр:</span>
          </div>
          
          <select
            value={destinationFilter}
            onChange={(e) => setDestinationFilter(e.target.value)}
            className="px-2 py-1 outline-none text-sm bg-transparent font-medium border-r border-slate-100 w-[160px] truncate text-slate-600 focus:text-slate-900"
          >
            <option value="">Все объекты</option>
            {uniqueDestinations.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          <input 
            type="date" 
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-2 py-1 outline-none text-sm bg-transparent font-medium"
            title="С даты"
          />
          <span className="text-slate-300">-</span>
          <input 
            type="date" 
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-2 py-1 outline-none text-sm bg-transparent font-medium"
            title="По дату"
          />
          {(dateFrom || dateTo || destinationFilter) && (
            <button 
              onClick={() => { setDateFrom(''); setDateTo(''); setDestinationFilter(''); }}
              className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold transition-colors ml-1 whitespace-nowrap"
            >
              Сбросить
            </button>
          )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
            <TrendingDown size={28} />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">Общая себестоимость</div>
            <div className="text-2xl font-bold text-slate-900">{totalShipmentCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600">
            <Package size={28} />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">Отгружено товаров</div>
            <div className="text-2xl font-bold text-slate-900">
              {shipmentTransactions.reduce((sum, t) => sum + t.quantity, 0).toLocaleString()} шт
            </div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center text-blue-600">
            <Truck size={28} />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-400 uppercase tracking-wider">Всего отгрузок</div>
            <div className="text-2xl font-bold text-slate-900">{groupedShipments.length}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-lg font-bold">История отгрузок</h3>
        </div>
        
        {groupedShipments.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Package size={48} className="mx-auto mb-4 opacity-20" />
            <p className="text-lg font-medium">Нет данных об отгрузках</p>
            <p className="text-sm">Оформите расход товара, чтобы увидеть расчет себестоимости.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {displayedGroups.map((group) => (
              <div key={group.id} className="p-6 hover:bg-slate-50/50 transition-colors">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                      <Calendar size={24} />
                    </div>
                    <div>
                      <div className="font-bold text-lg">{group.dateStr}</div>
                      {group.deliveryDateStr && (
                        <div className="text-xs font-bold text-emerald-600 mb-1">
                          Поставка: {group.deliveryDateStr}
                        </div>
                      )}
                      <div className="text-sm text-slate-500 flex items-center gap-2">
                        <Truck size={14} /> {group.destination}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-slate-900">{group.totalCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</div>
                    <div className="text-sm text-slate-500">{group.totalItems} шт.</div>
                  </div>
                </div>
                
                <div className="mt-4 bg-slate-50 rounded-2xl p-4 border border-slate-100">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-slate-400 uppercase text-[10px] tracking-widest">
                        <th className="pb-2 w-8 text-center">
                          <input 
                            type="checkbox"
                            checked={group.items.length > 0 && group.items.every(t => selectedIds.has(t.id))}
                            onChange={(e) => handleSelectAllGroup(group.items, e.target.checked)}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                          />
                        </th>
                        <th className="pb-2 font-bold">Артикул</th>
                        <th className="pb-2 font-bold text-right">Кол-во</th>
                        <th className="pb-2 font-bold text-right">Себест. ед.</th>
                        <th className="pb-2 font-bold text-right">Итого</th>
                        <th className="pb-2 font-bold text-right w-20">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100/50">
                      {group.items.map(item => (
                        <tr key={item.id} className={selectedIds.has(item.id) ? 'bg-indigo-50/50' : ''}>
                          <td className="py-2 text-center">
                            <input 
                              type="checkbox"
                              checked={selectedIds.has(item.id)}
                              onChange={() => toggleSelect(item.id)}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                            />
                          </td>
                          <td className="py-2 font-mono text-indigo-600 font-bold">{item.article}</td>
                          <td className="py-2 text-right font-medium">{item.quantity}</td>
                          <td className="py-2 text-right text-slate-600 whitespace-nowrap">{item.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                          <td className="py-2 text-right font-bold text-slate-900 whitespace-nowrap">{item.total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ₽</td>
                          <td className="py-2 text-right">
                            <div className="flex justify-end gap-1 border-l pl-2 border-slate-100">
                              <button 
                                onClick={() => {
                                  setEditingTrans(item);
                                  setShowEditTransModal(true);
                                }}
                                className="p-1.5 hover:bg-indigo-100 text-slate-400 hover:text-indigo-600 rounded-lg transition-all"
                                title="Редактировать"
                              >
                                <Edit3 size={14} />
                              </button>
                              <button 
                                onClick={() => setTransToDelete(item.id)}
                                className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-all"
                                title="Удалить"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {groupedShipments.length > 0 && (
          <div className="flex items-center justify-between p-4 border-t border-slate-200 bg-slate-50 rounded-b-3xl">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">Показывать по:</span>
              <select 
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
      </div>

      <ConfirmDialog 
        show={transToDelete !== null}
        title="Удаление отгрузки"
        message="Вы действительно хотите удалить эту позицию отгрузки? Действие нельзя отменить."
        onConfirm={() => {
          if (transToDelete) handleDeleteTransaction(transToDelete);
        }}
        onCancel={() => setTransToDelete(null)}
      />

      <ConfirmDialog 
        show={bulkDeleteConfirm}
        title="Удаление выбранных отгрузок"
        message={`Вы действительно хотите удалить ${currentSelectionCount} строк отгрузки из истории? Действие нельзя отменить. Товары будут соответственно удалены из истории.`}
        onConfirm={handleBulkDelete}
        onCancel={() => setBulkDeleteConfirm(false)}
      />
    </motion.div>
  );
};
