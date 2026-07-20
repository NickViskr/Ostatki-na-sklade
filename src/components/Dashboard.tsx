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
  ChevronRight,
  RefreshCw,
  X
} from 'lucide-react';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { useUIStore } from '../store/useUIStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { DashSettingsModal } from './DashSettingsModal';
import { formatCurrency } from '../lib/utils';
import { STATUS_FUNNEL_ORDER, getStatusDetails } from '../lib/ozonStatus';
import { OzonStockRow } from '../types';
import { buildOzonAlerts, OzonAlert } from '../lib/ozonAlerts';

export const Dashboard: React.FC = React.memo(() => {
  const stock = useWarehouseStore((state) => state.stock);
  const skus = useWarehouseStore((state) => state.skus);
  const kits = useWarehouseStore((state) => state.kits);
  const transactions = useWarehouseStore((state) => state.transactions);
  const isSyncing = useWarehouseStore((state) => state.isSyncing);
  const lastSyncTime = useWarehouseStore((state) => state.lastSyncTime);
  const fetchStock = useWarehouseStore((state) => state.fetchStock);
  const storageRatePerLiterDay = useSettingsStore((state) => state.storageRatePerLiterDay) || 0;
  
  const externalShipments = useWarehouseStore((state) => state.externalShipments);
  const fetchExternalShipments = useWarehouseStore((state) => state.fetchExternalShipments);
  
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isFunnelCollapsed, setIsFunnelCollapsed] = useState(false);
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

  const isAdmin = currentUser?.role?.toLowerCase() === 'admin' || ['admin', 'админ', 'администратор'].includes(currentUser?.username?.toLowerCase() || '');

  const ozonStocks = useWarehouseStore((state) => state.ozonStocks);
  const fetchOzonStocks = useWarehouseStore((state) => state.fetchOzonStocks);
  const runOzonStocksSync = useWarehouseStore((state) => state.runOzonStocksSync);
  const isProcessing = useWarehouseStore((state) => state.isProcessing);

  const [isOzonStocksCollapsed, setIsOzonStocksCollapsed] = useState(false);
  const [expandedOfferKeys, setExpandedOfferKeys] = useState<Record<string, boolean>>({});

  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('ozon_dismissedAlerts');
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  });

  const [isAlertsCollapsed, setIsAlertsCollapsed] = useState(false);

  const dismissAlert = (key: string) => {
    setDismissedAlerts((prev) => {
      const next = prev.includes(key) ? prev : [...prev, key];
      const trimmed = next.slice(-1000);
      try {
        localStorage.setItem('ozon_dismissedAlerts', JSON.stringify(trimmed));
      } catch (e) {}
      return trimmed;
    });
  };

  const alerts = useMemo(() => {
    if (!isAdmin) return [];
    const all = buildOzonAlerts(externalShipments || [], skus || []);
    const hidden = new Set(dismissedAlerts);
    return all.filter(a => !hidden.has(a.key));
  }, [isAdmin, externalShipments, skus, dismissedAlerts]);

  useEffect(() => {
    if (isAdmin) {
      fetchExternalShipments();
    }
  }, [isAdmin, fetchExternalShipments]);

  useEffect(() => {
    if (isAdmin) {
      fetchOzonStocks();
    }
  }, [isAdmin, fetchOzonStocks]);

  const toggleOfferKey = (key: string) => {
    setExpandedOfferKeys(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const maxUpdatedAt = useMemo(() => {
    if (!ozonStocks || ozonStocks.length === 0) return '';
    let max = '';
    for (const s of ozonStocks) {
      if (s.updatedAt && s.updatedAt > max) {
        max = s.updatedAt;
      }
    }
    return max;
  }, [ozonStocks]);

  const ozonTotals = useMemo(() => {
    let available = 0;
    let requested = 0;
    let transit = 0;
    let returns = 0;
    if (ozonStocks) {
      for (const s of ozonStocks) {
        available += s.available || 0;
        requested += s.requested || 0;
        transit += s.transit || 0;
        returns += s.returns || 0;
      }
    }
    return { available, requested, transit, returns };
  }, [ozonStocks]);

  const uniqueCabinetsCount = useMemo(() => {
    if (!ozonStocks) return 0;
    const cabs = new Set(ozonStocks.map(s => s.cabinet));
    return cabs.size;
  }, [ozonStocks]);

  const groupedStocks = useMemo(() => {
    if (!ozonStocks) return [];
    const map: Record<string, any> = {};
    for (const s of ozonStocks) {
      const key = `${s.cabinet}:::${s.offerId}`;
      if (!map[key]) {
        map[key] = {
          key,
          cabinet: s.cabinet,
          offerId: s.offerId,
          name: s.name || '',
          available: 0,
          preparing: 0,
          requested: 0,
          transit: 0,
          excess: 0,
          returns: 0,
          other: 0,
          items: []
        };
      }
      map[key].available += s.available || 0;
      map[key].preparing += s.preparing || 0;
      map[key].requested += s.requested || 0;
      map[key].transit += s.transit || 0;
      map[key].excess += s.excess || 0;
      map[key].returns += s.returns || 0;
      map[key].other += s.other || 0;
      map[key].items.push(s);
    }

    return Object.values(map).sort((a: any, b: any) => b.available - a.available);
  }, [ozonStocks]);

  const funnelData = useMemo(() => {
    if (!isAdmin || !externalShipments || externalShipments.length === 0) {
      return null;
    }

    // Только актуальные поставки (внутренний статус new) — как на вкладке Ozon по умолчанию
    const actualShipments = externalShipments.filter((s) => s.status === 'new');
    if (actualShipments.length === 0) {
      return null;
    }

    const counts: Record<string, number> = {};
    actualShipments.forEach((s) => {
      const statusKey = (s.ozonStatus || 'DATA_FILLING').toUpperCase();
      counts[statusKey] = (counts[statusKey] || 0) + 1;
    });

    const orderedCards: Array<{ status: string; label: string; badgeClass: string; count: number }> = [];

    // First, add existing statuses from STATUS_FUNNEL_ORDER
    STATUS_FUNNEL_ORDER.forEach((status) => {
      const count = counts[status] || 0;
      if (count > 0) {
        const details = getStatusDetails(status);
        orderedCards.push({
          status,
          label: details.label,
          badgeClass: details.badgeClass,
          count
        });
        delete counts[status];
      }
    });

    // Then, add other statuses that were not in STATUS_FUNNEL_ORDER
    Object.entries(counts).forEach(([status, count]) => {
      if (count > 0) {
        const details = getStatusDetails(status);
        orderedCards.push({
          status,
          label: details.label,
          badgeClass: details.badgeClass,
          count
        });
      }
    });

    // M = number of unique orders
    const uniqueOrders = new Set<string>();
    actualShipments.forEach((s) => {
      let key = '';
      if (s.orderId && s.orderId.trim()) {
        key = `orderId_${s.orderId.trim()}`;
      } else if (s.orderNumber && s.orderNumber.trim()) {
        key = `orderNumber_${s.orderNumber.trim()}`;
      } else {
        key = `postingId_${s.postingId}`;
      }
      uniqueOrders.add(key);
    });

    // Максимальный валидный ozonStatusDate по всем строкам
    let maxDate: Date | null = null;
    for (const s of actualShipments) {
      if (s.ozonStatusDate) {
        const d = new Date(s.ozonStatusDate);
        if (!isNaN(d.getTime())) {
          if (!maxDate || d > maxDate) {
            maxDate = d;
          }
        }
      }
    }

    const maxDateStr = maxDate ? maxDate.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }) : null;

    return {
      cards: orderedCards,
      totalShipments: actualShipments.length,
      totalOrders: uniqueOrders.size,
      lastUpdatedStr: maxDateStr
    };
  }, [externalShipments, isAdmin]);

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

      {/* Ozon Alerts Block */}
      {isAdmin && alerts.length > 0 && (
        <div className="space-y-3 bg-slate-50/50 p-6 rounded-3xl border border-slate-200/60 shadow-sm" id="ozon-alerts-block">
          <div
            className="flex justify-between items-center cursor-pointer select-none"
            onClick={() => setIsAlertsCollapsed(prev => !prev)}
          >
            <div className="flex items-center gap-3">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <span>⚠️</span> Алерты Ozon
              </h3>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-indigo-50 text-indigo-600 border border-indigo-100">
                {alerts.length}
              </span>
            </div>
            <button
              type="button"
              aria-label={isAlertsCollapsed ? 'Развернуть алерты' : 'Свернуть алерты'}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
              onClick={(e) => { e.stopPropagation(); setIsAlertsCollapsed(prev => !prev); }}
            >
              <ChevronDown
                size={20}
                className={`transition-transform duration-200 ${isAlertsCollapsed ? '-rotate-90' : ''}`}
              />
            </button>
          </div>

          {!isAlertsCollapsed && (
            <div className="flex flex-col gap-3 mt-3">
              {alerts.map((alert) => {
                let severityClasses = '';
                let titleClasses = '';
                if (alert.severity === 'red') {
                  severityClasses = 'bg-red-50 border-red-200 text-red-800';
                  titleClasses = 'text-red-800';
                } else if (alert.severity === 'amber') {
                  severityClasses = 'bg-amber-50 border-amber-200 text-amber-800';
                  titleClasses = 'text-amber-800';
                } else if (alert.severity === 'violet') {
                  severityClasses = 'bg-violet-50 border-violet-200 text-violet-800';
                  titleClasses = 'text-violet-800';
                }

                return (
                  <div
                    key={alert.key}
                    className={`p-4 rounded-2xl border flex items-center justify-between gap-4 transition-all hover:shadow-xs ${severityClasses}`}
                    id={`ozon-alert-${alert.key}`}
                  >
                    <div className="flex flex-col gap-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-bold text-sm ${titleClasses}`}>{alert.title}</span>
                        {alert.cabinet && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-white/80 border border-current opacity-80">
                            {alert.cabinet}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-600 font-medium break-words leading-relaxed">{alert.description}</span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setActiveTab('ozon')}
                        className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 text-slate-700 hover:bg-slate-50 transition-all shadow-xs"
                      >
                        Открыть
                      </button>
                      <button
                        type="button"
                        aria-label="Скрыть алерт"
                        onClick={() => dismissAlert(alert.key)}
                        className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-white/80 transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Ozon Supply Funnel */}
      {isAdmin && funnelData && (
        <div className="space-y-3 bg-slate-50/50 p-6 rounded-3xl border border-slate-200/60 shadow-sm">
          <div
            className="flex justify-between items-center cursor-pointer select-none"
            onClick={() => setIsFunnelCollapsed(prev => !prev)}
          >
            <h3 className="text-xl font-bold text-slate-800">Воронка поставок Ozon</h3>
            <button
              type="button"
              aria-label={isFunnelCollapsed ? 'Развернуть воронку' : 'Свернуть воронку'}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
              onClick={(e) => { e.stopPropagation(); setIsFunnelCollapsed(prev => !prev); }}
            >
              <ChevronDown
                size={20}
                className={`transition-transform duration-200 ${isFunnelCollapsed ? '-rotate-90' : ''}`}
              />
            </button>
          </div>
          
          {!isFunnelCollapsed && (
            <>
              <div className="flex flex-wrap gap-3">
                {funnelData.cards.map((card) => (
                  <div
                    key={card.status}
                    onClick={() => setActiveTab('ozon')}
                    className={`bg-white p-4 rounded-2xl border border-slate-200 hover:border-indigo-300 hover:shadow-sm cursor-pointer transition-all flex flex-col gap-2 min-w-[150px] ${
                      ['COMPLETED', 'CANCELLED'].includes(card.status) ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex items-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-lg font-bold tracking-wide truncate ${card.badgeClass}`}>
                        {card.label}
                      </span>
                    </div>
                    <div className="text-3xl font-extrabold text-slate-900 leading-none">
                      {card.count}
                    </div>
                  </div>
                ))}
              </div>
              
              <p className="text-xs text-slate-400 font-medium">
                {funnelData.totalShipments} поставок в {funnelData.totalOrders} заявках
                {funnelData.lastUpdatedStr && ` · статусы обновлены ${funnelData.lastUpdatedStr}`}
              </p>
            </>
          )}
        </div>
      )}

      {/* Ozon Stocks Mirror Section */}
      {isAdmin && (
        <div className="space-y-4 bg-slate-50/50 p-6 rounded-3xl border border-slate-200/60 shadow-sm" id="ozon-stocks-mirror-section">
          <div
            className="flex justify-between items-center cursor-pointer select-none"
            onClick={() => setIsOzonStocksCollapsed(prev => !prev)}
            id="ozon-stocks-header"
          >
            <div className="flex items-center gap-3">
              <h3 className="text-xl font-bold text-slate-800">Остатки на складах Ozon</h3>
              {!isOzonStocksCollapsed && maxUpdatedAt && (
                <span className="text-xs text-slate-400 font-medium">
                  Обновлено: {maxUpdatedAt}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
              {!isOzonStocksCollapsed && (
                <button
                  type="button"
                  id="btn-refresh-ozon-stocks"
                  disabled={isProcessing}
                  onClick={runOzonStocksSync}
                  className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-white border border-slate-200 hover:border-slate-300 px-3 py-1.5 rounded-xl transition-all shadow-xs disabled:opacity-50"
                >
                  <RefreshCw size={14} className={`transition-transform ${isProcessing ? 'animate-spin' : ''}`} />
                  Обновить
                </button>
              )}
              <button
                type="button"
                id="btn-collapse-ozon-stocks"
                aria-label={isOzonStocksCollapsed ? 'Развернуть остатки Ozon' : 'Свернуть остатки Ozon'}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
                onClick={() => setIsOzonStocksCollapsed(prev => !prev)}
              >
                <ChevronDown
                  size={20}
                  className={`transition-transform duration-200 ${isOzonStocksCollapsed ? '-rotate-90' : ''}`}
                />
              </button>
            </div>
          </div>

          {!isOzonStocksCollapsed && (
            <div className="space-y-4" id="ozon-stocks-content">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3" id="ozon-stocks-summary-cards">
                <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col gap-1">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">
                    Доступно к продаже
                  </span>
                  <div className="text-2xl font-extrabold text-slate-900 leading-none">
                    {ozonTotals.available.toLocaleString('ru-RU')}
                  </div>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col gap-1">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">
                    В заявках
                  </span>
                  <div className="text-2xl font-extrabold text-slate-900 leading-none">
                    {ozonTotals.requested.toLocaleString('ru-RU')}
                  </div>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col gap-1">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">
                    В пути
                  </span>
                  <div className="text-2xl font-extrabold text-slate-900 leading-none">
                    {ozonTotals.transit.toLocaleString('ru-RU')}
                  </div>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col gap-1">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">
                    Возвраты
                  </span>
                  <div className="text-2xl font-extrabold text-slate-900 leading-none">
                    {ozonTotals.returns.toLocaleString('ru-RU')}
                  </div>
                </div>
              </div>

              {/* Table / List */}
              {!ozonStocks || ozonStocks.length === 0 ? (
                <div className="bg-white p-6 rounded-2xl border border-slate-200 text-center text-sm text-slate-500" id="ozon-stocks-empty">
                  Данных пока нет. Нажмите „Обновить", чтобы загрузить остатки со складов Ozon.
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm" id="ozon-stocks-table-container">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs" id="ozon-stocks-table">
                      <thead>
                        <tr className="bg-slate-50/75 border-b border-slate-200 text-slate-500 font-semibold">
                          <th className="p-3">Артикул / Название</th>
                          <th className="p-3 text-right">Доступно</th>
                          <th className="p-3 text-right">Готовим</th>
                          <th className="p-3 text-right">В заявках</th>
                          <th className="p-3 text-right">В пути</th>
                          <th className="p-3 text-right">Излишки</th>
                          <th className="p-3 text-right">Возвраты</th>
                          <th className="p-3 text-right">Прочее</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupedStocks.map((group) => {
                          const isExpanded = !!expandedOfferKeys[group.key];
                          return (
                            <React.Fragment key={group.key}>
                              {/* Main Article Row */}
                              <tr
                                className="border-b border-slate-100 hover:bg-slate-50/50 cursor-pointer transition-colors"
                                onClick={() => toggleOfferKey(group.key)}
                                id={`ozon-stock-row-${group.offerId}`}
                              >
                                <td className="p-3 min-w-[200px] max-w-[350px]">
                                  <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      {uniqueCabinetsCount > 1 && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold tracking-wide bg-indigo-50 text-indigo-600 border border-indigo-100">
                                          {group.cabinet}
                                        </span>
                                      )}
                                      <span className="font-mono font-bold text-slate-700">{group.offerId}</span>
                                    </div>
                                    <span className="text-slate-500 truncate block text-[11px]" title={group.name}>
                                      {group.name}
                                    </span>
                                  </div>
                                </td>
                                <td className={`p-3 text-right font-semibold ${group.available === 0 ? 'text-slate-300' : 'text-slate-900'}`}>
                                  {group.available.toLocaleString('ru-RU')}
                                </td>
                                <td className={`p-3 text-right ${group.preparing === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                  {group.preparing.toLocaleString('ru-RU')}
                                </td>
                                <td className={`p-3 text-right ${group.requested === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                  {group.requested.toLocaleString('ru-RU')}
                                </td>
                                <td className={`p-3 text-right ${group.transit === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                  {group.transit.toLocaleString('ru-RU')}
                                </td>
                                <td className={`p-3 text-right ${group.excess === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                  {group.excess.toLocaleString('ru-RU')}
                                </td>
                                <td className={`p-3 text-right ${group.returns === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                  {group.returns.toLocaleString('ru-RU')}
                                </td>
                                <td className={`p-3 text-right ${group.other === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                  {group.other.toLocaleString('ru-RU')}
                                </td>
                              </tr>

                              {/* Warehouse Details Rows */}
                              {isExpanded && group.items.map((item: OzonStockRow, idx: number) => (
                                <tr
                                  key={`${group.key}-item-${idx}`}
                                  className="bg-slate-50/30 border-b border-slate-100/50 hover:bg-slate-50 transition-colors"
                                  id={`ozon-stock-subrow-${group.offerId}-${idx}`}
                                >
                                  <td className="p-2.5 pl-6">
                                    <div className="flex flex-col gap-0.5 border-l-2 border-indigo-200 pl-3">
                                      <span className="font-semibold text-slate-700 text-[11px]">{item.warehouseName}</span>
                                      {item.clusterName && (
                                        <span className="text-[10px] text-slate-400 font-medium">Кластер: {item.clusterName}</span>
                                      )}
                                    </div>
                                  </td>
                                  <td className={`p-2.5 text-right font-medium ${item.available === 0 ? 'text-slate-300 font-normal' : 'text-slate-800'}`}>
                                    {item.available.toLocaleString('ru-RU')}
                                  </td>
                                  <td className={`p-2.5 text-right ${item.preparing === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                    {item.preparing.toLocaleString('ru-RU')}
                                  </td>
                                  <td className={`p-2.5 text-right ${item.requested === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                    {item.requested.toLocaleString('ru-RU')}
                                  </td>
                                  <td className={`p-2.5 text-right ${item.transit === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                    {item.transit.toLocaleString('ru-RU')}
                                  </td>
                                  <td className={`p-2.5 text-right ${item.excess === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                    {item.excess.toLocaleString('ru-RU')}
                                  </td>
                                  <td className={`p-2.5 text-right ${item.returns === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                    {item.returns.toLocaleString('ru-RU')}
                                  </td>
                                  <td className={`p-2.5 text-right ${item.other === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                                    {item.other.toLocaleString('ru-RU')}
                                  </td>
                                </tr>
                              ))}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
