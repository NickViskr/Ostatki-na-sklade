import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
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
  ChevronRight,
  Loader2,
  Layers
} from 'lucide-react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { formatCurrency, parseAppDate } from '../lib/utils';
import { useSettingsStore } from '../store/useSettingsStore';
import { ConfirmDialog } from './ConfirmDialog';

const DestinationCell: React.FC<{ destination: string }> = ({ destination }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!destination) return <span className="text-slate-400">-</span>;
  
  const bracketMatch = destination.match(/(.*?)\[(.*?)\]$/);
  const stringMatch = destination.match(/(.*?)(?:\.\s*)?(Услуги:\s*.*|Доп\. услуги:\s*.*)$/);

  let main = '';
  let tags: string[] = [];

  if (bracketMatch) {
    main = bracketMatch[1].trim();
    tags = bracketMatch[2].split('|').map(s => s.trim());
  } else if (stringMatch) {
    main = stringMatch[1].trim();
    if (stringMatch[2]) tags = [stringMatch[2].trim()];
  } else {
    main = destination.trim();
  }

  if (tags.length === 0) {
    return <span className="font-medium text-slate-700">{main}</span>;
  }

  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="flex items-center gap-1 justify-between">
        {main && <span className="font-medium text-slate-700">{main}</span>}
        <button 
          onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
          className="text-indigo-500 hover:bg-indigo-50 p-0.5 rounded transition-colors flex-shrink-0"
          title={isOpen ? "Скрыть доп. услуги" : "Показать доп. услуги"}
        >
          <ChevronDown size={14} className={`transform transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
      
      {isOpen && (
        <div className="flex flex-col gap-1 pt-1 mt-1 border-t border-slate-100">
          {tags.map((tag, idx) => {
            const isServices = tag.toLowerCase().startsWith('услуги') || tag.toLowerCase().startsWith('доп');
            const isPack = tag.toLowerCase().startsWith('упаковка');
            const isOther = tag.toLowerCase().startsWith('прочее');
            
            let bgClass = "bg-slate-50 text-slate-500 border border-slate-100";
            if (isServices) bgClass = "bg-indigo-50 text-indigo-600 border border-indigo-100";
            if (isPack) bgClass = "bg-emerald-50 text-emerald-600 border border-emerald-100";
            if (isOther) bgClass = "bg-rose-50 text-rose-600 border border-rose-100";

            return (
              <span key={idx} className={`text-[10px] px-2 py-1 rounded w-fit leading-normal shadow-sm ${bgClass}`}>
                {tag.replace(/^(Доп\. услуги:|Услуги:)\s*/, 'Услуги: ')}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const HistoryTab: React.FC = React.memo(() => {
  const transactions = useWarehouseStore((state) => state.transactions);
  const hasMoreTransactions = useWarehouseStore((state) => state.hasMoreTransactions);
  const fetchMoreTransactions = useWarehouseStore((state) => state.fetchMoreTransactions);
  const isSyncing = useWarehouseStore((state) => state.isSyncing);
  const skus = useWarehouseStore((state) => state.skus);
  const handleDeleteTransaction = useWarehouseStore((state) => state.handleDeleteTransaction);
  const handleDeleteMultipleTransactions = useWarehouseStore((state) => state.handleDeleteMultipleTransactions);
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

  const [expandedKitGroups, setExpandedKitGroups] = useState<Set<string>>(new Set());
  const toggleKit = (groupId: string) => {
    setExpandedKitGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  };
  const [transToDelete, setTransToDelete] = useState<string | null>(null);
  const [transToDeleteIds, setTransToDeleteIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  const destinations = useSettingsStore((state) => state.destinations);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    // Check ISO format first (contains 'T') — must come before the '.' check
    // because ISO milliseconds like ".177" would wrongly trigger the DD.MM.YYYY branch
    if (dateStr.includes('T')) {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}.${month}.${year}`;
      }
      return dateStr.split('T')[0];
    }
    // DD.MM.YYYY format (possibly with time: "05.06.2026, 19:10:07")
    if (dateStr.includes('.')) {
      return dateStr.split(',')[0].trim();
    }
    // Fallback: try parsing as-is
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}.${month}.${year}`;
    }
    return dateStr;
  };

  const filteredHistory = useMemo(() => {
    return transactions.filter(t => {
      const matchesSku = histSelectedSkus.length === 0 || histSelectedSkus.includes(t.article);
      const matchesType = histTypeFilter === 'all' || t.type === histTypeFilter;
      
      const matchesDate = true;
      let dateMatched = true;
      if (histStartDate || histEndDate) {
        // Единый разбор даты: поддержка DD-MM-YYYY, DD.MM.YYYY и ISO
        const tDate = parseAppDate(t.date);
        if (!tDate) {
          dateMatched = false;
        } else {
          if (histStartDate) {
            const sDate = new Date(histStartDate);
            sDate.setHours(0, 0, 0, 0);
            if (tDate < sDate) dateMatched = false;
          }
          if (histEndDate) {
            const eDate = new Date(histEndDate);
            eDate.setHours(23, 59, 59, 999);
            if (tDate > eDate) dateMatched = false;
          }
        }
      }
      
      const matchesDest = histDestFilter === 'all' || t.destination === histDestFilter;

      return matchesSku && matchesType && dateMatched && matchesDest && !t.isComponent;
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
            const d = parseAppDate(dstr);
            return d ? d.getTime() : 0;
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

  const handleSelectAll = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(new Set(displayedHistory.map(t => t.id)));
    } else {
      setSelectedIds(new Set());
    }
  }, [displayedHistory]);

  const toggleSelect = useCallback((id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  }, [selectedIds]);

  const currentSelectionCount = selectedIds.size;
  const isAllSelected = displayedHistory.length > 0 && currentSelectionCount === displayedHistory.length;

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const success = await handleDeleteMultipleTransactions(Array.from(selectedIds));
    if (success) setSelectedIds(new Set());
    setBulkDeleteConfirm(false);
  }, [selectedIds, handleDeleteMultipleTransactions]);

  const handleExportCSV = useCallback(() => {
    const csvRows = ['id,date,type,article,quantity,price,total,destination,user'];
    for (const t of filteredHistory) {
      csvRows.push([t.id, t.date, t.type, t.article, t.quantity, t.price, t.total, t.destination, t.user || ''].join(','));
    }
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'history.csv';
    link.click();
    URL.revokeObjectURL(url);
  }, [filteredHistory]);

  return (
    <div 
      key="history"
      className="space-y-6 tab-enter"
    >
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4">
        <div>
          <h2 className="text-3xl font-bold">История операций</h2>
          <p className="text-slate-500">Все движения товаров по складу</p>
          <div className="flex gap-2 mt-4 text-sm">
            <button
              onClick={() => {
                const today = new Date().toISOString().split('T')[0];
                setHistStartDate(today);
                setHistEndDate(today);
              }}
              className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition-colors"
            >Сегодня</button>
            <button
              onClick={() => {
                const today = new Date();
                const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                setHistStartDate(weekAgo);
                setHistEndDate(today.toISOString().split('T')[0]);
              }}
              className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition-colors"
            >7 дней</button>
            <button
              onClick={() => {
                const today = new Date();
                const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                setHistStartDate(monthAgo);
                setHistEndDate(today.toISOString().split('T')[0]);
              }}
              className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition-colors"
            >30 дней</button>
            <button
              onClick={() => {
                setHistStartDate('');
                setHistEndDate('');
              }}
              className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition-colors"
            >За всё время</button>
          </div>
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
              {isAdmin && (
                <th className="px-3 py-3 font-bold cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('user')}>
                  Кто {getSortIcon('user')}
                </th>
              )}
              <th className="px-3 py-3 font-bold text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {displayedHistory.map((t, index) => {
              const currentDateStr = formatDate(t.date);
              const prevDateStr = index > 0 ? formatDate(displayedHistory[index - 1].date) : null;
              const showDateHeader = sortConfig?.key === 'date' && currentDateStr !== prevDateStr;

              // Helper for date headers
              const getDateHeaderText = (dateStr: string) => {
                const parts = dateStr.split('-');
                if (parts.length === 3) {
                  const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const dt = new Date(d);
                  dt.setHours(0,0,0,0);
                  const diffTime = Math.abs(today.getTime() - dt.getTime());
                  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)); 
                  
                  if (diffDays === 0) return 'Сегодня';
                  if (diffDays === 1) return 'Вчера';
                  
                  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
                  return `${d.getDate()} ${months[d.getMonth()]}`;
                }
                return dateStr;
              };

              const kitComponents = t.groupId
                ? transactions.filter(x => x.groupId === t.groupId && x.isComponent)
                : [];
              const isKitRow = kitComponents.length > 0;
              const isKitExpanded = t.groupId ? expandedKitGroups.has(t.groupId) : false;

              // Суммарная стоимость для свёрнутого вида:
              const kitOwnTotal = (t.total ?? 0) - kitComponents.reduce((sum, c) => sum + (c.total ?? 0), 0);
              const kitWriteOffTotal = (t.total ?? t.writeOffCost ?? 0);
              const kitPriceTotal = isKitRow && t.quantity > 0
                ? (t.total ?? t.writeOffCost ?? 0) / t.quantity
                : t.price;

              return (
                <React.Fragment key={`${t.id}-${index}`}>
                  {showDateHeader && (
                    <tr className="bg-slate-50/80 border-b border-slate-200">
                      <td colSpan={11} className="px-4 py-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                        {getDateHeaderText(currentDateStr)}
                      </td>
                    </tr>
                  )}
                  <tr className={`border-b transition-colors ${selectedIds.has(t.id) ? 'bg-indigo-50/30' : ''} border-slate-100 hover:bg-slate-50/50`}>
                    <td className="px-3 py-3 text-center">
                      {!t.isComponent && (
                        <input 
                          type="checkbox" 
                          checked={selectedIds.has(t.id)}
                          onChange={() => toggleSelect(t.id)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                        />
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs font-medium text-slate-500 whitespace-nowrap">
                      {currentDateStr}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`flex items-center justify-center gap-1 w-fit px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        t.type === 'Приход' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                      }`}>
                        {t.type}
                      </span>
                    </td>
                    <td className={`px-3 py-3 ${t.isComponent ? 'pl-10' : ''}`}>
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-bold text-indigo-600 font-mono">{t.article}</div>
                        {(() => {
                          if (!t.groupId) return null;
                          const components = transactions.filter(
                            x => x.groupId === t.groupId && x.isComponent
                          );
                          if (components.length === 0) return null;
                          const isExpanded = expandedKitGroups.has(t.groupId);
                          return (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleKit(t.groupId!); }}
                              className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 bg-violet-100 text-violet-600 rounded ml-1.5 align-middle hover:bg-violet-200 transition-colors"
                              title={isExpanded ? 'Свернуть компоненты' : 'Показать компоненты комплекта'}
                            >
                              {isExpanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                              {components.length} компл.
                            </button>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-bold whitespace-nowrap">{t.quantity}</td>
                    <td className="px-3 py-3 text-right text-sm font-bold text-slate-900 whitespace-nowrap">
                      {formatCurrency(isKitRow && !isKitExpanded ? kitPriceTotal : t.price)} ₽
                    </td>
                    <td className="px-3 py-3 text-right text-sm font-bold text-slate-900 whitespace-nowrap">
                      {formatCurrency(
                        t.type === 'Приход'
                          ? t.total
                          : (isKitRow && isKitExpanded ? kitOwnTotal : kitWriteOffTotal)
                      )} ₽
                    </td>
                    <td className="px-3 py-3 text-[11px] text-slate-500 max-w-[240px] whitespace-normal">
                      <DestinationCell destination={t.destination} />
                    </td>
                    <td className="px-3 py-3 text-xs font-medium text-slate-500 whitespace-nowrap">
                      {t.deliveryDate ? formatDate(t.deliveryDate) : '-'}
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-3 text-xs font-medium text-slate-500 whitespace-nowrap">
                        {t.user || '-'}
                      </td>
                    )}
                    <td className="px-3 py-3 text-right">
                      {!t.isComponent ? (
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
                            onClick={() => {
                              const componentIds = t.groupId
                                ? transactions.filter(x => x.groupId === t.groupId && x.isComponent).map(x => x.id)
                                : [];
                              setTransToDeleteIds([t.id, ...componentIds]);
                              setTransToDelete(t.id);
                            }}
                            className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-all"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1 px-2">
                          <span className="text-xs text-slate-300 italic">авто</span>
                        </div>
                      )}
                    </td>
                  </tr>
                  {t.groupId && expandedKitGroups.has(t.groupId) && (() => {
                    const components = transactions.filter(
                      x => x.groupId === t.groupId && x.isComponent
                    );
                    return components.map(c => (
                      <tr key={c.id} className="border-b border-l-4 border-l-violet-300 bg-violet-50/40 border-slate-100/50">
                        <td className="px-3 py-2 text-center"></td>
                        <td className="px-3 py-2 text-xs font-medium text-slate-400 whitespace-nowrap">
                          {formatDate(c.date)}
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex items-center justify-center gap-1 w-fit px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-50 text-red-600">
                            {c.type}
                          </span>
                        </td>
                        <td className="px-3 py-2 pl-10">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-bold text-indigo-600 font-mono">{c.article}</div>
                            <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 text-[10px] font-bold uppercase tracking-wider">
                              компл.
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-bold whitespace-nowrap text-sm">{c.quantity}</td>
                        <td className="px-3 py-2 text-right text-sm font-bold text-slate-900 whitespace-nowrap">
                          {formatCurrency(c.price)} ₽
                        </td>
                        <td className="px-3 py-2 text-right text-sm font-bold text-slate-900 whitespace-nowrap">
                          {formatCurrency(c.total ?? 0)} ₽
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-400" />
                        <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">-</td>
                        {isAdmin && <td className="px-3 py-2 text-xs text-slate-400">-</td>}
                        <td className="px-3 py-2 text-right">
                          <span className="text-xs text-slate-300 italic px-2">авто</span>
                        </td>
                      </tr>
                    ));
                  })()}
                </React.Fragment>
              );
            })}
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

      {hasMoreTransactions && (
        <div className="flex justify-center mt-6">
          <button
            onClick={() => fetchMoreTransactions()}
            disabled={isSyncing}
            className="flex items-center gap-2 bg-white text-indigo-600 border border-slate-200 px-6 py-3 rounded-2xl font-bold hover:bg-slate-50 transition-all shadow-sm shadow-slate-200 disabled:opacity-50"
          >
            {isSyncing ? <Loader2 size={20} className="animate-spin" /> : <ChevronDown size={20} />}
            Загрузить ещё
          </button>
        </div>
      )}

      <ConfirmDialog 
        show={transToDelete !== null}
        title="Удаление операции"
        message="Вы действительно хотите удалить эту операцию из истории? Действие нельзя отменить, и остатки товара могут измениться."
        onConfirm={async () => {
          if (transToDeleteIds.length > 1) {
            await handleDeleteMultipleTransactions(transToDeleteIds);
          } else if (transToDelete) {
            await handleDeleteTransaction(transToDelete);
          }
          setTransToDelete(null);
          setTransToDeleteIds([]);
        }}
        onCancel={() => { setTransToDelete(null); setTransToDeleteIds([]); }}
      />

      <ConfirmDialog 
        show={bulkDeleteConfirm}
        title="Оптовое удаление операций"
        message={`Вы действительно хотите удалить ${currentSelectionCount} строк из истории? Действие нельзя отменить. Остатки товаров затронуты не будут или будут обновлены (зависит от логики сервера).`}
        onConfirm={handleBulkDelete}
        onCancel={() => setBulkDeleteConfirm(false)}
      />
    </div>
  );
});
