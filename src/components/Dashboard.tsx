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
  ArrowDown
} from 'lucide-react';
import { motion } from 'motion/react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { DashSettingsModal } from './DashSettingsModal';
import { formatCurrency } from '../lib/utils';

export const Dashboard: React.FC = () => {
  const stock = useWarehouseStore((state) => state.stock);
  const skus = useWarehouseStore((state) => state.skus);
  const transactions = useWarehouseStore((state) => state.transactions);
  const isSyncing = useWarehouseStore((state) => state.isSyncing);
  const fetchStock = useWarehouseStore((state) => state.fetchStock);
  
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

  const uniqueSkus = useMemo(() => {
    return Array.from(new Set([
      ...skus.map(s => s.sku),
      ...stock.map(s => s.article)
    ])).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [skus, stock]);

  const filteredStock = useMemo(() => {
    return stock.filter(item => {
      const matchesSku = dashTableSelectedSkus.length === 0 || dashTableSelectedSkus.includes(item.article);
      
      if (dashStockFilter === 'low_stock') {
        return matchesSku && item.quantity <= (Number(lowStockThreshold) || 0);
      }
      if (dashStockFilter === 'in_stock') {
        return matchesSku && item.quantity > 0;
      }
      return matchesSku;
    });
  }, [stock, dashTableSelectedSkus, dashStockFilter, lowStockThreshold]);

  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>({ key: 'article', direction: 'asc' });

  const sortedStock = useMemo(() => {
    let sortableItems = [...filteredStock];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        let aValue: any = a[sortConfig.key as keyof typeof a];
        let bValue: any = b[sortConfig.key as keyof typeof b];

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
  }, [filteredStock, sortConfig]);

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

  return (
    <motion.div 
      key="dashboard"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      <DashSettingsModal />
      
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold">Остатки на складе</h2>
          <p className="text-slate-500">Актуальные данные из базы</p>
        </div>
        <div className="flex gap-4">
           <button 
             onClick={fetchStock}
             disabled={isSyncing}
             className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-xl text-sm font-medium hover:bg-slate-50 transition-all shadow-sm"
           >
              {isSyncing ? <Loader2 className="animate-spin" size={16} /> : <History size={16} />}
              {isSyncing ? 'Синхронизация...' : 'Обновить из Таблицы'}
           </button>
           <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-4 py-2 rounded-full text-sm font-medium">
              <ArrowUpRight size={16} /> +12% к прошлому месяцу
           </div>
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
        </div>
      </div>

      {/* Filters Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
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
                Себест. (сред.) {getSortIcon('avgCost')}
              </th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-right cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('capitalization')}>
                Капитализация {getSortIcon('capitalization')}
              </th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-center cursor-pointer hover:bg-slate-100 group" onClick={() => requestSort('turnover')}>
                Оборач. (дни) {getSortIcon('turnover')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedStock.slice(0, 100).map((item, index) => (
              <tr key={`${item.article}-${index}`} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4 font-mono text-sm text-indigo-600 font-medium">{item.article}</td>
                <td className="px-6 py-4 text-right">
                  <span className={`px-2 py-1 rounded-md font-bold ${item.quantity < (Number(lowStockThreshold) || 0) ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-700'}`}>
                    {item.quantity}
                  </span>
                </td>
                <td className="px-6 py-4 text-right font-medium whitespace-nowrap">{formatCurrency(item.avgCost)} ₽</td>
                <td className="px-6 py-4 text-right font-bold text-slate-900 whitespace-nowrap">{formatCurrency(item.capitalization)} ₽</td>
                <td className="px-6 py-4 text-center">
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden max-w-[80px] mx-auto">
                    <div className="bg-indigo-500 h-full" style={{ width: `${Math.min(item.turnover, 100)}%` }}></div>
                  </div>
                  <span className="text-[10px] text-slate-400 font-bold uppercase mt-1 block">{item.turnover} дн.</span>
                </td>
              </tr>
            ))}
            {filteredStock.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">
                  Товары не найдены по заданным фильтрам
                </td>
              </tr>
            )}
            {filteredStock.length > 100 && (
              <tr>
                <td colSpan={5} className="px-6 py-4 text-center text-xs font-bold text-slate-400 uppercase tracking-wider bg-slate-50/50">
                  Показаны первые 100 из {filteredStock.length} записей
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
};
