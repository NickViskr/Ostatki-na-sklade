import React, { useMemo, useState, useRef, useEffect } from 'react';
import { 
  Search, 
  Calendar, 
  Filter, 
  Trash2, 
  Edit3,
  MapPin,
  ChevronDown,
  Check,
  Download,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { motion } from 'motion/react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { formatCurrency } from '../lib/utils';
import { useSettingsStore } from '../store/useSettingsStore';
import { ConfirmDialog } from './ConfirmDialog';

export const HistoryTab: React.FC = () => {
  const transactions = useWarehouseStore((state) => state.transactions);
  const skus = useWarehouseStore((state) => state.skus);
  const handleDeleteTransaction = useWarehouseStore((state) => state.handleDeleteTransaction);
  const currentUser = useWarehouseStore((state) => state.currentUser);
  
  const isAdmin = currentUser?.role?.toLowerCase() === 'admin' || 
    ['admin', 'админ', 'администратор'].includes(currentUser?.username?.toLowerCase() || '');
  
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const histSelectedSkus = useUIStore((state) => state.histSelectedSkus);
  const setHistSelectedSkus = useUIStore((state) => state.setHistSelectedSkus);
  const histTypeFilter = useUIStore((state) => state.histTypeFilter);
  const setHistTypeFilter = useUIStore((state) => state.setHistTypeFilter);
  const histStartDate = useUIStore((state) => state.histStartDate);
  const setHistStartDate = useUIStore((state) => state.setHistStartDate);
  const histEndDate = useUIStore((state) => state.histEndDate);
  const setHistEndDate = useUIStore((state) => state.setHistEndDate);
  const histDestFilter = useUIStore((state) => state.histDestFilter);
  const setHistDestFilter = useUIStore((state) => state.setHistDestFilter);
  const setEditingTrans = useUIStore((state) => state.setEditingTrans);
  const setShowEditTransModal = useUIStore((state) => state.setShowEditTransModal);

  const [transToDelete, setTransToDelete] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const handleDeleteMultipleTransactions = useWarehouseStore((state) => state.handleDeleteMultipleTransactions);

  const destinations = useSettingsStore((state) => state.destinations);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    if (dateStr.includes('.')) return dateStr.split(',')[0].trim().replace(/\./g, '-');
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    }
    return dateStr.split('T')[0];
  };

  const filteredHistory = useMemo(() => {
    return transactions.filter(t => {
      const matchesSku = histSelectedSkus.length === 0 || histSelectedSkus.includes(t.article);
      const matchesType = histTypeFilter === 'all' || t.type === histTypeFilter;
      
      let matchesDate = true;
      if (histStartDate || histEndDate) {
        // Parse t.date safely since it could be "DD.MM.YYYY, HH:MM:SS" or ISO
        let tDate: Date;
        if (t.date.includes('.')) {
          const parts = t.date.split(',')[0].trim().split('.');
          if (parts.length === 3) {
            tDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00Z`);
          } else {
            tDate = new Date(t.date);
          }
        } else {
          tDate = new Date(t.date);
        }

        if (histStartDate) {
          const sDate = new Date(histStartDate);
          sDate.setHours(0, 0, 0, 0);
          if (tDate < sDate) matchesDate = false;
        }
        if (histEndDate) {
          const eDate = new Date(histEndDate);
          eDate.setHours(23, 59, 59, 999);
          if (tDate > eDate) matchesDate = false;
        }
      }
      
      const matchesDest = histDestFilter === 'all' || t.destination === histDestFilter;

      return matchesSku && matchesType && matchesDate && matchesDest;
    });
  }, [transactions, histSelectedSkus, histTypeFilter, histStartDate, histEndDate, histDestFilter]);

  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>({ key: 'date', direction: 'desc' });

  const sortedHistory = useMemo(() => {
    let sortableItems = [...filteredHistory];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        let aValue: any = a[sortConfig.key as keyof typeof a];
        let bValue: any = b[sortConfig.key as keyof typeof b];

        if (sortConfig.key === 'date') {
          // Parse date properly for sorting
           const parseDate = (dstr: string) => {
            if (dstr.includes('.')) {
              const parts = dstr.split(',')[0].trim().split('.');
              if (parts.length === 3) return new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00Z`).getTime();
            }
            return new Date(dstr).getTime();
          };
          aValue = parseDate(a.date);
          bValue = parseDate(b.date);
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
  }, [filteredHistory, sortConfig]);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);

  useEffect(() => {
    setCurrentPage(1);
  }, [histSelectedSkus, histTypeFilter, histStartDate, histEndDate, histDestFilter]);

  const totalPages = Math.ceil(sortedHistory.length / pageSize) || 1;

  const displayedHistory = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedHistory.slice(start, start + pageSize);
  }, [sortedHistory, currentPage, pageSize]);

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

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(new Set(displayedHistory.map(t => t.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const currentSelectionCount = selectedIds.size;
  const isAllSelected = displayedHistory.length > 0 && currentSelectionCount === displayedHistory.length;

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const success = await handleDeleteMultipleTransactions(Array.from(selectedIds));
    if (success) {
      setSelectedIds(new Set());
    }
    setBulkDeleteConfirm(false);
  };

  const handleExportCSV = () => {
    const headers = ['ДАТА', 'ТИП', 'АРТИКУЛ', 'КОЛ-ВО', 'ЦЕНА', 'СУММА', 'ОБЪЕКТ', 'ПОСТАВКА'];
    
    const rows = filteredHistory.map(t => [
      formatDate(t.date),
      t.type.toUpperCase(),
      t.article,
      t.quantity.toString(),
      formatCurrency(t.price).replace(/\s/g, ''),
      formatCurrency(t.type === 'Приход' ? t.total : t.writeOffCost).replace(/\s/g, ''),
      t.destination || '',
      t.deliveryDate ? formatDate(t.deliveryDate) : '-'
    ]);

    const csvContent = [headers, ...rows]
      .map(e => e.map(item => `"${String(item).replace(/"/g, '""')}"`).join(';'))
      .join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `history_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <motion.div 
      key="history"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4">
        <div>
          <h2 className="text-3xl font-bold">История операций</h2>
          <p className="text-slate-500">Все движения товаров по складу</p>
        </div>
        <div className="flex items-center gap-2">
          {currentSelectionCount > 0 && (
            <button
              onClick={() => setBulkDeleteConfirm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors font-medium border border-red-100 whitespace-nowrap"
            >
              <Trash2 size={18} />
              Удалить выбранные ({currentSelectionCount})
            </button>
          )}
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-white text-slate-700 rounded-xl hover:bg-slate-50 transition-colors font-medium border border-slate-200 shadow-sm whitespace-nowrap"
          >
            <Download size={18} />
            CSV экспорт
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="relative" ref={dropdownRef}>
          <button 
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="w-full flex items-center justify-between px-4 py-2 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-left"
          >
            <span className="truncate text-slate-700 text-sm">
              {histSelectedSkus.length === 0 
                ? 'Все артикулы' 
                : `Выбрано: ${histSelectedSkus.length}`}
            </span>
            <ChevronDown size={18} className="text-slate-400 flex-shrink-0" />
          </button>

          {isDropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-20 max-h-60 overflow-y-auto py-2">
              {skus.length === 0 ? (
                <div className="px-4 py-2 text-sm text-slate-500 italic text-center">Нет доступных артикулов</div>
              ) : (
                <>
                  <div 
                    onClick={() => {
                      if (histSelectedSkus.length === skus.length && skus.length > 0) {
                        setHistSelectedSkus([]);
                      } else {
                        setHistSelectedSkus(skus.map(s => s.sku));
                      }
                    }}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 cursor-pointer transition-colors border-b border-slate-100 sticky top-0 bg-white z-10"
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${histSelectedSkus.length === skus.length && skus.length > 0 ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'}`}>
                      {histSelectedSkus.length === skus.length && skus.length > 0 && <Check size={12} strokeWidth={3} />}
                    </div>
                    <span className="text-sm font-bold text-slate-700 truncate">Выбрать все</span>
                  </div>
                  {skus.map(sku => (
                    <div 
                      key={sku.sku}
                      onClick={() => {
                        if (histSelectedSkus.includes(sku.sku)) {
                          setHistSelectedSkus(histSelectedSkus.filter(s => s !== sku.sku));
                        } else {
                          setHistSelectedSkus([...histSelectedSkus, sku.sku]);
                        }
                      }}
                      className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${histSelectedSkus.includes(sku.sku) ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'}`}>
                        {histSelectedSkus.includes(sku.sku) && <Check size={12} strokeWidth={3} />}
                      </div>
                      <span className="text-sm font-medium text-slate-700 truncate">{sku.sku}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
        
        <div className="relative">
          <select 
            value={histTypeFilter}
            onChange={(e) => setHistTypeFilter(e.target.value as any)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500 appearance-none"
          >
            <option value="all">Все типы</option>
            <option value="Приход">Приход</option>
            <option value="Расход">Расход</option>
          </select>
          <Filter className="absolute left-3 top-2.5 text-slate-400" size={18} />
        </div>

        <div className="relative">
          <select 
            value={histDestFilter}
            onChange={(e) => setHistDestFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500 appearance-none"
          >
            <option value="all">Все объекты</option>
            {destinations.map((dest, idx) => (
              <option key={idx} value={dest}>{dest}</option>
            ))}
          </select>
          <MapPin className="absolute left-3 top-2.5 text-slate-400" size={18} />
        </div>

        <div className="relative">
          <input 
            type="date"
            value={histStartDate}
            onChange={(e) => setHistStartDate(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
            title="Начальная дата"
          />
          <Calendar className="absolute left-3 top-2.5 text-slate-400" size={18} />
        </div>

        <div className="relative">
          <input 
            type="date"
            value={histEndDate}
            onChange={(e) => setHistEndDate(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
            title="Конечная дата"
          />
          <Calendar className="absolute left-3 top-2.5 text-slate-400" size={18} />
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
              <th className="px-3 py-3 w-10 text-center">
                <input 
                  type="checkbox" 
                  checked={isAllSelected}
                  onChange={handleSelectAll}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                />
              </th>
              <th className="px-3 py-3 font-bold cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('date')}>
                Дата {getSortIcon('date')}
              </th>
              <th className="px-3 py-3 font-bold cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('type')}>
                Тип {getSortIcon('type')}
              </th>
              <th className="px-3 py-3 font-bold cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('article')}>
                Артикул {getSortIcon('article')}
              </th>
              <th className="px-3 py-3 font-bold text-right cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('quantity')}>
                Кол-во {getSortIcon('quantity')}
              </th>
              <th className="px-3 py-3 font-bold text-right cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('price')}>
                Цена {getSortIcon('price')}
              </th>
              <th className="px-3 py-3 font-bold text-right cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('total')}>
                Сумма {getSortIcon('total')}
              </th>
              <th className="px-3 py-3 font-bold cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('destination')}>
                Объект {getSortIcon('destination')}
              </th>
              <th className="px-3 py-3 font-bold cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('deliveryDate')}>
                Поставка {getSortIcon('deliveryDate')}
              </th>
              <th className="px-3 py-3 font-bold text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {displayedHistory.map((t, index) => (
              <tr key={`${t.id}-${index}`} className={`border-b border-slate-100 hover:bg-slate-50/50 transition-colors ${selectedIds.has(t.id) ? 'bg-indigo-50/30' : ''}`}>
                <td className="px-3 py-3 text-center">
                  <input 
                    type="checkbox" 
                    checked={selectedIds.has(t.id)}
                    onChange={() => toggleSelect(t.id)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                  />
                </td>
                <td className="px-3 py-3 text-xs font-medium text-slate-500 whitespace-nowrap">
                  {formatDate(t.date)}
                </td>
                <td className="px-3 py-3">
                  <span className={`flex items-center justify-center gap-1 w-fit px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    t.type === 'Приход' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                  }`}>
                    {t.type}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <div className="text-sm font-bold text-indigo-600 font-mono">{t.article}</div>
                </td>
                <td className="px-3 py-3 text-right font-bold whitespace-nowrap">{t.quantity}</td>
                <td className="px-3 py-3 text-right text-sm font-bold text-slate-900 whitespace-nowrap">
                  {formatCurrency(t.price)} ₽
                </td>
                <td className="px-3 py-3 text-right text-sm font-bold text-slate-900 whitespace-nowrap">
                  {formatCurrency(t.type === 'Приход' ? t.total : t.writeOffCost)} ₽
                </td>
                <td className="px-3 py-3 text-[11px] text-slate-500 max-w-[240px] whitespace-normal">
                  {(() => {
                    if (!t.destination) return <span className="text-slate-400">-</span>;
                    
                    const bracketMatch = t.destination.match(/(.*?)\[(.*?)\]$/);
                    const stringMatch = t.destination.match(/(.*?)(?:\.\s*)?(Услуги:\s*.*|Доп\. услуги:\s*.*)$/);

                    let main = '';
                    let tags: string[] = [];

                    if (bracketMatch) {
                      main = bracketMatch[1].trim();
                      tags = bracketMatch[2].split('|').map(s => s.trim());
                    } else if (stringMatch) {
                      main = stringMatch[1].trim();
                      if (stringMatch[2]) tags = [stringMatch[2].trim()];
                    } else {
                      main = t.destination.trim();
                    }

                    if (tags.length === 0) {
                      return <span className="font-medium text-slate-700">{main}</span>;
                    }

                    return (
                      <div className="flex flex-col gap-1.5 w-full">
                        {main && <span className="font-medium text-slate-700">{main}</span>}
                        <div className="flex flex-col gap-1">
                          {tags.map((tag, idx) => {
                            const isServices = tag.toLowerCase().startsWith('услуги') || tag.toLowerCase().startsWith('доп');
                            const isPack = tag.toLowerCase().startsWith('упаковка');
                            const isOther = tag.toLowerCase().startsWith('прочее');
                            
                            let bgClass = "bg-slate-50 text-slate-500 border border-slate-100";
                            if (isServices) bgClass = "bg-indigo-50 text-indigo-600 border border-indigo-100";
                            if (isPack) bgClass = "bg-emerald-50 text-emerald-600 border border-emerald-100";
                            if (isOther) bgClass = "bg-rose-50 text-rose-600 border border-rose-100";

                            return (
                              <span key={idx} className={`text-[10px] px-2 py-1 rounded w-fit leading-normal ${bgClass}`}>
                                {tag.replace(/^(Доп\. услуги:|Услуги:)\s*/, 'Услуги: ')}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </td>
                <td className="px-3 py-3 text-xs font-medium text-slate-500 whitespace-nowrap">
                  {t.deliveryDate ? formatDate(t.deliveryDate) : '-'}
                </td>
                <td className="px-3 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button 
                      onClick={() => {
                        setEditingTrans(t);
                        setShowEditTransModal(true);
                      }}
                      className="p-1.5 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded-lg transition-all"
                    >
                      <Edit3 size={16} />
                    </button>
                    <button 
                      onClick={() => setTransToDelete(t.id)}
                      className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-all"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {filteredHistory.length === 0 && (
          <div className="p-20 text-center">
            <Calendar className="mx-auto text-slate-200 mb-4" size={48} />
            <p className="text-slate-400 font-medium">История пуста</p>
          </div>
        )}
        
        {filteredHistory.length > 0 && (
          <div className="flex items-center justify-between p-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
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
        title="Удаление операции"
        message="Вы действительно хотите удалить эту операцию из истории? Действие нельзя отменить, и остатки товара могут измениться."
        onConfirm={() => {
          if (transToDelete) handleDeleteTransaction(transToDelete);
        }}
        onCancel={() => setTransToDelete(null)}
      />

      <ConfirmDialog 
        show={bulkDeleteConfirm}
        title="Оптовое удаление операций"
        message={`Вы действительно хотите удалить ${currentSelectionCount} строк из истории? Действие нельзя отменить. Остатки товаров затронуты не будут или будут обновлены (зависит от логики сервера).`}
        onConfirm={handleBulkDelete}
        onCancel={() => setBulkDeleteConfirm(false)}
      />
    </motion.div>
  );
};
