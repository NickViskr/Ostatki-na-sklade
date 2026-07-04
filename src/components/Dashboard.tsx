import React, { useMemo, useState, useRef, useEffect } from 'react';
import { 
  LayoutDashboard, 
  History, 
  Loader2, 
  ArrowUpRight,
  Search,
  Settings,
  ChevronDown,
  Check,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  HelpCircle,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { DashSettingsModal } from './DashSettingsModal';
import { formatCurrency } from '../lib/utils';

export const Dashboard: React.FC = React.memo(() => {
  const stock = useWarehouseStore((state) => state.stock);
  const skus = useWarehouseStore((state) => state.skus);
  const kits = useWarehouseStore((state) => state.kits);
  const transactions = useWarehouseStore((state) => state.transactions);
  const isSyncing = useWarehouseStore((state) => state.isSyncing);
  const lastSyncTime = useWarehouseStore((state) => state.lastSyncTime);
  const fetchStock = useWarehouseStore((state) => state.fetchStock);
  const storageRatePerLiterDay = useSettingsStore((state) => state.storageRatePerLiterDay) || 0;
  
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

  const dashSearch = useUIStore((state) => state.dashSearch);
  const setDashSearch = useUIStore((state) => state.setDashSearch);
  const dashTableSelectedSkus = useUIStore((state) => state.dashTableSelectedSkus);
  const setDashTableSelectedSkus = useUIStore((state) => state.setDashTableSelectedSkus);
  const dashStockFilter = useUIStore((state) => state.dashStockFilter);
  const setDashStockFilter = useUIStore((state) => state.setDashStockFilter);
  const lowStockThreshold = useUIStore((state) => state.lowStockThreshold);
  const setLowStockThreshold = useUIStore((state) => state.setLowStockThreshold);
  
  const dashSelectedSkus = useUIStore((state) => state.dashSelectedSkus);
  const dashTurnoverDays = useUIStore((state) => state.dashTurnoverDays);
  const setShowDashSettingsModal = useUIStore((state) => state.setShowDashSettingsModal);
  const setActiveTab = useUIStore((state) => state.setActiveTab);
  const setHistSelectedSkus = useUIStore((state) => state.setHistSelectedSkus);
  const currentUser = useWarehouseStore((state) => state.currentUser);

  useEffect(() => {
    if (currentUser?.username) {
      const saved = localStorage.getItem(`dashFilter_${currentUser.username}`);
      if (saved) {
        try {
          setDashTableSelectedSkus(JSON.parse(saved));
        } catch(e) {}
      }
    }
  }, [currentUser?.username, setDashTableSelectedSkus]);

  useEffect(() => {
    if (currentUser?.username) {
      localStorage.setItem(`dashFilter_${currentUser.username}`, JSON.stringify(dashTableSelectedSkus));
    }
  }, [dashTableSelectedSkus, currentUser?.username]);

  const augmentedStock = useMemo(() => {
    const virtualKits = kits.filter(k => k.type === 'virtual');
    
    const result = stock.map(item => {
      const isVirtual = virtualKits.some(k => k.kitSku === item.article);
      if (isVirtual) {
        const kit = virtualKits.find(k => k.kitSku === item.article)!;
        let minQty = Infinity;
        if (kit.components && kit.components.length > 0) {
          for (const comp of kit.components) {
            const compStock = stock.find(s => s.article === comp.componentSku);
            const available = compStock ? compStock.quantity : 0;
            const required = comp.quantity || 1;
            const ratio = Math.floor(available / required);
            if (ratio < minQty) {
              minQty = ratio;
            }
          }
        }
        const calcQty = minQty === Infinity ? 0 : minQty;
        return {
          ...item,
          quantity: calcQty,
          isVirtual: true
        };
      }
      return item;
    });

    virtualKits.forEach(kit => {
      const alreadyInStock = stock.some(s => s.article === kit.kitSku);
      if (!alreadyInStock) {
        let minQty = Infinity;
        if (kit.components && kit.components.length > 0) {
          for (const comp of kit.components) {
            const compStock = stock.find(s => s.article === comp.componentSku);
            const available = compStock ? compStock.quantity : 0;
            const required = comp.quantity || 1;
            const ratio = Math.floor(available / required);
            if (ratio < minQty) {
              minQty = ratio;
            }
          }
        }
        const calcQty = minQty === Infinity ? 0 : minQty;
        result.push({
          article: kit.kitSku,
          quantity: calcQty,
          avgCost: 0,
          capitalization: 0,
          sales120: 0,
          turnover: 0,
          isVirtual: true
        } as any);
      }
    });

    return result;
  }, [stock, kits]);

  const uniqueSkus = useMemo(() => {
    return Array.from(new Set([
      ...skus.map(s => s.sku),
      ...augmentedStock.map(s => s.article)
    ])).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [skus, augmentedStock]);

  const filteredStock = useMemo(() => {
    return augmentedStock.filter(item => {
      const matchesSearch = !dashSearch || item.article.toLowerCase().includes(dashSearch.toLowerCase());
      const matchesSku = dashTableSelectedSkus.length === 0 || dashTableSelectedSkus.includes(item.article);
      
      if (dashStockFilter === 'low_stock') {
        return matchesSearch && matchesSku && item.quantity <= (Number(lowStockThreshold) || 0);
      }
      if (dashStockFilter === 'in_stock') {
        return matchesSearch && matchesSku && item.quantity > 0;
      }
      return matchesSearch && matchesSku;
    });
  }, [augmentedStock, dashTableSelectedSkus, dashStockFilter, lowStockThreshold, dashSearch]);

  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>({ key: 'article', direction: 'asc' });

  const sortedStock = useMemo(() => {
    let sortableItems = [...filteredStock];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        let aValue: any = a[sortConfig.key as keyof typeof a];
        let bValue: any = b[sortConfig.key as keyof typeof b];

        if (sortConfig.key === 'storageCost') {
          const skuA = skus.find(s => s.sku === a.article);
          const litersA = skuA ? skuA.volumeLiters : 0;
          aValue = a.quantity * litersA * storageRatePerLiterDay;

          const skuB = skus.find(s => s.sku === b.article);
          const litersB = skuB ? skuB.volumeLiters : 0;
          bValue = b.quantity * litersB * storageRatePerLiterDay;
        }

        if (typeof aValue === 'string') {
          aValue = aValue.trim().toLowerCase();
          bValue = bValue.trim().toLowerCase();
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
  }, [filteredStock, sortConfig, skus, storageRatePerLiterDay]);

  const storageTotals = useMemo(() => {
    let totalPerDay = 0;
    filteredStock.forEach(item => {
      const skuData = skus.find(s => s.sku === item.article);
      const liters = skuData ? skuData.volumeLiters : 0;
      if (liters > 0 && storageRatePerLiterDay > 0) {
        totalPerDay += item.quantity * liters * storageRatePerLiterDay;
      }
    });
    return {
      perDay: totalPerDay,
      perMonth: totalPerDay * 30
    };
  }, [filteredStock, skus, storageRatePerLiterDay]);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    setCurrentPage(1);
  }, [dashSearch, dashStockFilter, dashTableSelectedSkus, lowStockThreshold]);

  const totalPages = Math.ceil(sortedStock.length / pageSize) || 1;

  const displayedStock = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedStock.slice(start, start + pageSize);
  }, [sortedStock, currentPage, pageSize]);

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

  const calculatedTurnover = useMemo(() => {
    const days = Number(dashTurnoverDays) || 1;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    cutoffDate.setHours(0, 0, 0, 0);
    
    let totalSales = 0;
    let totalStock = 0;

    // Pre-calculate sales per article to avoid O(N*M) complexity
    const salesByArticle = new Map<string, number>();
    for (const t of transactions) {
      if (t.type === 'Расход') {
        let tDate = new Date(t.date);
        if (isNaN(tDate.getTime()) && t.date.includes('.')) {
          const parts = t.date.split(',')[0].trim().split('.');
          tDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00`);
        }
        if (tDate >= cutoffDate) {
          salesByArticle.set(t.article, (salesByArticle.get(t.article) || 0) + t.quantity);
        }
      }
    }

    filteredStock.forEach(s => {
      totalStock += s.quantity;
      totalSales += (salesByArticle.get(s.article) || 0);
    });

    if (totalSales === 0) return 0;
    return Math.round((totalStock / totalSales) * days);
  }, [filteredStock, transactions, dashTurnoverDays]);

  const exportToCSV = () => {
    if (sortedStock.length === 0) return;
    
    const headers = ['Артикул', 'Кол-во', 'Себест. (сред.)', 'Капитализация', 'Оборачивать (дни)'];
    const csvContent = [
      headers.join(';'),
      ...sortedStock.map(t => 
        [
          t.article,
          t.quantity,
          t.avgCost.toFixed(2).replace('.', ','),
          t.capitalization.toFixed(2).replace('.', ','),
          t.turnover
        ].join(';')
      )
    ].join('\n');
    
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `ostatki_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const handleArticleClick = (article: string) => {
    setHistSelectedSkus([article]);
    setActiveTab('history');
  };

  return (
    <div 
      key="dashboard"
      className="space-y-6 tab-enter"
    >
      <DashSettingsModal />
      
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold">Остатки на складе</h2>
          <p className="text-slate-500">Актуальные данные из базы</p>
        </div>
         <div className="flex gap-4 items-center">
           {lastSyncTime && (
             <span className="text-sm font-medium text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
               Обновлено: {lastSyncTime}
             </span>
           )}
           <button 
             onClick={exportToCSV}
             className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 text-indigo-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-indigo-100 transition-all shadow-sm"
           >
             <Download size={16} />
             Скачать CSV
           </button>
           <button 
             onClick={fetchStock}
             disabled={isSyncing}
             className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-xl text-sm font-medium hover:bg-slate-50 transition-all shadow-sm"
           >
              {isSyncing ? <Loader2 className="animate-spin" size={16} /> : <History size={16} />}
              {isSyncing ? 'Синхронизация...' : 'Обновить из Таблицы'}
           </button>
        </div>
      </div>

      {/* Analytics Cards */}
      <div className="relative">
        <button 
          onClick={() => setShowDashSettingsModal(true)}
          className="absolute -top-10 right-0 p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors"
          title="Настройки дашборда"
        >
          <Settings size={20} />
        </button>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm min-w-0">
            <div className="text-xs font-bold text-slate-400 uppercase mb-1 truncate" title="Сумма товарного остатка">Сумма товарного остатка</div>
            <div className="text-2xl font-bold text-indigo-600 truncate">
              {Math.round(filteredStock.reduce((acc, s) => acc + s.capitalization, 0)).toLocaleString('ru-RU')} ₽
            </div>
            <div className="text-[10px] text-slate-400 mt-2 italic truncate">Общая капитализация выбранных</div>
          </div>
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm min-w-0">
            <div className="text-xs font-bold text-slate-400 uppercase mb-1 truncate" title="Общее количество товаров">Общее количество товаров</div>
            <div className="text-2xl font-bold text-slate-900 truncate">
              {filteredStock.reduce((acc, s) => acc + s.quantity, 0).toLocaleString('ru-RU')} ед.
            </div>
            <div className="text-[10px] text-slate-400 mt-2 italic truncate">Всего единиц в выборке</div>
          </div>
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm min-w-0">
            <div className="text-xs font-bold text-slate-400 uppercase mb-1 truncate" title="Оборачиваемость">Оборачиваемость</div>
            <div className="text-2xl font-bold text-indigo-600 truncate">
              {calculatedTurnover} дн.
            </div>
            <div className="text-[10px] text-slate-400 mt-2 italic truncate">За последние {dashTurnoverDays || 1} дн.</div>
          </div>
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm min-w-0">
            <div className="text-xs font-bold text-slate-400 uppercase mb-1 truncate" title="Стоимость хранения">Стоимость хранения</div>
            <div className="text-2xl font-bold text-indigo-600 truncate">
              {Math.round(storageTotals.perDay).toLocaleString('ru-RU')} ₽/сут
            </div>
            <div className="text-[10px] text-slate-500 mt-2 italic truncate">
              В месяц: <span className="font-bold text-slate-700">{Math.round(storageTotals.perMonth).toLocaleString('ru-RU')} ₽</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text"
            placeholder="Поиск по артикулу..."
            value={dashSearch}
            onChange={(e) => setDashSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
          />
        </div>
        
        <div className="relative" ref={dropdownRef}>
          <button 
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="w-full flex items-center justify-between px-4 py-2 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-left"
          >
            <span className="truncate text-slate-700 text-sm">
              {dashTableSelectedSkus.length === 0 
                ? 'Все артикулы' 
                : `Выбрано: ${dashTableSelectedSkus.length}`}
            </span>
            <ChevronDown size={18} className="text-slate-400 flex-shrink-0" />
          </button>

          {isDropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-20 max-h-60 overflow-y-auto py-2">
              {uniqueSkus.length === 0 ? (
                <div className="px-4 py-2 text-sm text-slate-500 italic text-center">Нет доступных артикулов</div>
              ) : (
                <>
                  <div 
                    onClick={() => {
                      if (dashTableSelectedSkus.length === uniqueSkus.length && uniqueSkus.length > 0) {
                        setDashTableSelectedSkus([]);
                      } else {
                        setDashTableSelectedSkus(uniqueSkus);
                      }
                    }}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 cursor-pointer transition-colors border-b border-slate-100 sticky top-0 bg-white z-10"
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${dashTableSelectedSkus.length === uniqueSkus.length && uniqueSkus.length > 0 ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'}`}>
                      {dashTableSelectedSkus.length === uniqueSkus.length && uniqueSkus.length > 0 && <Check size={12} strokeWidth={3} />}
                    </div>
                    <span className="text-sm font-bold text-slate-700 truncate">Выбрать все</span>
                  </div>
                  {uniqueSkus.map(sku => (
                    <div 
                      key={sku}
                      onClick={() => {
                        if (dashTableSelectedSkus.includes(sku)) {
                          setDashTableSelectedSkus(dashTableSelectedSkus.filter(s => s !== sku));
                        } else {
                          setDashTableSelectedSkus([...dashTableSelectedSkus, sku]);
                        }
                      }}
                      className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${dashTableSelectedSkus.includes(sku) ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'}`}>
                        {dashTableSelectedSkus.includes(sku) && <Check size={12} strokeWidth={3} />}
                      </div>
                      <span className="text-sm font-medium text-slate-700 truncate">{sku}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
        
        <select 
          value={dashStockFilter}
          onChange={(e) => setDashStockFilter(e.target.value as any)}
          className="px-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="all">Все товары</option>
          <option value="in_stock">Только в наличии</option>
          <option value="low_stock">Малый остаток</option>
        </select>

        {dashStockFilter === 'low_stock' && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-400 uppercase">Порог:</span>
            <input 
              type="number"
              value={lowStockThreshold}
              onChange={(e) => setLowStockThreshold(e.target.value === '' ? '' : parseInt(e.target.value))}
              className="w-20 px-3 py-2 rounded-xl border border-slate-200 outline-none"
            />
          </div>
        )}
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/50 border-b border-slate-200">
              <th className="px-6 py-4 font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('article')}>
                Артикул {getSortIcon('article')}
              </th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('quantity')}>
                Кол-во {getSortIcon('quantity')}
              </th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('avgCost')}>
                <div className="flex items-center justify-end gap-1">
                  Себест. (сред.) 
                  <span title="Средняя стоимость единицы товара на основе всех приходов"><HelpCircle size={14} className="text-slate-400 group-hover:text-indigo-500" /></span>
                  {getSortIcon('avgCost')}
                </div>
              </th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('capitalization')}>
                <div className="flex items-center justify-end gap-1">
                  Капитализация 
                  <span title="Общая стоимость остатков данного артикула на складе"><HelpCircle size={14} className="text-slate-400 group-hover:text-indigo-500" /></span>
                  {getSortIcon('capitalization')}
                </div>
              </th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('storageCost')}>
                <div className="flex items-center justify-end gap-1">
                  Хранение ₽/сут
                  <span title="Стоимость хранения остатка данного артикула в сутки (кол-во x литраж x ставка)"><HelpCircle size={14} className="text-slate-400 group-hover:text-indigo-500" /></span>
                  {getSortIcon('storageCost')}
                </div>
              </th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-center cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('turnover')}>
                <div className="flex items-center justify-center gap-1">
                  Оборач. (дни) 
                  <span title="Примерное время до полного истощения запаса на основе последних отгрузок"><HelpCircle size={14} className="text-slate-400 group-hover:text-indigo-500" /></span>
                  {getSortIcon('turnover')}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {isSyncing && sortedStock.length === 0 ? (
              // Skeleton loading placeholder
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-100 animate-pulse">
                  <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                  <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-16 ml-auto"></div></td>
                  <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-20 ml-auto"></div></td>
                  <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-24 ml-auto"></div></td>
                  <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-20 ml-auto"></div></td>
                  <td className="px-6 py-4"><div className="h-4 bg-slate-200 rounded w-16 mx-auto"></div></td>
                </tr>
              ))
            ) : sortedStock.length === 0 ? (
              // Empty state indicating no data
              <tr>
                <td colSpan={6} className="px-6 py-16 text-center">
                  <div className="flex flex-col items-center justify-center space-y-3">
                    <div className="bg-slate-100 p-4 rounded-full text-slate-400">
                      <LayoutDashboard size={32} />
                    </div>
                    <p className="text-slate-500 font-medium font-sans">Остатки не загружены или фильтры пустые</p>
                    <button 
                      onClick={fetchStock}
                      className="text-indigo-600 bg-indigo-50 hover:bg-indigo-100 font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
                    >
                      <History size={16} /> Нажмите «Обновить из Таблицы»
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              displayedStock.map((item, index) => (
              <tr 
                key={`${item.article}-${index}`} 
                onClick={() => handleArticleClick(item.article)}
                className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors cursor-pointer group"
                title="Нажмите, чтобы просмотреть историю товарных операций"
              >
                <td className="px-6 py-4 font-mono text-sm text-indigo-600 font-medium group-hover:underline">{item.article}</td>
                <td className="px-6 py-4 text-right">
                  <div className="inline-flex flex-col items-end">
                    <span className={`px-2 py-1 rounded-md font-bold ${(item as any).quantity < (Number(lowStockThreshold) || 0) ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-700'}`}>
                      {(item as any).quantity}
                    </span>
                    {(item as any).isVirtual && (
                      <span className="text-[9px] text-violet-500 font-bold uppercase tracking-wider mt-0.5 mr-0.5">
                        сборка
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-right font-medium whitespace-nowrap">{formatCurrency(item.avgCost)} ₽</td>
                <td className="px-6 py-4 text-right font-bold text-slate-900 whitespace-nowrap">{formatCurrency(item.capitalization)} ₽</td>
                <td className="px-6 py-4 text-right font-medium whitespace-nowrap text-slate-700">
                  {(() => {
                    const skuData = skus.find(s => s.sku === item.article);
                    const liters = skuData ? skuData.volumeLiters : 0;
                    const cost = liters > 0 && storageRatePerLiterDay > 0 ? item.quantity * liters * storageRatePerLiterDay : 0;
                    return `${formatCurrency(cost)} ₽`;
                  })()}
                </td>
                <td className="px-6 py-4 text-center">
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden max-w-[80px] mx-auto">
                    <div className="bg-indigo-500 h-full" style={{ width: `${Math.min(item.turnover, 100)}%` }}></div>
                  </div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase mt-1 block">{item.turnover} дн.</span>
                </td>
              </tr>
            )))}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50 rounded-b-3xl">
            <div className="text-sm text-slate-500 font-medium flex items-center gap-2">
              <span>Записи с {(currentPage - 1) * pageSize + 1} по {Math.min(currentPage * pageSize, sortedStock.length)} из {sortedStock.length}</span>
              <span className="text-slate-300">|</span>
              <label htmlFor="pageSizeDashboard" className="sr-only">Размер страницы</label>
              <select
                id="pageSizeDashboard"
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
    </div>
  );
});
